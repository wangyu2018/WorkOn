/**
 * v2.9 模块 C：计划日历关联 —— PlanItem/日历条目自动匹配报表条目（纯本地，无模型）
 * 依据：design-spec-v2.9 §3.C
 * 规则：段与计划时间窗重叠率 >0.5 判定关联；无时间窗的计划用标题关键词匹配（mainTitle 包含）
 */
import type { PlanItem, PlanAchievement, TimeEntry, TrailSegment } from '@shared/types'

/** 段起止 → 当日分钟（0-1440+，跨午夜可超 1440） */
function segMinRange(seg: Pick<TrailSegment, 'startTs' | 'durationMin'>): { startMin: number; endMin: number } {
  const d = new Date(seg.startTs)
  const startMin = d.getHours() * 60 + d.getMinutes()
  return { startMin, endMin: startMin + seg.durationMin }
}

/** 两时间窗重叠分钟 */
function overlapMin(a: { startMin: number; endMin: number }, b: { startMin: number; endMin: number }): number {
  return Math.max(0, Math.min(a.endMin, b.endMin) - Math.max(a.startMin, b.startMin))
}

/**
 * 段 → 最匹配的计划项（时间重叠率 >0.5 取最优；无时间窗的计划回退标题包含匹配）
 */
export function matchPlanByTime(
  segment: Pick<TrailSegment, 'startTs' | 'durationMin' | 'mainTitle'>,
  plans: PlanItem[]
): PlanItem | null {
  const segRange = segMinRange(segment)
  const segLen = segRange.endMin - segRange.startMin
  let bestMatch: PlanItem | null = null
  let bestOverlap = 0

  for (const plan of plans) {
    if (plan.startMin == null || plan.endMin == null) continue
    const overlap = overlapMin(segRange, { startMin: plan.startMin, endMin: plan.endMin })
    const ratio = segLen > 0 ? overlap / segLen : 0
    if (ratio > 0.5 && ratio > bestOverlap) {
      bestMatch = plan
      bestOverlap = ratio
    }
  }
  if (bestMatch) return bestMatch

  // 无时间窗的计划：标题关键词匹配（段窗口标题包含计划标题，标题过短容易误配则忽略）
  const title = segment.mainTitle ?? ''
  if (title) {
    for (const plan of plans) {
      if (plan.startMin != null && plan.endMin != null) continue
      if (plan.title.length >= 2 && title.includes(plan.title)) return plan
    }
  }
  return null
}

/**
 * 计划达成率统计（四态：completed ≥1.0 / partial ≥0.5 / missed =0 / overtime >1.2）
 * plannedMin = durationMin ?? endMin-startMin ?? 60
 */
export function calculatePlanAchievements(segments: TrailSegment[], plans: PlanItem[]): PlanAchievement[] {
  return plans.map((plan) => {
    const related = segments.filter((s) => matchPlanByTime(s, [plan]) !== null)
    const actualMin = related.reduce((sum, s) => sum + s.durationMin, 0)
    const plannedMin =
      plan.durationMin ?? (plan.startMin != null && plan.endMin != null ? plan.endMin - plan.startMin : 60)
    const rate = plannedMin > 0 ? actualMin / plannedMin : 0

    let status: PlanAchievement['status']
    if (rate > 1.2) status = 'overtime'
    else if (rate >= 1.0) status = 'completed'
    else if (rate >= 0.5) status = 'partial'
    else if (actualMin === 0) status = 'missed'
    else status = 'partial'

    return {
      planId: plan.id,
      title: plan.title,
      plannedMin: Math.round(plannedMin),
      actualMin: Math.round(actualMin),
      achievementRate: Math.min(rate, 1.0),
      status,
      relatedSegmentIds: related.map((s) => s.id ?? '')
    }
  })
}

export interface TimeEntryOverlay {
  entry: TimeEntry
  matchedSegmentId?: string
  matchType: 'time' | 'title' | 'none'
}

/** 日历条目叠加：时间重叠 → 'time'；标题包含 → 'title'；无 → 'none' */
export function overlayTimeEntries(segments: TrailSegment[], entries: TimeEntry[]): TimeEntryOverlay[] {
  return entries.map((entry) => {
    const timeMatched = segments.find((s) => {
      const r = segMinRange(s)
      return overlapMin(r, { startMin: entry.startMin, endMin: entry.endMin }) > 0
    })
    if (timeMatched) return { entry, matchedSegmentId: timeMatched.id, matchType: 'time' }

    const keywordMatched = segments.find((s) => s.mainTitle && entry.title && s.mainTitle.includes(entry.title))
    if (keywordMatched) return { entry, matchedSegmentId: keywordMatched.id, matchType: 'title' }

    return { entry, matchType: 'none' }
  })
}
