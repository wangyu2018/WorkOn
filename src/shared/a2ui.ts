/**
 * A2UI 1.0（P1 只读卡片 + P2 交互回写）
 * - 声明式 JSON：surface = { a2ui, surfaceId, title?, children[] }
 * 受控 catalog：metric / table / timeline / steps / link / chart / compare / flow / progress / image / kanban
 * - 渲染层原生实现，不执行任意 HTML；图表与导出文件共用 @shared/viz/svg
 * - 校验失败不吞内容：extract 返回原文，按 markdown 渲染（降级）
 * - P2：卡片可带 action（open_view / open_app / plan_status / snooze_reminder / run_workflow / open_url）
 */
import type { PlanStatus } from './types'

export type A2uiScalar = string | number | boolean | null

/** P2 交互：渲染层执行并回写结果（agentFunctionResponse 的本地映射） */
export type A2uiActionFn =
  | 'open_view'
  | 'open_app'
  | 'plan_status'
  | 'snooze_reminder'
  | 'run_workflow'
  | 'open_url'

export interface A2uiAction {
  fn: A2uiActionFn
  label: string
  args?: Record<string, A2uiScalar>
}

export interface A2uiMetricCard {
  type: 'metric'
  id: string
  label: string
  value: string | number
  unit?: string
  delta?: string
  hint?: string
  action?: A2uiAction
}

export interface A2uiTableCard {
  type: 'table'
  id: string
  title?: string
  columns: string[]
  rows: A2uiScalar[][]
  emptyText?: string
  action?: A2uiAction
}

export interface A2uiTimelineCard {
  type: 'timeline'
  id: string
  title?: string
  items: { time: string; title: string; detail?: string; state?: string }[]
  action?: A2uiAction
}

export interface A2uiStepsCard {
  type: 'steps'
  id: string
  title?: string
  current: number
  items: { title: string; detail?: string }[]
  action?: A2uiAction
}

export interface A2uiLinkCard {
  type: 'link'
  id: string
  label: string
  target: string
  hint?: string
  action?: A2uiAction
}

/** 图表卡：与应用内报表、导出文件共用 @shared/viz/svg */
export interface A2uiChartCard {
  type: 'chart'
  id: string
  title?: string
  kind: 'donut' | 'bars' | 'line' | 'spark' | 'heatmap' | 'funnel'
  points?: Array<{ label: string; value: number; color?: string }>
  matrix?: number[][]
  rowLabels?: string[]
  colLabels?: string[]
  caption?: string
  action?: A2uiAction
}

/** 对比卡：左右两列 + 高亮侧 */
export interface A2uiCompareCard {
  type: 'compare'
  id: string
  title?: string
  columns: [string, string]
  rows: Array<{ label: string; left: string; right: string; highlight?: 'left' | 'right' }>
  action?: A2uiAction
}

/** 流程图卡 */
export interface A2uiFlowCard {
  type: 'flow'
  id: string
  title?: string
  nodes: Array<{ id: string; label: string; kind?: string }>
  edges: Array<{ from: string; to: string; label?: string }>
  action?: A2uiAction
}

/** 进度卡 */
export interface A2uiProgressCard {
  type: 'progress'
  id: string
  label: string
  current: number
  total: number
  unit?: string
  action?: A2uiAction
}

/** 图片卡（仅 https / data:image / file: 白名单） */
export interface A2uiImageCard {
  type: 'image'
  id: string
  src: string
  alt?: string
  caption?: string
  action?: A2uiAction
}

/** 看板卡 */
export interface A2uiKanbanCard {
  type: 'kanban'
  id: string
  title?: string
  columns: Array<{ title: string; items: Array<{ title: string; tag?: string }> }>
  action?: A2uiAction
}

export type A2uiCard =
  | A2uiMetricCard
  | A2uiTableCard
  | A2uiTimelineCard
  | A2uiStepsCard
  | A2uiLinkCard
  | A2uiChartCard
  | A2uiCompareCard
  | A2uiFlowCard
  | A2uiProgressCard
  | A2uiImageCard
  | A2uiKanbanCard

export interface A2uiSurface {
  surfaceId: string
  title?: string
  children: A2uiCard[]
}

export interface A2uiValidation {
  ok: boolean
  surface?: A2uiSurface
  errors: string[]
}

const MAX_CHILDREN = 8
const MAX_TABLE_ROWS = 20
const MAX_TABLE_COLS = 6
const MAX_LIST_ITEMS = 20
const VIEW_KEYS = new Set([
  'home', 'plan', 'qa', 'intel', 'agents', 'workflow', 'report', 'calendar',
  'knowledge', 'mainline', 'profile', 'privacy', 'settings', 'monitor'
])
const ACTION_FNS = new Set<A2uiActionFn>([
  'open_view', 'open_app', 'plan_status', 'snooze_reminder', 'run_workflow', 'open_url'
])

function asText(v: unknown, max = 200): string {
  return typeof v === 'string' ? v.slice(0, max) : ''
}

function asNumber(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : 0
}

function parseAction(raw: unknown): A2uiAction | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const fn = asText(o.fn, 24) as A2uiActionFn
  if (!ACTION_FNS.has(fn)) return null
  const label = asText(o.label, 24) || '执行'
  const args: Record<string, A2uiScalar> = {}
  if (o.args && typeof o.args === 'object') {
    for (const [k, v] of Object.entries(o.args as Record<string, unknown>).slice(0, 8)) {
      if (typeof v === 'string') args[k] = v.slice(0, 160)
      else if (typeof v === 'number' || typeof v === 'boolean' || v === null) args[k] = v
    }
  }
  return { fn, label, args: Object.keys(args).length ? args : undefined }
}

function parseCard(raw: unknown, index: number, errors: string[]): A2uiCard | null {
  if (!raw || typeof raw !== 'object') {
    errors.push(`children[${index}] 不是对象`)
    return null
  }
  const o = raw as Record<string, unknown>
  const type = asText(o.type, 16)
  const id = asText(o.id, 40) || `c${index}`
  const action = parseAction(o.action) ?? undefined
  if (type === 'metric') {
    const label = asText(o.label, 40)
    if (!label) {
      errors.push(`metric[${index}] 缺少 label`)
      return null
    }
    return {
      type,
      id,
      label,
      value: typeof o.value === 'number' ? o.value : asText(o.value, 60),
      unit: asText(o.unit, 12) || undefined,
      delta: asText(o.delta, 24) || undefined,
      hint: asText(o.hint, 100) || undefined,
      action
    }
  }
  if (type === 'table') {
    const columns = (Array.isArray(o.columns) ? o.columns : []).map((c) => asText(c, 24)).filter(Boolean).slice(0, MAX_TABLE_COLS)
    if (!columns.length) {
      errors.push(`table[${index}] 缺少 columns`)
      return null
    }
    const rows = (Array.isArray(o.rows) ? o.rows : [])
      .slice(0, MAX_TABLE_ROWS)
      .map((row) =>
        (Array.isArray(row) ? row : []).slice(0, columns.length).map((cell) =>
          typeof cell === 'number' || typeof cell === 'boolean' || cell === null ? cell : asText(cell, 60)
        )
      )
    return {
      type,
      id,
      title: asText(o.title, 40) || undefined,
      columns,
      rows,
      emptyText: asText(o.emptyText, 40) || undefined,
      action
    }
  }
  if (type === 'timeline') {
    const items = (Array.isArray(o.items) ? o.items : [])
      .slice(0, MAX_LIST_ITEMS)
      .map((it) => {
        const x = (it ?? {}) as Record<string, unknown>
        return {
          time: asText(x.time, 24),
          title: asText(x.title, 80),
          detail: asText(x.detail, 160) || undefined,
          state: asText(x.state, 16) || undefined
        }
      })
      .filter((it) => it.title)
    if (!items.length) {
      errors.push(`timeline[${index}] 没有有效 items`)
      return null
    }
    return { type, id, title: asText(o.title, 40) || undefined, items, action }
  }
  if (type === 'steps') {
    const items = (Array.isArray(o.items) ? o.items : [])
      .slice(0, 10)
      .map((it) => {
        const x = (it ?? {}) as Record<string, unknown>
        return { title: asText(x.title, 60), detail: asText(x.detail, 120) || undefined }
      })
      .filter((it) => it.title)
    if (!items.length) {
      errors.push(`steps[${index}] 没有有效 items`)
      return null
    }
    return {
      type,
      id,
      title: asText(o.title, 40) || undefined,
      current: Math.max(0, Math.min(items.length - 1, Math.round(asNumber(o.current)))),
      items,
      action
    }
  }
  if (type === 'link') {
    const label = asText(o.label, 40)
    const target = asText(o.target, 300)
    if (!label || !target) {
      errors.push(`link[${index}] 缺少 label / target`)
      return null
    }
    const ok = /^https?:\/\//i.test(target) || VIEW_KEYS.has(target)
    if (!ok) {
      errors.push(`link[${index}] target 只能是 http(s) 或视图 key`)
      return null
    }
    return { type, id, label, target, hint: asText(o.hint, 80) || undefined, action }
  }
  if (type === 'chart') {
    const ALLOWED_KINDS = ['donut', 'bars', 'line', 'spark', 'heatmap', 'funnel'] as const
    const kind = asText(o.kind, 12) as (typeof ALLOWED_KINDS)[number]
    if (!ALLOWED_KINDS.includes(kind)) {
      errors.push(`chart[${index}] 不支持的 kind: ${kind || '(空)'}`)
      return null
    }
    const points = (Array.isArray(o.points) ? o.points : [])
      .slice(0, 24)
      .map((p) => {
        const x = (p ?? {}) as Record<string, unknown>
        return { label: asText(x.label, 24), value: asNumber(x.value), color: asText(x.color, 16) || undefined }
      })
      .filter((p) => p.label)
    const matrix = (Array.isArray(o.matrix) ? o.matrix : [])
      .slice(0, 12)
      .map((row) => (Array.isArray(row) ? row.slice(0, 24).map(asNumber) : []))
    if (kind !== 'heatmap' && !points.length) {
      errors.push(`chart[${index}] 没有有效 points`)
      return null
    }
    if (kind === 'heatmap' && !matrix.length) {
      errors.push(`chart[${index}] 热力图缺少 matrix`)
      return null
    }
    return {
      type,
      id,
      title: asText(o.title, 40) || undefined,
      kind,
      points: points.length ? points : undefined,
      matrix: matrix.length ? matrix : undefined,
      rowLabels: (Array.isArray(o.rowLabels) ? o.rowLabels : []).slice(0, 12).map((x) => asText(x, 16)),
      colLabels: (Array.isArray(o.colLabels) ? o.colLabels : []).slice(0, 24).map((x) => asText(x, 16)),
      caption: asText(o.caption, 60) || undefined,
      action
    }
  }
  if (type === 'compare') {
    const cols = (Array.isArray(o.columns) ? o.columns : []).slice(0, 2).map((c) => asText(c, 20))
    if (cols.length < 2) {
      errors.push(`compare[${index}] 需要两个列名`)
      return null
    }
    const rows = (Array.isArray(o.rows) ? o.rows : [])
      .slice(0, 12)
      .map((r) => {
        const x = (r ?? {}) as Record<string, unknown>
        const hl = asText(x.highlight, 8)
        const highlight: 'left' | 'right' | undefined = hl === 'left' ? 'left' : hl === 'right' ? 'right' : undefined
        return {
          label: asText(x.label, 30),
          left: asText(x.left, 80),
          right: asText(x.right, 80),
          highlight
        }
      })
      .filter((r) => r.label)
    if (!rows.length) {
      errors.push(`compare[${index}] 没有有效 rows`)
      return null
    }
    return { type, id, title: asText(o.title, 40) || undefined, columns: [cols[0], cols[1]], rows, action }
  }
  if (type === 'flow') {
    const nodes = (Array.isArray(o.nodes) ? o.nodes : [])
      .slice(0, 20)
      .map((n) => {
        const x = (n ?? {}) as Record<string, unknown>
        return { id: asText(x.id, 32), label: asText(x.label, 40), kind: asText(x.kind, 16) || undefined }
      })
      .filter((n) => n.id && n.label)
    if (!nodes.length) {
      errors.push(`flow[${index}] 没有有效 nodes`)
      return null
    }
    const ids = new Set(nodes.map((n) => n.id))
    const edges = (Array.isArray(o.edges) ? o.edges : [])
      .slice(0, 30)
      .map((e) => {
        const x = (e ?? {}) as Record<string, unknown>
        return { from: asText(x.from, 32), to: asText(x.to, 32), label: asText(x.label, 20) || undefined }
      })
      .filter((e) => ids.has(e.from) && ids.has(e.to))
    return { type, id, title: asText(o.title, 40) || undefined, nodes, edges, action }
  }
  if (type === 'progress') {
    const label = asText(o.label, 40)
    const total = asNumber(o.total)
    if (!label || total <= 0) {
      errors.push(`progress[${index}] 需要 label 与 total>0`)
      return null
    }
    return {
      type,
      id,
      label,
      current: Math.max(0, Math.min(total, asNumber(o.current))),
      total,
      unit: asText(o.unit, 12) || undefined,
      action
    }
  }
  if (type === 'image') {
    const src = asText(o.src, 500)
    if (!/^(https?:\/\/|data:image\/|file:\/\/)/i.test(src)) {
      errors.push(`image[${index}] src 不是允许的来源`)
      return null
    }
    return { type, id, src, alt: asText(o.alt, 60) || undefined, caption: asText(o.caption, 80) || undefined, action }
  }
  if (type === 'kanban') {
    const columns = (Array.isArray(o.columns) ? o.columns : [])
      .slice(0, 5)
      .map((c) => {
        const x = (c ?? {}) as Record<string, unknown>
        const items = (Array.isArray(x.items) ? x.items : [])
          .slice(0, 8)
          .map((it) => {
            const y = (it ?? {}) as Record<string, unknown>
            return { title: asText(y.title, 50), tag: asText(y.tag, 16) || undefined }
          })
          .filter((it) => it.title)
        return { title: asText(x.title, 20), items }
      })
      .filter((c) => c.title)
    if (!columns.length) {
      errors.push(`kanban[${index}] 没有有效 columns`)
      return null
    }
    return { type, id, title: asText(o.title, 40) || undefined, columns, action }
  }
  errors.push(`children[${index}] 不支持的 type: ${type || '(空)'}`)
  return null
}

/** 校验 surface（宽进严出：坏卡片丢弃并记录错误，全坏才判失败） */
export function parseA2uiSurface(raw: unknown): A2uiValidation {
  const errors: string[] = []
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, errors: ['surface 不是对象'] }
  }
  const o = raw as Record<string, unknown>
  const childrenRaw = Array.isArray(o.children) ? o.children.slice(0, MAX_CHILDREN) : []
  if (!childrenRaw.length) return { ok: false, errors: ['缺少 children 数组'] }
  const children: A2uiCard[] = []
  childrenRaw.forEach((c, i) => {
    const card = parseCard(c, i, errors)
    if (card) children.push(card)
  })
  if (!children.length) return { ok: false, errors }
  return {
    ok: true,
    surface: {
      surfaceId: asText(o.surfaceId, 48) || `surface-${Date.now()}`,
      title: asText(o.title, 60) || undefined,
      children
    },
    errors
  }
}

/** 整个围栏内容作为 JSON 解析（不能用非贪婪花括号截取：children 里嵌套对象会被截断）；
 *  末尾允许没有闭合围栏（模型被截断时常见），此时取到文本结尾 */
const FENCE_RE = /```(?:a2ui|json)?\s*([\s\S]*?)(?:```|$)/g

/** 围栏内容 → JSON 对象：先整体解析，夹了说明文字时退回首个 { 到最后一个 } */
function parseFenceBody(body: string): Record<string, unknown> | null {
  const tryParse = (s: string): Record<string, unknown> | null => {
    try {
      const v = JSON.parse(s) as unknown
      return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null
    } catch {
      return null
    }
  }
  const direct = tryParse(body.trim())
  if (direct) return direct
  const i = body.indexOf('{')
  const j = body.lastIndexOf('}')
  return i >= 0 && j > i ? tryParse(body.slice(i, j + 1)) : null
}

/**
 * 从 AI 文本中提取 A2UI surface：
 * - 遍历所有代码块，取第一个校验通过的 → 返回 surface + 去掉该代码块后的正文
 * - 未命中 / 校验失败 → surface=null，原文不动（markdown 降级）
 */
export function extractA2uiFromText(text: string): { surface: A2uiSurface | null; text: string } {
  if (!text || !text.includes('```')) return { surface: null, text }
  FENCE_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = FENCE_RE.exec(text))) {
    const raw = parseFenceBody(m[1])
    if (!raw) continue
    const payload = raw.surface && typeof raw.surface === 'object' ? raw.surface : raw
    const v = parseA2uiSurface(payload)
    if (!v.ok || !v.surface) continue
    const rest = (text.slice(0, m.index) + text.slice(m.index + m[0].length)).trim()
    return { surface: v.surface, text: rest }
  }
  return { surface: null, text }
}

/** D 侧动作参数：计划状态（避免渲染层重复校验） */
export function isPlanStatusArg(v: unknown): v is PlanStatus {
  return (
    v === 'planned' ||
    v === 'in_progress' ||
    v === 'partial' ||
    v === 'done' ||
    v === 'delayed' ||
    v === 'cancelled'
  )
}

/** 注入问答系统提示词的 A2UI 协议摘要（省 token 版） */
export const A2UI_PROMPT_HINT =
  '【A2UI 卡片】当答案适合对比/汇总/流程时，可在正文后附一个 ```a2ui 代码块，内容为 JSON：' +
  '{"a2ui":"1.0","surfaceId":"x","title":"可选","children":[...]}；children 支持 ' +
  '{"type":"metric","label":"专注","value":"3h20m"}、' +
  '{"type":"table","title":"","columns":["应用","时长"],"rows":[["Chrome","1h20m"]]}、' +
  '{"type":"timeline","title":"","items":[{"time":"09:00","title":"开始工作","detail":"可选"}]}、' +
  '{"type":"steps","title":"","current":0,"items":[{"title":"梳理"},{"title":"实现"}]}、' +
  '{"type":"link","label":"打开计划","target":"plan"}、' +
  '{"type":"chart","kind":"bars","title":"应用时长","points":[{"label":"Chrome","value":80}]}（kind: donut/bars/line/spark/heatmap/funnel）、' +
  '{"type":"compare","columns":["方案A","方案B"],"rows":[{"label":"成本","left":"低","right":"高","highlight":"left"}]}、' +
  '{"type":"flow","nodes":[{"id":"a","label":"收集"},{"id":"b","label":"生成"}],"edges":[{"from":"a","to":"b"}]}、' +
  '{"type":"progress","label":"本周目标","current":3,"total":5}、' +
  '{"type":"kanban","columns":[{"title":"待办","items":[{"title":"写周报"}]}]}。' +
  '卡片总数 ≤6，数据必须来自工具真实结果；可带 action：{"fn":"open_view","label":"打开","args":{"view":"plan"}}、' +
  '{"fn":"plan_status","label":"标记完成","args":{"id":"计划id","status":"done"}}；不适合时不要输出。'
