interface ToggleProps {
  checked: boolean
  onChange: (v: boolean) => void
  disabled?: boolean
}

/** 开关（Aura 风：开启态 aura 渐变 + 辉光，旋钮弹性回弹） */
export function Toggle({ checked, onChange, disabled }: ToggleProps) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="relative h-5 w-9 shrink-0 rounded-full disabled:opacity-40"
      style={{
        background: checked ? 'var(--aura)' : 'var(--surface-3)',
        boxShadow: checked ? '0 0 10px rgba(99, 102, 241, 0.35)' : 'inset 0 1px 2px rgba(0, 0, 0, 0.2)',
        transition: 'background 150ms ease-out, box-shadow 150ms ease-out'
      }}
    >
      <span
        className="absolute top-0.5 h-4 w-4 rounded-full bg-white"
        style={{
          left: checked ? 18 : 2,
          boxShadow: '0 1px 3px rgba(0, 0, 0, 0.35)',
          transition: 'left 200ms var(--ease-spring)'
        }}
      />
    </button>
  )
}
