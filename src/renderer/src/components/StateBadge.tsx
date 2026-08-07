import type { WorkState } from '@shared/types'
import { WORK_STATES } from '@shared/stateMeta'

interface StateBadgeProps {
  state: WorkState
  size?: 'sm' | 'md' | 'lg'
  /** 是否显示呼吸脉冲点（实时状态用） */
  pulse?: boolean
}

/** 工作状态徽章：色点 + emoji + 标签 */
export function StateBadge({ state, size = 'md', pulse = false }: StateBadgeProps) {
  const meta = WORK_STATES[state]
  const emojiSize = size === 'lg' ? 'text-xl' : size === 'sm' ? 'text-xs' : 'text-sm'
  const labelSize = size === 'lg' ? 'text-base font-semibold' : size === 'sm' ? 'text-[11px]' : 'text-[13px]'
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        className={`inline-block h-2 w-2 rounded-full ${pulse ? 'pulse-dot' : ''}`}
        style={{ background: meta.color, boxShadow: `0 0 8px ${meta.color}` }}
      />
      <span className={emojiSize}>{meta.emoji}</span>
      <span className={`${labelSize} text-slate-200`}>{meta.label}</span>
    </span>
  )
}
