/**
 * 状态导图（FlowMap）：思维导图式连线图——实线=实际轨迹，虚线=建议路径
 * 数据全现成：trail 段（实际）→ 今日计划/lifeGoal 锚点（建议）
 * 用户拍板（2026-10-10）：问"当前状态"时回答挂可拆件，点一下落右页
 */
import { useMemo } from 'react'
import type { PlanItem, TrailSegment, GoalView } from '@shared/types'
import { WORK_STATES, STATE_LABEL } from '@shared/stateMeta'
import { displayApp } from '@shared/appDisplayName'

interface FlowNode {
  id: string
  label: string
  sub?: string
  color: string
  kind: 'actual' | 'now' | 'plan' | 'anchor'
  minutes?: number
}

export function FlowMap(props: {
  trail: TrailSegment[]
  plans: PlanItem[]
  goals: GoalView[]
  width?: number
}): JSX.Element {
  const W = props.width ?? 860
  const { nodes, edges } = useMemo(() => {
    const today = new Date()
    const key = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`

    // 实际：最近 5 个有效段
    const segs = props.trail.filter((t) => !t.glance).slice(-5)
    const actual: FlowNode[] = segs.map((t, i) => ({
      id: `a${i}`,
      label: t.mainTitle ? t.mainTitle.slice(0, 12) : displayApp(t.mainApp) || STATE_LABEL[t.mainState],
      sub: `${STATE_LABEL[t.mainState]} · ${Math.round(t.durationMin)}min`,
      color: WORK_STATES[t.mainState]?.color ?? '#64748B',
      kind: 'actual',
      minutes: t.durationMin
    }))

    // 建议 1：今日未完成计划（前 2）
    const pending = props.plans
      .filter((p) => p.date === key && (p.status === 'planned' || p.status === 'in_progress'))
      .sort((a, b) => (a.startMin ?? 1e9) - (b.startMin ?? 1e9))
      .slice(0, 2)
    const planNodes: FlowNode[] = pending.map((p, i) => ({
      id: `p${i}`,
      label: p.title.slice(0, 12),
      sub: '今日计划',
      color: '#0FB5A4',
      kind: 'plan'
    }))

    // 建议 2：最近 goal 的下一个未达成锚点（1 个）
    let anchor: FlowNode | null = null
    const g = props.goals.find((x) => (x.goal?.status ?? 'active') === 'active')
    if (g) {
      const next = (g.goal as { anchors?: Array<{ title: string; targetDate: string; status?: string }> }).anchors?.find(
        (a) => a.status !== 'hit'
      )
      if (next) {
        anchor = {
          id: 'anchor',
          label: next.title.slice(0, 12),
          sub: `锚点 · ${next.targetDate}`,
          color: '#D98E2B',
          kind: 'anchor'
        }
      }
    }

    const nodes = [...actual, ...planNodes, ...(anchor ? [anchor] : [])]
    const edges: Array<{ from: string; to: string; dashed: boolean; label?: string }> = []
    for (let i = 1; i < actual.length; i++) edges.push({ from: actual[i - 1].id, to: actual[i].id, dashed: false })
    const last = actual[actual.length - 1]
    if (last) {
      let prev = last.id
      for (const p of planNodes) {
        edges.push({ from: prev, to: p.id, dashed: true, label: edges.some((e) => !e.dashed) ? undefined : '建议' })
        prev = p.id
      }
      if (anchor) edges.push({ from: prev, to: anchor.id, dashed: true, label: '建议' })
      if (!planNodes.length && !anchor) edges.length = edges.length // only actual
    }
    return { nodes, edges }
  }, [props.trail, props.plans, props.goals])

  if (nodes.length === 0) {
    return <div className="v10-empty">轨迹和计划长出来后，这里会画出你的状态导图。</div>
  }

  const nodeW = 118
  const nodeH = 52
  const gap = 26
  const totalW = Math.max(W, nodes.length * (nodeW + gap))
  const midY = 58
  const rowY = [midY - 34, midY, midY + 40] // actual 中线，plan 上，anchor 下

  const pos = new Map<string, { x: number; y: number }>()
  nodes.forEach((n, i) => {
    if (n.kind === 'actual') pos.set(n.id, { x: 8 + i * (nodeW + gap), y: rowY[1] })
    else if (n.kind === 'plan') pos.set(n.id, { x: 8 + (actualCount(nodes) + planIndex(n)) * (nodeW + gap), y: rowY[0] })
    else pos.set(n.id, { x: 8 + (actualCount(nodes)) * (nodeW + gap), y: rowY[2] })
  })
  function actualCount(ns: FlowNode[]): number {
    return ns.filter((n) => n.kind === 'actual').length
  }
  function planIndex(n: FlowNode): number {
    const plans = nodes.filter((x) => x.kind === 'plan')
    return plans.indexOf(n)
  }

  const H = 150
  return (
    <div className="v10-flowmap" style={{ overflowX: 'auto' }}>
      <svg width={totalW} height={H} style={{ display: 'block' }}>
        <defs>
          <marker id="fm-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto">
            <path d="M0,0 L8,4 L0,8 z" fill="var(--hairline-2)" />
          </marker>
          <marker id="fm-arrow-dash" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto">
            <path d="M0,0 L8,4 L0,8 z" fill="var(--teal)" />
          </marker>
        </defs>
        {/* 图例 */}
        <g fontSize="10" fill="var(--ink-3)" fontFamily="var(--font-ui)">
          <line x1="10" y1="12" x2="38" y2="12" stroke="var(--ink)" strokeWidth="2" />
          <text x="44" y="16">实际</text>
          <line x1="84" y1="12" x2="112" y2="12" stroke="var(--teal)" strokeWidth="1.5" strokeDasharray="4 3" />
          <text x="118" y="16">建议</text>
        </g>
        {/* 边 */}
        {edges.map((e, i) => {
          const a = pos.get(e.from)
          const b = pos.get(e.to)
          if (!a || !b) return null
          const x1 = a.x + nodeW
          const y1 = a.y + nodeH / 2
          const x2 = b.x - 6
          const y2 = b.y + nodeH / 2
          const mx = (x1 + x2) / 2
          return (
            <path
              key={i}
              d={`M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`}
              fill="none"
              stroke={e.dashed ? 'var(--teal)' : 'var(--ink)'}
              strokeWidth={e.dashed ? 1.5 : 2}
              strokeDasharray={e.dashed ? '5 4' : undefined}
              markerEnd={e.dashed ? 'url(#fm-arrow-dash)' : 'url(#fm-arrow)'}
              opacity={e.dashed ? 0.75 : 0.85}
            />
          )
        })}
        {/* 节点 */}
        {nodes.map((n) => {
          const p = pos.get(n.id)
          if (!p) return null
          const isNow = n.kind === 'actual' && n === nodes.filter((x) => x.kind === 'actual').slice(-1)[0]
          return (
            <g key={n.id}>
              <rect
                x={p.x}
                y={p.y}
                width={nodeW}
                height={nodeH}
                rx="10"
                fill={n.kind === 'actual' ? '#fff' : n.kind === 'plan' ? 'var(--celadon-1)' : 'var(--amber-bg)'}
                stroke={n.color}
                strokeWidth={isNow ? 2.5 : 1.5}
                strokeDasharray={n.kind === 'actual' ? undefined : '5 3'}
              />
              {isNow ? (
                <rect x={p.x - 3} y={p.y - 3} width={nodeW + 6} height={nodeH + 6} rx="12" fill="none" stroke="var(--teal)" strokeWidth="1" opacity="0.5" />
              ) : null}
              <circle cx={p.x + 12} cy={p.y + 15} r="4" fill={n.color} />
              <text x={p.x + 22} y={p.y + 19} fontSize="11" fill="var(--ink)" fontFamily="var(--font-ui)">
                {n.label.length > 9 ? `${n.label.slice(0, 9)}…` : n.label}
              </text>
              <text x={p.x + 10} y={p.y + 38} fontSize="9.5" fill="var(--ink-3)" fontFamily="var(--font-ui)">
                {n.sub}
              </text>
            </g>
          )
        })}
      </svg>
    </div>
  )
}
