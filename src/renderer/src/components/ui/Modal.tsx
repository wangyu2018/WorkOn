import { useEffect, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from '../Icon'

/**
 * 蒙层 + 焦点陷阱 + Esc 关闭 + 焦点归还 + 滚动锁。
 * 全站弹层的唯一入口：要么用 Modal（带标题/底栏），要么用 ModalShell（自定义面板）。
 */
export function ModalShell({
  open,
  onClose,
  children,
  labelledBy,
  bare
}: {
  open: boolean
  onClose: () => void
  children: ReactNode
  labelledBy?: string
  /** bare：面板自带背景/圆角（不套默认容器） */
  bare?: boolean
}) {
  const panelRef = useRef<HTMLDivElement | null>(null)
  const lastFocus = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (!open) return
    lastFocus.current = document.activeElement as HTMLElement | null
    const panel = panelRef.current
    // 焦点落在面板本身（不落在第一个按钮上，避免一打开就出现焦点框）
    panel?.focus()

    // 打开期间锁滚动，避免背景跟着滚
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
        return
      }
      if (e.key !== 'Tab' || !panel) return
      const items = Array.from(
        panel.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')
      ).filter((el) => !el.hasAttribute('disabled'))
      if (items.length === 0) return
      const head = items[0]
      const tail = items[items.length - 1]
      if (!e.shiftKey && document.activeElement === tail) {
        e.preventDefault()
        head.focus()
      } else if (e.shiftKey && document.activeElement === head) {
        e.preventDefault()
        tail.focus()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      document.body.style.overflow = prevOverflow
      lastFocus.current?.focus?.()
    }
  }, [open, onClose])

  if (!open) return null

  return createPortal(
    <div
      className="anim-fade-in fixed inset-0 z-[95] flex items-center justify-center p-6"
      style={{ background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(4px)' }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
      role="presentation"
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        tabIndex={-1}
        className={bare ? 'max-h-[88vh] outline-none' : 'max-h-[88vh] w-full outline-none'}
        style={bare ? undefined : { maxWidth: 520 }}
      >
        {children}
      </div>
    </div>,
    document.body
  )
}

interface ModalProps {
  open: boolean
  title?: ReactNode
  /** 说明/正文 */
  children?: ReactNode
  /** 底部操作区（按钮） */
  footer?: ReactNode
  /** 宽度档：sm 360 / md 480 / lg 720 */
  size?: 'sm' | 'md' | 'lg'
  onClose: () => void
}

const SIZES = { sm: 360, md: 480, lg: 720 } as const

/** 标准弹层：标题 + 正文 + 底栏（统一由 ModalShell 提供 Esc/焦点/滚动锁） */
export function Modal({ open, title, children, footer, size = 'md', onClose }: ModalProps) {
  return (
    <ModalShell open={open} onClose={onClose} labelledBy="wo-modal-title">
      <div
        className="anim-scale-in flex max-h-[86vh] w-full flex-col overflow-hidden"
        style={{
          maxWidth: SIZES[size],
          background: 'var(--bg-deep)',
          borderRadius: 'var(--r-lg)',
          boxShadow: 'var(--shadow-lg)'
        }}
      >
        <div className="flex items-start gap-3 px-6 pb-2 pt-5">
          <div id="wo-modal-title" className="min-w-0 flex-1 text-lg font-semibold tracking-tight text-slate-100">
            {title}
          </div>
          <button type="button" className="ui-icon-btn -mr-2 -mt-1" onClick={onClose} aria-label="关闭">
            <Icon name="x" size={15} />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-3 text-sm leading-relaxed text-slate-300">
          {children}
        </div>
        {footer ? (
          <div className="flex items-center justify-end gap-2 px-6 pb-5 pt-3">{footer}</div>
        ) : null}
      </div>
    </ModalShell>
  )
}
