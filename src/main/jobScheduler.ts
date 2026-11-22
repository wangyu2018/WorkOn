/**
 * 事务调度器（本地控制面，低资源）
 *
 * - 15 秒一次 tick：到点建作业、派发、唤醒 wait、看护云端租约
 * - 本地作业交给 jobExecutor；云作业交给 nodes.ts 出站连接
 * - 不跑模型循环、不做重活；只维护状态与触发
 */
import type { CommitmentRecord, JobRecord, JobSnapshot } from '@shared/job'
import { DEFAULT_JOB_POLICY, nextRunAfter } from '@shared/job'
import {
  createJob,
  getCommitment,
  getJob,
  listCommitments,
  listJobs,
  patchCommitment,
  updateJob
} from './jobStore'
import { cancelJobLocally, executeJobLocally, approveJobLocally } from './jobExecutor'
import { cancelJobOnNode, listNodes, offerJobToNode } from './nodes'
import { installJobBridge } from './jobBridge'
import { sendTo } from './windows'

const TICK_MS = 15_000
const LEASE_GRACE_MS = 120_000
let timer: NodeJS.Timeout | null = null
let ticking = false

const ACTIVE: JobRecord['state'][] = ['queued', 'leased', 'running', 'waiting', 'needs_human']

function hasActiveJob(commitmentId: string): boolean {
  return listJobs(100).some((j) => j.commitmentId === commitmentId && ACTIVE.includes(j.state))
}

function notifyChanged(jobId?: string): void {
  sendTo('main', 'job:changed', jobId ? { jobId } : {})
}

function dispatch(job: JobRecord): void {
  const target = job.target
  if (target.kind === 'local') {
    void executeJobLocally(job.id)
    return
  }
  const node = listNodes().find((n) => n.id === target.nodeId)
  if (!node || !node.online) {
    updateJob(job.id, { lastError: `云节点离线：${target.label}`, wakeAt: Date.now() + 30_000 })
    return
  }
  if (node.authLevel !== 'exec') {
    updateJob(job.id, { lastError: `云节点未授予执行权限：${target.label}`, wakeAt: Date.now() + 30_000 })
    return
  }
  if (offerJobToNode(target.nodeId, job)) {
    updateJob(job.id, {
      state: 'leased',
      leaseOwner: target.nodeId,
      leaseExpiresAt: Date.now() + 5 * 60 * 1000,
      lastError: undefined
    })
    notifyChanged(job.id)
  } else {
    updateJob(job.id, { lastError: '派发失败：节点连接不可用', wakeAt: Date.now() + 30_000 })
  }
}

function tick(): void {
  if (ticking) return
  ticking = true
  try {
    const now = Date.now()
    // 1) 到点的事务 → 建作业
    for (const cmt of listCommitments()) {
      if (cmt.status !== 'active' || cmt.trigger.kind === 'manual') continue
      const due = cmt.nextRunAt ?? cmt.createdAt
      if (due > now) continue
      if (hasActiveJob(cmt.id)) continue
      const job = createJob(cmt)
      // 立即排下一次（daily 顺延到明天/interval 顺延一个周期）；运行中的作业由 hasActiveJob 挡重复
      patchCommitment(cmt.id, { nextRunAt: nextRunAfter(cmt.trigger, now) })
      notifyChanged(job.id)
    }

    // 2) 队列 / 唤醒 / 重试
    for (const job of listJobs(100)) {
      if (job.state === 'waiting') {
        if ((job.wakeAt ?? 0) <= now) updateJob(job.id, { state: 'queued', wakeAt: undefined })
        else continue
      }
      const fresh = getJob(job.id)
      if (!fresh || fresh.state !== 'queued') continue
      if ((fresh.wakeAt ?? 0) > now) continue
      dispatch(fresh)
    }

    // 3) 云端租约看护：长时间没有事件 → 失败，交回用户
    for (const job of listJobs(100)) {
      if (job.target.kind !== 'node') continue
      if (job.state !== 'leased' && job.state !== 'running' && job.state !== 'waiting') continue
      // 长时间 wait 是正常状态：唤醒时间在未来就不算失联
      if (job.state === 'waiting' && (job.wakeAt ?? 0) > now) continue
      // 任何云端事件都会刷新 updatedAt，以最近活动判断失联，避免长任务被误判
      const last = Math.max(job.leaseExpiresAt ?? 0, job.updatedAt)
      if (now - last > job.policy.timeoutMs + LEASE_GRACE_MS) {
        updateJob(job.id, {
          state: 'failed',
          endedAt: now,
          lastError: `云作业服务器失联（${job.target.label}）`
        })
        notifyChanged(job.id)
      }
    }
  } catch (e) {
    console.warn('[jobs] 调度 tick 失败', (e as Error).message)
  } finally {
    ticking = false
  }
}

export function startJobScheduler(): void {
  installJobBridge()
  if (timer) return
  timer = setInterval(tick, TICK_MS)
  // 启动后先跑一次，接管上次未完成的作业
  setTimeout(tick, 1500)
  console.log('[jobs] 事务调度器已启动（15s tick）')
}

export function stopJobScheduler(): void {
  if (timer) clearInterval(timer)
  timer = null
}

export function getJobSnapshot(): JobSnapshot {
  return {
    commitments: listCommitments(),
    jobs: listJobs(50),
    nodes: listNodes().map((n) => ({ id: n.id, label: n.label, online: n.online, authLevel: n.authLevel }))
  }
}

/** 手动运行一次事务；confirmed=true 表示用户已确认执行命令 */
export function runCommitmentNow(commitmentId: string, confirmed = false): JobRecord | null {
  const cmt = getCommitment(commitmentId)
  if (!cmt) return null
  const existing = listJobs(100).find((j) => j.commitmentId === cmt.id && ACTIVE.includes(j.state))
  const job = existing ?? createJob(cmt)
  if (cmt.target.kind === 'local' && confirmed) {
    void executeJobLocally(job.id, { confirmed: true })
  } else {
    dispatch(job)
  }
  notifyChanged(job.id)
  return job
}

export function cancelJob(jobId: string): boolean {
  const job = getJob(jobId)
  if (!job) return false
  if (job.target.kind === 'node' && job.leaseOwner) {
    cancelJobOnNode(job.target.nodeId, jobId)
    updateJob(jobId, { state: 'canceled', endedAt: Date.now(), wakeAt: undefined })
  } else {
    cancelJobLocally(jobId)
  }
  notifyChanged(jobId)
  return true
}

export async function approveJob(jobId: string): Promise<boolean> {
  const job = getJob(jobId)
  if (!job) return false
  if (job.target.kind === 'local') {
    await approveJobLocally(jobId)
  } else {
    updateJob(jobId, { state: 'queued', lastError: undefined })
    dispatch(getJob(jobId) as JobRecord)
  }
  notifyChanged(jobId)
  return true
}

/** 默认策略给新建事务兜底 */
export function policyOrDefault(p?: Partial<JobRecord['policy']>): JobRecord['policy'] {
  return { ...DEFAULT_JOB_POLICY, ...(p ?? {}) }
}

export type { CommitmentRecord }
