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

const TONE_BG: Record<string, string> = {
  teal: 'bg-[var(--teal-soft)] text-[var(--teal-deep)]',
  red: 'bg-[rgba(239,68,68,0.1)] text-[#f87171]',
  ai: 'bg-[rgba(139,92,246,0.1)] text-[var(--violet)]',
  cyan: 'bg-[rgba(6,182,212,0.1)] text-[var(--cyan)]',
  amber: 'bg-[rgba(245,158,11,0.1)] text-[#fbbf24]'
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
      className={`glass-card hoverable relative overflow-hidden !p-4${onClick ? ' cursor-pointer' : ''}`}
      onClick={onClick}
    >
      {highlight ? (
        <span className="pointer-events-none absolute -top-4 right-3 select-none text-[52px] leading-none opacity-10">✦</span>
      ) : null}
      <div className="flex items-center gap-2">
        <span className={`flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-[9px] ${TONE_BG[tone]}`}>
          {icon}
        </span>
        <span className="text-[10px] font-bold tracking-wide text-slate-500">{label}</span>
        {spark ? <span className="ml-auto">{<Sparkline data={spark} />}</span> : null}
      </div>
      <div className="mt-1.5 flex items-baseline gap-1 text-[26px] font-extrabold leading-tight text-slate-100">
        {big}
      </div>
      {trend ? (
        <span
          className={`mt-2 inline-flex items-center gap-1 rounded-lg px-2 py-0.5 text-[10.5px] font-extrabold ${
            trend.dir === 'up'
              ? 'bg-[var(--teal-soft)] text-[var(--teal-deep)]'
              : 'bg-[rgba(239,68,68,0.1)] text-[#f87171]'
          }`}
        >
          {trend.dir === 'up' ? '▲' : '▼'} {trend.text}
        </span>
      ) : null}
      {detail ? (
        <div className="mt-2 rounded-lg border px-2 py-1.5" style={{ borderColor: 'var(--line)', background: 'var(--surface-2)' }}>
          <div className="text-[10px] font-bold text-slate-400">{detail.title}</div>
          <div className="mt-1 flex flex-col gap-0.5">
            {detail.items.map((it, i) => (
              <div key={i} className="flex justify-between text-[10.5px] text-slate-400">
                <span>{it.label}</span>
                <span className="tabular-nums">{it.value}</span>
              </div>
            ))}
          </div>
        </div>
      ) : null}
      {base ? (
        <div className="mt-2.5 border-t border-dashed border-[var(--line)] pt-2 text-[9.5px] leading-relaxed text-slate-500">
          {base}
        </div>
      ) : null}
    </div>
  )
}
