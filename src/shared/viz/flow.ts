/**
 * 流程图 / 思维导图的纯数据与 SVG 渲染（无 React 依赖）
 * 用于：应用内 FlowMap / WorkflowView 导出 / 交付物 flow block。
 */
import { escapeXml, VIZ_COLORS } from './svg'

export interface FlowNode {
  id: string
  label: string
  kind?: string
}

export interface FlowEdge {
  from: string
  to: string
  label?: string
}

export interface FlowBlock {
  nodes: FlowNode[]
  edges: FlowEdge[]
  direction?: 'lr' | 'tb'
}

export interface FlowLayout {
  width: number
  height: number
  boxes: Array<{ id: string; label: string; kind?: string; x: number; y: number; w: number; h: number; level: number }>
  links: Array<{ from: string; to: string; label?: string; x1: number; y1: number; x2: number; y2: number }>
}

const NODE_W = 132
const NODE_H = 44
const GAP_X = 56
const GAP_Y = 26
const PAD = 16

/** 分层布局：按入度做 BFS 分层，同层纵向排列 */
export function layoutFlow(block: FlowBlock): FlowLayout {
  const nodes = block.nodes ?? []
  const edges = (block.edges ?? []).filter(
    (e) => nodes.some((n) => n.id === e.from) && nodes.some((n) => n.id === e.to)
  )
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const incoming = new Map<string, number>()
  for (const n of nodes) incoming.set(n.id, 0)
  for (const e of edges) incoming.set(e.to, (incoming.get(e.to) ?? 0) + 1)

  const levelOf = new Map<string, number>()
  const roots = nodes.filter((n) => (incoming.get(n.id) ?? 0) === 0)
  const queue: string[] = (roots.length ? roots : nodes.slice(0, 1)).map((n) => n.id)
  for (const id of queue) levelOf.set(id, 0)
  const guard = new Set<string>()
  while (queue.length) {
    const id = queue.shift()!
    if (guard.has(id)) continue
    guard.add(id)
    const lv = levelOf.get(id) ?? 0
    for (const e of edges.filter((x) => x.from === id)) {
      const next = Math.max(levelOf.get(e.to) ?? 0, lv + 1)
      levelOf.set(e.to, next)
      queue.push(e.to)
    }
  }
  // 环形/未覆盖节点兜底
  let maxLevel = 0
  for (const n of nodes) {
    if (!levelOf.has(n.id)) levelOf.set(n.id, 0)
    maxLevel = Math.max(maxLevel, levelOf.get(n.id) ?? 0)
  }

  const columns: string[][] = Array.from({ length: maxLevel + 1 }, () => [])
  for (const n of nodes) columns[levelOf.get(n.id) ?? 0].push(n.id)
  const maxRows = Math.max(1, ...columns.map((c) => c.length))
  const width = PAD * 2 + (maxLevel + 1) * NODE_W + maxLevel * GAP_X
  const height = PAD * 2 + maxRows * NODE_H + (maxRows - 1) * GAP_Y

  const boxes = nodes.map((n) => {
    const lv = levelOf.get(n.id) ?? 0
    const col = columns[lv]
    const index = col.indexOf(n.id)
    const colH = col.length * NODE_H + (col.length - 1) * GAP_Y
    const y = PAD + (height - PAD * 2 - colH) / 2 + index * (NODE_H + GAP_Y)
    const x = PAD + lv * (NODE_W + GAP_X)
    return { id: n.id, label: n.label, kind: n.kind, x, y, w: NODE_W, h: NODE_H, level: lv }
  })
  const boxMap = new Map(boxes.map((b) => [b.id, b]))
  const links = edges
    .map((e) => {
      const a = boxMap.get(e.from)
      const b = boxMap.get(e.to)
      if (!a || !b) return null
      return { from: e.from, to: e.to, label: e.label, x1: a.x + a.w, y1: a.y + a.h / 2, x2: b.x, y2: b.y + b.h / 2 }
    })
    .filter((x): x is NonNullable<typeof x> => !!x)

  return { width, height, boxes, links }
}

/** SVG 流程图：圆角节点 + 折线箭头 + 可选边标签 */
export function renderFlow(block: FlowBlock, opts: { colors?: string[]; fg?: string; muted?: string } = {}): string {
  const layout = layoutFlow(block)
  const colors = opts.colors ?? VIZ_COLORS
  const kindColor = (kind?: string): string => {
    if (kind === 'trigger') return colors[3]
    if (kind === 'action') return colors[0]
    if (kind === 'decision') return colors[4]
    if (kind === 'end') return colors[7]
    return colors[1]
  }
  const defs =
    `<defs><marker id="wf-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">` +
    `<path d="M 0 0 L 10 5 L 0 10 z" fill="${opts.muted ?? '#64748B'}" /></marker></defs>`
  const links = layout.links
    .map((l) => {
      const mx = (l.x1 + l.x2) / 2
      const path = `M ${l.x1} ${l.y1} C ${mx} ${l.y1}, ${mx} ${l.y2}, ${l.x2} ${l.y2}`
      const label = l.label
        ? `<text x="${mx}" y="${(l.y1 + l.y2) / 2 - 5}" text-anchor="middle" font-size="9" fill="${opts.muted ?? '#64748B'}">${escapeXml(l.label)}</text>`
        : ''
      return `<path d="${path}" fill="none" stroke="${opts.muted ?? '#64748B'}" stroke-width="1.4" marker-end="url(#wf-arrow)" opacity="0.8" />${label}`
    })
    .join('')
  const boxes = layout.boxes
    .map((b) => {
      const color = kindColor(b.kind)
      return (
        `<rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" rx="9" fill="${color}" fill-opacity="0.12" stroke="${color}" stroke-opacity="0.75" />` +
        `<text x="${b.x + b.w / 2}" y="${b.y + b.h / 2 + 4}" text-anchor="middle" font-size="11" fill="${opts.fg ?? '#E2E8F0'}">${escapeXml(b.label.slice(0, 18))}</text>`
      )
    })
    .join('')
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${layout.width} ${layout.height}" width="100%" style="width:100%;height:auto;display:block">` +
    `${defs}${links}${boxes}</svg>`
  )
}

/** 任意 scene（节点+连线）→ 标准 FlowBlock */
export function toFlowBlock(
  nodes: Array<{ id: string; label?: string; title?: string; type?: string }>,
  edges: Array<{ from?: string; source?: string; to?: string; target?: string; label?: string }>
): FlowBlock {
  return {
    nodes: nodes.map((n) => ({ id: n.id, label: n.label ?? n.title ?? n.id, kind: n.type })),
    edges: edges
      .map((e) => ({
        from: String(e.from ?? e.source ?? ''),
        to: String(e.to ?? e.target ?? ''),
        label: e.label
      }))
      .filter((e) => e.from && e.to)
  }
}
