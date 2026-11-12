/**
 * L2 隧道：一次 AI 处理的完整过程（输入 → 路由 → 工具 → 模型 → 输出）
 *
 * P0 形态：纯文本纵向列表，无动画。
 * 数据来自 PipelineTrace（主进程内存 ring buffer），本组件只读，不调用任何能力插件。
 */
import { useEffect, useState } from 'react'
import type { PipelineTrace, TraceToolCall } from '@shared/trace'
import { ModalShell } from './ui/Modal'
import { Icon } from './Icon'
import { toolGroupLabel, toolMeta } from '../lib/toolUi'

const SOURCE_LABEL: Record<PipelineTrace['source'], string> = {
  qa: '问答',
  today: '今天',
  plan: '计划',
  pet: '桌宠'
}

const ROUTE_LABEL: Record<PipelineTrace['route']['decided'], string> = {
  llm: '模型调用',
  local: '本地直答'
}

const ROUTE_REASON: Record<string, string> = {
  llm_unavailable: '模型不可用，回退本地规则',
  stream_fallback: '流式失败，回退非流式',
  round_limit: '工具轮次超限，回退普通对话'
}

function clip(v: string, max: number): string {
  return v.length <= max ? v : `${v.slice(0, max)}…`
}

function argsText(call: TraceToolCall): string {
  const entries = Object.entries(call.args)
  if (entries.length === 0) return ''
  return clip(
    entries.map(([k, v]) => `${k}=${typeof v === 'string' ? v : JSON.stringify(v)}`).join(' '),
    120
  )
}

function hitKeywords(call: TraceToolCall, keywords: string[]): string[] {
  const haystack = `${JSON.stringify(call.args)} ${call.resultPreview}`
  return keywords.filter((k) => k.length > 1 && haystack.includes(k)).slice(0, 3)
}

function ToolRow({ call, keywords }: { call: TraceToolCall; keywords: string[] }) {
  const meta = toolMeta(call.name)
  const hits = hitKeywords(call, keywords)
  const detail = argsText(call)
  return (
    <div
      style={{
        padding: '8px 0',
        borderTop: '1px dashed var(--line)',
        display: 'flex',
        gap: 8,
        alignItems: 'flex-start'
      }}
    >
      <span
        aria-hidden
        style={{
          width: 6,
          height: 6,
          borderRadius: 999,
          marginTop: 7,
          flexShrink: 0,
          background: call.ok ? 'var(--teal)' : '#EF4444'
        }}
      />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
          <span style={{ fontSize: 13, color: 'var(--text-1)' }}>{meta.label}</span>
          <span style={{ fontSize: 11, color: 'var(--text-3)' }}>{toolGroupLabel(call.name)}</span>
          <span style={{ fontSize: 11, color: 'var(--text-3)', marginLeft: 'auto' }}>{call.ms}ms</span>
        </div>
        {detail ? (
          <div
            style={{
              fontSize: 11,
              color: 'var(--text-3)',
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
              marginTop: 3,
              wordBreak: 'break-all'
            }}
          >
            {detail}
          </div>
        ) : null}
        {hits.length ? (
          <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 3 }}>关键词命中：{hits.join(' · ')}</div>
        ) : null}
        {call.error ? (
          <div style={{ fontSize: 11, color: '#EF4444', marginTop: 3 }}>{clip(call.error, 120)}</div>
        ) : call.resultPreview ? (
          <div style={{ fontSize: 11, color: 'var(--text-2)', marginTop: 3 }}>{clip(call.resultPreview, 140)}</div>
        ) : null}
      </div>
    </div>
  )
}

export function TraceTunnel({ traceId, onClose }: { traceId: string | null; onClose: () => void }) {
  const [trace, setTrace] = useState<PipelineTrace | null>(null)

  useEffect(() => {
    if (!traceId) {
      setTrace(null)
      return
    }
    let alive = true
    void window.api
      ?.getAITrace?.(traceId)
      .then((t) => {
        if (alive && t) setTrace(t as PipelineTrace)
      })
      .catch(() => undefined)
    const off = window.api?.onAITrace?.((e) => {
      if (alive && e.traceId === traceId) setTrace(e.trace)
    })
    return () => {
      alive = false
      off?.()
    }
  }, [traceId])

  const toolCount = trace?.rounds.reduce((n, r) => n + r.toolCalls.length, 0) ?? 0

  return (
    <ModalShell open={!!traceId} onClose={onClose} labelledBy="trace-tunnel-title" bare>
      <div
        style={{
          width: 560,
          maxWidth: '92vw',
          maxHeight: '80vh',
          overflowY: 'auto',
          background: 'var(--surface-2)',
          border: '1px solid var(--line)',
          borderRadius: 'var(--r-lg)',
          padding: 20,
          color: 'var(--text-1)',
          fontSize: 13
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span id="trace-tunnel-title" style={{ fontSize: 15, color: 'var(--text-1)' }}>
            本次处理
          </span>
          {trace ? (
            <span
              style={{
                fontSize: 11,
                color: 'var(--text-3)',
                border: '1px solid var(--line)',
                borderRadius: 999,
                padding: '1px 8px'
              }}
            >
              {SOURCE_LABEL[trace.source]}
            </span>
          ) : null}
          <button
            onClick={onClose}
            aria-label="关闭"
            style={{
              marginLeft: 'auto',
              background: 'transparent',
              border: 'none',
              color: 'var(--text-3)',
              cursor: 'pointer',
              padding: 4
            }}
          >
            <Icon name="x" size={16} />
          </button>
        </div>

        {!trace ? (
          <div style={{ color: 'var(--text-3)', padding: '24px 0' }}>读取中，或本次未记录处理过程。</div>
        ) : (
          <>
            <div style={{ marginTop: 16 }}>
              <div style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 6 }}>输入</div>
              <div style={{ color: 'var(--text-1)', lineHeight: 1.6 }}>{clip(trace.input.text, 180)}</div>
              {trace.input.keywords.length ? (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                  {trace.input.keywords.map((k) => (
                    <span
                      key={k}
                      style={{
                        fontSize: 11,
                        color: 'var(--text-2)',
                        border: '1px solid var(--line)',
                        borderRadius: 999,
                        padding: '1px 8px'
                      }}
                    >
                      {k}
                    </span>
                  ))}
                </div>
              ) : null}
            </div>

            <div style={{ marginTop: 16, paddingTop: 12, borderTop: '1px solid var(--line)' }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
                <span style={{ fontSize: 11, color: 'var(--text-3)' }}>路由</span>
                <span style={{ color: 'var(--text-1)' }}>{ROUTE_LABEL[trace.route.decided]}</span>
                {trace.route.reason ? (
                  <span style={{ fontSize: 11, color: 'var(--text-3)' }}>
                    {ROUTE_REASON[trace.route.reason] ?? trace.route.reason}
                  </span>
                ) : null}
              </div>
            </div>

            <div style={{ marginTop: 16, paddingTop: 12, borderTop: '1px solid var(--line)' }}>
              <div style={{ fontSize: 11, color: 'var(--text-3)' }}>
                工具调用 · {toolCount} 个插件
              </div>
              {trace.rounds.length === 0 ? (
                <div style={{ color: 'var(--text-3)', padding: '8px 0' }}>尚未开始调用</div>
              ) : (
                trace.rounds.map((r, ri) => (
                  <div key={`${r.round}-${ri}`} style={{ marginTop: 8 }}>
                    <div style={{ fontSize: 11, color: 'var(--text-3)' }}>
                      第 {r.round + 1} 轮 · {r.model}
                    </div>
                    {r.toolCalls.length === 0 ? (
                      <div style={{ fontSize: 12, color: 'var(--text-3)', padding: '6px 0' }}>
                        无工具调用，直接生成回答
                      </div>
                    ) : (
                      r.toolCalls.map((c, i) => <ToolRow key={`${r.round}-${i}`} call={c} keywords={trace.input.keywords} />)
                    )}
                  </div>
                ))
              )}
            </div>

            <div style={{ marginTop: 16, paddingTop: 12, borderTop: '1px solid var(--line)' }}>
              <div style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 6 }}>输出</div>
              <div style={{ color: 'var(--text-2)', lineHeight: 1.6 }}>
                {trace.output.text ? clip(trace.output.text, 200) : '尚未产出'}
              </div>
              {trace.output.fallback ? (
                <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 6 }}>
                  本地直答，未调用外部插件
                </div>
              ) : null}
            </div>

            <div style={{ marginTop: 16, paddingTop: 12, borderTop: '1px solid var(--line)', fontSize: 11, color: 'var(--text-3)' }}>
              仅保留最近 50 次处理，退出应用即清空
            </div>
          </>
        )}
      </div>
    </ModalShell>
  )
}
