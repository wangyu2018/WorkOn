/**
 * 人生预期轨迹引擎（v10 人生规划模拟）
 * 用户声明预期（时间+事件）→ AI/手动拆锚点 → 真实行为归因当「实际位置」
 * → 偏离预警（notify）+ 周期高度预估（近14天速率外推 + 工作流改善杠杆）
 * 存储：db.json 的 lifeGoals / goalDayStates 两个集合
 */
import { col, insertInto, updateIn, removeFrom, listActivities } from './db'
import { buildMergedTrail, dateKey } from '@shared/trail'
import { genId } from '@shared/types'
import type {
  LifeGoal, GoalAnchor, GoalDayState, GoalForecast, GoalLever, GoalView, GoalDraft,
  MergedTrail, TrailSegment, WorkState
} from '@shared/types'
import { fuzzyMatch } from '@shared/fuzzy'
import { canonAppKey } from '@shared/appDisplayName'
import { categoryOfWithOverride } from '@shared/appCategory'
import { listBindings, type ProjectBinding } from './attributions'
import { dayProjectLinks } from './projects'
import { pushNotify } from './notify'
import { llmChat, extractJson } from './ai'
import { getSettings } from './settings'
import { isIdeApp } from './pathHint'

/** 这些状态不算「投入」：人在但没朝目标走 */
const NON_INVEST_STATES = new Set<WorkState>(['slack', 'relax', 'idle', 'away', 'break', 'lunch'])

const DAY_MS = 86_400_000

// ───────────────────────── 工具 ─────────────────────────

function parseDate(d: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d)
  if (!m) return NaN
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime()
}

function fmtDate(ts: number): string {
  const d = new Date(ts)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function daysBetween(from: string, to: string): number {
  return Math.round((parseDate(to) - parseDate(from)) / DAY_MS)
}

function appKey(app: string): string {
  return canonAppKey(app) || app.trim().toLowerCase().replace(/\.exe$/i, '')
}

// ───────────────────────── 归因 ─────────────────────────

/**
 * 段是否归因到该目标：
 * ① 目标自身关键词命中标题/应用
 * ② 绑定项目的软绑定命中（dirs > keywords > apps；IDE/浏览器不吃整应用绑，与归属引擎同口径）
 * ③ 绑定项目的当日应用归类（projectTimeLinks）
 */
function segMatchesGoal(
  goal: LifeGoal,
  seg: TrailSegment,
  dayLinks: { app: string; projectId: string }[],
  bindings: ProjectBinding[]
): boolean {
  const title = seg.mainTitle ?? ''
  const app = seg.mainApp ?? ''
  for (const k of goal.attribution.keywords) {
    if (k && (fuzzyMatch(title, k) || fuzzyMatch(app, k))) return true
  }
  const key = appKey(app)
  const rawKey = app.trim().toLowerCase().replace(/\.exe$/i, '')
  const multiCtx =
    isIdeApp(app) || categoryOfWithOverride(app, getSettings().appCategoryOverride) === 'browser'
  for (const pid of goal.attribution.projectIds) {
    // projectTimeLinks 存的是小写原名（linkAppToProject 口径），两种键都比
    if (dayLinks.some((l) => l.projectId === pid && (l.app === rawKey || canonAppKey(l.app) === key))) return true
    for (const b of bindings) {
      if (b.projectId !== pid) continue
      const blob = title.toLowerCase()
      if (b.dirs.some((d) => d && blob.includes(d.trim().toLowerCase()))) return true
      if (b.keywords.some((k) => k && fuzzyMatch(title, k))) return true
      if (!multiCtx && b.apps.some((a) => a && appKey(a) === key)) return true
    }
  }
  return false
}

/** 当日 trail/链接缓存：多目标结算同一天只建一次轨迹 */
const settleCtx = new Map<string, { trail: MergedTrail | null; dayLinks: { app: string; projectId: string }[]; bindings: ProjectBinding[] }>()

function settleCtxFor(date: string): { trail: MergedTrail | null; dayLinks: { app: string; projectId: string }[]; bindings: ProjectBinding[] } {
  let ctx = settleCtx.get(date)
  if (!ctx) {
    const acts = listActivities(date)
    ctx = {
      trail: acts.length ? buildMergedTrail(acts, date) : null,
      dayLinks: dayProjectLinks(date),
      bindings: listBindings()
    }
    settleCtx.set(date, ctx)
    if (settleCtx.size > 10) settleCtx.delete(settleCtx.keys().next().value as string)
  }
  return ctx
}

/** 结算某目标某天的归因分钟（幂等覆盖 goalDayStates） */
function settleGoalDay(goal: LifeGoal, date: string): number {
  const ctx = settleCtxFor(date)
  let min = 0
  if (ctx.trail) {
    for (const seg of ctx.trail.segments) {
      if (seg.glance || NON_INVEST_STATES.has(seg.mainState)) continue
      if (segMatchesGoal(goal, seg, ctx.dayLinks, ctx.bindings)) min += seg.durationMin
    }
  }
  const id = `${goal.id}:${date}`
  const exist = col<GoalDayState>('goalDayStates').find((s) => s.id === id)
  const cumMin =
    col<GoalDayState>('goalDayStates')
      .filter((s) => s.goalId === goal.id && s.date < date)
      .reduce((a, s) => a + s.investedMin, 0) + min
  if (exist) updateIn<GoalDayState>('goalDayStates', id, { investedMin: min, cumMin, ts: Date.now() })
  else insertInto<GoalDayState>('goalDayStates', { id, goalId: goal.id, date, investedMin: min, cumMin, ts: Date.now() })
  return min
}

/** 确保某日所有 active 目标已结算（当天总是重算，历史缺账回填） */
let lastTodaySettleAt = 0

function ensureSettled(date: string, today: string): void {
  // 当日结算 30s 节流：listGoalViews 对 N 个目标各调一次时避免 O(N²) 轨迹重建
  if (date === today && Date.now() - lastTodaySettleAt < 30_000) return
  const settled = new Set(col<GoalDayState>('goalDayStates').filter((s) => s.date === date).map((s) => s.goalId))
  for (const g of col<LifeGoal>('lifeGoals')) {
    if (g.status !== 'active') continue
    if (date === today || !settled.has(g.id)) settleGoalDay(g, date)
  }
  if (date === today) lastTodaySettleAt = Date.now()
}

// ───────────────────────── 轨迹与预警 ─────────────────────────

function cumOf(goalId: string): number {
  return col<GoalDayState>('goalDayStates')
    .filter((s) => s.goalId === goalId)
    .reduce((a, s) => a + s.investedMin, 0)
}

function totalTargetOf(goal: LifeGoal): number {
  const last = goal.anchors[goal.anchors.length - 1]
  const totalDays = Math.max(1, daysBetween(fmtDate(goal.createdAt), goal.deadline))
  return Math.max(last?.cumTargetMin ?? 0, goal.dailyTargetMin * totalDays, 1)
}

/** 当前活动偏离（视图徽章与预警共用一套口径） */
function currentDeviations(goal: LifeGoal, today: string): string[] {
  const alerts: string[] = []
  const states = col<GoalDayState>('goalDayStates').filter((s) => s.goalId === goal.id)
  // 连续零投入（从最近结算日往前数）
  const desc = [...states].sort((a, b) => b.date.localeCompare(a.date))
  let zeroStreak = 0
  for (const s of desc) {
    if (s.investedMin <= 0) zeroStreak++
    else break
  }
  if (zeroStreak >= 3) alerts.push(`已连续 ${zeroStreak} 天零投入`)
  // 近 7 天投入不足计划六成
  const last7 = states.filter((s) => daysBetween(s.date, today) < 7)
  const plan7 = goal.dailyTargetMin * 7
  const inv7 = last7.reduce((a, s) => a + s.investedMin, 0)
  if (plan7 > 0 && inv7 < plan7 * 0.6) alerts.push(`近 7 天投入 ${Math.round(inv7)} 分钟，不足计划六成`)
  // 锚点临近/逾期
  for (const a of goal.anchors) {
    if (a.status !== 'pending') continue
    const dd = daysBetween(today, a.targetDate)
    const cum = cumOf(goal.id)
    if (dd < 0) alerts.push(`锚点「${a.title}」已逾期 ${-dd} 天`)
    else if (dd <= 7 && cum < a.cumTargetMin * 0.8) alerts.push(`锚点「${a.title}」还剩 ${dd} 天，投入进度 ${Math.round((cum / Math.max(1, a.cumTargetMin)) * 100)}%`)
  }
  return alerts
}

/** 高度预估：近 14 天速率外推 + 工作流改善杠杆 what-if */
function computeForecast(goal: LifeGoal, today: string): GoalForecast | null {
  const states = col<GoalDayState>('goalDayStates').filter((s) => s.goalId === goal.id)
  if (!states.length) return null
  const recent = states.filter((s) => daysBetween(s.date, today) < 14)
  const pace = recent.reduce((a, s) => a + s.investedMin, 0) / Math.max(1, recent.length)
  const remaining = Math.max(0, daysBetween(today, goal.deadline))
  const cum = cumOf(goal.id)
  const total = totalTargetOf(goal)
  const projectedCum = cum + pace * remaining
  const completionPct = Math.min(1, projectedCum / total)
  let projectedAnchorIdx = 0
  for (const a of goal.anchors) if (a.cumTargetMin <= projectedCum) projectedAnchorIdx = a.idx
  const projectedAnchor = goal.anchors.find((a) => a.idx === projectedAnchorIdx)

  // 改善杠杆：近 7 天可转化时间 → 重新算完成度
  const levers: GoalLever[] = []
  const last7Days = [...new Set(states.map((s) => s.date))]
    .sort()
    .slice(-7)
  let slackAvg = 0
  let glanceAvg = 0
  let counted = 0
  for (const d of last7Days) {
    const trail = settleCtxFor(d).trail
    if (!trail?.totalMin) continue
    counted++
    slackAvg += (trail.stateMinutes.slack ?? 0) + (trail.stateMinutes.relax ?? 0)
    glanceAvg += trail.glanceMin
  }
  if (counted) {
    slackAvg /= counted
    glanceAvg /= counted
    const pct = (gain: number): number =>
      Math.min(1, (cum + (pace + gain) * remaining) / total)
    if (slackAvg >= 20) {
      const gain = slackAvg * 0.5
      levers.push({ label: `摸鱼/放松时段转化一半（日均 ${Math.round(slackAvg)} 分钟）`, gainMinPerDay: Math.round(gain), newCompletionPct: pct(gain) })
    }
    if (glanceAvg >= 10) {
      const gain = glanceAvg * 0.5
      levers.push({ label: `减少短切换折损（日均 ${Math.round(glanceAvg)} 分钟）`, gainMinPerDay: Math.round(gain), newCompletionPct: pct(gain) })
    }
  }

  return {
    goalId: goal.id,
    computedAt: Date.now(),
    paceMinPerDay: Math.round(pace * 10) / 10,
    requiredMinPerDay: Math.round(Math.max(0, total - cum) / Math.max(1, remaining)),
    projectedCumMin: Math.round(projectedCum),
    completionPct,
    projectedAnchorIdx,
    projectedAnchorTitle: projectedAnchor?.title ?? '',
    levers
  }
}

export function computeGoalView(goal: LifeGoal): GoalView {
  const today = dateKey(Date.now())
  ensureSettled(today, today)
  const cum = cumOf(goal.id)
  const created = fmtDate(goal.createdAt)
  const elapsed = Math.max(0, daysBetween(created, today))
  const planned = goal.dailyTargetMin * elapsed
  return {
    goal,
    cumMin: Math.round(cum),
    investedTodayMin: Math.round(
      col<GoalDayState>('goalDayStates').find((s) => s.id === `${goal.id}:${today}`)?.investedMin ?? 0
    ),
    plannedCumMin: Math.round(planned),
    totalTargetMin: Math.round(totalTargetOf(goal)),
    paceRatio: planned > 0 ? cum / planned : 1,
    remainingDays: Math.max(0, daysBetween(today, goal.deadline)),
    forecast: goal.status === 'active' ? computeForecast(goal, today) : null,
    alerts: goal.status === 'active' ? currentDeviations(goal, today) : []
  }
}

// ───────────────────────── CRUD ─────────────────────────

export function listGoalViews(): GoalView[] {
  return col<LifeGoal>('lifeGoals').map(computeGoalView)
}

export function createGoal(input: {
  sourceText: string
  event: string
  deadline: string
  keywords: string[]
  projectIds: string[]
  dailyTargetMin: number
  anchors: { title: string; targetDate: string; cumTargetMin: number }[]
}): LifeGoal {
  const now = Date.now()
  const goal = insertInto<LifeGoal>('lifeGoals', {
    id: genId('gl'),
    sourceText: input.sourceText,
    event: input.event,
    deadline: input.deadline,
    attribution: { projectIds: input.projectIds, keywords: input.keywords },
    anchors: input.anchors.map((a, i) => ({
      id: genId('ga'),
      idx: i + 1,
      title: a.title,
      targetDate: a.targetDate,
      cumTargetMin: a.cumTargetMin,
      status: 'pending' as const
    })),
    dailyTargetMin: input.dailyTargetMin,
    status: 'active',
    alertsSent: {},
    createdAt: now,
    updatedAt: now
  })
  settleGoalDay(goal, dateKey(now))
  return goal
}

export function updateGoal(
  id: string,
  patch: Partial<Pick<LifeGoal, 'event' | 'deadline' | 'dailyTargetMin' | 'status'>> & {
    keywords?: string[]
    projectIds?: string[]
    addAnchor?: { title: string; targetDate: string; cumTargetMin?: number }
    removeAnchorId?: string
    markAnchor?: { anchorId: string; status: 'hit' | 'missed' | 'pending' }
  }
): LifeGoal | null {
  const goal = col<LifeGoal>('lifeGoals').find((g) => g.id === id)
  if (!goal) return null
  const anchors = [...goal.anchors]
  if (patch.addAnchor) {
    anchors.push({
      id: genId('ga'),
      idx: anchors.length + 1,
      title: patch.addAnchor.title,
      targetDate: patch.addAnchor.targetDate,
      cumTargetMin: patch.addAnchor.cumTargetMin ?? Math.round(totalTargetOf(goal) * 0.9),
      status: 'pending'
    })
    anchors.sort((a, b) => a.targetDate.localeCompare(b.targetDate))
    anchors.forEach((a, i) => (a.idx = i + 1))
  }
  if (patch.removeAnchorId) {
    const idx = anchors.findIndex((a) => a.id === patch.removeAnchorId)
    if (idx >= 0) anchors.splice(idx, 1)
    anchors.forEach((a, i) => (a.idx = i + 1))
  }
  if (patch.markAnchor) {
    const a = anchors.find((x) => x.id === patch.markAnchor!.anchorId)
    if (a) {
      a.status = patch.markAnchor.status
      a.doneAt = a.status === 'hit' ? Date.now() : undefined
    }
  }
  return updateIn<LifeGoal>('lifeGoals', id, {
    ...(patch.event !== undefined ? { event: patch.event } : {}),
    ...(patch.deadline !== undefined ? { deadline: patch.deadline } : {}),
    ...(patch.dailyTargetMin !== undefined ? { dailyTargetMin: patch.dailyTargetMin } : {}),
    ...(patch.status !== undefined ? { status: patch.status } : {}),
    ...(patch.keywords !== undefined ? { attribution: { ...goal.attribution, keywords: patch.keywords } } : {}),
    ...(patch.projectIds !== undefined ? { attribution: { ...goal.attribution, projectIds: patch.projectIds } } : {}),
    anchors,
    updatedAt: Date.now()
  })
}

export function removeGoal(id: string): boolean {
  return removeFrom('lifeGoals', id)
}

// ───────────────────────── 预期拆解（AI + 本地兜底） ─────────────────────────

/** 本地时间锚点解析：「年底前」「三个月后」「6月前」→ YYYY-MM-DD */
const CN_NUM: Record<string, number> = { 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 }

function cnOrDigit(s: string): number {
  return CN_NUM[s] ?? parseInt(s, 10)
}

export function parseDeadline(text: string): string | null {
  const now = new Date()
  const y = now.getFullYear()
  const lastDayOf = (yy: number, mm: number): string => fmtDate(new Date(yy, mm, 0).getTime())
  let m: RegExpExecArray | null
  if ((m = /(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*[日号]/.exec(text))) {
    const candidate = parseDate(`${m[1]}-${String(+m[2]).padStart(2, '0')}-${String(+m[3]).padStart(2, '0')}`)
    if (!isNaN(candidate)) return fmtDate(candidate)
  }
  if ((m = /(\d{4})\s*年\s*(\d{1,2})\s*月\s*(底|末|前|之前)/.exec(text))) return lastDayOf(+m[1], +m[2])
  if ((m = /明年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*[日号]/.exec(text)))
    return fmtDate(parseDate(`${y + 1}-${String(+m[1]).padStart(2, '0')}-${String(+m[2]).padStart(2, '0')}`))
  if ((m = /明年\s*(\d{1,2})\s*月\s*(底|末|前|之前)?/.exec(text))) return lastDayOf(y + 1, +m[1])
  if (/明年\s*(底|年底)/.test(text)) return `${y + 1}-12-31`
  if ((m = /(\d{1,2})\s*月\s*(\d{1,2})\s*[日号]/.exec(text))) {
    const mm = +m[1]
    const dd = +m[2]
    if (mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31) {
      const candidate = parseDate(`${y}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`)
      return fmtDate(candidate > now.getTime() ? candidate : parseDate(`${y + 1}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`))
    }
  }
  if ((m = /(\d{1,2})\s*月\s*(底|末|前|之前)/.exec(text))) {
    const mm = +m[1]
    if (mm >= 1 && mm <= 12) {
      const candidate = parseDate(lastDayOf(y, mm))
      return lastDayOf(candidate > now.getTime() ? y : y + 1, mm)
    }
  }
  if (/今年\s*(底|年底)|年底/.test(text)) {
    const candidate = parseDate(`${y}-12-31`)
    return `${candidate - now.getTime() > 30 * DAY_MS ? y : y + 1}-12-31`
  }
  if ((m = /半\s*年\s*(后|内|之后)/.exec(text))) return fmtDate(now.getTime() + 183 * DAY_MS)
  if ((m = /一\s*年\s*(后|内|之后)|一年\s*内/.exec(text))) return fmtDate(now.getTime() + 365 * DAY_MS)
  if ((m = /(\d+|十|十一|十二|[一二两三四五六七八九])\s*个?\s*月\s*(后|内|之后|以后|里)/.exec(text))) {
    const d = new Date(now)
    d.setMonth(d.getMonth() + cnOrDigit(m[1]))
    return fmtDate(d.getTime())
  }
  if ((m = /(\d+|十|十一|十二|[一二两三四五六七八九])\s*个?\s*周\s*(后|内|之后)/.exec(text)))
    return fmtDate(now.getTime() + cnOrDigit(m[1]) * 7 * DAY_MS)
  if ((m = /(\d+|十|十一|十二|[一二两三四五六七八九])\s*天\s*(后|内|之后)/.exec(text)))
    return fmtDate(now.getTime() + cnOrDigit(m[1]) * DAY_MS)
  return null
}

/** 拆解草稿附带的项目绑定建议：事件/关键词与既有项目名模糊命中 */
function suggestProjectIds(event: string, keywords: string[]): string[] {
  const ids = new Set<string>()
  const hay = `${event} ${keywords.join(' ')}`
  for (const p of col<import('@shared/types').Project>('projects')) {
    if (p.status === 'archived' || p.status === 'done') continue
    if (p.name && (fuzzyMatch(hay, p.name) || keywords.some((k) => k && fuzzyMatch(p.name, k)))) ids.add(p.id)
  }
  return [...ids].slice(0, 3)
}

/** 本地兜底拆解：deadline + 线性三等分锚点 */
function localDecompose(text: string, deadline: string): GoalDraft {
  const event =
    text
      .replace(/^(我|俺)?\s*(想|要|打算|希望|计划|目标(是|为)?|争取)\s*/g, '')
      .replace(/(在|到|截至|争取)?\s*[^，。；\s]*(年底|月底|年|月|周|天|后|内|之前|前)\s*(之前|前|内|后)?\s*/g, '')
      .trim()
      .slice(0, 40) || '人生预期'
  const totalDays = Math.max(7, daysBetween(dateKey(Date.now()), deadline))
  const daily = 90
  const total = daily * totalDays
  const dl = parseDate(deadline)
  const anchorAt = (frac: number, title: string): { title: string; targetDate: string; cumTargetMin: number } => ({
    title,
    targetDate: fmtDate(Date.now() + (dl - Date.now()) * frac),
    cumTargetMin: Math.round(total * frac)
  })
  const keywords = event.replace(/[的地得了，。！？；：\s]+/g, ' ').split(' ').filter((w) => w.length >= 2).slice(0, 4)
  return {
    event,
    deadline,
    dailyTargetMin: daily,
    keywords,
    projectIds: suggestProjectIds(event, keywords),
    anchors: [anchorAt(1 / 3, '第一阶段'), anchorAt(2 / 3, '第二阶段'), anchorAt(1, event)],
    source: 'local'
  }
}

/** 预期拆解：优先 LLM（DeepSeek 等），失败回退本地线性拆解 */
export async function decomposeGoal(sourceText: string, hint?: string): Promise<GoalDraft | null> {
  const deadline = parseDeadline(sourceText)
  if (!deadline) return null // 连时间都听不出来，不建目标
  const totalDays = Math.max(7, daysBetween(dateKey(Date.now()), deadline))
  const sys =
    '你是人生预期拆解器。把用户的一句话预期拆成可核验的锚点轨迹。' +
    '只输出 JSON：{"event":"一句话事件","dailyTargetMin":每天建议投入分钟数30-240,' +
    '"keywords":["匹配桌面窗口标题用的关键词2-5个"],' +
    '"anchors":[{"title":"锚点名","progress":0-100,"date":"YYYY-MM-DD"}]}。' +
    `终点日期 ${deadline}，共 ${totalDays} 天。锚点 3-6 个，progress 递增且最后一个=100。`
  const user = hint ? `预期：「${sourceText}」。用户反馈上一版拆解：${hint}` : `预期：「${sourceText}」`
  const raw = await llmChat([{ role: 'system', content: sys }, { role: 'user', content: user }], 30_000, 'standard')
  const parsed = raw
    ? extractJson<{ event?: string; dailyTargetMin?: number; keywords?: string[]; anchors?: { title?: string; progress?: number; date?: string }[] }>(raw)
    : null
  if (!parsed?.anchors?.length) return localDecompose(sourceText, deadline)
  const daily = Math.min(240, Math.max(30, Math.round(parsed.dailyTargetMin ?? 90)))
  const total = daily * totalDays
  const anchors = parsed.anchors
    .filter((a) => a.title && a.date)
    .map((a) => ({
      title: String(a.title).slice(0, 30),
      targetDate: /^\d{4}-\d{2}-\d{2}$/.test(a.date ?? '') ? String(a.date) : deadline,
      cumTargetMin: Math.round((total * Math.min(100, Math.max(1, a.progress ?? 100))) / 100)
    }))
    .sort((a, b) => a.targetDate.localeCompare(b.targetDate))
  if (!anchors.length) return localDecompose(sourceText, deadline)
  const event = (parsed.event ?? sourceText).slice(0, 40)
  const keywords = (parsed.keywords ?? []).map((k) => String(k).slice(0, 20)).slice(0, 6)
  return {
    event,
    deadline,
    dailyTargetMin: daily,
    keywords,
    projectIds: suggestProjectIds(event, keywords),
    anchors,
    source: 'ai'
  }
}

// ───────────────────────── 周期任务：结算 + 预警 + 周期预估 ─────────────────────────

function oncePerDay(goal: LifeGoal, key: string, today: string): boolean {
  return goal.alertsSent?.[key] !== today
}

function markAlerted(goal: LifeGoal, key: string, today: string): void {
  updateIn<LifeGoal>('lifeGoals', goal.id, {
    alertsSent: { ...(goal.alertsSent ?? {}), [key]: today }
  })
}

/** 偏离预警：走 notify（v10 折下自动承接），每个告警每天至多一次 */
function checkDeviations(today: string): void {
  for (const goal of col<LifeGoal>('lifeGoals')) {
    if (goal.status !== 'active') continue
    const alerts = currentDeviations(goal, today)
    if (!alerts.length) continue
    const key = `dev:${alerts[0].slice(0, 12)}`
    if (!oncePerDay(goal, key, today)) continue
    pushNotify('ai', `预期偏离 · ${goal.event}`, alerts.join('；'), [
      { label: '知道了', action: 'dismiss', primary: true }
    ], 45)
    markAlerted(goal, key, today)
  }
}

/** 周期性高度预估：每个 active 目标每 7 天推一次「现在能到什么高度」 */
function periodicForecast(today: string): void {
  for (const goal of col<LifeGoal>('lifeGoals')) {
    if (goal.status !== 'active') continue
    if (Date.now() - (goal.lastForecastNotifyAt ?? 0) < 7 * DAY_MS) continue
    const f = computeForecast(goal, today)
    if (!f) continue
    updateIn<LifeGoal>('lifeGoals', goal.id, { lastForecastNotifyAt: Date.now() })
    const reach = f.projectedAnchorTitle ? `，落点「${f.projectedAnchorTitle}」` : '，一个锚点都到不了'
    const lever = f.levers[0]
      ? ` 若${f.levers[0].label}，完成度可到 ${Math.round(f.levers[0].newCompletionPct * 100)}%。`
      : ''
    pushNotify(
      'ai',
      `高度预估 · ${goal.event}`,
      `按近 14 天节奏（日均 ${Math.round(f.paceMinPerDay)} 分钟），到期预计完成 ${Math.round(f.completionPct * 100)}%${reach}。达标需日均 ${f.requiredMinPerDay} 分钟。${lever}`,
      [{ label: '知道了', action: 'dismiss', primary: true }],
      60
    )
  }
}

/** 挂到 index.ts 周期任务：每 30 分钟结算当日 + 检查偏离 + 周频预估推送 */
export function initLifeGoalJobs(): void {
  const run = (): void => {
    try {
      const today = dateKey(Date.now())
      ensureSettled(today, today)
      checkDeviations(today)
      periodicForecast(today)
    } catch (e) {
      console.warn('[lifeGoal] 周期任务失败', e)
    }
  }
  run()
  setInterval(run, 30 * 60 * 1000)
}
