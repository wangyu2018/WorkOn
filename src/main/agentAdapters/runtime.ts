/**
 * Agent 适配器运行时公共能力
 * - 从 agents.ts 抽出：探测与派发共用的进程、路径、模板工具
 * - 适配器只依赖本文件，不反向依赖注册表，避免循环引用
 */
import { execFileSync, spawn } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'
import type { AgentConnector, AgentProbeResult } from '@shared/agents'

export const HOME = os.homedir()

export function exists(p: string): boolean {
  try { return fs.existsSync(p) } catch { return false }
}

export function executable(p: string): boolean {
  try { fs.accessSync(p, fs.constants.X_OK); return true } catch { return false }
}

export function which(bin: string): string | undefined {
  try {
    const out = execFileSync('/usr/bin/which', [bin], { encoding: 'utf-8', timeout: 2000 }).trim()
    return out || undefined
  } catch {
    return undefined
  }
}

let procCache: { at: number; text: string } | null = null

function runningText(): string {
  const now = Date.now()
  if (procCache && now - procCache.at < 10_000) return procCache.text
  try {
    const text = execFileSync('/bin/ps', ['-axo', 'comm='], { encoding: 'utf-8', timeout: 3000 })
    procCache = { at: now, text }
    return text
  } catch {
    return ''
  }
}

export function isRunning(name: string): boolean {
  return runningText().toLowerCase().includes(name.toLowerCase())
}

export interface CaptureResult {
  ok: boolean
  output: string
  error?: string
  durationMs: number
}

export function capture(
  cmd: string,
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv | undefined,
  timeoutMs: number
): Promise<CaptureResult> {
  return new Promise((resolve) => {
    const started = Date.now()
    let out = ''
    let err = ''
    let settled = false
    const child = spawn(cmd, args, { cwd, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] })
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      try { child.kill('SIGTERM') } catch { /* ignore */ }
      resolve({ ok: false, output: out.slice(0, 20_000), error: `执行超时（${Math.round(timeoutMs / 1000)}s）`, durationMs: Date.now() - started })
    }, timeoutMs)
    child.stdout.on('data', (d) => { if (out.length < 100_000) out += String(d) })
    child.stderr.on('data', (d) => { if (err.length < 50_000) err += String(d) })
    child.on('error', (e) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({ ok: false, output: out.slice(0, 20_000), error: e.message, durationMs: Date.now() - started })
    })
    child.on('close', (code) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({
        ok: code === 0,
        output: out.trim().slice(0, 20_000),
        error: code === 0 ? undefined : (err.trim() || `退出码 ${code}`),
        durationMs: Date.now() - started
      })
    })
  })
}

let cachedNode: string | null | undefined

/** 找本机 Node ≥22（Electron 自带 Node 20 缺 node:sqlite，跑不了 ZCode 这类新 CLI） */
function systemNode(): string | null {
  if (cachedNode !== undefined) return cachedNode
  const candidates = ['/opt/homebrew/bin/node', '/usr/local/bin/node', which('node') ?? '']
  for (const bin of candidates) {
    if (!bin) continue
    try {
      const major = Number(execFileSync(bin, ['-v'], { encoding: 'utf-8', timeout: 2000 }).trim().replace(/^v/, '').split('.')[0])
      if (major >= 22) {
        cachedNode = bin
        return bin
      }
    } catch { /* 试下一个 */ }
  }
  cachedNode = null
  return null
}

export function commandFor(rec: AgentConnector, args: string[]): { cmd: string; args: string[]; env: NodeJS.ProcessEnv } {
  const isNodeScript = /\.(cjs|mjs|js)$/i.test(rec.endpoint) || rec.env.ELECTRON_RUN_AS_NODE === '1'
  if (isNodeScript) {
    const node = systemNode()
    if (node) return { cmd: node, args: [rec.endpoint, ...args], env: {} }
    // 没有本机 Node 时退回 Electron 自带 Node，必须声明 ELECTRON_RUN_AS_NODE，
    // 否则会拉起一个新的 Electron 应用实例并挂住（表现为 CLI 探测/派发超时）
    return { cmd: process.execPath, args: [rec.endpoint, ...args], env: { ELECTRON_RUN_AS_NODE: '1' } }
  }
  return { cmd: rec.endpoint, args, env: {} }
}

/** MCP / ACP 的 stdio 握手探测 */
export async function stdioHandshake(rec: AgentConnector): Promise<AgentProbeResult> {
  const started = Date.now()
  const args = rec.args.length ? rec.args : []
  const { cmd, args: fullArgs, env: extraEnv } = commandFor(rec, args)
  return new Promise((resolve) => {
    let settled = false
    let buffer = ''
    const child = spawn(cmd, fullArgs, { cwd: rec.cwd || HOME, env: { ...process.env, ...rec.env, ...extraEnv }, stdio: ['pipe', 'pipe', 'pipe'] })
    const finish = (result: AgentProbeResult): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      try { child.kill('SIGTERM') } catch { /* ignore */ }
      resolve(result)
    }
    const timer = setTimeout(() => finish({ ok: false, status: 'error', detail: '握手超时（5s）', latencyMs: Date.now() - started }), 5000)
    child.on('error', (e) => finish({ ok: false, status: 'error', detail: e.message, latencyMs: Date.now() - started }))
    child.stdout.on('data', (d) => {
      buffer += String(d)
      if (!/"result"/.test(buffer)) return
      try {
        const line = buffer.split('\n').find((l) => /"result"/.test(l)) ?? buffer
        const json = JSON.parse(line) as { result?: { serverInfo?: { name?: string; version?: string } } }
        const info = json.result?.serverInfo
        finish({
          ok: true,
          status: 'online',
          detail: info?.name ? `${info.name}${info.version ? ` ${info.version}` : ''} · 握手成功` : '握手成功',
          version: info?.version,
          latencyMs: Date.now() - started
        })
      } catch {
        finish({ ok: true, status: 'online', detail: '握手成功', latencyMs: Date.now() - started })
      }
    })
    try {
      child.stdin.write(JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'WorkOn', version: '0.2.0' } }
      }) + '\n')
    } catch {
      finish({ ok: false, status: 'error', detail: '无法写入握手请求', latencyMs: Date.now() - started })
    }
  })
}

function expandHome(input: string): string {
  if (!input) return HOME
  if (input === '~') return HOME
  if (input.startsWith('~/')) return path.join(HOME, input.slice(2))
  return input
}

export function safeCwd(input?: string): string {
  const resolved = path.resolve(expandHome(input ?? ''))
  const home = path.resolve(HOME)
  if (!resolved.startsWith(home + path.sep) && resolved !== home) {
    throw new Error('工作目录必须位于当前用户主目录内')
  }
  if (!exists(resolved) || !fs.statSync(resolved).isDirectory()) {
    throw new Error(`工作目录不存在：${resolved}`)
  }
  return resolved
}

export function fillTemplate(value: string, prompt: string, cwd: string, name: string): string {
  return value.replace(/\{prompt\}/g, prompt).replace(/\{cwd\}/g, cwd).replace(/\{name\}/g, name)
}

export interface DispatchResult {
  ok: boolean
  output: string
  error?: string
  durationMs: number
}

/** 把外部 CLI 的已知失败形态翻译成可操作提示（部分 CLI 以 exit 0 + JSON 报错） */
export function interpretDispatch(result: DispatchResult): DispatchResult {
  const output = result.output ?? ''
  const text = `${output}\n${result.error ?? ''}`
  if (/Select a model before sending a message/i.test(text)) {
    return {
      ok: false,
      output,
      error: 'ZCode 尚未选择模型：请先打开 ZCode 桌面端选好模型；0.17.1 的 --prompt 暂不支持指定模型',
      durationMs: result.durationMs
    }
  }
  if (/Not logged in/i.test(text)) {
    return {
      ok: false,
      output,
      error: 'Qoder CLI 未登录：请在终端运行 qoderclicn 后执行 /login（CLI 与 IDE 登录态不共享）',
      durationMs: result.durationMs
    }
  }
  try {
    const parsed = JSON.parse(output.trim()) as { is_error?: boolean; result?: string; error?: string }
    if (parsed?.is_error) {
      return {
        ok: false,
        output,
        error: String(parsed.result || parsed.error || 'Agent 返回错误').slice(0, 500),
        durationMs: result.durationMs
      }
    }
  } catch {
    /* 非 JSON 输出保持原样 */
  }
  return result
}
