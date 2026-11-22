import type { GeneratedReport } from '@shared/types'
import type { DeliverableSpec, DeliverableTemplate } from '@shared/deliverable/spec'
import { briefTemplate } from './brief'
import { reportTemplate } from './report'
import { deckTemplate } from './deck'
import { posterTemplate } from './poster'
import type { TemplateContext } from './common'

export function buildSpec(
  template: DeliverableTemplate,
  report: GeneratedReport,
  opts: { jobId?: string; revision?: number } = {}
): DeliverableSpec {
  const ctx: TemplateContext = { report, ...opts, dataSnapshotTs: Date.now() }
  if (template === 'brief') return briefTemplate(ctx)
  if (template === 'deck') return deckTemplate(ctx)
  if (template === 'poster') return posterTemplate(ctx)
  return reportTemplate(ctx)
}

export type { TemplateContext }
