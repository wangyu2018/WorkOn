/**
 * Trace 运行指标、Super Agent 评测集与脱敏导出。
 * Trace 原文仍只在内存 ring buffer；落库的只有用户显式保存的评测定义与结果。
 */
import { randomUUID } from 'crypto'
import type {
  PipelineTrace,
  TraceEvalCase,
  TraceEvalCaseInput,
  TraceExportPreview,
  TraceRunMetrics,
  TraceSubagentMetric
} from '@shared/trace'
import { genId } from '@shared/types'
import { col, insertInto, removeFrom, updateIn } from './db'
import { runSuperAgent } from './superAgent'
import { getTrace, listTraces } from './trace'

function ratio(succeeded: number, total: number): number {
  return total ? succeeded / total : 0
}

export function summarizeTraceMetrics(traces: PipelineTrace[]): TraceRunMetrics {
  const completed = traces.filter((t) => !!t.endedAt)
  const successfulRuns = completed.filter((t) => !!t.output.text.trim()).length
  const durations = completed.map((t) => Math.max(0, (t.endedAt ?? t.ts) - t.ts))
  const calls = traces.flatMap((t) => t.rounds.flatMap((r) => r.toolCalls))
  const subagents = new Map<string, TraceSubagentMetric & { totalMs: number }>()

  for (const call of calls) {
    if (call.executor?.kind !== 'subagent') continue
    const id = call.executor.id
    const current = subagents.get(id) ?? {
      id,
      label: call.executor.label,
      calls: 0,
      succeeded: 0,
      successRate: 0,
      avgMs: 0,
      totalMs: 0
    }
    current.calls += 1
    current.succeeded += call.ok ? 1 : 0
    current.totalMs += call.ms
    subagents.set(id, current)
  }

  return {
    sampleSize: traces.length,
    completedRuns: completed.length,
    successfulRuns,
    successRate: ratio(successfulRuns, completed.length),
    avgDurationMs: durations.length ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : 0,
    fallbackRuns: traces.filter((t) => t.output.fallback).length,
    toolCalls: calls.length,
    toolSuccessRate: ratio(calls.filter((c) => c.ok).length, calls.length),
    subagents: [...subagents.values()]
      .map(({ totalMs, ...item }) => ({
        ...item,
        successRate: ratio(item.succeeded, item.calls),
        avgMs: item.calls ? Math.round(totalMs / item.calls) : 0
      }))
      .sort((a, b) => a.id.localeCompare(b.id))
  }
}

export function getTraceRunMetrics(): TraceRunMetrics {
  return summarizeTraceMetrics(listTraces(50))
}

export function listTraceEvalCases(): TraceEvalCase[] {
  return [...col<TraceEvalCase>('traceEvalCases')].sort((a, b) => b.updatedAt - a.updatedAt)
}

export function saveTraceEvalCase(input: TraceEvalCaseInput): TraceEvalCase {
  const text = String(input.input ?? '').trim().slice(0, 4000)
  if (!text) throw new Error('评测问题不能为空')
  const expectedKeywords = [...new Set((input.expectedKeywords ?? []).map((k) => String(k).trim().slice(0, 40)).filter(Boolean))].slice(0, 8)
  const name = String(input.name ?? '').trim().slice(0, 60) || `${text.slice(0, 24)}${text.length > 24 ? '…' : ''}`
  const now = Date.now()
  if (input.id) {
    const id = String(input.id)
    const existing = col<TraceEvalCase>('traceEvalCases').find((item) => item.id === id)
    if (!existing) throw new Error('评测用例不存在')
    return updateIn<TraceEvalCase>('traceEvalCases', id, {
      name,
      input: text,
      expectedKeywords,
      expectedRoute: input.expectedRoute,
      updatedAt: now
    }) as TraceEvalCase
  }
  const item: TraceEvalCase = {
    id: genId('eval'),
    name,
    input: text,
    expectedKeywords,
    expectedRoute: input.expectedRoute,
    createdAt: now,
    updatedAt: now
  }
  return insertInto<TraceEvalCase>('traceEvalCases', item)
}

export function removeTraceEvalCase(id: string): boolean {
  return removeFrom('traceEvalCases', String(id))
}

/** 单条运行，避免评测集无意识触发多组模型与网页请求。 */
export async function runTraceEvalCase(id: string): Promise<TraceEvalCase> {
  const item = col<TraceEvalCase>('traceEvalCases').find((x) => x.id === id)
  if (!item) throw new Error('评测用例不存在')
  const run = await runSuperAgent(item.input)
  const trace = getTrace(run.traceId)
  const answer = run.content.toLocaleLowerCase()
  const missingKeywords = item.expectedKeywords.filter((keyword) => !answer.includes(keyword.toLocaleLowerCase()))
  const routeOk = !item.expectedRoute || trace?.route.decided === item.expectedRoute
  return updateIn<TraceEvalCase>('traceEvalCases', item.id, {
    lastResult: {
      ts: Date.now(),
      traceId: run.traceId,
      passed: !!run.content.trim() && missingKeywords.length === 0 && routeOk,
      missingKeywords,
      routeOk,
      fallback: !!trace?.output.fallback,
      outputChars: run.content.length
    }
  }) as TraceEvalCase
}

interface RedactionState {
  count: number
}

const REDACTION_RULES: Array<[RegExp, string]> = [
  [/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, '<AUTH>'],
  [/\b(?:sk-[A-Za-z0-9_-]{8,}|gh[pousr]_[A-Za-z0-9]{12,}|xox[baprs]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16})\b/g, '<TOKEN>'],
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9._-]+\.[A-Za-z0-9._-]+\b/g, '<TOKEN>'],
  [/\b(?:api[_-]?key|access[_-]?token|refresh[_-]?token|secret|password|passwd|authorization)\b\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;，；]+)/gi, '<CREDENTIAL>'],
  [/https?:\/\/[^\s<>"'）】]+/gi, '<URL>'],
  [/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '<EMAIL>'],
  [/(?:\/Users\/|\/home\/)[^\s<>"'，；]+/g, '<LOCAL_PATH>'],
  [/\b[A-Za-z]:\\(?:[^\s<>"'，；]+)/g, '<LOCAL_PATH>'],
  [/(?<!\d)1[3-9]\d{9}(?!\d)/g, '<PHONE>'],
  [/(?<!\d)\d{17}[\dXx](?!\d)/g, '<ID_NUMBER>'],
  [/\b[A-Za-z0-9_-]{32,}\b/g, '<LONG_TOKEN>']
]

function redactText(value: string, state: RedactionState): string {
  let text = String(value ?? '')
  for (const [pattern, replacement] of REDACTION_RULES) {
    text = text.replace(pattern, () => {
      state.count += 1
      return replacement
    })
  }
  return text
}

function sanitizeValue(value: unknown, state: RedactionState, depth = 0): unknown {
  if (typeof value === 'string') return redactText(value, state)
  if (value == null || typeof value === 'number' || typeof value === 'boolean') return value
  if (depth >= 5) return '<TRUNCATED>'
  if (Array.isArray(value)) return value.slice(0, 30).map((item) => sanitizeValue(item, state, depth + 1))
  if (typeof value === 'object') {
    const output: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value).slice(0, 50)) {
      if (/^(?:api[_-]?key|access[_-]?token|refresh[_-]?token|secret|password|passwd|authorization|cookie)$/i.test(key)) {
        output[key] = '<REDACTED>'
        state.count += 1
      } else {
        output[key] = sanitizeValue(item, state, depth + 1)
      }
    }
    return output
  }
  return String(value)
}

interface PendingExport {
  content: string
  records: number
  bytes: number
  createdAt: number
}

const pendingExports = new Map<string, PendingExport>()
const EXPORT_PREVIEW_TTL_MS = 10 * 60 * 1000

function pruneExports(): void {
  const cutoff = Date.now() - EXPORT_PREVIEW_TTL_MS
  for (const [id, item] of pendingExports) {
    if (item.createdAt < cutoff) pendingExports.delete(id)
  }
  while (pendingExports.size > 3) {
    const oldest = pendingExports.keys().next().value as string | undefined
    if (oldest) pendingExports.delete(oldest)
    else break
  }
}

/** 第一步：只生成预览；保存时由主进程按 id 取同一份内容，避免渲染端替换。 */
export function previewTraceExport(): TraceExportPreview {
  pruneExports()
  const traces = listTraces(50)
  if (!traces.length) throw new Error('暂无可导出的轨迹')
  const state: RedactionState = { count: 0 }
  const lines = traces.map((trace) => {
    const calls = trace.rounds.flatMap((round) => round.toolCalls)
    const record = {
      schema: 'workon.trace-eval.v1',
      traceId: trace.id,
      ts: trace.ts,
      source: trace.source,
      input: {
        text: redactText(trace.input.text, state),
        keywords: trace.input.keywords.map((keyword) => redactText(keyword, state))
      },
      route: sanitizeValue(trace.route, state),
      rounds: trace.rounds.map((round) => ({
        round: round.round,
        model: redactText(round.model, state),
        toolCalls: round.toolCalls.map((call) => ({
          name: call.name,
          args: sanitizeValue(call.args, state),
          ok: call.ok,
          ms: call.ms,
          resultPreview: redactText(call.resultPreview, state),
          error: call.error ? redactText(call.error, state) : undefined,
          target: call.target ? sanitizeValue(call.target, state) : undefined,
          executor: call.executor ? sanitizeValue(call.executor, state) : undefined
        }))
      })),
      output: {
        text: redactText(trace.output.text, state),
        tokens: trace.output.tokens,
        fallback: !!trace.output.fallback
      },
      metrics: {
        durationMs: trace.endedAt ? Math.max(0, trace.endedAt - trace.ts) : undefined,
        toolCalls: calls.length,
        failedToolCalls: calls.filter((call) => !call.ok).length,
        subagents: calls.filter((call) => call.executor?.kind === 'subagent').map((call) => call.executor?.id)
      }
    }
    return JSON.stringify(record)
  })
  const content = `${lines.join('\n')}\n`
  const id = randomUUID()
  const item = { content, records: lines.length, bytes: Buffer.byteLength(content, 'utf8'), createdAt: Date.now() }
  pendingExports.set(id, item)
  pruneExports()
  return { id, generatedAt: item.createdAt, records: item.records, bytes: item.bytes, redactions: state.count, content }
}

export function getPendingTraceExport(id: string): PendingExport {
  pruneExports()
  const item = pendingExports.get(String(id))
  if (!item) throw new Error('导出预览已失效，请重新预览')
  return item
}

export function discardPendingTraceExport(id: string): void {
  pendingExports.delete(String(id))
}
