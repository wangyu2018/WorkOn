/**
 * 交付物草案卡：文字先行 → 确认 → 审计 → 渲染
 * 所有动作走 window.api；渲染闸门在主编排器，组件不绕过。
 */
import { useState } from 'react'
import type { AuditIssue, DeliverableJob } from '@shared/deliverable/audit'
import { TEMPLATE_LABEL } from '@shared/deliverable/spec'

const LEVEL_CLS: Record<AuditIssue['level'], string> = {
  high: 'text-rose-400',
  medium: 'text-amber-400',
  low: 'text-slate-400'
}

const STAGE_LABEL: Record<DeliverableJob['stage'], string> = {
  draft: '草案',
  draft_audited: '草案已审',
  draft_confirmed: '草案已确认',
  bound: '数据已绑定',
  spec_audited: '待确认版式',
  spec_confirmed: '已通过，可渲染',
  rendering: '渲染中',
  done: '已完成',
  escalated: '已暂停：待人工处理',
  cancelled: '已取消'
}

export function DeliverableDraftCard({
  job,
  onChanged
}: {
  job: DeliverableJob
  onChanged: (job: DeliverableJob) => void
}) {
  const [busy, setBusy] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const issues = [...(job.draftIssues ?? []), ...(job.specIssues ?? [])]

  const run = async (key: string, fn: () => Promise<unknown>): Promise<void> => {
    setBusy(key)
    setNote(null)
    try {
      const r = (await fn()) as DeliverableJob | { path?: string; job?: DeliverableJob }
      if (r && typeof r === 'object' && 'stage' in (r as DeliverableJob)) onChanged(r as DeliverableJob)
      else {
        const out = r as { path?: string; job?: DeliverableJob }
        if (out.job) onChanged(out.job)
        if (out.path) setNote(`已生成：${out.path}`)
      }
    } catch (e) {
      setNote(`失败：${(e as Error).message}`)
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="glass-card anim-fade-up flex flex-col gap-2 !p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-slate-200">{job.draft.title || '未命名交付物'}</span>
        <span className="rounded-full bg-white/[0.06] px-1.5 py-0.5 text-2xs text-slate-400">
          {TEMPLATE_LABEL[job.draft.template]}
        </span>
        <span className="text-2xs text-slate-500">预计 {job.draft.estimatedPages} 页</span>
        <span className="text-2xs text-slate-500">r{job.revision}</span>
        <span className="ml-auto text-2xs text-slate-400">{STAGE_LABEL[job.stage]}</span>
      </div>

      {job.risk.needsAstConfirm ? (
        <div className="text-2xs text-amber-400">高风险：{job.risk.reasons.join(' · ')}，需要二次确认版式</div>
      ) : null}

      <div className="flex flex-col gap-1">
        {job.draft.sections.map((s) => (
          <div key={s.id} className="rounded-lg bg-white/[0.03] px-2 py-1.5">
            <div className="text-2xs text-slate-300">{s.title}</div>
            <div className="mt-0.5 flex flex-col gap-0.5">
              {s.points.slice(0, 3).map((p, i) => (
                <div key={i} className="truncate text-2xs text-slate-500">
                  · {p}
                </div>
              ))}
              {(s.charts ?? []).length ? (
                <div className="text-2xs text-slate-600">
                  图表：{(s.charts ?? []).map((c) => c.title).join(' / ')}
                </div>
              ) : null}
            </div>
          </div>
        ))}
      </div>

      {issues.length ? (
        <div className="flex flex-col gap-0.5 border-t border-white/[0.06] pt-1.5">
          {issues.slice(0, 6).map((i) => (
            <div key={i.id} className={`text-2xs ${LEVEL_CLS[i.level]}`}>
              [{i.level}] {i.message}
            </div>
          ))}
        </div>
      ) : (
        <div className="text-2xs text-emerald-400">审计通过，无问题</div>
      )}

      <div className="flex flex-wrap items-center gap-1.5">
        {job.stage === 'draft_audited' || job.stage === 'draft' ? (
          <button className="glass-btn primary" disabled={!!busy} onClick={() => void run('confirm', () => window.api.confirmDeliverableDraft(job.id))}>
            {busy === 'confirm' ? '确认中…' : '确认草案'}
          </button>
        ) : null}
        {job.stage === 'draft_confirmed' ? (
          <button className="glass-btn primary" disabled={!!busy} onClick={() => void run('build', () => window.api.buildDeliverable(job.id))}>
            {busy === 'build' ? '绑定与审计中…' : '生成版式并审计'}
          </button>
        ) : null}
        {job.stage === 'spec_audited' || job.stage === 'escalated' ? (
          <button className="glass-btn primary" disabled={!!busy} onClick={() => void run('spec', () => window.api.confirmDeliverableSpec(job.id))}>
            确认版式
          </button>
        ) : null}
        {job.stage === 'spec_confirmed' ? (
          <>
            <button className="glass-btn primary" disabled={!!busy} onClick={() => void run('html', () => window.api.renderDeliverableJob(job.id, 'html'))}>
              导出 HTML
            </button>
            <button className="glass-btn" disabled={!!busy} onClick={() => void run('pdf', () => window.api.renderDeliverableJob(job.id, 'pdf'))}>
              导出 PDF
            </button>
            <button className="glass-btn" disabled={!!busy} onClick={() => void run('png', () => window.api.renderDeliverableJob(job.id, 'png'))}>
              导出长图
            </button>
          </>
        ) : null}
        {job.stage !== 'done' && job.stage !== 'cancelled' ? (
          <button className="glass-btn" disabled={!!busy} onClick={() => void run('cancel', () => window.api.cancelDeliverableJob(job.id))}>
            取消
          </button>
        ) : null}
        <span className="text-2xs text-slate-600">未确认不会生成任何文件</span>
      </div>

      {job.outputs.length ? (
        <div className="flex flex-col gap-0.5 border-t border-white/[0.06] pt-1.5">
          {job.outputs.map((o, i) => (
            <div key={`${o.path}-${i}`} className="truncate text-2xs text-slate-500">
              {o.format.toUpperCase()} · r{o.revision} · {o.path}
            </div>
          ))}
        </div>
      ) : null}
      {note ? <div className="text-2xs text-slate-400">{note}</div> : null}
    </div>
  )
}
