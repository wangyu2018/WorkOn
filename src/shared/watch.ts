/**
 * 盯守（watch）：把「持续盯着若干信息源」拆成多个独立盯点。
 *
 * 与定时任务的区别：
 * - 没有统一执行时刻；每个盯点有自己的到期时间、周期与已读游标，谁到点谁处理
 * - 控制面一次只处理一个盯点，增量比对 URL；没有新内容就不产出
 * - 首次检查只建立基线，避免把历史链接当成新发现刷屏
 */

export interface WatchPointSpec {
  url: string
  label?: string
}

/** 数据来源：普通网页链接 / 浏览器页面（需登录态的站点，如抖音） */
export type WatchSourceKind = 'web-links' | 'browser-page'

/** 处理完的落点：知识库 / 偏好画像 / 今日计划 / 项目 / 工作流 */
export interface WatchSinks {
  knowledge: boolean
  persona: boolean
  plan: boolean
  projectId?: string
  workflowId?: string
}

export function defaultWatchSinks(patch?: Partial<WatchSinks>): WatchSinks {
  return {
    knowledge: patch?.knowledge ?? false,
    persona: patch?.persona ?? false,
    plan: patch?.plan ?? false,
    projectId: patch?.projectId,
    workflowId: patch?.workflowId
  }
}

export type WatchTaskStatus = 'active' | 'paused'

export interface WatchPointState {
  id: string
  url: string
  label: string
  /** 该盯点独立的巡检周期（分钟） */
  intervalMin: number
  nextDueAt: number
  lastCheckedAt?: number
  lastChangedAt?: number
  lastError?: string
  /** 连续失败次数，用于退避 */
  failures: number
  /** 累计已读链接数（不含基线前的历史） */
  seenCount: number
  baselineAt?: number
}

export interface WatchFinding {
  id: string
  taskId: string
  pointId: string
  pointLabel: string
  url: string
  title: string
  /** 从标题里抽出的关键词（写知识库 / 画像用） */
  tags?: string[]
  /** 首次读档回填的既有内容 */
  initial?: boolean
  ts: number
}

export interface WatchTask {
  id: string
  title: string
  intent: string
  status: WatchTaskStatus
  sourceKind: WatchSourceKind
  /** 来源说明，如「抖音 · 喜欢列表」 */
  sourceLabel?: string
  sinks: WatchSinks
  points: WatchPointState[]
  createdAt: number
  updatedAt: number
  findingsCount: number
  latest?: WatchFinding
}

export interface WatchSnapshot {
  tasks: WatchTask[]
  recent: WatchFinding[]
}

/** UI 快捷周期（分钟） */
export const WATCH_INTERVAL_OPTIONS = [30, 60, 180] as const

/** 单任务最多盯点；防止一句话拆出几十个源把本机拖住 */
export const WATCH_MAX_POINTS = 8

/** 发现记录保留条数 */
export const WATCH_RETAIN_FINDINGS = 300

/** 每个盯点保留的已读 URL 哈希数（超过后丢弃最旧的） */
export const WATCH_RETAIN_SEEN = 300

export function watchStatusLabel(s: WatchTaskStatus): string {
  return s === 'active' ? '盯守中' : '已暂停'
}
