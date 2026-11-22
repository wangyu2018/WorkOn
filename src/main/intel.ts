/**
 * 收藏网址 / 情报流 / 知识入库
 * - 读取 Chromium 系浏览器（Chrome / Edge / Brave / Chromium / Tabbit）的 Bookmarks JSON
 * - 抓取关注站点正文，调用本地 Ollama qwen3.5:4b 生成摘要
 * - 情报落盘 userData/intel.json；可入本地知识库 / WeKnora / Memory Hub
 * - 每天 config.time（默认 08:30）在应用运行期间自动抓取
 */
import { app, safeStorage } from 'electron'
import fs from 'fs'
import os from 'os'
import path from 'path'
import crypto from 'crypto'
import { spawn, type ChildProcess } from 'child_process'
import { genId, type KnowledgeItem } from '@shared/types'
import type {
  BookmarkSite, BookmarkSource, IntelConfig, IntelItem,
  IntelProvider, IntelScanResult, IntelState, ProviderStatus, VaultSite, VaultStatus, WatchSite
} from '@shared/intel'
import { insertInto } from './db'
import { llmChat } from './ai'

const RETAIN_ITEMS = 200
const MAX_PAGE_BYTES = 3_000_000
const FETCH_TIMEOUT_MS = 15_000

let state: IntelState | null = null
let scanning = false
let scheduler: NodeJS.Timeout | null = null
let siteCache: { at: number; sources: BookmarkSource[]; sites: Map<string, BookmarkSite[]> } | null = null
/** 情报专用本地模型实例（11435）：主 Ollama 若有持续的嵌入流量会饿死生成请求 */
const SIDECAR_PORT = 11435
let sidecarProc: ChildProcess | null = null
let sidecarStarting: Promise<boolean> | null = null

function baseRoot(url: string): string {
  return url.replace(/\/v1\/?$/, '').replace(/\/$/, '')
}

function ollamaBinary(): string | null {
  const candidates = [process.env.OLLAMA_BIN, '/opt/homebrew/bin/ollama', '/usr/local/bin/ollama', '/usr/bin/ollama']
  for (const p of candidates) {
    if (!p) continue
    try {
      if (fs.existsSync(p)) return p
    } catch { /* ignore */ }
  }
  return null
}

async function pingOllama(root: string): Promise<boolean> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 1500)
  try {
    const res = await fetch(`${root}/api/tags`, { signal: ctrl.signal })
    return res.ok
  } catch {
    return false
  } finally {
    clearTimeout(timer)
  }
}

/**
 * 按需启动情报专用 Ollama 实例：
 * 本机 :11434 常被知识库嵌入请求占满，生成请求会无限排队；独立实例只跑摘要模型。
 */
export async function ensureIntelModelServer(): Promise<{ ok: boolean; detail: string }> {
  const root = baseRoot(ensureState().config.localBaseUrl)
  if (await pingOllama(root)) return { ok: true, detail: root }
  if (!root.endsWith(`:${SIDECAR_PORT}`)) return { ok: false, detail: `${root} 不可用` }
  if (!sidecarStarting) {
    sidecarStarting = (async () => {
      const bin = ollamaBinary()
      if (!bin) return false
      try {
        sidecarProc = spawn(bin, ['serve'], {
          env: {
            ...process.env,
            OLLAMA_HOST: `127.0.0.1:${SIDECAR_PORT}`,
            OLLAMA_MAX_LOADED_MODELS: '1',
            OLLAMA_NUM_PARALLEL: '1'
          },
          stdio: 'ignore'
        })
        sidecarProc.on('exit', () => { sidecarProc = null })
        for (let i = 0; i < 30; i++) {
          await new Promise((r) => setTimeout(r, 500))
          if (await pingOllama(root)) return true
        }
        return false
      } catch (e) {
        console.warn('[intel] 情报专用本地模型启动失败', e)
        return false
      }
    })().finally(() => { sidecarStarting = null })
  }
  const ok = await sidecarStarting
  return { ok, detail: ok ? `已启动 ${root}` : '情报专用模型实例启动失败' }
}

export function stopIntelModelServer(): void {
  try {
    sidecarProc?.kill()
  } catch { /* ignore */ }
  sidecarProc = null
}

/* ---------- 凭据加密（safeStorage） ---------- */

function sealSecret(value: string): string {
  if (!value) return ''
  try {
    if (safeStorage.isEncryptionAvailable()) return `enc:${safeStorage.encryptString(value).toString('base64')}`
  } catch { /* ignore */ }
  return `plain:${value}`
}

function openSecret(value: string): string {
  if (!value) return ''
  if (value.startsWith('enc:')) {
    try {
      return safeStorage.decryptString(Buffer.from(value.slice(4), 'base64'))
    } catch {
      return ''
    }
  }
  return value.startsWith('plain:') ? value.slice(6) : value
}

/** 私密收藏自动识别：文件夹 / 标题 / URL 命中任一关键词即进加密库 */
const PRIVATE_KEYWORDS = [
  '私密', '隐私', '加密', '密码', '密钥', '密保', '私藏',
  '银行', '网银', '支付', '钱包', '账单', '工资', '社保', '公积金', '身份证', '护照', '合同', '发票',
  '病历', '体检', '医院', '健康档案', '处方',
  'private', 'secret', 'vault', 'password', 'passwd', 'bank', 'wallet', 'payment', 'paypal',
  'alipay', 'finance', 'invoice', 'medical', 'health', 'hospital', 'dating', 'adult', 'porn', 'xxx', 'onlyfans'
]

function privateHint(site: { title?: string; url?: string; folder?: string }): string | null {
  const hay = `${site.folder ?? ''} ${site.title ?? ''} ${site.url ?? ''}`.toLowerCase()
  for (const key of PRIVATE_KEYWORDS) {
    if (hay.includes(key)) return key
  }
  return null
}

/* ---------- 加密库（vault.json，data 为 safeStorage 密文） ---------- */

interface VaultFile {
  version: number
  count: number
  updatedAt: number
  data: string
}

function vaultFile(): string {
  return path.join(app.getPath('userData'), 'vault.json')
}

function readVault(): VaultSite[] {
  try {
    const file = vaultFile()
    if (!fs.existsSync(file)) return []
    const raw = JSON.parse(fs.readFileSync(file, 'utf-8')) as Partial<VaultFile>
    const list = JSON.parse(openSecret(String(raw.data ?? '')) || '[]') as VaultSite[]
    return Array.isArray(list) ? list : []
  } catch (e) {
    console.warn('[intel] 加密库解析失败', e)
    return []
  }
}

function writeVault(sites: VaultSite[]): void {
  try {
    const file = vaultFile()
    fs.mkdirSync(path.dirname(file), { recursive: true })
    const payload: VaultFile = {
      version: 1,
      count: sites.length,
      updatedAt: Date.now(),
      data: sealSecret(JSON.stringify(sites))
    }
    const tmp = `${file}.tmp`
    fs.writeFileSync(tmp, JSON.stringify(payload), 'utf-8')
    fs.renameSync(tmp, file)
  } catch (e) {
    console.warn('[intel] 加密库写入失败', e)
  }
}

function pushVault(sites: VaultSite[]): void {
  if (!sites.length) return
  const vault = readVault()
  const seen = new Set(vault.map((s) => s.url))
  let changed = false
  for (const site of sites) {
    if (seen.has(site.url)) continue
    seen.add(site.url)
    vault.push(site)
    changed = true
  }
  if (changed) writeVault(vault)
}

export function getVaultStatus(): VaultStatus {
  let updatedAt: number | undefined
  try {
    const file = vaultFile()
    if (fs.existsSync(file)) updatedAt = fs.statSync(file).mtimeMs
  } catch { /* ignore */ }
  return {
    count: readVault().length,
    encryption: safeStorage.isEncryptionAvailable() ? 'safeStorage' : 'plain',
    updatedAt
  }
}

/** 仅在用户主动「查看」时调用；渲染层收起即丢弃 */
export function listVaultSites(): VaultSite[] {
  return readVault()
}

export function removeVaultSite(id: string): VaultStatus {
  writeVault(readVault().filter((s) => s.id !== id))
  return getVaultStatus()
}

/** 关注列表 → 加密库（手动隐藏） */
export function hideWatchToVault(id: string): IntelState {
  const s = ensureState()
  const item = s.watch.find((w) => w.id === id)
  if (!item) return s
  pushVault([{
    id: genId('vault'),
    title: item.title,
    url: item.url,
    source: item.source,
    addedAt: Date.now(),
    reason: 'manual'
  }])
  s.watch = s.watch.filter((w) => w.id !== id)
  saveState()
  return s
}

/** 首次加载迁移：历史关注列表中的私密条目移入加密库，并清掉对应情报 */
let legacyWatchScanned = false
function migratePrivateWatch(s: IntelState): void {
  if (legacyWatchScanned) return
  legacyWatchScanned = true
  const priv = s.watch.filter((w) => privateHint(w))
  if (!priv.length) return
  const urls = new Set(priv.map((w) => w.url))
  pushVault(priv.map((w) => ({
    id: genId('vault'),
    title: w.title,
    url: w.url,
    source: w.source,
    addedAt: w.addedAt,
    reason: 'auto' as const
  })))
  s.watch = s.watch.filter((w) => !privateHint(w))
  s.items = s.items.filter((it) => !urls.has(it.url))
  saveState()
}

const DEFAULT_CONFIG: IntelConfig = {
  enabled: true,
  time: '08:30',
  model: 'qwen3.5:4b',
  localBaseUrl: 'http://127.0.0.1:11435/v1',
  autoIngest: false,
  maxPerScan: 30,
  providers: { local: true, weknora: false, memoryHub: false },
  weknora: { baseUrl: 'http://localhost', token: '', email: '', password: '', knowledgeId: '', ingestPath: '/api/v1/knowledge' },
  memoryHub: { baseUrl: 'http://localhost:8125', instanceId: '', userKey: '', teamId: '' }
}

function emptyState(): IntelState {
  return {
    config: { ...DEFAULT_CONFIG, providers: { ...DEFAULT_CONFIG.providers }, weknora: { ...DEFAULT_CONFIG.weknora }, memoryHub: { ...DEFAULT_CONFIG.memoryHub } },
    watch: [],
    items: [],
    usage: { runs: 0, calls: 0, tokens: 0, dispatch: {} },
    quota: { values: {}, note: '本机计量；厂商无 API 时由用户手动填写额度' }
  }
}

function storeFile(): string {
  return path.join(app.getPath('userData'), 'intel.json')
}

function mergeConfig(raw: Partial<IntelConfig> | undefined): IntelConfig {
  const r = raw ?? {}
  return {
    ...DEFAULT_CONFIG,
    ...r,
    providers: { ...DEFAULT_CONFIG.providers, ...(r.providers ?? {}) },
    weknora: { ...DEFAULT_CONFIG.weknora, ...(r.weknora ?? {}) },
    memoryHub: { ...DEFAULT_CONFIG.memoryHub, ...(r.memoryHub ?? {}) }
  }
}

function loadState(): IntelState {
  const base = emptyState()
  try {
    const file = storeFile()
    if (!fs.existsSync(file)) return base
    const raw = JSON.parse(fs.readFileSync(file, 'utf-8')) as Partial<IntelState>
    return {
      config: mergeConfig(raw.config),
      watch: Array.isArray(raw.watch) ? raw.watch : [],
      items: Array.isArray(raw.items) ? raw.items.slice(0, RETAIN_ITEMS) : [],
      usage: { ...base.usage, ...(raw.usage ?? {}), dispatch: { ...(raw.usage?.dispatch ?? {}) } },
      quota: { ...base.quota, ...(raw.quota ?? {}), values: { ...(raw.quota?.values ?? {}) } }
    }
  } catch (e) {
    console.warn('[intel] 读取失败，使用默认状态', e)
    return base
  }
}

function saveState(): void {
  if (!state) return
  try {
    const file = storeFile()
    fs.mkdirSync(path.dirname(file), { recursive: true })
    const tmp = `${file}.tmp`
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf-8')
    fs.renameSync(tmp, file)
  } catch (e) {
    console.warn('[intel] 写入失败', e)
  }
}

function ensureState(): IntelState {
  if (!state) {
    state = loadState()
    migratePrivateWatch(state)
  }
  return state
}

export function getIntelState(): IntelState {
  const s = ensureState()
  // 凭据不回传渲染层：AI 与界面只需要知道“填过”，编辑时留空即保留
  return {
    ...s,
    config: {
      ...s.config,
      weknora: { ...s.config.weknora, token: '', password: '' },
      memoryHub: { ...s.config.memoryHub, userKey: '' }
    }
  }
}

export function setIntelConfig(patch: Partial<IntelConfig>): IntelState {
  const s = ensureState()
  const nextWeKnora = { ...s.config.weknora, ...(patch.weknora ?? {}) }
  const nextMemoryHub = { ...s.config.memoryHub, ...(patch.memoryHub ?? {}) }
  // 空值 = 保留原凭据；非空 = 加密后落盘
  if (patch.weknora?.password) nextWeKnora.password = sealSecret(patch.weknora.password)
  else nextWeKnora.password = s.config.weknora.password
  if (patch.memoryHub?.userKey) nextMemoryHub.userKey = sealSecret(patch.memoryHub.userKey)
  else nextMemoryHub.userKey = s.config.memoryHub.userKey
  s.config = mergeConfig({
    ...s.config,
    ...patch,
    providers: { ...s.config.providers, ...(patch.providers ?? {}) },
    weknora: nextWeKnora,
    memoryHub: nextMemoryHub
  })
  saveState()
  return getIntelState()
}

export function setAgentQuota(agentId: string, value: number, note?: string): IntelState {
  const s = ensureState()
  s.quota.values[agentId] = Math.max(0, Math.round(Number(value) || 0))
  if (typeof note === 'string') s.quota.note = note
  s.quota.updatedAt = Date.now()
  saveState()
  return s
}

export function recordAgentRun(agentId: string, calls: number, tokens: number): void {
  const s = ensureState()
  const prev = s.usage.dispatch[agentId] ?? { calls: 0, tokens: 0 }
  s.usage.dispatch[agentId] = { calls: prev.calls + calls, tokens: prev.tokens + tokens, lastAt: Date.now() }
  saveState()
}

/* ---------- Chromium 书签 ---------- */

function chromiumRoots(): { key: string; browser: string; root: string }[] {
  const home = os.homedir()
  const appData = process.env.APPDATA ?? path.join(home, 'AppData', 'Roaming')
  const localAppData = process.env.LOCALAPPDATA ?? path.join(home, 'AppData', 'Local')
  if (process.platform === 'darwin') {
    const base = path.join(home, 'Library', 'Application Support')
    return [
      { key: 'chrome', browser: 'Chrome', root: path.join(base, 'Google', 'Chrome') },
      { key: 'chrome-beta', browser: 'Chrome Beta', root: path.join(base, 'Google', 'Chrome Beta') },
      { key: 'edge', browser: 'Edge', root: path.join(base, 'Microsoft Edge') },
      { key: 'brave', browser: 'Brave', root: path.join(base, 'BraveSoftware', 'Brave-Browser') },
      { key: 'chromium', browser: 'Chromium', root: path.join(base, 'Chromium') },
      { key: 'tabbit', browser: 'Tabbit', root: path.join(base, 'Tabbit Browser') }
    ]
  }
  if (process.platform === 'win32') {
    return [
      { key: 'chrome', browser: 'Chrome', root: path.join(localAppData, 'Google', 'Chrome', 'User Data') },
      { key: 'edge', browser: 'Edge', root: path.join(localAppData, 'Microsoft', 'Edge', 'User Data') },
      { key: 'brave', browser: 'Brave', root: path.join(localAppData, 'BraveSoftware', 'Brave-Browser', 'User Data') },
      { key: 'chromium', browser: 'Chromium', root: path.join(localAppData, 'Chromium', 'User Data') }
    ]
  }
  const config = process.env.XDG_CONFIG_HOME ?? path.join(home, '.config')
  return [
    { key: 'chrome', browser: 'Chrome', root: path.join(config, 'google-chrome') },
    { key: 'edge', browser: 'Edge', root: path.join(config, 'microsoft-edge') },
    { key: 'brave', browser: 'Brave', root: path.join(config, 'BraveSoftware', 'Brave-Browser') },
    { key: 'chromium', browser: 'Chromium', root: path.join(config, 'chromium') }
  ]
}

interface RawNode {
  type?: string
  name?: string
  url?: string
  children?: RawNode[]
}

function walkBookmarks(node: RawNode, folder: string, browser: string, profile: string, sourceId: string, out: BookmarkSite[]): void {
  if (!node) return
  if (node.type === 'url' && node.url && /^https?:\/\//i.test(node.url)) {
    out.push({
      id: crypto.createHash('sha1').update(`${sourceId}|${node.url}`).digest('hex').slice(0, 16),
      title: node.name || node.url,
      url: node.url,
      folder: folder || '根目录',
      browser,
      profile,
      sourceId
    })
    return
  }
  if (node.children) {
    const next = node.name && node.type === 'folder' ? (folder ? `${folder}/${node.name}` : node.name) : folder
    node.children.forEach((child) => walkBookmarks(child, next, browser, profile, sourceId, out))
  }
}

function readBookmarks(file: string, browser: string, profile: string, sourceId: string): BookmarkSite[] {
  const raw = JSON.parse(fs.readFileSync(file, 'utf-8')) as { roots?: Record<string, RawNode> }
  const out: BookmarkSite[] = []
  const seen = new Set<string>()
  Object.entries(raw.roots ?? {}).forEach(([rootKey, root]) => {
    const start = rootKey === 'bookmark_bar' ? '' : rootKey === 'other' ? '其他书签' : rootKey === 'synced' ? '移动设备' : rootKey
    walkBookmarks(root, start, browser, profile, sourceId, out)
  })
  return out.filter((s) => (seen.has(s.url) ? false : (seen.add(s.url), true)))
}

function discoverBookmarks(): { sources: BookmarkSource[]; sites: Map<string, BookmarkSite[]> } {
  const now = Date.now()
  if (siteCache && now - siteCache.at < 5000) return siteCache
  const sources: BookmarkSource[] = []
  const sites = new Map<string, BookmarkSite[]>()
  chromiumRoots().forEach((def) => {
    if (!fs.existsSync(def.root)) return
    let profiles: string[] = []
    try {
      profiles = fs.readdirSync(def.root, { withFileTypes: true })
        .filter((d) => d.isDirectory() && (d.name === 'Default' || d.name.startsWith('Profile ') || d.name === 'Guest Profile'))
        .map((d) => d.name)
    } catch { return }
    profiles.forEach((profile) => {
      const file = path.join(def.root, profile, 'Bookmarks')
      if (!fs.existsSync(file)) return
      try {
        const list = readBookmarks(file, def.browser, profile, `${def.key}:${profile}`)
        if (!list.length) return
        const sourceId = `${def.key}:${profile}`
        const folderSet = new Set(list.map((s) => s.folder).filter((f) => f && f !== '根目录'))
        const stat = fs.statSync(file)
        sources.push({
          id: sourceId,
          browser: def.browser,
          profile,
          path: file,
          count: list.length,
          folders: folderSet.size,
          lastModified: stat.mtimeMs,
          exists: true
        })
        sites.set(sourceId, list)
      } catch (e) {
        console.warn('[intel] 书签解析失败', file, e)
      }
    })
  })
  siteCache = { at: now, sources, sites }
  return siteCache
}

export function listBookmarkSources(): BookmarkSource[] {
  return discoverBookmarks().sources
}

export function listBookmarkSites(sourceId: string, limit = 500): BookmarkSite[] {
  const list = discoverBookmarks().sites.get(sourceId) ?? []
  return list.slice(0, Math.max(1, Math.min(2000, limit)))
}

export function importBookmarkSource(sourceId: string, limit = 20): IntelState {
  const s = ensureState()
  const sites = listBookmarkSites(sourceId, limit)
  const existing = new Set(s.watch.map((w) => w.url))
  const vaultSites: VaultSite[] = []
  sites.forEach((site) => {
    if (existing.has(site.url)) return
    existing.add(site.url)
    const source = `${site.browser} · ${site.profile}`
    if (privateHint(site)) {
      vaultSites.push({
        id: genId('vault'),
        title: site.title,
        url: site.url,
        source,
        folder: site.folder,
        addedAt: Date.now(),
        reason: 'auto'
      })
      return
    }
    s.watch.push({
      id: genId('watch'),
      title: site.title,
      url: site.url,
      source,
      addedAt: Date.now(),
      enabled: true
    })
  })
  pushVault(vaultSites)
  saveState()
  return s
}

export function addIntelWatch(url: string, title?: string): IntelState {
  const s = ensureState()
  const normalized = normalizeUrl(url)
  if (!normalized) throw new Error('请输入 http/https 网址')
  if (s.watch.some((w) => w.url === normalized)) return s
  const displayTitle = (title || '').trim() || normalized.replace(/^https?:\/\//, '').split('/')[0]
  if (privateHint({ title: displayTitle, url: normalized })) {
    pushVault([{
      id: genId('vault'),
      title: displayTitle,
      url: normalized,
      source: '手动收藏',
      addedAt: Date.now(),
      reason: 'auto'
    }])
    return s
  }
  s.watch.push({
    id: genId('watch'),
    title: displayTitle,
    url: normalized,
    source: '手动收藏',
    addedAt: Date.now(),
    enabled: true
  })
  saveState()
  return s
}

export function removeIntelWatch(id: string): IntelState {
  const s = ensureState()
  s.watch = s.watch.filter((w) => w.id !== id)
  saveState()
  return s
}

function normalizeUrl(input: string): string | null {
  const value = input.trim()
  if (!value) return null
  const withProto = /^https?:\/\//i.test(value) ? value : `https://${value}`
  try {
    const u = new URL(withProto)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
    return u.toString()
  } catch {
    return null
  }
}

/* ---------- 抓取与摘要 ---------- */

const ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', hellip: '…', mdash: '—', ndash: '–', middot: '·'
}

function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&([a-z]+);/gi, (m, k) => ENTITIES[String(k).toLowerCase()] ?? m)
}

function extractText(html: string): { title: string; text: string } {
  const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)
  const title = decodeEntities((titleMatch?.[1] ?? '').replace(/\s+/g, ' ').trim())
  let body = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<svg[\s\S]*?<\/svg>/gi, ' ')
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, ' ')
    .replace(/<nav[\s\S]*?<\/nav>/gi, ' ')
    .replace(/<header[\s\S]*?<\/header>/gi, ' ')
    .replace(/<footer[\s\S]*?<\/footer>/gi, ' ')
    .replace(/<form[\s\S]*?<\/form>/gi, ' ')
  const article = /<article[^>]*>([\s\S]*?)<\/article>/i.exec(body) ?? /<main[^>]*>([\s\S]*?)<\/main>/i.exec(body)
  if (article?.[1]) body = article[1]
  else body = /<body[^>]*>([\s\S]*?)<\/body>/i.exec(body)?.[1] ?? body
  const text = decodeEntities(
    body
      .replace(/<(br|\/p|\/div|\/h[1-6]|\/li|\/tr|\/section|\/article)[^>]*>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
  )
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  return { title, text: text.slice(0, 12000) }
}

export async function fetchPage(url: string): Promise<{ html: string; finalUrl: string }> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS)
  try {
    const resp = await fetch(url, {
      signal: ctrl.signal,
      redirect: 'follow',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) WorkOnIntel/1.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8'
      }
    })
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
    const buf = Buffer.from(await resp.arrayBuffer())
    return { html: buf.subarray(0, MAX_PAGE_BYTES).toString('utf-8'), finalUrl: resp.url || url }
  } finally {
    clearTimeout(timer)
  }
}

function hashText(text: string): string {
  return crypto.createHash('sha256').update(text).digest('hex').slice(0, 24)
}

function extractJson(text: string): { summary?: string; tags?: string[] } | null {
  const cleaned = text.replace(/```json/gi, '```').replace(/```/g, '').trim()
  const start = cleaned.indexOf('{')
  const end = cleaned.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try {
    return JSON.parse(cleaned.slice(start, end + 1)) as { summary?: string; tags?: string[] }
  } catch {
    return null
  }
}

async function summarizeWithLocal(title: string, url: string, text: string): Promise<{ summary: string; tags: string[]; tokens: number; error?: string }> {
  const s = ensureState()
  const root = s.config.localBaseUrl.replace(/\/v1\/?$/, '').replace(/\/$/, '')
  const prompt = `标题：${title}\n网址：${url}\n正文：\n${text.slice(0, 7000)}`
  const system = '你是 WorkOn 的情报分析助手。只输出 JSON，格式为 {"summary":"不超过120字的中文摘要","tags":["标签1","标签2"]}。不要输出 markdown。'
  const errors: string[] = []
  if (root && s.config.model) {
    if (root.endsWith(`:${SIDECAR_PORT}`)) {
      const srv = await ensureIntelModelServer()
      if (!srv.ok) errors.push(`本地模型：${srv.detail}`)
    }
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 45_000)
    try {
      // Ollama 原生接口：显式收窄 num_ctx，避免 262k 上下文把机器拖死
      const resp = await fetch(`${root}/api/chat`, {
        method: 'POST',
        signal: ctrl.signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: s.config.model,
          stream: false,
          think: false,
          messages: [{ role: 'system', content: system }, { role: 'user', content: prompt }],
          options: { num_ctx: 8192, num_predict: 400, temperature: 0.2 }
        })
      })
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
      const json = (await resp.json()) as {
        message?: { content?: string }
        prompt_eval_count?: number
        eval_count?: number
      }
      const content = json.message?.content ?? ''
      const parsed = extractJson(content)
      const summary = (parsed?.summary ?? content).replace(/\s+/g, ' ').trim().slice(0, 400)
      const tags = Array.isArray(parsed?.tags) ? parsed!.tags!.map((t) => String(t).slice(0, 16)).slice(0, 6) : []
      if (!summary) throw new Error('模型返回为空')
      return { summary, tags, tokens: (json.prompt_eval_count ?? 0) + (json.eval_count ?? 0) }
    } catch (e) {
      errors.push(`本地模型：${(e as Error).message}`)
    } finally {
      clearTimeout(timer)
    }
  } else {
    errors.push('本地模型未配置')
  }

  // 本地模型不可用时，回退到用户已配置的 OpenAI 兼容模型（不额外收集本地网页）
  try {
    const cloud = await llmChat([
      { role: 'system', content: system },
      { role: 'user', content: prompt }
    ], 45_000, 'fast')
    if (cloud) {
      const parsed = extractJson(cloud)
      const summary = (parsed?.summary ?? cloud).replace(/\s+/g, ' ').trim().slice(0, 400)
      const tags = Array.isArray(parsed?.tags) ? parsed!.tags!.map((t) => String(t).slice(0, 16)).slice(0, 6) : []
      if (summary) return { summary, tags, tokens: 0, error: `已回退云端模型（${errors.join('；')}）` }
    }
  } catch { /* ignore */ }

  // 最后兜底：抽取式摘要，保证情报流不被模型故障卡死
  const sentences = text.replace(/\s+/g, ' ').split(/(?<=[。！？.!?])\s+/).filter(Boolean).slice(0, 2).join(' ')
  return {
    summary: (sentences || text).slice(0, 240),
    tags: [],
    tokens: 0,
    error: `摘要降级为抽取式（${errors.join('；') || '模型不可用'}）`
  }
}

function emptyIngested() {
  return { local: false, weknora: false, memoryHub: false }
}

/** Super Agent 专用只读抓取：不写关注列表、情报库或知识库。 */
export async function readIntelPage(url: string): Promise<{ title: string; url: string; text: string }> {
  const page = await fetchPage(url)
  const extracted = extractText(page.html)
  return { title: extracted.title, url: page.finalUrl, text: extracted.text }
}

export async function runIntelScan(): Promise<{ ok: boolean; result?: IntelScanResult; error?: string }> {
  const s = ensureState()
  if (scanning) return { ok: false, error: '正在抓取，请稍候' }
  const watch = s.watch.filter((w) => w.enabled).slice(0, Math.max(1, Math.min(100, s.config.maxPerScan || 30)))
  if (!watch.length) return { ok: false, error: '关注列表为空：先从 Chrome / Edge 书签导入，或手动添加网址' }
  scanning = true
  let added = 0
  let updated = 0
  let unchanged = 0
  let errors = 0
  let summaryTokens = 0
  try {
    for (const site of watch) {
      try {
        const page = await fetchPage(site.url)
        const extracted = extractText(page.html)
        const title = extracted.title || site.title
        const text = extracted.text || title
        const hash = hashText(text)
        const existing = s.items.find((i) => i.url === site.url)
        if (existing && existing.hash === hash) {
          existing.fetchedAt = Date.now()
          existing.status = 'unchanged'
          unchanged++
          continue
        }
        const summary = await summarizeWithLocal(title, site.url, text)
        summaryTokens += summary.tokens || 0
        if (summary.error) errors++
        const now = Date.now()
        const item: IntelItem = existing ?? {
          id: genId('intel'),
          title,
          url: site.url,
          source: site.source,
          summary: summary.summary,
          tags: summary.tags,
          hash,
          fetchedAt: now,
          createdAt: now,
          status: 'new',
          ingested: emptyIngested()
        }
        item.title = title
        item.summary = summary.summary
        item.tags = summary.tags
        item.hash = hash
        item.fetchedAt = now
        item.tokens = summary.tokens
        item.excerpt = text.slice(0, 1200)
        item.status = existing ? 'updated' : 'new'
        item.error = summary.error
        item.ingested = emptyIngested()
        if (!existing) s.items.unshift(item)
        if (existing) updated++
        else added++
        if (s.config.autoIngest) {
          for (const p of ['local', 'weknora', 'memoryHub'] as IntelProvider[]) {
            if (!s.config.providers[p]) continue
            try {
              await ingestItem(item, p, false)
            } catch (e) {
              item.ingested.errors = { ...(item.ingested.errors ?? {}), [p]: (e as Error).message }
              errors++
            }
          }
        }
      } catch (e) {
        errors++
        const now = Date.now()
        const existing = s.items.find((i) => i.url === site.url)
        const item: IntelItem = existing ?? {
          id: genId('intel'),
          title: site.title,
          url: site.url,
          source: site.source,
          summary: '',
          tags: [],
          hash: '',
          fetchedAt: now,
          createdAt: now,
          status: 'error',
          ingested: emptyIngested()
        }
        item.status = 'error'
        item.error = (e as Error).message
        item.summary = `抓取失败：${item.error}`
        item.fetchedAt = now
        if (!existing) s.items.unshift(item)
      }
    }
    s.items.sort((a, b) => b.fetchedAt - a.fetchedAt)
    if (s.items.length > RETAIN_ITEMS) s.items = s.items.slice(0, RETAIN_ITEMS)
    s.usage.runs++
    s.usage.calls += watch.length
    s.usage.tokens += summaryTokens
    s.usage.lastRunAt = Date.now()
    s.usage.lastRunDay = localDateKey(new Date())
    s.usage.lastError = errors ? `${errors} 个错误` : undefined
    saveState()
    return { ok: true, result: { added, updated, unchanged, errors, items: s.items.slice(0, 30) } }
  } catch (e) {
    s.usage.lastError = (e as Error).message
    saveState()
    return { ok: false, error: (e as Error).message }
  } finally {
    scanning = false
  }
}

function localDateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/* ---------- 知识入库 ---------- */

/** WeKnora 登录续签：token 24h 过期，账号密码只在主进程解密使用 */
async function weknoraLogin(cfg: IntelState['config']['weknora']): Promise<string> {
  const password = openSecret(cfg.password)
  if (!cfg.email || !password) return ''
  const res = await fetch(`${cfg.baseUrl.replace(/\/$/, '')}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: cfg.email, password })
  })
  const json = (await res.json().catch(() => ({}))) as { token?: string; message?: string }
  if (!res.ok || !json.token) throw new Error(`WeKnora 登录失败：${json.message ?? `HTTP ${res.status}`}`)
  cfg.token = json.token
  saveState()
  return json.token
}

async function weknoraRequest(
  cfg: IntelState['config']['weknora'],
  path: string,
  init: { method?: string; body?: string } = {},
  retried = false
): Promise<Response> {
  const token = cfg.token || (await weknoraLogin(cfg))
  if (!token) throw new Error('WeKnora 未配置 token 或账号密码')
  const res = await fetch(`${cfg.baseUrl.replace(/\/$/, '')}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }
  })
  if (res.status === 401 && !retried) {
    const fresh = await weknoraLogin(cfg)
    if (fresh) return weknoraRequest(cfg, path, init, true)
  }
  return res
}

/** 未指定知识库时：优先同名库，其次第一个库，最后自动创建一个 */
async function ensureWeKnoraKb(cfg: IntelState['config']['weknora']): Promise<string> {
  if (cfg.knowledgeId) return cfg.knowledgeId
  const listRes = await weknoraRequest(cfg, '/api/v1/knowledge-bases')
  if (listRes.ok) {
    const json = (await listRes.json().catch(() => ({}))) as { data?: { id?: string; name?: string }[] }
    const list = Array.isArray(json.data) ? json.data : []
    const hit = list.find((k) => k.name === 'WorkOn 情报') ?? list[0]
    if (hit?.id) {
      cfg.knowledgeId = hit.id
      saveState()
      return hit.id
    }
  }
  const created = await weknoraRequest(cfg, '/api/v1/knowledge-bases', {
    method: 'POST',
    body: JSON.stringify({ name: 'WorkOn 情报' })
  })
  const json = (await created.json().catch(() => ({}))) as { data?: { id?: string }; message?: string }
  const id = json.data?.id
  if (!created.ok || !id) throw new Error(`WeKnora 建库失败：${json.message ?? `HTTP ${created.status}`}`)
  cfg.knowledgeId = id
  saveState()
  return id
}

async function ingestItem(item: IntelItem, target: IntelProvider, persist = true): Promise<void> {
  const s = ensureState()
  const content = `${item.summary}\n\n来源：${item.url}\n抓取时间：${new Date(item.fetchedAt).toLocaleString('zh-CN')}`
  if (target === 'local') {
    if (!item.ingested.local) {
      insertInto<KnowledgeItem>('knowledge', {
        id: genId('kb'),
        title: item.title,
        body: content,
        kind: 'unstructured',
        source: 'ai-tool',
        links: [],
        tags: item.tags,
        fileName: item.url,
        sedimentedAt: Date.now(),
        ts: Date.now()
      })
      item.ingested.local = true
    }
  } else if (target === 'weknora') {
    const cfg = s.config.weknora
    if (!cfg.baseUrl) throw new Error('WeKnora 未配置 baseUrl')
    const kbId = await ensureWeKnoraKb(cfg)
    const resp = await weknoraRequest(cfg, `/api/v1/knowledge-bases/${encodeURIComponent(kbId)}/knowledge/manual`, {
      method: 'POST',
      body: JSON.stringify({ title: item.title, content, status: 'publish' })
    })
    if (!resp.ok) {
      const body = (await resp.text().catch(() => '')).slice(0, 200)
      throw new Error(`WeKnora HTTP ${resp.status} ${body}`)
    }
    item.ingested.weknora = true
  } else {
    const cfg = s.config.memoryHub
    const userKey = openSecret(cfg.userKey)
    if (!cfg.baseUrl || !cfg.instanceId || !userKey || !cfg.teamId) {
      throw new Error('Memory Hub 需配置 instanceId / userKey / teamId')
    }
    const headers = {
      'Content-Type': 'application/json',
      'X-Tdai-Service-Id': cfg.instanceId,
      'X-Tdai-User-Key': userKey
    }
    const base = cfg.baseUrl.replace(/\/$/, '')
    const created = await fetch(`${base}/api/v1/knowledge/wiki/create`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ team_id: cfg.teamId, name: item.title, source_url: item.url, source_type: 'url' })
    })
    const createdJson = (await created.json().catch(() => ({}))) as { code?: number; message?: string; data?: { wiki_id?: string } }
    if (!created.ok || (createdJson.code !== undefined && createdJson.code !== 0)) {
      throw new Error(`Memory Hub HTTP ${created.status} ${createdJson.message ?? ''}`)
    }
    const wikiId = createdJson.data?.wiki_id
    if (!wikiId) throw new Error('Memory Hub 未返回 wiki_id')
    // 复合接口：写 raw（base64）+ 触发 ingest；只建空 wiki 会报 WIKI_EMPTY_NO_SOURCES
    const filename = `${item.title.replace(/[\\/:*?"<>|]/g, '_').slice(0, 60) || 'intel'}.md`
    const ingested = await fetch(`${base}/api/v1/knowledge/wiki/import-and-ingest`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        wiki_id: wikiId,
        mode: 'markdown',
        files: [{ filename, content: Buffer.from(content, 'utf-8').toString('base64') }]
      })
    })
    const ingestedJson = (await ingested.json().catch(() => ({}))) as { code?: number; message?: string; data?: { ok?: boolean; error_message?: string } }
    if (!ingested.ok || (ingestedJson.code !== undefined && ingestedJson.code !== 0) || ingestedJson.data?.ok === false) {
      throw new Error(`Memory Hub 入库失败：${ingestedJson.data?.error_message ?? ingestedJson.message ?? `HTTP ${ingested.status}`}`)
    }
    item.ingested.memoryHub = true
  }
  item.ingested.errors = { ...(item.ingested.errors ?? {}) }
  delete item.ingested.errors[target]
  if (persist) saveState()
}

export async function ingestIntel(id: string, target: IntelProvider): Promise<{ ok: boolean; item?: IntelItem; error?: string }> {
  const s = ensureState()
  const item = s.items.find((i) => i.id === id)
  if (!item) return { ok: false, error: '情报不存在' }
  try {
    await ingestItem(item, target)
    saveState()
    return { ok: true, item }
  } catch (e) {
    item.ingested.errors = { ...(item.ingested.errors ?? {}), [target]: (e as Error).message }
    saveState()
    return { ok: false, item, error: (e as Error).message }
  }
}

/* ---------- 服务状态 ---------- */

export async function checkIntelProviders(): Promise<ProviderStatus[]> {
  const s = ensureState()
  const result: ProviderStatus[] = []
  {
    const started = Date.now()
    try {
      const root = s.config.localBaseUrl.replace(/\/v1\/?$/, '').replace(/\/$/, '')
      const resp = await fetch(`${root}/api/tags`, { signal: AbortSignal.timeout(2500) })
      const json = (await resp.json()) as { models?: { name?: string }[] }
      const names = (json.models ?? []).map((m) => m.name ?? '')
      const ok = resp.ok && names.some((n) => n.startsWith(s.config.model))
      const dedicated = root.endsWith(`:${SIDECAR_PORT}`)
      result.push({
        id: 'local',
        name: '本地模型',
        ok,
        detail: ok ? `${s.config.model} 已注册 · ${root}${dedicated ? '（情报专用）' : ''}` : `未找到 ${s.config.model} · ${root}`,
        latencyMs: Date.now() - started
      })
    } catch (e) {
      const root = s.config.localBaseUrl.replace(/\/v1\/?$/, '').replace(/\/$/, '')
      result.push({
        id: 'local',
        name: '本地模型',
        ok: false,
        detail: root.endsWith(`:${SIDECAR_PORT}`)
          ? '情报专用实例未启动 · 首次抓取时自动启动'
          : `Ollama 不可用：${(e as Error).message}`
      })
    }
  }
  for (const target of ['weknora', 'memoryHub'] as IntelProvider[]) {
    const started = Date.now()
    if (target === 'weknora') {
      const cfg = s.config.weknora
      try {
        const token = cfg.token || (await weknoraLogin(cfg))
        if (!token) throw new Error('未配置 token / 账号密码')
        const resp = await fetch(`${cfg.baseUrl.replace(/\/$/, '')}/api/v1/auth/validate`, {
          headers: { Authorization: `Bearer ${token}` },
          signal: AbortSignal.timeout(2500)
        })
        result.push({
          id: target,
          name: 'WeKnora',
          ok: resp.ok,
          detail: resp.ok ? `登录有效${cfg.knowledgeId ? ' · 知识库已选' : ' · 首次入库自动建库'}` : `HTTP ${resp.status}`,
          latencyMs: Date.now() - started
        })
      } catch (e) {
        result.push({ id: target, name: 'WeKnora', ok: false, detail: `不可用：${(e as Error).message}` })
      }
      continue
    }
    const cfg = s.config.memoryHub
    try {
      const resp = await fetch(`${cfg.baseUrl.replace(/\/$/, '')}/health`, { signal: AbortSignal.timeout(2500) })
      const extra = s.config.memoryHub.instanceId && s.config.memoryHub.userKey ? '实例凭据已配置' : '缺实例凭据'
      result.push({
        id: target,
        name: 'Memory Hub',
        ok: resp.ok,
        detail: `${resp.ok ? '健康' : `HTTP ${resp.status}`} · ${extra}`,
        latencyMs: Date.now() - started
      })
    } catch (e) {
      result.push({ id: target, name: 'Memory Hub', ok: false, detail: `不可用：${(e as Error).message}` })
    }
  }
  return result
}

/* ---------- 定时任务 ---------- */

export function initIntelScheduler(): void {
  ensureState()
  if (scheduler) clearInterval(scheduler)
  scheduler = setInterval(() => {
    const s = ensureState()
    if (!s.config.enabled || scanning || !s.watch.length) return
    const now = new Date()
    const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
    if (hhmm !== s.config.time) return
    const day = localDateKey(now)
    if (s.usage.lastRunDay === day) return
    s.usage.lastRunDay = day
    saveState()
    void runIntelScan()
  }, 30_000)
}
