/**
 * 传统节日日期规则（移植自 oner 小程序 utils/lunar.ts + festivals.ts）。
 * 农历→公历用经典 lunarInfo 表（1900–2100），只服务「传统节日落在今年哪一天」。
 * 全程 UTC 运算只产出 'YYYY-MM-DD' 字符串，跨时区/夏令时不会差一天。
 * 清明是节气不是农历日，用 21 世纪通用公式单独算。
 */

const DAY = 86400000
const BASE_UTC = Date.UTC(1900, 0, 31) // 1900 年正月初一

// 农历 1900–2100 年闰月/大小月信息表（201 项，经典公开数据）
const lunarInfo: number[] = [
  0x04bd8, 0x04ae0, 0x0a570, 0x054d5, 0x0d260, 0x0d950, 0x16554, 0x056a0, 0x09ad0, 0x055d2,
  0x04ae0, 0x0a5b6, 0x0a4d0, 0x0d250, 0x1d255, 0x0b540, 0x0d6a0, 0x0ada2, 0x095b0, 0x14977,
  0x04970, 0x0a4b0, 0x0b4b5, 0x06a50, 0x06d40, 0x1ab54, 0x02b60, 0x09570, 0x052f2, 0x04970,
  0x06566, 0x0d4a0, 0x0ea50, 0x16a95, 0x05ad0, 0x02b60, 0x186e3, 0x092e0, 0x1c8d7, 0x0c950,
  0x0d4a0, 0x1d8a6, 0x0b550, 0x056a0, 0x1a5b4, 0x025d0, 0x092d0, 0x0d2b2, 0x0a950, 0x0b557,
  0x06ca0, 0x0b550, 0x15355, 0x04da0, 0x0a5b0, 0x14573, 0x052b0, 0x0a9a8, 0x0e950, 0x06aa0,
  0x0aea6, 0x0ab50, 0x04b60, 0x0aae4, 0x0a570, 0x05260, 0x0f263, 0x0d950, 0x05b57, 0x056a0,
  0x096d0, 0x04dd5, 0x04ad0, 0x0a4d0, 0x0d4d4, 0x0d250, 0x0d558, 0x0b540, 0x0b6a0, 0x195a6,
  0x095b0, 0x049b0, 0x0a974, 0x0a4b0, 0x0b27a, 0x06a50, 0x06d40, 0x0af46, 0x0ab60, 0x09570,
  0x04af5, 0x04970, 0x064b0, 0x074a3, 0x0ea50, 0x06b58, 0x05ac0, 0x0ab60, 0x096d5, 0x092e0,
  0x0c960, 0x0d954, 0x0d4a0, 0x0da50, 0x07552, 0x056a0, 0x0abb7, 0x025d0, 0x092d0, 0x0cab5,
  0x0a950, 0x0b4a0, 0x0baa4, 0x0ad50, 0x055d9, 0x04ba0, 0x0a5b0, 0x15176, 0x052b0, 0x0a930,
  0x07954, 0x06aa0, 0x0ad50, 0x05b52, 0x04b60, 0x0a6e6, 0x0a4e0, 0x0d260, 0x0ea65, 0x0d530,
  0x05aa0, 0x076a3, 0x096d0, 0x04afb, 0x04ad0, 0x0a4d0, 0x1d0b6, 0x0d250, 0x0d520, 0x0dd45,
  0x0b5a0, 0x056d0, 0x055b2, 0x049b0, 0x0a577, 0x0a4b0, 0x0aa50, 0x1b255, 0x06d20, 0x0ada0,
  0x14b63, 0x09370, 0x049f8, 0x04970, 0x064b0, 0x168a6, 0x0ea50, 0x06b20, 0x1a6c4, 0x0aae0,
  0x092e0, 0x0d2e3, 0x0c960, 0x0d557, 0x0d4a0, 0x0da50, 0x05d55, 0x056a0, 0x0a6d0, 0x055d4,
  0x052d0, 0x0a9b8, 0x0a950, 0x0b4a0, 0x0b6a6, 0x0ad50, 0x055a0, 0x0aba4, 0x0a5b0, 0x052b0,
  0x0b273, 0x06930, 0x07337, 0x06aa0, 0x0ad50, 0x14b55, 0x04b60, 0x0a570, 0x054e4, 0x0d160,
  0x0e968, 0x0d520, 0x0daa0, 0x16aa6, 0x056d0, 0x04ae0, 0x0a9d4, 0x0a2d0, 0x0d150, 0x0f252,
  0x0d520
]

const pad = (n: number): string => (n < 10 ? '0' + n : '' + n)

function info(y: number): number {
  return lunarInfo[Math.min(Math.max(y, 1900), 2100) - 1900]
}

function leapMonth(y: number): number {
  return info(y) & 0xf
}

function leapDays(y: number): number {
  if (!leapMonth(y)) return 0
  return info(y) & 0x10000 ? 30 : 29
}

function lunarMonthDays(y: number, m: number): number {
  return info(y) & (0x10000 >> m) ? 30 : 29
}

function lunarYearDays(y: number): number {
  let sum = 348
  for (let i = 0x8000; i > 0x8; i >>= 1) sum += info(y) & i ? 1 : 0
  return sum + leapDays(y)
}

/** 农历 (年,月,日) → 公历 'YYYY-MM-DD' */
export function lunarToSolar(ly: number, lm: number, ld: number): string {
  let offset = 0
  for (let y = 1900; y < ly; y++) offset += lunarYearDays(y)
  const leap = leapMonth(ly)
  for (let m = 1; m < lm; m++) {
    offset += lunarMonthDays(ly, m)
    if (m === leap) offset += leapDays(ly)
  }
  offset += ld - 1
  const dt = new Date(BASE_UTC + offset * DAY)
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`
}

function addDays(ymd: string, days: number): string {
  const [y, m, d] = ymd.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d) + days * DAY)
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`
}

/** 农历「月-日」今年对应公历日；已过则取明年。md 形如 '08-15' */
export function nextLunarDate(md: string, today: string): string {
  const [m, d] = md.split('-').map(Number)
  const y = Number(today.slice(0, 4))
  const thisYear = lunarToSolar(y, m, d)
  return thisYear >= today ? thisYear : lunarToSolar(y + 1, m, d)
}

/** 除夕：腊月最后一天（= 次年春节前一天） */
export function nextChuxi(today: string): string {
  const y = Number(today.slice(0, 4))
  const chuxi = (yy: number): string => addDays(lunarToSolar(yy, 1, 1), -1)
  const thisYear = chuxi(y)
  return thisYear >= today ? thisYear : chuxi(y + 1)
}

/** 清明（节气）：21 世纪通用公式 [Y×0.2422+4.81] − [Y/4]，Y 取年份后两位 */
export function qingmingOf(year: number): string {
  const y = year % 100
  const day = Math.floor(y * 0.2422 + 4.81) - Math.floor(y / 4)
  return `${year}-04-${pad(day)}`
}

export function nextQingming(today: string): string {
  const y = Number(today.slice(0, 4))
  const thisYear = qingmingOf(y)
  return thisYear >= today ? thisYear : qingmingOf(y + 1)
}

export type FestKind = 'solar' | 'lunar' | 'qingming' | 'chuxi'

export interface FestRule {
  name: string
  kind: FestKind
  /** solar: 'MM-DD'；lunar: 农历 'MM-DD' */
  md?: string
}

export const FESTIVAL_PRESETS: FestRule[] = [
  { name: '元旦', kind: 'solar', md: '01-01' },
  { name: '情人节', kind: 'solar', md: '02-14' },
  { name: '除夕', kind: 'chuxi' },
  { name: '春节', kind: 'lunar', md: '01-01' },
  { name: '元宵节', kind: 'lunar', md: '01-15' },
  { name: '妇女节', kind: 'solar', md: '03-08' },
  { name: '清明节', kind: 'qingming' },
  { name: '劳动节', kind: 'solar', md: '05-01' },
  { name: '端午节', kind: 'lunar', md: '05-05' },
  { name: '儿童节', kind: 'solar', md: '06-01' },
  { name: '七夕', kind: 'lunar', md: '07-07' },
  { name: '中元节', kind: 'lunar', md: '07-15' },
  { name: '中秋节', kind: 'lunar', md: '08-15' },
  { name: '国庆节', kind: 'solar', md: '10-01' },
  { name: '重阳节', kind: 'lunar', md: '09-09' },
  { name: '腊八节', kind: 'lunar', md: '12-08' },
  { name: '圣诞节', kind: 'solar', md: '12-25' },
  { name: '跨年', kind: 'solar', md: '12-31' }
]

/** 规则 → 最近的公历日期（今年已过则取明年） */
export function resolveFestDate(rule: FestRule, today: string): string {
  const y = Number(today.slice(0, 4))
  if (rule.kind === 'chuxi') return nextChuxi(today)
  if (rule.kind === 'qingming') return nextQingming(today)
  if (rule.kind === 'lunar') return nextLunarDate(rule.md ?? '01-01', today)
  const s = `${y}-${rule.md}`
  return s >= today ? s : `${y + 1}-${rule.md}`
}

/** 农历月-日 → 「八月十五」中文写法（解释为什么日期每年在变） */
export function lunarLabel(md?: string): string {
  const [m, d] = String(md || '').split('-').map(Number)
  if (!m || !d) return ''
  const MON = ['正', '二', '三', '四', '五', '六', '七', '八', '九', '十', '冬', '腊']
  const dayCn = (n: number): string => {
    if (n === 10) return '初十'
    if (n === 20) return '二十'
    if (n === 30) return '三十'
    const pre = ['初', '十', '廿', '三'][Math.floor(n / 10)]
    return pre + ['', '一', '二', '三', '四', '五', '六', '七', '八', '九'][n % 10]
  }
  return `${MON[m - 1]}月${dayCn(d)}`
}
