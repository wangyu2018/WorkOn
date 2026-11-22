/**
 * 个人 Agent 的「事务 + 长任务」协议（shared）
 *
 * 设计口径：
 * - Commitment（事务）：用户交给 AI 长期管理的一件事，含触发方式、预算、目标与步骤模板。
 * - Job（作业）：事务的一次运行；可派发到本机或云作业服务器。
 * - Step（步骤）：最小可恢复单元；每步结果落事件日志，恢复时从最后完成步骤继续。
 * - JobEvent：append-only 事件；主端与云作业服务器各自保存，断线后按快照/事件补回。
 */

export type CommitmentStatus = 'active' | 'paused' | 'done' | 'canceled'

export type JobState =
  | 'queued'
  | 'leased'
  | 'running'
  | 'waiting'
  | 'needs_human'
  | 'succeeded'
  | 'failed'
  | 'canceled'

export type JobStepKind = 'agent' | 'model' | 'shell' | 'http' | 'wait' | 'notify'

export type JobTarget =
  | { kind: 'local' }
  | { kind: 'node'; nodeId: string; label: string }

export type JobTrigger =
  | { kind: 'manual' }
  | { kind: 'interval'; everyMs: number }
  | { kind: 'daily'; atHHMM: string }

export type JobApproval = 'auto' | 'confirm-write' | 'confirm-all'

export interface JobPolicy {
  maxAttempts: number
  timeoutMs: number
  /** 单次作业 token 预算；0 = 不限制 */
  budgetTokens: number
  approval: JobApproval
}

export interface JobStepBase {
  id: string
  kind: JobStepKind
  title: string
  dependsOn?: string[]
}

export interface JobAgentStep extends JobStepBase {
  kind: 'agent'
  goal: string
  system?: string
  /** 允许的工具名；缺省 shell / fs.read / fs.write / http.fetch / finish */
  tools?: string[]
  maxTurns?: number
  cwd?: string
}

export interface JobModelStep extends JobStepBase {
  kind: 'model'
  prompt: string
  system?: string
}

export interface JobShellStep extends JobStepBase {
  kind: 'shell'
  command: string
  cwd?: string
  timeoutMs?: number
}

export interface JobHttpStep extends JobStepBase {
  kind: 'http'
  url: string
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE'
  headers?: Record<string, string>
  body?: string
}

export interface JobWaitStep extends JobStepBase {
  kind: 'wait'
  /** 绝对时间；与 delayMs 二选一 */
  until?: number
  delayMs?: number
}

export interface JobNotifyStep extends JobStepBase {
  kind: 'notify'
  text: string
}

export type JobStep =
  | JobAgentStep
  | JobModelStep
  | JobShellStep
  | JobHttpStep
  | JobWaitStep
  | JobNotifyStep

export interface JobPlan {
  steps: JobStep[]
}

export interface StepState {
  status: 'pending' | 'running' | 'succeeded' | 'failed' | 'skipped'
  output?: string
  error?: string
  startedAt?: number
  endedAt?: number
  /** wait 步骤的唤醒时间；重启后按这个时间续等，不重新计时 */
  wakeAt?: number
  /** agent 步骤的多轮上下文；仅云端持久化使用 */
  messages?: Array<{ role: string; content: string; toolCallId?: string }>
  turns?: number
  tokens?: number
}

export interface JobRecord {
  id: string
  commitmentId?: string
  title: string
  goal: string
  state: JobState
  target: JobTarget
  plan: JobPlan
  policy: JobPolicy
  attempts: number
  createdAt: number
  updatedAt: number
  startedAt?: number
  endedAt?: number
  /** 云端作业服务器持有的租约标识 */
  leaseOwner?: string
  leaseExpiresAt?: number
  /** wait 步骤的唤醒时间 */
  wakeAt?: number
  lastError?: string
  result?: string
  stepStates: Record<string, StepState>
  /** 云端已上报的最后事件序号 */
  serverSeq?: number
}

export interface CommitmentRecord {
  id: string
  title: string
  /** 用户原话/意图，保留用于重规划与审计 */
  intent: string
  plan: JobPlan
  trigger: JobTrigger
  policy: JobPolicy
  status: CommitmentStatus
  target: JobTarget
  createdAt: number
  updatedAt: number
  nextRunAt?: number
  lastRunAt?: number
  lastJobId?: string
  /** 跨会话摘要/承诺；云端执行时作为上下文注入 */
  memory?: string
}

export interface JobEvent {
  seq: number
  jobId: string
  ts: number
  type: 'state' | 'step' | 'log' | 'notify' | 'done' | 'error'
  data?: Record<string, unknown>
}

export interface JobSnapshot {
  commitments: CommitmentRecord[]
  jobs: JobRecord[]
  nodes: Array<{ id: string; label: string; online: boolean; authLevel: string }>
}

/** 给 UI 的展示标签 */
export const JOB_STATE_LABEL: Record<JobState, string> = {
  queued: '排队',
  leased: '已派发',
  running: '执行中',
  waiting: '等待',
  needs_human: '待确认',
  succeeded: '完成',
  failed: '失败',
  canceled: '已取消'
}

export const JOB_STEP_LABEL: Record<JobStepKind, string> = {
  agent: 'Agent',
  model: '模型',
  shell: '命令',
  http: '请求',
  wait: '等待',
  notify: '通知'
}

/** 默认策略：低资源、可恢复、写操作需确认 */
export const DEFAULT_JOB_POLICY: JobPolicy = {
  maxAttempts: 3,
  timeoutMs: 10 * 60 * 1000,
  budgetTokens: 20_000,
  approval: 'confirm-write'
}

/** 触发方式的可读文案 */
export function triggerLabel(t: JobTrigger): string {
  if (t.kind === 'manual') return '手动'
  if (t.kind === 'interval') {
    const min = Math.max(1, Math.round(t.everyMs / 60_000))
    return min < 60 ? `每 ${min} 分钟` : `每 ${Math.round(min / 60)} 小时`
  }
  return `每天 ${t.atHHMM}`
}

/** 本次运行结束后的下次运行时间 */
export function nextRunAfter(t: JobTrigger, now = Date.now()): number | undefined {
  if (t.kind === 'interval') return now + Math.max(30_000, t.everyMs)
  if (t.kind === 'daily') {
    const [h, m] = t.atHHMM.split(':').map((x) => Number(x))
    const d = new Date(now)
    d.setHours(Number.isFinite(h) ? h : 9, Number.isFinite(m) ? m : 0, 0, 0)
    if (d.getTime() <= now) d.setDate(d.getDate() + 1)
    return d.getTime()
  }
  return undefined
}
