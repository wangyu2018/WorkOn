import { useEffect, type ReactNode } from 'react'
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
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel()
      if (e.key === 'Enter') onConfirm()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onCancel, onConfirm])

  if (!open) return null
  return (
    <div
      className="anim-fade-in fixed inset-0 z-[90] flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={onCancel}
    >
      <div
        className="glass-card anim-scale-in w-[340px] !p-5"
        style={{ borderRadius: 'var(--r-xl)', boxShadow: 'var(--shadow-lg)' }}
        onClick={(e) => e.stopPropagation()}
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
          <h3 className="text-[14px] font-semibold leading-tight text-slate-100">{title}</h3>
        </div>
        {message ? (
          <div className="mt-2.5 pl-[42px] text-[12px] leading-relaxed text-slate-400">{message}</div>
        ) : null}
        {impactNote ? (
          <div
            className="mt-2.5 ml-[42px] rounded-lg px-2.5 py-2 font-mono text-[10.5px] leading-relaxed"
            style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)', color: '#fca5a5' }}
          >
            {impactNote}
          </div>
        ) : null}
        <div className="mt-4 flex items-center justify-end gap-2 pl-[42px]">
          {extraAction ? (
            <button className="glass-btn mr-auto" onClick={extraAction.onClick}>
              {extraAction.label}
            </button>
          ) : null}
          <button className="glass-btn" onClick={onCancel}>
            {cancelLabel}
          </button>
          <button className={`glass-btn ${danger ? 'danger' : 'primary'}`} onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
