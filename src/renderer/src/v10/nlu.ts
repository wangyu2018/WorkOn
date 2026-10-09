/**
 * v10 输入解析（本地规则层）：把一句话拆成「建提醒」意图。
 * 规则先行（v10 §8：先规则后模型）；后续 jev 意图小题接替此处歧义判定。
 */
export interface ReminderIntent {
  title: string
  recurring: 'daily' | 'once'
  atHHMM?: string
  atTs?: number
  /** 供确认文案显示 */
  whenLabel: string
}

const TIME_RE = /(\d{1,2})\s*[点时:：]\s*(\d{1,2})?\s*分?/
const DAY_RE = /(每天|每日|天天)/
const TONIGHT_RE = /(今晚|今天)/
const TOMORROW_RE = /(明天|明晚|明日)/
const REMIND_RE = /(提醒|叫我|别忘)/

export function parseReminderIntent(text: string): ReminderIntent | null {
  if (!REMIND_RE.test(text)) return null
  const t = TIME_RE.exec(text)
  if (!t) return null
  let hour = Math.min(23, parseInt(t[1], 10))
  const min = t[2] ? Math.min(59, parseInt(t[2], 10)) : 0
  // 时段修饰：晚上/下午/傍晚 1-11 点 → +12（「晚上8点」=20:00 而非 08:00）
  const hourPos = t.index
  const prefix = text.slice(Math.max(0, hourPos - 3), hourPos)
  if (/(晚上|晚间|夜里|下午|傍晚|午後|午后|今晚|今晚)/.test(prefix) && hour >= 1 && hour <= 11) hour += 12
  const atHHMM = `${String(hour).padStart(2, '0')}:${String(min).padStart(2, '0')}`
  const daily = DAY_RE.test(text)
  // 事项 = 去掉时间和触发词后的剩余部分
  const title = text
    .replace(TIME_RE, ' ')
    .replace(DAY_RE, ' ')
    .replace(TONIGHT_RE, ' ')
    .replace(TOMORROW_RE, ' ')
    .replace(/提醒我|提醒|叫我|别忘(了)?|每天|每日|晚上|晚间|夜里|下午|傍晚|早上|上午|中午/g, ' ')
    .replace(/[，,。;；！!？?\s]+/g, ' ')
    .trim()
  const whenLabel = daily ? `每天 ${atHHMM}` : `${TOMORROW_RE.test(text) ? '明天' : '今天'} ${atHHMM}`
  if (daily) return { title: title || '提醒', recurring: 'daily', atHHMM, whenLabel }
  // once：算目标时间戳（明天 → +1d）
  const at = new Date()
  at.setHours(hour, min, 0, 0)
  if (TOMORROW_RE.test(text) || at.getTime() <= Date.now()) {
    if (!TONIGHT_RE.test(text) && at.getTime() <= Date.now()) at.setDate(at.getDate() + 1)
    if (TOMORROW_RE.test(text)) at.setDate(at.getDate() + (at.getDate() === new Date().getDate() ? 1 : 0))
  }
  if (TOMORROW_RE.test(text)) {
    const d = new Date()
    d.setDate(d.getDate() + 1)
    at.setFullYear(d.getFullYear(), d.getMonth(), d.getDate())
  }
  return { title: title || '提醒', recurring: 'once', atHHMM, atTs: at.getTime(), whenLabel }
}
