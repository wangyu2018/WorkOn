/**
 * 共享 SVG 图表工具包（零依赖，纯字符串）
 * 同一份代码同时用于：应用内 A2UI 卡片 / 报表视图 / 导出的 HTML、PDF、PNG。
 * 约束：不访问 DOM，不引外部库，输出必须可内联进 HTML。
 */

export interface VizPoint {
  label: string
  value: number
  color?: string
}

export interface VizOptions {
  width?: number
  height?: number
  colors?: string[]
  fg?: string
  muted?: string
  caption?: string
  valueFormat?: (n: number) => string
  max?: number
}

export const VIZ_COLORS = [
  '#22D3EE',
  '#6366F1',
  '#34D399',
  '#F59E0B',
  '#F472B6',
  '#38BDF8',
  '#A78BFA',
  '#94A3B8'
]

export function escapeXml(s: string): string {
  return String(s ?? '').replace(/[&<>"']/g, (c) => {
    if (c === '&') return '&amp;'
    if (c === '<') return '&lt;'
    if (c === '>') return '&gt;'
    if (c === '"') return '&quot;'
    return '&#39;'
  })
}

export function formatValue(n: number, fmt?: (n: number) => string): string {
  if (fmt) return fmt(n)
  if (!Number.isFinite(n)) return '0'
  if (Math.abs(n) >= 10000) return `${(n / 1000).toFixed(1)}k`
  return String(Math.round(n * 10) / 10)
}

function svgWrap(w: number, h: number, body: string, caption?: string): string {
  const cap = caption
    ? `<text x="${w / 2}" y="${h - 4}" text-anchor="middle" font-size="10" fill="#64748B">${escapeXml(caption)}</text>`
    : ''
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="100%" ` +
    `style="width:100%;height:auto;display:block" role="img" aria-label="${escapeXml(caption ?? 'chart')}">` +
    `${body}${cap}</svg>`
  )
}

/** 环形图：等价于 ReportHub 的 Donut，带中心合计 */
export function donut(data: VizPoint[], opts: VizOptions = {}): string {
  const w = opts.width ?? 180
  const h = opts.height ?? 180
  const cx = w / 2
  const cy = (h - (opts.caption ? 14 : 0)) / 2
  const r = Math.min(w, h) * 0.34
  const sw = r * 0.34
  const total = data.reduce((s, d) => s + Math.max(0, d.value), 0) || 1
  const C = 2 * Math.PI * r
  let acc = 0
  const arcs = data
    .map((d, i) => {
      const frac = Math.max(0, d.value) / total
      const color = d.color ?? (opts.colors ?? VIZ_COLORS)[i % (opts.colors ?? VIZ_COLORS).length]
      const el =
        `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${color}" stroke-width="${sw}" ` +
        `stroke-dasharray="${Math.max(0, frac * C - 1.5)} ${C}" stroke-dashoffset="${-acc * C}" ` +
        `transform="rotate(-90 ${cx} ${cy})" />`
      acc += frac
      return el
    })
    .join('')
  const center =
    `<text x="${cx}" y="${cy - 2}" text-anchor="middle" font-size="${Math.round(r * 0.5)}" font-weight="600" ` +
    `fill="${opts.fg ?? '#E2E8F0'}">${escapeXml(formatValue(total, opts.valueFormat))}</text>` +
    `<text x="${cx}" y="${cy + r * 0.42}" text-anchor="middle" font-size="10" fill="${opts.muted ?? '#64748B'}">合计</text>`
  return svgWrap(w, h, `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="rgba(148,163,184,0.12)" stroke-width="${sw}" />${arcs}${center}`, opts.caption)
}

/** 横向条形图：应用时长/分类对比 */
export function bars(data: VizPoint[], opts: VizOptions = {}): string {
  const w = opts.width ?? 360
  const rowH = 24
  const padTop = 6
  const labelW = 84
  const valueW = 46
  const h = opts.height ?? Math.max(60, padTop * 2 + Math.max(1, data.length) * rowH)
  const max = opts.max ?? Math.max(1, ...data.map((d) => Math.abs(d.value)))
  const bw = w - labelW - valueW - 8
  const body = data
    .map((d, i) => {
      const y = padTop + i * rowH
      const color = d.color ?? (opts.colors ?? VIZ_COLORS)[i % (opts.colors ?? VIZ_COLORS).length]
      const len = Math.max(2, (Math.abs(d.value) / max) * bw)
      return (
        `<text x="${labelW - 6}" y="${y + rowH / 2 + 3.5}" text-anchor="end" font-size="10" fill="${opts.muted ?? '#94A3B8'}">${escapeXml(d.label)}</text>` +
        `<rect x="${labelW}" y="${y + 5}" width="${len}" height="${rowH - 10}" rx="4" fill="${color}" opacity="0.9" />` +
        `<text x="${labelW + len + 6}" y="${y + rowH / 2 + 3.5}" font-size="10" fill="${opts.fg ?? '#E2E8F0'}">${escapeXml(formatValue(d.value, opts.valueFormat))}</text>`
      )
    })
    .join('')
  return svgWrap(w, h, body, opts.caption)
}

/** 折线图（带面积） */
export function line(data: VizPoint[], opts: VizOptions = {}): string {
  const w = opts.width ?? 360
  const h = opts.height ?? 140
  const padL = 8
  const padR = 8
  const padT = 10
  const padB = opts.caption ? 30 : 20
  const max = opts.max ?? Math.max(1, ...data.map((d) => d.value))
  const min = Math.min(0, ...data.map((d) => d.value))
  const span = max - min || 1
  const innerW = w - padL - padR
  const innerH = h - padT - padB
  const x = (i: number): number => padL + (data.length <= 1 ? innerW / 2 : (i / (data.length - 1)) * innerW)
  const y = (v: number): number => padT + innerH - ((v - min) / span) * innerH
  const pts = data.map((d, i) => `${x(i).toFixed(1)},${y(d.value).toFixed(1)}`).join(' ')
  const area = data.length
    ? `${padL},${padT + innerH} ${pts} ${padL + innerW},${padT + innerH}`
    : ''
  const color = (opts.colors ?? VIZ_COLORS)[0]
  const dots = data
    .map((d, i) => `<circle cx="${x(i)}" cy="${y(d.value)}" r="2.6" fill="${color}" />`)
    .join('')
  const labels = data
    .map((d, i) =>
      i % Math.max(1, Math.ceil(data.length / 6)) === 0
        ? `<text x="${x(i)}" y="${h - (opts.caption ? 18 : 6)}" text-anchor="middle" font-size="9" fill="${opts.muted ?? '#64748B'}">${escapeXml(d.label)}</text>`
        : ''
    )
    .join('')
  const body =
    `<polygon points="${area}" fill="${color}" opacity="0.12" />` +
    `<polyline points="${pts}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" />` +
    dots +
    labels
  return svgWrap(w, h, body, opts.caption)
}

/** 迷你趋势线（列表内联） */
export function sparkline(data: number[], opts: VizOptions = {}): string {
  const w = opts.width ?? 72
  const h = opts.height ?? 24
  const max = Math.max(1, ...data)
  const min = Math.min(0, ...data)
  const span = max - min || 1
  const pts = data
    .map((v, i) => {
      const x = data.length <= 1 ? w / 2 : (i / (data.length - 1)) * w
      const y = h - 2 - ((v - min) / span) * (h - 4)
      return `${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(' ')
  const color = (opts.colors ?? VIZ_COLORS)[0]
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" style="display:block"><polyline points="${pts}" fill="none" stroke="${color}" stroke-width="1.6" stroke-linejoin="round" /></svg>`
}

/** 热力图：matrix[row][col]，row 标签可选 */
export function heatmap(matrix: number[][], opts: VizOptions & { rowLabels?: string[]; colLabels?: string[] } = {}): string {
  const rows = matrix.length
  const cols = Math.max(1, ...matrix.map((r) => r.length))
  const cell = 16
  const gap = 2
  const padL = opts.rowLabels?.length ? 56 : 4
  const padT = opts.colLabels?.length ? 16 : 4
  const w = opts.width ?? padL + cols * (cell + gap) + 4
  const h = opts.height ?? padT + rows * (cell + gap) + 4
  const max = opts.max ?? Math.max(1, ...matrix.flat())
  const base = (opts.colors ?? VIZ_COLORS)[0]
  const cells = matrix
    .map((row, ri) =>
      row
        .map((v, ci) => {
          const x = padL + ci * (cell + gap)
          const y = padT + ri * (cell + gap)
          const op = v <= 0 ? 0.04 : 0.12 + (v / max) * 0.78
          return `<rect x="${x}" y="${y}" width="${cell}" height="${cell}" rx="3" fill="${base}" opacity="${op.toFixed(2)}" />`
        })
        .join('')
    )
    .join('')
  const rowText = (opts.rowLabels ?? [])
    .map(
      (l, i) =>
        `<text x="${padL - 4}" y="${padT + i * (cell + gap) + cell / 2 + 3}" text-anchor="end" font-size="9" fill="${opts.muted ?? '#94A3B8'}">${escapeXml(l)}</text>`
    )
    .join('')
  const colText = (opts.colLabels ?? [])
    .map(
      (l, i) =>
        `<text x="${padL + i * (cell + gap) + cell / 2}" y="${padT - 4}" text-anchor="middle" font-size="9" fill="${opts.muted ?? '#94A3B8'}">${escapeXml(l)}</text>`
    )
    .join('')
  return svgWrap(w, h, `${cells}${rowText}${colText}`, opts.caption)
}

/** 漏斗图：步骤依次收窄 */
export function funnel(steps: VizPoint[], opts: VizOptions = {}): string {
  const w = opts.width ?? 340
  const rowH = 30
  const h = opts.height ?? Math.max(60, steps.length * rowH + 8)
  const max = opts.max ?? Math.max(1, ...steps.map((s) => s.value))
  const body = steps
    .map((s, i) => {
      const ratio = Math.max(0.08, s.value / max)
      const bw = (w - 20) * ratio
      const x = (w - bw) / 2
      const y = 6 + i * rowH
      const color = s.color ?? (opts.colors ?? VIZ_COLORS)[i % (opts.colors ?? VIZ_COLORS).length]
      return (
        `<rect x="${x}" y="${y}" width="${bw}" height="${rowH - 6}" rx="4" fill="${color}" opacity="0.85" />` +
        `<text x="${w / 2}" y="${y + (rowH - 6) / 2 + 3.5}" text-anchor="middle" font-size="10" fill="#0B1220">${escapeXml(s.label)} ${escapeXml(formatValue(s.value, opts.valueFormat))}</text>`
      )
    })
    .join('')
  return svgWrap(w, h, body, opts.caption)
}

export type ChartKind = 'donut' | 'bars' | 'line' | 'spark' | 'heatmap' | 'funnel'

export interface ChartData {
  kind: ChartKind
  points?: VizPoint[]
  matrix?: number[][]
  rowLabels?: string[]
  colLabels?: string[]
}

/** 统一入口：A2UI / 报表 / 交付物都走这里 */
export function renderChart(data: ChartData, opts: VizOptions = {}): string {
  if (data.kind === 'donut') return donut(data.points ?? [], opts)
  if (data.kind === 'bars') return bars(data.points ?? [], opts)
  if (data.kind === 'line') return line(data.points ?? [], opts)
  if (data.kind === 'spark') return sparkline((data.points ?? []).map((p) => p.value), opts)
  if (data.kind === 'heatmap') return heatmap(data.matrix ?? [], { ...opts, rowLabels: data.rowLabels, colLabels: data.colLabels })
  return funnel(data.points ?? [], opts)
}
