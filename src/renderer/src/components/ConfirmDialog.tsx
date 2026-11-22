import { useEffect, useRef, type ReactNode } from 'react'
import { Icon } from './Icon'

interface ConfirmDialogProps {
  open: boolean
  title: string
  message?: ReactNode
  confirmLabel?: string
  cancelLabel?: string
  danger?: boolean
  /** 危险操作影响范围说明（v7：诊断信息块，红字等宽） */
  impactNote?: ReactNode
  /** 额外安全动作（如「先导出备份」），显示在取消按钮左侧 */
  extraAction?: { label: string; onClick: () => void }
  onConfirm: () => void
  onCancel: () => void
}

/** 统一风格确认弹窗（暗色玻璃，与全局一致；替代原生 window.confirm） */
export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = '确定',
  cancelLabel = '取消',
  danger,
  impactNote,
  extraAction,
  onConfirm,
  onCancel
}: ConfirmDialogProps) {
  const panelRef = useRef<HTMLDivElement | null>(null)
  const cancelRef = useRef<HTMLButtonElement | null>(null)
  const confirmRef = useRef<HTMLButtonElement | null>(null)
  const lastFocus = useRef<HTMLElement | null>(null)

  // 打开时锁滚动 + 初始焦点：危险操作落「取消」，普通确认落「确定」
  useEffect(() => {
    if (!open) return
    lastFocus.current = document.activeElement as HTMLElement | null
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const t = window.setTimeout(() => (danger ? cancelRef : confirmRef).current?.focus(), 0)
    return () => {
      window.clearTimeout(t)
      document.body.style.overflow = prevOverflow
      lastFocus.current?.focus?.()
    }
  }, [open, danger])

  // Esc 关闭 + Tab 焦点陷阱；回车交给当前聚焦按钮的原生行为，避免误确认/重复触发
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onCancel()
        return
      }
      if (e.key !== 'Tab' || !panelRef.current) return
      const items = Array.from(
        panelRef.current.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        )
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
    return () => window.removeEventListener('keydown', onKey, true)
  }, [open, onCancel])

  if (!open) return null
  return (
    <div
      className="anim-fade-in fixed inset-0 z-[90] flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={onCancel}
    >
      <div
        ref={panelRef}
        className="glass-card anim-scale-in w-[340px] !p-5"
        style={{ borderRadius: 'var(--r-xl)', boxShadow: 'var(--shadow-lg)' }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="wo-confirm-title"
      >
        <div className="flex items-center gap-2.5">
          <span
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border"
            style={{
              background: danger ? 'rgba(239,68,68,0.12)' : 'var(--accent-softer)',
              borderColor: danger ? 'rgba(239,68,68,0.3)' : 'var(--border-active)',
              color: danger ? '#f87171' : 'var(--accent)'
            }}
          >
            <Icon name="alert" size={15} />
          </span>
          <h3 id="wo-confirm-title" className="text-base font-semibold leading-tight text-slate-100">{title}</h3>
        </div>
        {message ? (
          <div className="mt-2.5 pl-[42px] text-xs leading-relaxed text-slate-400">{message}</div>
        ) : null}
        {impactNote ? (
          <div
            className="mt-2.5 ml-[42px] rounded-lg px-2.5 py-2 font-mono text-2xs leading-relaxed"
            style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)', color: '#fca5a5' }}
          >
            {impactNote}
          </div>
        ) : null}
        <div className="confirm-actions mt-4 flex items-center justify-end gap-2 pl-[42px]">
          {extraAction ? (
            <button type="button" className="glass-btn mr-auto" onClick={extraAction.onClick}>
              {extraAction.label}
            </button>
          ) : null}
          <button ref={cancelRef} type="button" className="glass-btn min-w-[72px]" onClick={onCancel}>
            {cancelLabel}
          </button>
          <button
            ref={confirmRef}
            type="button"
            className={`glass-btn min-w-[72px] ${danger ? 'danger' : 'primary'}`}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
