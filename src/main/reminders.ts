/**
 * 提醒中心（v10 §5）：用户自设定时提醒，应用内呈现（折下 amber 卡 + 桌宠气泡），
 * 不走 OS 通知。用户自己授权的打扰不受注意力预算扣减（v10 拍板）。
 * 存储：userData/reminders.json；调度：30s tick。
 */
import { app } from 'electron'
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
      firedHandler?.(r)
    } else if (r.recurring === 'once' && r.atTs !== undefined && Date.now() >= r.atTs) {
      r.enabled = false // once 触发后停用，保留记录可召回
      dirty = true
      firedHandler?.(r)
    }
  }
  if (dirty) save()
}

export function initReminders(onFired: FiredHandler): void {
  load()
  firedHandler = onFired
  if (timer) clearInterval(timer)
  timer = setInterval(tick, 30_000)
}

export function listReminders(): Reminder[] {
  return reminders
}

export function addReminder(input: {
  title: string
  recurring: 'daily' | 'once'
  atHHMM?: string
  atTs?: number
}): Reminder {
  const r: Reminder = {
    id: `rm${Date.now()}${Math.floor(Math.random() * 1000)}`,
    title: input.title.trim() || '提醒',
    recurring: input.recurring,
    atHHMM: input.atHHMM,
    atTs: input.atTs,
    enabled: true,
    createdAt: Date.now()
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
