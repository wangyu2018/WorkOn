/**
 * 空态（v9）：只留一句标题 + 一句说明 + 可选行动。
 * 不再用 emoji 当插画——emoji 在不同系统渲染不一致，会直接破坏极简质感。
 */

interface EmptyStateProps {
  title: string
  hint?: string
  /** 兼容旧调用：不再渲染，仅保留入参 */
  emoji?: string
  tone?: 'teal' | 'violet' | 'amber'
  action?: { label: string; onClick: () => void; ai?: boolean }
}

export function EmptyState({ title, hint, action }: EmptyStateProps) {
  return (
    <div className="flex flex-wrap items-center gap-3 py-5">
      <div className="min-w-0 flex-1">
        <div className="text-sm text-slate-300">{title}</div>
        {hint ? <div className="mt-1 text-xs leading-relaxed text-slate-500">{hint}</div> : null}
      </div>
      {action ? (
        <button
          type="button"
          className={`glass-btn shrink-0 ${action.ai ? 'ai' : 'primary'}`}
          onClick={action.onClick}
        >
          {action.label}
        </button>
      ) : null}
    </div>
  )
}
