interface SegProps {
  options: { value: string; label: React.ReactNode }[]
  value: string
  onChange: (v: string) => void
  /** 占满整行（v7 设置页三段选择器） */
  full?: boolean
  className?: string
}

/** 分段选择器（v6 .seg）：对标基线 / 识别模式 / 报表粒度等场景统一控件 */
export function Seg({ options, value, onChange, full, className = '' }: SegProps) {
  return (
    <div
      className={`inline-flex gap-0.5 rounded-[10px] bg-[var(--surface-3)] p-[3px] ${full ? 'flex w-full' : ''} ${className}`}
    >
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={`rounded-lg px-3 py-1 text-[10.5px] font-bold transition-all ${
            full ? 'flex-1' : ''
          } ${
            value === o.value
              ? 'bg-[var(--bg-surface)] text-[var(--teal-deep)] shadow-[var(--shadow-sm)]'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}
