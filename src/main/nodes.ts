/**
 * 节点模式（P0）：外部电脑作为执行端，出站连接主端
 *
 * 设计见 docs/workon-remote-node-sessions.md：
 *  - 配对：一次性 6 位配对码（5 分钟有效）→ 长期 token（本地只存 sha256）
 *  - 传输：节点主动出站 WSS/WS，主端不监听公网端口
 *  - 能力：P0 只开放只读一档（sys.info / fs.list / fs.read）
 *  - 会话：target 维度由 chatSessions 承担，这里只管节点与调用
 *
 * 与 agentHook 的边界：不复用 18790，本模块用独立端口 + 鉴权。
 */
import crypto from 'crypto'
import os from 'os'
import path from 'path'
import { WebSocketServer, WebSocket } from 'ws'
import { col, insertInto, updateIn, removeFrom } from './db'
import { genId } from '@shared/types'
import type { NodeRecord, RemoteNodeInfo } from '@shared/types'
import type { JobRecord } from '@shared/job'

/** 节点端口（与 agentHook 18790 错开） */
export const NODE_PORT = 18792
const PAIR_TTL_MS = 5 * 60 * 1000
const AUTH_WINDOW_MS = 10 * 1000
const HEARTBEAT_TIMEOUT_MS = 45 * 1000

export type RemoteAction = 'sys.info' | 'fs.list' | 'fs.read' | 'fs.write'

interface PairingCode {
  code: string
  expiresAt: number
}

interface PendingCall {
  resolve: (value: string) => void
  reject: (err: Error) => void
  timer: NodeJS.Timeout
}

let server: WebSocketServer | null = null
let pairing: PairingCode | null = null
const sockets = new Map<string, WebSocket>()
const lastSeen = new Map<string, number>()
const pending = new Map<string, PendingCall>()
let sink: ((nodes: RemoteNodeInfo[]) => void) | null = null
let jobSink: ((nodeId: string, msg: Record<string, unknown>) => void) | null = null

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex')
}

function fingerprintOf(raw: unknown): { label: string; hostname: string; os: string; arch: string } {
  const fp = (raw ?? {}) as Record<string, unknown>
  const hostname = String(fp.hostname ?? 'unknown')
  return {
    hostname,
    label: String(fp.label ?? hostname),
    os: String(fp.platform ?? fp.os ?? 'unknown'),
    arch: String(fp.arch ?? 'unknown')
  }
}

/** 由 IPC 层注册推送通道，节点上下线时刷新渲染端列表 */
export function setNodeSink(fn: (nodes: RemoteNodeInfo[]) => void): void {
  sink = fn
}

function emit(): void {
  try {
    sink?.(listNodes())
  } catch {
    /* 推送失败不影响主流程 */
  }
}

/** 本机可被节点访问的局域网地址（用于配对提示） */
function lanAddresses(): string[] {
  const out: string[] = ['127.0.0.1']
  for (const list of Object.values(os.networkInterfaces())) {
    for (const info of list ?? []) {
      if (info.family === 'IPv4' && !info.internal) out.push(info.address)
    }
  }
  return out
}

export function listNodes(): RemoteNodeInfo[] {
  return col<NodeRecord>('nodes').map((n) => ({
    id: n.id,
    label: n.label,
    hostname: n.hostname,
    os: n.os,
    arch: n.arch,
    authLevel: n.authLevel,
    pairedAt: n.pairedAt,
    lastSeen: lastSeen.get(n.id) ?? n.lastSeen,
    online: sockets.has(n.id)
  }))
}

export function getNodeLabel(nodeId: string): string {
  const rec = col<NodeRecord>('nodes').find((n) => n.id === nodeId)
  return rec?.label ?? nodeId
}

/** 生成一次性配对码；渲染端据此展示「在另一台电脑执行…」 */
export function createPairing(): { code: string; expiresAt: number; port: number; addresses: string[] } {
  const code = String(Math.floor(100000 + Math.random() * 900000))
  pairing = { code, expiresAt: Date.now() + PAIR_TTL_MS }
  return { code, expiresAt: pairing.expiresAt, port: NODE_PORT, addresses: lanAddresses() }
}

/** 撤销节点：断开连接并删除记录（token 随之失效） */
export function revokeNode(nodeId: string): boolean {
  const ws = sockets.get(nodeId)
  if (ws) {
    try {
      ws.close()
    } catch {
      /* ignore */
    }
  }
  sockets.delete(nodeId)
  lastSeen.delete(nodeId)
  const ok = removeFrom('nodes', nodeId)
  emit()
  return ok
}

/** 系统提示词片段：把在线节点与 nodeId 告诉 LLM，避免它编造节点 */
export function nodePromptSection(): string {
  const nodes = listNodes()
  if (nodes.length === 0) {
    return '【远程节点】当前没有已配对的外部电脑。涉及其他电脑的问题，请提示用户先在「设置 → 外部节点」配对。'
  }
  const lines = nodes.map(
    (n) =>
      `- ${n.label}（nodeId=${n.id}，${n.os}/${n.arch}，${n.online ? '在线' : '离线'}，授权=${n.authLevel === 'read' ? '只读' : n.authLevel}）`
  )
  return (
    `【远程节点】已配对的外部电脑（P0 只读：系统信息 / 列目录 / 读文本）：\n${lines.join('\n')}\n` +
    '需要查看某台外部电脑时，调用 remote_sys_info / remote_fs_list 并传入对应 nodeId；不要使用本机路径假设。'
  )
}

/** 主端调用节点能力；返回 JSON 字符串（与能力插件出口一致） */
export async function callNode(
  nodeId: string,
  action: RemoteAction,
  args: Record<string, unknown>,
  timeoutMs = 15_000
): Promise<string> {
  const ws = sockets.get(nodeId)
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    throw new Error(`目标节点离线：${getNodeLabel(nodeId)}`)
  }
  const id = genId('rq')
  return await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id)
      reject(new Error(`节点响应超时（${action}）`))
    }, timeoutMs)
    pending.set(id, { resolve, reject, timer })
    ws.send(JSON.stringify({ type: 'request', id, action, args, timeoutMs }), (err) => {
      if (!err) return
      pending.delete(id)
      clearTimeout(timer)
      reject(new Error(`下发失败：${err.message}`))
    })
  })
}

/** 写入路径白名单：仅当前用户目录（含子目录） */
export function assertWritablePath(p: string): string {
  const abs = path.resolve(String(p ?? ''))
  const home = path.resolve(os.homedir())
  if (abs !== home && !abs.startsWith(home + path.sep)) {
    throw new Error('只允许写入用户目录下的文件')
  }
  return abs
}

function lineDiff(oldText: string, newText: string): string {
  const a = oldText ? oldText.split('\n') : []
  const b = newText ? newText.split('\n') : []
  const out: string[] = []
  const max = Math.max(a.length, b.length)
  for (let i = 0; i < max && out.length < 160; i++) {
    if ((a[i] ?? '') === (b[i] ?? '')) continue
    if (a[i] !== undefined) out.push(`- ${a[i]}`)
    if (b[i] !== undefined) out.push(`+ ${b[i]}`)
  }
  return out.length ? out.join('\n') : '（内容无变化）'
}

/** 写入前预览：只读旧文件 + 生成 diff，不落盘 */
export async function proposeNodeWrite(
  nodeId: string,
  filePath: string,
  content: string
): Promise<{ path: string; exists: boolean; preview: string; diff: string }> {
  const abs = assertWritablePath(filePath)
  let old = ''
  let exists = false
  try {
    const raw = await callNode(nodeId, 'fs.read', { path: abs }, 10_000)
    const parsed = JSON.parse(raw) as { content?: string; data?: string }
    old = String(parsed.content ?? parsed.data ?? '')
    exists = true
  } catch {
    exists = false
  }
  return {
    path: abs,
    exists,
    preview: String(content ?? '').slice(0, 2000),
    diff: lineDiff(old, String(content ?? ''))
  }
}

/** 确认后写入（必须显式 confirmed=true） */
export async function commitNodeWrite(
  nodeId: string,
  filePath: string,
  content: string,
  confirmed: boolean
): Promise<string> {
  if (!confirmed) throw new Error('写入未确认')
  const abs = assertWritablePath(filePath)
  return callNode(nodeId, 'fs.write', { path: abs, content: String(content ?? '') }, 20_000)
}

/** 云端作业服务器事件回流（job.event / job.result / job.snapshot） */
export function setNodeJobSink(fn: (nodeId: string, msg: Record<string, unknown>) => void): void {
  jobSink = fn
}

function sendToNode(nodeId: string, msg: Record<string, unknown>): boolean {
  const ws = sockets.get(nodeId)
  if (!ws || ws.readyState !== WebSocket.OPEN) return false
  try {
    ws.send(JSON.stringify(msg))
    return true
  } catch {
    return false
  }
}

/** 把作业派发到云作业服务器；返回是否成功写入连接 */
export function offerJobToNode(nodeId: string, job: JobRecord): boolean {
  return sendToNode(nodeId, {
    type: 'job.offer',
    offerId: genId('offer'),
    job: {
      id: job.id,
      commitmentId: job.commitmentId,
      title: job.title,
      goal: job.goal,
      plan: job.plan,
      policy: job.policy
    }
  })
}

export function cancelJobOnNode(nodeId: string, jobId: string): boolean {
  return sendToNode(nodeId, { type: 'job.cancel', jobId })
}

/** 节点重连后，请它把未同步的作业快照发回来 */
export function requestNodeJobSync(nodeId: string): boolean {
  return sendToNode(nodeId, { type: 'job.sync', since: Date.now() - 24 * 60 * 60 * 1000 })
}

function finishCall(msg: Record<string, unknown>): void {  const id = String(msg.id ?? '')
  const call = pending.get(id)
  if (!call) return
  pending.delete(id)
  clearTimeout(call.timer)
  if (msg.ok) call.resolve(JSON.stringify(msg.result ?? {}))
  else call.reject(new Error(String(msg.error ?? '节点执行失败')))
}

function handlePair(ws: WebSocket, msg: Record<string, unknown>): string | null {
  const code = String(msg.code ?? '').trim()
  if (!pairing || pairing.code !== code || Date.now() > pairing.expiresAt) {
    ws.send(JSON.stringify({ type: 'error', error: '配对码无效或已过期' }))
    ws.close()
    return null
  }
  pairing = null
  const fp = fingerprintOf(msg.fingerprint)
  const caps = Array.isArray((msg.fingerprint as Record<string, unknown> | undefined)?.capabilities)
    ? ((msg.fingerprint as Record<string, unknown>).capabilities as unknown[]).map(String)
    : []
  const token = crypto.randomBytes(24).toString('hex')
  const now = Date.now()
  const rec: NodeRecord = {
    id: genId('node'),
    ...fp,
    authLevel: caps.includes('job.run') ? 'exec' : 'read',
    tokenHash: hashToken(token),
    pairedAt: now,
    lastSeen: now
  }
  insertInto('nodes', rec)
  sockets.set(rec.id, ws)
  lastSeen.set(rec.id, now)
  ws.send(JSON.stringify({ type: 'paired', nodeId: rec.id, token, authLevel: rec.authLevel }))
  // 配对与鉴权同一次完成：直接进入就绪态，节点随即开始心跳
  ws.send(JSON.stringify({ type: 'ready', nodeId: rec.id, authLevel: rec.authLevel }))
  console.log(`[nodes] 已配对：${rec.label}（${rec.id}）`)
  emit()
  return rec.id
}

function handleAuth(ws: WebSocket, msg: Record<string, unknown>): string | null {
  const token = String(msg.token ?? '')
  const rec = col<NodeRecord>('nodes').find((n) => n.tokenHash === hashToken(token))
  if (!rec) {
    ws.send(JSON.stringify({ type: 'error', error: 'token 无效，请重新配对' }))
    ws.close()
    return null
  }
  const fp = fingerprintOf(msg.fingerprint)
  const caps = Array.isArray((msg.fingerprint as Record<string, unknown> | undefined)?.capabilities)
    ? ((msg.fingerprint as Record<string, unknown>).capabilities as unknown[]).map(String)
    : []
  sockets.set(rec.id, ws)
  lastSeen.set(rec.id, Date.now())
  updateIn<NodeRecord>('nodes', rec.id, {
    label: fp.label,
    hostname: fp.hostname,
    os: fp.os,
    arch: fp.arch,
    authLevel: caps.includes('job.run') ? 'exec' : rec.authLevel,
    lastSeen: Date.now()
  })
  ws.send(JSON.stringify({ type: 'ready', nodeId: rec.id, authLevel: rec.authLevel }))
  console.log(`[nodes] 节点上线：${fp.label}（${rec.id}）`)
  emit()
  return rec.id
}

export function startNodeServer(): void {
  if (server) return
  try {
    server = new WebSocketServer({ port: NODE_PORT, host: '0.0.0.0' })
  } catch (e) {
    console.warn('[nodes] 节点端口启动失败', (e as Error).message)
    return
  }
  server.on('listening', () => console.log(`[nodes] 节点端口就绪 0.0.0.0:${NODE_PORT}`))
  server.on('error', (e) => console.warn('[nodes] 节点端口错误', e.message))

  server.on('connection', (ws) => {
    let nodeId: string | null = null
    const authTimer = setTimeout(() => {
      if (!nodeId) ws.close()
    }, AUTH_WINDOW_MS)

    ws.on('message', (raw) => {
      let msg: Record<string, unknown>
      try {
        msg = JSON.parse(String(raw)) as Record<string, unknown>
      } catch {
        return
      }
      const type = String(msg.type ?? '')
      if (type === 'pair') {
        const pairedId = handlePair(ws, msg)
        if (pairedId) {
          nodeId = pairedId
          clearTimeout(authTimer)
        }
      } else if (type === 'auth') {
        const authedId = handleAuth(ws, msg)
        if (authedId) {
          nodeId = authedId
          clearTimeout(authTimer)
        }
      } else if (type === 'heartbeat' && nodeId) {
        lastSeen.set(nodeId, Date.now())
      } else if (type === 'response') {
        finishCall(msg)
      } else if (type === 'job.event' || type === 'job.result' || type === 'job.accepted' || type === 'job.snapshot' || type === 'capabilities') {
        if (nodeId) jobSink?.(nodeId, msg)
      }
    })

    ws.on('close', () => {
      clearTimeout(authTimer)
      if (!nodeId) return
      if (sockets.get(nodeId) === ws) sockets.delete(nodeId)
      lastSeen.set(nodeId, Date.now())
      const rec = col<NodeRecord>('nodes').find((n) => n.id === nodeId)
      if (rec) updateIn<NodeRecord>('nodes', rec.id, { lastSeen: Date.now() })
      console.log(`[nodes] 节点离线：${rec?.label ?? nodeId}`)
      emit()
    })

    ws.on('error', () => { /* close 事件统一收尾 */ })
  })

  // 心跳超时巡检：网络假死时 close 事件可能迟迟不来
  setInterval(() => {
    const now = Date.now()
    for (const [id, ws] of sockets) {
      if (now - (lastSeen.get(id) ?? 0) > HEARTBEAT_TIMEOUT_MS) {
        try {
          ws.terminate()
        } catch {
          /* ignore */
        }
        sockets.delete(id)
        emit()
      }
    }
  }, 15_000)
}