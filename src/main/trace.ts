/**
 * PipelineTrace 记录器（主进程）
 *
 * 设计要点（见 docs/workon-ai-native-layers-spec.md）：
 *  - 内存 ring buffer，只保留最近 50 条，随应用退出清空
 *  - 单点埋点：executeTool 包装层写入 tool 事件；工具循环写入 round / output
 *  - 只读消费：渲染端隧道不反向调用能力插件
 */
import type { PipelineTrace, TraceEvent, TraceSource, TraceToolCall } from '@shared/trace'
import {
  TRACE_BUFFER_SIZE,
  TRACE_INPUT_MAX,
  clipText,
  extractTraceKeywords
} from '@shared/trace'

let sink: ((e: TraceEvent) => void) | null = null

const buffers = new Map<string, PipelineTrace>()
const order: string[] = []

/** 由 IPC 层注册推送通道，避免 trace.ts 直接依赖窗口模块 */
export function setTraceSink(fn: (e: TraceEvent) => void): void {
  sink = fn
}

function emit(trace: PipelineTrace, phase: TraceEvent['phase']): void {
  try {
    sink?.({ traceId: trace.id, phase, trace })
  } catch {
    /* 推送失败不影响主流程 */
  }
}

function makeId(): string {
  return `tr${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
}

export function startTrace(source: TraceSource, text: string): string {
  const id = makeId()
  const trace: PipelineTrace = {
    id,
    ts: Date.now(),
    source,
    input: { text: clipText(text, TRACE_INPUT_MAX), keywords: extractTraceKeywords(text) },
    route: { decided: 'llm' },
    rounds: [],
    output: { text: '' }
  }
  buffers.set(id, trace)
  order.push(id)
  while (order.length > TRACE_BUFFER_SIZE) {
    const old = order.shift()
    if (old) buffers.delete(old)
  }
  emit(trace, 'input')
  return id
}

/** 路由判定：本地直答时改写 decided 并记录原因 */
export function markRoute(traceId: string | undefined, decided: 'llm' | 'local', reason?: string): void {
  if (!traceId) return
  const trace = buffers.get(traceId)
  if (!trace) return
  trace.route = { ...trace.route, decided, reason }
  emit(trace, 'route')
}

export function beginRound(traceId: string | undefined, round: number, model: string): void {
  if (!traceId) return
  const trace = buffers.get(traceId)
  if (!trace) return
  trace.rounds.push({ round, model, toolCalls: [] })
  emit(trace, 'round')
}

export function recordToolCall(traceId: string | undefined, call: TraceToolCall): void {
  if (!traceId) return
  const trace = buffers.get(traceId)
  if (!trace) return
  // 工具调用总是紧跟在 beginRound 之后，写入最近一轮即可（避免回退路径轮次号重复）
  const target = trace.rounds[trace.rounds.length - 1]
  if (!target) return
  target.toolCalls.push(call)
  emit(trace, 'tool')
}

export function setOutput(
  traceId: string | undefined,
  text: string,
  extra?: { tokens?: number; fallback?: boolean }
): void {
  if (!traceId) return
  const trace = buffers.get(traceId)
  if (!trace) return
  trace.output = { text: clipText(text, 500), ...extra }
  emit(trace, 'output')
}

export function endTrace(traceId: string | undefined): void {
  if (!traceId) return
  const trace = buffers.get(traceId)
  if (!trace) return
  emit(trace, 'end')
}

export function getTrace(traceId: string): PipelineTrace | undefined {
  return buffers.get(traceId)
}
