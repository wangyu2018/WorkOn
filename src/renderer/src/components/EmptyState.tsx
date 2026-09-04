/**
 * 空态（v7 升级）：emoji 插画圆底（teal/紫/琥珀按 tone）+ 标题 + 一句人味副文案 + 行动按钮
 * 向后兼容：原 title/hint/emoji props 全保留；tone / action 为新增可选
 */

type EmptyTone = 'teal' | 'violet' | 'amber'

interface EmptyStateProps {
  title: string
  hint?: string
  emoji?: string
  /** 插画圆底色调：teal=功能/数据（默认）、violet=AI、amber=提醒 */
  tone?: EmptyTone
  /** 行动按钮（可选）：给空一个明确的下一步；ai=true 用 aura 渐变（AI 专属动作） */
  action?: { label: string; onClick: () => void; ai?: boolean }
}

/** 三色调圆底：teal-soft / 紫 / 琥珀，同色柔光 */
const TONES: Record<EmptyTone, { bg: string; ring: string; glow: string }> = {
  teal: {
    bg: 'var(--teal-soft)',
    ring: 'rgba(15, 181, 164, 0.3)',
    glow: '0 6px 22px rgba(15, 181, 164, 0.14)'
  },
  violet: {
    bg: 'rgba(139, 92, 246, 0.14)',
    ring: 'rgba(139, 92, 246, 0.32)',
    glow: '0 6px 22px rgba(139, 92, 246, 0.16)'
  },
  amber: {
    bg: 'rgba(245, 158, 11, 0.13)',
    ring: 'rgba(245, 158, 11, 0.3)',
    glow: '0 6px 22px rgba(245, 158, 11, 0.13)'
  }
}

/** 调用方没传 hint 时的人味默认副文案（传 hint='' 可显式关闭） */
const DEFAULT_HINT = '空着也是一种开始，做点什么让它热闹起来吧。'

export function EmptyState({ title, hint, emoji = '🗂️', tone = 'teal', action }: EmptyStateProps) {
  const t = TONES[tone]
  return (
    <div className="anim-fade-up flex flex-col items-center justify-center py-12 text-center">
      <div
        className="mb-4 flex h-[72px] w-[72px] items-center justify-center rounded-full text-[32px]"
        style={{ background: t.bg, boxShadow: `inset 0 0 0 1px ${t.ring}, ${t.glow}` }}
      >
        <span className="-translate-y-px select-none">{emoji}</span>
      </div>
      <div className="text-[15px] font-medium text-slate-200">{title}</div>
      <div className="mt-1.5 max-w-[320px] text-xs leading-relaxed text-slate-500">
        {hint === undefined ? DEFAULT_HINT : hint}
      </div>
      {action ? (
        <button
          type="button"
          className={`glass-btn mt-4 px-4 py-1.5 text-[12px] ${action.ai ? 'ai' : 'primary'}`}
          onClick={action.onClick}
        >
          {action.label}
        </button>
      ) : null}
    </div>
  )
}
