import { useEffect, useState } from 'react'
import { WORK_LIKE_STATES } from '@shared/stateMeta'
import type { MergedTrail } from '@shared/types'
import { WEEK_LABELS, addDays, todayKey } from '../components/utils'

/** 把工作类片段分钟数分配到小时格 */
function workMinutesPerHour(trail: MergedTrail | null): number[] {
  const hours = new Array<number>(24).fill(0)
  for (const seg of trail?.segments ?? []) {
    if (!WORK_LIKE_STATES.includes(seg.mainState)) continue
    let ts = seg.startTs
    while (ts < seg.endTs) {
      const d = new Date(ts)
      const h = d.getHours()
      const next = new Date(d)
      next.setHours(h + 1, 0, 0, 0)
      const end = Math.min(seg.endTs, next.getTime())
      hours[h] += (end - ts) / 60000
      ts = end
    }
  }
  return hours
}

/** 7 天 × 24 小时工作热度图（neon cyan 透明度映射） */
export default function HeatmapView() {
  const [rows, setRows] = useState<{ key: string; hours: number[] }[]>([])
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    const days = Array.from({ length: 7 }, (_, i) => addDays(todayKey(), i - 6))
    Promise.all(days.map((d) => window.api.getTrail(d).catch(() => null)))
      .then((trails) => {
        setRows(days.map((key, i) => ({ key, hours: workMinutesPerHour(trails[i] as MergedTrail | null) })))
        setLoaded(true)
      })
      .catch(() => setLoaded(true))
  }, [])

  if (!loaded) return <div className="py-8 text-center text-slate-500">加载中…</div>

  const now = new Date()
  const today = todayKey()

  return (
    <div className="overflow-x-auto">
      <div className="min-w-[640px]">
        {/* 小时表头 */}
        <div className="mb-1 flex gap-1 pl-14">
          {Array.from({ length: 24 }, (_, h) => (
            <div key={h} className="flex-1 text-center text-[9px] text-slate-500">
              {h % 3 === 0 ? h : ''}
            </div>
          ))}
        </div>
        {rows.map(({ key, hours }) => {
          const d = new Date(`${key}T00:00:00`)
          const isToday = key === today
          return (
            <div key={key} className="mb-1 flex items-center gap-1">
              <div className={`w-14 shrink-0 text-[10px] ${isToday ? 'font-semibold text-neon-cyan' : 'text-slate-500'}`}>
                周{WEEK_LABELS[(d.getDay() + 6) % 7]} {d.getMonth() + 1}/{d.getDate()}
              </div>
              {hours.map((min, h) => {
                const alpha = min <= 0 ? 0 : Math.min(1, min / 60) * 0.85 + 0.1
                const isNow = isToday && h === now.getHours()
                return (
                  <div
                    key={h}
                    title={`${key} ${h}:00 · 工作 ${Math.round(min)}m`}
                    className={`h-5 flex-1 rounded-[4px] transition-transform hover:scale-110 ${isNow ? 'ring-1 ring-neon-cyan' : ''}`}
                    style={{
                      background: min > 0 ? `rgba(34,211,238,${alpha.toFixed(2)})` : 'rgba(255,255,255,0.04)'
                    }}
                  />
                )
              })}
            </div>
          )
        })}
        {/* 图例 */}
        <div className="mt-3 flex items-center justify-end gap-1.5 text-[10px] text-slate-500">
          <span>少</span>
          {[0.1, 0.3, 0.55, 0.8, 0.95].map((a) => (
            <span key={a} className="h-3 w-3 rounded-[3px]" style={{ background: `rgba(34,211,238,${a})` }} />
          ))}
          <span>多</span>
          <span className="ml-2">工作类状态分钟数</span>
        </div>
      </div>
    </div>
  )
}
