import { WEEK_LABELS, fmtMin } from './utils'

interface DaySummary {
  key: string
  work: number
  slack: number
  other: number
}

export default function DailyOverviewCard({ days, maxTotal }: { days: DaySummary[], maxTotal: number }) {
  const BAR_H = 160
  const today = new Date().toISOString().slice(0, 10)
  return (
    <div className="glass-card hoverable">
      <div className="flex items-end justify-around gap-3 px-1">
        {days.map((d) => {
          const dt = new Date(`${d.key}T00:00:00`)
          const total = d.work + d.slack + d.other
          const scale = (v: number) => (v / maxTotal) * BAR_H
          const isToday = d.key === today
          return (
            <div
              key={d.key}
              className="group flex flex-1 cursor-default flex-col items-center gap-1.5 transition-transform hover:-translate-y-0.5"
              title={`工作 ${fmtMin(d.work)} · 摸鱼 ${fmtMin(d.slack)} · 其他 ${fmtMin(d.other)}`}
            >
              <div className={`text-[10px] ${isToday ? 'font-medium text-neon-cyan' : 'text-slate-500'}`}>{total > 0 ? fmtMin(total) : ''}</div>
              <div
                className={`flex w-full max-w-[44px] flex-col-reverse overflow-hidden rounded-lg border border-white/[0.04] transition-shadow group-hover:shadow-[0_0_14px_rgba(34,211,238,0.15)] ${
                  isToday ? 'ring-1 ring-neon-cyan' : ''
                }`}
                style={{ height: BAR_H, background: 'rgba(255,255,255,0.03)' }}
              >
                <div className="w-full bg-neon-green/80 transition-all" style={{ height: scale(d.work), transitionDuration: '250ms' }} />
                <div className="w-full bg-neon-pink/80 transition-all" style={{ height: scale(d.slack), transitionDuration: '250ms' }} />
                <div className="w-full bg-slate-500/60 transition-all" style={{ height: scale(d.other), transitionDuration: '250ms' }} />
              </div>
              <div className={`text-[10px] ${isToday ? 'font-semibold text-neon-cyan' : 'text-slate-500'}`}>
                周{WEEK_LABELS[(dt.getDay() + 6) % 7]}
              </div>
              <div className="text-[9px] text-slate-600">
                {dt.getMonth() + 1}/{dt.getDate()}
              </div>
            </div>
          )
        })}
      </div>
      <div className="mt-4 flex items-center justify-center gap-4 border-t border-white/[0.05] pt-3 text-[10px] text-slate-500">
        <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-neon-green/80" /> 工作</span>
        <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-neon-pink/80" /> 摸鱼</span>
        <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-slate-500/60" /> 其他</span>
      </div>
    </div>
  )
}
