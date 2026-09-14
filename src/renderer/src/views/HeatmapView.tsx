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

// 跨挂载缓存：7d/月度各自按 key 存，再次进页直接出图
const heatCache = new Map<string, unknown>()

export default function HeatmapView({ range = '7d', yearMonth }: HeatmapViewProps) {
  const cacheKey = `${range}:${yearMonth ?? ''}`
  const [rows, setRows] = useState<{ key: string; hours: number[] }[]>(() => (heatCache.get(`r:${cacheKey}`) as { key: string; hours: number[] }[] | undefined) ?? [])
  const [loaded, setLoaded] = useState(() => heatCache.has(`r:${cacheKey}`) || heatCache.has(`d:${cacheKey}`))

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
          const mapped = days.map((key, i) => ({ key, hours: workMinutesPerHour(trails[i] as MergedTrail | null) }))
          heatCache.set(`r:${cacheKey}`, mapped)
          setRows(mapped)
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
          const mapped = days.map((key, i) => ({ key, focusMin: dailyFocusMinutes(trails[i] as MergedTrail | null) }))
          heatCache.set(`d:${cacheKey}`, mapped)
          setDailyData(mapped)
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

  // 7d 模式：现有行为 + 结论层（黄金时段 / 峰值 / 低谷 / ✦AI 洞察）
  // 每小时 7 天合计分钟 → 找最佳连续 2 小时窗口
  const hourTotals = new Array<number>(24).fill(0)
  for (const { hours } of rows) hours.forEach((m, h) => (hourTotals[h] += m))
  let goldenStart = 9
  let goldenSum = -1
  for (let h = 6; h <= 22; h++) {
    const sum = (hourTotals[h] ?? 0) + (hourTotals[h + 1] ?? 0)
    if (sum > goldenSum) {
      goldenSum = sum
      goldenStart = h
    }
  }
  // 峰值时刻（单格最大）
  let peak = { dayIdx: 0, h: 0, min: 0 }
  rows.forEach((r, di) =>
    r.hours.forEach((m, h) => {
      if (m > peak.min) peak = { dayIdx: di, h, min: m }
    })
  )
  // 工作时段（9-18）低谷：合计最低且有人出现的 2 小时窗
  let valleyStart = -1
  let valleySum = Number.MAX_SAFE_INTEGER
  for (let h = 9; h <= 16; h++) {
    const sum = (hourTotals[h] ?? 0) + (hourTotals[h + 1] ?? 0)
    if (sum > 0 && sum < valleySum) {
      valleySum = sum
      valleyStart = h
    }
  }
  const goldenTotal = Math.round(hourTotals[goldenStart] + hourTotals[goldenStart + 1])
  const avgDaily = Math.round(rows.reduce((acc, r) => acc + r.hours.reduce((a, b) => a + b, 0), 0) / Math.max(1, rows.length))
  const dayLabel = (i: number): string => {
    const d = new Date(`${rows[i]?.key ?? todayKey()}T00:00:00`)
    return `周${WEEK_LABELS[(d.getDay() + 6) % 7]}`
  }
  const valleyDays = valleyStart >= 0 ? rows.filter((r) => (r.hours[valleyStart] ?? 0) + (r.hours[valleyStart + 1] ?? 0) < goldenSum / 6).length : 0

  return (
    <div className="overflow-x-auto">
      {/* 结论层：黄金时段 / 峰值 / 低谷 */}
      <div className="mb-3 grid grid-cols-3 gap-3">
        <div>
          <div className="text-[16px] font-extrabold text-slate-100">{Math.floor(avgDaily / 60)}h{avgDaily % 60}m</div>
          <div className="text-[9px] text-slate-500">日均专注 · 近 7 天</div>
        </div>
        <div>
          <div className="text-[16px] font-extrabold text-[var(--teal-deep)]">
            {dayLabel(peak.dayIdx)} {pad(peak.h)}:00
          </div>
          <div className="text-[9px] text-slate-500">峰值时刻 · {Math.round(peak.min)}m</div>
        </div>
        <div>
          <div className="text-[16px] font-extrabold text-[#f87171]">
            {valleyStart >= 0 ? `${pad(valleyStart)}:00–${pad(valleyStart + 2)}:00` : '—'}
          </div>
          <div className="text-[9px] text-slate-500">低谷时段 · 建议排会议</div>
        </div>
      </div>
      <div
        className="mb-3 flex items-center gap-2 rounded-xl px-3 py-2 text-[11px] text-slate-300"
        style={{ background: 'var(--aura-soft)', border: '1px solid rgba(139,92,246,0.25)' }}
      >
        <span className="shrink-0" style={{ color: 'var(--violet)' }}>✦</span>
        <span>
          ⭐ 黄金时段 <b className="text-[var(--teal-deep)]">{pad(goldenStart)}:00–{pad(goldenStart + 2)}:00</b>
          （合计 {Math.floor(goldenTotal / 60)}h{goldenTotal % 60}m）
          {valleyStart >= 0 && valleyDays >= 3 ? (
            <>
              ；低谷时段 7 天里出现 {valleyDays} 天，与其硬扛，不如固定安排轻量事务（周报、整理、答疑）。
            </>
          ) : (
            <>。建议把硬任务放在这段，会议挪到低谷。</>
          )}
        </span>
      </div>
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
                const isGolden = h === goldenStart || h === goldenStart + 1
                return (
                  <div
                    key={h}
                    title={`${key} ${h}:00 · 工作 ${Math.round(min)}m`}
                    className={`h-5 flex-1 rounded-[4px] transition-transform hover:scale-110 ${isNow ? 'ring-1 ring-neon-cyan' : ''}`}
                    style={{
                      background: min > 0 ? `rgb(var(--teal-rgb) / ${alpha.toFixed(2)})` : 'rgba(255,255,255,0.04)',
                      outline: isGolden && min > 0 ? '1.5px solid rgb(var(--teal-rgb) / 0.75)' : undefined,
                      outlineOffset: isGolden ? 1 : undefined
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
            <span key={a} className="h-3 w-3 rounded-[3px]" style={{ background: `rgb(var(--teal-rgb) / ${a})` }} />
          ))}
          <span>多</span>
          <span className="ml-2">工作类状态分钟数 · 描边列 = 黄金时段</span>
        </div>
      </div>
    </div>
  )
}
