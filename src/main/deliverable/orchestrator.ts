/**
 * 生成编排器：文字草案 → 确认 → 绑定数据 → 审计 → 渲染
 * 唯一持有 render 调用权；未过闸门一律 GATE_NOT_CONFIRMED。
 */
import { col, insertInto, updateIn } from '../db'
import fs from 'fs'
import path from 'path'
import { genId } from '@shared/types'
import { dateKey } from '@shared/trail'
import type {
  AuditIssue,
  AuditResult,
  DeliverableJob,
  DeliverableProgress,
  RiskAssessment
} from '@shared/deliverable/audit'
import type {
  DeliverableFormat,
  DeliverableSpec,
  DeliverableTemplate,
  DraftChartRef,
  DraftSection,
  DraftSpec
} from '@shared/deliverable/spec'
import { runDraftRules, runSpecRules, autoFixSpec, estimatePages, blockText } from './rules'
import { semanticAudit } from './auditAgent'
import { renderDeliverable, specHash } from './render'
import { buildSpec } from './templates'
import { sendTo } from '../windows'

const PRIVACY_RE = [
  /\/Users\/[^\s，。；、)）]+/,
  /[A-Za-z]:\\[^\s，。；、)）]+/,
  /(?<![\w.+-])[\w.+-]+@[\w-]+\.[\w.]+/,
  /(?<!\d)1[3-9]\d{9}(?!\d)/
]

export class GateError extends Error {
  code = 'GATE_NOT_CONFIRMED'
  constructor(message = '生成任务尚未确认，不能渲染') {
    super(message)
    this.name = 'GateError'
  }
}

function emit(job: DeliverableJob, message?: string): void {
  const evt: DeliverableProgress = {
    jobId: job.id,
    stage: job.stage,
    revision: job.revision,
    issueCount: (job.draftIssues?.length ?? 0) + (job.specIssues?.length ?? 0),
    highIssueCount: [...(job.draftIssues ?? []), ...(job.specIssues ?? [])].filter((i) => i.level === 'high').length,
    message
  }
  sendTo('main', 'deliverable:progress', evt)
}

function save(job: DeliverableJob): DeliverableJob {
  job.updatedAt = Date.now()
  updateIn<DeliverableJob>('deliverableJobs', job.id, job)
  return job
}

function getJobOrThrow(jobId: string): DeliverableJob {
  const job = col<DeliverableJob>('deliverableJobs').find((j) => j.id === jobId)
  if (!job) throw new Error(`任务不存在：${jobId}`)
  return job
}

/** spec → 文字草案（只保留章节/要点/图表清单，不保留任何 HTML） */
export function draftFromSpec(spec: DeliverableSpec, goal?: string): DraftSpec {
  const sections: DraftSection[] = []
  let cur: DraftSection | null = null
  let index = 0
  const push = (): void => {
    if (cur && (cur.points.length || cur.charts?.length)) sections.push(cur)
  }
  for (const b of spec.blocks) {
    if (b.type === 'cover') continue
    if (b.type === 'heading' && b.level === 1) {
      push()
      index += 1
      cur = { id: `s${index}`, title: b.text, points: [], charts: [] }
      continue
    }
    if (!cur) {
      index += 1
      cur = { id: `s${index}`, title: '概览', points: [], charts: [] }
    }
    if (b.type === 'paragraph') cur.points.push(b.text)
    else if (b.type === 'callout') cur.points.push(`${b.title ? `${b.title}：` : ''}${b.text}`)
    else if (b.type === 'metrics') {
      cur.points.push(b.items.map((m) => `${m.label} ${m.value}${m.unit ?? ''}`).join(' · '))
    } else if (b.type === 'chart') {
      const chart: DraftChartRef = {
        id: b.id,
        kind: b.kind,
        title: b.title ?? '图表',
        sourceTool: b.source?.tool,
        note: b.caption
      }
      cur.charts = [...(cur.charts ?? []), chart]
    } else if (b.type === 'table' && b.title) {
      cur.points.push(`${b.title}（${b.rows.length} 行）`)
    } else if (b.type === 'timeline' && b.title) {
      cur.points.push(`${b.title}（${b.items.length} 条）`)
    }
  }
  push()
  if (!sections.length) sections.push({ id: 's1', title: '概览', points: [spec.title], charts: [] })
  return {
    template: spec.template,
    title: spec.title,
    subtitle: spec.subtitle,
    date: spec.date,
    audience: goal,
    sections,
    estimatedPages: estimatePages(spec),
    riskHints: []
  }
}

function classifyRisk(draft: DraftSpec, spec?: DeliverableSpec): RiskAssessment {
  const reasons: string[] = []
  const pages = spec ? estimatePages(spec) : draft.estimatedPages
  if (pages > 5) reasons.push(`预计 ${pages} 页`)
  const parts = [
    draft.title,
    draft.subtitle ?? '',
    draft.audience ?? '',
    ...draft.sections.flatMap((s) => [s.title, ...s.points, ...(s.charts ?? []).map((c) => c.title)])
  ]
  if (spec) parts.push(...spec.blocks.map(blockText))
  const text = parts.join('\n')
  if (PRIVACY_RE.some((re) => text.match(re))) reasons.push('含隐私字段')
  if (draft.sections.some((s) => (s.charts ?? []).some((c) => c.sourceTool && /web|external|browser/i.test(c.sourceTool)))) {
    reasons.push('含外部数据')
  }
  return { level: reasons.length ? 'high' : 'normal', needsAstConfirm: reasons.length > 0, reasons }
}

async function genReport(date: string): Promise<Awaited<ReturnType<typeof import('../report/engine').generateReport>>> {
  const { generateReport } = await import('../report/engine')
  return generateReport(date, undefined, false)
}

export function listJobs(limit = 20): DeliverableJob[] {
  return [...col<DeliverableJob>('deliverableJobs')]
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, Math.max(1, Math.min(100, limit)))
}

export function getJob(jobId: string): DeliverableJob | null {
  return col<DeliverableJob>('deliverableJobs').find((j) => j.id === jobId) ?? null
}

/** ① 只出文字草案，不落盘 */
export async function startDraft(input: {
  template?: DeliverableTemplate
  title?: string
  date?: string
  goal?: string
}): Promise<DeliverableJob> {
  const template: DeliverableTemplate = input.template ?? 'report'
  const date = (input.date ?? dateKey(Date.now())).slice(0, 10)
  const report = await genReport(date)
  const spec = buildSpec(template, report, { revision: 1 })
  const draft = draftFromSpec(spec, input.goal)
  if (input.title) draft.title = input.title
  const job: DeliverableJob = {
    id: genId('dlv'),
    stage: 'draft',
    draft,
    revision: 1,
    risk: classifyRisk(draft),
    draftIssues: [],
    specIssues: [],
    autoFixed: false,
    outputs: [],
    createdAt: Date.now(),
    updatedAt: Date.now()
  }
  job.draftIssues = runDraftRules(draft)
  job.stage = 'draft_audited'
  insertInto<DeliverableJob>('deliverableJobs', job)
  recordAudit(job, 'draft')
  emit(job, '草案已生成，等待确认')
  return job
}

/** ②-前置：按反馈修改草案（不确认、不渲染） */
export function reviseDraft(jobId: string, patch: Partial<DraftSpec>): DeliverableJob {
  const job = getJobOrThrow(jobId)
  if (job.stage !== 'draft' && job.stage !== 'draft_audited') {
    throw new Error(`当前阶段不能修改草案：${job.stage}`)
  }
  job.draft = { ...job.draft, ...patch, sections: patch.sections ?? job.draft.sections }
  job.draftIssues = runDraftRules(job.draft)
  job.stage = 'draft_audited'
  save(job)
  emit(job, '草案已更新')
  return job
}

/** ② 人工确认草案（可改章节/模板/标题） */
export function confirmDraft(jobId: string, patch?: Partial<DraftSpec>): DeliverableJob {  const job = getJobOrThrow(jobId)
  if (job.stage !== 'draft' && job.stage !== 'draft_audited') {
    throw new Error(`当前阶段不能确认草案：${job.stage}`)
  }
  const draft: DraftSpec = {
    ...job.draft,
    ...patch,
    sections: patch?.sections ?? job.draft.sections
  }
  job.draft = draft
  job.draftIssues = runDraftRules(draft)
  job.risk = classifyRisk(draft)
  job.stage = 'draft_confirmed'
  save(job)
  emit(job, '草案已确认')
  return job
}

/** ③ 绑定数据 → 生成 AST → 审计；失败自动修一轮 */
export async function buildAndAudit(jobId: string): Promise<DeliverableJob> {
  const job = getJobOrThrow(jobId)
  if (job.stage !== 'draft_confirmed') throw new GateError('草案未确认，不能生成交付物')
  const report = await genReport(job.draft.date ?? dateKey(Date.now()))
  let spec = buildSpec(job.draft.template, report, { jobId: job.id, revision: job.revision })
  spec.title = job.draft.title || spec.title
  spec.subtitle = job.draft.subtitle ?? spec.subtitle
  spec.meta = {
    ...spec.meta,
    jobId: job.id,
    revision: job.revision,
    dataSnapshotTs: Date.now(),
    hasExternalData: job.risk.reasons.includes('含外部数据')
  }

  let issues = runSpecRules(spec, job.draft)
  const semantic = await semanticAudit(spec, job.id, job.revision).catch(() => [])
  issues = [...issues, ...semantic]

  const high = issues.filter((i) => i.level === 'high')
  if (high.length) {
    const fixed = autoFixSpec(spec)
    if (fixed.changed > 0) {
      spec = fixed.spec
      const again = [...runSpecRules(spec, job.draft), ...(await semanticAudit(spec, job.id, job.revision).catch(() => []))]
      issues = again
      job.autoFixed = true
    }
  }

  if (job.spec) {
    job.history = [...(job.history ?? []), { revision: job.revision, spec: job.spec, at: Date.now() }].slice(-10)
  }
  job.spec = spec
  job.specIssues = issues
  job.risk = classifyRisk(job.draft, spec)
  spec.meta = { ...spec.meta, specHash: specHash(spec, spec.meta?.dataSnapshotTs) }
  const stillHigh = issues.filter((i) => i.level === 'high')
  if (stillHigh.length) {
    job.stage = 'escalated'
    save(job)
    emit(job, '自动修一轮后仍有高危问题，已暂停等待人工处理')
    return job
  }
  job.stage = 'spec_audited'
  if (!job.risk.needsAstConfirm) job.stage = 'spec_confirmed'
  save(job)
  recordAudit(job, 'spec')
  emit(job, job.stage === 'spec_confirmed' ? '审计通过，可直接渲染' : '审计通过，等待 AST 预览确认')
  return job
}

/** ④ 高风险时的 AST 预览确认 */
export function confirmSpec(jobId: string): DeliverableJob {
  const job = getJobOrThrow(jobId)
  if (job.stage !== 'spec_audited' && job.stage !== 'escalated') {
    throw new Error(`当前阶段不能确认 AST：${job.stage}`)
  }
  job.stage = 'spec_confirmed'
  save(job)
  emit(job, 'AST 已确认')
  return job
}

/** ⑤ 渲染（唯一出口） */
export async function renderJob(
  jobId: string,
  format: DeliverableFormat,
  opts: { revision?: number } = {}
): Promise<{ job: DeliverableJob; path: string; bytes: number }> {
  const job = getJobOrThrow(jobId)
  if (job.stage !== 'spec_confirmed' || !job.spec) {
    throw new GateError(`任务未确认或未通过审计（当前 ${job.stage}），不能渲染`)
  }
  const revision = opts.revision ?? job.revision
  const spec: DeliverableSpec = { ...job.spec, meta: { ...job.spec.meta, revision } }
  job.stage = 'rendering'
  save(job)
  const out = await renderDeliverable(format, spec, { revision })
  job.outputs.push({ format, path: out.path, bytes: out.bytes, revision, createdAt: Date.now() })
  // 产物旁留痕：审计问题 + 每个数字的来源附录
  try {
    const audits = col<AuditResult>('deliverableAudits')
      .filter((a) => a.jobId === job.id && a.revision === revision)
      .map((a) => ({ gate: a.gate, pass: a.pass, checkedAt: a.checkedAt, issues: a.issues }))
    const provenance = spec.blocks
      .filter((b) => b.type === 'table' || b.type === 'chart')
      .map((b) => ({ type: b.type, title: (b as { title?: string }).title ?? '', source: (b as { source?: unknown }).source ?? null }))
    fs.writeFileSync(
      path.join(path.dirname(out.path), `audit-${revision}.json`),
      JSON.stringify({ jobId: job.id, revision, template: job.draft.template, audits, provenance }, null, 2),
      'utf8'
    )
  } catch {
    /* 留痕失败不阻断产物 */
  }
  job.stage = 'done'
  save(job)
  emit(job, `已生成 ${format.toUpperCase()}`)
  return { job, path: out.path, bytes: out.bytes }
}

/** 回滚到历史 revision（只回滚 AST，不删除旧产物） */
export function revertJob(jobId: string, revision: number): DeliverableJob {
  const job = getJobOrThrow(jobId)
  const hit = job.history?.find((h) => h.revision === revision)
  if (!hit) throw new Error(`没有 revision ${revision} 的快照`)
  job.spec = hit.spec
  job.revision = Math.max(job.revision + 1, revision + 1)
  job.stage = 'spec_audited'
  save(job)
  emit(job, `已回滚到 r${revision}`)
  return job
}

export function cancelJob(jobId: string): DeliverableJob {
  const job = getJobOrThrow(jobId)
  job.stage = 'cancelled'
  save(job)
  emit(job, '已取消')
  return job
}

/** 把审计结果写进留痕集合（供产物旁 audit 记录） */
export function recordAudit(job: DeliverableJob, gate: 'draft' | 'spec'): AuditResult {
  const issues: AuditIssue[] = gate === 'draft' ? job.draftIssues : job.specIssues
  const result: AuditResult = {
    id: genId('aud'),
    ts: Date.now(),
    jobId: job.id,
    revision: job.revision,
    gate,
    pass: !issues.some((i) => i.level === 'high'),
    issues,
    checkedAt: Date.now()
  }
  insertInto<AuditResult>('deliverableAudits', result)
  return result
}

/** automation 只允许引用已审批任务 */
export async function renderApproved(
  approvedSpecId: string,
  format: DeliverableFormat
): Promise<{ job: DeliverableJob; path: string; bytes: number }> {
  const job = col<DeliverableJob>('deliverableJobs').find(
    (j) => (j.approvedSpecId === approvedSpecId || j.id === approvedSpecId) && j.stage === 'spec_confirmed'
  )
  if (!job) throw new GateError('没有已审批的交付物任务，自动化不能新建草案')
  return renderJob(job.id, format)
}
