/**
 * 模板公共工具：GeneratedReport → DeliverableSpec 的通用片段
 */
import type { GeneratedReport, ReportEntry } from '@shared/types'
import type { DataSourceRef, DeliverableSpec, DeliverableTemplate } from '@shared/deliverable/spec'

export interface TemplateContext {
  report: GeneratedReport
  jobId?: string
  revision?: number
  dataSnapshotTs?: number
}

export function fmtMin(min: number): string {
  const m = Math.max(0, Math.round(min))
  if (m < 60) return `${m} 分钟`
  const h = Math.floor(m / 60)
  const r = m % 60
  return r ? `${h} 小时 ${r} 分` : `${h} 小时`
}

export function src(ctx: TemplateContext, suffix: string): DataSourceRef {
  return {
    tool: 'generateReport',
    queryId: `${ctx.report.date}#${suffix}`,
    ts: ctx.dataSnapshotTs ?? Date.now(),
    label: '本地轨迹与报告引擎'
  }
}

export function entryLine(e: ReportEntry): string {
  const parts = [e.contentSummary ?? e.contentTag ?? e.stateLabel]
  if (e.project) parts.push(`项目：${e.project}`)
  if (e.output) parts.push(`产出：${e.output}`)
  return parts.join(' · ')
}

export function topEntries(report: GeneratedReport, n = 6): ReportEntry[] {
  return [...report.entries].sort((a, b) => b.durationMin - a.durationMin).slice(0, n)
}

export function baseSpec(
  template: DeliverableTemplate,
  ctx: TemplateContext,
  title: string,
  subtitle?: string
): DeliverableSpec {
  return {
    template,
    title,
    subtitle,
    date: ctx.report.date,
    author: 'WorkOn',
    theme: 'dark',
    blocks: [],
    meta: {
      jobId: ctx.jobId,
      revision: ctx.revision ?? 1,
      dataSnapshotTs: ctx.dataSnapshotTs ?? Date.now(),
      hasExternalData: false
    }
  }
}
