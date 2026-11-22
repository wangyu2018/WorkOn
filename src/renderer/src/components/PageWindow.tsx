/**
 * 页面浮窗壳：每个顶部入口都以独立浮窗呈现
 * - macOS：左上角红黄绿（关闭 / 返回 / 最大化）
 * - Windows：左侧返回，右上角最大化 / 关闭
 * - 浮窗默认带边距与圆角，最大化后铺满内容区
 */
import type { PointerEvent, ReactNode } from 'react'
import { Icon } from './Icon'

interface PageWindowProps {
  title: string
  isMac: boolean
  maximized: boolean
  canBack: boolean
  onBack: () => void
  onClose: () => void
  onToggleMax: () => void
  /** 标题栏拖拽（移动浮窗） */
  onHeaderPointerDown?: (e: PointerEvent<HTMLDivElement>) => void
  children: ReactNode
}

/** macOS 风格窗口圆点 */
function MacDot({
  color,
  label,
  onClick
}: {
  color: string
  label: string
  onClick: () => void
}): JSX.Element {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      className="h-3 w-3 rounded-full transition-transform hover:scale-110"
      style={{ background: color, border: '1px solid rgba(0,0,0,0.12)' }}
    />
  )
}

export function PageWindow({
  title,
  isMac,
  maximized,
  canBack,
  onBack,
  onClose,
  onToggleMax,
  onHeaderPointerDown,
  children
}: PageWindowProps): JSX.Element {
  return (
    <section
      className="flex h-full min-h-0 w-full flex-col overflow-hidden"
      style={{
        background: 'var(--bg-deep)',
        borderRadius: maximized ? 0 : 'var(--r-lg)',
        border: maximized ? 'none' : '1px solid var(--line-strong)',
        boxShadow: maximized ? 'none' : 'var(--shadow-lg)'
      }}
    >
      <div
        className="flex h-11 shrink-0 select-none items-center gap-2 px-3"
        style={{
          borderBottom: '1px solid var(--line)',
          background: 'var(--surface-2)',
          cursor: maximized ? 'default' : 'grab',
          touchAction: 'none'
        }}
        onPointerDown={(e) => {
          // 窗口按钮不触发拖拽
          if ((e.target as HTMLElement).closest('button')) return
          onHeaderPointerDown?.(e)
        }}
      >
        {isMac ? (
          <div className="flex shrink-0 items-center gap-2 pr-1">
            <MacDot color="#ff5f57" label="关闭浮窗" onClick={onClose} />
            <MacDot color="#febc2e" label="返回上一页" onClick={canBack ? onBack : onClose} />
            <MacDot color="#28c840" label={maximized ? '还原浮窗' : '放大浮窗'} onClick={onToggleMax} />
          </div>
        ) : canBack ? (
          <button
            type="button"
            className="ui-icon-btn shrink-0"
            style={{ background: 'var(--surface-2)', border: '1px solid var(--line)', color: 'var(--text-2)' }}
            title="返回上一页"
            onClick={onBack}
          >
            <Icon name="chevronLeft" size={14} />
          </button>
        ) : null}
        <span className="min-w-0 flex-1 truncate text-xs font-medium text-[var(--text-2)]">{title}</span>
        {!isMac ? (
          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              className="ui-icon-btn"
              style={{ border: '1px solid var(--line)', color: 'var(--text-2)' }}
              title={maximized ? '还原浮窗' : '放大浮窗'}
              onClick={onToggleMax}
            >
              <Icon name={maximized ? 'minimize' : 'maximize'} size={13} />
            </button>
            <button
              type="button"
              className="ui-icon-btn hover:!bg-red-500 hover:!text-white"
              style={{ border: '1px solid var(--line)', color: 'var(--text-2)' }}
              title="关闭浮窗"
              onClick={onClose}
            >
              <Icon name="x" size={13} />
            </button>
          </div>
        ) : null}
      </div>
      <div className="min-h-0 flex-1 overflow-auto">{children}</div>
    </section>
  )
}
