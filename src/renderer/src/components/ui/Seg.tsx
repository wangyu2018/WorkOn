interface SegProps {
  options: { value: string; label: React.ReactNode }[]
  value: string
  onChange: (v: string) => void
  /** 占满整行（v7 设置页三段选择器） */
  full?: boolean
  className?: string
}

/** 分段选择器：灰胶囊组 + 选中白底（Today 式，无边框） */
export function Seg({ options, value, onChange, full, className = '' }: SegProps) {
  return (
    <div
      className={`inline-flex gap-0.5 rounded-full bg-[var(--surface-2)] p-0.5 ${full ? 'flex w-full' : ''} ${className}`}
      role="tablist"
    >
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="tab"
          aria-selected={value === o.value}
          onClick={() => onChange(o.value)}
          className={`rounded-full px-3 py-1.5 text-sm transition-colors ${full ? 'flex-1' : ''} ${
            value === o.value
              ? 'bg-[var(--bg-deep)] font-medium text-[var(--text-1)] shadow-[var(--shadow-md)]'
              : 'text-slate-500 hover:text-slate-200'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}
