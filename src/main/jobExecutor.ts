/**
 * 本地作业执行器（低资源档）
 *
 * - 只执行当前进程能承担的步骤：shell / http / model / wait / notify
 * - agent 步骤需要云作业服务器上的完整 Harness；本机只给出明确提示
 * - 每个步骤结果落 jobStore；进程重启后从最后完成步骤继续
 * - shell 默认限制在 userData/job-workspaces/<jobId>，超时与输出都有上限
 */
import { app } from 'electron'
import fs from 'fs'
import path from 'path'
import { spawn, type ChildProcess } from 'child_process'
import type { JobRecord, JobStep } from '@shared/job'
import { nextRunAfter } from '@shared/job'
import { getJob, updateJob, updateStepState, appendJobEvent, patchCommitment, getCommitment } from './jobStore'
import { runWorkflowNode } from './workflow'
import { pushNotify } from './notify'
import { sendTo } from './windows'

const MAX_OUTPUT = 20_000
const running = new Set<string>()
const shells = new Map<string, ChildProcess>()

function emit(jobId: string, type: 'state' | 'step' | 'log' | 'notify' | 'done' | 'error', data?: Record<string, unknown>): void {
  appendJobEvent(jobId, type, data)
  sendTo('main', 'job:changed', { jobId })
}

function workspace(jobId: string): string {
  const dir = path.join(app.getPath('userData'), 'job-workspaces', jobId)
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

function cap(text: string): string {
  return text.length > MAX_OUTPUT ? `${text.slice(0, MAX_OUTPUT)}\n…（已截断）` : text
}

function orderSteps(job: JobRecord): JobStep[] {
  const steps = job.plan.steps
  const byId = new Map(steps.map((s) => [s.id, s]))
  const done = new Set<string>()
  const out: JobStep[] = []
  let guard = 0
  while (out.length < steps.length && guard++ < steps.length * 4) {
    for (const step of steps) {
      if (done.has(step.id)) continue
      const deps = step.dependsOn ?? []
      if (deps.every((d) => done.has(d) || !byId.has(d))) {
        out.push(step)
        done.add(step.id)
      }
    }
  }
  for (const step of steps) if (!done.has(step.id)) out.push(step)
  return out
}

function depsFailed(job: JobRecord, step: JobStep): string | null {
  for (const dep of step.dependsOn ?? []) {
    const st = job.stepStates[dep]
    if (st?.status === 'failed') return `依赖步骤失败：${dep}`
    if (st?.status === 'skipped') return `依赖步骤跳过：${dep}`
  }
  return null
}

async function runShell(job: JobRecord, step: Extract<JobStep, { kind: 'shell' }>, cwd: string): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    const child = spawn('/bin/bash', ['-lc', step.command], {
      cwd,
      env: {
        PATH: process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin',
        HOME: cwd,
        LANG: process.env.LANG ?? 'en_US.UTF-8'
      }
    })
    shells.set(job.id, child)
    let out = ''
    let err = ''
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      try { child.kill('SIGKILL') } catch { /* ignore */ }
      reject(new Error(`命令超时（${step.timeoutMs ?? job.policy.timeoutMs}ms）`))
    }, Math.max(1000, step.timeoutMs ?? job.policy.timeoutMs))
    child.stdout?.on('data', (buf: Buffer) => { out = cap(out + buf.toString('utf8')) })
    child.stderr?.on('data', (buf: Buffer) => { err = cap(err + buf.toString('utf8')) })
    child.on('error', (e) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      shells.delete(job.id)
      reject(e)
    })
    child.on('close', (code) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      shells.delete(job.id)
      if (code === 0) resolve(out.trim() || '（命令无输出）')
      else reject(new Error(`命令退出码 ${code}${err ? `：${err.slice(0, 800)}` : ''}`))
    })
  })
}

async function runHttp(step: Extract<JobStep, { kind: 'http' }>): Promise<string> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 60_000)
  try {
    const res = await fetch(step.url, {
      method: step.method ?? 'GET',
      headers: step.headers,
      body: step.body,
      signal: controller.signal
    })
    const text = cap(await res.text())
    if (!res.ok) throw new Error(`HTTP ${res.status}：${text.slice(0, 500)}`)
    return text
  } finally {
    clearTimeout(timer)
  }
}

async function runModel(step: Extract<JobStep, { kind: 'model' }>): Promise<string> {
  const r = await runWorkflowNode({
    model: undefined,
    system: step.system,
    prompt: step.prompt,
    timeoutMs: 240_000
  })
  if (!r.ok) throw new Error(r.error || '模型调用失败')
  return r.text
}

/** 执行一步；返回输出。wait 特殊处理：抛出 WaitSignal 由外层落 waiting 状态 */
class WaitSignal extends Error {
  constructor(public wakeAt: number) {
    super('wait')
  }
}

async function runStep(job: JobRecord, step: JobStep, cwd: string): Promise<string> {
  switch (step.kind) {
    case 'shell':
      return await runShell(job, step, cwd)
    case 'http':
      return await runHttp(step)
    case 'model':
      return await runModel(step)
    case 'notify':
      pushNotify('ai', job.title, step.text, [], 60)
      return step.text
    case 'wait': {
      const saved = job.stepStates[step.id]?.wakeAt
      const wakeAt = saved ?? step.until ?? Date.now() + Math.max(1000, step.delayMs ?? 60_000)
      if (wakeAt > Date.now()) throw new WaitSignal(wakeAt)
      return '已到时间'
    }
    case 'agent':
      throw new Error('Agent 步骤需要云作业服务器；请把事务目标切到已配对的云节点')
  }
}

function finishCommitment(job: JobRecord, ok: boolean, result: string): void {
  if (!job.commitmentId) return
  const cmt = getCommitment(job.commitmentId)
  if (!cmt) return
  const now = Date.now()
  patchCommitment(cmt.id, {
    lastRunAt: now,
    nextRunAt: nextRunAfter(cmt.trigger, now),
    memory: ok ? result.slice(0, 2000) : cmt.memory
  })
}

/** 本地执行一个作业；可重复调用（会从已完成步骤继续） */
export async function executeJobLocally(jobId: string, opts?: { confirmed?: boolean }): Promise<void> {
  if (running.has(jobId)) return
  const job = getJob(jobId)
  if (!job) return
  if (job.state === 'succeeded' || job.state === 'failed' || job.state === 'canceled') return
  if (job.target.kind !== 'local') return
  running.add(jobId)
  const startedAt = job.startedAt ?? Date.now()
  updateJob(jobId, { state: 'running', startedAt, attempts: job.attempts + 1, wakeAt: undefined })
  emit(jobId, 'state', { state: 'running' })
  try {
    const cwd = workspace(jobId)
    const steps = orderSteps(job)
    let last = ''
    for (const step of steps) {
      const current = getJob(jobId)
      if (!current) return
      if (current.state === 'canceled') return
      const st = current.stepStates[step.id]
      if (st?.status === 'succeeded') {
        last = st.output ?? last
        continue
      }
      if (st?.status === 'skipped') continue
      const failedDep = depsFailed(current, step)
      if (failedDep) {
        updateStepState(jobId, step.id, { status: 'skipped', error: failedDep })
        emit(jobId, 'step', { stepId: step.id, status: 'skipped', error: failedDep })
        continue
      }
      if (step.kind === 'shell' && current.policy.approval !== 'auto' && !opts?.confirmed) {
        updateJob(jobId, { state: 'needs_human', lastError: `步骤「${step.title}」需要确认执行命令` })
        emit(jobId, 'state', { state: 'needs_human', stepId: step.id, reason: 'shell-approval' })
        return
      }
      if (Date.now() - startedAt > current.policy.timeoutMs) {
        throw new Error(`作业超时（${Math.round(current.policy.timeoutMs / 1000)}s）`)
      }
      updateStepState(jobId, step.id, { status: 'running', startedAt: Date.now() })
      emit(jobId, 'step', { stepId: step.id, status: 'running', title: step.title })
      try {
        const out = await runStep(current, step, cwd)
        last = out
        updateStepState(jobId, step.id, { status: 'succeeded', output: out.slice(0, 4000), endedAt: Date.now(), wakeAt: undefined })
        emit(jobId, 'step', { stepId: step.id, status: 'succeeded', output: out.slice(0, 1000) })
      } catch (e) {
        if (e instanceof WaitSignal) {
          updateStepState(jobId, step.id, { status: 'running', wakeAt: e.wakeAt })
          updateJob(jobId, { state: 'waiting', wakeAt: e.wakeAt })
          emit(jobId, 'state', { state: 'waiting', wakeAt: e.wakeAt })
          return
        }
        throw e
      }
    }
    const done = Date.now()
    updateJob(jobId, {
      state: 'succeeded',
      endedAt: done,
      result: last.slice(0, 4000),
      lastError: undefined
    })
    emit(jobId, 'done', { state: 'succeeded', result: last.slice(0, 1000) })
    finishCommitment(job, true, last)
  } catch (e) {
    const msg = (e as Error).message || '执行失败'
    const fresh = getJob(jobId)
    if (!fresh) return
    if (fresh.state === 'canceled') return
    const attempts = fresh.attempts
    const willRetry = attempts < Math.max(1, fresh.policy.maxAttempts)
    updateJob(jobId, {
      state: willRetry ? 'queued' : 'failed',
      endedAt: willRetry ? undefined : Date.now(),
      lastError: msg,
      wakeAt: willRetry ? Date.now() + Math.min(300_000, 15_000 * attempts) : undefined
    })
    emit(jobId, 'error', { error: msg, willRetry })
    if (!willRetry) finishCommitment(fresh, false, msg)
  } finally {
    running.delete(jobId)
  }
}

/** 取消：标记状态并尽量终止本地 shell */
export function cancelJobLocally(jobId: string): boolean {
  const job = getJob(jobId)
  if (!job) return false
  const child = shells.get(jobId)
  if (child) {
    try { child.kill('SIGTERM') } catch { /* ignore */ }
    setTimeout(() => {
      try { child.kill('SIGKILL') } catch { /* ignore */ }
    }, 2000)
  }
  updateJob(jobId, { state: 'canceled', endedAt: Date.now(), wakeAt: undefined })
  emit(jobId, 'state', { state: 'canceled' })
  return true
}

/** 确认待执行的 shell 步骤后继续 */
export async function approveJobLocally(jobId: string): Promise<void> {
  const job = getJob(jobId)
  if (!job || job.state !== 'needs_human') return
  updateJob(jobId, { state: 'queued', lastError: undefined })
  await executeJobLocally(jobId, { confirmed: true })
}
