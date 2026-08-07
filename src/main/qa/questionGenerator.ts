/**
 * 轻问诊问题生成器（从 ai.ts 拆分独立）
 * - 场景模板问题（原 genQuestion 逻辑，24h 去重 + 已确认跳过）
 * - persona_gap：用户画像缺失时的补充提问（午休/高效时段/休息偏好）
 * - 作业链路：重复出现的应用切换序列 → 确认后存入 settings.workChains
 */
import { col, insertInto } from '../db'
import { getSettings, setSettings } from '../settings'
import { genId } from '@shared/types'
import type { UserFeedback, UserHabits } from '@shared/types'

const QUESTION_TEMPLATES: Record<string, string> = {
  'dual-aidev-relax': '主屏 AI 开发、副屏放松——这是你常态的轻松办公方式吗？',
  'dual-coding-relax': '主屏写代码、副屏听歌/视频——这样是你的高效搭配吗？',
  'dual-focus-relax': '主屏专注、副屏放松内容常开——需要我把副屏记为"背景"不计入摸鱼吗？',
  'single-slack': '看起来在刷闲内容——这是在忙里偷闲还是走神了？',
  'dual-meeting-relax': '会议中副屏还开着娱乐——会议内容不需要记笔记吗？',
  coding: '检测到你长时间编程，需要我把这段时间标记为「编程」并关联到计划吗？',
  focus: '你已连续专注很久，要不要开启番茄休息提醒？',
  slack: '最近摸鱼时间有点长，需要我提醒你回到工作吗？',
  meeting: '会议中，需要我帮你记录会议时长吗？',
  default: '当前这种状态（{ctx}）是你的常态工作方式吗？'
}

/** persona_gap 补充问题池（画像字段缺失时补问，Yes/No 可答） */
const PERSONA_GAP_QUESTIONS: { key: keyof UserHabits; question: string }[] = [
  { key: 'lunchTime', question: '你平时午休一般在 12 点左右吗？' },
  { key: 'preferredWorkHours', question: '你上午的工作效率通常比下午高吗？' },
  { key: 'commonBreakApps', question: '你休息时主要刷视频/社交媒体放松吗？' }
]

/** 场景问题（24h 去重 + 已确认 yes 跳过） */
export function genQuestion(ctx: string): { id: string; ctx: string; question: string } | null {
  const feedbacks = col<UserFeedback>('feedbacks')
  if (feedbacks.some((f) => f.ctx === ctx && f.answer === 'yes')) return null
  const askedRecently = feedbacks.some((f) => f.ctx === ctx && Date.now() - f.ts < 86400000)
  if (askedRecently) return null
  const template = QUESTION_TEMPLATES[ctx] ?? QUESTION_TEMPLATES.default
  return { id: genId('q'), ctx, question: template.replace('{ctx}', ctx) }
}

/** 画像补充问题：画像缺失字段 → 生成 persona-gap 问题（无则 null） */
export function genPersonaGapQuestion(habits: UserHabits | null): { id: string; ctx: string; question: string } | null {
  const feedbacks = col<UserFeedback>('feedbacks')
  for (const q of PERSONA_GAP_QUESTIONS) {
    const missing = !habits || habits[q.key] === undefined || (Array.isArray(habits[q.key]) && (habits[q.key] as unknown[]).length === 0)
    if (!missing) continue
    const ctx = `persona-gap:${String(q.key)}`
    if (feedbacks.some((f) => f.ctx === ctx && f.answer === 'yes')) continue
    if (feedbacks.some((f) => f.ctx === ctx && Date.now() - f.ts < 86400000)) continue
    return { id: genId('q'), ctx, question: q.question }
  }
  return null
}

// ───────────────────────── 作业链路检测 ─────────────────────────

/** 应用切换序列跟踪（近 30 分钟，连续去重） */
const appSeq: { app: string; ts: number }[] = []
let chainCooldownUntil = 0
let knownChainCooldownUntil = 0

/** 记录一次前台应用切换，返回检测到的候选链路（重复出现 2 次的 3 连序列） */
export function trackAppSwitch(app: string, ts: number): string[] | null {
  if (!app) return null
  const last = appSeq[appSeq.length - 1]
  if (last && last.app === app) return null
  appSeq.push({ app, ts })
  // 只保留近 30 分钟
  while (appSeq.length && ts - appSeq[0].ts > 30 * 60_000) appSeq.shift()
  if (ts < chainCooldownUntil) return null

  // 检测重复的 3 连序列（近 30min 内出现 ≥2 次）
  const apps = appSeq.map((a) => a.app)
  const seen = new Map<string, number>()
  for (let i = 0; i + 2 < apps.length; i++) {
    const key = `${apps[i]}>${apps[i + 1]}>${apps[i + 2]}`
    seen.set(key, (seen.get(key) ?? 0) + 1)
  }
  for (const [key, count] of seen) {
    if (count >= 2) {
      const chain = key.split('>')
      if (isKnownChain(chain)) return null
      chainCooldownUntil = ts + 30 * 60_000 // 候选确认后/忽略后 30min 不再问
      return chain
    }
  }
  return null
}

/** 是否已是已确认的作业链路 */
export function isKnownChain(chain: string[]): boolean {
  const chains = (getSettings() as { workChains?: string[][] }).workChains ?? []
  return chains.some((c) => c.join('>') === chain.join('>'))
}

/** 确认保存作业链路 */
export function saveWorkChain(chain: string[]): void {
  const s = getSettings() as { workChains?: string[][] }
  const chains = s.workChains ?? []
  if (chains.some((c) => c.join('>') === chain.join('>'))) return
  setSettings({ workChains: [...chains, chain] } as Partial<import('@shared/types').AppSettings>)
  console.log(`[workchain] 已保存作业链路: ${chain.join(' → ')}`)
}

/** 当前序列是否命中已知链路（全部元素按序包含）；命中返回链路 */
export function matchKnownChain(): string[] | null {
  const chains = (getSettings() as { workChains?: string[][] }).workChains ?? []
  if (!chains.length) return null
  const now = Date.now()
  if (now < knownChainCooldownUntil) return null
  const apps = appSeq.map((a) => a.app)
  for (const c of chains) {
    if (c.length < 2) continue
    // 序列按序包含链路全部元素即命中
    let idx = 0
    for (const app of apps) {
      if (app === c[idx]) idx++
      if (idx >= c.length) break
    }
    if (idx >= c.length) {
      knownChainCooldownUntil = now + 30 * 60_000
      return c
    }
  }
  return null
}

/** 反馈落库（原 recordFeedback） */
export function recordFeedback(qid: string, ctx: string, question: string, answer: 'yes' | 'no'): UserFeedback {
  const fb: UserFeedback = { id: genId('fb'), ctx, question, answer, ts: Date.now() }
  insertInto('feedbacks', fb)
  return fb
}
