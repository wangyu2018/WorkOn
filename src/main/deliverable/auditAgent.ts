/**
 * 审计 Agent（语义层）：独立上下文，只读，输出结构化 issues
 * 拿不到 Writer 的推理过程，只拿 spec + 来源清单。
 */
import type { AuditIssue } from '@shared/deliverable/audit'
import type { DeliverableSpec } from '@shared/deliverable/spec'
import { llmChat, extractJson } from '../ai'

interface RawIssue {
  level?: string
  category?: string
  blockId?: string
  message?: string
  fixHint?: string
}

function clampLevel(v: string | undefined): 'high' | 'medium' | 'low' {
  return v === 'high' || v === 'low' ? v : 'medium'
}

export async function semanticAudit(spec: DeliverableSpec, jobId: string, revision: number): Promise<AuditIssue[]> {
  const digest = {
    title: spec.title,
    subtitle: spec.subtitle,
    template: spec.template,
    headings: spec.blocks.filter((b) => b.type === 'heading').map((b) => (b as { text: string }).text),
    paragraphs: spec.blocks.filter((b) => b.type === 'paragraph').map((b) => (b as { text: string }).text),
    callouts: spec.blocks
      .filter((b) => b.type === 'callout')
      .map((b) => (b as { title?: string; text: string }).text),
    metrics: spec.blocks
      .filter((b) => b.type === 'metrics')
      .flatMap((b) => (b as { items: Array<{ label: string; value: string | number }> }).items),
    charts: spec.blocks
      .filter((b) => b.type === 'chart')
      .map((b) => {
        const c = b as { title?: string; kind: string; points?: Array<{ label: string; value: number }> }
        return { title: c.title, kind: c.kind, points: (c.points ?? []).slice(0, 10) }
      })
  }
  const reply = await llmChat(
    [
      {
        role: 'system',
        content:
          '你是独立审计员，不是作者。只检查语义问题：结论是否有数据支撑、标题与内容是否一致、受众语气是否合适。' +
          '不要评价排版细节，不要编造数据，只输出 JSON 数组。没有问题时输出 []。'
      },
      {
        role: 'user',
        content:
          `待审内容：${JSON.stringify(digest).slice(0, 5000)}\n\n` +
          '输出格式：[{"level":"high|medium|low","category":"semantic","blockId":"可选","message":"问题","fixHint":"建议"}]'
      }
    ],
    30000
  )
  if (!reply) return []
  const data = extractJson(reply) as unknown
  const arr = Array.isArray(data) ? data : (data as { issues?: unknown })?.issues
  if (!Array.isArray(arr)) return []
  return arr.slice(0, 12).map((raw, i) => {
    const o = (raw ?? {}) as RawIssue
    return {
      id: `sem-${jobId}-${revision}-${i}`,
      level: clampLevel(o.level),
      category: 'semantic',
      blockId: typeof o.blockId === 'string' ? o.blockId.slice(0, 40) : undefined,
      message: String(o.message ?? '语义问题').slice(0, 200),
      fixHint: typeof o.fixHint === 'string' ? o.fixHint.slice(0, 160) : undefined,
      autoFixable: true
    }
  })
}
