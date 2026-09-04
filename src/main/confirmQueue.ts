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

/** 是否处于可打扰时刻 */
function canInterrupt(): boolean {
  const snap = presence.getSnapshot() as { focusLevel?: number; state?: string }
  const state = snap.state ?? 'idle'
  const lowStates = new Set(['slack', 'relax', 'break', 'lunch', 'idle'])
  if (lowStates.has(state)) return true
  if ((snap.focusLevel ?? 0) < 60) return true
  if (!getFocusChainState().active) return true
  return false
}

/** 入队（指纹去重；已答指纹由调用方过滤） */
export function enqueueAsk(fp: string, question: string, ctx: Record<string, unknown> = {}): void {
  if (queue.has(fp)) return
  queue.set(fp, { fp, question, ctx, ts: Date.now() })
}

/** 派遣器：monitor tick 调用（内部 30s 节流）；低专注时刻每次放一条最老的 */
export function dispatchConfirmQueue(): void {
  const now = Date.now()
  if (now - lastDispatch < 30_000) return
  lastDispatch = now
  if (queue.size === 0 || !canInterrupt()) return
  const oldest = [...queue.values()].sort((a, b) => a.ts - b.ts)[0]
  queue.delete(oldest.fp)
  bus.setQuestion({ id: genId('q'), ctx: `attrib:${oldest.fp}`, question: oldest.question, ts: now, ...oldest.ctx })
}

/** 队列规模（调试/展示） */
export function pendingAskCount(): number {
  return queue.size
}
