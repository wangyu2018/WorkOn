/**
 * 动态 Agent 连接器注册表
 * - 唯一事实来源：userData/agents.json
 * - 内置的 WorkBuddy / Trae / ZCode / Qoder / 千问办公只作为“检测到的预设”，
 *   未安装就不出现；用户可以随时新增任意 Agent，不需要改代码
 * - 支持协议：http / mcp / acp / cli / process / manual
 * - 派发：cli / acp（参数模板）、http（POST JSON）；mcp 先做握手与状态
 */
import { app, safeStorage } from 'electron'
import { execFileSync } from 'child_process'
import fs from 'fs'
import path from 'path'
import { genId } from '@shared/types'
import type {
  AgentConnector, AgentInput, AgentListResult, AgentProbeResult,
  AgentRunRecord, AgentRunResult, AgentSuggestion, AgentView
} from '@shared/agents'
import type { AgentAdapterRegistry, AgentRunHandle } from '@shared/agentAdapter'
import { checkIntelProviders, getIntelState } from './intel'
import { createDefaultAgentAdapters } from './agentAdapters'
import { HOME, exists, interpretDispatch, safeCwd, which } from './agentAdapters/runtime'
const STORE_FILE = () => path.join(app.getPath('userData'), 'agents.json')
const RUNS_FILE = () => path.join(app.getPath('userData'), 'agent-runs.json')
const RUN_RETAIN = 200
const RUN_LIST_LIMIT = 100

interface InternalRecord extends AgentConnector {
  tokenEnc?: string
}

interface Store {
  records: InternalRecord[]
}

let store: Store | null = null
const probeCache = new Map<string, { at: number; result: AgentProbeResult }>()
let procCache: { at: number; text: string } | null = null

function loadStore(): Store {
  if (store) return store
  try {
    const file = STORE_FILE()
    if (fs.existsSync(file)) {
      const raw = JSON.parse(fs.readFileSync(file, 'utf-8')) as Partial<Store>
      store = { records: Array.isArray(raw.records) ? raw.records : [] }
      // 修正历史数据：把 CLI 脚本误存成 MCP 的记录迁移回 cli（否则探测会走 MCP 握手并超时）
      let changed = false
      for (const rec of store.records) {
        if (
          rec.protocol === 'mcp' &&
          /\.(cjs|mjs|js)$/i.test(String(rec.endpoint ?? '')) &&
          (rec.dispatchArgs?.length ?? 0) > 0
        ) {
          rec.protocol = 'cli'
          rec.lastError = undefined
          changed = true
        }
      }
      if (changed) saveStore()
    } else {
      store = { records: [] }
    }
  } catch (e) {
    console.warn('[agents] 读取失败，使用空注册表', e)
    store = { records: [] }
  }
  return store
}

function saveStore(): void {
  if (!store) return
  try {
    const file = STORE_FILE()
    fs.mkdirSync(path.dirname(file), { recursive: true })
    const tmp = `${file}.tmp`
    fs.writeFileSync(tmp, JSON.stringify(store, null, 2), 'utf-8')
    fs.renameSync(tmp, file)
  } catch (e) {
    console.warn('[agents] 写入失败', e)
  }
}

/* ---------- 调用留痕：外部 Agent 实际收到的输入与返回的输出 ---------- */

function loadRuns(): AgentRunRecord[] {
  try {
    const file = RUNS_FILE()
    if (!fs.existsSync(file)) return []
    const raw = JSON.parse(fs.readFileSync(file, 'utf-8')) as AgentRunRecord[]
    return Array.isArray(raw) ? raw : []
  } catch {
    return []
  }
}

function saveRuns(runs: AgentRunRecord[]): void {
  try {
    const file = RUNS_FILE()
    fs.mkdirSync(path.dirname(file), { recursive: true })
    const tmp = `${file}.tmp`
    fs.writeFileSync(tmp, JSON.stringify(runs.slice(0, RUN_RETAIN), null, 2), 'utf-8')
    fs.renameSync(tmp, file)
  } catch (e) {
    console.warn('[agents] 调用记录写入失败', e)
  }
}

function appendRun(record: AgentRunRecord): void {
  saveRuns([record, ...loadRuns()])
}

export function listAgentRuns(agentId?: string): AgentRunRecord[] {
  const runs = loadRuns()
  return (agentId ? runs.filter((r) => r.agentId === agentId) : runs).slice(0, RUN_LIST_LIMIT)
}

/** 标记 / 取消标记：把一次真实调用作为工作流编排的参考样本 */
export function setAgentRunReference(runId: string, reference: boolean): AgentRunRecord | null {
  const runs = loadRuns()
  const run = runs.find((r) => r.id === runId)
  if (!run) return null
  run.reference = reference || undefined
  saveRuns(runs)
  return run
}

/** 工作流编排读取的参考样本：最近的、成功的、有输出的最多 3 条 */
export function listReferenceRuns(limit = 3): AgentRunRecord[] {
  return loadRuns()
    .filter((r) => r.reference && r.ok && String(r.output ?? '').trim().length > 0)
    .slice(0, limit)
}

/* ---------- 密钥 ---------- */

function sealToken(token: string): string {
  if (!token) return ''
  try {
    if (safeStorage.isEncryptionAvailable()) {
      return `enc:${safeStorage.encryptString(token).toString('base64')}`
    }
  } catch { /* fall through */ }
  return `plain:${Buffer.from(token, 'utf-8').toString('base64')}`
}

function openToken(rec: InternalRecord): string {
  if (!rec.tokenEnc) return ''
  try {
    if (rec.tokenEnc.startsWith('enc:')) {
      return safeStorage.decryptString(Buffer.from(rec.tokenEnc.slice(4), 'base64'))
    }
    if (rec.tokenEnc.startsWith('plain:')) {
      return Buffer.from(rec.tokenEnc.slice(6), 'base64').toString('utf-8')
    }
  } catch { /* ignore */ }
  return ''
}

/* ---------- 适配器注册表 ---------- */

let registry: AgentAdapterRegistry | null = null

function adapters(): AgentAdapterRegistry {
  if (!registry) {
    registry = createDefaultAgentAdapters((agentId) => {
      const rec = loadStore().records.find((r) => r.id === agentId)
      return rec ? openToken(rec) : ''
    })
  }
  return registry
}

/* ---------- 探测器 ---------- */

function appVersion(appPath: string): string | undefined {
  const plist = path.join(appPath, 'Contents', 'Info.plist')
  if (!exists(plist)) return undefined
  try {
    return execFileSync('/usr/bin/plutil', ['-extract', 'CFBundleShortVersionString', 'raw', plist], { encoding: 'utf-8', timeout: 2000 }).trim() || undefined
  } catch {
    return undefined
  }
}


async function probeRecord(rec: InternalRecord): Promise<AgentProbeResult> {
  if (!rec.enabled) return { ok: false, status: 'offline', detail: '已停用' }
  const cached = probeCache.get(rec.id)
  if (cached && Date.now() - cached.at < 10_000) return cached.result

  const adapter = adapters().resolve(rec)
  let result: AgentProbeResult
  if (!adapter) {
    result = { ok: false, status: 'error', detail: `没有可用的 ${rec.protocol} 适配器` }
  } else {
    try {
      result = await adapter.probe(rec)
    } catch (e) {
      result = { ok: false, status: 'error', detail: (e as Error).message }
    }
  }
  probeCache.set(rec.id, { at: Date.now(), result })
  return result
}

/* ---------- 建议（检测到的预设，不是固定清单） ---------- */

function suggestions(): AgentSuggestion[] {
  const list: AgentSuggestion[] = []
  const zcodeCli = '/Applications/ZCode.app/Contents/Resources/glm/zcode.cjs'
  if (exists(zcodeCli)) {
    // 0.17.1 的 CLI 从 glm/ 下找不到 provider 模板；无头登录态放在独立数据目录，
    // 避免读 macOS Keychain 里 GUI 的 enc:v2:os: 凭据失败导致“Select a model”
    const zcodeHeadless = path.join(HOME, '.zcode/cli-standalone')
    const zcodeHeadlessReady = exists(path.join(zcodeHeadless, '.zcode/v2/credentials.json'))
    list.push({
      id: 'suggest-zcode',
      name: 'ZCode',
      protocol: 'cli',
      endpoint: zcodeCli,
      args: ['version'],
      auth: 'none',
      capabilities: ['无头 prompt', '会话恢复', 'MCP', '工具执行'],
      detail: `检测到 ZCode CLI ${appVersion('/Applications/ZCode.app') ?? ''} · 可直接派发`,
      preset: {
        dispatchArgs: ['--prompt', '{prompt}', '--cwd', '{cwd}', '--mode', 'guarded', '--json'],
        env: {
          ELECTRON_RUN_AS_NODE: '1',
          ZCODE_BUILTIN_PROVIDER_CONFIG_FILE: '/Applications/ZCode.app/Contents/Resources/config/provider/zcode-builtin.json',
          ...(zcodeHeadlessReady
            ? {
                ZCODE_DATA_BASE_DIR: zcodeHeadless,
                ZCODE_CREDENTIAL_SECRET_FILE: path.join(zcodeHeadless, 'credential-secret')
              }
            : {})
        },
        quotaMode: 'manual'
      }
    })
  }
  const qoderCli = which('qoder') ?? which('qoder-cn') ?? '/Applications/QwenWorkCN.app/Contents/Resources/bin/qoderclicn'
  if (exists(qoderCli)) {
    list.push({
      id: 'suggest-qoder',
      name: 'Qoder',
      protocol: 'cli',
      endpoint: qoderCli,
      args: ['--version'],
      auth: 'login',
      capabilities: ['非交互 -p', '会话恢复', 'MCP', '权限模式'],
      detail: qoderCli.includes('QwenWork') ? '检测到 Qoder CLI（随千问办公内置）· 可直接派发' : '检测到 Qoder 官方 CLI · 可直接派发',
      preset: {
        dispatchArgs: ['-p', '{prompt}', '-w', '{cwd}', '--permission-mode', 'default', '-o', 'json'],
        quotaMode: 'manual'
      }
    })
  }
  const appSuggestions: { app: string; name: string; detail: string; caps: string[]; auth: AgentConnector['auth']; preset?: Partial<AgentConnector> }[] = [
    { app: '/Applications/Trae CN.app', name: 'Trae', detail: '检测到 Trae · 无 prompt CLI，仅状态观察', caps: ['打开工作区', 'MCP', '状态观察'], auth: 'login' },
    { app: '/Applications/WorkBuddy.app', name: 'WorkBuddy', detail: '检测到 WorkBuddy · 无派发 CLI，仅状态观察', caps: ['MCP 客户端', '连接器聚合', '状态观察'], auth: 'login' },
    { app: '/Applications/QwenWorkCN.app', name: '千问办公', detail: '检测到千问办公 · CLI 需登录，仅状态观察', caps: ['办公 Agent', 'CLI 工具', 'MCP'], auth: 'login' },
    { app: '/Applications/Pachat.app', name: 'Pachat', detail: '检测到 Pachat · 暂无公开派发接口', caps: ['多 Agent 会话'], auth: 'login' }
  ]
  appSuggestions.forEach((s) => {
    if (!exists(s.app)) return
    list.push({
      id: `suggest-${s.name}`,
      name: s.name,
      protocol: 'process',
      endpoint: path.basename(s.app, '.app'),
      args: [],
      auth: s.auth,
      capabilities: s.caps,
      detail: s.detail,
      preset: { quotaMode: 'manual', probePath: s.app, ...(s.preset ?? {}) }
    })
  })
  // 动态扫描：其他疑似 Agent 的 .app，不写死清单
  try {
    const known = new Set(list.map((s) => s.name))
    fs.readdirSync('/Applications', { withFileTypes: true })
      .filter((d) => d.isDirectory() && d.name.endsWith('.app'))
      .map((d) => d.name.slice(0, -4))
      .filter((n) => /agent|assistant|cursor|windsurf|devin|claude|zed|code/i.test(n))
      .filter((n) => !known.has(n))
      .slice(0, 8)
      .forEach((n) => {
        list.push({
          id: `suggest-${n}`,
          name: n,
          protocol: 'process',
          endpoint: n,
          args: [],
          auth: 'login',
          capabilities: ['状态观察'],
          detail: `检测到 ${n} · 可作为进程型 Agent 接入`,
          preset: { quotaMode: 'manual', probePath: `/Applications/${n}.app` }
        })
      })
  } catch { /* ignore */ }
  return list
}

/* ---------- 内置本机 Agent ---------- */

async function builtinViews(): Promise<AgentView[]> {
  const s = getIntelState()
  const providers = await checkIntelProviders()
  const map = new Map(providers.map((p) => [p.id, p]))
  const now = Date.now()
  const base = (extra: Partial<AgentView> & Pick<AgentView, 'id' | 'name' | 'detail'>): AgentView => ({
    protocol: 'manual',
    endpoint: 'builtin',
    args: [],
    cwd: '',
    auth: 'none',
    hasToken: false,
    capabilities: [],
    quotaMode: 'observed',
    quotaValue: 0,
    probePath: '',
    dispatchArgs: [],
    env: {},
    enabled: true,
    createdAt: now,
    updatedAt: now,
    lastStatus: 'online',
    calls: 0,
    tokens: 0,
    status: 'online',
    dispatchable: false,
    builtin: true,
    ...extra
  })
  return [
    base({
      id: 'intel-agent',
      name: '情报 Agent',
      detail: `每天 ${s.config.time} · 关注 ${s.watch.length} 个站点 · ${s.config.model}`,
      status: s.config.enabled ? 'online' : 'offline',
      lastStatus: s.config.enabled ? 'online' : 'offline',
      version: s.config.model,
      calls: s.usage.runs,
      tokens: s.usage.tokens,
      lastActive: s.usage.lastRunAt,
      capabilities: ['收藏抓取', '本地摘要', '变更追踪', '情报入库']
    }),
    base({
      id: 'local-model',
      name: '本地模型',
      detail: map.get('local')?.detail ?? '未检测',
      status: map.get('local')?.ok ? 'online' : 'offline',
      lastStatus: map.get('local')?.ok ? 'online' : 'offline',
      version: s.config.model,
      tokens: s.usage.tokens,
      capabilities: ['Ollama', s.config.model, '摘要 / 标签']
    }),
    base({
      id: 'kb-local',
      name: '本地知识库',
      detail: 'WorkOn 本地知识库 · 可直接写入',
      version: 'db.json',
      capabilities: ['知识条目', '标签', '来源回溯']
    }),
    base({
      id: 'kb-weknora',
      name: 'WeKnora',
      detail: map.get('weknora')?.detail ?? '未检测',
      status: map.get('weknora')?.ok ? 'online' : 'offline',
      lastStatus: map.get('weknora')?.ok ? 'online' : 'offline',
      version: 'http://localhost',
      capabilities: ['向量知识库', '文档解析', 'bge-m3']
    }),
    base({
      id: 'kb-memoryhub',
      name: 'Memory Hub',
      detail: map.get('memoryHub')?.detail ?? '未检测',
      status: map.get('memoryHub')?.ok ? 'online' : 'offline',
      lastStatus: map.get('memoryHub')?.ok ? 'online' : 'offline',
      version: 'http://localhost:8125',
      capabilities: ['共享记忆', 'Wiki 知识', '多 Agent']
    })
  ]
}

/* ---------- 对外 API ---------- */

function toView(rec: InternalRecord, probe: AgentProbeResult): AgentView {
  const { tokenEnc: _tokenEnc, ...pub } = rec
  const caps = adapters().resolve(rec)?.capabilities(rec)
  return {
    ...pub,
    status: probe.status,
    detail: probe.detail,
    version: probe.version,
    dispatchable: rec.enabled && !!caps?.dispatch
  }
}

export async function listAgents(): Promise<AgentListResult> {
  const st = loadStore()
  const builtins = await builtinViews()
  const views: AgentView[] = []
  for (const rec of st.records) {
    const probe = await probeRecord(rec)
    views.push(toView(rec, probe))
  }
  const usedNames = new Set(views.map((v) => v.name))
  const suggested = suggestions().filter((s) => !usedNames.has(s.name))
  return { homeDir: HOME, agents: [...builtins, ...views], suggestions: suggested, providers: await checkIntelProviders() }
}

export async function addAgent(input: AgentInput): Promise<{ ok: boolean; agent?: AgentView; error?: string }> {
  const st = loadStore()
  const name = String(input.name ?? '').trim()
  if (!name) return { ok: false, error: '名称不能为空' }
  if (name.length > 48) return { ok: false, error: '名称过长' }
  const endpoint = String(input.endpoint ?? '').trim()
  if (input.protocol !== 'manual' && !endpoint) return { ok: false, error: '地址或命令不能为空' }
  const existing = input.id ? st.records.find((r) => r.id === input.id) : undefined
  if (!existing && st.records.some((r) => r.name === name)) {
    return { ok: false, error: '同名 Agent 已存在' }
  }
  const now = Date.now()
  const record: InternalRecord = existing ?? {
    id: genId('agent'),
    name,
    protocol: input.protocol,
    endpoint,
    args: [],
    cwd: '',
    auth: 'none',
    hasToken: false,
    capabilities: [],
    quotaMode: 'observed',
    quotaValue: 0,
    probePath: '',
    dispatchArgs: [],
    env: {},
    enabled: true,
    createdAt: now,
    updatedAt: now,
    lastStatus: 'unknown',
    calls: 0,
    tokens: 0
  }
  record.name = name
  record.protocol = input.protocol
  if (typeof input.adapterId === 'string') {
    const adapterId = input.adapterId.trim()
    if (adapterId) record.adapterId = adapterId
    else delete record.adapterId
  }
  record.endpoint = endpoint
  record.args = Array.isArray(input.args) ? input.args.map(String).slice(0, 20) : record.args
  if (typeof input.cwd === 'string') record.cwd = input.cwd.trim()
  record.auth = input.auth ?? record.auth
  if (input.auth === 'none') record.tokenEnc = ''
  if (typeof input.token === 'string' && input.token.trim()) record.tokenEnc = sealToken(input.token.trim())
  record.hasToken = !!record.tokenEnc
  record.capabilities = Array.isArray(input.capabilities) ? input.capabilities.map(String).slice(0, 12) : record.capabilities
  record.quotaMode = input.quotaMode ?? record.quotaMode
  record.quotaValue = Math.max(0, Math.round(Number(input.quotaValue ?? record.quotaValue) || 0))
  if (typeof input.probePath === 'string') record.probePath = input.probePath.trim()
  record.dispatchArgs = Array.isArray(input.dispatchArgs) ? input.dispatchArgs.map(String).slice(0, 40) : record.dispatchArgs
  if (Array.isArray(input.allowTools)) {
    record.allowTools = input.allowTools.map(String).map((s) => s.trim()).filter(Boolean).slice(0, 40)
  }
  record.env = input.env && typeof input.env === 'object' ? { ...input.env } : record.env
  if (typeof input.enabled === 'boolean') record.enabled = input.enabled
  record.updatedAt = now
  if (!existing) st.records.push(record)
  const probe = await probeRecord(record)
  record.lastProbeAt = Date.now()
  record.lastStatus = probe.status
  record.lastError = probe.ok ? undefined : probe.detail
  probeCache.set(record.id, { at: Date.now(), result: probe })
  saveStore()
  return { ok: true, agent: toView(record, probe) }
}

export async function updateAgent(id: string, patch: AgentInput): Promise<{ ok: boolean; agent?: AgentView; error?: string }> {
  const st = loadStore()
  const rec = st.records.find((r) => r.id === id)
  if (!rec) return { ok: false, error: 'Agent 不存在' }
  return addAgent({ ...patch, id, name: patch.name ?? rec.name, protocol: patch.protocol ?? rec.protocol, endpoint: patch.endpoint ?? rec.endpoint })
}

export function removeAgent(id: string): boolean {
  const st = loadStore()
  const before = st.records.length
  st.records = st.records.filter((r) => r.id !== id)
  probeCache.delete(id)
  if (st.records.length === before) return false
  saveStore()
  const runs = loadRuns().filter((r) => r.agentId !== id)
  saveRuns(runs)
  return true
}

export async function probeAgent(id: string): Promise<AgentProbeResult | null> {
  const st = loadStore()
  const rec = st.records.find((r) => r.id === id)
  if (!rec) return null
  probeCache.delete(id)
  const probe = await probeRecord(rec)
  rec.lastProbeAt = Date.now()
  rec.lastStatus = probe.status
  rec.lastError = probe.ok ? undefined : probe.detail
  saveStore()
  return probe
}

const activeRuns = new Set<AgentRunHandle>()

function recordRun(
  rec: InternalRecord,
  input: string,
  output: string,
  ok: boolean,
  error: string | undefined,
  startedAt: number
): void {
  appendRun({
    id: genId('arun'),
    agentId: rec.id,
    agentName: rec.name,
    protocol: rec.protocol,
    input,
    output: output.slice(0, 20_000),
    ok,
    error,
    durationMs: Date.now() - startedAt,
    startedAt,
    endedAt: Date.now()
  })
}

/** 停止所有在途 Agent 派发（工作流停止时调用） */
export async function cancelAgentDispatches(): Promise<number> {
  const runs = [...activeRuns]
  activeRuns.clear()
  await Promise.all(runs.map((handle) => handle.cancel('已手动停止').catch(() => undefined)))
  return runs.length
}

export async function dispatchAgent(id: string, prompt: string, cwd?: string, confirm?: boolean): Promise<AgentRunResult> {
  const started = Date.now()
  if (!confirm) return { ok: false, agentId: id, output: '', error: '需要显式确认后才能派发任务', durationMs: 0 }
  const text = String(prompt ?? '').trim()
  if (!text) return { ok: false, agentId: id, output: '', error: '任务内容为空', durationMs: 0 }
  if (text.length > 8000) return { ok: false, agentId: id, output: '', error: '任务内容超过 8000 字', durationMs: 0 }
  const st = loadStore()
  const rec = st.records.find((r) => r.id === id)
  if (!rec) return { ok: false, agentId: id, output: '', error: 'Agent 不存在', durationMs: 0 }
  if (!rec.enabled) return { ok: false, agentId: id, output: '', error: 'Agent 已停用', durationMs: 0 }
  let workdir: string
  try { workdir = safeCwd(cwd || rec.cwd) } catch (e) {
    return { ok: false, agentId: id, output: '', error: (e as Error).message, durationMs: Date.now() - started }
  }

  const adapter = adapters().resolve(rec)
  if (!adapter) {
    const error = `没有可用的 ${rec.protocol} 适配器`
    recordRun(rec, text, '', false, error, started)
    return { ok: false, agentId: id, output: '', error, durationMs: Date.now() - started }
  }

  let handle: AgentRunHandle
  try {
    handle = await adapter.start(rec, { agentId: rec.id, prompt: text, cwd: workdir, timeoutMs: 180_000 })
  } catch (e) {
    const error = (e as Error).message
    recordRun(rec, text, '', false, error, started)
    return { ok: false, agentId: id, output: '', error, durationMs: Date.now() - started }
  }

  let output = ''
  let error: string | undefined
  let ok = false
  activeRuns.add(handle)
  try {
    for await (const event of handle.events) {
      if (event.type === 'text_delta') {
        output += event.text
      } else if (event.type === 'run_done') {
        ok = true
        output = event.output || output
      } else if (event.type === 'run_error') {
        error = event.error
      } else if (event.type === 'run_cancelled') {
        error = '已手动停止'
      }
    }
  } catch (e) {
    error = (e as Error).message
  } finally {
    activeRuns.delete(handle)
  }
  if (!ok && !error) error = 'Agent 未返回结果'

  rec.calls++
  rec.lastActive = Date.now()
  const result = interpretDispatch({
    ok,
    output: output.trim().slice(0, 20_000),
    error,
    durationMs: Date.now() - started
  })
  rec.lastStatus = result.ok ? 'online' : 'error'
  rec.lastError = result.ok ? undefined : result.error
  saveStore()
  recordRun(rec, text, result.output, result.ok, result.error, started)
  return { ok: result.ok, agentId: id, output: result.output, error: result.error, durationMs: result.durationMs }
}
