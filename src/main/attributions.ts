/**
 * 归属引擎（v7 项目循环核心）：「当前操作属于哪个项目/哪条任务」
 * 软绑定假设集 + 漂移确认 + 确认过滤引擎
 * - 软绑定：{项目 → 工具集/关键词/目录}，说一次生效，但工具漂移会触发一次确认
 * - 归属链：active app → 绑定匹配 → 项目 + 任务颗粒（标题关键词）
 * - 确认过滤：指纹去重（已答永不再问，除非上下文显著变化）+ 24h 冷却 + 每日打断配额
 */
import { col, insertInto, updateIn } from './db'
import { getSettings, setSettings } from './settings'
import { bus } from './state'
import { genId } from '@shared/types'
import { fuzzyMatch } from '@shared/fuzzy'
import { categoryOfWithOverride } from '@shared/appCategory'
import { enqueueAsk } from './confirmQueue'
import type { Project, ProjectTask } from '@shared/types'

// ───────────────────────── 数据模型 ─────────────────────────

export interface ProjectBinding {
  id: string
  projectId: string
  /** 工具软绑定：appName 包含匹配（如 zcode / cursor / chrome） */
  apps: string[]
  /** 标题关键词：窗口标题命中也算归属 */
  keywords: string[]
  /** 绑定目录（dirWatcher 用，归属引擎只存引用） */
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
  /** 当前归属（粘滞：一旦命中保持，直到长时间强不匹配） */
  projectId: string | null
  projectName: string
  taskId: string | null
  taskTitle: string
  sinceTs: number
  /** 未归因工作起点（持续 ≥ UNATTRIBUTED_SEC 才轻问） */
  unattrSinceTs: number | null
  unattrAppSet: string[]
}

const UNATTRIBUTED_SEC = 10 * 60
const DRIFT_MIN_SEC = 15 * 60
const DAILY_QUOTA = 2
const SLACK_LIKE = new Set(['slack', 'relax', 'break', 'lunch'])

let rt: AttributionRuntime = {
  projectId: null,
  projectName: '',
  taskId: null,
  taskTitle: '',
  sinceTs: 0,
  unattrSinceTs: null,
  unattrAppSet: []
}

// ───────────────────────── 确认过滤引擎 ─────────────────────────

function memoryAll(): ConfirmMemory[] {
  return col<ConfirmMemory>('confirmMemory')
}

/** 指纹已回答过 → 永不再问 */
function alreadyAnswered(fp: string): boolean {
  return memoryAll().some((m) => m.id === fp)
}

function rememberAnswer(fp: string, answer: string): void {
  insertInto<ConfirmMemory>('confirmMemory', { id: fp, answer, ts: Date.now() })
}

/** 每日打断配额：settings.confirmDay {day, count} */
// 配额语义并入派遣节流（30s 一条 + 低专注才发），保留供未来策略使用
void quotaLeft
void consumeQuota
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

/**
 * 发起一条确认：不再直接打断——入队堆积，派遣器只在低专注时刻放行。
 * 指纹已答 → 永不入队。
 */
function askConfirm(fp: string, question: string, ctx: Record<string, unknown>): boolean {
  if (alreadyAnswered(fp)) return false
  enqueueAsk(fp, question, ctx)
  return true
}

// ───────────────────────── 绑定管理 ─────────────────────────

export function listBindings(): ProjectBinding[] {
  return col<ProjectBinding>('projectBindings')
}

export function bindProject(projectId: string, patch: { apps?: string[]; keywords?: string[]; dirs?: string[] }): ProjectBinding {
  const exist = listBindings().find((b) => b.projectId === projectId)
  if (exist) {
    return updateIn<ProjectBinding>('projectBindings', exist.id, {
      apps: patch.apps ?? exist.apps,
      keywords: patch.keywords ?? exist.keywords,
      dirs: patch.dirs ?? exist.dirs,
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

// ───────────────────────── 归属链 ─────────────────────────

export interface AttributionState {
  projectId: string | null
  projectName: string
  taskId: string | null
  taskTitle: string
  /** 当前颗粒持续秒数 */
  sec: number
  /** 归因来源：binding/keyword/question/none */
  source: 'binding' | 'keyword' | 'question' | 'none'
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

/** 任务颗粒：项目内任务标题被窗口标题/关键词命中 */
function matchTask(projectId: string, title: string): ProjectTask | null {
  const tasks = col<ProjectTask>('projectTasks').filter((t) => t.projectId === projectId)
  for (const t of tasks) {
    if (t.title && fuzzyMatch(title, t.title)) return t
  }
  return null
}

/**
 * 归属 tick（monitor 每 tick 调用）：返回当前归属并处理漂移/未归因确认
 */
export function attributionTick(app: string, title: string, ts: number, idleSec: number, excluded = false, state?: string): AttributionState {
  // 隐私排除应用：不累计未归因（避免"银行类应用也来问归哪个项目"），并复位计时
  if (excluded) {
    rt.unattrSinceTs = null
    rt.unattrAppSet = []
    return getAttribution()
  }
  const bindings = listBindings().filter((b) => b.apps.length || b.keywords.length)
  let hit: ProjectBinding | null = null
  let source: AttributionState['source'] = 'none'

  for (const b of bindings) {
    if (appNameMatch(app, b.apps) || titleMatch(title, b.keywords)) {
      hit = b
      source = appNameMatch(app, b.apps) ? 'binding' : 'keyword'
      break
    }
  }

  if (hit) {
    // 命中：更新粘滞归属
    const project = col<Project>('projects').find((p) => p.id === hit!.projectId)
    if (rt.projectId !== hit.projectId) {
      rt = { ...rt, projectId: hit.projectId, projectName: project?.name ?? '', sinceTs: ts, unattrSinceTs: null, unattrAppSet: [] }
    }
    const task = matchTask(hit.projectId, title)
    rt.taskId = task?.id ?? null
    rt.taskTitle = task?.title ?? ''
    // 任务标题命中作为关键词学习（轻量自适应，不问）
    if (task && !hit.keywords.includes(task.title) && task.title.length >= 4) {
      updateIn<ProjectBinding>('projectBindings', hit.id, { keywords: [...hit.keywords, task.title].slice(-12), updatedAt: ts })
    }
  } else if (rt.projectId) {
    // 粘滞中但当前应用不在任何绑定：漂移计时
    // 摸鱼/娱乐内容显然不是项目工作：不触发漂移询问（打断你看视频很蠢）
    const catNow = categoryOfWithOverride(app ?? '', getSettings().appCategoryOverride)
    if (catNow === 'media' || catNow === 'game' || SLACK_LIKE.has(state ?? '')) {
      rt.unattrSinceTs = null
      rt.unattrAppSet = []
      return getAttribution()
    }
    rt.unattrSinceTs = rt.unattrSinceTs ?? ts
    if (!rt.unattrAppSet.includes(app)) rt.unattrAppSet.push(app)
    const driftSec = (ts - rt.unattrSinceTs) / 1000
    if (idleSec < 30 && driftSec >= DRIFT_MIN_SEC && rt.unattrAppSet.length >= 1) {
      // 漂移确认（指纹=项目+新工具集）：一次点击更新假设集
      const fp = `drift:${rt.projectId}:${[...rt.unattrAppSet].sort().join('|').toLowerCase()}`
      const asked = askConfirm(
        fp,
        `最近在用 ${rt.unattrAppSet[0].replace(/\.exe$/i, '')}——还是在做「${rt.projectName}」吗？`,
        { kind: 'drift', projectId: rt.projectId, apps: rt.unattrAppSet }
      )
      if (asked) {
        rt.unattrSinceTs = ts // 问过就重置计时，等回答
      }
    }
  } else {
    // 摸鱼/娱乐：同样不问（没人会给抖音做项目归属）
    const catNow = categoryOfWithOverride(app ?? '', getSettings().appCategoryOverride)
    if (catNow === 'media' || catNow === 'game' || SLACK_LIKE.has(state ?? '')) {
      rt.unattrSinceTs = null
      rt.unattrAppSet = []
      return getAttribution()
    }
    rt.unattrSinceTs = rt.unattrSinceTs ?? ts
    if (!rt.unattrAppSet.includes(app)) rt.unattrAppSet.push(app)
    const unattrSec = (ts - rt.unattrSinceTs) / 1000
    if (idleSec < 30 && unattrSec >= UNATTRIBUTED_SEC && rt.unattrAppSet.length >= 1) {
      const fp = `unattr:${new Date(ts).toISOString().slice(0, 10)}:${[...rt.unattrAppSet].sort().join('|').toLowerCase()}`
      askConfirm(fp, `最近 ${Math.round(unattrSec / 60)} 分钟都在 ${rt.unattrAppSet[0].replace(/\.exe$/i, '')} 里——在为什么项目忙？可打开悬浮窗「归类」标记`, {
        kind: 'unattributed',
        apps: rt.unattrAppSet
      })
      rt.unattrSinceTs = ts
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

/** 归属确认回调（widget 问题按钮 → IPC）。返回最终归属的项目 id/名 */
export function answerAttribution(fp: string, answer: string, payload: { projectId?: string; projectName?: string; apps?: string[] }): { projectId: string | null; projectName: string } {
  rememberAnswer(fp, answer)
  if (answer === 'bind' && payload.projectId) {
    bindProject(payload.projectId, { apps: payload.apps })
    const project = col<Project>('projects').find((p) => p.id === payload.projectId)
    rt = { ...rt, projectId: payload.projectId, projectName: project?.name ?? '', sinceTs: Date.now(), unattrSinceTs: null, unattrAppSet: [] }
  } else if (answer === 'create' && payload.projectName) {
    // 模糊查重：名字相近的已有项目直接复用，避免"WorkOn/workon开发/won"裂成三个项目
    const existing = col<Project>('projects')
    let target: Project | null = null
    for (const p of existing) {
      if (fuzzyMatch(payload.projectName, p.name, 0.75)) {
        target = p
        break
      }
    }
    const p = target ?? insertInto<Project>('projects', { id: genId('pj'), name: payload.projectName, status: 'active', ts: Date.now() } as unknown as Project)
    bindProject(p.id, { apps: payload.apps })
    rt = { ...rt, projectId: p.id, projectName: p.name, sinceTs: Date.now(), unattrSinceTs: null, unattrAppSet: [] }
  } else {
    // ignore：清空粘滞，进未归类（当日指纹已记忆不再问）
    rt = { ...rt, projectId: null, projectName: '', taskId: null, taskTitle: '', sinceTs: 0, unattrSinceTs: null, unattrAppSet: [] }
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
