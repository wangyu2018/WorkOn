/**
 * 一分钟校对（v8）：把「今天这些应用算哪个项目」变成可一键处理的队列。
 *
 * 为什么需要它：产品主张是「自动记录 → 自动归因 → 每天一分钟校对」，
 * 但此前归因结果只能在日历里逐条翻，界面上没有待校对入口。
 *
 * 口径：
 * - 单位是「应用 × 当天时长」：与 projectTimeLinks 的存储粒度一致，用户可以反复改。
 * - 待校对 = 当天有时长、但没有项目归属、且没被「与工作无关」忽略的应用。
 * - 一键确认 = 写入当天该应用的归类（linkAppToProject），次日自动不再出现。
 */
import { col, insertInto, removeFrom } from './db'
import { listActivities } from './db'
import { buildMergedTrail, dateKey } from '@shared/trail'
import { linkAppToProject, listProjects, dayProjectLinks } from './projects'
import { listBindings } from './attributions'
import { genId } from '@shared/types'
import type { Project } from '@shared/types'

/** 「与工作无关」忽略记录：按 date+app 唯一，避免同一应用当天反复出现 */
export interface ReviewIgnore {
  id: string
  date: string
  app: string
  ts: number
}

export interface ReviewItem {
  /** 归一化后的应用键（小写、去 .exe） */
  app: string
  /** 展示名 */
  label: string
  min: number
  projectId: string | null
  projectName?: string
  /** 依据绑定关系推断出的项目（有则按钮直接写「归到 X」） */
  suggestedProjectId?: string
  suggestedProjectName?: string
  reason?: string
}

export interface ReviewSummary {
  date: string
  /** 待校对条数 */
  pending: number
  /** 待校对时长（分钟） */
  pendingMin: number
  /** 已归类应用数 */
  reviewed: number
  /** 当天有效时长（分钟） */
  totalMin: number
}

/** 与应用归类同口径的归一化键 */
function appKey(app: string): string {
  return app.trim().toLowerCase().replace(/\.exe$/i, '')
}

/** 应用显示名：去掉路径与 .exe */
function appLabel(app: string): string {
  const base = app.split(/[\\/]/).pop() ?? app
  return base.replace(/\.exe$/i, '')
}

/** 当天各应用有效时长（跳过 <30s 的短切换，与时间轴口径一致） */
function appMinutes(date: string): Map<string, number> {
  const trail = buildMergedTrail(listActivities(date), date)
  const map = new Map<string, number>()
  for (const seg of trail.segments) {
    if (seg.glance) continue
    const k = appKey(seg.mainApp)
    if (!k) continue
    map.set(k, (map.get(k) ?? 0) + seg.durationMin)
  }
  return map
}

/** 待校对队列（按时长倒序，最多 12 条） */
export function pendingReview(date?: string): ReviewItem[] {
  const d = date ?? dateKey(Date.now())
  const minutes = appMinutes(d)
  const links = new Map(dayProjectLinks(d).map((l) => [l.app, l.projectId]))
  const ignored = new Set(col<ReviewIgnore>('reviewIgnores').filter((r) => r.date === d).map((r) => r.app))
  const projects = new Map(listProjects().map((p) => [p.id, p]))
  const bindings = listBindings()

  const items: ReviewItem[] = []
  for (const [app, min] of minutes) {
    if (min < 1) continue
    if (links.has(app) || ignored.has(app)) continue
    const pid = links.get(app) ?? null
    // 绑定关系里已经声明过这个应用 → 直接给出建议，用户只点一下
    const bound = bindings.find((b) => (b.apps ?? []).some((a) => appKey(a) === app))
    const suggested = bound ? projects.get(bound.projectId) : undefined
    items.push({
      app,
      label: appLabel(app),
      min: Math.round(min),
      projectId: pid,
      projectName: pid ? projects.get(pid)?.name : undefined,
      suggestedProjectId: suggested?.id,
      suggestedProjectName: suggested?.name,
      reason: suggested ? '项目已绑定此工具' : undefined
    })
  }
  return items.sort((a, b) => b.min - a.min).slice(0, 12)
}

/** 今日校对进度（首屏一句话结论用） */
export function reviewSummary(date?: string): ReviewSummary {
  const d = date ?? dateKey(Date.now())
  const minutes = appMinutes(d)
  const links = new Map(dayProjectLinks(d).map((l) => [l.app, l.projectId]))
  const ignored = new Set(col<ReviewIgnore>('reviewIgnores').filter((r) => r.date === d).map((r) => r.app))
  let pending = 0
  let pendingMin = 0
  let reviewed = 0
  let totalMin = 0
  for (const [app, min] of minutes) {
    if (min < 1) continue
    totalMin += min
    if (links.has(app)) reviewed++
    else if (!ignored.has(app)) {
      pending++
      pendingMin += min
    }
  }
  return {
    date: d,
    pending,
    pendingMin: Math.round(pendingMin),
    reviewed,
    totalMin: Math.round(totalMin)
  }
}

/** 确认归属：写入当天应用归类（projectId=null 表示解除归类） */
export function confirmReviewApp(app: string, projectId: string | null, date?: string): void {
  const d = date ?? dateKey(Date.now())
  const key = appKey(app)
  // 先清掉当天的忽略记录，用户改主意时能重新归类
  for (const r of col<ReviewIgnore>('reviewIgnores')) {
    if (r.date === d && r.app === key) removeFrom('reviewIgnores', r.id)
  }
  linkAppToProject(projectId, key, d)
}

/** 与工作无关：当天不再出现在待校对队列 */
export function ignoreReviewApp(app: string, date?: string): void {
  const d = date ?? dateKey(Date.now())
  const key = appKey(app)
  if (col<ReviewIgnore>('reviewIgnores').some((r) => r.date === d && r.app === key)) return
  insertInto<ReviewIgnore>('reviewIgnores', { id: genId('ri'), date: d, app: key, ts: Date.now() })
}

/** 可选项目列表（校对弹层的下拉用） */
export function reviewProjects(): Pick<Project, 'id' | 'name' | 'color' | 'status'>[] {
  return listProjects()
    .filter((p) => p.status !== 'archived')
    .map((p) => ({ id: p.id, name: p.name, color: p.color, status: p.status }))
}
