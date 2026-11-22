/**
 * 审计规则引擎（确定性检查）
 * 原则：能确定判断的绝不交给模型；模型只做语义。
 */
import type { AuditIssue, AuditLevel, AuditCategory } from '@shared/deliverable/audit'
import type { DeliverableBlock, DeliverableSpec, DraftSpec } from '@shared/deliverable/spec'
import { TEMPLATE_MAX_PAGES } from '@shared/deliverable/spec'

let seq = 0
function nextId(prefix: string): string {
  seq += 1
  return `${prefix}-${Date.now().toString(36)}-${seq}`
}

function issue(
  level: AuditLevel,
  category: AuditCategory,
  message: string,
  opts: { blockId?: string; evidence?: string; fixHint?: string; autoFixable?: boolean } = {}
): AuditIssue {
  return {
    id: nextId('ai'),
    level,
    category,
    message,
    blockId: opts.blockId,
    evidence: opts.evidence,
    fixHint: opts.fixHint,
    autoFixable: opts.autoFixable ?? false
  }
}

const NUMERIC_BLOCKS = new Set(['metrics', 'table', 'chart'])

/** 数值块必须有来源 */
export function checkProvenance(spec: DeliverableSpec): AuditIssue[] {
  const out: AuditIssue[] = []
  for (const b of spec.blocks) {
    if (!NUMERIC_BLOCKS.has(b.type)) continue
    const src = (b as { source?: { tool?: string; queryId?: string; ts?: number } }).source
    if (!src || !src.tool || !src.queryId || !src.ts) {
      out.push(
        issue('high', 'fact', `「${blockLabel(b)}」缺少数据来源（tool/queryId/ts）`, {
          blockId: b.id,
          fixHint: '重新绑定工具结果，或删除该块',
          autoFixable: false
        })
      )
    }
  }
  return out
}

/** 图表与表格/正文同名字段必须一致 */
export function checkConsistency(spec: DeliverableSpec): AuditIssue[] {
  const out: AuditIssue[] = []
  const tableValues = new Map<string, number>()
  for (const b of spec.blocks) {
    if (b.type !== 'table') continue
    for (const row of b.rows) {
      if (!row.length) continue
      const label = String(row[0] ?? '').trim()
      const nums = row
        .slice(1)
        .map((v) => (typeof v === 'number' ? v : Number(String(v ?? '').replace(/[^\d.-]/g, ''))))
        .filter((n) => Number.isFinite(n))
      if (label && nums.length) tableValues.set(label, nums[nums.length - 1])
    }
  }
  for (const b of spec.blocks) {
    if (b.type !== 'chart' || !b.points?.length) continue
    for (const p of b.points) {
      const tv = tableValues.get(p.label)
      if (tv === undefined) continue
      const diff = Math.abs(tv - p.value)
      const base = Math.max(1, Math.abs(tv), Math.abs(p.value))
      if (diff / base > 0.02) {
        out.push(
          issue('high', 'consistency', `图表「${p.label}」与表格数值不一致`, {
            blockId: b.id,
            evidence: `图表 ${p.value} / 表格 ${tv}`,
            fixHint: '统一取同一数据源重绑'
          })
        )
      }
    }
  }
  return out
}

function estimatePages(spec: DeliverableSpec): number {
  if (spec.template === 'deck') {
    return Math.max(1, spec.blocks.filter((b) => b.type === 'cover' || b.type === 'heading' || b.type === 'chart').length + 1)
  }
  if (spec.template === 'brief' || spec.template === 'poster') return 1
  const weight = spec.blocks.reduce((s, b) => {
    if (b.type === 'chart' || b.type === 'flow' || b.type === 'table') return s + 1.4
    if (b.type === 'timeline') return s + 1.2
    return s + 0.55
  }, 0)
  return Math.max(1, Math.ceil(weight / 3.2))
}

/** 版式：超长文本、页数、图表密度 */
export function checkLayout(spec: DeliverableSpec, draft?: DraftSpec): AuditIssue[] {
  const out: AuditIssue[] = []
  for (const b of spec.blocks) {
    if (b.type === 'heading' && b.text.length > 60) {
      out.push(
        issue('medium', 'layout', '标题超过 60 字', {
          blockId: b.id,
          evidence: `${b.text.length} 字`,
          fixHint: '截断到 60 字内',
          autoFixable: true
        })
      )
    }
    if (b.type === 'paragraph' && b.text.length > 400) {
      out.push(
        issue('medium', 'layout', '段落超过 400 字', {
          blockId: b.id,
          evidence: `${b.text.length} 字`,
          fixHint: '拆成 2-3 段',
          autoFixable: true
        })
      )
    }
    if (b.type === 'table' && b.columns.length > 8) {
      out.push(issue('medium', 'layout', '表格列数超过 8', { blockId: b.id, fixHint: '删列或拆表', autoFixable: true }))
    }
    if (b.type === 'chart' && (b.points?.length ?? 0) > 20) {
      out.push(issue('medium', 'layout', '图表数据点超过 20', { blockId: b.id, fixHint: '取 Top N', autoFixable: true }))
    }
  }
  const pages = estimatePages(spec)
  const max = TEMPLATE_MAX_PAGES[spec.template]
  if (pages > max) {
    out.push(
      issue('medium', 'layout', `预计 ${pages} 页，超过模板上限 ${max} 页`, {
        fixHint: '删减章节或换 report 模板',
        autoFixable: true
      })
    )
  }
  if (draft && draft.estimatedPages > max) {
    out.push(issue('medium', 'layout', `草案预计 ${draft.estimatedPages} 页，超过模板上限 ${max} 页`, { autoFixable: true }))
  }
  return out
}

const PRIVACY_PATTERNS: Array<{ re: RegExp; label: string }> = [
  { re: /\/Users\/[^\s，。；、)）]+/g, label: '本机路径' },
  { re: /[A-Za-z]:\\[^\s，。；、)）]+/g, label: 'Windows 路径' },
  { re: /(?<![\w.+-])[\w.+-]+@[\w-]+\.[\w.]+/g, label: '邮箱' },
  { re: /(?<!\d)1[3-9]\d{9}(?!\d)/g, label: '手机号' }
]

/** 隐私：路径/邮箱/手机号必须脱敏 */
export function checkPrivacy(spec: DeliverableSpec): AuditIssue[] {
  const out: AuditIssue[] = []
  for (const b of spec.blocks) {
    if (b.redacted) continue
    const text = blockText(b)
    for (const p of PRIVACY_PATTERNS) {
      const m = text.match(p.re)
      if (m?.length) {
        out.push(
          issue('high', 'privacy', `「${blockLabel(b)}」包含${p.label}且未脱敏`, {
            blockId: b.id,
            evidence: m[0].slice(0, 80),
            fixHint: '打码或替换为占位符',
            autoFixable: true
          })
        )
      }
    }
  }
  return out
}

/** 合规：外发必须有隐私复核标记 */
export function checkCompliance(spec: DeliverableSpec): AuditIssue[] {
  if (spec.meta?.shareTo && !spec.meta.privacyReviewed) {
    return [
      issue('high', 'compliance', '标记为外发但未完成隐私复核', {
        fixHint: '确认脱敏后设置 meta.privacyReviewed=true'
      })
    ]
  }
  return []
}

export function blockText(b: DeliverableBlock): string {
  if (b.type === 'heading' || b.type === 'paragraph') return b.text
  if (b.type === 'cover') return `${b.title} ${b.subtitle ?? ''}`
  if (b.type === 'callout') return `${b.title ?? ''} ${b.text}`
  if (b.type === 'footer') return b.text
  if (b.type === 'timeline') return b.items.map((i) => `${i.title} ${i.detail ?? ''}`).join(' ')
  if (b.type === 'table') return b.rows.flat().map((v) => String(v ?? '')).join(' ')
  if (b.type === 'metrics') return b.items.map((i) => `${i.label} ${i.value}${i.unit ?? ''}`).join(' ')
  if (b.type === 'chart') return (b.points ?? []).map((p) => p.label).join(' ')
  if (b.type === 'flow') return b.nodes.map((n) => n.label).join(' ')
  if (b.type === 'image') return `${b.alt ?? ''} ${b.caption ?? ''}`
  return ''
}

export function blockLabel(b: DeliverableBlock): string {
  if (b.type === 'heading') return b.text.slice(0, 16)
  if (b.type === 'cover') return b.title.slice(0, 16)
  if (b.type === 'chart') return b.title ?? '图表'
  if (b.type === 'table') return b.title ?? '表格'
  if (b.type === 'metrics') return '指标'
  if (b.type === 'timeline') return b.title ?? '时间线'
  if (b.type === 'callout') return b.title ?? '提示'
  if (b.type === 'flow') return b.title ?? '流程图'
  if (b.type === 'image') return b.caption ?? '图片'
  if (b.type === 'footer') return '页脚'
  return b.text.slice(0, 16)
}

/** spec 阶段全量规则 */
export function runSpecRules(spec: DeliverableSpec, draft?: DraftSpec): AuditIssue[] {
  return [
    ...checkProvenance(spec),
    ...checkConsistency(spec),
    ...checkLayout(spec, draft),
    ...checkPrivacy(spec),
    ...checkCompliance(spec)
  ]
}

/** draft 阶段规则：只查结构，不要求来源（尚未绑定数据） */
export function runDraftRules(draft: DraftSpec): AuditIssue[] {
  const out: AuditIssue[] = []
  if (!draft.title.trim()) out.push(issue('high', 'layout', '草案缺少标题', { autoFixable: true }))
  if (!draft.sections.length) out.push(issue('high', 'layout', '草案没有任何章节', { autoFixable: false }))
  for (const s of draft.sections) {
    if (!s.title.trim()) out.push(issue('medium', 'layout', `章节 ${s.id} 缺少标题`, { blockId: s.id, autoFixable: true }))
    if (!s.points.filter((p) => p.trim()).length) {
      out.push(issue('medium', 'layout', `章节「${s.title}」没有要点`, { blockId: s.id, autoFixable: true }))
    }
    if (s.title.length > 60) {
      out.push(issue('low', 'layout', `章节标题超过 60 字：${s.title.slice(0, 20)}…`, { blockId: s.id, autoFixable: true }))
    }
    if ((s.charts?.length ?? 0) > 6) {
      out.push(issue('low', 'layout', `章节「${s.title}」图表超过 6 个`, { blockId: s.id, autoFixable: true }))
    }
  }
  if (draft.estimatedPages > TEMPLATE_MAX_PAGES[draft.template]) {
    out.push(
      issue('medium', 'layout', `预计 ${draft.estimatedPages} 页，超过 ${draft.template} 模板上限`, {
        autoFixable: true
      })
    )
  }
  return out
}

/** 自动修：截断超长文本 + 实际脱敏 */
export function autoFixSpec(spec: DeliverableSpec): { spec: DeliverableSpec; changed: number } {
  let changed = 0
  const blocks = spec.blocks.map((b) => {
    if (b.type === 'heading' && b.text.length > 60) {
      changed += 1
      return { ...b, text: `${b.text.slice(0, 58)}…` }
    }
    if (b.type === 'paragraph' && b.text.length > 400) {
      changed += 1
      return { ...b, text: `${b.text.slice(0, 396)}…` }
    }
    if (b.type === 'chart' && (b.points?.length ?? 0) > 20) {
      changed += 1
      return { ...b, points: b.points!.slice(0, 20) }
    }
    return b
  })
  const redacted = blocks.map((b) => {
    if (b.redacted) return b
    const text = blockText(b)
    if (PRIVACY_PATTERNS.some((p) => text.match(p.re))) {
      changed += 1
      return redactBlock(b)
    }
    return b
  })
  return { spec: { ...spec, blocks: redacted }, changed }
}

function redactString(s: string): string {
  let out = s
  for (const p of PRIVACY_PATTERNS) out = out.replace(p.re, `[已脱敏:${p.label}]`)
  return out
}

function redactBlock(b: DeliverableBlock): DeliverableBlock {
  const done = { ...b, redacted: true } as DeliverableBlock
  if (done.type === 'heading' || done.type === 'paragraph' || done.type === 'footer') {
    return { ...done, text: redactString(done.text) }
  }
  if (done.type === 'cover') {
    return { ...done, title: redactString(done.title), subtitle: done.subtitle ? redactString(done.subtitle) : undefined }
  }
  if (done.type === 'callout') {
    return { ...done, title: done.title ? redactString(done.title) : undefined, text: redactString(done.text) }
  }
  if (done.type === 'timeline') {
    return { ...done, items: done.items.map((i) => ({ ...i, title: redactString(i.title), detail: i.detail ? redactString(i.detail) : undefined })) }
  }
  if (done.type === 'table') {
    return { ...done, columns: done.columns.map(redactString), rows: done.rows.map((r) => r.map((v) => (v === null ? null : redactString(String(v))))) }
  }
  if (done.type === 'metrics') {
    return { ...done, items: done.items.map((m) => ({ ...m, label: redactString(m.label), value: redactString(String(m.value)) })) }
  }
  if (done.type === 'chart') {
    return { ...done, points: done.points?.map((p) => ({ ...p, label: redactString(p.label) })), title: done.title ? redactString(done.title) : undefined }
  }
  if (done.type === 'flow') {
    return { ...done, nodes: done.nodes.map((n) => ({ ...n, label: redactString(n.label) })) }
  }
  if (done.type === 'image') {
    return { ...done, alt: done.alt ? redactString(done.alt) : undefined, caption: done.caption ? redactString(done.caption) : undefined }
  }
  return done
}

export { estimatePages }
