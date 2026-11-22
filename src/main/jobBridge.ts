/**
 * 云作业服务器 → 本地状态回流
 *
 * 云端持有自己的事件日志，断线期间继续执行；重连后发 job.snapshot / job.event。
 * 本地只做投影：更新 Job 状态、步骤状态、承诺的下次时间，并通知渲染端刷新。
 */
import { nextRunAfter } from '@shared/job'
import { setNodeJobSink } from './nodes'
import {
  appendJobEvent,
  getCommitment,
  getJob,
  patchCommitment,
  updateJob,
  updateStepState
} from './jobStore'
import { sendTo } from './windows'

function changed(jobId: string): void {
  sendTo('main', 'job:changed', { jobId })
}

function completeCommitment(commitmentId: string | undefined, ok: boolean, result: string): void {
  if (!commitmentId) return
  const cmt = getCommitment(commitmentId)
  if (!cmt) return
  const now = Date.now()
  patchCommitment(cmt.id, {
    lastRunAt: now,
    nextRunAt: nextRunAfter(cmt.trigger, now),
    memory: ok ? result.slice(0, 2000) : cmt.memory
  })
}

function applyEvent(jobId: string, seq: number | undefined, event: Record<string, unknown>): void {
  const type = String(event.type ?? 'log') as 'state' | 'step' | 'log' | 'notify' | 'done' | 'error'
  const data = (event.data ?? {}) as Record<string, unknown>
  const ts = Number(event.ts) || Date.now()
  const job = getJob(jobId)
  if (!job) return
  if (typeof seq === 'number') job.serverSeq = Math.max(job.serverSeq ?? 0, seq)

  if (type === 'state') {
    const state = String(data.state ?? '')
    if (state) {
      updateJob(jobId, {
        state: state as typeof job.state,
        startedAt: state === 'running' ? job.startedAt ?? ts : job.startedAt,
        endedAt: state === 'succeeded' || state === 'failed' || state === 'canceled' ? ts : undefined,
        wakeAt: typeof data.wakeAt === 'number' ? data.wakeAt : job.wakeAt
      })
    }
  } else if (type === 'step') {
    const stepId = String(data.stepId ?? '')
    if (stepId) {
      const status = String(data.status ?? 'running') as 'pending' | 'running' | 'succeeded' | 'failed' | 'skipped'
      updateStepState(jobId, stepId, {
        status,
        output: typeof data.output === 'string' ? data.output : undefined,
        error: typeof data.error === 'string' ? data.error : undefined,
        startedAt: status === 'running' ? ts : undefined,
        endedAt: status === 'succeeded' || status === 'failed' || status === 'skipped' ? ts : undefined,
        wakeAt: typeof data.wakeAt === 'number' ? data.wakeAt : undefined
      })
    }
  } else if (type === 'done') {
    const result = typeof data.result === 'string' ? data.result : ''
    updateJob(jobId, { state: 'succeeded', endedAt: ts, result, lastError: undefined })
    completeCommitment(job.commitmentId, true, result)
  } else if (type === 'error') {
    const msg = String(data.error ?? '云端执行失败')
    const retry = data.willRetry === true
    updateJob(jobId, {
      state: retry ? 'queued' : 'failed',
      endedAt: retry ? undefined : ts,
      lastError: msg
    })
    if (!retry) completeCommitment(job.commitmentId, false, msg)
  }
  appendJobEvent(jobId, type, { ...data, remoteSeq: seq ?? null })
  changed(jobId)
}

function handleResult(msg: Record<string, unknown>): void {
  const jobId = String(msg.jobId ?? '')
  if (!jobId) return
  const job = getJob(jobId)
  if (!job) return
  const state = String(msg.state ?? 'failed') as typeof job.state
  const result = typeof msg.result === 'string' ? msg.result : ''
  const error = typeof msg.error === 'string' ? msg.error : undefined
  updateJob(jobId, {
    state,
    result: result || job.result,
    lastError: error,
    endedAt: state === 'succeeded' || state === 'failed' || state === 'canceled' ? Date.now() : undefined
  })
  if (state === 'succeeded' || state === 'failed') completeCommitment(job.commitmentId, state === 'succeeded', result || error || '')
  appendJobEvent(jobId, state === 'succeeded' ? 'done' : 'error', { state, result: result.slice(0, 1000), error })
  changed(jobId)
}

function handleSnapshot(msg: Record<string, unknown>): void {
  const jobs = Array.isArray(msg.jobs) ? msg.jobs : []
  for (const raw of jobs) {
    if (!raw || typeof raw !== 'object') continue
    const item = raw as Record<string, unknown>
    const jobId = String(item.id ?? '')
    const job = getJob(jobId)
    if (!job) continue
    const state = String(item.state ?? '')
    if (state) {
      updateJob(jobId, {
        state: state as typeof job.state,
        result: typeof item.result === 'string' ? item.result : job.result,
        lastError: typeof item.error === 'string' ? item.error : job.lastError,
        serverSeq: Number(item.seq) || job.serverSeq,
        endedAt: state === 'succeeded' || state === 'failed' || state === 'canceled' ? Number(item.updatedAt) || Date.now() : job.endedAt
      })
    }
    const stepStates = item.stepStates
    if (stepStates && typeof stepStates === 'object') {
      for (const [stepId, st] of Object.entries(stepStates as Record<string, Record<string, unknown>>)) {
        updateStepState(jobId, stepId, {
          status: String(st.status ?? 'pending') as 'pending' | 'running' | 'succeeded' | 'failed' | 'skipped',
          output: typeof st.output === 'string' ? st.output : undefined,
          error: typeof st.error === 'string' ? st.error : undefined,
          wakeAt: typeof st.wakeAt === 'number' ? st.wakeAt : undefined
        })
      }
    }
    changed(jobId)
  }
}

export function installJobBridge(): void {
  setNodeJobSink((nodeId, msg) => {
    const type = String(msg.type ?? '')
    try {
      if (type === 'job.accepted') {
        const jobId = String(msg.jobId ?? msg.offerId ?? '')
        if (jobId && getJob(jobId)) {
          updateJob(jobId, {
            state: 'leased',
            leaseOwner: nodeId,
            leaseExpiresAt: Date.now() + 5 * 60 * 1000,
            lastError: undefined
          })
          changed(jobId)
        }
      } else if (type === 'job.event') {
        const jobId = String(msg.jobId ?? '')
        const event = (msg.event ?? {}) as Record<string, unknown>
        if (jobId) applyEvent(jobId, Number(msg.seq) || undefined, event)
      } else if (type === 'job.result') {
        handleResult(msg)
      } else if (type === 'job.snapshot') {
        handleSnapshot(msg)
      }
    } catch (e) {
      console.warn('[jobs] 云端事件处理失败', (e as Error).message)
    }
  })
}
