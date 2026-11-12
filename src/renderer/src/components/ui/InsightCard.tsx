import type { ReactNode } from 'react'
import { Sparkline } from './Sparkline'

interface InsightDetail {
  title: string
  items: { label: string; value: string }[]
}

interface InsightCardProps {
  /** 展开的明细面板（跳转定位时显示数据依据） */
  detail?: InsightDetail
  /** 图标元素（彩色芯片内） */
  icon: ReactNode
  /** 芯片配色：teal / red / ai(紫) / cyan */
  tone?: 'teal' | 'red' | 'ai' | 'cyan' | 'amber'
  label: string
  /** 主数字（如 2h45m 中的 "2h45m"） */
  big: ReactNode
  /** 趋势徽章 */
  trend?: { dir: 'up' | 'down'; text: string; good?: boolean }
  /** 基线/来源说明（虚线分隔行） */
  base?: ReactNode
  /** 趋势数据（右上角 sparkline） */
  spark?: number[]
  highlight?: boolean
  onClick?: () => void
}

/** 图标芯片统一中性灰；红色仅用于「摸鱼/分心」这类负向指标，避免彩色方块堆满一屏 */
const TONE_BG: Record<string, string> = {
  teal: 'bg-[var(--surface-3)] text-slate-400',
  red: 'bg-[rgba(239,68,68,0.1)] text-red-400',
  ai: 'bg-[rgba(139,92,246,0.1)] text-[var(--violet)]',
  cyan: 'bg-[var(--surface-3)] text-slate-400',
  amber: 'bg-[var(--surface-3)] text-slate-400'
}

/** KPI 洞察卡（v6 .card.ins）：图标芯片 + 大数字 + 趋势徽章 + sparkline + 基线行 */
export function InsightCard({
  icon,
  tone = 'teal',
  label,
  big,
  trend,
  base,
  spark,
  highlight,
  detail,
  onClick
}: InsightCardProps) {
  return (
    <div
      className={`glass-card hoverable relative flex h-full flex-col overflow-hidden !p-3.5${onClick ? ' cursor-pointer' : ''}`}
      onClick={onClick}
    >
      <div className="flex items-center gap-2">
        <span className={`flex h-[24px] w-[24px] shrink-0 items-center justify-center rounded-md ${TONE_BG[tone]}`}>
          {icon}
        </span>
        <span className="truncate text-xs font-medium text-slate-500">{label}</span>
        {spark ? <span className="ml-auto shrink-0 opacity-60">{<Sparkline data={spark} />}</span> : null}
      </div>
      <div className="mt-2 flex items-baseline gap-1.5 text-2xl font-semibold leading-none tracking-tight text-slate-100">
        {big}
      </div>
      {trend ? (
        <span
          className={`mt-1.5 self-start text-2xs ${
            trend.good === false ? 'text-red-500/90' : 'text-slate-500'
          }`}
        >
          {trend.dir === 'up' ? '↑' : '↓'} {trend.text}
        </span>
      ) : null}
      {detail ? (
        <div className="mt-2 rounded-lg border px-2 py-1.5" style={{ borderColor: 'var(--line)', background: 'var(--surface-2)' }}>
          <div className="text-2xs font-bold text-slate-400">{detail.title}</div>
          <div className="mt-1 flex flex-col gap-0.5">
            {detail.items.map((it, i) => (
              <div key={i} className="flex justify-between text-2xs text-slate-400">
                <span>{it.label}</span>
                <span className="tabular-nums">{it.value}</span>
              </div>
            ))}
          </div>
        </div>
      ) : null}
      {base ? (
        <div className="mt-2 truncate text-2xs text-slate-500" title={typeof base === 'string' ? base : undefined}>
          {base}
        </div>
      ) : null}
    </div>
  )
}
