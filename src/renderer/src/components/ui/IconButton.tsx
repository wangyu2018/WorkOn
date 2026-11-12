import type { ButtonHTMLAttributes } from 'react'
import { Icon, type IconName } from '../Icon'

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: IconName
  /** 必填：无文字按钮必须有可读名（屏幕阅读器 + tooltip） */
  label: string
  size?: number
  /** 选中态（切换类按钮） */
  active?: boolean
  danger?: boolean
}

/** 统一图标按钮：28×28 最小点击区 + aria-label + 键盘焦点环（走全局 :focus-visible） */
export function IconButton({
  icon,
  label,
  size = 15,
  active,
  danger,
  className = '',
  ...rest
}: IconButtonProps) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      className={`ui-icon-btn ${danger ? 'hover:!bg-red-500/10 hover:!text-red-400' : ''} ${className}`}
      {...rest}
    >
      <Icon name={icon} size={size} />
    </button>
  )
}
