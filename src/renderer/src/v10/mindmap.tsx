/**
 * 轻量思维导图（v10：信息的再结构化——用户 2026-10-11 拍板的通用能力）
 * 任意回答/长文本 → 层级树 → SVG 横向导图。
 * 解析零 AI 依赖：markdown 标题/列表天然是树；纯散文按句子两级兜底。
 * 风格与 FlowMap 同族（实线、状态色、纸感、圆角标签）。
 */
import { useMemo } from 'react'
import type { JSX } from 'react'

export interface MindNode {
  label: string
  children: MindNode[]
  depth: number
  color: string
}

const DEPTH_COLORS = ['#2B2B28', '#0FB5A4', '#D98E2B', '#7C6FF0']

/** markdown 结构优先，散文兜底（句子两级） */
export function parseMindTree(text: string, rootLabel?: string): MindNode {
  const root: MindNode = { label: rootLabel ?? '回答', children: [], depth: 0, color: DEPTH_COLORS[0] }
  const lines = text.replace(/\r/g, '').split('\n')
  let hasMd = false
  let cur: MindNode | null = null

  for (const line of lines) {
    const t = line.trim()
    if (!t || t.startsWith('```')) continue
    // 标题：# → 分支（一级标题当根标签备选）
    const h = /^(#{1,3})\s+(.*)$/.exec(t)
    if (h) {
      hasMd = true
      const node: MindNode = { label: h[2].slice(0, 24), children: [], depth: 1, color: DEPTH_COLORS[1] }
      root.children.push(node)
      cur = node
      continue
    }
    // 列表 → 当前分支的叶子（无分支则挂根）
    const li = /^[-*•]\s+(.*)$/.exec(t)
    if (li) {
      hasMd = true
      const leaf: MindNode = { label: li[1].replace(/\*\*/g, '').slice(0, 26), children: [], depth: 2, color: DEPTH_COLORS[2] }
      if (cur) cur.children.push(leaf)
      else root.children.push(leaf)
      continue
    }
  }

  if (hasMd && root.children.length) return root

  // 散文兜底：首句为根，其余句子切叶子（逗号/分号再切二级）
  const clean = text.replace(/^本地小结：/, '').replace(/<[!@][^>]*>/g, '')
  const sentences = clean
    .split(/[。！？\n]/)
    .map((x) => x.trim())
    .filter((x) => x.length > 1)
  if (sentences.length === 0) return root
  root.label = sentences[0].slice(0, 16)
  for (const s of sentences.slice(1, 6)) {
    const parts = s.split(/[，,；;：]/).map((x) => x.trim()).filter((x) => x.length > 1)
    if (parts.length > 1) {
      const branch: MindNode = { label: parts[0].slice(0, 20), children: [], depth: 1, color: DEPTH_COLORS[1] }
      for (const p of parts.slice(1, 4)) {
        branch.children.push({ label: p.slice(0, 24), children: [], depth: 2, color: DEPTH_COLORS[2] })
      }
      root.children.push(branch)
    } else {
      root.children.push({ label: s.slice(0, 24), children: [], depth: 1, color: DEPTH_COLORS[1] })
    }
  }
  return root
}

/** 横向树布局：叶子均分行高，父节点 y=子节点中位；返回每节点 (x,y) 与连线 */
function layout(root: MindNode, nodeW: number, gapX: number, rowH: number) {
  const pos = new Map<MindNode, { x: number; y: number }>()
  let leafY = 0
  const maxDepth = { v: 0 }
  function walk(n: MindNode, depth: number): number {
    maxDepth.v = Math.max(maxDepth.v, depth)
    if (!n.children.length) {
      const y = leafY * rowH
      leafY++
      pos.set(n, { x: depth * (nodeW + gapX), y })
      return y
    }
    const ys = n.children.map((c) => walk(c, depth + 1))
    const y = (Math.min(...ys) + Math.max(...ys)) / 2
    pos.set(n, { x: depth * (nodeW + gapX), y })
    return y
  }
  const rootY = walk(root, 0)
  pos.set(root, { x: 0, y: rootY })
  return { pos, height: Math.max(leafY, 1) * rowH, maxDepth: maxDepth.v }
}

export function MindMap(props: { text: string; rootLabel?: string; width?: number }): JSX.Element {
  const W = props.width ?? 820
  const { root, nodes, edges, height, maxDepth } = useMemo(() => {
    const r = parseMindTree(props.text, props.rootLabel)
    const nodeW = [128, 118, 108, 98]
    const l = layout(r, 120, 34, 34)
    const ns: Array<{ n: MindNode; x: number; y: number; w: number }> = []
    const es: Array<{ x1: number; y1: number; x2: number; y2: number; color: string }> = []
    const walk2 = (n: MindNode): void => {
      const p = l.pos.get(n)!
      const w = nodeW[Math.min(n.depth, 3)]
      ns.push({ n, x: p.x, y: p.y, w })
      for (const c of n.children) {
        const cp = l.pos.get(c)!
        es.push({ x1: p.x + w, y1: p.y + 16, x2: cp.x, y2: cp.y + 16, color: c.color })
        walk2(c)
      }
    }
    walk2(r)
    return { root: r, nodes: ns, edges: es, height: Math.max(l.height, 90) + 20, maxDepth: l.maxDepth }
  }, [props.text, props.rootLabel])

  const totalW = Math.max(W, (maxDepth + 1) * 154)

  return (
    <div className="v10-mindmap" style={{ overflowX: 'auto' }}>
      <svg width={totalW} height={height} style={{ display: 'block' }}>
        {edges.map((e, i) => {
          const mx = (e.x1 + e.x2) / 2
          return (
            <path
              key={i}
              d={`M${e.x1},${e.y1} C${mx},${e.y1} ${mx},${e.y2} ${e.x2},${e.y2}`}
              fill="none"
              stroke={e.color}
              strokeWidth="1.5"
              opacity="0.55"
            />
          )
        })}
        {nodes.map(({ n, x, y, w }, i) => (
          <g key={i}>
            <rect
              x={x}
              y={y}
              width={w}
              height={32}
              rx={n.depth === 0 ? 10 : 8}
              fill={n.depth === 0 ? '#2B2B28' : n.depth === 1 ? 'var(--celadon-1)' : '#fff'}
              stroke={n.depth === 0 ? '#2B2B28' : n.color}
              strokeWidth="1.2"
            />
            <text
              x={x + (n.depth === 0 ? 12 : 10)}
              y={y + 20}
              fontSize={n.depth === 0 ? 12 : 10.5}
              fill={n.depth === 0 ? '#F7F4EE' : 'var(--ink)'}
              fontFamily="var(--font-ui)"
              fontWeight={n.depth === 0 ? 600 : 400}
            >
              {n.label.length > Math.floor(w / 10.5) ? `${n.label.slice(0, Math.floor(w / 10.5))}…` : n.label}
            </text>
          </g>
        ))}
      </svg>
    </div>
  )
}
