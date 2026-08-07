/**
 * 注意力评分 —— 用户分群 / 五维模型 / 综合评分 / 类型识别（v2.6）
 * 依据：workon-design-spec-v2.6 §1 用户分群、§2 五维模型与综合评分
 * 计分公式数字与规格严格一致，调整需同步设计文档
 */
import type { AttentionScore, MergedTrail, ScoreGrade, TrailSegment, UserType, WorkState } from './types'
import { WORK_LIKE_STATES } from './stateMeta'

// ───────────────────────── 用户类型元信息 ─────────────────────────

export interface UserTypeMeta {
  label: string
  emoji: string
  desc: string
  /** 五维权重（深度/持续/抗干扰/节奏/恢复），合计 1.0，照 v2.6 §2.2 */
  weights: { depth: number; sustain: number; resist: number; rhythm: number; recover: number }
  targetWorkMin: number // 默认目标工作时长（分钟），照 v2.6 §2.1 持续力
  targetPomodoros: number // 默认目标番茄钟数，照 v2.6 §2.1 节奏感
}

/** 六类用户画像（v2.6 §1.2 / §2.2） */
export const USER_TYPE_META: Record<UserType, UserTypeMeta> = {
  office_worker: {
    label: '办公族', emoji: '💼',
    desc: '9-6 制式工作，会议穿插；目标是高效完成当日任务、准时下班',
    weights: { depth: 0.15, sustain: 0.30, resist: 0.20, rhythm: 0.20, recover: 0.15 },
    targetWorkMin: 420, targetPomodoros: 12
  },
  exam_candidate: {
    label: '考研党', emoji: '📖',
    desc: '自我驱动型高压学习，有明确截止日期；目标是在有限时间内最大化知识吸收',
    weights: { depth: 0.35, sustain: 0.20, resist: 0.25, rhythm: 0.10, recover: 0.10 },
    targetWorkMin: 480, targetPomodoros: 16
  },
  freelancer: {
    label: '自由职业', emoji: '🕊',
    desc: '弹性时间、项目驱动；目标是按期交付并保持工作生活平衡',
    weights: { depth: 0.20, sustain: 0.25, resist: 0.15, rhythm: 0.25, recover: 0.15 },
    targetWorkMin: 360, targetPomodoros: 10
  },
  student: {
    label: '学生党', emoji: '🎒',
    desc: '课表约束加课余自习；目标是日常跟上课程、考试周冲刺',
    weights: { depth: 0.25, sustain: 0.15, resist: 0.20, rhythm: 0.25, recover: 0.15 },
    targetWorkMin: 300, targetPomodoros: 10
  },
  creator: {
    label: '创作者', emoji: '🎨',
    desc: '灵感驱动、状态波动大；目标是高质量产出并保护创造力',
    weights: { depth: 0.25, sustain: 0.15, resist: 0.15, rhythm: 0.20, recover: 0.25 },
    targetWorkMin: 300, targetPomodoros: 8
  },
  entrepreneur: {
    label: '创业者', emoji: '🚀',
    desc: '高强度多线程、会议密集；目标是多项目并行推进与快速决策',
    weights: { depth: 0.20, sustain: 0.30, resist: 0.20, rhythm: 0.15, recover: 0.15 },
    targetWorkMin: 540, targetPomodoros: 14
  }
}

// ───────────────────────── 五维模型 ─────────────────────────

/** 深度工作态：work-like 中排除会议/远程协作（深度专注维度的口径，v2.6 §2.1） */
export const DEEP_WORK_STATES: WorkState[] = ['focus', 'coding', 'aidev', 'aiqa', 'writing']

/** 摸鱼/分心态（抗干扰维度的口径） */
const DISTRACTION_STATES: WorkState[] = ['slack', 'relax']

const DEEP_RUN_MIN = 20 // 单段≥20min 才计为深度段（规格：>20min 连续）
const RUN_GAP_TOLERANCE_MIN = 5 // 连续段允许的最大间隙（规格未定义，取 5min 容差防跳变虚连）
const MIN_DATA_MIN = 30 // 数据不足保护：当日总时长低于该值全部维度给 0

/** 常见社媒/娱乐应用名（小写包含匹配，抗干扰维度的社媒占比口径） */
const SOCIAL_APP_KEYWORDS = ['微信', 'wechat', 'qq', '微博', 'weibo', '抖音', 'douyin', 'tiktok', 'bilibili', '哔哩', '小红书', '知乎', 'zhihu', '贴吧', 'twitter', 'reddit', 'instagram', 'facebook', 'telegram']

interface SegmentRun {
  startTs: number
  endTs: number
  durationMin: number
}

const r1 = (n: number): number => Math.round(n * 10) / 10
const r2 = (n: number): number => Math.round(n * 100) / 100
const clamp100 = (n: number): number => Math.min(100, Math.max(0, n))
const mean = (ns: number[]): number => ns.reduce((a, b) => a + b, 0) / ns.length

/** 把 segments 切成「主态属于 states 且非 glance」的连续序列（间隙超容差切段） */
function collectRuns(segments: TrailSegment[], states: WorkState[]): SegmentRun[] {
  const runs: SegmentRun[] = []
  let cur: SegmentRun | null = null
  for (const s of segments) {
    const hit = !s.glance && states.includes(s.mainState)
    if (!hit) {
      if (cur) { runs.push(cur); cur = null }
      continue
    }
    if (cur && (s.startTs - cur.endTs) / 60000 > RUN_GAP_TOLERANCE_MIN) {
      runs.push(cur)
      cur = null
    }
    if (!cur) cur = { startTs: s.startTs, endTs: s.endTs, durationMin: 0 }
    cur.durationMin += s.durationMin
    cur.endTs = s.endTs
  }
  if (cur) runs.push(cur)
  return runs
}

/** work-like 态总分钟（stateMinutes 已排除 glance，与 trail.ts 同口径） */
function workLikeMinOf(trail: MergedTrail): number {
  let m = 0
  for (const s of WORK_LIKE_STATES) m += trail.stateMinutes[s] ?? 0
  return m
}

/** 各小时桶的分钟分布（按段起始时刻归桶；段封顶 1h，近似口径够用） */
function hourlyMinutes(trail: MergedTrail): { work: number[]; covered: number[] } {
  const work = new Array<number>(24).fill(0)
  const covered = new Array<number>(24).fill(0)
  for (const s of trail.segments) {
    if (s.glance) continue
    const h = new Date(s.startTs).getHours()
    covered[h] += s.durationMin
    if (WORK_LIKE_STATES.includes(s.mainState)) work[h] += s.durationMin
  }
  return { work, covered }
}

/** 取分钟数 top3 的小时下标（简化口径：不足 3 个非零桶时允许零桶入榜） */
function top3Hours(hourly: number[]): number[] {
  return hourly.map((m, h) => ({ m, h })).sort((a, b) => b.m - a.m).slice(0, 3).map((e) => e.h)
}

export interface FiveDimensionResult {
  dimensions: AttentionScore['dimensions']
  rawSignals: AttentionScore['rawSignals']
}

/**
 * 五维计分（公式照 v2.6 §2.1，各项贡献 clamp 不超过系数）
 * recentTrails：近几日轨迹（不含当日），用于高效时段重合度与周稳定性
 */
export function calcFiveDimensions(
  trail: MergedTrail,
  goals: { targetWorkMin: number; targetPomodoros: number },
  recentTrails: MergedTrail[]
): FiveDimensionResult {
  const targetWorkMin = Math.max(1, goals.targetWorkMin) // 防 0/负目标导致除零
  const targetPomodoros = Math.max(1, goals.targetPomodoros)

  // 数据不足保护：总时长 <30min 全部维度给 0（rawSignals 同步清零，仅保留目标值）
  if (trail.totalMin < MIN_DATA_MIN) {
    return {
      dimensions: { depth: 0, sustain: 0, resist: 0, rhythm: 0, recover: 0 },
      rawSignals: {
        deepFocusTotalMin: 0, deepFocusMaxStreak: 0, deepFocusCount: 0,
        effectiveWorkMin: 0, targetWorkMin,
        distractionCount: 0, distractionAvgMin: 0, recoveryAvgMin: 0, socialDistractionRatio: 0,
        pomodoroCompleted: 0, pomodoroTarget: targetPomodoros,
        rhythmStability: 0, restQuality: 0,
        recoveryAfterBreak: 0, fatigue3hDecay: 0, weeklyVariance: 0
      }
    }
  }

  const segments = trail.segments
  const workLikeMin = workLikeMinOf(trail) // 工作总时长（含 meeting/remote）

  // ── 维度 1 深度专注 ──
  // = (深度段总时长/工作总时长)×50 + min(最长深度段/90,1)×30 + min(深度段次数/3,1)×20
  const deepRuns = collectRuns(segments, DEEP_WORK_STATES).filter((r) => r.durationMin >= DEEP_RUN_MIN)
  const deepFocusTotalMin = deepRuns.reduce((a, r) => a + r.durationMin, 0)
  const deepFocusMaxStreak = deepRuns.reduce((a, r) => Math.max(a, r.durationMin), 0)
  const deepFocusCount = deepRuns.length
  const depth = clamp100(
    (workLikeMin > 0 ? deepFocusTotalMin / workLikeMin : 0) * 50 +
    Math.min(deepFocusMaxStreak / 90, 1) * 30 +
    Math.min(deepFocusCount / 3, 1) * 20
  )

  // ── 维度 2 持续力 ──
  // = (有效工作时长/目标)×60 + min(连续工作段均长/45,1)×25 + min(工作态占比/0.7,1)×15
  const effectiveWorkMin = workLikeMin // 有效工作 = work-like（含 meeting/remote）分钟
  const workRuns = collectRuns(segments, WORK_LIKE_STATES)
  const avgWorkRunMin = workRuns.length > 0 ? mean(workRuns.map((r) => r.durationMin)) : 0
  const workRatio = trail.totalMin > 0 ? effectiveWorkMin / trail.totalMin : 0
  const sustain = clamp100(
    Math.min(effectiveWorkMin / targetWorkMin, 1) * 60 +
    Math.min(avgWorkRunMin / 45, 1) * 25 +
    Math.min(workRatio / 0.7, 1) * 15
  )

  // ── 维度 3 抗干扰 ──
  // = (1-min(频率/3,1))×35 + (1-min(单次均长/15,1))×30 + (1-min(恢复时间/5,1))×20 + (1-min(社媒占比/0.5,1))×15
  const slackRuns = collectRuns(segments, DISTRACTION_STATES)
  const distractionCount = slackRuns.length
  const slackTotalMin = slackRuns.reduce((a, r) => a + r.durationMin, 0)
  const distractionAvgMin = distractionCount > 0 ? slackTotalMin / distractionCount : 0
  // 分心频率 = 次数/工作小时；无工作时间则不计频率（视为无干扰）
  const distractionFreq = effectiveWorkMin > 0 ? distractionCount / (effectiveWorkMin / 60) : 0
  // 恢复时间 = 每个摸鱼段结束 → 下一 work-like 段开始的间隔均值；无摸鱼则 0（无需恢复）
  const recoveries: number[] = []
  for (const run of slackRuns) {
    const nextWork = segments.find((s) => !s.glance && s.startTs >= run.endTs && WORK_LIKE_STATES.includes(s.mainState))
    if (nextWork) recoveries.push((nextWork.startTs - run.endTs) / 60000)
  }
  const recoveryAvgMin = recoveries.length > 0 ? mean(recoveries) : 0
  // 社媒占比 = 命中社媒应用名的摸鱼分钟 / 摸鱼总分钟
  let socialMin = 0
  for (const s of segments) {
    if (s.glance || !DISTRACTION_STATES.includes(s.mainState)) continue
    const app = s.mainApp.toLowerCase()
    if (SOCIAL_APP_KEYWORDS.some((k) => app.includes(k))) socialMin += s.durationMin
  }
  const socialDistractionRatio = slackTotalMin > 0 ? socialMin / slackTotalMin : 0
  const resist = clamp100(
    (1 - Math.min(distractionFreq / 3, 1)) * 35 +
    (1 - Math.min(distractionAvgMin / 15, 1)) * 30 +
    (1 - Math.min(recoveryAvgMin / 5, 1)) * 20 +
    (1 - Math.min(socialDistractionRatio / 0.5, 1)) * 15
  )

  // ── 维度 4 节奏感 ──
  // = min(番茄钟完成数/目标,1)×30 + 周期稳定性×30 + 休息合理性×20 + 高效时段重合度×20
  // 番茄钟完成数 = 25-45min 的 work-like 连续段个数
  const pomodoroCompleted = workRuns.filter((r) => r.durationMin >= 25 && r.durationMin <= 45).length
  // 周期稳定性 = 1 - min(工作段时长变异系数, 1)；工作段<2 个无法评估，给 0.5 中值
  let rhythmStability = 0.5
  if (workRuns.length >= 2) {
    const ds = workRuns.map((r) => r.durationMin)
    const m = mean(ds)
    const sd = Math.sqrt(mean(ds.map((d) => (d - m) ** 2)))
    rhythmStability = m > 0 ? 1 - Math.min(sd / m, 1) : 0.5
  }
  // 休息合理性 = break 段中 5-10min 的占比（按段数）；无 break 段无法评估，给 0.5 中值
  const breaks = segments.filter((s) => !s.glance && s.mainState === 'break')
  const restQuality = breaks.length > 0
    ? breaks.filter((b) => b.durationMin >= 5 && b.durationMin <= 10).length / breaks.length
    : 0.5
  // 高效时段重合度 = 今日 top3 工作小时与 recentTrails 平均分布 top3 的重合数/3；无历史给 0.5 中值
  const todayHourly = hourlyMinutes(trail)
  let peakOverlap = 0.5
  if (recentTrails.length > 0) {
    const hist = new Array<number>(24).fill(0)
    for (const t of recentTrails) {
      const h = hourlyMinutes(t).work
      for (let i = 0; i < 24; i++) hist[i] += h[i] / recentTrails.length
    }
    const histTop3 = top3Hours(hist)
    peakOverlap = top3Hours(todayHourly.work).filter((h) => histTop3.includes(h)).length / 3
  }
  const rhythm = clamp100(
    Math.min(pomodoroCompleted / targetPomodoros, 1) * 30 +
    rhythmStability * 30 +
    restQuality * 20 +
    peakOverlap * 20
  )

  // ── 维度 5 恢复力 ──
  // = (1-min(回血时间/20,1))×30 + 午休后提升×25 + (1-min(3h衰减率/0.4,1))×25 + 周稳定性×20
  // 回血时间 = 连续非工作低谷(>30min)结束后，到首个 ≥10min work-like 段开始的分钟数均值
  // （规格称"午后低谷"，实现上不限制时段；glance 会切段，低谷为近似口径）
  const NON_WORK_STATES = (['slack', 'relax', 'idle', 'break', 'away', 'lunch'] as WorkState[])
  const dips = collectRuns(segments, NON_WORK_STATES).filter((r) => r.durationMin > 30)
  const dipRecoveries: number[] = []
  for (const dip of dips) {
    const back = segments.find((s) => !s.glance && s.startTs >= dip.endTs && WORK_LIKE_STATES.includes(s.mainState) && s.durationMin >= 10)
    if (back) dipRecoveries.push((back.startTs - dip.endTs) / 60000)
  }
  // 默认：无 >30min 低谷则无法观测回血速度，按 10min 中性偏优处理（对应该项一半分，避免无数据归零或满分）
  const recoverTimeAvg = dipRecoveries.length > 0 ? mean(dipRecoveries) : 10
  // 午休后提升 = lunch 段后 1h 窗口内 work-like 占比（按窗口内有数据的分钟归一）；无午休给 0.5 中值
  const lunchSegs = segments.filter((s) => !s.glance && s.mainState === 'lunch')
  let recoveryAfterBreak = 0.5
  if (lunchSegs.length > 0) {
    const ratios = lunchSegs.map((l) => {
      const winEnd = l.endTs + 60 * 60000
      let work = 0
      let span = 0
      for (const s of segments) {
        if (s.glance || s.endTs <= l.endTs || s.startTs >= winEnd) continue
        const mins = (Math.min(s.endTs, winEnd) - Math.max(s.startTs, l.endTs)) / 60000
        span += mins
        if (WORK_LIKE_STATES.includes(s.mainState)) work += mins
      }
      return span > 0 ? work / span : 0
    })
    recoveryAfterBreak = mean(ratios)
  }
  // 3h 衰减率 = 连续 3 小时工作占比 ≥0.5 后，第 4 小时占比的下降幅度均值；数据不足给 0.2 中值
  const hourWorkRatio = todayHourly.work.map((m) => Math.min(1, m / 60))
  const decays: number[] = []
  for (let h = 0; h + 3 < 24; h++) {
    if (hourWorkRatio[h] >= 0.5 && hourWorkRatio[h + 1] >= 0.5 && hourWorkRatio[h + 2] >= 0.5 && todayHourly.covered[h + 3] > 0) {
      const base = (hourWorkRatio[h] + hourWorkRatio[h + 1] + hourWorkRatio[h + 2]) / 3
      decays.push(Math.max(0, base - hourWorkRatio[h + 3]))
    }
  }
  const fatigue3hDecay = decays.length > 0 ? mean(decays) : 0.2
  // 周波动 = recentTrails 日工作分钟 标准差/均值（clamp 0-1）；无历史按 0 波动（新用户不降权）
  let weeklyVariance = 0
  if (recentTrails.length >= 2) {
    const ds = recentTrails.map((t) => workLikeMinOf(t))
    const m = mean(ds)
    const sd = Math.sqrt(mean(ds.map((d) => (d - m) ** 2)))
    weeklyVariance = m > 0 ? Math.min(sd / m, 1) : 0
  }
  const recover = clamp100(
    (1 - Math.min(recoverTimeAvg / 20, 1)) * 30 +
    recoveryAfterBreak * 25 +
    (1 - Math.min(fatigue3hDecay / 0.4, 1)) * 25 +
    (1 - Math.min(weeklyVariance, 1)) * 20
  )

  return {
    dimensions: {
      depth: Math.round(depth),
      sustain: Math.round(sustain),
      resist: Math.round(resist),
      rhythm: Math.round(rhythm),
      recover: Math.round(recover)
    },
    rawSignals: {
      deepFocusTotalMin: r1(deepFocusTotalMin),
      deepFocusMaxStreak: r1(deepFocusMaxStreak),
      deepFocusCount,
      effectiveWorkMin: r1(effectiveWorkMin),
      targetWorkMin,
      distractionCount,
      distractionAvgMin: r1(distractionAvgMin),
      recoveryAvgMin: r1(recoveryAvgMin),
      socialDistractionRatio: r2(socialDistractionRatio),
      pomodoroCompleted,
      pomodoroTarget: targetPomodoros,
      rhythmStability: r2(rhythmStability),
      restQuality: r2(restQuality),
      recoveryAfterBreak: r2(recoveryAfterBreak),
      fatigue3hDecay: r2(fatigue3hDecay),
      weeklyVariance: r2(weeklyVariance)
    }
  }
}

// ───────────────────────── 综合评分（v2.6 §2.3） ─────────────────────────

export interface CompositeResult {
  weightedScore: number // 0-100
  finalScore: number // 0-1000 含附加分
  grade: ScoreGrade
  bonus: {
    streakDays: number
    streakBonus: number
    planAchievement: number
    planBonus: number
    milestoneBonus: number
  }
}

/**
 * 综合评分：五维加权(0-100) → ×10 → 附加分 → min(1000)
 * planAchievement 为 0-1 达成率；milestoneBonus 预留恒 0
 */
export function compositeScore(
  dimensions: AttentionScore['dimensions'],
  userType: UserType,
  bonus: { streakDays: number; planAchievement: number }
): CompositeResult {
  const w = USER_TYPE_META[userType].weights
  const weightedScore = r1(
    dimensions.depth * w.depth +
    dimensions.sustain * w.sustain +
    dimensions.resist * w.resist +
    dimensions.rhythm * w.rhythm +
    dimensions.recover * w.recover
  )

  // 连续打卡加成：7 天 +5 / 30 天 +15 / 100 天 +30，取最高档
  const streakBonus = bonus.streakDays >= 100 ? 30 : bonus.streakDays >= 30 ? 15 : bonus.streakDays >= 7 ? 5 : 0
  // 计划达成加成：>0.8 +10 / >0.95 +20，取最高档
  const planBonus = bonus.planAchievement > 0.95 ? 20 : bonus.planAchievement > 0.8 ? 10 : 0
  const milestoneBonus = 0 // 里程碑挑战加分预留（规格 +5，待成就系统接入）

  const finalScore = Math.min(1000, Math.round(weightedScore * 10) + streakBonus + planBonus + milestoneBonus)

  return {
    weightedScore,
    finalScore,
    grade: gradeOf(finalScore),
    bonus: {
      streakDays: bonus.streakDays,
      streakBonus,
      planAchievement: bonus.planAchievement,
      planBonus,
      milestoneBonus
    }
  }
}

/** 评分等级映射（950/900/800/700/600/500 分档，照 v2.6 §2.3） */
export function gradeOf(finalScore: number): ScoreGrade {
  if (finalScore >= 950) return 'S+'
  if (finalScore >= 900) return 'S'
  if (finalScore >= 800) return 'A'
  if (finalScore >= 700) return 'B'
  if (finalScore >= 600) return 'C'
  if (finalScore >= 500) return 'D'
  return 'F'
}

/** 等级展示元信息 */
export const GRADE_META: Record<ScoreGrade, { label: string; color: string }> = {
  'S+': { label: '巅峰专注', color: '#8B5CF6' }, // 紫金
  S: { label: '卓越', color: '#F59E0B' }, // 金
  A: { label: '优秀', color: '#10B981' }, // 绿
  B: { label: '良好', color: '#22D3EE' }, // 青
  C: { label: '合格', color: '#3B82F6' }, // 蓝
  D: { label: '待提升', color: '#FB923C' }, // 橙
  F: { label: '需努力', color: '#64748B' } // 灰
}

// ───────────────────────── 用户类型识别（v2.6 §1.3） ─────────────────────────

/** 信号权重：应用组合 0.4 / 作息 0.3 / 计划关键词 0.3 */
const SIGNAL_WEIGHT = { app: 0.4, schedule: 0.3, keyword: 0.3 }

/** 应用关键词组（小写包含匹配，近似口径；照 §1.3 典型应用组合整理） */
const APP_GROUP_KEYWORDS = {
  dev: ['code', 'vscode', 'visual studio', 'devenv', 'idea', 'rider', 'webstorm', 'goland', 'pycharm', 'clion', 'cursor', 'windsurf', 'terminal', 'eclipse', 'studio'],
  collab: ['钉钉', 'dingtalk', '飞书', 'feishu', 'lark', 'teams', '企业微信', 'wecom', 'zoom', '腾讯会议', 'wemeet'],
  officeSuite: ['excel', 'powerpnt', 'ppt', 'winword', 'word', 'wps', 'office', 'outlook', '邮件'],
  pdf: ['pdf', 'acrobat', 'foxit', '福昕', 'drawboard'],
  notes: ['笔记', 'notion', 'obsidian', 'anki', 'siyuan', '思源', 'yuque', '语雀', 'typora', 'onenote'],
  onlineCourse: ['网课', 'mooc', '慕课', 'coursera', '腾讯课堂', 'classin', '学习通', '超星', '学堂在线'],
  design: ['figma', 'photoshop', 'sketch', 'illustrator', 'canva', 'blender', 'premiere', 'after effects', '剪映', 'capcut', 'design'],
  writing: ['写作', '写稿', 'winword', 'word', 'typora', 'notion', '语雀', 'yuque'],
  material: ['eagle', '素材', 'pinterest', '花瓣'],
  dataDoc: ['excel', 'sheet', '表格', 'tableau', 'powerbi', '数据分析', 'confluence', '飞书文档', '语雀', 'notion']
} as const

type AppGroup = keyof typeof APP_GROUP_KEYWORDS

/** 各类型的应用组合与命中系数（系数对应 §1.3 信号1 中各类型权重相对 0.4 的比例） */
const TYPE_APP_RULES: Record<UserType, { groups: AppGroup[]; factor: number }> = {
  office_worker: { groups: ['dev', 'collab', 'officeSuite'], factor: 1 }, // VSCode/IDE + 钉钉/飞书 + Excel/PPT
  exam_candidate: { groups: ['pdf', 'notes', 'onlineCourse'], factor: 1 }, // PDF + 笔记 + 网课
  student: { groups: ['pdf', 'notes', 'onlineCourse'], factor: 0.75 }, // 同考研党组合但权重 0.3
  freelancer: { groups: ['design', 'collab', 'dev'], factor: 0.75 }, // Figma/PS + 沟通工具
  creator: { groups: ['design', 'writing', 'material'], factor: 0.75 }, // 设计/写作/素材工具
  entrepreneur: { groups: ['dev', 'collab', 'dataDoc'], factor: 0.75 } // 全栈工具 + 沟通 + 文档
}

/** 计划关键词 → 用户类型（照 §1.3 信号3 原文） */
const TYPE_PLAN_KEYWORDS: Record<UserType, string[]> = {
  office_worker: ['prd', '文档', '会议', '调试'],
  exam_candidate: ['复习', '刷题', '背诵', '真题'],
  freelancer: ['交付', '客户', '设计稿'],
  student: ['作业', '实验', '论文'],
  creator: ['写稿', '剪辑', '设计', '素材'],
  entrepreneur: ['融资', '产品', '团队', '路演']
}

/** 应用组合匹配度 0-1：命中组数占比 × 类型系数 */
function appMatch(type: UserType, topApps: string[]): number {
  const apps = topApps.map((a) => a.toLowerCase())
  const { groups, factor } = TYPE_APP_RULES[type]
  const hits = groups.filter((g) => APP_GROUP_KEYWORDS[g].some((k) => apps.some((a) => a.includes(k)))).length
  return (hits / groups.length) * factor
}

/** 作息匹配度 0-1（avgStartMin/avgEndMin 为当日分钟，null=无数据） */
function scheduleMatch(type: UserType, startMin: number | null, endMin: number | null): number {
  if (startMin == null && endMin == null) return 0
  let score = 0
  switch (type) {
    case 'office_worker': // 固定 9-10 点开始 + 18-19 点结束
      if (startMin != null && startMin >= 540 && startMin <= 600) score += 0.5
      if (endMin != null && endMin >= 1080 && endMin <= 1140) score += 0.5
      return score
    case 'exam_candidate': // 6-7 点开始 + 23 点后结束
      if (startMin != null && startMin <= 420) score += 0.5
      if (endMin != null && endMin >= 1380) score += 0.5
      return score
    case 'freelancer': // 不固定开始/结束：均值看不出方差，偏离 9-6 给弱信号
    case 'creator':
      if (startMin != null && (startMin < 540 || startMin > 600)) score += 0.15
      if (endMin != null && (endMin < 1080 || endMin > 1140)) score += 0.15
      return score
    case 'student': // 按课表离散时段，均值无法判断，交给关键词信号
      return 0
    case 'entrepreneur': // 9 点前开始 + 无明确结束（21 点后或无记录）
      if (startMin != null && startMin < 540) score += 0.5
      if (endMin == null || endMin >= 1260) score += 0.5
      return score
  }
}

/** 计划关键词匹配度 0-1：命中 1 个给 0.5，命中 ≥2 个满分 */
function keywordMatch(type: UserType, planKeywords: string[]): number {
  const kws = planKeywords.map((k) => k.toLowerCase())
  const hits = TYPE_PLAN_KEYWORDS[type].filter((k) => kws.some((p) => p.includes(k))).length
  return Math.min(1, hits / 2)
}

/**
 * 用户类型自动识别：三信号加权取最高分
 * 置信度 = 最高得分 / 有数据信号的权重和（满分=有数据的信号全中）；>0.6 可自动设置，否则引导手动选择
 */
export function identifyUserType(signals: {
  topApps: string[]
  avgStartMin: number | null
  avgEndMin: number | null
  planKeywords: string[]
}): { type: UserType; confidence: number } {
  let bestType: UserType = 'office_worker'
  let bestScore = -1
  for (const type of Object.keys(USER_TYPE_META) as UserType[]) {
    const score =
      SIGNAL_WEIGHT.app * appMatch(type, signals.topApps) +
      SIGNAL_WEIGHT.schedule * scheduleMatch(type, signals.avgStartMin, signals.avgEndMin) +
      SIGNAL_WEIGHT.keyword * keywordMatch(type, signals.planKeywords)
    if (score > bestScore) {
      bestScore = score
      bestType = type
    }
  }
  const availWeight =
    (signals.topApps.length > 0 ? SIGNAL_WEIGHT.app : 0) +
    (signals.avgStartMin != null || signals.avgEndMin != null ? SIGNAL_WEIGHT.schedule : 0) +
    (signals.planKeywords.length > 0 ? SIGNAL_WEIGHT.keyword : 0)
  const confidence = availWeight > 0 ? Math.round((bestScore / availWeight) * 100) / 100 : 0
  return { type: bestType, confidence }
}
