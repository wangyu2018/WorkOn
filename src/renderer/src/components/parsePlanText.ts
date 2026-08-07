/** 一句话计划文本的纯规则中文解析（不用 AI） */
import { clockOf, dateKeyOf } from './utils'

export interface ParsePlanResult {
  /** YYYY-MM-DD；无日期词时为 undefined（调用方用当前查看日期） */
  date?: string
  startMin?: number
  endMin?: number
  durationMin?: number
  /** 去掉日期/时间词与动词前缀后的文本；为空则用原文 */
  title: string
  /** 识别到的片段描述（用于 hint 展示） */
  matched: string[]
}

const WEEK_CHARS: Record<string, number> = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 0, 天: 0 }

/** 时段词：pm=true 表示小于 12 点时要 +12 */
const PERIODS: Array<{ re: RegExp; label: string; pm: boolean; defHour: number }> = [
  { re: /凌晨/, label: '凌晨', pm: false, defHour: 6 },
  { re: /早上|早晨|上午/, label: '上午', pm: false, defHour: 9 },
  { re: /中午/, label: '中午', pm: true, defHour: 12 },
  { re: /下午/, label: '下午', pm: true, defHour: 14 },
  { re: /傍晚|晚上/, label: '晚上', pm: true, defHour: 20 }
]

interface TimeHit {
  idx: number
  text: string
  h: number
  min: number
}

export function parsePlanText(text: string, now: Date = new Date()): ParsePlanResult {
  const matched: string[] = []
  let rest = text
  const base = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const mmdd = (key: string) => key.slice(5)

  /* ── 日期词（优先级从高到低） ── */
  let date: string | undefined
  const relDays: Array<[RegExp, number, string]> = [
    [/大后天/, 3, '大后天'],
    [/后天/, 2, '后天'],
    [/明天|明日/, 1, '明天'],
    [/今天|今日/, 0, '今天']
  ]
  for (const [re, delta, label] of relDays) {
    const m = re.exec(rest)
    if (m) {
      const d = new Date(base)
      d.setDate(d.getDate() + delta)
      date = dateKeyOf(d)
      matched.push(`日期=${label}(${mmdd(date)})`)
      rest = rest.replace(m[0], ' ')
      break
    }
  }
  if (!date) {
    const m = /下(?:周|星期)([一二三四五六日天])/.exec(rest)
    if (m) {
      const delta = ((WEEK_CHARS[m[1]] - base.getDay() + 7) % 7) + 7
      const d = new Date(base)
      d.setDate(d.getDate() + delta)
      date = dateKeyOf(d)
      matched.push(`日期=${m[0]}(${mmdd(date)})`)
      rest = rest.replace(m[0], ' ')
    }
  }
  if (!date) {
    const m = /(?:周|星期)([一二三四五六日天])/.exec(rest)
    if (m) {
      // 本周该 weekday，已过则取下周（同一天算今天）
      const delta = (WEEK_CHARS[m[1]] - base.getDay() + 7) % 7
      const d = new Date(base)
      d.setDate(d.getDate() + delta)
      date = dateKeyOf(d)
      matched.push(`日期=周${m[1]}(${mmdd(date)})`)
      rest = rest.replace(m[0], ' ')
    }
  }
  if (!date) {
    const m = /(\d{1,2})月(\d{1,2})[日号]/.exec(rest)
    if (m) {
      let d = new Date(base.getFullYear(), Number(m[1]) - 1, Number(m[2]))
      if (d.getTime() < base.getTime()) d = new Date(base.getFullYear() + 1, Number(m[1]) - 1, Number(m[2]))
      date = dateKeyOf(d)
      matched.push(`日期=${Number(m[1])}月${Number(m[2])}日(${mmdd(date)})`)
      rest = rest.replace(m[0], ' ')
    }
  }
  if (!date) {
    const m = /(\d{1,2})[-/](\d{1,2})/.exec(rest)
    if (m) {
      let d = new Date(base.getFullYear(), Number(m[1]) - 1, Number(m[2]))
      if (d.getTime() < base.getTime()) d = new Date(base.getFullYear() + 1, Number(m[1]) - 1, Number(m[2]))
      date = dateKeyOf(d)
      matched.push(`日期=${m[0]}(${mmdd(date)})`)
      rest = rest.replace(m[0], ' ')
    }
  }

  /* ── 下班前（截止语义） ── */
  let offwork = false
  const mOff = /下班前/.exec(rest)
  if (mOff) {
    offwork = true
    rest = rest.replace(mOff[0], ' ')
  }

  /* ── 时段词 ── */
  let period: (typeof PERIODS)[number] | undefined
  for (const p of PERIODS) {
    const m = p.re.exec(rest)
    if (m) {
      period = p
      rest = rest.replace(m[0], ' ')
      break
    }
  }

  /* ── 具体时刻 ── */
  const hits: TimeHit[] = []
  const pushHit = (m: RegExpExecArray, h: number, min: number) => {
    if (h > 24 || min >= 60) return
    hits.push({ idx: m.index, text: m[0], h, min })
  }
  let m: RegExpExecArray | null
  const reColon = /(\d{1,2})[:：](\d{1,2})/g
  while ((m = reColon.exec(rest))) pushHit(m, Number(m[1]), Number(m[2]))
  const reDian = /(\d{1,2})\s*点(?:(半)|(\d{1,2})\s*分?)?/g
  while ((m = reDian.exec(rest))) pushHit(m, Number(m[1]), m[2] ? 30 : m[3] ? Number(m[3]) : 0)
  hits.sort((a, b) => a.idx - b.idx)
  const shift = (h: number) => (period?.pm && h < 12 ? h + 12 : h)
  for (const hit of hits.slice(0, 2)) rest = rest.replace(hit.text, ' ')

  /* ── 时长 ── */
  let durationMin: number | undefined
  let durationText: string | undefined
  let dm = /(\d+(?:\.\d+)?)\s*个?\s*半\s*小时/.exec(rest)
  if (dm) durationMin = Math.round(Number(dm[1]) * 60 + 30)
  else if ((dm = /(\d+(?:\.\d+)?)\s*个?\s*小时/.exec(rest))) durationMin = Math.round(Number(dm[1]) * 60)
  else if ((dm = /(\d+)\s*分钟/.exec(rest))) durationMin = Number(dm[1])
  if (dm) {
    durationText = dm[0]
    rest = rest.replace(dm[0], ' ')
  }

  /* ── 组合出 start/end/duration ── */
  let startMin: number | undefined
  let endMin: number | undefined
  if (hits.length >= 2) {
    startMin = shift(hits[0].h) * 60 + hits[0].min
    endMin = shift(hits[1].h) * 60 + hits[1].min
  } else if (hits.length === 1) {
    startMin = shift(hits[0].h) * 60 + hits[0].min
  } else if (period && !offwork) {
    startMin = period.defHour * 60
  }
  if (offwork) endMin = 18 * 60
  // 有起点 + 时长、无终点 → 推导终点；start/end 齐时 duration 交给编辑器推导
  if (startMin !== undefined && durationMin !== undefined && endMin === undefined) {
    endMin = startMin + durationMin
    durationMin = undefined
  }
  if (startMin !== undefined && endMin !== undefined) durationMin = undefined

  if (startMin !== undefined && endMin !== undefined) matched.push(`时间=${clockOf(startMin)}-${clockOf(endMin)}`)
  else if (startMin !== undefined) matched.push(`时间=${period && hits.length === 0 ? `${period.label} ` : ''}${clockOf(startMin)}`)
  else if (offwork) matched.push('截止=18:00')
  if (durationMin !== undefined) matched.push(`时长=${durationMin}分钟(${durationText})`)

  /* ── 标题 ── */
  let title = rest.replace(/\s+/g, ' ').trim()
  title = title.replace(/^[\s,，。.、;；:：到至\-~]+/, '').replace(/[\s,，。.、;；]+$/, '')
  title = title.replace(/^(?:提醒我|记得|帮我|我要|我想|别忘了|别忘记)+/, '').trim()
  if (!title) title = text.trim()
  if (matched.length > 0) matched.push(`标题=${title}`)

  return { date, startMin, endMin, durationMin, title, matched }
}
