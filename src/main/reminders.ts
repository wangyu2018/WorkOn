/**
 * 提醒中心（v10 §5）：用户自设定时提醒，应用内呈现（折下 amber 卡 + 桌宠气泡），
 * 不走 OS 通知。用户自己授权的打扰不受注意力预算扣减（v10 拍板）。
 * 存储：userData/reminders.json；调度：30s tick。
 */
import { app } from 'electron'
import { listActivitiesRange } from './db'
import fs from 'fs'
import path from 'path'

export interface Reminder {
  id: string
  title: string
  /** daily: 每天 atHHMM 触发；once: atTs 到点触发一次 */
  recurring: 'daily' | 'once'
  atHHMM?: string // "21:05"
  atTs?: number
  enabled: boolean
  lastFiredDate?: string // daily 去重（本地日期）
  createdAt: number
  /** 提醒来源（v10）：user=用户自设（走近级弹出·不扣预算）；system=系统记录提醒（走预算） */
  origin?: 'user' | 'system'
  /** 自动确认检测词（v10）：提醒标题/这类事件能在系统记录里验证时填——
   *  如「入会/开会」→ 检测近 5 分钟 activity 是否出现会议应用，命中则自动确认不再打扰 */
  confirmKeywords?: string[]
  confirmedAt?: number // 自动确认时间（命中后不再 fire）
}

let file = ''
let reminders: Reminder[] = []
let timer: NodeJS.Timeout | null = null
type FiredHandler = (r: Reminder) => void
let firedHandler: FiredHandler | null = null

function load(): void {
  file = path.join(app.getPath('userData'), 'reminders.json')
  try {
    if (fs.existsSync(file)) reminders = JSON.parse(fs.readFileSync(file, 'utf-8')) as Reminder[]
  } catch (e) {
    console.warn('[reminders] 读取失败', e)
    reminders = []
  }
}

function save(): void {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, JSON.stringify(reminders, null, 2), 'utf-8')
  } catch (e) {
    console.warn('[reminders] 写入失败', e)
  }
}

function localDateKey(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** 会议类应用（与 monitor MEETING_APPS 同口径，.exe 可选） */
const MEETING_APP_RE = /^(teams|zoom|腾讯会议|wemeet|voov meeting|feishu|lark|dingtalk)(\.exe)?$/i

/** 自动确认（v10 拍板）：提醒能被系统记录验证时不再打扰人。
 *  例：10 点开会的提醒，检测到近 5 分钟腾讯会议/Zoom 在前台 → 已入会，自动确认。 */
function autoConfirmCheck(r: Reminder): boolean {
  if (!r.confirmKeywords?.length) return false
  const kwHit = r.confirmKeywords.some((k) => k === 'meeting') // 目前支持 meeting 检测器；关键词匹配后续扩
  if (!kwHit) return false
  try {
    const recent = listActivitiesRange(Date.now() - 5 * 60_000, Date.now())
    return recent.some((a) => MEETING_APP_RE.test(a.app) || MEETING_APP_RE.test(a.appName ?? ''))
  } catch {
    return false
  }
}

function tick(): void {
  const now = new Date()
  const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
  const today = localDateKey(now)
  let dirty = false
  for (const r of reminders) {
    if (!r.enabled) continue
    if (r.recurring === 'daily' && r.atHHMM === hhmm && r.lastFiredDate !== today) {
      r.lastFiredDate = today
      dirty = true
      if (autoConfirmCheck(r)) {
        r.confirmedAt = Date.now()
        firedHandler?.({ ...r, title: `✓ 已自动确认（检测到你已入会）：${r.title.replace(/^✓ 已自动确认.*：/, '')}` })
      } else {
        firedHandler?.(r)
      }
    } else if (r.recurring === 'once' && r.atTs !== undefined && Date.now() >= r.atTs) {
      r.enabled = false // once 触发后停用，保留记录可召回
      dirty = true
      if (autoConfirmCheck(r)) {
        r.confirmedAt = Date.now()
        firedHandler?.({ ...r, title: `✓ 已自动确认（检测到你已入会）：${r.title.replace(/^✓ 已自动确认.*：/, '')}` })
      } else {
        firedHandler?.(r)
      }
    }
  }
  if (dirty) save()
}

export function initReminders(onFired: FiredHandler): void {
  load()
  firedHandler = onFired
  if (timer) clearInterval(timer)
  timer = setInterval(tick, 5_000) // 5s 粒度（once 类到点延迟 ≤5s；开销可忽略）
}

export function listReminders(): Reminder[] {
  return reminders
}

export function addReminder(input: {
  title: string
  recurring: 'daily' | 'once'
  atHHMM?: string
  atTs?: number
  origin?: 'user' | 'system'
  confirmKeywords?: string[]
}): Reminder {
  const r: Reminder = {
    id: `rm${Date.now()}${Math.floor(Math.random() * 1000)}`,
    title: input.title.trim() || '提醒',
    recurring: input.recurring,
    atHHMM: input.atHHMM,
    atTs: input.atTs,
    enabled: true,
    createdAt: Date.now(),
    origin: input.origin ?? 'user',
    confirmKeywords: input.confirmKeywords
  }
  reminders.push(r)
  save()
  return r
}

export function removeReminder(id: string): boolean {
  const before = reminders.length
  reminders = reminders.filter((r) => r.id !== id)
  if (reminders.length !== before) save()
  return reminders.length !== before
}
