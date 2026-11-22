/**
 * 日历连接器（P1）：ICS 订阅 + 本地 ICS 写入
 * CalDAV 的认证式同步放 P2；这里先把标准 ICS 读通，供计划时间块避开 busy。
 */
import fs from 'fs'
import path from 'path'
import { app } from 'electron'
import { col, insertInto, removeFrom } from '../db'
import { genId } from '@shared/types'
import type { CalendarFeed } from '@shared/types'

export interface CalendarEvent {
  id: string
  title: string
  startTs: number
  endTs: number
  location?: string
  feedId: string
  feedName: string
}

function localIcsPath(): string {
  const dir = path.join(app.getPath('userData'), 'calendar')
  fs.mkdirSync(dir, { recursive: true })
  return path.join(dir, 'local.ics')
}

export function listFeeds(): CalendarFeed[] {
  return col<CalendarFeed>('calendarFeeds')
}

export function addFeed(input: { name?: string; url: string }): CalendarFeed {
  const url = String(input.url ?? '').trim()
  if (!/^https?:\/\//i.test(url) && !fs.existsSync(url)) throw new Error('只支持 http(s) ICS 地址或本地文件路径')
  const feed: CalendarFeed = {
    id: genId('cal'),
    name: String(input.name ?? 'ICS 订阅').slice(0, 40),
    url,
    ts: Date.now()
  }
  insertInto<CalendarFeed>('calendarFeeds', feed)
  return feed
}

export function removeFeed(id: string): boolean {
  return removeFrom('calendarFeeds', String(id))
}

function unfold(text: string): string {
  return text.replace(/\r\n/g, '\n').replace(/\n[ \t]/g, '')
}

function parseIcsDate(raw: string): number | null {
  const v = raw.trim()
  if (/^\d{8}$/.test(v)) {
    const y = Number(v.slice(0, 4))
    const m = Number(v.slice(4, 6)) - 1
    const d = Number(v.slice(6, 8))
    return new Date(y, m, d).getTime()
  }
  const m = v.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/)
  if (!m) return null
  const [, y, mo, d, h, mi, s, z] = m
  const utc = z === 'Z'
  return utc
    ? Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s))
    : new Date(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s)).getTime()
}

function prop(lines: string[], key: string): string {
  const hit = lines.find((l) => l.startsWith(`${key}:`) || l.startsWith(`${key};`))
  if (!hit) return ''
  const idx = hit.indexOf(':')
  return idx >= 0 ? hit.slice(idx + 1) : ''
}

export function parseIcs(text: string, feed: { id: string; name: string }): CalendarEvent[] {
  const out: CalendarEvent[] = []
  const body = unfold(text)
  const re = /BEGIN:VEVENT([\s\S]*?)END:VEVENT/g
  let m: RegExpExecArray | null
  while ((m = re.exec(body))) {
    const lines = m[1].split('\n').map((l) => l.trim()).filter(Boolean)
    const start = parseIcsDate(prop(lines, 'DTSTART'))
    if (start === null) continue
    const endRaw = parseIcsDate(prop(lines, 'DTEND'))
    const end = endRaw ?? start + 30 * 60000
    out.push({
      id: `${feed.id}-${start}-${prop(lines, 'SUMMARY').slice(0, 12)}`,
      title: prop(lines, 'SUMMARY') || '未命名日程',
      startTs: start,
      endTs: Math.max(start + 60000, end),
      location: prop(lines, 'LOCATION') || undefined,
      feedId: feed.id,
      feedName: feed.name
    })
  }
  return out
}

async function fetchFeed(feed: CalendarFeed, timeoutMs = 6000): Promise<CalendarEvent[]> {
  try {
    if (fs.existsSync(feed.url)) {
      return parseIcs(fs.readFileSync(feed.url, 'utf-8'), feed)
    }
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), timeoutMs)
    const res = await fetch(feed.url, { signal: ctrl.signal })
    clearTimeout(timer)
    if (!res.ok) return []
    return parseIcs(await res.text(), feed)
  } catch {
    return []
  }
}

/** 读取时间窗内的事件（含本地 ICS） */
export async function listEvents(startTs: number, endTs: number): Promise<CalendarEvent[]> {
  const feeds = listFeeds()
  const local: CalendarFeed = { id: 'local', name: '本地日程', url: localIcsPath(), ts: 0 }
  const all = [local, ...feeds]
  const groups = await Promise.all(all.map((f) => fetchFeed(f)))
  return groups
    .flat()
    .filter((e) => e.endTs >= startTs && e.startTs <= endTs)
    .sort((a, b) => a.startTs - b.startTs)
}

/** 写入本地日程（最小 ICS：单次事件） */
export function upsertEvent(input: {
  title: string
  startTs: number
  endTs: number
  location?: string
}): CalendarEvent {
  const file = localIcsPath()
  const existing = fs.existsSync(file) ? fs.readFileSync(file, 'utf-8') : ''
  const fmt = (ts: number): string => {
    const d = new Date(ts)
    const p = (n: number): string => String(n).padStart(2, '0')
    return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}T${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`
  }
  const stamp = fmt(Date.now())
  const evt = [
    'BEGIN:VEVENT',
    `UID:${genId('evt')}@workon.local`,
    `DTSTAMP:${stamp}`,
    `DTSTART:${fmt(input.startTs)}`,
    `DTEND:${fmt(input.endTs)}`,
    `SUMMARY:${String(input.title).slice(0, 120)}`,
    input.location ? `LOCATION:${String(input.location).slice(0, 120)}` : '',
    'END:VEVENT'
  ]
    .filter(Boolean)
    .join('\r\n')
  const base = existing.includes('BEGIN:VCALENDAR')
    ? existing
    : 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//WorkOn//Calendar//CN\r\nEND:VCALENDAR\r\n'
  const next = base.replace('END:VCALENDAR', `${evt}\r\nEND:VCALENDAR`)
  fs.writeFileSync(file, next, 'utf-8')
  return {
    id: `local-${input.startTs}`,
    title: input.title,
    startTs: input.startTs,
    endTs: input.endTs,
    location: input.location,
    feedId: 'local',
    feedName: '本地日程'
  }
}

/** 某天的忙碌区间（分钟数），供 planBlocks 避开 */
export async function busyRangesForDate(date: string): Promise<Array<{ startMin: number; endMin: number }>> {
  const start = new Date(`${date}T00:00:00`).getTime()
  const end = start + 86400000
  const events = await listEvents(start, end)
  return events.map((e) => {
    const s = new Date(Math.max(start, e.startTs))
    const t = new Date(Math.min(end, e.endTs))
    return { startMin: s.getHours() * 60 + s.getMinutes(), endMin: t.getHours() * 60 + t.getMinutes() }
  })
}
