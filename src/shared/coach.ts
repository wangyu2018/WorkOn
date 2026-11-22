/**
 * 工作闭环助手共享类型：监控 → 提示 → 行动 → 结果验证
 * - 主进程按 presence / 计划 / 项目评估，渲染层只展示与回传动作
 * - status 记录闭环：shown → accepted → followed / missed，或 dismissed / expired
 */

export type CoachKind =
  | 'plan_due' // 计划到点没开始
  | 'slack_return' // 连续摸鱼，拉回工作
  | 'project_resume' // 项目有待办但今天没推进
  | 'overwork' // 连续专注过久，提醒休息
  | 'wrap_up' // 晚间收尾，生成回顾
  | 'check_in' // 手动评估 / 兜底建议

export type CoachActionKey =
  | 'start' // 开始做（计划置为进行中，并验证 10 分钟内是否真的进入工作）
  | 'snooze' // 稍后
  | 'dismiss' // 忽略
  | 'open_plan'
  | 'open_project'
  | 'open_report'
  | 'ask_ai' // 交给对话框（预填提示词）
  | 'expire' // 前端展示到期（内部用）

export interface CoachAction {
  key: CoachActionKey
  label: string
  primary?: boolean
}

export type CoachStatus = 'shown' | 'accepted' | 'followed' | 'missed' | 'dismissed' | 'expired'

export interface CoachCard {
  id: string
  kind: CoachKind
  title: string
  body: string
  /** 为什么现在提示：把监控依据给用户看 */
  reason: string
  ts: number
  ttlSec: number
  actions: CoachAction[]
  planId?: string
  projectId?: string
  /** ask_ai 时预填给对话框的提示词 */
  prompt?: string
  status: CoachStatus
  actionKey?: CoachActionKey
  /** 采纳「开始」后的验证截止时间 */
  verifyUntil?: number
  followedAt?: number
  closedAt?: number
}

export interface CoachStats {
  shown: number
  accepted: number
  followed: number
  /** 已采纳里最终真正进入工作的比例（0-1） */
  followRate: number
}

export interface CoachState {
  items: CoachCard[]
  stats: CoachStats
  /** 全局静默截止时间（毫秒时间戳） */
  snoozeUntil: number
}
