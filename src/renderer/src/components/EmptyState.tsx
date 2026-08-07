interface EmptyStateProps {
  title: string
  hint?: string
  emoji?: string
}

/** 空态：插画位（emoji 占位）+ 标题 + 建议文案 */
export function EmptyState({ title, hint, emoji = '🗂️' }: EmptyStateProps) {
  return (
    <div className="anim-fade-up flex flex-col items-center justify-center py-12 text-center">
      <div className="mb-3 flex h-16 w-16 items-center justify-center rounded-2xl border border-dashed border-white/10 bg-white/[0.03] text-3xl opacity-70">
        {emoji}
      </div>
      <div className="text-[15px] font-medium text-slate-300">{title}</div>
      {hint ? <div className="mt-1 max-w-[300px] text-xs leading-relaxed text-slate-500">{hint}</div> : null}
    </div>
  )
}
