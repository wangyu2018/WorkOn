/**
 * WorkOn 共享类型定义（主进程 / 渲染进程 / 预加载桥 / 外部集成协议共用）
 * 依据：PRD.md 第5节数据模型
 */

// ───────────────────────── 工作状态 ─────────────────────────

/** 13 种工作态 */
export type WorkState =
  | 'focus' // 专注
  | 'slack' // 摸鱼
  | 'writing' // 写文档
  | 'coding' // 编程
  | 'aiqa' // AI 问答
  | 'aidev' // AI 开发
  | 'meeting' // 会议
  | 'idle' // 空闲
  | 'break' // 休息
  | 'away' // 离开
  | 'relax' // 放松（媒体粘性）
  | 'lunch' // 午休
  | 'remote' // 远程协作

export interface WorkStateMeta {
  label: string
  color: string
  emoji: string
}

// ───────────────────────── 采集与轨迹 ─────────────────────────

/** 每条前台采样，落库为原始轨迹 */
export interface ActivityRecord {
  id?: number
  ts: number // 采样时间戳
  app: string // 进程名（devenv.exe → 友好名另算）
  appName?: string // 友好名（VSCode / WeChat / Chrome…）
  title: string // 窗口标题
  state: WorkState
  screen: number // 屏幕索引
  startTs: number // 段起始时间戳（段变化才刷新）
  active: boolean // 是否激活屏（前台焦点所在）
  idleSec?: number // 系统空闲秒数
}

/** 前台窗口信息（winInfo P/Invoke 返回） */
export interface ForegroundWindowInfo {
  app: string // 进程文件名
  title: string
  x: number
  y: number
  width: number
  height: number
  screen: number // 反查得到所在屏幕索引
}

/** UIAutomation 焦点元素信息（深度模式） */
export interface UIElementInfo {
  name: string          // 元素名称
  controlType: string   // 控件类型（如 Button, Edit, List）
  className: string     // WPF/Win32 类名
  automationId: string  // 自动化 ID
  value: string         // 当前值（文本框内容等）
  selectedText: string  // 选中文本
  processId: number     // 所属进程 ID
  isFocused: boolean    // 是否当前焦点
}

/** UIAutomation UI 树节点（精简版） */
export interface UITreeNode {
  name: string
  controlType: string
  automationId: string
  value?: string
  children?: UITreeNode[]
}

/** 合并轨迹片段（墙钟） */
export interface TrailSegment {
  id?: string // s${startTs} 派生，富化结果关联用（v2.8）
  startTs: number
  endTs: number
  durationMin: number
  mainState: WorkState // 主屏主导态
  auxState: WorkState | null // 副屏主导态（无副屏并行时为 null）
  mainApp: string
  auxApp: string | null
  mainTitle?: string // 主屏代表记录的窗口标题（v2.8 富化用）
  auxTitle?: string // 副屏代表记录的窗口标题（v2.8 富化用）
  screens: number[] // 本片段涉及的屏幕索引
  /** 短切换（<30s 停留）：只是瞄了一眼/路过，不算有效作业段 */
  glance?: boolean
  /** v3.0 操作痕迹：OCR 识别的具体操作（如 "VSCode 编辑 monitor.ts"） */
  operation?: string
}

/** 双屏合并轨迹 */
export interface MergedTrail {
  date: string // YYYY-MM-DD
  totalMin: number // 墙钟总分钟（并行屏只计一次）
  dualMin: number // 双屏并行分钟
  dualRatio: number // 双屏并行占比 0-1
  screenMinutes: Record<number, number> // 各屏独立占用分钟（可 > totalMin）
  mainState: WorkState // 主屏主导态
  auxTopState: WorkState | null // 副屏主导态
  dualWorkSlackMin: number // "主工作+副摸鱼"并行分钟
  glanceMin: number // 短切换（<30s 停留）分钟，非有效作业
  segments: TrailSegment[]
  stateMinutes: Record<WorkState, number> // 各状态墙钟分钟（不含短切换）
}

// ───────────────────────── 日历 / 计划 ─────────────────────────

export type EntrySource = 'manual' | 'monitor' | 'import' | 'ai'

export interface TimeEntry {
  id: string
  date: string // YYYY-MM-DD
  startMin: number // 当日分钟 0-1440
  endMin: number
  title: string
  state?: WorkState
  source: EntrySource
  ts: number
}

export type PlanStatus = 'planned' | 'in_progress' | 'partial' | 'done' | 'delayed' | 'cancelled'
export type PlanSource = 'manual' | 'oner' | 'import' | 'qa-confirm'
export type PlanCategory = string // 内置分类 id（ai-dev/work-customer/leader/personal/other）或自定义分类 id

export interface PlanItem {
  id: string
  date: string
  title: string
  category: PlanCategory
  startMin?: number
  endMin?: number
  durationMin?: number
  status: PlanStatus
  source: PlanSource
  /** 完成比例 0-1（拖动设置；1=完成） */
  completionRatio?: number
  /** 延期目标日期与原因 */
  delayToDate?: string
  delayReason?: string
  /** 是否来自问答确认（浏览器行为确认 / 手动确认） */
  confirmedFromQA?: boolean
  confirmContext?: string
  browserDerived?: boolean
  extId?: string // oner 外部 id（增量去重依据）
  note?: string
  ts: number
}

/** 计划分类（内置不可删 + 用户自定义） */
export interface CustomCategory {
  id: string
  label: string
  color: string
  emoji: string
  stateHints?: string[] // 关联工作状态（planVsActual 匹配用）
  isBuiltIn: boolean
  ts: number
}

export interface UserHabits {
  lunchTime?: string // 如 "12:00-13:00"
  meetingTimes?: string[] // 如 ["10:00", "14:30"]
  preferredWorkHours?: string // 如 "9:00 / 14:00 / 20:00"
  commonBreakApps?: string[] // 休息时常用的应用名
  workStyle?: string // 如 "双屏并行型"、"连续专注型"
  dailyAverageWorkMin?: number
  dailyAverageSlackMin?: number
  lastUpdated: number
}

/** 计划完成/延期预测 */
export interface PlanForecast {
  planId: string
  completionProb: number // 0-100
  delayProb: number // 0-100
  factors: ForecastFactor[]
  recommendation: string
  estimatedEndMin?: number
}

export interface ForecastFactor {
  label: string
  impact: 'positive' | 'negative' | 'neutral'
  detail: string
}

/** 计划 vs 实际 */
export interface PlanVsActualItem {
  plan: PlanItem
  coveredMin: number // 被实际工作覆盖的分钟
  matched: boolean
}
export interface PlanVsActual {
  date: string
  plannedMin: number
  actualWorkMin: number // 墙钟，不重复计并行屏
  achievement: number // 0-100 封顶
  matchedCount: number
  deviationMin: number
  items: PlanVsActualItem[]
}

// ───────────────────────── AI 画像 / 反馈 ─────────────────────────

export interface DualScreenProfile {
  isRegularDual: boolean // 是否常态双屏
  mainWork: string // 主屏工作描述
  auxActivity: string // 副屏活动描述
  workSlackRatio: number // 主工作+副摸鱼占比 0-1
  slackWithAiDev: boolean // 摸鱼时做 AI 开发特征
}

export interface UserProfile {
  focusScore: number // 0-100
  efficiencyScore: number // 0-100
  topCategories: string[] // 高频类别
  bestHours: number[] // 高效时段（小时）
  distractingApps: string[] // 易分心应用
  strengths: string[]
  risks: string[]
  dualScreen: DualScreenProfile
}

export interface UserAnalysis {
  id: string
  date: string
  profile: UserProfile
  daily: string // 当日小结
  patterns: string[] // 规律
  questions: string[] // 轻问诊候选
  suggestions: string[] // 可执行建议
  source: 'llm' | 'rule'
  ts: number
}

export interface UserFeedback {
  id: string
  ctx: string // 情境 key（如 dual-aidev-relax）
  question: string
  answer: 'yes' | 'no'
  ts: number
  /** 确认后关联的计划项 ID（问答维护计划用） */
  planItemId?: string
  /** 浏览器来源信息（浏览器行为确认的区分标记） */
  browserInfo?: {
    app: string
    title: string
    url?: string
  }
}

export interface QAMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  ts: number
}

// ───────────────────────── 纠错 / 备忘 / 用量 ─────────────────────────

export interface ActivityCorrection {
  id: string
  date: string
  startMin: number
  endMin: number
  screen: number
  app?: string
  title?: string
  state?: WorkState
  ts: number
}

/** 常驻纠偏规则：宁漏勿误，三个条件全满足才命中 */
export interface CorrectionRule {
  id: string
  screen: number
  matchApp: string
  matchTitleContains: string
  setApp?: string
  setState?: WorkState
  /** 多条命中时的优先级（大者优先），默认 0 */
  weight?: number
  enabled: boolean
  /** 命中统计（引擎命中时自动写回） */
  hitCount?: number
  lastHitAt?: number
  /** 连续 3 次命中后自动确认生效（用户可据此判断规则已稳定工作） */
  confirmed?: boolean
  ts: number
}

export interface MemoRecord {
  id: string
  text: string
  source: 'import' | 'manual' | 'pet'
  ts: number
}

export interface ScreenshotRecord {
  id: string
  ts: number
  path: string
  ocrText?: string
}

export interface UsageStat {
  id: string
  date: string
  model: string
  tokens: number
  qaCount: number
  costUsd: number
}

// ───────────────────────── 实时状态 / 集成协议 ─────────────────────────

/** 每屏实时状态 */
export interface ScreenPresence {
  screen: number
  state: WorkState
  app: string
  appName: string
  title: string
  sinceTs: number
  active?: boolean // 是否激活屏
  stickyRelax: boolean // 媒体粘性
}

/** presence 引擎输出的整体状态 */
export interface PresenceSnapshot {
  ts: number
  state: WorkState // 整体主导态
  focusLevel: number // 0-100
  context: string // 如 dual-aidev-relax
  screens: ScreenPresence[]
  mainScreen: number
  continuousSlackSec: number // 持续摸鱼秒数
  continuousFocusSec: number
  idleSec: number
  ocrContext?: string // 深度模式 OCR 识别的屏幕内容摘要
  uiaContext?: string // 深度模式 UIAutomation 焦点元素摘要
  /** 主屏前台窗口矩形（桌宠窗口本地坐标；桌宠漫游避让用，60s 无更新自动失效） */
  winRect?: { x: number; y: number; width: number; height: number }
}

/** PAD 情感 */
export interface PADEmotion {
  pleasure: number // -1..1
  arousal: number // -1..1
  dominance: number // -1..1
}

/** 桌宠状态（WS 协议 / pet 窗口共享） */
export interface PetState {
  workState: WorkState
  emotion: PADEmotion
  energy: number // 0-1
  intimacy: number // 关系亲密度等级 1-5
  message: string | null // 气泡消息
  characterId: string // 当前角色
  visible: boolean
}

/** 对外广播的实时桌面状态 */
export interface DesktopState {
  ts: number
  presence: PresenceSnapshot
  pet: PetState
  todayMin: number
  planAchievement: number | null
}

/** WS 双向回写消息 */
export type WsInboundMessage =
  | { type: 'pet'; patch: Partial<PetState> }
  | { type: 'memo'; text: string }
  | { type: 'ping' }

// ───────────────────────── 注意力评分（v2.6） ─────────────────────────

/** 用户类型（六类分群；权重与默认目标见 shared/attention.ts USER_TYPE_META） */
export type UserType = 'office_worker' | 'exam_candidate' | 'freelancer' | 'student' | 'creator' | 'entrepreneur'

/** 评分等级（950/900/800/700/600/500 分档，见 v2.6 §2.3） */
export type ScoreGrade = 'S+' | 'S' | 'A' | 'B' | 'C' | 'D' | 'F'

/** 单日注意力评分（每日结算产物，数据结构照 v2.6 §5.1） */
export interface AttentionScore {
  date: string // YYYY-MM-DD
  userType: UserType
  /** 五维原始分数，各 0-100 */
  dimensions: { depth: number; sustain: number; resist: number; rhythm: number; recover: number }
  /** 五维原始信号（16 项，AI 洞察分析用） */
  rawSignals: {
    deepFocusTotalMin: number // 深度专注总时长（分钟）
    deepFocusMaxStreak: number // 最长连续深度时段（分钟）
    deepFocusCount: number // 深度时段次数
    effectiveWorkMin: number // 有效工作时长（分钟）
    targetWorkMin: number // 目标工作时长（分钟）
    distractionCount: number // 分心次数
    distractionAvgMin: number // 单次摸鱼平均时长（分钟）
    recoveryAvgMin: number // 分心后恢复时间（分钟）
    socialDistractionRatio: number // 社交媒体分心占比 0-1
    pomodoroCompleted: number // 番茄钟完成数
    pomodoroTarget: number // 目标番茄钟数
    rhythmStability: number // 周期稳定性 0-1
    restQuality: number // 休息合理性 0-1
    recoveryAfterBreak: number // 午休后提升 0-1
    fatigue3hDecay: number // 3h 衰减率 0-1
    weeklyVariance: number // 周波动 0-1
  }
  weightedScore: number // 加权后 0-100
  finalScore: number // 含附加分 0-1000
  grade: ScoreGrade
  /** 附加分明细 */
  bonus: {
    streakDays: number // 连续打卡天数
    streakBonus: number // 连续打卡加分
    planAchievement: number // 计划达成率 0-1
    planBonus: number // 计划达成加分
    milestoneBonus: number // 里程碑加分（预留，当前恒 0）
  }
  vsYesterday: number // 与昨日差值
  vsLastWeekAvg: number // 与上周均值差值
  ts: number
}

/** 成就徽章（定义见 shared/achievements.ts，解锁判定在 main 进程执行） */
export interface Achievement {
  id: string
  name: string
  description: string
  type: 'milestone' | 'type_specific' | 'rare_title'
  category: string // streak | score | dimension | challenge
  userType?: UserType // 类型专属成就才有
  rarity: 'common' | 'rare' | 'epic' | 'legendary'
  condition: {
    metric: string
    operator: '>=' | '<=' | '==' | 'streak'
    threshold: number
    duration?: number // 连续天数（operator 为 streak 时使用）
  }
  unlocked: boolean
  unlockedAt?: number
}

// ───────────────────────── 用户画像（v2.7，命名 UserPersona 避让上方 UserProfile） ─────────────────────────

/** 隐私等级（L4 核心隐私 AI 永久禁止访问，不建模开关） */
export type PrivacyLevel = 'L0' | 'L1' | 'L2' | 'L3' | 'L4'

/** 画像数据来源 */
export type DataSource = 'manual' | 'auto_app' | 'auto_search' | 'auto_task' | 'auto_rhythm' | 'auto_inference'

/** 带出处与置信度的画像字段（自动推断数据低置信度不参与 AI 决策） */
export interface ProfileField<T> {
  value: T
  source: DataSource
  confidence: number // 0-1
  lastUpdated: number
  userConfirmed: boolean // 用户是否确认过
}

/** 八层用户画像（见 v2.7 §1.2；单机版 id 固定 'me'） */
export interface UserPersona {
  id: string // 固定 'me'
  completeness: number // 0-100，计算口径见 shared/personaMeta.ts completenessOf
  lastUpdated: number
  /** L0 基础信息层：AI 可直接引用 */
  basicInfo: { nickname: string; userType: UserType; avatarId: string; timezone: string; language: string; registrationTs: number; daysActive: number }
  /** L1 身份画像层：AI 摘要引用 */
  identity: { occupation?: ProfileField<string>; industry?: ProfileField<string>; experienceLevel?: ProfileField<'junior' | 'mid' | 'senior' | 'expert'>; workMode?: ProfileField<'office' | 'remote' | 'hybrid'> }
  /** L1 偏好设定层：AI 摘要引用 */
  preferences: { workStyle?: ProfileField<'pomodoro' | 'flow' | 'flexible' | 'structured'>; communicationStyle?: ProfileField<'direct' | 'encouraging' | 'minimal'>; interventionTolerance?: ProfileField<'high' | 'medium' | 'low'>; preferredWorkHours?: { start: string; end: string } }
  /** L2 行为模式层：AI 聚合统计引用 */
  behavioral: {
    dailyRhythm: { peakHours: string[]; lowEnergyHours: string[]; averageStart: string; averageEnd: string; weekendPattern: 'work' | 'rest' | 'mixed' }
    appUsagePattern: { primaryApps: { category: string; avgDailyMin: number }[]; appSwitchFrequency: number; deepWorkAppCategories: string[]; distractionAppCategories: string[] }
    focusStreakHistory: { bestStreak: number; avgDailyFocusMin: number; focusTrend: 'improving' | 'stable' | 'declining' }
  }
  /** L2 兴趣爱好层：AI 聚合引用 */
  interests: {
    /** userConfirmed 的条目不参与自动删除（v2.7 §3.3 用户确认优先） */
    detectedInterests: { tag: string; confidence: number; source: DataSource; lastSeen: number; userConfirmed?: boolean }[]
    learningTopics: { topic: string; progress: 'exploring' | 'learning' | 'practicing' | 'mastered'; startedAt: number }[]
    hobbies: string[]
  }
  /** L2 能力技能层：AI 聚合引用 */
  capabilities: {
    /** userConfirmed 的条目不被自动采集覆盖名称/熟练度，只刷 lastUsed/trend */
    skillTags: { name: string; proficiency: number; category: 'language' | 'framework' | 'tool' | 'soft_skill'; lastUsed: number; trend: 'growing' | 'stable' | 'declining'; confidence: number; userConfirmed?: boolean }[]
    learningGoals: { goal: string; targetTs: number; currentProgress: number }[]
  }
  /** L3 心理画像层：AI 策略内化（不在回复中引用具体数值） */
  psychological: { stressTolerance: number; motivationType: 'intrinsic' | 'extrinsic' | 'mixed'; attentionStyle: 'sustained' | 'selective' | 'divided'; energyCycle: 'morning' | 'afternoon' | 'evening' | 'night'; burnoutRisk: number; resilienceScore: number; confidence: number; lastAnalyzed: number }
  /** L3 关系数据层：AI 策略内化（不在回复中引用具体数值） */
  relationship: { intimacyLevel: number; intimacyScore: number; daysTogether: number; totalInteractions: number; interactionPattern: { avgDailyInteractions: number; responseRate: number; dismissRate: number }; emotionalHistory: { dominantEmotions: string[]; emotionStability: number; recentTrend: 'positive' | 'neutral' | 'negative' } }
  /** 逐层 AI 访问开关（L4 永远 false，不建模） */
  privacySettings: { aiAccess: { L0: boolean; L1: boolean; L2: boolean; L3: boolean } }
  ts: number
}

/** AI 访问日志（脱敏网关记录，保留 30 天，用户可追溯） */
export interface AccessLog { id: string; ts: number; requester: string; layer: PrivacyLevel; fields: string[]; desensitized: boolean; ruleApplied: string; output: string }

/** QA 回复中的画像引用标记 */
export interface ProfileReference { layer: PrivacyLevel; field: string; logId: string; summary: string }

// ───────────────────────── 设置 ─────────────────────────

export interface AppSettings {
  theme: 'cyan' | 'violet' | 'green' | 'amber' // 强调色主题，默认 cyan
  appearanceMode: 'light' | 'dark' | 'auto' // 亮暗模式，默认 dark
  monitorInterval: number // 采样间隔 ms，默认 5000
  monitorSmart: boolean // 智能轮询：专注≥80→10s，摸鱼→3s，默认 false
  deepMode: boolean // 深度 OCR，默认 false
  activityRetentionDays: number // 活动记录留存天数，默认 60
  aiAutoRefreshMin: number // AI 画像自动刷新间隔分钟，0=关闭，默认 30
  devMode: boolean // 开发者调试模式（资源占用面板等），默认 false
  calAnalysisBands: boolean // 日历日视图叠加用户分析背景带（午休/高效时段），默认 false
  reportExcludeSlack: boolean // 报表默认排除摸鱼数据，默认 false
  reportTemplate: string // 日报导出模板（{{date}} {{totalMin}} {{workMin}} {{slackMin}} {{topApps}} {{bestHours}} 变量），空=默认格式
  planForecastEnabled: boolean // 时间轴/日历上的计划完成预测三色标注，默认开
  aiEnabled: boolean
  aiApiKey: string
  aiBaseUrl: string // OpenAI 兼容接口
  aiModel: string
  aiModelFast: string // 快速模型（桌宠短回复、连接测试），空=使用 aiModel
  aiModelComplex: string // 复杂模型（分析、报表、深度问答），空=使用 aiModel
  aiAutoRefresh: boolean // 固定刷新当日画像省 token
  aiStreaming: boolean // 启用流式输出（打字机效果），默认 true
  onerEndpoint: string
  onerToken: string
  onerAutoSyncMin: number // 0=关闭
  wsEnabled: boolean
  wsPort: number // 默认 18765
  stateSnapshot: boolean // 写 state.json 快照
  meetingMode: 'stealth' | 'quiet' | 'assist' | 'ask' // 会议检测默认行为，默认 ask（每次询问）
  petEnabled: boolean
  petCharacter: string // 默认 'ling'
  petClickThrough: boolean
  petScale: number // 桌宠缩放 0.5-1.5，默认 1
  petRoam: boolean // 允许自由游荡，默认关（常驻右下角）
  suppressTransitionOnPageSwitch: boolean // 页面切换期间抑制桌宠状态切换，默认开
  petFpsTier: 'eco' | 'standard' | 'smooth' | 'ultra' // 桌宠帧率档位，默认 smooth
  petGuideShown: boolean // 养成引导是否已展示过
  introPlayed: boolean // 首次启动 CG 是否已播放过
  petRememberPos: boolean // 记住拖拽位置（重启后恢复），默认开
  petReturnMin: number // 闲置自动归位分钟数，默认 30
  petPosX: number // 上次拖拽放置位置 X（petRememberPos 用）
  petPosY: number // 上次拖拽放置位置 Y
  /** 桌搭互动开关（关闭即注销对应行为，降低开销） */
  petInteractions: {
    click: boolean // 点击互动
    drag: boolean // 拖拽移动
    dragPhysics: boolean // 拖拽物理（摆动/抛物线），默认关：仅跟手位移
    follow: boolean // 页面跟随（主窗口翻页时联动）
    costume: boolean // 换装响应（预留，单角色版本暂不可用）
    emotion: boolean // 表情反馈，默认关（角色偏小表情不可见，保留接口）
    chat: boolean // 右键对话
  }
  ocrCleanupDays: number // 截屏缓存自动清理周期（天），0=永不
  ocrAutoCompress: boolean // 截屏自动压缩（节省约 50% 存储）
  ocrCacheLimit: number // 截屏缓存上限（张），默认 200
  privacyExcludedApps: string[] // 隐私快标：不截屏/不OCR/不记标题的应用
  workChains: string[][] // 已确认的作业链路（应用切换序列，如 ["WeChat","Excel","Browser"]）
  widgetVisible: boolean
  widgetOpacity: number // 0.2-1
  launchAtLogin: boolean
  slackHideSec: number // 持续摸鱼自动隐身阈值，默认 180
  slackAutoHide: boolean // 启用摸鱼自动隐身，默认开
  cmdPaletteEnabled: boolean // Ctrl+K 命令面板，默认开
  // ── v2.6 注意力评分 ──
  userType?: UserType // 用户类型；未设置时自动识别
  userTypeAuto: boolean // 自动识别用户类型，默认开
  targetWorkMin?: number // 覆盖类型默认目标工作时长（分钟）
  targetPomodoros?: number // 覆盖类型默认目标番茄钟数
  scorePetAdapt: boolean // 评分驱动桌宠策略，默认开
  // ── v2.8 智能报表 ──
  smartReportAI: boolean // 智能日报 AI 增强开关，默认 true
  // ── v3.0 硬件自适应 ──
  hardwareTier?: 'L0' | 'L1' | 'L2' // 硬件等级（自动检测，可手动覆盖）
  petVrmPath?: string // 自定义 VRM 角色文件路径（L1 上传入口）
  ocrEngine?: 'tesseract' | 'rapidocr' // OCR 引擎选择，默认 rapidocr
  folders?: string[] // v3.0 文件夹 ingestion：用户配置的工作目录
  mutualExclusive?: boolean // v3.1 互斥模式：桌面形象与浮窗互相排斥
  city?: string // v3.1 用户城市（天气/通勤提醒用）
  
  petVrmUploadEnabled?: boolean // v3.0 VRM 照片生成：入口占位开关，默认 true
}

export const DEFAULT_SETTINGS: AppSettings = {
  monitorInterval: 5000,
  monitorSmart: false,
  deepMode: false,
  activityRetentionDays: 60,
  aiAutoRefreshMin: 30,
  devMode: false,
  calAnalysisBands: false,
  reportExcludeSlack: false,
  reportTemplate: '',
  planForecastEnabled: true,
  theme: 'cyan',
  appearanceMode: 'light',
  aiEnabled: false,
  aiApiKey: '',
  aiBaseUrl: 'https://api.openai.com/v1',
  aiModel: 'gpt-4o-mini',
  aiModelFast: '', // 空=回退到 aiModel
  aiModelComplex: '', // 空=回退到 aiModel
  aiAutoRefresh: true,
  aiStreaming: true, // 默认开启流式输出
  onerEndpoint: '',
  onerToken: '',
  onerAutoSyncMin: 0,
  wsEnabled: true,
  wsPort: 18765,
  stateSnapshot: true,
  meetingMode: 'ask',
  petEnabled: true,
  petCharacter: 'ling',
  petClickThrough: true,
  petScale: 1,
  petRoam: false,
  suppressTransitionOnPageSwitch: true,
  petFpsTier: 'smooth',
  petGuideShown: false,
  introPlayed: false,
  petRememberPos: true,
  petReturnMin: 30,
  petPosX: -1,
  petPosY: -1,
  petInteractions: { click: true, drag: true, dragPhysics: false, follow: false, costume: false, emotion: false, chat: true },
  ocrCleanupDays: 14,
  ocrAutoCompress: false,
  ocrCacheLimit: 200,
  privacyExcludedApps: [],
  workChains: [],
  widgetVisible: false, // 悬浮卡片默认隐藏（设置里可手动开启），状态由桌宠对话泡泡提供
  widgetOpacity: 0.92,
  launchAtLogin: false,
  slackHideSec: 180,
  slackAutoHide: true,
  cmdPaletteEnabled: true,
  // v2.6：userType/targetWorkMin/targetPomodoros 留空 = 自动识别 / 用类型默认值
  userTypeAuto: true,
  scorePetAdapt: true,
  smartReportAI: true,
  ocrEngine: 'rapidocr'
}

// ───────────────────────── 轻问诊 ─────────────────────────

export interface SuggestionQuestion {
  id: string
  ctx: string
  question: string
  ts: number
}

// ───────────────────────── ID 工具 ─────────────────────────

let idSeq = 0
export function genId(prefix = 'id'): string {
  idSeq = (idSeq + 1) % 10000
  return `${prefix}_${Date.now().toString(36)}_${idSeq.toString(36)}${Math.random().toString(36).slice(2, 6)}`
}

// ───────────────────────── 智能报表（v2.8/v2.9） ─────────────────────────

export type SubjectType = 'person' | 'client' | 'team' | 'vendor' | 'internal' | 'unknown'
export type LocationType = 'server' | 'cloud' | 'repository' | 'system' | 'local' | 'unknown'
export type OutputType = 'document' | 'code' | 'config' | 'deploy' | 'design' | 'communication' | 'data' | 'other'
export type EnrichLevel = 'raw' | 'basic' | 'enriched' | 'verified'
export type ReportTimeSlot = 'morning' | 'afternoon' | 'evening' | 'night'

/** 五维富化结果（规则引擎/LLM/用户确认的并集，v2.9 模块 B） */
export interface EnrichmentResult {
  subject?: { name: string; type: SubjectType; confidence: number }
  contentTag?: { category: string; confidence: number }
  project?: { name: string; confidence: number }
  location?: { target: string; type: LocationType; confidence: number }
  output?: { type: OutputType; name: string; confidence: number }
}

/** 报表结构化条目（聚合后的最小汇报单元，v2.8 §2.2） */
export interface ReportEntry {
  id: string
  date: string // YYYY-MM-DD
  startTs: number
  endTs: number
  durationMin: number
  timeSlot: ReportTimeSlot
  state: WorkState
  stateLabel: string // "会议沟通" / "文档撰写" / "AI开发" / "远程部署"
  app?: string
  // 五维信息（从 segment 聚合）
  subject?: string // "客户甲"
  subjectType?: SubjectType
  contentTag?: string // "方案讨论"
  contentSummary?: string // "讨论Q3营销方案第二版修改意见"
  project?: string // "Q3营销方案"
  location?: string // "腾讯会议"
  output?: string // "方案v2修改稿"
  outputType?: OutputType
  // 来源与置信度
  dataSource: ('auto' | 'manual' | 'ai_inferred' | 'calendar' | 'meeting' | 'ocr')[]
  confidence: number // 整体置信度 0-1
  needsReview: boolean // confidence < 0.6
  planItemId?: string // 关联的计划项
  ts: number
}

/** 模板段落类型（v2.8 §2.3） */
export type SectionType = 'time_block' | 'category_group' | 'project_summary' | 'achievement' | 'plan_tomorrow' | 'metric_summary' | 'free_text' | 'meeting_log' | 'issue_note'

/** 条目筛选条件（如只显示 meeting 状态、过滤碎片） */
export interface EntryFilter {
  states?: WorkState[]
  timeSlot?: ReportTimeSlot[]
  subjectType?: SubjectType[]
  outputType?: OutputType[]
  minDuration?: number // 最短时长（分钟）
}

/** 模板字段定义 */
export interface TemplateField {
  key: string // "subject" | "contentTag" | "project" | ...
  label: string // "沟通对象" / "工作内容" / "项目名称"
  required: boolean
  format?: string // 显示格式模板 "{subject} - {contentSummary}"
  maxLength?: number
  fallback?: string // 数据缺失时的默认文案 "（未记录）"
}

/** 模板段落 */
export interface TemplateSection {
  id: string
  title: string // "上午工作" / "会议记录" / "项目进展"
  type: SectionType
  timeRange?: { start: string; end: string } // "09:00" - "12:00"
  groupBy?: 'time' | 'project' | 'subject' | 'state' | 'location'
  sortBy?: 'chronological' | 'duration' | 'priority'
  fields: TemplateField[] // 这个段落需要哪些字段
  repeatable: boolean // 是否多条目（如"多个会议"）
  filter?: EntryFilter
}

/** 报表模板（用户导入 / 公司模板 / 预置 / AI 生成） */
export interface ReportTemplate {
  id: string
  name: string // "我的日报格式" / "公司周报模板"
  type: 'daily' | 'weekly' | 'monthly' | 'custom'
  source: 'user_paste' | 'company_import' | 'preset' | 'ai_generated'
  rawContent?: string // 用户粘贴的原始文本（首次导入时保存）
  sections: TemplateSection[]
  // 学习数据
  usageCount: number
  lastUsed?: number
  userCorrections: number // 用户修正次数（越少说明匹配越好）
  isDefault: boolean
  ts: number
}

/** 计划达成（v2.9 模块 C） */
export interface PlanAchievement {
  planId: string
  title: string
  plannedMin: number // 计划时长
  actualMin: number // 实际关联时长
  achievementRate: number // 达成率
  status: 'completed' | 'partial' | 'missed' | 'overtime'
  relatedSegmentIds: string[] // 关联的 segment ID
}

/** 模式检测（v2.9 模块 E，纯算法） */
export interface WorkPattern {
  peakHours: { slot: string; avgFocusScore: number; primaryState: WorkState; confidence: number }[] // 峰时段
  dipHours: { slot: string; avgFocusScore: number; primaryReason: 'slack' | 'meeting' | 'fragmented'; confidence: number }[] // 谷时段
  workStartAvg: number // 平均开始工作时间（当日分钟）
  workEndAvg: number
  workStartConsistency: number // 0-1，开始时间一致性
  workEndConsistency: number
  fragmentationScore: number // 0-100，越高越碎片化
  contextSwitches: number // 日均上下文切换次数
  avgSegmentLength: number // 平均段时长（分钟）
  bestWeekday: number // 效率最高的星期几（0-6）
  worstWeekday: number
  weekdayConsistency: number // 周间一致性
  patternTags: string[] // 模式标签 ["晨型人", "碎片化严重", "下午低谷"]
}

/** OCR 结构化快照（不存原文，隐私，v2.9 模块 D） */
export interface OcrSnapshot {
  id: string
  ts: number
  app: string
  state: WorkState
  documentNames: string[] // 提取的文档名
  personNames: string[] // 人名/客户名
  keywords: string[] // 关键业务词
  urls: string[]
  codeSnippets: string[] // 代码片段标识
}

/** 时间统计（v2.9 模块 A，纯本地计算） */
export interface ReportStats {
  totalWorkMin: number
  totalSlackMin: number
  workSlackRatio: number
  stateBreakdown: { state: WorkState; label: string; minutes: number; percentage: number; color: string }[]
  appRanking: { app: string; minutes: number; percentage: number; primaryState: WorkState }[]
  slotBreakdown: { slot: ReportTimeSlot; label: string; workMin: number; slackMin: number; focusScore: number }[]
  focusScore: number // 0-100
  focusTrend: number[] // 每小时专注分趋势
  vsYesterday?: { workMinDelta: number; focusDelta: number; slackDelta: number }
  vsLastWeekSameDay?: { workMinDelta: number; focusDelta: number }
}

/** 生成结果（v2.8 §4.3 填充引擎输出） */
export interface GeneratedEntry {
  reportEntry: ReportEntry
  fieldValues: Record<string, { value: string; confidence: number; source: string }>
  needsReview: boolean
}

export interface GeneratedSection {
  sectionId: string
  title: string
  entries: GeneratedEntry[]
  unfilledFields: string[] // 没有数据填充的字段
}

export interface GeneratedReport {
  templateId: string
  date: string
  sections: GeneratedSection[]
  entries: ReportEntry[] // 当日全部结构化条目
  stats: ReportStats
  achievements: PlanAchievement[]
  patterns: WorkPattern | null
  aiStatus: 'enhanced' | 'fallback_to_base' | 'disabled' // AI 增强状态（v2.9 分层）
  coverage: number // 数据覆盖率 0-1
  pendingReview: ReportEntry[] // 低置信度待确认条目
}

/** 智能周报单日切片（v2.10）：单日管线结果的子集 */
export interface WeeklyDayReport {
  date: string
  entries: ReportEntry[]
  stats: ReportStats
  achievements: PlanAchievement[]
}

/** 周级聚合统计（7 天求和/均值） */
export interface WeeklyStats {
  totalWorkMin: number
  totalSlackMin: number
  workSlackRatio: number // 口径同 ReportStats（无摸鱼且有为 999）
  daysWithData: number // 有条目的天数
  avgFocusScore: number // 有数据天的专注分均值（无数据为 0）
}

/** 智能周报生成结果（v2.10：startDate 起 7 天单日管线聚合） */
export interface WeeklyGeneratedReport {
  startDate: string // 含
  endDate: string // 含
  templateId: string
  days: WeeklyDayReport[]
  weekStats: WeeklyStats
  achievements: PlanAchievement[] // 跨天合并（按 planId 去重，actualMin 累加重算）
  patterns: WorkPattern | null // 以 endDate 为基准的近 14 天模式
  aiStatus: 'enhanced' | 'fallback_to_base' | 'disabled'
  coverage: number // 全部条目字段覆盖率 0-1
  pendingReview: ReportEntry[] // 低置信度待确认条目（7 天合并）
}
