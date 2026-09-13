/**
 * 确认队列（v7 · 注意力预算模型）
 * 原则：AI 时代产品——先按最佳猜测行动，让纠正容易，而不是动不动找人确认。
 * - 所有非阻塞确认进队列堆积（指纹去重，永不重复）
 * - 派遣器只在「低专注时刻」放行：专注度 <60 / 摸鱼休息类状态 / 链路未激活
 * - 高专注期间一个都不打扰；用户停下来喝水走神时才批量冒出来
 */
import { presence } from './presence'
import { bus } from './state'
import { getFocusChainState } from './focusChain'
import { genId } from '@shared/types'

export interface QueuedAsk {
  fp: string
  question: string
  ctx: Record<string, unknown>
  ts: number
}

const queue = new Map<string, QueuedAsk>()
let lastDispatch = 0
let deliveredCount = 0
let deliveredDay = ''
const DAILY_DELIVER_LIMIT = 2
const QUESTION_TTL_MS = 10 * 60_000

/** 是否处于可打扰时刻 */
function canInterrupt(): boolean {
  const snap = presence.getSnapshot() as { focusLevel?: number; state?: string }
  const state = snap.state ?? 'idle'
  const lowStates = new Set(['slack', 'relax', 'break', 'lunch', 'idle'])
  // 明确放松/摸鱼/空闲 → 可打断
  if (lowStates.has(state)) return true
  // 其余情况要求更严格：专注度 <40 且 链路未激活 才打扰（阈值宁高勿低）
  return (snap.focusLevel ?? 0) < 40 && !getFocusChainState().active
}

/** 入队（指纹去重；已答指纹由调用方过滤）。返回是否新入队 */
export function enqueueAsk(fp: string, question: string, ctx: Record<string, unknown> = {}): boolean {
  if (queue.has(fp)) return false
  queue.set(fp, { fp, question, ctx, ts: Date.now() })
  return true
}

/** 派遣器：monitor tick 调用（内部 45s 节流）；低专注时刻每次放一条最老的；已有未答问题时不再叠 */
export function dispatchConfirmQueue(): void {
  const now = Date.now()
  if (now - lastDispatch < 45_000) return
  lastDispatch = now
  if (queue.size === 0 || !canInterrupt()) return
  if (bus.question) return // 上一条还没答，不连环弹
  // 每日配额：最多弹 2 条打断式确认，超出转静默
  const day = new Date().toISOString().slice(0, 10)
  if (deliveredDay !== day) { deliveredDay = day; deliveredCount = 0 }
  if (deliveredCount >= DAILY_DELIVER_LIMIT) return
  // TTL：超时确认自动按忽略结案
  for (const [fp, q] of queue) {
    if (now - q.ts > QUESTION_TTL_MS) queue.delete(fp)
  }
  if (queue.size === 0) return
  const oldest = [...queue.entries()].sort((a, b) => a[1].ts - b[1].ts)[0]
  queue.delete(oldest[0])
  deliveredCount++
  bus.setQuestion({
    id: genId('q'),
    ctx: `attrib:${oldest[1].fp}`,
    question: oldest[1].question,
    ts: now,
    ...oldest[1].ctx
  })
}

/** 队列规模（调试/展示） */
export function pendingAskCount(): number {
  return queue.size
}
