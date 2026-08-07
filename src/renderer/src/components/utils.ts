/** 日期 / 时间工具（本地时区） */

export function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

export function dateKeyOf(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

export function todayKey(): string {
  return dateKeyOf(new Date())
}

export function addDays(key: string, delta: number): string {
  const d = new Date(`${key}T00:00:00`)
  d.setDate(d.getDate() + delta)
  return dateKeyOf(d)
}

/** 时间戳 → 当日分钟（可带小数） */
export function minutesOfDay(ts: number): number {
  const d = new Date(ts)
  return d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60
}

/** 分钟 → "09:30" */
export function clockOf(min: number): string {
  const m = Math.max(0, Math.min(1439, Math.round(min)))
  return `${pad2(Math.floor(m / 60))}:${pad2(m % 60)}`
}

/** 分钟 → "3h 25m" / "45m" */
export function fmtMin(min: number): string {
  const m = Math.round(min)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  const rest = m % 60
  return rest ? `${h}h ${rest}m` : `${h}h`
}

export const WEEK_LABELS = ['一', '二', '三', '四', '五', '六', '日'] as const

/** 周一开头的 7 个日期键 */
export function weekDays(key: string): string[] {
  const d = new Date(`${key}T00:00:00`)
  const dow = (d.getDay() + 6) % 7
  const monday = new Date(d)
  monday.setDate(d.getDate() - dow)
  return Array.from({ length: 7 }, (_, i) => {
    const x = new Date(monday)
    x.setDate(monday.getDate() + i)
    return dateKeyOf(x)
  })
}

export function fmtDateLabel(key: string): string {
  const d = new Date(`${key}T00:00:00`)
  return `${d.getMonth() + 1}月${d.getDate()}日 周${WEEK_LABELS[(d.getDay() + 6) % 7]}`
}

/** "09:30" → 570；非法返回 undefined */
export function timeToMin(v: string): number | undefined {
  const m = /^(\d{1,2}):(\d{2})$/.exec(v)
  if (!m) return undefined
  const min = Number(m[1]) * 60 + Number(m[2])
  return min >= 0 && min <= 1440 ? min : undefined
}
