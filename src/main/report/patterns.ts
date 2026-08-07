/**
 * v2.9 模块 E：模式检测引擎 —— 峰谷时段 / 作息规律 / 碎片化 / 周规律（纯算法，无模型）
 * 依据：design-spec-v2.9 §3.E（检测规则 + 碎片化公式 + patternTags 判定全照抄）
 * 数据口径：逐日 buildMergedTrail(listActivities(d), d)，有效天 = totalMin > 0；< 3 天返回 null
 */
import type { MergedTrail, TrailSegment, WorkPattern, WorkState } from '@shared/types'
import { WORK_LIKE_STATES } from '@shared/stateMeta'
import { buildMergedTrail } from '@shared/trail'
import { listActivities } from '../db'

// 峰谷阈值（规格未给数值，自拟并注明）：小时均分 >60 记高分、<40 记低分
const PEAK_THRESHOLD = 60
const DIP_THRESHOLD = 40

/** 段的小时（按 startTs） */
function hourOf(seg: TrailSegment): number {
  return new Date(seg.startTs).getHours()
}

/** 段的当日分钟（按 startTs） */
function dayMinOf(seg: TrailSegment): number {
  const d = new Date(seg.startTs)
  return d.getHours() * 60 + d.getMinutes()
}

function avg(xs: number[]): number {
  return xs.length > 0 ? xs.reduce((a, b) => a + b, 0) / xs.length : 0
}

function stddev(xs: number[]): number {
  if (xs.length < 2) return 0
  const m = avg(xs)
  return Math.sqrt(xs.reduce((a, x) => a + (x - m) * (x - m), 0) / xs.length)
}

/** 一致性 = 1 - min(标准差/60, 1)：波动越小越接近 1 */
function consistencyOf(xs: number[]): number {
  if (xs.length < 2) return xs.length === 1 ? 1 : 0
  return Math.round((1 - Math.min(stddev(xs) / 60, 1)) * 100) / 100
}

const pad2 = (n: number): string => `${n}`.padStart(2, '0')
const minToSlot = (startMin: number, endMin: number): string =>
  `${pad2(Math.floor(startMin / 60))}:${pad2(startMin % 60)}-${pad2(Math.floor(endMin / 60))}:${pad2(endMin % 60)}`

/** 一天的专注分：work-like 分钟 / 总分钟 * 100 */
function dayFocusScore(trail: MergedTrail): number {
  const work = WORK_LIKE_STATES.reduce((a, s) => a + (trail.stateMinutes[s] ?? 0), 0)
  return trail.totalMin > 0 ? (work / trail.totalMin) * 100 : 0
}

/**
 * 检测近 N 天工作模式
 * @param dates 日期列表（YYYY-MM-DD，通常近 14 天）
 */
export function detectPatterns(dates: string[]): WorkPattern | null {
  const trails = dates
    .map((d) => buildMergedTrail(listActivities(d), d))
    .filter((t) => t.totalMin > 0)
  if (trails.length < 3) return null // 数据不足 3 天不做模式判定

  // ── 1. 峰谷时段：按小时分桶算平均专注分 ──
  // 小时得分 = 该小时 work-like 分钟 / 该小时总分钟 * 100（跨天汇总）
  const hourWork = new Array<number>(24).fill(0)
  const hourTotal = new Array<number>(24).fill(0)
  const hourStates = new Array<Map<WorkState, number>>(24)
  for (let h = 0; h < 24; h++) hourStates[h] = new Map()
  for (const trail of trails) {
    for (const seg of trail.segments) {
      if (seg.glance) continue
      const h = hourOf(seg)
      hourTotal[h] += seg.durationMin
      if (WORK_LIKE_STATES.includes(seg.mainState)) hourWork[h] += seg.durationMin
      hourStates[h].set(seg.mainState, (hourStates[h].get(seg.mainState) ?? 0) + seg.durationMin)
    }
  }
  const hourScore = hourWork.map((w, h) => (hourTotal[h] > 0 ? (w / hourTotal[h]) * 100 : -1)) // -1 = 该小时无数据

  const topStateOf = (hours: number[]): WorkState => {
    const acc = new Map<WorkState, number>()
    for (const h of hours) for (const [st, m] of hourStates[h]) acc.set(st, (acc.get(st) ?? 0) + m)
    const top = [...acc.entries()].sort((a, b) => b[1] - a[1])[0]
    return (top?.[0] ?? 'focus') as WorkState
  }

  // 连续 ≥3h 高分 = 峰；连续 ≥2h 低分 = 谷
  const peakHours: WorkPattern['peakHours'] = []
  const dipHours: WorkPattern['dipHours'] = []
  let run: number[] = []
  const flushPeak = () => {
    if (run.length >= 3) {
      peakHours.push({
        slot: minToSlot(run[0] * 60, (run[run.length - 1] + 1) * 60),
        avgFocusScore: Math.round(avg(run.map((h) => hourScore[h]))),
        primaryState: topStateOf(run),
        confidence: Math.min(1, Math.round((trails.length / 7) * 100) / 100) // 历史天数越多越可信
      })
    }
    run = []
  }
  for (let h = 0; h < 24; h++) {
    if (hourScore[h] > PEAK_THRESHOLD) run.push(h)
    else flushPeak()
  }
  flushPeak()

  let dipRun: number[] = []
  const flushDip = () => {
    if (dipRun.length >= 2) {
      const slackMin = dipRun.reduce((a, h) => a + (hourStates[h].get('slack') ?? 0) + (hourStates[h].get('relax') ?? 0), 0)
      const meetingMin = dipRun.reduce((a, h) => a + (hourStates[h].get('meeting') ?? 0), 0)
      dipHours.push({
        slot: minToSlot(dipRun[0] * 60, (dipRun[dipRun.length - 1] + 1) * 60),
        avgFocusScore: Math.round(avg(dipRun.map((h) => hourScore[h]))),
        primaryReason: slackMin >= meetingMin && slackMin > 0 ? 'slack' : meetingMin > 0 ? 'meeting' : 'fragmented',
        confidence: Math.min(1, Math.round((trails.length / 7) * 100) / 100)
      })
    }
    dipRun = []
  }
  for (let h = 0; h < 24; h++) {
    if (hourScore[h] >= 0 && hourScore[h] < DIP_THRESHOLD) dipRun.push(h)
    else flushDip()
  }
  flushDip()

  // ── 2. 作息规律：每日首末 work-like 段 ──
  const workStarts: number[] = []
  const workEnds: number[] = []
  for (const trail of trails) {
    const workSegs = trail.segments.filter((s) => !s.glance && WORK_LIKE_STATES.includes(s.mainState))
    if (workSegs.length > 0) {
      workStarts.push(dayMinOf(workSegs[0]))
      workEnds.push(dayMinOf(workSegs[workSegs.length - 1]) + workSegs[workSegs.length - 1].durationMin)
    }
  }
  const workStartAvg = Math.round(avg(workStarts))
  const workEndAvg = Math.round(avg(workEnds))

  // ── 3. 碎片化：switchScore = min(日均切换/50, 1)*50 + lengthScore = max(0, 1-avgSegLen/30)*50 ──
  let totalSwitches = 0
  let totalSegs = 0
  let totalSegMin = 0
  for (const trail of trails) {
    const segs = trail.segments.filter((s) => !s.glance)
    totalSegs += segs.length
    totalSegMin += segs.reduce((a, s) => a + s.durationMin, 0)
    for (let i = 1; i < segs.length; i++) {
      if (segs[i].mainApp !== segs[i - 1].mainApp) totalSwitches++
    }
  }
  const dailySwitches = totalSwitches / trails.length
  const avgSegmentLength = totalSegs > 0 ? totalSegMin / totalSegs : 0
  const switchScore = Math.min(dailySwitches / 50, 1) * 50
  const lengthScore = Math.max(0, 1 - avgSegmentLength / 30) * 50
  const fragmentationScore = Math.round(switchScore + lengthScore)

  // ── 4. 周规律：weekday 均分 ──
  const weekdayScores: number[][] = Array.from({ length: 7 }, () => [])
  for (const trail of trails) {
    const wd = new Date(`${trail.date}T00:00:00`).getDay()
    weekdayScores[wd].push(dayFocusScore(trail))
  }
  const weekdayAvg = weekdayScores.map((xs) => avg(xs))
  const bestWeekday = weekdayAvg.indexOf(Math.max(...weekdayAvg))
  const worstWeekday = weekdayAvg.indexOf(Math.min(...weekdayAvg))
  // 周间一致性：各日均分波动越小越一致（自拟口径：1 - min(标准差/50, 1)）
  const allDayScores = trails.map(dayFocusScore)
  const weekdayConsistency = Math.round((1 - Math.min(stddev(allDayScores) / 50, 1)) * 100) / 100

  const result: WorkPattern = {
    peakHours,
    dipHours,
    workStartAvg,
    workEndAvg,
    workStartConsistency: consistencyOf(workStarts),
    workEndConsistency: consistencyOf(workEnds),
    fragmentationScore,
    contextSwitches: Math.round(dailySwitches),
    avgSegmentLength: Math.round(avgSegmentLength * 10) / 10,
    bestWeekday,
    worstWeekday,
    weekdayConsistency,
    patternTags: []
  }

  // ── 5. 模式标签（规则判定，v2.9 §3.E 照抄）──
  const tags: string[] = []
  // 晨型/夜型
  if (result.workStartAvg > 0 && result.workStartAvg < 9 * 60 && result.workStartConsistency > 0.7) {
    tags.push('晨型人')
  } else if (result.workStartAvg > 11 * 60) {
    tags.push('夜型人')
  }
  // 碎片化
  if (result.fragmentationScore > 60) tags.push('碎片化严重')
  else if (result.fragmentationScore < 25) tags.push('深度专注型')
  // 下午低谷（13/14 点）
  if (result.dipHours.some((d) => d.slot.startsWith('14') || d.slot.startsWith('13'))) tags.push('下午低谷')
  // 作息规律
  if (result.workStartConsistency > 0.8) tags.push('作息规律')
  else if (result.workStartConsistency < 0.4) tags.push('作息不规律')
  result.patternTags = tags

  return result
}
