/**
 * 用户画像引擎 —— 八层画像构建 / 自动采集刷新 / 手动维护（v2.7）
 * 依据：workon-design-spec-v2.7 §1.2 八层画像、§3 持续补充机制
 * 数据源：activities 轨迹 / qa 问答 / plans 计划 / attentionScores 评分 / bus.pet 亲密度
 * 脱敏原则：画像只存应用大类、不存应用名（§1.2 primaryApps 注释）；AI 访问统一走 desensitize.ts 网关
 */
import type {
  AccessLog, AttentionScore, PlanItem, ProfileField, QAMessage, UserPersona, WorkState
} from '@shared/types'
import { WORK_LIKE_STATES, SLACK_STATES } from '@shared/stateMeta'
import { DEEP_WORK_STATES } from '@shared/attention'
import { buildMergedTrail, dateKey } from '@shared/trail'
import { completenessOf } from '@shared/personaMeta'
import { col, insertInto, updateIn, listActivities, listActivitiesRange } from './db'
import { getSettings } from './settings'
import { effectiveUserType, recentScores } from './attention'
import { bus } from './state'

const DAY_MS = 86400000
const mean = (ns: number[]): number => (ns.length ? ns.reduce((a, b) => a + b, 0) / ns.length : 0)
const clamp100 = (n: number): number => Math.max(0, Math.min(100, n))
const round1 = (n: number): number => Math.round(n * 10) / 10
const round2 = (n: number): number => Math.round(n * 100) / 100

/** 日期串平移（取正午防 DST 边界，与 attention.ts 同口径） */
function shiftDate(date: string, deltaDays: number): string {
  const [y, m, d] = date.split('-').map(Number)
  return dateKey(new Date(y, m - 1, d + deltaDays, 12).getTime())
}

const pad2 = (n: number): string => `${n}`.padStart(2, '0')
/** 当日分钟（0-1440）→ 'HH:mm' */
const minToHHmm = (min: number): string => `${pad2(Math.floor(min / 60) % 24)}:${pad2(Math.round(min) % 60)}`

// ───────────────────────── 应用大类映射 ─────────────────────────

/**
 * 应用名 → 大类（编辑器/浏览器/办公/沟通/设计/娱乐/其他）
 * seg.mainApp 为 identifyApp 友好名（VSCode/Chrome/Office…）或未识别进程名；
 * stateMeta 只有 app→state 规则、没有 app→category，这里做简化映射表
 */
export function appCategoryOf(appName: string): string {
  const a = appName.toLowerCase()
  if (/music|video|game|bilibili|steam/.test(a)) return '娱乐'
  if (/vscode|visual studio|rider|intellij|cursor|windsurf|trae|terminal|devtool|ssh|perftest|code/.test(a)) return '编辑器'
  if (/chrome|browser|edge|firefox|opera|brave|arc/.test(a)) return '浏览器'
  if (/office|notes|word|excel|powerpnt|wps/.test(a)) return '办公'
  if (/wechat|qq|dingtalk|feishu|lark|meeting|teams|zoom/.test(a)) return '沟通'
  if (/design|figma|sketch|photoshop|recorder|canva/.test(a)) return '设计'
  return '其他'
}

// ───────────────────────── 默认画像 ─────────────────────────

function buildDefaultPersona(): UserPersona {
  const now = Date.now()
  const acts = listActivitiesRange(0, now)
  const days = new Set(acts.map((a) => dateKey(a.ts)))
  const registrationTs = acts.length ? Math.min(...acts.map((a) => a.ts)) : now
  const intimacy = bus.pet.intimacy // bus.pet.intimacy 为 1-5 等级 number
  return {
    id: 'me', // 单机版固定 id
    completeness: 0,
    lastUpdated: now,
    basicInfo: {
      nickname: '我',
      userType: effectiveUserType(),
      avatarId: '',
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone ?? '',
      language: 'zh-CN', // 主进程无 navigator，单机版固定中文
      registrationTs,
      daysActive: days.size
    },
    identity: {},
    preferences: {},
    behavioral: {
      dailyRhythm: { peakHours: [], lowEnergyHours: [], averageStart: '', averageEnd: '', weekendPattern: 'mixed' },
      appUsagePattern: { primaryApps: [], appSwitchFrequency: 0, deepWorkAppCategories: [], distractionAppCategories: [] },
      focusStreakHistory: { bestStreak: 0, avgDailyFocusMin: 0, focusTrend: 'stable' }
    },
    interests: { detectedInterests: [], learningTopics: [], hobbies: [] },
    capabilities: { skillTags: [], learningGoals: [] },
    psychological: {
      stressTolerance: 0, motivationType: 'mixed', attentionStyle: 'sustained',
      energyCycle: 'morning', burnoutRisk: 0, resilienceScore: 0, confidence: 0, lastAnalyzed: 0
    },
    relationship: {
      intimacyLevel: intimacy,
      intimacyScore: intimacy * 20, // 等级 ×20 简化折算百分制
      daysTogether: days.size,
      totalInteractions: 0,
      interactionPattern: { avgDailyInteractions: 0, responseRate: 0, dismissRate: 0 },
      emotionalHistory: { dominantEmotions: [], emotionStability: 0, recentTrend: 'neutral' }
    },
    // 规格 §2.2 中 L3 默认关闭；本地单机务实取舍：数据不出本机，默认全开，
    // 用户可在设置里逐层关闭（L4 永远关闭，不建模开关）
    privacySettings: { aiAccess: { L0: true, L1: true, L2: true, L3: true } },
    ts: now
  }
}

/** 回写画像（每次写入顺带重算完整度与更新时间） */
function savePersona(p: UserPersona): UserPersona {
  const next = { ...p, completeness: completenessOf(p), lastUpdated: Date.now() }
  updateIn<UserPersona>('personas', 'me', next)
  return next
}

/** 读取画像：无则建默认落库；每次读取顺带重算 completeness / lastUpdated 并回写 */
export function getPersona(): UserPersona {
  const p = col<UserPersona>('personas').find((x) => x.id === 'me')
  if (!p) {
    const created = buildDefaultPersona()
    insertInto('personas', created)
    return savePersona(created)
  }
  return savePersona(p)
}

// ───────────────────────── 自动采集刷新 ─────────────────────────

/** 兴趣关键词词表（命中 qa 问题 / 计划标题，可扩充） */
const INTEREST_KEYWORDS = [
  '机器学习', 'AI', 'React', 'TypeScript', 'Python', '前端', '后端', '设计',
  '视频剪辑', '英语', '考研', '理财', '健身', '写作', '产品', '运营', '数据分析'
]

interface SkillRule {
  name: string
  category: 'language' | 'framework' | 'tool' | 'soft_skill'
  appCat?: string // 限定应用大类（appCategoryOf）
  titleMatch?: RegExp // 窗口标题命中
  state?: WorkState // 按状态投入计时长
}

/** 技能推断规则：应用类别 + 窗口标题关键词 → 技能标签（简化推断） */
const SKILL_RULES: SkillRule[] = [
  { name: 'TypeScript', category: 'framework', appCat: '编辑器', titleMatch: /\.tsx?\b/ },
  { name: 'Python', category: 'language', appCat: '编辑器', titleMatch: /\.py\b|python/i },
  { name: 'UI设计', category: 'tool', appCat: '设计' },
  { name: '数据分析', category: 'tool', titleMatch: /excel|表格|数据分析/i },
  { name: '视频剪辑', category: 'tool', titleMatch: /premiere|\bpr\b|剪映|camtasia|剪辑/i },
  { name: '沟通协作', category: 'soft_skill', appCat: '沟通' },
  { name: '文档写作', category: 'soft_skill', state: 'writing' }
]

/**
 * 自动采集重算（启动时 + 每日一次；幂等：同一数据源重算结果一致）
 * L2 行为/兴趣/技能 ← 轨迹+问答+计划；L3 心理 ← 近 14 天评分；L3 关系 ← 亲密度+问答数
 */
export function refreshPersona(): UserPersona {
  const p = getPersona()
  const now = Date.now()
  const today = dateKey(now)

  // ── L0 基础信息：活跃天数 / 用户类型（镜像设置，含自动识别结果） ──
  const acts = listActivitiesRange(0, now)
  p.basicInfo.daysActive = new Set(acts.map((a) => dateKey(a.ts))).size
  p.basicInfo.userType = effectiveUserType()

  // ── L2 行为模式：近 14 天轨迹 ──
  const last14 = Array.from({ length: 14 }, (_, i) => shiftDate(today, -i))
  const trails14 = last14.map((d) => buildMergedTrail(listActivities(d), d))
  const active14 = trails14.filter((t) => t.totalMin > 0)
  const dayN = Math.max(1, active14.length)
  const workMinOf = (t: (typeof trails14)[number]): number =>
    WORK_LIKE_STATES.reduce((a, s) => a + (t.stateMinutes[s] ?? 0), 0)

  // 高效时段：按小时聚合 work-like 分钟，取 top3（升序展示）
  const hourMin = new Array<number>(24).fill(0)
  for (const t of active14) {
    for (const seg of t.segments) {
      if (seg.glance || !WORK_LIKE_STATES.includes(seg.mainState)) continue
      hourMin[new Date(seg.startTs).getHours()] += seg.durationMin
    }
  }
  const peakHours = hourMin
    .map((m, h) => ({ h, m }))
    .filter((x) => x.m > 0)
    .sort((a, b) => b.m - a.m)
    .slice(0, 3)
    .sort((a, b) => a.h - b.h)
    .map((x) => `${pad2(x.h)}:00-${pad2(x.h + 1)}:00`)

  // 平均作息：每日首末非 glance 段的均值
  const starts: number[] = []
  const ends: number[] = []
  for (const t of active14) {
    const segs = t.segments.filter((s) => !s.glance)
    if (!segs.length) continue
    const f = new Date(segs[0].startTs)
    const l = new Date(segs[segs.length - 1].endTs)
    starts.push(f.getHours() * 60 + f.getMinutes())
    ends.push(l.getHours() * 60 + l.getMinutes())
  }

  // 周末模式：周末日均 work-like 分钟 > 工作日日均的 30% 视为 work
  let weekendWork = 0, weekendDays = 0, weekdayWork = 0, weekdayDays = 0
  for (const t of active14) {
    const wd = new Date(`${t.date}T12:00:00`).getDay()
    if (wd === 0 || wd === 6) { weekendWork += workMinOf(t); weekendDays++ }
    else { weekdayWork += workMinOf(t); weekdayDays++ }
  }
  const weekendAvg = weekendDays ? weekendWork / weekendDays : 0
  const weekdayAvg = weekdayDays ? weekdayWork / weekdayDays : 0
  const weekendPattern = !active14.length ? 'mixed' : weekendAvg > weekdayAvg * 0.3 ? 'work' : 'rest'

  // 应用使用模式：按大类聚合（只存类别不存应用名）
  const catMin = new Map<string, number>()
  const catDeepMin = new Map<string, number>()
  const catSlackMin = new Map<string, number>()
  let segCount = 0
  let workMinTotal = 0
  for (const t of active14) {
    workMinTotal += workMinOf(t)
    for (const seg of t.segments) {
      if (seg.glance) continue
      segCount++
      const cat = appCategoryOf(seg.mainApp || '')
      catMin.set(cat, (catMin.get(cat) ?? 0) + seg.durationMin)
      if (DEEP_WORK_STATES.includes(seg.mainState)) catDeepMin.set(cat, (catDeepMin.get(cat) ?? 0) + seg.durationMin)
      if (SLACK_STATES.includes(seg.mainState) || seg.mainState === 'relax') {
        catSlackMin.set(cat, (catSlackMin.get(cat) ?? 0) + seg.durationMin)
      }
    }
  }
  const top2 = (m: Map<string, number>): string[] =>
    [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 2).map(([k]) => k)
  // 应用切换频率：日均段数 / 日均工作小时
  const workHours = workMinTotal / 60
  const appSwitchFrequency = workHours > 0 ? round1(segCount / workHours) : 0

  // 专注趋势：近 7 天 vs 前 7 天 work-like 分钟
  const recent7 = active14.filter((t) => t.date >= shiftDate(today, -6)).reduce((a, t) => a + workMinOf(t), 0)
  const prev7 = active14.filter((t) => t.date < shiftDate(today, -6)).reduce((a, t) => a + workMinOf(t), 0)
  const focusTrend = recent7 > prev7 * 1.1 ? 'improving' : recent7 < prev7 * 0.9 ? 'declining' : 'stable'
  const bestStreak = col<AttentionScore>('attentionScores').reduce((m, s) => Math.max(m, s.bonus.streakDays), 0)

  p.behavioral = {
    dailyRhythm: {
      peakHours,
      lowEnergyHours: p.behavioral.dailyRhythm.lowEnergyHours, // 暂无可靠数据源，保留原值
      averageStart: starts.length ? minToHHmm(mean(starts)) : '',
      averageEnd: ends.length ? minToHHmm(mean(ends)) : '',
      weekendPattern
    },
    appUsagePattern: {
      primaryApps: [...catMin.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)
        .map(([category, m]) => ({ category, avgDailyMin: Math.round(m / dayN) })),
      appSwitchFrequency,
      deepWorkAppCategories: top2(catDeepMin),
      distractionAppCategories: top2(catSlackMin)
    },
    focusStreakHistory: {
      bestStreak,
      avgDailyFocusMin: Math.round(workMinTotal / dayN),
      focusTrend
    }
  }

  // ── L2 兴趣爱好：近 30 天 qa 问题文本 + 计划标题关键词 ──
  const since30 = now - 30 * DAY_MS
  const qaItems = col<QAMessage>('qa').filter((q) => q.role === 'user' && q.ts >= since30)
  const planItems = col<PlanItem>('plans').filter((pl) => pl.ts >= since30)
  const hits: { tag: string; count: number; lastSeen: number; source: 'auto_search' | 'auto_task' }[] = []
  for (const kw of INTEREST_KEYWORDS) {
    // 英文按词边界匹配，中文直接包含
    const re = /^[a-z]+$/i.test(kw) ? new RegExp(`\\b${kw}\\b`, 'i') : null
    const hit = (text: string): boolean => (re ? re.test(text) : text.includes(kw))
    const qaHit = qaItems.filter((q) => hit(q.content))
    const planHit = planItems.filter((pl) => hit(pl.title))
    const total = qaHit.length + planHit.length
    if (total < 2) continue // 出现 ≥2 次才收录
    hits.push({
      tag: kw,
      count: total,
      lastSeen: Math.max(...qaHit.map((q) => q.ts), ...planHit.map((pl) => pl.ts)),
      source: qaHit.length >= planHit.length ? 'auto_search' : 'auto_task'
    })
  }
  const oldTags = new Map(p.interests.detectedInterests.map((d) => [d.tag, d]))
  const detected: UserPersona['interests']['detectedInterests'] = []
  for (const h of hits) {
    const old = oldTags.get(h.tag)
    oldTags.delete(h.tag)
    // 确定性公式（重复刷新幂等）：新条目 0.5+0.1×次数 封顶 0.85；已存在条目再现 +0.1 封顶 0.95
    const confidence = old ? Math.min(0.95, 0.5 + 0.1 * h.count + 0.1) : Math.min(0.85, 0.5 + 0.1 * h.count)
    detected.push({
      tag: h.tag, confidence: round2(confidence), source: h.source, lastSeen: h.lastSeen,
      ...(old?.userConfirmed ? { userConfirmed: true } : {})
    })
  }
  for (const [, old] of oldTags) {
    if (old.userConfirmed) { detected.push(old); continue } // 用户确认条目不自动删
    const decayed = now - old.lastSeen > 7 * DAY_MS ? old.confidence * 0.95 : old.confidence // 7 天未见置信度衰减
    if (decayed >= 0.3) detected.push({ ...old, confidence: round2(decayed) })
  }
  p.interests.detectedInterests = detected

  // ── L2 能力技能：近 30 天（28 天两窗）应用类别 + 标题关键词推断 ──
  const prev14 = Array.from({ length: 14 }, (_, i) => shiftDate(today, -(i + 14)))
  const trailsPrev = prev14.map((d) => buildMergedTrail(listActivities(d), d))
  const winA = new Set(last14) // 近 14 天窗口（前 14 天为趋势对照窗）
  const sampleMin = (getSettings().monitorInterval || 5000) / 60000 // 标题命中按采样条数 × 采样间隔估时长
  const skillMin = new Map<string, { a: number; b: number }>()
  const addMin = (name: string, date: string, min: number): void => {
    const cur = skillMin.get(name) ?? { a: 0, b: 0 }
    if (winA.has(date)) cur.a += min
    else cur.b += min
    skillMin.set(name, cur)
  }
  // 类别 / 状态口径：来自轨迹段时长
  for (const t of [...trails14, ...trailsPrev]) {
    for (const seg of t.segments) {
      if (seg.glance) continue
      const cat = appCategoryOf(seg.mainApp || '')
      for (const rule of SKILL_RULES) {
        if (rule.appCat && !rule.titleMatch && cat === rule.appCat) addMin(rule.name, t.date, seg.durationMin)
        else if (rule.state && seg.mainState === rule.state) addMin(rule.name, t.date, seg.durationMin)
      }
    }
  }
  // 标题关键词口径：来自活动记录（含窗口标题）
  const records28 = listActivitiesRange(now - 28 * DAY_MS, now)
  for (const r of records28) {
    const cat = appCategoryOf(r.appName ?? r.app)
    for (const rule of SKILL_RULES) {
      if (!rule.titleMatch) continue
      if (rule.appCat && cat !== rule.appCat) continue
      if (rule.titleMatch.test(r.title)) addMin(rule.name, dateKey(r.ts), sampleMin)
    }
  }
  const oldSkills = new Map(p.capabilities.skillTags.map((s) => [s.name, s]))
  const skillTags: UserPersona['capabilities']['skillTags'] = []
  for (const rule of SKILL_RULES) {
    const m = skillMin.get(rule.name)
    if (!m) continue
    const total = m.a + m.b
    if (total < 30) continue // 投入不足 30 分钟不收录（防噪声）
    const trend = m.a > m.b * 1.2 ? 'growing' : m.a < m.b * 0.8 ? 'declining' : 'stable'
    const old = oldSkills.get(rule.name)
    oldSkills.delete(rule.name)
    if (old?.userConfirmed) {
      // 用户确认过的条目：不覆盖名称/熟练度，只刷最近使用与趋势
      skillTags.push({ ...old, lastUsed: now, trend })
      continue
    }
    skillTags.push({
      name: rule.name,
      proficiency: Math.min(100, Math.round((total / 60) * 8)), // 每小时投入 ≈ 8 点熟练度
      category: rule.category,
      lastUsed: now,
      trend,
      confidence: round2(Math.min(0.8, 0.5 + total / 2000)) // 投入越多置信越高（0.5-0.8）
    })
  }
  // 用户确认过但本次未检出的条目保留
  for (const [, old] of oldSkills) if (old.userConfirmed) skillTags.push(old)
  p.capabilities.skillTags = skillTags

  // ── L3 心理画像：近 14 天注意力评分（简化推断，仅供策略内化） ──
  const scores14 = recentScores(14)
  if (scores14.length > 0) {
    const resilienceScore = Math.round(mean(scores14.map((s) => s.dimensions.recover)))
    // 加班分钟：单日有效工作超 8h(480min) 的部分（简化推断）
    const overtimeAvg = mean(scores14.map((s) => Math.max(0, s.rawSignals.effectiveWorkMin - 480)))
    const weeklyVar = mean(scores14.map((s) => s.rawSignals.weeklyVariance)) // 0-1
    // 简化推断：加班越多、周波动越大，压力耐受越低
    const stressTolerance = clamp100(Math.round(100 - Math.min(overtimeAvg / 120, 1) * 40 - weeklyVar * 100 * 0.5))
    // 连续高分天数（finalScore ≥ 800，从最近一天向前数）+ 加班占比 → 倦怠风险（简化推断）
    let highStreak = 0
    for (let i = scores14.length - 1; i >= 0; i--) {
      if (scores14[i].finalScore >= 800) highStreak++
      else break
    }
    const workAvg = mean(scores14.map((s) => s.rawSignals.effectiveWorkMin))
    const overtimeRatio = workAvg > 0 ? overtimeAvg / workAvg : 0
    const burnoutRisk = Math.min(100, Math.round(highStreak * 8 + overtimeRatio * 40))
    // 精力周期：高效时段集中区间映射
    const firstPeak = peakHours.length ? parseInt(peakHours[0].slice(0, 2), 10) : NaN
    const energyCycle = isNaN(firstPeak) ? p.psychological.energyCycle
      : firstPeak < 6 ? 'night' : firstPeak < 12 ? 'morning' : firstPeak < 18 ? 'afternoon' : firstPeak < 23 ? 'evening' : 'night'
    // 注意力风格：切换频率 <3 持续型 / <6 选择型 / 否则分散型
    const attentionStyle = appSwitchFrequency <= 0 ? p.psychological.attentionStyle
      : appSwitchFrequency < 3 ? 'sustained' : appSwitchFrequency < 6 ? 'selective' : 'divided'
    p.psychological = {
      stressTolerance,
      motivationType: 'mixed', // 暂无内外动机数据源，默认混合型
      attentionStyle,
      energyCycle,
      burnoutRisk,
      resilienceScore,
      confidence: 0.5,
      lastAnalyzed: now
    }
  }

  // ── L3 关系数据：亲密度 + 问答交互数 ──
  const totalInteractions = col<QAMessage>('qa').length
  p.relationship = {
    intimacyLevel: bus.pet.intimacy, // bus.pet.intimacy 为 1-5 等级 number
    intimacyScore: bus.pet.intimacy * 20, // 等级 ×20 简化折算百分制
    daysTogether: Math.max(1, Math.ceil((now - p.basicInfo.registrationTs) / DAY_MS)),
    totalInteractions,
    interactionPattern: {
      avgDailyInteractions: round1(totalInteractions / Math.max(1, p.basicInfo.daysActive)),
      responseRate: 0, // 待交互埋点（暂无提醒响应数据源）
      dismissRate: 0 // 待交互埋点
    },
    emotionalHistory: p.relationship.emotionalHistory // 情感历史暂无数据源，保持默认
  }

  return savePersona(p)
}

// ───────────────────────── 手动维护 ─────────────────────────

/** 手动编辑画像字段（白名单路径；ProfileField 写为 manual / confidence=1 / userConfirmed=true） */
export function updatePersonaField(path: string, value: unknown): UserPersona {
  const p = getPersona()
  const manual = <T>(v: T): ProfileField<T> => ({ value: v, source: 'manual', confidence: 1, lastUpdated: Date.now(), userConfirmed: true })
  const str = String(value ?? '').trim()
  switch (path) {
    case 'basicInfo.nickname':
      if (str) p.basicInfo.nickname = str.slice(0, 20)
      break
    case 'identity.occupation':
      if (str) p.identity.occupation = manual(str)
      break
    case 'identity.industry':
      if (str) p.identity.industry = manual(str)
      break
    case 'identity.experienceLevel':
      if (['junior', 'mid', 'senior', 'expert'].includes(str)) p.identity.experienceLevel = manual(str as 'junior' | 'mid' | 'senior' | 'expert')
      break
    case 'identity.workMode':
      if (['office', 'remote', 'hybrid'].includes(str)) p.identity.workMode = manual(str as 'office' | 'remote' | 'hybrid')
      break
    case 'preferences.workStyle':
      if (['pomodoro', 'flow', 'flexible', 'structured'].includes(str)) p.preferences.workStyle = manual(str as 'pomodoro' | 'flow' | 'flexible' | 'structured')
      break
    case 'preferences.communicationStyle':
      if (['direct', 'encouraging', 'minimal'].includes(str)) p.preferences.communicationStyle = manual(str as 'direct' | 'encouraging' | 'minimal')
      break
    case 'preferences.interventionTolerance':
      if (['high', 'medium', 'low'].includes(str)) p.preferences.interventionTolerance = manual(str as 'high' | 'medium' | 'low')
      break
    case 'preferences.preferredWorkHours': {
      // 该字段类型为 {start,end}（非 ProfileField 包装），直接写入
      const v = value as { start?: unknown; end?: unknown } | null
      p.preferences.preferredWorkHours = { start: String(v?.start ?? ''), end: String(v?.end ?? '') }
      break
    }
    case 'interests.hobbies':
      if (Array.isArray(value)) p.interests.hobbies = value.map((x) => String(x).trim()).filter(Boolean).slice(0, 20)
      break
    default:
      break // 未支持的路径静默忽略
  }
  return savePersona(p)
}

/** 用户确认画像字段：userConfirmed=true、confidence=1（支持 ProfileField 路径与 tag:/skill: 数组条目） */
export function confirmPersonaField(path: string): UserPersona {
  const p = getPersona()
  const ok = <T>(f: ProfileField<T> | undefined): ProfileField<T> | undefined =>
    f ? { ...f, userConfirmed: true, confidence: 1, lastUpdated: Date.now() } : f
  if (path.startsWith('interests.tag:')) {
    const tag = path.slice('interests.tag:'.length)
    p.interests.detectedInterests = p.interests.detectedInterests.map((d) =>
      d.tag === tag ? { ...d, userConfirmed: true, confidence: 1 } : d)
  } else if (path.startsWith('capabilities.skill:')) {
    const name = path.slice('capabilities.skill:'.length)
    p.capabilities.skillTags = p.capabilities.skillTags.map((s) =>
      s.name === name ? { ...s, userConfirmed: true, confidence: 1 } : s)
  } else {
    switch (path) {
      case 'identity.occupation': p.identity.occupation = ok(p.identity.occupation); break
      case 'identity.industry': p.identity.industry = ok(p.identity.industry); break
      case 'identity.experienceLevel': p.identity.experienceLevel = ok(p.identity.experienceLevel); break
      case 'identity.workMode': p.identity.workMode = ok(p.identity.workMode); break
      case 'preferences.workStyle': p.preferences.workStyle = ok(p.preferences.workStyle); break
      case 'preferences.communicationStyle': p.preferences.communicationStyle = ok(p.preferences.communicationStyle); break
      case 'preferences.interventionTolerance': p.preferences.interventionTolerance = ok(p.preferences.interventionTolerance); break
      default: break
    }
  }
  return savePersona(p)
}

/** 删除兴趣 / 技能标签 */
export function removePersonaTag(kind: 'interest' | 'skill', name: string): UserPersona {
  const p = getPersona()
  if (kind === 'interest') p.interests.detectedInterests = p.interests.detectedInterests.filter((d) => d.tag !== name)
  else p.capabilities.skillTags = p.capabilities.skillTags.filter((s) => s.name !== name)
  return savePersona(p)
}

/** 逐层 AI 访问开关（L4 永远关闭，不建模） */
export function setPersonaPrivacy(patch: Partial<{ L0: boolean; L1: boolean; L2: boolean; L3: boolean }>): UserPersona {
  const p = getPersona()
  p.privacySettings.aiAccess = { ...p.privacySettings.aiAccess, ...patch }
  return savePersona(p)
}

/** 导出画像 + 近 30 天访问日志（§4.3 数据导出） */
export function exportPersona(): { persona: UserPersona; accessLogs: AccessLog[] } {
  const cutoff = Date.now() - 30 * DAY_MS
  return {
    persona: getPersona(),
    accessLogs: col<AccessLog>('accessLogs').filter((l) => l.ts >= cutoff)
  }
}
