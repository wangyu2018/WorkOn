import type { ReactNode } from 'react'

interface ProgressRingProps {
  /** 0-100 */
  value: number
  size?: number
  stroke?: number
  color?: string
  trackColor?: string
  children?: ReactNode
}

/** SVG 环形进度（0.5s 缓动） */
export function ProgressRing({
  value,
  size = 80,
  stroke = 6,
  color = '#22D3EE',
  trackColor = 'rgba(255,255,255,0.08)',
  children
}: ProgressRingProps) {
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const pct = Math.max(0, Math.min(100, value))
  return (
    <div className="relative inline-flex shrink-0 items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={trackColor} strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - pct / 100)}
          style={{ transition: 'stroke-dashoffset 500ms ease-out, stroke 250ms ease-out' }}
        />
      </svg>
      {children ? <div className="absolute inset-0 flex items-center justify-center">{children}</div> : null}
    </div>
  )
}
