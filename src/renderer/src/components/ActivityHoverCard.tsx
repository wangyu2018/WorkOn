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
  aiHint?: { label: string; confidence: number } | null
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
      {a.microActivity && (
        <div className="mt-0.5 text-[10px]" style={{ color: '#94a3b8' }}>
          {a.microActivity} <span style={{ color: '#cbd5e1' }}>· 推断</span>
        </div>
      )}
      {a.aiHint && (
        <div className="mt-0.5 text-[10px]" style={{ color: '#94a3b8' }}>
          AI 疑似：{a.aiHint.label} <span style={{ color: '#cbd5e1' }}>· 低置信 {Math.round(a.aiHint.confidence * 100)}%</span>
        </div>
      )}
      {(a.counterpart || a.topic) ? (
        <div className="mt-1 text-[11px] leading-snug" style={{ color: '#64748b' }}>
          {a.counterpart ? <span>与 <b style={{ color: '#334155' }}>{a.counterpart}</b> 沟通</span> : null}
          {a.topic ? <span>查看：<b style={{ color: '#334155' }}>{a.topic}</b></span> : null}
        </div>
      ) : null}
      <div className="mt-1.5 flex items-center gap-2 text-[10px]" style={{ color: '#64748b' }}>
        <span>{a.startText} – {a.endText}</span>
        <span style={{ color: '#94a3b8' }}>·</span>
        <span>{a.durationText}</span>
        {a.source && <span className="ml-auto rounded px-1 py-0.5" style={{ background: '#f1f5f9', color: '#475569' }}>{a.source}</span>}
      </div>
    </div>
  )
}
