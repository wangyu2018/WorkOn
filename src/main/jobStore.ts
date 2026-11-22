/**
 * 事务/作业的本地持久化
 *
 * 口径：
 * - jobs.json 保存 Commitment 与 Job 的当前快照（原子写，防半截文件）
 * - job-events.jsonl 追加事件（审计 + 恢复依据），不保存模型原文以外的隐私内容
 * - 单用户单写者，事件序号在 jobs.json 里递增
 */
import { app } from 'electron'
import fs from 'fs'
import path from 'path'
import { genId } from '@shared/types'
import type {
  CommitmentRecord,
  JobEvent,
  JobPlan,
  JobPolicy,
  JobRecord,
  JobTarget,
  JobTrigger
} from '@shared/job'
import { DEFAULT_JOB_POLICY } from '@shared/job'

interface StoreShape {
  commitments: CommitmentRecord[]
  jobs: JobRecord[]
  eventSeq: number
}

const MAX_JOBS = 200
const MAX_EVENTS_BYTES = 4 * 1024 * 1024

let store: StoreShape = { commitments: [], jobs: [], eventSeq: 0 }
let dataDir = ''
let jsonFile = ''
let eventsFile = ''
let flushTimer: NodeJS.Timeout | null = null

function ensureDir(): void {
  if (!dataDir) {
    dataDir = app.getPath('userData')
    jsonFile = path.join(dataDir, 'jobs.json')
    eventsFile = path.join(dataDir, 'job-events.jsonl')
  }
}

function readStore(): StoreShape {
  ensureDir()
  try {
    const raw = fs.readFileSync(jsonFile, 'utf8')
    const parsed = JSON.parse(raw) as Partial<StoreShape>
    const commitments = Array.isArray(parsed.commitments) ? parsed.commitments : []
    const jobs = Array.isArray(parsed.jobs) ? parsed.jobs : []
    return {
      commitments: commitments.filter((c) => c && typeof c.id === 'string'),
      jobs: jobs.filter((j) => j && typeof j.id === 'string').slice(0, MAX_JOBS),
      eventSeq: Number.isFinite(parsed.eventSeq) ? Number(parsed.eventSeq) : 0
    }
  } catch {
    return { commitments: [], jobs: [], eventSeq: 0 }
  }
}

export function initJobStore(): void {
  ensureDir()
  store = readStore()
  // 上次进程退出时仍标记 running/leased 的作业：交回队列，由调度器重新派发
  const now = Date.now()
  for (const job of store.jobs) {
    if (job.state === 'running' || job.state === 'leased') {
      job.state = 'queued'
      job.leaseOwner = undefined
      job.leaseExpiresAt = undefined
      job.updatedAt = now
      job.lastError = job.lastError || '进程重启，已重新排队'
    }
  }
  flushJobStore()
}

export function flushJobStore(): void {
  ensureDir()
  if (flushTimer) {
    clearTimeout(flushTimer)
    flushTimer = null
  }
  const payload = JSON.stringify(store, null, 2)
  const tmp = `${jsonFile}.tmp`
  try {
    fs.writeFileSync(tmp, payload, 'utf8')
    fs.renameSync(tmp, jsonFile)
  } catch (e) {
    console.warn('[jobs] 状态写入失败', (e as Error).message)
  }
}

function scheduleFlush(): void {
  if (flushTimer) return
  flushTimer = setTimeout(() => {
    flushTimer = null
    flushJobStore()
  }, 250)
}

function trimJobs(): void {
  if (store.jobs.length <= MAX_JOBS) return
  const keep = new Set(
    [...store.jobs]
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, MAX_JOBS)
      .map((j) => j.id)
  )
  store.jobs = store.jobs.filter((j) => keep.has(j.id))
}

export function listCommitments(): CommitmentRecord[] {
  return [...store.commitments].sort((a, b) => b.updatedAt - a.updatedAt)
}

export function getCommitment(id: string): CommitmentRecord | null {
  return store.commitments.find((c) => c.id === id) ?? null
}

export function saveCommitment(input: {
  id?: string
  title: string
  intent: string
  plan: JobPlan
  trigger: JobTrigger
  policy?: JobPolicy
  target?: JobTarget
  status?: CommitmentRecord['status']
}): CommitmentRecord {
  const now = Date.now()
  const existing = input.id ? store.commitments.find((c) => c.id === input.id) : null
  if (existing) {
    existing.title = String(input.title || existing.title)
    existing.intent = String(input.intent || existing.intent)
    existing.plan = input.plan
    existing.trigger = input.trigger
    existing.policy = input.policy ?? existing.policy
    existing.target = input.target ?? existing.target
    existing.status = input.status ?? existing.status
    existing.updatedAt = now
    scheduleFlush()
    return existing
  }
  const rec: CommitmentRecord = {
    id: genId('cmt'),
    title: String(input.title || '未命名事务').slice(0, 80),
    intent: String(input.intent || ''),
    plan: input.plan,
    trigger: input.trigger,
    policy: input.policy ?? DEFAULT_JOB_POLICY,
    status: input.status ?? 'active',
    target: input.target ?? { kind: 'local' },
    createdAt: now,
    updatedAt: now,
    nextRunAt: now
  }
  store.commitments.unshift(rec)
  scheduleFlush()
  return rec
}

export function patchCommitment(
  id: string,
  patch: Partial<Pick<CommitmentRecord, 'status' | 'target' | 'trigger' | 'policy' | 'memory' | 'nextRunAt' | 'lastRunAt' | 'lastJobId'>>
): CommitmentRecord | null {
  const rec = store.commitments.find((c) => c.id === id)
  if (!rec) return null
  Object.assign(rec, patch, { updatedAt: Date.now() })
  scheduleFlush()
  return rec
}

export function removeCommitment(id: string): boolean {
  const before = store.commitments.length
  store.commitments = store.commitments.filter((c) => c.id !== id)
  if (store.commitments.length === before) return false
  scheduleFlush()
  return true
}

export function listJobs(limit = 50): JobRecord[] {
  return [...store.jobs].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, Math.max(1, limit))
}

export function getJob(id: string): JobRecord | null {
  return store.jobs.find((j) => j.id === id) ?? null
}

export function createJob(commitment: CommitmentRecord, plan?: JobPlan): JobRecord {
  const now = Date.now()
  const steps = (plan ?? commitment.plan).steps
  const stepStates: JobRecord['stepStates'] = {}
  for (const step of steps) {
    stepStates[step.id] = { status: 'pending' }
  }
  const job: JobRecord = {
    id: genId('job'),
    commitmentId: commitment.id,
    title: commitment.title,
    goal: commitment.intent,
    state: 'queued',
    target: commitment.target,
    plan: { steps },
    policy: commitment.policy,
    attempts: 0,
    createdAt: now,
    updatedAt: now,
    stepStates
  }
  store.jobs.unshift(job)
  trimJobs()
  patchCommitment(commitment.id, { lastJobId: job.id })
  scheduleFlush()
  return job
}

export function updateJob(id: string, patch: Partial<JobRecord>): JobRecord | null {
  const job = store.jobs.find((j) => j.id === id)
  if (!job) return null
  Object.assign(job, patch, { updatedAt: Date.now() })
  scheduleFlush()
  return job
}

export function updateStepState(
  jobId: string,
  stepId: string,
  patch: Partial<JobRecord['stepStates'][string]>
): JobRecord['stepStates'][string] | null {
  const job = store.jobs.find((j) => j.id === jobId)
  if (!job) return null
  const prev = job.stepStates[stepId] ?? { status: 'pending' as const }
  job.stepStates[stepId] = { ...prev, ...patch }
  job.updatedAt = Date.now()
  scheduleFlush()
  return job.stepStates[stepId]
}

/** 追加事件；返回带全局序号的记录 */
export function appendJobEvent(
  jobId: string,
  type: JobEvent['type'],
  data?: Record<string, unknown>
): JobEvent {
  ensureDir()
  const event: JobEvent = {
    seq: ++store.eventSeq,
    jobId,
    ts: Date.now(),
    type,
    data
  }
  try {
    fs.appendFileSync(eventsFile, `${JSON.stringify(event)}\n`, 'utf8')
  } catch (e) {
    console.warn('[jobs] 事件写入失败', (e as Error).message)
  }
  scheduleFlush()
  return event
}

/** 读取某作业最近事件（从文件尾部倒序读取，避免整文件载入内存） */
export function listJobEvents(jobId: string, limit = 50): JobEvent[] {
  ensureDir()
  try {
    const stat = fs.statSync(eventsFile)
    if (stat.size > MAX_EVENTS_BYTES) return []
    const raw = fs.readFileSync(eventsFile, 'utf8')
    const out: JobEvent[] = []
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue
      try {
        const ev = JSON.parse(line) as JobEvent
        if (ev.jobId === jobId) out.push(ev)
      } catch {
        /* 跳过坏行 */
      }
    }
    return out.slice(-Math.max(1, limit))
  } catch {
    return []
  }
}

/** 云端作业服务器断线重连后，按本地记录补一次状态 */
export function markJobsForResync(): JobRecord[] {
  return store.jobs.filter((j) => j.target.kind === 'node' && (j.state === 'leased' || j.state === 'running'))
}
