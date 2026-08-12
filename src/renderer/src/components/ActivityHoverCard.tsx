import type { WorkState } from '@shared/types'
import { WORK_LIKE_STATES } from '@shared/stateMeta'

export interface ActivityInfo {
  app?: string
  title: string
  state: WorkState
  startText: string
  endText: string
  durationText: string
  source?: string
}

const SLACK_STATES: WorkState[] = ['slack', 'relax', 'break', 'lunch', 'idle', 'away']

function senseOf(state: WorkState): 'work' | 'slack' | 'other' {
  if (SLACK_STATES.includes(state)) return 'slack'
  if (WORK_LIKE_STATES.includes(state)) return 'work'
  return 'other'
}

const SENSE_META = {
  work:  { label: '办公', rgb: '124 158 255' },
  slack: { label: '摸鱼', rgb: '255 124 124' },
  other: { label: '其他', rgb: '148 163 184' },
} as const

export function ActivityHoverCard({ a }: { a: ActivityInfo }) {
  const sense = SENSE_META[senseOf(a.state)]
  return (
    <div
      className="absolute z-30 rounded-xl px-3 py-2 pointer-events-none shadow-lg"
      style={{
        width: 240,
        background: '#ffffff',
        border: `1px solid rgb(${sense.rgb}/0.55)`,
        boxShadow: '0 4px 18px rgba(15,23,42,0.15)',
        color: '#1e293b',
        left: '50%',
        top: '-100%',
        transform: 'translateX(-50%)',
      }}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-[12px] font-semibold truncate">{a.app || '活动'}</span>
        <span className="shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium"
          style={{ color: `rgb(${sense.rgb})`, background: `rgb(${sense.rgb}/0.12)` }}>
          {sense.label}
        </span>
      </div>
      <div className="mt-1 text-[11px] leading-snug" style={{ color: '#334155' }}>
        {a.title || '（未命名）'}
      </div>
      <div className="mt-1.5 flex items-center gap-2 text-[10px]" style={{ color: '#64748b' }}>
        <span>{a.startText} – {a.endText}</span>
        <span style={{ color: '#94a3b8' }}>·</span>
        <span>{a.durationText}</span>
        {a.source && <span className="ml-auto rounded px-1 py-0.5" style={{ background: '#f1f5f9', color: '#475569' }}>{a.source}</span>}
      </div>
    </div>
  )
}
