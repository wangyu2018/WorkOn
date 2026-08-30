/**
 * 主窗口右上角天气徽标：当前天气 + 未来 N 小时趋势，有雨优先弹雨
 * 数据来自和风天气（按城市名查询，本地维护城市，不采集经纬度）
 */
import { memo, useEffect, useState } from 'react'
import { useSettingsStore } from '../stores/settingsStore'

interface Hour {
  hour: number
  ts: number
  text: string
  tempC: number
  code: number
  chanceOfRain: number
}

interface WeatherData {
  city: string
  text: string
  tempC: number
  code: number
  maxC: number
  minC: number
  hourly: Hour[]
}

/** 天气描述 → 图标类型（和风 text 直接返回中文） */
function textToIcon(text: string): 'sun' | 'cloud' | 'rain' | 'snow' | 'storm' | 'fog' {
  if (/晴/.test(text)) return 'sun'
  if (/云|阴/.test(text)) return 'cloud'
  if (/雾|霾|沙|尘/.test(text)) return 'fog'
  if (/雷/.test(text)) return 'storm'
  if (/雪|冰粒/.test(text)) return 'snow'
  if (/雨|雹/.test(text)) return 'rain'
  return 'cloud'
}

/** 天气图标（内联 SVG，简洁线性风格） */
function WeatherGlyph({ text, size = 14 }: { text: string; size?: number }) {
  const icon = textToIcon(text)
  const common = {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const
  }
  switch (icon) {
    case 'sun':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
        </svg>
      )
    case 'cloud':
      return (
        <svg {...common}>
          <path d="M17.5 19a4.5 4.5 0 0 0 0-9 6 6 0 0 0-11.6 1.5A3.5 3.5 0 0 0 7 19h10.5z" />
        </svg>
      )
    case 'rain':
      return (
        <svg {...common}>
          <path d="M17.5 13a4.5 4.5 0 0 0 0-9 6 6 0 0 0-11.6 1.5A3.5 3.5 0 0 0 7 13h10.5z" />
          <path d="M8 16l-1 2M12 16l-1 2M16 16l-1 2" />
        </svg>
      )
    case 'snow':
      return (
        <svg {...common}>
          <path d="M17.5 13a4.5 4.5 0 0 0 0-9 6 6 0 0 0-11.6 1.5A3.5 3.5 0 0 0 7 13h10.5z" />
          <path d="M12 16v2M12 20v2M10 17l-1.7 1M14 17l1.7 1M10 21l-1.7-1M14 21l1.7-1" />
        </svg>
      )
    case 'storm':
      return (
        <svg {...common}>
          <path d="M17.5 13a4.5 4.5 0 0 0 0-9 6 6 0 0 0-11.6 1.5A3.5 3.5 0 0 0 7 13h10.5z" />
          <path d="M12 15l-2 4h3l-1.5 3" />
        </svg>
      )
    default:
      return (
        <svg {...common}>
          <path d="M5 12a7 7 0 0 1 14 0M3 12h18M5 16h14" />
        </svg>
      )
  }
}

export const WeatherBadge = memo(function WeatherBadge() {
  const city = useSettingsStore((s) => s.settings.city)
  const weatherEnabled = useSettingsStore((s) => s.settings.weatherEnabled)
  const weatherHours = useSettingsStore((s) => s.settings.weatherHours ?? 3)
  const [data, setData] = useState<WeatherData | null>(null)
  const [err, setErr] = useState(false)

  useEffect(() => {
    if (!city || weatherEnabled === false) {
      setData(null)
      return
    }
    let alive = true
    window.api.getWeather(city).then((res) => {
      if (!alive) return
      if ('error' in res) {
        setErr(true)
        setData(null)
      } else {
        setErr(false)
        setData(res as WeatherData)
      }
    })
    return () => {
      alive = false
    }
  }, [city, weatherEnabled])

  if (!data || err) return null

  // 未来 N 小时（有雨优先弹雨）——用完整时间戳判断，避免跨天边界把「明天同一小时」误算进来
  const nowTs = Date.now()
  const next = data.hourly.filter((h) => h.ts >= nowTs && h.ts < nowTs + weatherHours * 3600 * 1000)
  const rainHour = next.find((h) => /(雨|雪|雷|雹)/.test(h.text))
  const display = rainHour ?? next[0] ?? null

  return (
    <div
      className="app-no-drag flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] text-slate-300 transition-colors hover:bg-white/[0.06]"
      title={`${data.city} · 当前 ${data.text} ${data.tempC}°C · 今日 ${data.minC}~${data.maxC}°C${rainHour ? ` · 未来${weatherHours}h ${rainHour.text} ${rainHour.tempC}°C` : ''}`}
    >
      <WeatherGlyph text={rainHour?.text ?? data.text} />
      <span className="font-semibold leading-none text-slate-100">{rainHour?.tempC ?? data.tempC}°</span>
      {rainHour && rainHour.text !== data.text ? (
        <span className="leading-none text-sky-300">{rainHour.text}</span>
      ) : (
        <span className="leading-none text-slate-400">{data.text}</span>
      )}
    </div>
  )
})