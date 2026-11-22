/**
 * 盯守调度：多盯点独立增量处理
 *
 * - 任务拆成多个盯点（每个源一个），各自有周期、到期时间与已读游标
 * - 控制面一次只处理一个到点的盯点，处理完再等下一次 tick；不打包成整点批量任务
 * - 网页源按 URL 去重；浏览器源（抖音等需登录站点）读当前页面作品列表，首次读档回填
 * - 新发现可路由到知识库 / 偏好画像 / 今日计划 / 项目 / 工作流
 * - 抓取失败按 2^n 退避，单点失败不影响其他盯点
 */
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { app, BrowserWindow } from 'electron'
import { genId } from '@shared/types'
import type { KnowledgeItem, PlanItem } from '@shared/types'
import type {
  WatchFinding,
  WatchPointSpec,
  WatchPointState,
  WatchSinks,
  WatchSnapshot,
  WatchSourceKind,
  WatchTask
} from '@shared/watch'
import {
  WATCH_MAX_POINTS,
  WATCH_RETAIN_FINDINGS,
  WATCH_RETAIN_SEEN,
  defaultWatchSinks
} from '@shared/watch'
import { dateKey } from '@shared/trail'
import { col, insertInto } from './db'
import { fetchPage } from './intel'
import { pushNotify } from './notify'
import { addWatchInterests } from './persona'
import { sendTo } from './windows'

interface StoredPoint extends WatchPointState {
  /** 已读 URL 的哈希（只保留最近若干条） */
  seenHashes: string[]
}

interface StoredTask extends Omit<WatchTask, 'points'> {
  points: StoredPoint[]
}

interface Store {
  tasks: StoredTask[]
  findings: WatchFinding[]
}

export interface CreateWatchInput {
  title?: string
  intent?: string
  intervalMin?: number
  points: WatchPointSpec[]
  sourceKind?: WatchSourceKind
  sourceLabel?: string
  sinks?: Partial<WatchSinks>
}

const TICK_MS = 10_000
const DEFAULT_INTERVAL_MIN = 60
const MIN_INTERVAL_MIN = 5
const MAX_TITLE = 120
const MAX_NEW_PER_CHECK = 8
const MAX_BACKFILL = 20
const MAX_LINKS_SCAN = 400
const MAX_BACKOFF_MS = 6 * 60 * 60 * 1000

const NOISE = /^(首页|上一页|下一页|更多|登录|注册|关于|关于我们|联系我们|广告|下载|客户端|app|网站地图|rss|订阅|搜索|评论|分享|查看详情|阅读全文)$/i

const STOP_WORDS = new Set([
  '这个', '那个', '我们', '你们', '他们', '什么', '怎么', '视频', '抖音', '一个', '可以',
  '没有', '就是', '还是', '真的', '今天', '每天', '以及', '因为', '所以', '如果', '但是',
  '然后', '自己', '分享', '推荐', '收藏', '喜欢', '作品', '发布', '合集', '全部', '展开'
])

const ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', hellip: '…',
  mdash: '—', ndash: '–', middot: '·', laquo: '«', raquo: '»'
}

let store: Store | null = null
let timer: NodeJS.Timeout | null = null
let busy = false

function storeFile(): string {
  return path.join(app.getPath('userData'), 'watch.json')
}

function normalizeTask(t: StoredTask): StoredTask {
  return {
    ...t,
    status: t.status === 'paused' ? 'paused' : 'active',
    sourceKind: t.sourceKind === 'browser-page' ? 'browser-page' : 'web-links',
    sinks: defaultWatchSinks(t.sinks),
    points: Array.isArray(t.points) ? t.points : [],
    findingsCount: Number(t.findingsCount) || 0
  }
}

function ensureStore(): Store {
  if (store) return store
  try {
    const raw = JSON.parse(fs.readFileSync(storeFile(), 'utf-8')) as Partial<Store>
    store = {
      tasks: Array.isArray(raw.tasks) ? (raw.tasks as StoredTask[]).map(normalizeTask) : [],
      findings: Array.isArray(raw.findings)
        ? (raw.findings as WatchFinding[]).slice(0, WATCH_RETAIN_FINDINGS)
        : []
    }
  } catch {
    store = { tasks: [], findings: [] }
  }
  return store
}

function save(): void {
  const s = ensureStore()
  try {
    fs.mkdirSync(path.dirname(storeFile()), { recursive: true })
    const tmp = `${storeFile()}.tmp`
    fs.writeFileSync(tmp, JSON.stringify(s, null, 2), 'utf-8')
    fs.renameSync(tmp, storeFile())
  } catch (e) {
    console.warn('[watch] 保存失败', (e as Error).message)
  }
}

function notifyChanged(taskId?: string): void {
  sendTo('main', 'watch:changed', taskId ? { taskId } : {})
}

function toPublic(t: StoredTask): WatchTask {
  return {
    id: t.id,
    title: t.title,
    intent: t.intent,
    status: t.status,
    sourceKind: t.sourceKind,
    sourceLabel: t.sourceLabel,
    sinks: t.sinks,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
    findingsCount: t.findingsCount,
    latest: t.latest,
    points: t.points.map((p) => ({
      id: p.id,
      url: p.url,
      label: p.label,
      intervalMin: p.intervalMin,
      nextDueAt: p.nextDueAt,
      lastCheckedAt: p.lastCheckedAt,
      lastChangedAt: p.lastChangedAt,
      lastError: p.lastError,
      failures: p.failures,
      seenCount: p.seenCount,
      baselineAt: p.baselineAt
    }))
  }
}

export function normalizeWatchUrl(input: string): string | null {
  const value = String(input ?? '').trim()
  if (!value) return null
  const withProto = /^https?:\/\//i.test(value) ? value : `https://${value}`
  try {
    const u = new URL(withProto)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
    if (!u.hostname) return null
    return u.toString()
  } catch {
    return null
  }
}

function hostLabel(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

function clampInterval(value?: number): number {
  const n = Number(value)
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_INTERVAL_MIN
  return Math.min(24 * 60, Math.max(MIN_INTERVAL_MIN, Math.round(n)))
}

export function createWatchTask(input: CreateWatchInput): WatchTask {
  const now = Date.now()
  const intervalMin = clampInterval(input.intervalMin)
  const seen = new Set<string>()
  const points: StoredPoint[] = []
  for (const raw of Array.isArray(input.points) ? input.points : []) {
    const url = normalizeWatchUrl(raw?.url ?? '')
    if (!url || seen.has(url)) continue
    seen.add(url)
    points.push({
      id: genId('wp'),
      url,
      label: String(raw.label ?? '').trim().slice(0, 40) || hostLabel(url),
      intervalMin,
      // 初始到期时间错开，避免新建后所有盯点同一秒抓取
      nextDueAt: now + 3_000 + points.length * 8_000,
      failures: 0,
      seenCount: 0,
      seenHashes: []
    })
    if (points.length >= WATCH_MAX_POINTS) break
  }
  if (!points.length) throw new Error('至少需要一个可访问的网址')
  const task: StoredTask = {
    id: genId('watch'),
    title: String(input.title ?? '').trim().slice(0, 40) || `${hostLabel(points[0].url)} 盯守`,
    intent: String(input.intent ?? '').slice(0, 400),
    status: 'active',
    sourceKind: input.sourceKind === 'browser-page' ? 'browser-page' : 'web-links',
    sourceLabel: String(input.sourceLabel ?? '').trim().slice(0, 60) || undefined,
    sinks: defaultWatchSinks(input.sinks),
    points,
    createdAt: now,
    updatedAt: now,
    findingsCount: 0
  }
  const s = ensureStore()
  s.tasks.unshift(task)
  save()
  notifyChanged(task.id)
  return toPublic(task)
}

export function patchWatchTask(
  id: string,
  patch: { status?: 'active' | 'paused'; intervalMin?: number }
): WatchTask | null {
  const task = ensureStore().tasks.find((t) => t.id === id)
  if (!task) return null
  const now = Date.now()
  if (patch.status === 'active' || patch.status === 'paused') {
    task.status = patch.status
    if (patch.status === 'active') {
      task.points.forEach((p, i) => {
        p.nextDueAt = now + 3_000 + i * 5_000
        p.failures = 0
      })
    }
  }
  if (patch.intervalMin != null) {
    const min = clampInterval(patch.intervalMin)
    task.points.forEach((p, i) => {
      p.intervalMin = min
      p.nextDueAt = now + 3_000 + i * 5_000
    })
  }
  task.updatedAt = now
  save()
  notifyChanged(id)
  return toPublic(task)
}

export function removeWatchTask(id: string): boolean {
  const s = ensureStore()
  const before = s.tasks.length
  s.tasks = s.tasks.filter((t) => t.id !== id)
  if (s.tasks.length === before) return false
  s.findings = s.findings.filter((f) => f.taskId !== id)
  save()
  notifyChanged(id)
  return true
}

export function listWatchSnapshot(): WatchSnapshot {
  const s = ensureStore()
  return {
    tasks: s.tasks.map(toPublic),
    recent: s.findings.slice(0, 50)
  }
}

/* ---------- 抓取 ---------- */

interface ExtractedLink {
  url: string
  title: string
  hash: string
}

function hashText(text: string): string {
  return crypto.createHash('sha1').update(text).digest('hex')
}

function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCharCode(Number(n)))
    .replace(/&([a-z]+);/gi, (m, k: string) => ENTITIES[k.toLowerCase()] ?? m)
}

function stripTags(s: string): string {
  return decodeEntities(s.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim()
}

function pageTitle(html: string): string {
  const m = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)
  return m ? stripTags(m[1]).slice(0, 40) : ''
}

/** 链接规范化：去锚点、去常见跟踪参数，便于跨次比对 */
function linkTarget(raw: string, base: string): string | null {
  try {
    const u = new URL(raw, base)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
    u.hash = ''
    for (const key of Array.from(u.searchParams.keys())) {
      if (/^(utm_|spm$|from$|ref$|source$|share)/i.test(key)) u.searchParams.delete(key)
    }
    return u.toString()
  } catch {
    return null
  }
}

function extractLinks(html: string, baseUrl: string): ExtractedLink[] {
  let baseHost = ''
  try {
    baseHost = new URL(baseUrl).hostname.replace(/^www\./, '')
  } catch {
    return []
  }
  const out = new Map<string, ExtractedLink>()
  const re = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(html)) && out.size < MAX_LINKS_SCAN) {
    const href = /href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(m[1] ?? '')
    const raw = (href?.[1] ?? href?.[2] ?? href?.[3] ?? '').trim()
    if (!raw || /^(#|javascript:|mailto:|tel:)/i.test(raw)) continue
    const url = linkTarget(raw, baseUrl)
    if (!url) continue
    let host = ''
    try {
      host = new URL(url).hostname.replace(/^www\./, '')
    } catch {
      continue
    }
    // 只收同站链接：首页上的外链多为广告 / 社交，不是这个源的新内容
    if (host !== baseHost && !host.endsWith(`.${baseHost}`)) continue
    const title = stripTags(m[2] ?? '').slice(0, MAX_TITLE)
    if (title.length < 6 || NOISE.test(title)) continue
    if (out.has(url)) continue
    out.set(url, { url, title, hash: hashText(url) })
  }
  return Array.from(out.values())
}

/**
 * 浏览器页面读取：共享内置浏览器登录态，后台隐藏窗口加载，不抢用户当前页面
 *
 * 列表页多为「内部容器滚动 + 虚拟列表」：滚 window 不会触发加载，
 * 滚回顶部还会卸载已渲染节点。因此这里先找出真正的滚动容器，
 * 逐屏下滚并边滚边累积链接，滚动结束后再回到顶部。
 */
const BROWSER_COLLECT_SCRIPT = `(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms))
  const clean = (s) => String(s || '').replace(/\\s+/g, ' ').trim().slice(0, 120)
  const links = new Map()
  const absorb = () => {
    document.querySelectorAll('a[href]').forEach((a) => {
      const href = a.href || ''
      const idm = href.match(/\\/(?:video|note)\\/(\\d+)/)
      const key = idm ? idm[1] : href.split('#')[0]
      if (!key || links.has(key)) return
      const img = a.querySelector('img')
      const title = clean(a.getAttribute('aria-label') || a.getAttribute('title') || (img && img.getAttribute('alt')) || a.innerText || '')
      if (!title && !idm) return
      links.set(key, { url: href.split('#')[0], title: title || ('作品 ' + idm[1]) })
    })
    return links.size
  }
  const pickScroller = () => {
    let best = null
    let gap = 0
    document.querySelectorAll('div,main,section').forEach((el) => {
      const st = getComputedStyle(el)
      if (!/auto|scroll/.test(st.overflowY)) return
      const d = el.scrollHeight - el.clientHeight
      if (el.clientHeight >= 240 && d > gap) { best = el; gap = d }
    })
    return best
  }
  const rounds = []
  let idle = 0
  let last = absorb()
  for (let i = 0; i < 8 && idle < 2; i++) {
    const el = pickScroller()
    if (el) el.scrollBy(0, Math.round(el.clientHeight * 2))
    else window.scrollBy(0, window.innerHeight * 2)
    await wait(900)
    const now = absorb()
    rounds.push({ round: i + 1, links: now, delta: now - last, scroller: !!el })
    idle = now > last ? 0 : idle + 1
    last = now
  }
  const back = pickScroller()
  if (back) back.scrollTo(0, 0)
  else window.scrollTo(0, 0)
  return {
    title: document.title,
    url: location.href,
    text: (document.body && document.body.innerText || '').slice(0, 3000),
    items: Array.from(links.values()).slice(0, 600)
  }
})()`

interface BrowserPageData {
  title: string
  url: string
  text: string
  items: Array<{ url: string; title: string }>
}

async function loadBrowserPage(url: string): Promise<BrowserPageData> {
  const win = new BrowserWindow({
    show: false,
    width: 1280,
    height: 900,
    webPreferences: {
      partition: 'persist:workon-browser',
      backgroundThrottling: false,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })
  win.webContents.setUserAgent(
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
  )
  try {
    await win.loadURL(url)
    await new Promise((r) => setTimeout(r, 2500))
    return (await win.webContents.executeJavaScript(BROWSER_COLLECT_SCRIPT, true)) as BrowserPageData
  } finally {
    if (!win.isDestroyed()) win.destroy()
  }
}

function toBrowserLinks(data: BrowserPageData, pageUrl: string): ExtractedLink[] {
  const douyin = /(^|\.)douyin\.com$/i.test(new URL(pageUrl).hostname)
  let baseHost = ''
  try {
    baseHost = new URL(pageUrl).hostname.replace(/^www\./, '')
  } catch {
    return []
  }
  const out = new Map<string, ExtractedLink>()
  for (const it of data.items ?? []) {
    const url = linkTarget(it.url, pageUrl)
    if (!url) continue
    try {
      const u = new URL(url)
      const host = u.hostname.replace(/^www\./, '')
      if (douyin) {
        if (!/\/(video|note)\/\d+/.test(u.pathname)) continue
      } else if (host !== baseHost && !host.endsWith(`.${baseHost}`)) {
        continue
      }
    } catch {
      continue
    }
    const title = stripTags(it.title).slice(0, MAX_TITLE)
    if (!title || NOISE.test(title)) continue
    if (out.has(url)) continue
    out.set(url, { url, title, hash: hashText(url) })
  }
  return Array.from(out.values())
}

async function collectLinks(task: StoredTask, point: StoredPoint): Promise<{ links: ExtractedLink[]; pageTitle: string }> {
  if (task.sourceKind === 'browser-page') {
    const data = await loadBrowserPage(point.url)
    const links = toBrowserLinks(data, data.url || point.url)
    if (!links.length) {
      if (/(登录|扫码|验证)/.test(data.text)) {
        throw new Error('需要先在应用内浏览器登录一次（登录态会自动复用）')
      }
      throw new Error('没有读到作品列表（页面可能未加载、未进入目标页或已改版）')
    }
    return { links, pageTitle: data.title || '' }
  }
  const page = await fetchPage(point.url)
  return { links: extractLinks(page.html, page.finalUrl || point.url), pageTitle: pageTitle(page.html) }
}

/* ---------- 分析与落点 ---------- */

/** 轻量关键词：井号标签 + Intl 分词，不调用模型，先保证链路能跑 */
function keywordsOf(text: string, limit = 8): string[] {
  const scores = new Map<string, number>()
  for (const m of text.matchAll(/#([^\s#，。；！？]{2,16})/g)) {
    const tag = m[1].trim()
    if (tag) scores.set(tag, (scores.get(tag) ?? 0) + 2)
  }
  try {
    const seg = new Intl.Segmenter('zh-CN', { granularity: 'word' })
    for (const part of seg.segment(text)) {
      if (!part.isWordLike) continue
      const word = part.segment.trim()
      if (word.length < 2 || word.length > 12) continue
      if (STOP_WORDS.has(word) || /^\d+$/.test(word)) continue
      scores.set(word, (scores.get(word) ?? 0) + 1)
    }
  } catch {
    /* 环境不支持分词时只用井号标签 */
  }
  return Array.from(scores.entries())
    .sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)
    .slice(0, limit)
    .map(([w]) => w)
}

async function routeFindings(task: StoredTask, findings: WatchFinding[]): Promise<void> {
  if (!findings.length) return
  const allTags = keywordsOf(findings.map((f) => `${f.title} ${(f.tags ?? []).join(' ')}`).join(' '), 10)

  if (task.sinks.knowledge) {
    const now = Date.now()
    for (const f of findings) {
      try {
        insertInto<KnowledgeItem>('knowledge', {
          id: genId('kn'),
          title: (f.title || '盯守发现').slice(0, 80),
          body: [
            `来源：${task.sourceLabel || task.title}`,
            `链接：${f.url}`,
            `关键词：${(f.tags ?? []).join('、') || '—'}`,
            `时间：${new Date(f.ts).toLocaleString('zh-CN')}`,
            '',
            `（由盯守「${task.title}」自动整理，可在知识库编辑）`
          ].join('\n'),
          kind: 'unstructured',
          source: 'watch',
          links: task.sinks.projectId
            ? [{ type: 'project', id: task.sinks.projectId }]
            : [],
          tags: f.tags ?? [],
          sedimentedAt: now,
          ts: now
        })
      } catch (e) {
        console.warn('[watch] 写知识库失败', (e as Error).message)
      }
    }
  }

  if (task.sinks.persona) {
    try {
      addWatchInterests(allTags)
    } catch (e) {
      console.warn('[watch] 写偏好画像失败', (e as Error).message)
    }
  }

  if (task.sinks.plan) {
    try {
      const today = dateKey(Date.now())
      const title = `盯守整理 · ${task.title}`.slice(0, 50)
      const exists = col<PlanItem>('plans').some(
        (p) => p.date === today && p.source === 'watch' && p.title === title
      )
      if (!exists) {
        insertInto<PlanItem>('plans', {
          id: '',
          date: today,
          title,
          category: 'other',
          planType: 'task',
          status: 'planned',
          source: 'watch',
          ts: Date.now()
        } as unknown as PlanItem)
      }
    } catch (e) {
      console.warn('[watch] 写今日计划失败', (e as Error).message)
    }
  }

  if (task.sinks.workflowId) {
    const input = findings
      .slice(0, 10)
      .map((f) => `- ${f.title} ${f.url}`)
      .join('\n')
    void import('./workflowRunner')
      .then((m) => m.runWorkflowById(task.sinks.workflowId as string, 'manual', input))
      .catch((e) => console.warn('[watch] 触发工作流失败', (e as Error).message))
  }
}

function makeFindings(
  task: StoredTask,
  point: StoredPoint,
  links: ExtractedLink[],
  initial: boolean
): WatchFinding[] {
  const now = Date.now()
  return links.map((l) => ({
    id: genId('finding'),
    taskId: task.id,
    pointId: point.id,
    pointLabel: point.label,
    url: l.url,
    title: l.title,
    tags: keywordsOf(l.title, 4),
    initial,
    ts: now
  }))
}

function intervalMs(p: StoredPoint): number {
  return Math.max(MIN_INTERVAL_MIN, p.intervalMin) * 60_000
}

/** 下次到期：周期 + 基于盯点 id 的固定抖动（0~8%），让多个盯点自然错开 */
function nextDue(p: StoredPoint, now: number): number {
  const jitter = Math.floor((intervalMs(p) * (hashText(p.id).charCodeAt(0) % 9)) / 100)
  return now + intervalMs(p) + jitter
}

async function processPoint(task: StoredTask, point: StoredPoint): Promise<{ found: number; error?: string }> {
  const started = Date.now()
  // 先推远，避免处理期间被下一次 tick 再次选中
  point.nextDueAt = started + intervalMs(point) * 4
  try {
    const collected = await collectLinks(task, point)
    // 抓取期间任务可能被删除：直接丢弃本次结果，不写回已删除任务
    if (!ensureStore().tasks.some((t) => t.id === task.id)) return { found: 0 }
    const links = collected.links
    if (point.label === hostLabel(point.url) && collected.pageTitle) point.label = collected.pageTitle.slice(0, 40)
    const now = Date.now()
    point.lastCheckedAt = now
    point.lastError = undefined
    point.failures = 0

    if (!point.baselineAt) {
      point.baselineAt = now
      point.seenHashes = links.slice(0, WATCH_RETAIN_SEEN).map((l) => l.hash)
      point.seenCount = 0
      point.nextDueAt = nextDue(point, now)

      // 浏览器源（抖音等）：首次读档把已有内容回填分析，而不是当作无变化
      if (task.sourceKind === 'browser-page') {
        const initial = makeFindings(task, point, links.slice(0, MAX_BACKFILL), true)
        const s = ensureStore()
        s.findings.unshift(...initial)
        s.findings = s.findings.slice(0, WATCH_RETAIN_FINDINGS)
        task.findingsCount += initial.length
        task.latest = initial[0]
        task.updatedAt = now
        save()
        await routeFindings(task, initial)
        notifyChanged(task.id)
        pushNotify(
          'generic',
          `盯守 · ${task.title}`,
          `已读档 ${initial.length} 条并完成整理${task.sinks.knowledge ? '，已写入知识库' : ''}。`,
          [{ label: '知道了', action: 'dismiss' }],
          45
        )
        return { found: initial.length }
      }

      save()
      notifyChanged(task.id)
      return { found: 0 }
    }

    const seen = new Set(point.seenHashes)
    const fresh = links.filter((l) => !seen.has(l.hash)).slice(0, MAX_NEW_PER_CHECK)
    if (!fresh.length) {
      point.nextDueAt = nextDue(point, now)
      save()
      return { found: 0 }
    }

    const findings = makeFindings(task, point, fresh, false)
    const s = ensureStore()
    s.findings.unshift(...findings)
    s.findings = s.findings.slice(0, WATCH_RETAIN_FINDINGS)
    task.findingsCount += findings.length
    task.latest = findings[0]
    task.updatedAt = now
    point.lastChangedAt = now
    point.seenHashes = [...fresh.map((l) => l.hash), ...point.seenHashes].slice(0, WATCH_RETAIN_SEEN)
    point.seenCount += findings.length
    point.nextDueAt = nextDue(point, now)
    save()
    await routeFindings(task, findings)
    notifyChanged(task.id)
    const head = findings.slice(0, 2).map((f) => f.title).join('；')
    pushNotify(
      'generic',
      `盯守 · ${task.title}`,
      `「${point.label}」发现 ${findings.length} 条新内容：${head}${findings.length > 2 ? ' 等' : ''}`,
      [{ label: '知道了', action: 'dismiss' }],
      60
    )
    return { found: findings.length }
  } catch (e) {
    const now = Date.now()
    point.lastCheckedAt = now
    point.failures += 1
    point.lastError = (e as Error).message || '抓取失败'
    point.nextDueAt = now + Math.min(intervalMs(point) * Math.pow(2, Math.min(point.failures, 3)), MAX_BACKOFF_MS)
    save()
    notifyChanged(task.id)
    return { found: 0, error: point.lastError }
  }
}

/** 立即检查：按任务或全部启用任务依次处理各盯点（手动触发 / 测试用） */
export async function runWatchNow(taskId?: string): Promise<{ checked: number; found: number; errors: string[] }> {
  if (busy) return { checked: 0, found: 0, errors: ['已有检查在进行，稍后再试'] }
  busy = true
  try {
    const s = ensureStore()
    const tasks = taskId ? s.tasks.filter((t) => t.id === taskId) : s.tasks.filter((t) => t.status === 'active')
    let checked = 0
    let found = 0
    const errors: string[] = []
    for (const task of tasks) {
      if (task.status !== 'active') continue
      for (const point of task.points) {
        const r = await processPoint(task, point)
        checked += 1
        found += r.found
        if (r.error) errors.push(`${point.label}：${r.error}`)
      }
    }
    return { checked, found, errors }
  } finally {
    busy = false
  }
}

function pickDue(): { task: StoredTask; point: StoredPoint } | null {
  const now = Date.now()
  let best: { task: StoredTask; point: StoredPoint } | null = null
  for (const task of ensureStore().tasks) {
    if (task.status !== 'active') continue
    for (const point of task.points) {
      if (point.nextDueAt > now) continue
      if (!best || point.nextDueAt < best.point.nextDueAt) best = { task, point }
    }
  }
  return best
}

function tick(): void {
  if (busy) return
  const due = pickDue()
  if (!due) return
  busy = true
  void processPoint(due.task, due.point)
    .catch(() => undefined)
    .finally(() => {
      busy = false
    })
}

export function startWatchScheduler(): void {
  ensureStore()
  if (timer) return
  timer = setInterval(tick, TICK_MS)
  setTimeout(tick, 2_000)
  console.log('[watch] 盯守调度器已启动（10s tick · 单盯点串行）')
}

export function stopWatchScheduler(): void {
  if (timer) clearInterval(timer)
  timer = null
}
