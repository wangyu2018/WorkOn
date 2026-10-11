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

// ───────────────────────── 人生预期意图 ─────────────────────────

/** 预期声明：「我想在年底前把 X 做到 Y」「目标是三个月内上线」 */
export interface GoalIntent {
  sourceText: string
}

const GOAL_PHRASE_RE = /(我?\s*(想|要|打算|希望|计划|争取|立志)|目标\s*(是|为)?|定个?目标|立个?\s*flag|我的?愿望)/i
const DEADLINE_HINT_RE =
  /(年底|明年|今年|后年|\d{4}\s*年|\d{1,2}\s*月|(\d+|十|十一|十二|[一二两三四五六七八九])\s*个?\s*(月|周|天)|半年|一年|\d+\s*岁)/

export function parseGoalIntent(text: string): GoalIntent | null {
  // 提醒词优先——「提醒我……」归提醒通道，不当预期
  if (REMIND_RE.test(text)) return null
  if (!GOAL_PHRASE_RE.test(text)) return null
  if (!DEADLINE_HINT_RE.test(text)) return null
  return { sourceText: text }
}

/** 日程提议（v10）：「明天下午3点有个入职会」——没说提醒，但值得主动问一嘴 */
export interface ScheduleProposal {
  whenLabel: string
  event: string
  atHHMM?: string
  atTs?: number
  /** 会议类 → 建提醒时自动挂入会检测（行为自动确认） */
  isMeeting: boolean
}

const EVENT_RE = /(有个?|要开|参加|进行|约定了?)?(入职会|评审会?|例会|周会|月会|晨会|晚会|面试|会议|约会|答辩|复习|复盘|上架|发布|截止|考试)/

export function parseScheduleProposal(text: string): ScheduleProposal | null {
  if (REMIND_RE.test(text)) return null // 显式提醒走 reminder 通道
  if (!TIME_RE.test(text)) return null
  if (!EVENT_RE.test(text)) return null
  const t = TIME_RE.exec(text)!
  let hour = Math.min(23, parseInt(t[1], 10))
  const min = t[2] ? Math.min(59, parseInt(t[2], 10)) : 0
  const hourPos = t.index
  const prefix = text.slice(Math.max(0, hourPos - 3), hourPos)
  if (/(晚上|晚间|夜里|下午|傍晚|午后|今晚)/.test(prefix) && hour >= 1 && hour <= 11) hour += 12
  const atHHMM = `${String(hour).padStart(2, '0')}:${String(min).padStart(2, '0')}`
  const eventM = EVENT_RE.exec(text)
  const event = eventM ? eventM[2] : '日程'
  const daily = DAY_RE.test(text)
  const at = new Date()
  at.setHours(hour, min, 0, 0)
  if (TOMORROW_RE.test(text)) {
    const d = new Date()
    d.setDate(d.getDate() + 1)
    at.setFullYear(d.getFullYear(), d.getMonth(), d.getDate())
  } else if (at.getTime() <= Date.now() && !TONIGHT_RE.test(text)) {
    at.setDate(at.getDate() + 1) // 已过点默认算明天
  }
  const whenLabel = `${daily ? '每天 ' : TOMORROW_RE.test(text) ? '明天 ' : '今天 '}${atHHMM}`
  const atTs = at.getTime()
  return { whenLabel, event, atHHMM, atTs: daily ? undefined : atTs, isMeeting: /(会|会议|面试|评审)/.test(event) && !daily }
}

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
