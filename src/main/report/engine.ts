/**
 * v2.9 报表生成编排 —— 七大模块串联 + 降级策略（§5.2）
 * 流程：trail → 统计(A) → 规则富化(B) → 聚合(G) → OCR 回填(D) → 计划/日历关联(C)
 *      → 达成率(C) → 模式(E) → 模板填充(F) → AI 增强(可选，v2.8 层) → 覆盖率/待确认
 */
import type {
  EnrichmentResult, GeneratedEntry, GeneratedReport, GeneratedSection,
  PlanAchievement, PlanItem, ReportEntry, ReportStats, ReportTemplate, TemplateSection, TimeEntry, TrailSegment,
  WeeklyDayReport, WeeklyGeneratedReport
} from '@shared/types'
import { genId } from '@shared/types'
import { dateKey, buildMergedTrail } from '@shared/trail'
import { detectIndustry } from '@shared/industryVocab'
import { col, listActivities, updateIn } from '../db'
import { getSettings } from '../settings'
import { todayScore } from '../attention'
import { calculateReportStats } from './stats'
import { enrichSegment } from './rulesEngine'
import { matchPlanByTime, calculatePlanAchievements, overlayTimeEntries } from './planMatcher'
import { aggregateTrail } from './aggregator'
import { attachOcrToEntries } from './ocrCollector'
import { detectPatterns } from './patterns'
import { findTemplate, getDefaultTemplate } from './templates'
import { enhanceWithAI } from './aiEnhancement'

const pad2 = (n: number): string => `${n}`.padStart(2, '0')
const hhmm = (ts: number): string => {
  const d = new Date(ts)
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`
}
/** 分钟 → "1h32m" / "43m" */
const fmtDuration = (min: number): string => {
  const m = Math.round(min)
  return m >= 60 ? `${Math.floor(m / 60)}h${pad2(m % 60)}m` : `${m}m`
}

/**
 * 生成某日结构化报表
 * @param date YYYY-MM-DD
 * @param templateId 模板 id（缺省用默认模板）
 * @param enableAI 是否叠加 AI 增强（缺省读 settings.smartReportAI）
 */
export async function generateReport(date: string, templateId?: string, enableAI?: boolean): Promise<GeneratedReport> {
  // 1. trail → segments（过滤 glance）
  const trail = buildMergedTrail(listActivities(date), date)
  const segments = trail.segments.filter((s) => !s.glance)

  // 2. 统计（模块 A）
  const stats = calculateReportStats(date)

  // 3. 当日计划 + 行业词库（userType + top5 应用检测）
  const plans = col<PlanItem>('plans').filter((p) => p.date === date)
  const vocab = detectIndustry(getSettings().userType, stats.appRanking.slice(0, 5).map((a) => a.app))

  // 4. 规则富化（模块 B）
  const enriched = new Map<string, EnrichmentResult>(
    segments.map((s) => [s.id ?? '', enrichSegment(s, { recentPlans: plans, industryVocab: vocab })])
  )

  // 5. 聚合（模块 G）
  const entries = aggregateTrail(segments, enriched)

  // 6. OCR 回填缺失字段 + dataSource 标 ocr（模块 D；后处理不动 aggregator）
  attachOcrToEntries(entries, date)

  // 7. 计划/日历关联（模块 C）：planItemId 回填 + 日历命中标 dataSource 'calendar'
  for (const entry of entries) {
    const plan = matchPlanByTime({ startTs: entry.startTs, durationMin: entry.durationMin }, plans)
    if (plan) entry.planItemId = plan.id
  }
  const dayTimeEntries = col<TimeEntry>('entries').filter((e) => e.date === date)
  const overlays = overlayTimeEntries(segments, dayTimeEntries)
  const calendarSegIds = new Set(overlays.filter((o) => o.matchType !== 'none').map((o) => o.matchedSegmentId))
  for (const entry of entries) {
    // 聚合后条目的时间窗与任一日历条目重叠/标题命中即标 calendar（段 id 可能已被合并，故直接按条目判定）
    const hit = calendarSegIds.has(entry.id) || overlays.some((o) => {
      if (o.matchType === 'none') return false
      const startMin = new Date(entry.startTs).getHours() * 60 + new Date(entry.startTs).getMinutes()
      const endMin = startMin + entry.durationMin
      return Math.min(endMin, o.entry.endMin) - Math.max(startMin, o.entry.startMin) > 0
    })
    if (hit && !entry.dataSource.includes('calendar')) entry.dataSource.push('calendar')
  }

  // 8. 计划达成率（模块 C）
  const achievements = calculatePlanAchievements(segments, plans)

  // 9. 模式检测（模块 E，近 14 天）
  const base = new Date(`${date}T00:00:00`).getTime()
  const recentDates = Array.from({ length: 14 }, (_, i) => dateKey(base - i * 86400000))
  const patterns = detectPatterns(recentDates)

  // 10. 模板填充（模块 F）
  const template = (templateId && findTemplate(templateId)) || getDefaultTemplate()
  const sections = fillTemplate(template, { date, entries, stats, achievements, plans })

  // 11. AI 增强（可选叠加，v2.8 层；当前为桩，恒走降级路径）
  let finalEntries = entries
  let aiStatus: GeneratedReport['aiStatus'] = 'disabled'
  const wantAI = enableAI ?? getSettings().smartReportAI
  if (wantAI) {
    try {
      const enhanced = await enhanceWithAI(entries, { date, stats, plans, industryVocab: vocab })
      if (enhanced) {
        finalEntries = enhanced
        aiStatus = 'enhanced'
      } else {
        aiStatus = 'fallback_to_base' // AI 不可用：降级为基础能力层结果
      }
    } catch (e) {
      console.warn('[report] AI 增强异常，降级基础层', e)
      aiStatus = 'fallback_to_base'
    }
  }

  // 12. 覆盖率与待确认
  // 覆盖率口径（自拟，注释注明）：每条 entry 计 8 个字段 ——
  // 五维(subject/contentTag/project/location/output) + 基础(app/stateLabel/planItemId)，
  // coverage = 全部条目已填字段数 / (条目数 × 8)，空日给 0
  const FIELD_KEYS: (keyof ReportEntry)[] = [
    'subject', 'contentTag', 'project', 'location', 'output', 'app', 'stateLabel', 'planItemId'
  ]
  const filled = finalEntries.reduce((a, e) => a + FIELD_KEYS.filter((k) => e[k] != null && e[k] !== '').length, 0)
  const coverage = finalEntries.length > 0 ? Math.round((filled / (finalEntries.length * FIELD_KEYS.length)) * 100) / 100 : 0
  const pendingReview = finalEntries.filter((e) => e.needsReview)

  // 13. 模板学习数据：用户模板才落库（预置模板不写库）
  if (template.source !== 'preset') {
    updateIn<ReportTemplate>('reportTemplates', template.id, {
      usageCount: template.usageCount + 1,
      lastUsed: Date.now()
    })
  }

  return {
    templateId: template.id,
    date,
    sections,
    entries: finalEntries,
    stats,
    achievements,
    patterns,
    aiStatus,
    coverage,
    pendingReview
  }
}

/** 覆盖率口径（与 generateReport §12 一致）：每条 entry 计 8 个已填字段 / (条目数 × 8) */
const COVER_FIELD_KEYS: (keyof ReportEntry)[] = [
  'subject', 'contentTag', 'project', 'location', 'output', 'app', 'stateLabel', 'planItemId'
]

function coverageOf(entries: ReportEntry[]): number {
  const filled = entries.reduce((a, e) => a + COVER_FIELD_KEYS.filter((k) => e[k] != null && e[k] !== '').length, 0)
  return entries.length > 0 ? Math.round((filled / (entries.length * COVER_FIELD_KEYS.length)) * 100) / 100 : 0
}

/** 跨天合并计划达成：按 planId 去重，actualMin 累加后按 planMatcher 口径重算 rate/status */
function mergeAchievements(list: PlanAchievement[]): PlanAchievement[] {
  const byId = new Map<string, PlanAchievement>()
  for (const a of list) {
    const prev = byId.get(a.planId)
    if (!prev) {
      byId.set(a.planId, { ...a, relatedSegmentIds: [...a.relatedSegmentIds] })
      continue
    }
    prev.actualMin += a.actualMin
    prev.relatedSegmentIds.push(...a.relatedSegmentIds)
    const rate = prev.plannedMin > 0 ? prev.actualMin / prev.plannedMin : 0
    prev.achievementRate = Math.min(rate, 1.0)
    prev.status = rate > 1.2 ? 'overtime' : rate >= 1.0 ? 'completed' : prev.actualMin === 0 ? 'missed' : 'partial'
  }
  return [...byId.values()]
}

/**
 * 生成智能周报：startDate 起 7 天（含）逐日走单日管线，再聚合
 * AI 增强复用单日管线（enableAI 透传；单日 AI 结果有 1 小时缓存，成本可控），不另起周级 LLM 调用
 */
export async function generateWeeklyReport(
  startDate: string,
  templateId?: string,
  enableAI?: boolean
): Promise<WeeklyGeneratedReport> {
  const base = new Date(`${startDate}T00:00:00`).getTime()
  const dates = Array.from({ length: 7 }, (_, i) => dateKey(base + i * 86400000))
  const endDate = dates[dates.length - 1]

  const days: WeeklyDayReport[] = []
  const allEntries: ReportEntry[] = []
  let templateIdUsed = templateId ?? getDefaultTemplate().id
  let aiStatus: WeeklyGeneratedReport['aiStatus'] = 'disabled'
  for (const date of dates) {
    const r = await generateReport(date, templateId, enableAI)
    templateIdUsed = r.templateId
    days.push({ date, entries: r.entries, stats: r.stats, achievements: r.achievements })
    allEntries.push(...r.entries)
    // 任一天 enhanced 即整周 enhanced；否则任一天 fallback 即整周 fallback
    if (r.aiStatus === 'enhanced') aiStatus = 'enhanced'
    else if (r.aiStatus === 'fallback_to_base' && aiStatus !== 'enhanced') aiStatus = 'fallback_to_base'
  }

  // 周级统计：7 天求和/有数据天均值
  const withData = days.filter((d) => d.entries.length > 0)
  const totalWorkMin = days.reduce((a, d) => a + d.stats.totalWorkMin, 0)
  const totalSlackMin = days.reduce((a, d) => a + d.stats.totalSlackMin, 0)
  const weekStats = {
    totalWorkMin,
    totalSlackMin,
    workSlackRatio: totalSlackMin > 0 ? Math.round((totalWorkMin / totalSlackMin) * 100) / 100 : totalWorkMin > 0 ? 999 : 0,
    daysWithData: withData.length,
    avgFocusScore: withData.length > 0
      ? Math.round(withData.reduce((a, d) => a + d.stats.focusScore, 0) / withData.length)
      : 0
  }

  // 模式检测：以 endDate 为基准的近 14 天（与单日管线同口径）
  const endBase = new Date(`${endDate}T00:00:00`).getTime()
  const recentDates = Array.from({ length: 14 }, (_, i) => dateKey(endBase - i * 86400000))
  const patterns = detectPatterns(recentDates)

  return {
    startDate: dates[0],
    endDate,
    templateId: templateIdUsed,
    days,
    weekStats,
    achievements: mergeAchievements(days.flatMap((d) => d.achievements)),
    patterns,
    aiStatus,
    coverage: coverageOf(allEntries),
    pendingReview: allEntries.filter((e) => e.needsReview)
  }
}

// ───────────────────────── 模板填充（v2.8 §4.3：filter → groupBy → sortBy → 字段提取 → format 占位替换） ─────────────────────────

interface FillContext {
  date: string
  entries: ReportEntry[]
  stats: ReportStats
  achievements: ReturnType<typeof calculatePlanAchievements>
  plans: PlanItem[]
}

/** 条目原始字段值（format {key} 占位替换用） */
function rawValuesOf(entry: ReportEntry, ctx: FillContext): Record<string, string> {
  const achievement = entry.planItemId ? ctx.achievements.find((a) => a.planId === entry.planItemId) : undefined
  const planStatusLabel = achievement
    ? { completed: '已完成', partial: '部分完成', missed: '未完成', overtime: '超时完成' }[achievement.status]
    : ''
  return {
    start: hhmm(entry.startTs),
    end: hhmm(entry.endTs),
    time: `${hhmm(entry.startTs)}-${hhmm(entry.endTs)} (${fmtDuration(entry.durationMin)})`,
    duration: fmtDuration(entry.durationMin),
    stateLabel: entry.stateLabel,
    app: entry.app ?? '',
    subject: entry.subject ?? '',
    contentTag: entry.contentTag ?? '',
    contentSummary: entry.contentSummary ?? '',
    project: entry.project ?? '',
    location: entry.location ?? '',
    output: entry.output ?? '',
    planStatus: planStatusLabel,
    notes: ''
  }
}

/** 概览指标（metric_summary 段）：取自 stats / attention todayScore / entries 聚合 */
function metricValues(ctx: FillContext): Record<string, string> {
  const { stats, achievements, entries, date } = ctx
  // 计划达成率：当天用 v2.6 注意力评分的 planAchievement 口径，历史日期用 achievements 均值
  let planRate = 0
  if (achievements.length > 0) {
    if (date === dateKey(Date.now())) {
      try {
        planRate = Math.round(todayScore().bonus.planAchievement * 100)
      } catch {
        planRate = Math.round((achievements.reduce((a, x) => a + x.achievementRate, 0) / achievements.length) * 100)
      }
    } else {
      planRate = Math.round((achievements.reduce((a, x) => a + x.achievementRate, 0) / achievements.length) * 100)
    }
  }
  // 主要项目：条目中出现时长最长的 project
  const projMin = new Map<string, number>()
  for (const e of entries) {
    if (e.project) projMin.set(e.project, (projMin.get(e.project) ?? 0) + e.durationMin)
  }
  const topProject = [...projMin.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? ''
  return {
    totalWork: fmtDuration(stats.totalWorkMin),
    focusScore: `${stats.focusScore}分`,
    slackTime: fmtDuration(stats.totalSlackMin),
    planRate: `${planRate}%`,
    topApp: stats.appRanking[0]?.app ?? '',
    topProject
  }
}

/** section.filter + timeRange 过滤条目 */
function filterEntries(section: TemplateSection, entries: ReportEntry[]): ReportEntry[] {
  let out = entries
  const f = section.filter
  if (f?.states?.length) out = out.filter((e) => f.states!.includes(e.state))
  if (f?.timeSlot?.length) out = out.filter((e) => f.timeSlot!.includes(e.timeSlot))
  if (f?.minDuration != null) out = out.filter((e) => e.durationMin >= f.minDuration!)
  if (section.timeRange) {
    const [sh, sm] = section.timeRange.start.split(':').map(Number)
    const [eh, em] = section.timeRange.end.split(':').map(Number)
    const from = sh * 60 + sm
    const to = eh * 60 + em
    out = out.filter((e) => {
      const d = new Date(e.startTs)
      const m = d.getHours() * 60 + d.getMinutes()
      return m >= from && m < to
    })
  }
  return out
}

/** groupBy / sortBy 排序（groupBy 仅影响排列顺序：同组相邻；分组聚合展示由渲染层负责） */
function sortEntries(section: TemplateSection, entries: ReportEntry[]): ReportEntry[] {
  const out = [...entries]
  if (section.sortBy === 'duration') out.sort((a, b) => b.durationMin - a.durationMin)
  else out.sort((a, b) => a.startTs - b.startTs) // chronological 默认
  if (section.groupBy === 'project') {
    out.sort((a, b) => (a.project ?? '').localeCompare(b.project ?? ''))
    if (section.sortBy === 'duration') out.sort((a, b) => b.durationMin - a.durationMin)
  }
  return out
}

/** 单条目字段提取 + format {key} 占位替换 + fallback 缺失文案 */
function buildGeneratedEntry(entry: ReportEntry, section: TemplateSection, ctx: FillContext): GeneratedEntry {
  const raw = rawValuesOf(entry, ctx)
  const fieldValues: GeneratedEntry['fieldValues'] = {}
  for (const field of section.fields) {
    let value = field.format
      ? field.format.replace(/\{(\w+)\}/g, (_, k: string) => raw[k] ?? '')
      : (raw[field.key] ?? '')
    if (!value && field.fallback) value = field.fallback
    fieldValues[field.key] = { value, confidence: entry.confidence, source: entry.dataSource.join('+') }
  }
  return { reportEntry: entry, fieldValues, needsReview: entry.needsReview }
}

/** 概览段的伪条目（fieldValues 来自统计指标，无对应 ReportEntry，合成一条占位） */
function buildMetricEntry(section: TemplateSection, ctx: FillContext): GeneratedEntry {
  const metrics = metricValues(ctx)
  const fieldValues: GeneratedEntry['fieldValues'] = {}
  for (const field of section.fields) {
    let value = metrics[field.key] ?? ''
    if (!value && field.fallback) value = field.fallback
    if (value) fieldValues[field.key] = { value, confidence: 1, source: 'stats' }
  }
  const stub: ReportEntry = {
    id: `${section.id}-metrics`,
    date: ctx.date,
    startTs: new Date(`${ctx.date}T00:00:00`).getTime(),
    endTs: new Date(`${ctx.date}T00:00:00`).getTime(),
    durationMin: ctx.stats.totalWorkMin,
    timeSlot: 'morning',
    state: 'focus',
    stateLabel: '概览',
    dataSource: ['auto'],
    confidence: 1,
    needsReview: false,
    ts: Date.now()
  }
  return { reportEntry: stub, fieldValues, needsReview: false }
}

/** 明日计划段：明日计划 + 今日未完成计划合成条目 */
function buildPlanTomorrowEntries(section: TemplateSection, ctx: FillContext): GeneratedEntry[] {
  const tomorrow = dateKey(new Date(`${ctx.date}T00:00:00`).getTime() + 86400000)
  const tomorrowPlans = col<PlanItem>('plans').filter((p) => p.date === tomorrow && p.status !== 'cancelled')
  const unfinished = ctx.plans.filter((p) => p.status === 'planned' || p.status === 'in_progress' || p.status === 'partial')
  const toEntry = (p: PlanItem, tag: string): GeneratedEntry => {
    const dayBase = new Date(`${p.date}T00:00:00`).getTime()
    const startTs = p.startMin != null ? dayBase + p.startMin * 60000 : dayBase + 9 * 3600000
    const dur = p.durationMin ?? (p.startMin != null && p.endMin != null ? p.endMin - p.startMin : 60)
    const stub: ReportEntry = {
      id: p.id,
      date: p.date,
      startTs,
      endTs: startTs + dur * 60000,
      durationMin: dur,
      timeSlot: 'morning',
      state: 'focus',
      stateLabel: tag,
      contentTag: p.title,
      project: p.title,
      dataSource: ['calendar'],
      confidence: 1,
      needsReview: false,
      planItemId: p.id,
      ts: Date.now()
    }
    return buildGeneratedEntry(stub, section, ctx)
  }
  return [
    ...tomorrowPlans.map((p) => toEntry(p, '明日计划')),
    ...unfinished.map((p) => toEntry(p, '未完成计划'))
  ]
}

/** 模板填充主流程（v2.8 §4.3） */
function fillTemplate(template: ReportTemplate, ctx: FillContext): GeneratedSection[] {
  return template.sections.map((section) => {
    let genEntries: GeneratedEntry[] = []

    if (section.type === 'metric_summary') {
      genEntries = [buildMetricEntry(section, ctx)]
    } else if (section.type === 'plan_tomorrow') {
      genEntries = buildPlanTomorrowEntries(section, ctx)
    } else if (section.type === 'free_text') {
      // 自由文本段：无自动数据，留空给用户编辑
      genEntries = []
    } else {
      let pool = filterEntries(section, ctx.entries)
      pool = sortEntries(section, pool)
      if (section.type === 'achievement') pool = pool.slice(0, 3) // achievement 段按时长 top3
      genEntries = pool.map((e) => buildGeneratedEntry(e, section, ctx))
    }

    // 未填充字段：必填且无值、无 fallback 的字段
    const unfilledFields = section.fields
      .filter((f) => f.required && !f.fallback && genEntries.every((ge) => !ge.fieldValues[f.key]?.value))
      .map((f) => f.key)

    return { sectionId: section.id, title: section.title, entries: genEntries, unfilledFields }
  })
}

/** 供 IPC 复用：genId 前缀 tpl */
export function newTemplateId(): string {
  return genId('tpl')
}
