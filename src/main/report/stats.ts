/**
 * v2.9 模块 A：时间统计引擎 —— 报表需要的全部时间维度统计（纯本地计算，无模型）
 * 依据：design-spec-v2.9 §3.A
 * 口径：trail = buildMergedTrail(listActivities(date), date)；work = WORK_LIKE_STATES 分钟和
 */
import type { ReportStats, TrailSegment, WorkState, ReportTimeSlot } from '@shared/types'
import { WORK_STATES, WORK_LIKE_STATES } from '@shared/stateMeta'
import { buildMergedTrail, dateKey } from '@shared/trail'
import { listActivities } from '../db'

/** 时段分桶：morning 6-12 / afternoon 12-18 / evening 18-24 / night 0-6 */
const SLOT_DEFS: { slot: ReportTimeSlot; label: string; from: number; to: number }[] = [
  { slot: 'morning', label: '上午', from: 6, to: 12 },
  { slot: 'afternoon', label: '下午', from: 12, to: 18 },
  { slot: 'evening', label: '晚上', from: 18, to: 24 },
  { slot: 'night', label: '凌晨', from: 0, to: 6 }
]

function slotOfHour(hour: number): ReportTimeSlot {
  if (hour >= 6 && hour < 12) return 'morning'
  if (hour >= 12 && hour < 18) return 'afternoon'
  if (hour >= 18) return 'evening'
  return 'night'
}

function isSlackLike(s: WorkState): boolean {
  return s === 'slack' || s === 'relax'
}

/**
 * 计算某日报表统计
 * @param date YYYY-MM-DD
 * @param depth 内部递归深度（对比昨日/上周同日时 +1，防止无限递归）
 */
export function calculateReportStats(date: string, depth = 0): ReportStats {
  const trail = buildMergedTrail(listActivities(date), date)
  const totalMin = trail.totalMin
  const sm = trail.stateMinutes

  const workMin = WORK_LIKE_STATES.reduce((a, s) => a + (sm[s] ?? 0), 0)
  const slackMin = (sm.slack ?? 0) + (sm.relax ?? 0)

  // 状态分布（WORK_STATES 取 label/color）
  const stateBreakdown = (Object.keys(WORK_STATES) as WorkState[])
    .map((state) => {
      const minutes = sm[state] ?? 0
      return {
        state,
        label: WORK_STATES[state].label,
        minutes: Math.round(minutes),
        percentage: totalMin > 0 ? Math.round((minutes / totalMin) * 100) : 0,
        color: WORK_STATES[state].color
      }
    })
    .filter((x) => x.minutes > 0)
    .sort((a, b) => b.minutes - a.minutes)

  // 应用排行：按 mainApp 聚合分钟 top8，primaryState = 该应用分钟最多的状态
  const appMin = new Map<string, number>()
  const appStateMin = new Map<string, Map<WorkState, number>>()
  for (const seg of trail.segments) {
    if (seg.glance || !seg.mainApp) continue
    appMin.set(seg.mainApp, (appMin.get(seg.mainApp) ?? 0) + seg.durationMin)
    const m = appStateMin.get(seg.mainApp) ?? new Map<WorkState, number>()
    m.set(seg.mainState, (m.get(seg.mainState) ?? 0) + seg.durationMin)
    appStateMin.set(seg.mainApp, m)
  }
  const appRanking = [...appMin.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([app, minutes]) => {
      const topState = [...(appStateMin.get(app)?.entries() ?? [])].sort((a, b) => b[1] - a[1])[0]
      return {
        app,
        minutes: Math.round(minutes),
        percentage: totalMin > 0 ? Math.round((minutes / totalMin) * 100) : 0,
        primaryState: (topState?.[0] ?? 'idle') as WorkState
      }
    })

  // 时段分布：按段 startTs 小时归桶，focusScore = workMin/(work+slack)*100
  const slotBreakdown = SLOT_DEFS.map((def) => {
    let w = 0
    let s = 0
    for (const seg of trail.segments) {
      if (seg.glance) continue
      if (slotOfHour(new Date(seg.startTs).getHours()) !== def.slot) continue
      if (WORK_LIKE_STATES.includes(seg.mainState)) w += seg.durationMin
      else if (isSlackLike(seg.mainState)) s += seg.durationMin
    }
    return {
      slot: def.slot,
      label: def.label,
      workMin: Math.round(w),
      slackMin: Math.round(s),
      focusScore: w + s > 0 ? Math.round((w / (w + s)) * 100) : 0
    }
  })

  // 专注度与 24 小时趋势（各小时桶 work 占比*100）
  const focusScore = totalMin > 0 ? Math.round((workMin / totalMin) * 100) : 0
  const hourWork = new Array<number>(24).fill(0)
  const hourTotal = new Array<number>(24).fill(0)
  for (const seg of trail.segments) {
    if (seg.glance) continue
    const h = new Date(seg.startTs).getHours()
    hourTotal[h] += seg.durationMin
    if (WORK_LIKE_STATES.includes(seg.mainState)) hourWork[h] += seg.durationMin
  }
  const focusTrend = hourWork.map((w, h) => (hourTotal[h] > 0 ? Math.round((w / hourTotal[h]) * 100) : 0))

  const stats: ReportStats = {
    totalWorkMin: Math.round(workMin),
    totalSlackMin: Math.round(slackMin),
    workSlackRatio: slackMin > 0 ? Math.round((workMin / slackMin) * 100) / 100 : workMin > 0 ? 999 : 0,
    stateBreakdown,
    appRanking,
    slotBreakdown,
    focusScore,
    focusTrend
  }

  // 对比昨日 / 上周同日（递归调自身；totalMin<30 的天数据太少，跳过对比字段）
  if (depth === 0) {
    const dayMs = 86400000
    const base = new Date(`${date}T00:00:00`).getTime()
    const yesterday = calculateReportStats(dateKey(base - dayMs), 1)
    if (yesterday.totalWorkMin + yesterday.totalSlackMin >= 30 || sumTotal(yesterday) >= 30) {
      stats.vsYesterday = {
        workMinDelta: stats.totalWorkMin - yesterday.totalWorkMin,
        focusDelta: stats.focusScore - yesterday.focusScore,
        slackDelta: stats.totalSlackMin - yesterday.totalSlackMin
      }
    }
    const lastWeek = calculateReportStats(dateKey(base - 7 * dayMs), 1)
    if (sumTotal(lastWeek) >= 30) {
      stats.vsLastWeekSameDay = {
        workMinDelta: stats.totalWorkMin - lastWeek.totalWorkMin,
        focusDelta: stats.focusScore - lastWeek.focusScore
      }
    }
  }

  return stats
}

/** 当日总监控分钟（work+slack 之外的 idle/break 等也算，用于"数据量是否可信"判断） */
function sumTotal(s: ReportStats): number {
  return s.stateBreakdown.reduce((a, b) => a + b.minutes, 0)
}
