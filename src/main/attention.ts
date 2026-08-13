/**
 * 注意力评分引擎 —— 每日结算 / 成就判定 / 用户类型识别 / 评分驱动桌宠策略（v2.6）
 * 依据：workon-design-spec-v2.6 §2 综合评分、§3 成就系统、§4.2 评分驱动 PAD 策略
 * 计分公式在 shared/attention.ts，本模块只负责取数、落库与调度
 * 注意：本模块禁止 import state.ts（state.ts 会 import 本模块），桌宠消息经 petNotifier 注入
 */
import type { Achievement, AttentionScore, CustomCategory, MergedTrail, PlanItem, UserType } from '@shared/types'
import { calcFiveDimensions, compositeScore, identifyUserType, USER_TYPE_META, DEEP_WORK_STATES } from '@shared/attention'
import { ACHIEVEMENT_DEFS } from '@shared/achievements'
import { buildMergedTrail, dateKey } from '@shared/trail'
import { planVsActual } from '@shared/planAnalysis'
import { col, insertInto, listActivities } from './db'
import { getSettings, setSettings } from './settings'
import { sendTo } from './windows'

const mean = (ns: number[]): number => ns.reduce((a, b) => a + b, 0) / ns.length

/** 日期串平移（取正午防 DST 边界） */
function shiftDate(date: string, deltaDays: number): string {
  const [y, m, d] = date.split('-').map(Number)
  return dateKey(new Date(y, m - 1, d + deltaDays, 12).getTime())
}

// ───────────────────────── 桌宠消息通知（依赖注入，避免循环依赖） ─────────────────────────

let petNotifier: ((msg: string) => void) | null = null

/** 由 index.ts 启动时注入（一般为 bus.setPet 的包装） */
export function setPetNotifier(fn: (msg: string) => void): void {
  petNotifier = fn
}

// ───────────────────────── 用户类型 ─────────────────────────

/** 自动识别结果缓存（settings.userType 为空时生效） */
let autoTypeCache: UserType | null = null

/** 生效用户类型：手动设置 > 自动识别缓存 > 默认办公族 */
export function effectiveUserType(): UserType {
  return getSettings().userType ?? autoTypeCache ?? 'office_worker'
}

/**
 * 用户类型自动识别（v2.6 §1.3）：近 3 天应用组合 + 作息 + 近 7 天计划关键词
 * 仅当 userTypeAuto 开启且未手动设置时执行；置信度 >0.6 才自动写入设置
 */
export function autoIdentifyUserType(): void {
  const s = getSettings()
  if (!s.userTypeAuto || s.userType) return

  const today = dateKey(Date.now())
  const appMin = new Map<string, number>()
  const starts: number[] = []
  const ends: number[] = []
  for (let i = 0; i < 3; i++) {
    const d = shiftDate(today, -i)
    const trail = buildMergedTrail(listActivities(d), d)
    const segs = trail.segments.filter((x) => !x.glance)
    for (const seg of segs) appMin.set(seg.mainApp, (appMin.get(seg.mainApp) ?? 0) + seg.durationMin)
    if (segs.length > 0) {
      const fs = new Date(segs[0].startTs)
      const le = new Date(segs[segs.length - 1].endTs)
      starts.push(fs.getHours() * 60 + fs.getMinutes())
      ends.push(le.getHours() * 60 + le.getMinutes())
    }
  }
  const topApps = [...appMin.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([app]) => app)
  const weekAgo = shiftDate(today, -6)
  const planKeywords = col<PlanItem>('plans')
    .filter((p) => p.date >= weekAgo && p.date <= today)
    .map((p) => p.title)

  const { type, confidence } = identifyUserType({
    topApps,
    avgStartMin: starts.length > 0 ? Math.round(mean(starts)) : null,
    avgEndMin: ends.length > 0 ? Math.round(mean(ends)) : null,
    planKeywords
  })
  if (confidence > 0.6) {
    autoTypeCache = type
    setSettings({ userType: type })
    console.log(`[attention] 自动识别用户类型：${type}（置信度 ${confidence}）`)
  } else {
    console.log(`[attention] 用户类型识别置信度不足（${confidence}），暂用默认类型`)
  }
}

// ───────────────────────── 每日评分 ─────────────────────────

/** upsert 按 date 去重（AttentionScore 无 id 字段，col 返回活引用，先 splice 再由 insertInto 追加+落盘） */
function upsertScore(score: AttentionScore): void {
  const arr = col<AttentionScore>('attentionScores')
  const idx = arr.findIndex((s) => s.date === score.date)
  if (idx >= 0) arr.splice(idx, 1)
  insertInto('attentionScores', score)
}

/** 连续打卡天数：当日计 1，向前数集合中连续有分日期 */
function streakDaysOf(date: string): number {
  const dates = new Set(col<AttentionScore>('attentionScores').map((s) => s.date))
  let streak = 1
  let cur = shiftDate(date, -1)
  while (dates.has(cur)) {
    streak++
    cur = shiftDate(cur, -1)
  }
  return streak
}

/** 当日计划达成率 0-1（无计划/无数据给 0；planVsActual 的 achievement 为 0-100，需 ÷100） */
function planAchievementOf(date: string, trail: MergedTrail): number {
  const dayPlans = col<PlanItem>('plans').filter((p) => p.date === date)
  if (dayPlans.length === 0 || trail.totalMin <= 0) return 0
  return planVsActual(dayPlans, trail, col<CustomCategory>('categories')).achievement / 100
}

/**
 * 计算并落库某日评分（重算=覆盖同日记录）
 * 目标值：settings.targetWorkMin/targetPomodoros 覆盖 USER_TYPE_META 类型默认
 */
export function computeDailyScore(date: string): AttentionScore {
  const userType = effectiveUserType()
  const s = getSettings()
  const meta = USER_TYPE_META[userType]
  const EMPLOY_MULT: Record<string, number> = { full: 1, part: 0.65, student: 0.5 }
  const mult = EMPLOY_MULT[s.employmentMode ?? 'full']
  const goals = {
    targetWorkMin: Math.round((s.targetWorkMin ?? meta.targetWorkMin) * mult),
    targetPomodoros: Math.round((s.targetPomodoros ?? meta.targetPomodoros) * mult)
  }

  const trail = buildMergedTrail(listActivities(date), date)
  // 近 7 天轨迹（不含当日），供高效时段重合度与周稳定性使用
  const recentTrails = Array.from({ length: 7 }, (_, i) => {
    const d = shiftDate(date, -(i + 1))
    return buildMergedTrail(listActivities(d), d)
  })

  const { dimensions, rawSignals } = calcFiveDimensions(trail, goals, recentTrails)
  const streakDays = streakDaysOf(date)
  const planAchievement = planAchievementOf(date, trail)
  const comp = compositeScore(dimensions, userType, { streakDays, planAchievement })

  const scores = col<AttentionScore>('attentionScores')
  const yesterday = scores.find((x) => x.date === shiftDate(date, -1))
  const weekDates = new Set(Array.from({ length: 7 }, (_, i) => shiftDate(date, -(i + 1))))
  const weekScores = scores.filter((x) => weekDates.has(x.date) && x.date !== date)

  const score: AttentionScore = {
    date,
    userType,
    dimensions,
    rawSignals,
    weightedScore: comp.weightedScore,
    finalScore: comp.finalScore,
    grade: comp.grade,
    bonus: comp.bonus,
    vsYesterday: yesterday ? comp.finalScore - yesterday.finalScore : 0,
    vsLastWeekAvg: weekScores.length > 0 ? Math.round(comp.finalScore - mean(weekScores.map((x) => x.finalScore))) : 0,
    ts: Date.now()
  }
  upsertScore(score)
  return score
}

/** 今日评分（预览性质：无论是否已结算都按当前数据重算并回写） */
export function todayScore(): AttentionScore {
  return computeDailyScore(dateKey(Date.now()))
}

/** 最近 N 天评分（按日期升序，不足 N 天全量返回） */
export function recentScores(days: number): AttentionScore[] {
  return [...col<AttentionScore>('attentionScores')].sort((a, b) => a.date.localeCompare(b.date)).slice(-days)
}

// ───────────────────────── 成就判定 ─────────────────────────

/** 当日 + 近期评分按日期建图（当日覆盖同日期旧记录） */
function scoreMapOf(score: AttentionScore, recent: AttentionScore[]): Map<string, AttentionScore> {
  const m = new Map<string, AttentionScore>()
  for (const s of recent) m.set(s.date, s)
  m.set(score.date, score)
  return m
}

/** scoreAbove streak：从当日起向前连续 N 天 finalScore ≥ threshold */
function scoreAboveStreak(map: Map<string, AttentionScore>, date: string, threshold: number, duration: number): boolean {
  let n = 0
  let cur = date
  while (true) {
    const rec = map.get(cur)
    if (!rec || rec.finalScore < threshold) break
    n++
    cur = shiftDate(cur, -1)
  }
  return n >= duration
}

/** 近 7 天（含当日）摸鱼+放松总分钟：逐日 buildMergedTrail 取 stateMinutes 求和 */
function weeklySlackMinOf(date: string): number {
  let sum = 0
  for (let i = 0; i < 7; i++) {
    const d = shiftDate(date, -i)
    const trail = buildMergedTrail(listActivities(d), d)
    sum += (trail.stateMinutes.slack ?? 0) + (trail.stateMinutes.relax ?? 0)
  }
  return sum
}

/** balancedWeek：近 7 天每天有效工作都在 240-480 分钟（缺数据即不满足） */
function balancedWeekOk(map: Map<string, AttentionScore>, date: string): boolean {
  for (let i = 0; i < 7; i++) {
    const rec = map.get(shiftDate(date, -i))
    if (!rec) return false
    const w = rec.rawSignals.effectiveWorkMin
    if (w < 240 || w > 480) return false
  }
  return true
}

/** 某日 19 点后的深度专注分钟（非 glance 且主态属深度工作态） */
function eveningDeepMinOf(date: string): number {
  const trail = buildMergedTrail(listActivities(date), date)
  let m = 0
  for (const seg of trail.segments) {
    if (seg.glance || !DEEP_WORK_STATES.includes(seg.mainState)) continue
    if (new Date(seg.startTs).getHours() >= 19) m += seg.durationMin
  }
  return m
}

/** eveningDeepStreak：近 N 天每天 19 点后深度段 > threshold 分钟 */
function eveningDeepStreakOk(date: string, threshold: number, duration: number): boolean {
  for (let i = 0; i < duration; i++) {
    if (eveningDeepMinOf(shiftDate(date, -i)) <= threshold) return false
  }
  return true
}

/** 单条成就条件判定（metric 口径对照 shared/achievements.ts 注释） */
function conditionMet(def: Achievement, score: AttentionScore, map: Map<string, AttentionScore>): boolean {
  const { metric, threshold, duration } = def.condition
  switch (metric) {
    case 'streakDays':
      return score.bonus.streakDays >= threshold
    case 'finalScore':
      return score.finalScore >= threshold
    case 'scoreAbove':
      return scoreAboveStreak(map, score.date, threshold, duration ?? 7)
    case 'weeklyAvg': {
      const dates = new Set(Array.from({ length: 7 }, (_, i) => shiftDate(score.date, -i)))
      const vals = [...map.values()].filter((x) => dates.has(x.date)).map((x) => x.finalScore)
      return vals.length > 0 && mean(vals) >= threshold
    }
    case 'dim.all':
      return Object.values(score.dimensions).every((v) => v >= threshold)
    case 'weeklySlackMin':
      return weeklySlackMinOf(score.date) <= threshold
    case 'deepFocusTotalMin':
      return score.rawSignals.deepFocusTotalMin >= threshold
    case 'deepFocusMaxStreak':
      return score.rawSignals.deepFocusMaxStreak >= threshold
    case 'balancedWeek':
      return balancedWeekOk(map, score.date)
    case 'eveningDeepStreak':
      return eveningDeepStreakOk(score.date, threshold, duration ?? 7)
    default:
      if (metric.startsWith('dim.')) {
        const key = metric.slice(4) as keyof AttentionScore['dimensions']
        return score.dimensions[key] >= threshold
      }
      return false
  }
}

/**
 * 成就判定：逐条检查 ACHIEVEMENT_DEFS，返回本次新解锁
 * 已解锁（achievements 集合按 id）跳过；类型专属条目要求 score.userType 匹配
 */
export function checkAchievements(score: AttentionScore, recent: AttentionScore[]): Achievement[] {
  const unlockedIds = new Set(col<Achievement>('achievements').map((a) => a.id))
  const map = scoreMapOf(score, recent)
  const newly: Achievement[] = []
  for (const def of ACHIEVEMENT_DEFS) {
    if (unlockedIds.has(def.id)) continue
    if (def.userType && def.userType !== score.userType) continue
    if (!conditionMet(def, score, map)) continue
    const rec: Achievement = { ...def, unlocked: true, unlockedAt: Date.now() }
    insertInto('achievements', rec)
    newly.push(rec)
    petNotifier?.(`🎉 解锁成就「${def.name}」！${def.description}`)
    sendTo('main', 'achievement-unlocked', rec)
    console.log(`[attention] 解锁成就：${def.name}（${def.id}）`)
  }
  return newly
}

// ───────────────────────── 评分驱动桌宠策略（v2.6 §4.2） ─────────────────────────

export interface ScoreStrategy {
  band: 'challenge' | 'standard' | 'gentle' | 'care'
  padOffset: { p: number; a: number; d: number }
  slackReminderMin: number // 摸鱼提醒阈值（分钟）
}

/** 最近 N 天是否连续有记录且 finalScore 均低于 threshold */
function lastNDaysBelow(n: number, threshold: number): boolean {
  const r = recentScores(n)
  if (r.length < n) return false
  for (let i = 1; i < r.length; i++) {
    if (shiftDate(r[i - 1].date, 1) !== r[i].date) return false // 日期不连续不算连续
  }
  return r.every((s) => s.finalScore < threshold)
}

/**
 * 评分策略：按今日 finalScore 分带（无记录按 700 标准带），类型叠加纠偏
 * PAD 偏移照 §4.2（finalScore 为 0-1000，规格阈值 ×10 换算）：
 *   P 评分>850 +0.1；低分按带 gentle -0.05 / care -0.1（§4.2 的 <600 -0.1 在 gentle 带柔化）
 *   A 今日较昨日差 >200 +0.15 / <-200 +0.05
 *   D 评分>850 +0.1 / <600 -0.15
 */
export function getScoreStrategy(): ScoreStrategy {
  const today = dateKey(Date.now())
  const rec = col<AttentionScore>('attentionScores').find((s) => s.date === today)
  const finalScore = rec?.finalScore ?? 700
  const vsYesterday = rec?.vsYesterday ?? 0

  let band: ScoreStrategy['band'] =
    finalScore >= 900 ? 'challenge' : finalScore >= 700 ? 'standard' : finalScore >= 500 ? 'gentle' : 'care'

  // 类型叠加（§4.2 特殊人群纠偏）
  const ut = effectiveUserType()
  if (ut === 'exam_candidate' && lastNDaysBelow(3, 600)) band = 'care' // 考研党连续 3 天 <600：紧急鞭策 3 天后回关怀
  if (ut === 'creator' && finalScore < 600) band = 'care' // 创作者低分：灵感等待不催促
  if (ut === 'entrepreneur' && finalScore > 900) band = 'standard' // 创业者高分：可持续警告不挑战

  const p = finalScore > 850 ? 0.1 : finalScore < 600 ? (band === 'gentle' ? -0.05 : -0.1) : 0
  const a = vsYesterday > 200 ? 0.15 : vsYesterday < -200 ? 0.05 : 0
  const d = finalScore > 850 ? 0.1 : finalScore < 600 ? -0.15 : 0
  const slackReminderMin = band === 'challenge' ? 20 : band === 'standard' ? 15 : band === 'gentle' ? 10 : 5

  return { band, padOffset: { p, a, d }, slackReminderMin }
}

// ───────────────────────── 引擎启动 ─────────────────────────

/** 启动时结算昨日：无评分记录且有活动数据才补算（连续打卡口径=有数据记录，空日不产生记录） */
function settleYesterday(): void {
  const yesterday = shiftDate(dateKey(Date.now()), -1)
  if (col<AttentionScore>('attentionScores').some((s) => s.date === yesterday)) return
  if (listActivities(yesterday).length === 0) return
  const score = computeDailyScore(yesterday)
  const newly = checkAchievements(score, recentScores(40))
  console.log(`[attention] 昨日结算：${score.finalScore} 分（${score.grade}）${newly.length > 0 ? `，新解锁成就 ${newly.length} 个` : ''}`)
}

/** 启动评分引擎：① 结算昨日 ② 每小时刷新今日 ③ 自动识别用户类型 */
export function startAttentionEngine(): void {
  try {
    settleYesterday()
  } catch (e) {
    console.warn('[attention] 昨日结算失败', e)
  }
  setInterval(
    () => {
      try {
        computeDailyScore(dateKey(Date.now()))
      } catch (e) {
        console.warn('[attention] 定时评分失败', e)
      }
    },
    60 * 60 * 1000
  )
  try {
    autoIdentifyUserType()
  } catch (e) {
    console.warn('[attention] 用户类型识别失败', e)
  }
  console.log('[attention] 评分引擎已启动')
}
