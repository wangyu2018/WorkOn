/**
 * AI 助手监控条：状态点 + 完成闪烁（悬浮窗 / 待办共用）
 */
import type { AiAssistItem } from '@shared/aiAssistWatch'

function Dot({ status }: { status: AiAssistItem['status'] }) {
  if (status === 'done') {
    return (
      <span
        className="ai-assist-dot-done inline-block h-1.5 w-1.5 shrink-0 rounded-full"
        style={{ background: '#34D399' }}
        title="刚处理完"
      />
    )
  }
  if (status === 'busy') {
    return (
      <span
        className="pulse-dot inline-block h-1.5 w-1.5 shrink-0 rounded-full"
        style={{ background: '#FBBF24' }}
        title="后台处理中"
      />
    )
  }
  if (status === 'idle') {
    return (
      <span
        className="inline-block h-1.5 w-1.5 shrink-0 rounded-full"
        style={{ background: 'rgba(148,163,184,0.55)' }}
        title="在线空闲"
      />
    )
  }
  return (
    <span
      className="inline-block h-1.5 w-1.5 shrink-0 rounded-full"
      style={{ background: 'rgba(71,85,105,0.5)' }}
      title="未运行"
    />
  )
}

export function AiAssistStrip({
  items,
  compact
}: {
  items: AiAssistItem[]
  compact?: boolean
}) {
  if (!items.length) return null
  const flash = items.some((i) => i.status === 'done')
  return (
    <div
      className={`flex flex-wrap items-center gap-x-2 gap-y-1 ${compact ? 'px-1' : 'mx-3 mb-2 rounded-lg border border-[var(--line)] bg-white/[0.02] px-2.5 py-1.5'}`}
      title="AI 助手监控 · 在设置里拖入/拖出名单"
    >
      {!compact ? (
        <span className="text-2xs uppercase tracking-wider text-slate-600">AI 助手</span>
      ) : null}
      {items.map((it) => (
        <span
          key={it.key}
          className={`inline-flex max-w-[9rem] items-center gap-1 text-xs ${
            it.status === 'done' ? 'text-emerald-300' : it.status === 'busy' ? 'text-amber-200' : 'text-slate-400'
          }`}
          title={it.title || it.label}
        >
          <Dot status={it.status} />
          <span className="truncate">{it.label}</span>
        </span>
      ))}
      {flash ? <span className="text-2xs text-emerald-500/80">有完成</span> : null}
    </div>
  )
}


/* ── AI 助手状态环（悬浮窗用）：内圈=工具，外圈=状态 ──
   处理中=绿色呼吸 / 刚停止=红色常亮 / 空闲=灰 */
const RING_EMOJI: Record<string, string> = {
  cursor: '🔭', claude: ' claude', chatgpt: ' 💬', windsurf: ' 🏄', trae: ' 🚀',
  zcode: 'Z', codex: '⚙', cline: '🔗', codebuddy: ' buddy', opencode: ' open',
  qoder: ' ❓', gemini: ' ✨', kimi: ' 🌙', aider: ' aider'
}

export function AiAssistRing({ item, size = 32 }: { item: AiAssistItem; size?: number }) {
  const emoji = RING_EMOJI[item.key] ?? item.label.slice(0, 1).toUpperCase()
  const busy = item.status === 'busy'
  const justDone = item.status === 'done'
  const idle = item.status === 'idle' || item.status === 'off'
  const R = size / 2 - 2
  const CIRC = 2 * Math.PI * R
  // 外环弧长比例：busy=100%（满圈呼吸）、done=满圈红色常亮、idle=灰色 25%
  const arcPct = busy ? 1 : justDone ? 1 : 0.25
  const ringColor = busy ? '#10B981' : justDone ? '#EF4444' : 'var(--line-strong)'
  const stroke = busy ? 3 : 2
  return (
    <div className="group/ring relative flex flex-col items-center" title={`${item.label} · ${busy ? '处理中' : justDone ? '刚完成' : '空闲'}`}>
      <div className="relative" style={{ width: size, height: size }}>
        {/* 外环：SVG 状态弧 */}
        <svg width={size} height={size} className="-rotate-90">
          <circle cx={size/2} cy={size/2} r={R} fill="none" stroke="var(--line)" strokeWidth={stroke - 0.5} />
          {(busy || justDone) && (
            <circle
              cx={size/2} cy={size/2} r={R} fill="none"
              stroke={ringColor} strokeWidth={stroke} strokeLinecap="round"
              strokeDasharray={CIRC} strokeDashoffset={CIRC * (1 - arcPct)}
              className={busy ? 'ring-breathe-green' : ''}
            />
          )}
        </svg>
        {/* 内圈：工具标识 */}
        <span
          className="absolute inset-0 flex items-center justify-center text-2xs font-bold"
          style={{ color: busy ? '#10B981' : justDone ? '#EF4444' : 'var(--text-3)' }}
        >{emoji}</span>
      </div>
      {/* hover 卡 */}
      <div
        className="pointer-events-none absolute bottom-full left-1/2 z-40 mb-2 hidden w-40 -translate-x-1/2 rounded-xl border border-[var(--line)] p-2 text-left group-hover/ring:block"
        style={{ background: 'var(--bg-surface)', boxShadow: 'var(--shadow-md)' }}
      >
        <b className="text-xs text-slate-100">{item.label}</b>
        <div className="mt-0.5 text-2xs text-slate-500">{busy ? '处理中' : justDone ? '刚完成' : '空闲'}</div>
      </div>
    </div>
  )
}

/* 状态环呼吸动效（一次注入） */
if (typeof document !== 'undefined' && !document.getElementById('ring-breathe-style')) {
  const el = document.createElement('style')
  el.id = 'ring-breathe-style'
  el.textContent = `
    .ring-breathe-green { animation: ring-breathe 1.6s ease-in-out infinite; }
    @keyframes ring-breathe {
      0%, 100% { box-shadow: 0 0 0 0 rgba(16,185,129,0.45); }
      50% { box-shadow: 0 0 0 5px rgba(16,185,129,0); }
    }
  `
  document.head.appendChild(el)
}
