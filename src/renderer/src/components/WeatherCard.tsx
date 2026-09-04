/**
 * 顶栏天气卡（v7）：现在 / 未来几小时 / 未来几天 三条信息
 * 头部只放一枚精简 chip，点击弹出卡片
 */
import { useEffect, useRef, useState } from 'react'

interface HourItem { hour: number; ts: number; text: string; tempC: number; chanceOfRain: number }

export function WeatherCard() {
  const [now, setNow] = useState<{ text: string; tempC: number } | null>(null)
  const [hours, setHours] = useState<HourItem[]>([])
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  /** 城市切换（本地覆盖；清空=跟随全局设置） */
  const [city, setCity] = useState<string>(() => localStorage.getItem('woWeatherCity') ?? '')
  const cityRef = useRef(city)
  cityRef.current = city

  const load = (): void => {
    const c = localStorage.getItem('woWeatherCity') ?? undefined
    void window.api?.getWeather?.(c).then((w) => {
      const o = w as { text?: string; tempC?: number; error?: string }
      if (o && !o.error && typeof o.tempC === 'number') setNow({ text: o.text ?? '', tempC: o.tempC })
    }).catch(() => undefined)
  }

  useEffect(() => {
    load()
    const t = window.setInterval(load, 30 * 60 * 1000)
    return () => window.clearInterval(t)
  }, [])

  useEffect(() => {
    if (!open) return
    void window.api?.getWeatherNext?.(72, localStorage.getItem('woWeatherCity') ?? undefined).then((hs) => {
      const arr = hs as HourItem[]
      if (Array.isArray(arr)) setHours(arr.filter((h) => h && typeof h.tempC === 'number'))
    }).catch(() => undefined)
    const onDoc = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  const nextHours = hours.slice(1, 5)
  // 未来三天：按自然日分组（跳过今天），取当日最高温 + 最常见天气
  const byDay = new Map<string, HourItem[]>()
  for (const h of hours) {
    const d = new Date(h.ts)
    const key = `${d.getMonth() + 1}/${d.getDate()}`
    if (!byDay.has(key)) byDay.set(key, [])
    byDay.get(key)!.push(h)
  }
  const dayKeys = [...byDay.keys()].slice(1, 4)

  return (
    <div className="relative" ref={ref}>
      <button
        className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-slate-300 transition-colors hover:bg-white/[0.06] hover:text-slate-100"
        title="天气"
        onClick={() => setOpen((o) => !o)}
      >
        <span>☁️</span>
        {now ? <span className="text-[12px] font-semibold tabular-nums">{Math.round(now.tempC)}°</span> : <span className="text-[12px]">天气</span>}
      </button>
      {open ? (
        <div
          className="absolute right-0 top-full z-[70] mt-1.5 w-64 overflow-hidden rounded-2xl border border-[var(--line)] p-3 text-[12px]"
          style={{ background: 'var(--bg-surface)', boxShadow: 'var(--shadow-lg)' }}
        >
          {/* 现在 */}
          <div className="flex items-baseline justify-between">
            <span className="text-[10px] uppercase tracking-wider text-slate-500">现在</span>
            <span className="text-[10px] text-slate-500">{now?.text}</span>
          </div>
          <div className="text-[22px] font-extrabold leading-tight text-slate-100">{now ? `${Math.round(now.tempC)}°` : '—'}</div>
          {/* 未来几小时 */}
          <div className="mt-2.5 border-t border-[var(--line)] pt-2">
            <div className="mb-1 text-[10px] uppercase tracking-wider text-slate-500">未来几小时</div>
            <div className="flex justify-between gap-1">
              {nextHours.map((h) => (
                <div key={h.ts} className="flex flex-col items-center gap-0.5 text-[10.5px] text-slate-400">
                  <span>{h.hour}时</span>
                  <span className="font-semibold text-slate-200">{Math.round(h.tempC)}°</span>
                  {h.chanceOfRain >= 30 ? <span className="text-[9px] text-sky-400">雨{h.chanceOfRain}%</span> : <span className="text-[9px] text-slate-600">{h.text.slice(0, 2)}</span>}
                </div>
              ))}
              {!nextHours.length ? <span className="text-slate-600">—</span> : null}
            </div>
          </div>
          {/* 未来几天 */}
          <div className="mt-2.5 border-t border-[var(--line)] pt-2">
            <div className="mb-1 text-[10px] uppercase tracking-wider text-slate-500">未来几天</div>
            <div className="flex flex-col gap-1">
              {dayKeys.map((k) => {
                const list = byDay.get(k)!
                const maxT = Math.round(Math.max(...list.map((h) => h.tempC)))
                const text = list[0]?.text ?? ''
                return (
                  <div key={k} className="flex items-center justify-between text-slate-300">
                    <span>{k}</span>
                    <span className="text-slate-500">{text}</span>
                    <span className="tabular-nums font-semibold">{maxT}°</span>
                  </div>
                )
              })}
              {!dayKeys.length ? <span className="text-slate-600">—</span> : null}
            </div>
          </div>
          {/* 城市切换 */}
          <div className="mt-2.5 flex items-center gap-1.5 border-t border-[var(--line)] pt-2">
            <span className="shrink-0 text-[10px] uppercase tracking-wider text-slate-500">城市</span>
            <input
              className="min-w-0 flex-1 rounded-lg border border-[var(--line)] bg-transparent px-2 py-1 text-[11px] text-slate-300 outline-none focus:border-[var(--border-active)]"
              placeholder="留空跟随全局设置"
              defaultValue={city}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  const v = (e.target as HTMLInputElement).value.trim()
                  localStorage.setItem('woWeatherCity', v)
                  setCity(v)
                  load()
                }
              }}
            />
          </div>
        </div>
      ) : null}
    </div>
  )
}
