import { useEffect, useState } from 'react'
import { WORK_LIKE_STATES } from '@shared/stateMeta'
import type { MergedTrail } from '@shared/types'
import { WEEK_LABELS, todayKey } from '../components/utils'

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

/** 每天的工作类总分钟数 */
function dailyFocusMinutes(trail: MergedTrail | null): number {
  let total = 0
  for (const seg of trail?.segments ?? []) {
    if (WORK_LIKE_STATES.includes(seg.mainState)) {
      total += seg.durationMin
    }
  }
  return total
}

/** 补齐两位 */
function pad(n: number): string {
  return String(n).padStart(2, '0')
}

/** 格式化日期键 */
function dateKey(y: number, m: number, d: number): string {
  return `${y}-${pad(m)}-${pad(d)}`
}

interface HeatmapViewProps {
  range?: '7d' | 'month'
  yearMonth?: string
}

export default function HeatmapView({ range = '7d', yearMonth }: HeatmapViewProps) {
  const [rows, setRows] = useState<{ key: string; hours: number[] }[]>([])
  const [loaded, setLoaded] = useState(false)

  // 月度数据：每天的工作分钟数
  const [dailyData, setDailyData] = useState<{ key: string; focusMin: number }[]>([])

  useEffect(() => {
    if (range === '7d') {
      const days = Array.from({ length: 7 }, (_, i) => {
        const d = new Date()
        d.setDate(d.getDate() - 6 + i)
        return dateKey(d.getFullYear(), d.getMonth() + 1, d.getDate())
      })
      Promise.all(days.map((d) => window.api.getTrail(d).catch(() => null)))
        .then((trails) => {
          setRows(days.map((key, i) => ({ key, hours: workMinutesPerHour(trails[i] as MergedTrail | null) })))
          setLoaded(true)
        })
        .catch(() => setLoaded(true))
    } else if (range === 'month' && yearMonth) {
      const [y, m] = yearMonth.split('-').map(Number)
      const daysInMonth = new Date(y, m, 0).getDate()
      const days: string[] = []
      for (let i = 1; i <= daysInMonth; i++) {
        days.push(dateKey(y, m, i))
      }
      Promise.all(days.map((d) => window.api.getTrail(d).catch(() => null)))
        .then((trails) => {
          setDailyData(days.map((key, i) => ({ key, focusMin: dailyFocusMinutes(trails[i] as MergedTrail | null) })))
          setLoaded(true)
        })
        .catch(() => setLoaded(true))
    }
  }, [range, yearMonth])

  if (!loaded) return <div className="py-8 text-center text-slate-500">加载中…</div>

  const now = new Date()
  const today = todayKey()

  if (range === 'month' && yearMonth) {
    const [y, m] = yearMonth.split('-').map(Number)
    const firstDay = new Date(y, m - 1, 1)
    const daysInMonth = new Date(y, m, 0).getDate()
    const startDayOfWeek = (firstDay.getDay() + 6) % 7 // 0=Mon

    const weeks: (number | null)[][] = []
    let currentWeek: (number | null)[] = new Array(startDayOfWeek).fill(null)
    for (let day = 1; day <= daysInMonth; day++) {
      currentWeek.push(day)
      if (currentWeek.length === 7) {
        weeks.push(currentWeek)
        currentWeek = []
      }
    }
    if (currentWeek.length > 0) {
      while (currentWeek.length < 7) currentWeek.push(null)
      weeks.push(currentWeek)
    }

    const focusMap = new Map<string, number>()
    for (const d of dailyData) focusMap.set(d.key, d.focusMin)
    const maxMin = Math.max(1, ...dailyData.map((d) => d.focusMin))

    return (
      <div className="overflow-x-auto">
        {/* 列头：周一到周日 */}
        <div className="mb-1 grid grid-cols-7 gap-1">
          {WEEK_LABELS.map((label, i) => (
            <div key={i} className="text-center text-[10px] text-slate-500">
              周{label}
            </div>
          ))}
        </div>
        {weeks.map((week, wi) => (
          <div key={wi} className="mb-1 grid grid-cols-7 gap-1">
            {week.map((day, di) => {
              if (day === null) {
                return <div key={di} className="h-12 rounded-lg" />
              }
              const key = dateKey(y, m, day)
              const focusMin = focusMap.get(key) ?? 0
              const alpha = focusMin <= 0 ? 0.03 : Math.min(1, focusMin / maxMin) * 0.85 + 0.1
              const isToday = key === today
              return (
                <div
                  key={di}
                  title={`${key} · 工作 ${Math.round(focusMin)}m`}
                  className={`flex h-12 items-center justify-center rounded-lg text-[11px] transition-transform hover:scale-105 ${
                    isToday ? 'ring-1 ring-neon-cyan' : ''
                  }`}
                  style={{
                    background:
                      focusMin > 0
                        ? `rgba(34,211,238,${alpha.toFixed(2)})`
                        : 'rgba(255,255,255,0.03)',
                    color: focusMin > 0 ? '#cbd5e1' : '#475569'
                  }}
                >
                  {day}
                </div>
              )
            })}
          </div>
        ))}
        <div className="mt-3 flex items-center justify-end gap-1.5 text-[10px] text-slate-500">
          <span>少</span>
          {[0.1, 0.3, 0.55, 0.8, 0.95].map((a) => (
            <span key={a} className="h-3 w-3 rounded-[3px]" style={{ background: `rgba(34,211,238,${a})` }} />
          ))}
          <span>多</span>
          <span className="ml-2">工作类状态分钟数</span>
        </div>
      </div>
    )
  }

  // 7d 模式：现有行为
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
