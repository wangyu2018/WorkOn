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
  mode?: 'anchor' | 'fixed'
  pos?: { x: number; y: number }
  counterpart?: string
  topic?: string
  microActivity?: string | null
  operation?: string | null
}

interface ActivityHoverCardProps {
  a: ActivityInfo
  /** 粘滞模式：卡片可交互（hover 停留不消失，供按钮点击） */
  sticky?: boolean
  onMouseEnter?: () => void
  onMouseLeave?: () => void
  /** 提供时渲染「不再记录该程序」按钮 */
  onExclude?: () => void
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

export function ActivityHoverCard({ a, sticky, onMouseEnter, onMouseLeave, onExclude }: ActivityHoverCardProps) {
  const sense = SENSE_META[senseOf(a.state)]
  return (
    <div
      className={`absolute z-30 rounded-xl px-3 py-2 ${sticky ? '' : 'pointer-events-none'}`}
      style={{
        width: 240,
        background: 'rgba(15, 21, 34, 0.94)',
        border: `1px solid rgb(${sense.rgb}/0.35)`,
        boxShadow: '0 10px 28px rgba(0,0,0,0.45), 0 2px 8px rgba(0,0,0,0.3)',
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
        color: '#e8edf5',
        position: a.mode === 'fixed' ? 'fixed' as const : 'absolute' as const,
        ...(a.mode === 'fixed' && a.pos
          ? {
              left: `${a.pos.x}px`,
              top: `${a.pos.y}px`,
              transform: a.pos.x + 240 + 16 > window.innerWidth
                ? 'translate(calc(-100% - 16px), 16px)'
                : 'translate(16px, 16px)',
            }
          : { left: '50%', top: '-100%', transform: 'translateX(-50%)' }),
      }}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-[12px] font-semibold truncate">{a.app || '活动'}</span>
        <span className="shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium"
          style={{ color: `rgb(${sense.rgb})`, background: `rgb(${sense.rgb}/0.14)` }}>
          {sense.label}
        </span>
      </div>
      <div className="mt-1 text-[11px] leading-snug" style={{ color: '#c3cad8' }}>
        {a.title || '（未命名）'}
      </div>
      {(a.operation || a.microActivity) && (
        <div className="mt-1 flex items-start gap-1 text-[11px] leading-snug">
          <span className="mt-px shrink-0" style={{ color: `rgb(${sense.rgb})` }}>▸</span>
          <span className="min-w-0 flex-1" style={{ color: '#aab3c5' }}>{a.operation || a.microActivity}</span>
          {a.microActivity && !a.operation ? (
            <span className="shrink-0 text-[10px]" style={{ color: '#4d566b' }}>· 推断</span>
          ) : null}
        </div>
      )}
      {(a.counterpart || a.topic) ? (
        <div className="mt-1 text-[11px] leading-snug" style={{ color: '#8a93a6' }}>
          {a.counterpart ? <span>与 <b style={{ color: '#c3cad8' }}>{a.counterpart}</b> 沟通</span> : null}
          {a.topic ? <span>查看：<b style={{ color: '#c3cad8' }}>{a.topic}</b></span> : null}
        </div>
      ) : null}
      <div className="mt-1.5 flex items-center gap-2 text-[10px]" style={{ color: '#8a93a6' }}>
        <span>{a.startText} – {a.endText}</span>
        <span style={{ color: '#4d566b' }}>·</span>
        <span>{a.durationText}</span>
        {a.source && <span className="ml-auto rounded px-1 py-0.5" style={{ background: 'rgba(255,255,255,0.07)', color: '#aab3c5' }}>{a.source}</span>}
      </div>
      {onExclude ? (
        <button
          className="mt-2 flex w-full items-center justify-center gap-1 rounded-lg border border-white/10 py-1 text-[10px] text-slate-400 transition-colors hover:border-red-500/40 hover:bg-red-500/10 hover:text-red-400"
          onClick={(e) => { e.stopPropagation(); onExclude() }}
        >
          ⛔ 不再记录该程序
        </button>
      ) : null}
    </div>
  )
}
