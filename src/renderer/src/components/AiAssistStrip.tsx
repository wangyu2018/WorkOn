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
        <span className="text-[10px] uppercase tracking-wider text-slate-600">AI 助手</span>
      ) : null}
      {items.map((it) => (
        <span
          key={it.key}
          className={`inline-flex max-w-[9rem] items-center gap-1 text-[11px] ${
            it.status === 'done' ? 'text-emerald-300' : it.status === 'busy' ? 'text-amber-200' : 'text-slate-400'
          }`}
          title={it.title || it.label}
        >
          <Dot status={it.status} />
          <span className="truncate">{it.label}</span>
        </span>
      ))}
      {flash ? <span className="text-[10px] text-emerald-500/80">有完成</span> : null}
    </div>
  )
}
