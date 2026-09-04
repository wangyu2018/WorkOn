interface SparklineProps {
  data: number[]
  color?: string
  width?: number
  height?: number
}

/** 迷你趋势线（v6 KPI 卡右上角）：纯 SVG，无依赖 */
export function Sparkline({ data, color = 'var(--teal)', width = 64, height = 30 }: SparklineProps) {
  if (data.length < 2) return null
  const min = Math.min(...data)
  const max = Math.max(...data)
  const range = max - min || 1
  const pad = 3
  const step = (width - pad * 2) / (data.length - 1)
  const pt = (v: number, i: number): [number, number] => [
    pad + i * step,
    pad + (1 - (v - min) / range) * (height - pad * 2)
  ]
  const d = data.map((v, i) => pt(v, i)).map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ')
  const [lx, ly] = pt(data[data.length - 1], data.length - 1)
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="shrink-0 opacity-90">
      <path d={d} fill="none" stroke={color} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={lx} cy={ly} r="2.6" fill={color} />
    </svg>
  )
}
