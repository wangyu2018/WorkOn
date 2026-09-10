/**
 * 归属引擎（v7 项目循环核心）：「当前操作属于哪个项目/哪条任务」
 * 软绑定假设集 + 漂移确认 + 确认过滤引擎
 * - 确认文案必须带：软件 + 窗口/路径线索 + 项目 + 依据
 * - 确认的是「这段操作」，IDE（Cursor 等）优先绑关键词/路径，不绑死整个软件
 */
import { col, insertInto, updateIn } from './db'
import { getSettings, setSettings } from './settings'
import { genId } from '@shared/types'
import { fuzzyMatch } from '@shared/fuzzy'
import { categoryOfWithOverride } from '@shared/appCategory'
import { enqueueAsk } from './confirmQueue'
import { findDuplicateProject } from './projects'
import { extractPathHint, isIdeApp } from './pathHint'
import type { Project, ProjectTask } from '@shared/types'

// ───────────────────────── 数据模型 ─────────────────────────

export interface ProjectBinding {
  id: string
  projectId: string
  /** 工具软绑定：appName 包含匹配（如 zcode / cursor / chrome） */
  apps: string[]
  /** 标题关键词：窗口标题命中也算归属 */
  keywords: string[]
  /** 绑定目录（dirWatcher + 标题路径线索） */
  dirs: string[]
  updatedAt: number
}

/** 已回答确认的记忆（防重复轰炸） */
export interface ConfirmMemory {
  id: string // 指纹
  answer: string
  ts: number
}

// ───────────────────────── 运行态 ─────────────────────────

interface AttributionRuntime {
  projectId: string | null
  projectName: string
  taskId: string | null
  taskTitle: string
  sinceTs: number
  unattrSinceTs: number | null
  unattrAppSet: string[]
  /** 当前段窗口/路径，供确认文案 */
  lastTitle: string
  lastPathHint: string
  lastApp: string
}

const UNATTRIBUTED_SEC = 10 * 60
const DRIFT_MIN_SEC = 15 * 60
const DAILY_QUOTA = 2
const SLACK_LIKE = new Set(['slack', 'relax', 'break', 'lunch'])
const ENTERTAINMENT_TITLE = /抖音|douyin|tiktok|bilibili|哔哩|youtube|优酷|爱奇艺|腾讯视频|网易云|spotify|twitch|漫画|小说|微博|知乎热|iqiyi|youku/i

function isEntertainmentContext(app: string, title: string, state?: string): boolean {
  if (SLACK_LIKE.has(state ?? '')) return true
  const catNow = categoryOfWithOverride(app ?? '', getSettings().appCategoryOverride)
  if (catNow === 'media' || catNow === 'game') return true
  if (catNow === 'browser' && ENTERTAINMENT_TITLE.test(title ?? '')) return true
  return false
}

let rt: AttributionRuntime = {
  projectId: null,
  projectName: '',
  taskId: null,
  taskTitle: '',
  sinceTs: 0,
  unattrSinceTs: null,
  unattrAppSet: [],
  lastTitle: '',
  lastPathHint: '',
  lastApp: ''
}

// ───────────────────────── 确认过滤引擎 ─────────────────────────

function memoryAll(): ConfirmMemory[] {
  return col<ConfirmMemory>('confirmMemory')
}

function alreadyAnswered(fp: string): boolean {
  return memoryAll().some((m) => m.id === fp)
}

function askedUnattrToday(day: string, pathKey: string): boolean {
  return memoryAll().some(
    (m) => m.id === `unattr:${day}:${pathKey}` || (pathKey === 'nopath' && m.id === `unattr:${day}`)
  )
}

function askedDriftToday(projectId: string, day: string, pathKey: string): boolean {
  const exact = `drift:${projectId}:${day}:${pathKey}`
  if (memoryAll().some((m) => m.id === exact)) return true
  // 无路径线索时仍按项目/日限制一次
  if (pathKey === 'nopath') {
    return memoryAll().some(
      (m) => m.id === `drift:${projectId}:${day}` || (m.id.startsWith(`drift:${projectId}:${day}`) && sameDay(m.ts, day))
    )
  }
  return false
}

function sameDay(ts: number, day: string): boolean {
  return new Date(ts).toISOString().slice(0, 10) === day
}

function rememberAnswer(fp: string, answer: string): void {
  const hit = memoryAll().find((m) => m.id === fp)
  if (hit) updateIn<ConfirmMemory>('confirmMemory', fp, { answer, ts: Date.now() })
  else insertInto<ConfirmMemory>('confirmMemory', { id: fp, answer, ts: Date.now() })
}

function fmtApp(app: string): string {
  return (app || '').replace(/\.exe$/i, '') || '未知应用'
}

function fmtApps(apps: string[]): string {
  return [...new Set(apps.map(fmtApp).filter(Boolean))].join('、') || '未知应用'
}

function pathKeyOf(hint: string | null | undefined): string {
  const h = (hint || '').trim().toLowerCase()
  if (!h) return 'nopath'
  return h.replace(/[^\w\u4e00-\u9fff]+/g, '_').slice(0, 28) || 'nopath'
}

function quotaLeft(): boolean {
  const s = getSettings()
  const day = new Date().toISOString().slice(0, 10)
  const cur = (s as { confirmDay?: { day: string; count: number } }).confirmDay
  if (!cur || cur.day !== day) return true
  return cur.count < DAILY_QUOTA
}

function consumeQuota(): void {
  const s = getSettings()
  const day = new Date().toISOString().slice(0, 10)
  const cur = (s as { confirmDay?: { day: string; count: number } }).confirmDay
  const count = cur && cur.day === day ? cur.count + 1 : 1
  void setSettings({ confirmDay: { day, count } } as never)
}

function askConfirm(fp: string, question: string, ctx: Record<string, unknown>): boolean {
  if (alreadyAnswered(fp)) return false
  if (!quotaLeft()) return false
  if (!enqueueAsk(fp, question, ctx)) return false
  consumeQuota()
  return true
}

// ───────────────────────── 绑定管理 ─────────────────────────

export function listBindings(): ProjectBinding[] {
  return col<ProjectBinding>('projectBindings')
}

export function bindProject(projectId: string, patch: { apps?: string[]; keywords?: string[]; dirs?: string[] }): ProjectBinding {
  const exist = listBindings().find((b) => b.projectId === projectId)
  const merge = (a: string[] = [], b: string[] = []): string[] => [...new Set([...a, ...b].map((x) => x.trim()).filter(Boolean))]
  if (exist) {
    return updateIn<ProjectBinding>('projectBindings', exist.id, {
      apps: patch.apps ? merge(exist.apps, patch.apps) : exist.apps,
      keywords: patch.keywords ? merge(exist.keywords, patch.keywords) : exist.keywords,
      dirs: patch.dirs ? merge(exist.dirs, patch.dirs) : exist.dirs,
      updatedAt: Date.now()
    }) as ProjectBinding
  }
  return insertInto<ProjectBinding>('projectBindings', {
    id: genId('bd'),
    projectId,
    apps: patch.apps ?? [],
    keywords: patch.keywords ?? [],
    dirs: patch.dirs ?? [],
    updatedAt: Date.now()
  })
}

export function unbindProject(projectId: string): void {
  const b = listBindings().find((x) => x.projectId === projectId)
  if (b) updateIn<ProjectBinding>('projectBindings', b.id, { apps: [], keywords: [], dirs: [], updatedAt: Date.now() })
}

/** IDE 等多开工具：绑关键词/路径，不绑死整个软件 */
export function segmentBindPatch(apps: string[] | undefined, windowTitle?: string, pathHint?: string): {
  apps?: string[]
  keywords?: string[]
  dirs?: string[]
} {
  const list = [...new Set((apps ?? []).map(fmtApp).filter(Boolean))]
  const primary = list[0] ?? ''
  const hint = (pathHint || extractPathHint(windowTitle || '') || '').trim()
  if (list.some(isIdeApp) || isIdeApp(primary)) {
    const keywords: string[] = []
    const dirs: string[] = []
    if (hint) {
      keywords.push(hint)
      if (/^[A-Za-z]:\\/.test(hint) || hint.startsWith('/')) dirs.push(hint)
    } else if (windowTitle?.trim()) {
      keywords.push(windowTitle.trim().slice(0, 40))
    }
    // 仍可保留极短 app 名作弱线索，但主匹配靠关键词
    return { keywords, dirs }
  }
  return { apps: list }
}

// ───────────────────────── 归属链 ─────────────────────────

export interface AttributionState {
  projectId: string | null
  projectName: string
  taskId: string | null
  taskTitle: string
  sec: number
  source: 'binding' | 'keyword' | 'question' | 'none' | 'dir'
}

function appNameMatch(app: string, apps: string[]): string | null {
  for (const a of apps) {
    if (a && fuzzyMatch(app, a)) return a
  }
  return null
}

function titleMatch(title: string, keywords: string[]): string | null {
  for (const k of keywords) {
    if (k && fuzzyMatch(title, k)) return k
  }
  return null
}

function dirMatch(title: string, pathHint: string | null, dirs: string[]): string | null {
  if (!dirs.length) return null
  const blob = `${title} ${pathHint ?? ''}`.toLowerCase()
  for (const d of dirs) {
    const dd = d.trim().toLowerCase()
    if (dd && blob.includes(dd)) return d
  }
  return null
}

function matchTask(projectId: string, title: string): ProjectTask | null {
  const tasks = col<ProjectTask>('projectTasks').filter((t) => t.projectId === projectId)
  for (const t of tasks) {
    if (t.title && fuzzyMatch(title, t.title)) return t
  }
  return null
}

function buildReason(
  source: AttributionState['source'],
  app: string,
  title: string,
  hit: ProjectBinding,
  pathHint: string | null
): string {
  if (source === 'dir') {
    const d = dirMatch(title, pathHint, hit.dirs)
    return d ? `工作区/路径命中「${d}」` : `路径线索「${pathHint}」`
  }
  if (source === 'keyword') {
    const k = titleMatch(title, hit.keywords)
    return k ? `窗口标题命中关键词「${k}」` : '窗口标题关键词匹配'
  }
  if (source === 'binding') {
    const a = appNameMatch(app, hit.apps)
    return a ? `曾把软件「${fmtApp(app)}」软绑到该项目` : `软件「${fmtApp(app)}」软绑定`
  }
  return '近期归属粘滞'
}

function buildConfirmCopy(opts: {
  mode: 'drift' | 'unattr'
  apps: string[]
  windowTitle?: string
  pathHint?: string
  projectName?: string
  reason?: string
}): string {
  const soft = fmtApps(opts.apps)
  const win = opts.windowTitle?.trim()
  const path = opts.pathHint?.trim()
  const lines: string[] = []
  lines.push(`你正在用「${soft}」`)
  if (win) lines.push(`窗口：「${win.slice(0, 60)}」`)
  if (path) lines.push(`工作区/路径线索：「${path}」`)
  if (opts.mode === 'drift' && opts.projectName) {
    lines.push(`这段操作还是在做项目「${opts.projectName}」吗？`)
    if (opts.reason) lines.push(`（依据：${opts.reason}）`)
    else lines.push('（确认的是这段操作，不是整个软件永久绑定）')
  } else {
    lines.push('这段操作要挂到哪个项目？')
    if (opts.reason) lines.push(`（线索：${opts.reason}）`)
    else lines.push('（可先不挂；Cursor 等多开按窗口/路径分段）')
  }
  return lines.join('\n')
}

/**
 * 归属 tick（monitor 每 tick 调用）：返回当前归属并处理漂移/未归因确认
 */
export function attributionTick(app: string, title: string, ts: number, idleSec: number, excluded = false, state?: string): AttributionState {
  if (excluded) {
    rt.unattrSinceTs = null
    rt.unattrAppSet = []
    return getAttribution()
  }

  const pathHint = extractPathHint(title)
  rt.lastApp = app
  rt.lastTitle = title ?? ''
  rt.lastPathHint = pathHint ?? ''

  const bindings = listBindings().filter((b) => b.apps.length || b.keywords.length || b.dirs.length)
  let hit: ProjectBinding | null = null
  let source: AttributionState['source'] = 'none'

  // 优先路径/关键词（适配 Cursor 一软件多项目），再应用软绑
  for (const b of bindings) {
    const d = dirMatch(title, pathHint, b.dirs)
    if (d) {
      hit = b
      source = 'dir'
      break
    }
  }
  if (!hit) {
    for (const b of bindings) {
      if (titleMatch(title, b.keywords)) {
        hit = b
        source = 'keyword'
        break
      }
    }
  }
  if (!hit) {
    for (const b of bindings) {
      if (appNameMatch(app, b.apps)) {
        hit = b
        source = 'binding'
        break
      }
    }
  }

  if (hit) {
    const project = col<Project>('projects').find((p) => p.id === hit!.projectId)
    if (rt.projectId !== hit.projectId) {
      rt = {
        ...rt,
        projectId: hit.projectId,
        projectName: project?.name ?? '',
        sinceTs: ts,
        unattrSinceTs: null,
        unattrAppSet: []
      }
    }
    const task = matchTask(hit.projectId, title)
    rt.taskId = task?.id ?? null
    rt.taskTitle = task?.title ?? ''
    if (task && !hit.keywords.includes(task.title) && task.title.length >= 4) {
      updateIn<ProjectBinding>('projectBindings', hit.id, {
        keywords: [...hit.keywords, task.title].slice(-12),
        updatedAt: ts
      })
    }
    // 学到路径线索（不问）
    if (pathHint && !hit.dirs.some((d) => pathHint.toLowerCase().includes(d.toLowerCase()) || d.toLowerCase().includes(pathHint.toLowerCase()))) {
      if (pathHint.length >= 3) {
        updateIn<ProjectBinding>('projectBindings', hit.id, {
          dirs: [...hit.dirs, pathHint].slice(-8),
          keywords: hit.keywords.includes(pathHint) ? hit.keywords : [...hit.keywords, pathHint].slice(-12),
          updatedAt: ts
        })
      }
    }
  } else if (rt.projectId) {
    if (isEntertainmentContext(app ?? '', title ?? '', state)) {
      rt.unattrSinceTs = null
      rt.unattrAppSet = []
      return getAttribution()
    }
    rt.unattrSinceTs = rt.unattrSinceTs ?? ts
    if (!rt.unattrAppSet.includes(app)) rt.unattrAppSet.push(app)
    const driftSec = (ts - rt.unattrSinceTs) / 1000
    if (idleSec < 30 && driftSec >= DRIFT_MIN_SEC && rt.unattrAppSet.length >= 1) {
      const day = new Date(ts).toISOString().slice(0, 10)
      const pk = pathKeyOf(pathHint)
      const fp = `drift:${rt.projectId}:${day}:${pk}`
      if (!askedDriftToday(rt.projectId, day, pk)) {
        const reason = `你刚才挂在「${rt.projectName}」，但现在这段操作不在该项目的绑定线索里`
        const asked = askConfirm(
          fp,
          buildConfirmCopy({
            mode: 'drift',
            apps: [...rt.unattrAppSet],
            windowTitle: title,
            pathHint: pathHint ?? undefined,
            projectName: rt.projectName,
            reason
          }),
          {
            kind: 'drift',
            projectId: rt.projectId,
            projectName: rt.projectName,
            apps: [...rt.unattrAppSet],
            windowTitle: title?.slice(0, 100),
            pathHint: pathHint ?? undefined,
            reason
          }
        )
        if (asked) rt.unattrSinceTs = ts
      }
    }
  } else {
    if (isEntertainmentContext(app ?? '', title ?? '', state)) {
      rt.unattrSinceTs = null
      rt.unattrAppSet = []
      return getAttribution()
    }
    rt.unattrSinceTs = rt.unattrSinceTs ?? ts
    if (!rt.unattrAppSet.includes(app)) rt.unattrAppSet.push(app)
    const unattrSec = (ts - rt.unattrSinceTs) / 1000
    if (idleSec < 30 && unattrSec >= UNATTRIBUTED_SEC && rt.unattrAppSet.length >= 1) {
      const day = new Date(ts).toISOString().slice(0, 10)
      const pk = pathKeyOf(pathHint)
      const fp = `unattr:${day}:${pk}`
      if (!askedUnattrToday(day, pk)) {
        const reason = pathHint
          ? `窗口/路径线索「${pathHint}」尚未挂到任何项目`
          : `软件「${fmtApps(rt.unattrAppSet)}」持续一段，尚未挂项目`
        askConfirm(
          fp,
          buildConfirmCopy({
            mode: 'unattr',
            apps: [...rt.unattrAppSet],
            windowTitle: title,
            pathHint: pathHint ?? undefined,
            reason
          }),
          {
            kind: 'unattributed',
            apps: [...rt.unattrAppSet],
            windowTitle: title?.slice(0, 100),
            pathHint: pathHint ?? undefined,
            reason
          }
        )
        rt.unattrSinceTs = ts
      }
    }
  }

  return {
    projectId: rt.projectId,
    projectName: rt.projectName,
    taskId: rt.taskId,
    taskTitle: rt.taskTitle,
    sec: rt.sinceTs ? Math.round((ts - rt.sinceTs) / 1000) : 0,
    source
  }
}

/** 归属确认回调。payload 可带 keywords/dirs/windowTitle/pathHint；IDE 默认段级绑定 */
export function answerAttribution(
  fp: string,
  answer: string,
  payload: {
    projectId?: string
    projectName?: string
    apps?: string[]
    keywords?: string[]
    dirs?: string[]
    windowTitle?: string
    pathHint?: string
    bindApp?: boolean
  }
): { projectId: string | null; projectName: string } {
  rememberAnswer(fp, answer)

  const resolvePatch = (projectId: string): void => {
    const explicit =
      payload.keywords?.length || payload.dirs?.length
        ? { apps: payload.bindApp ? payload.apps : undefined, keywords: payload.keywords, dirs: payload.dirs }
        : payload.bindApp
          ? { apps: payload.apps }
          : segmentBindPatch(payload.apps, payload.windowTitle || rt.lastTitle, payload.pathHint || rt.lastPathHint)
    bindProject(projectId, explicit)
  }

  const driftMatch = /^drift:([^:]+):/.exec(fp)
  if (driftMatch && (answer === 'yes' || answer === 'bind')) {
    const projectId = payload.projectId || driftMatch[1]
    resolvePatch(projectId)
    const project = col<Project>('projects').find((p) => p.id === projectId)
    rt = {
      ...rt,
      projectId,
      projectName: project?.name ?? rt.projectName,
      sinceTs: Date.now(),
      unattrSinceTs: null,
      unattrAppSet: []
    }
    return { projectId: rt.projectId, projectName: rt.projectName }
  }

  if (answer === 'bind' && payload.projectId) {
    resolvePatch(payload.projectId)
    const project = col<Project>('projects').find((p) => p.id === payload.projectId)
    rt = {
      ...rt,
      projectId: payload.projectId,
      projectName: project?.name ?? '',
      sinceTs: Date.now(),
      unattrSinceTs: null,
      unattrAppSet: []
    }
  } else if (answer === 'create' && payload.projectName) {
    const target = findDuplicateProject(payload.projectName)
    const p =
      target ??
      insertInto<Project>('projects', {
        id: genId('pj'),
        name: payload.projectName.trim(),
        status: 'active',
        priority: 'medium',
        color: '#22D3EE',
        createdAt: Date.now(),
        updatedAt: Date.now()
      } as Project)
    resolvePatch(p.id)
    rt = {
      ...rt,
      projectId: p.id,
      projectName: p.name,
      sinceTs: Date.now(),
      unattrSinceTs: null,
      unattrAppSet: []
    }
  } else {
    // ignore / no：清空粘滞（先不挂）
    rt = {
      ...rt,
      projectId: null,
      projectName: '',
      taskId: null,
      taskTitle: '',
      sinceTs: 0,
      unattrSinceTs: null,
      unattrAppSet: []
    }
  }
  return { projectId: rt.projectId, projectName: rt.projectName }
}

export function getAttribution(): AttributionState {
  return {
    projectId: rt.projectId,
    projectName: rt.projectName,
    taskId: rt.taskId,
    taskTitle: rt.taskTitle,
    sec: rt.sinceTs ? Math.round((Date.now() - rt.sinceTs) / 1000) : 0,
    source: rt.projectId ? 'binding' : 'none'
  }
}
