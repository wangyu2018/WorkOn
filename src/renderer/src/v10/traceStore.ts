/**
 * 渲染端「处理流程」最新 trace 存储
 * - askQA / askQAStream 的 trace 由主进程 ai:trace 事件写入
 * - 本地规则 / 指令直答由 recordLocalTrace 生成，保证「所有问答」都有流程图
 */
import type { PipelineTrace } from '@shared/trace'
import { clipText, extractTraceKeywords } from '@shared/trace'

let latest: PipelineTrace | null = null
const subs = new Set<(t: PipelineTrace) => void>()

export function setLatestTrace(t: PipelineTrace): void {
  // 主进程与本地直答可能先后写入，只保留时间更新的一条
  if (latest && t.ts < latest.ts) return
  latest = t
  for (const fn of subs) {
    try {
      fn(t)
    } catch {
      /* 订阅者异常不影响主流程 */
    }
  }
}

export function getLatestTrace(): PipelineTrace | null {
  return latest
}

export function subscribeTrace(fn: (t: PipelineTrace) => void): () => void {
  subs.add(fn)
  return () => {
    subs.delete(fn)
  }
}

/** 本地直答（规则 / 指令 / 确定性回复）也进流程图 */
export function recordLocalTrace(question: string, answer: string, reason = '本地规则直答'): void {
  const q = question.trim() || '（无输入）'
  setLatestTrace({
    id: `local${Date.now().toString(36)}`,
    ts: Date.now(),
    source: 'qa',
    input: { text: clipText(q, 500), keywords: extractTraceKeywords(q) },
    route: { decided: 'local', reason },
    rounds: [],
    output: { text: clipText(answer, 500), fallback: true }
  })
}
