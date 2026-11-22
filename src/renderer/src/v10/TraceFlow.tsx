/**
 * P2 全局问答处理流程图
 * - PipelineTrace → 节点 / 边（输入 → 路由 → 模型 / 工具 → 输出）
 * - 边标签说明这一步传了什么数据
 * - 右页「处理流程」常驻块与「过程」弹窗共用
 */
import { useEffect, useMemo, useState } from 'react'
import type {
  PipelineTrace,
  TraceEvalCase,
  TraceExportPreview,
  TraceRunMetrics,
  TraceToolCall
} from '@shared/trace'
import { toolGroupLabel, toolMeta } from '../lib/toolUi'
import { getLatestTrace, setLatestTrace, subscribeTrace } from './traceStore'

type NodeKind = 'input' | 'route' | 'model' | 'tool' | 'output'
type NodeStatus = 'done' | 'running' | 'error' | 'idle'

export interface FlowNode {
  id: string
  kind: NodeKind
  title: string
  subtitle: string
  status: NodeStatus
  meta?: string
  input?: string
  output?: string
  error?: string
  tools?: TraceToolCall[]
}

export interface FlowEdge {
  from: string
  to: string
  label: string
}

export interface TraceGraph {
  nodes: FlowNode[]
  edges: FlowEdge[]
}

const NODE_X = 16
const NODE_W = 220
const NODE_H = 48
const GAP = 32
const PAD = 10
const LINE_X = NODE_X + NODE_W / 2

function clip(v: string, max: number): string {
  const s = (v ?? '').replace(/\s+/g, ' ').trim()
  return s.length <= max ? s : `${s.slice(0, max)}…`
}

function argsText(call: TraceToolCall): string {
  const entries = Object.entries(call.args ?? {})
  if (!entries.length) return ''
  return clip(
    entries.map(([k, v]) => `${k}=${typeof v === 'string' ? v : JSON.stringify(v)}`).join(' '),
    160
  )
}

export function buildTraceGraph(trace: PipelineTrace): TraceGraph {
  const nodes: FlowNode[] = []
  const edges: FlowEdge[] = []
  const hasOutput = !!trace.output.text
  const kw = trace.input.keywords.length

  nodes.push({
    id: 'in',
    kind: 'input',
    title: '输入',
    subtitle: clip(trace.input.text, 24) || '（空）',
    status: 'done',
    meta: `${trace.input.text.length} 字`,
    input: trace.input.text
  })
  nodes.push({
    id: 'route',
    kind: 'route',
    title: trace.route.domain === 'super_agent' ? '主 Agent 路由' : '路由',
    subtitle: trace.route.decided === 'local' ? '本地直答' : trace.route.domain === 'super_agent' ? 'Super Agent' : '模型调用',
    status: 'done',
    meta: trace.route.reason ?? (trace.route.decided === 'local' ? '规则命中' : '工具循环'),
    output: trace.route.reason
  })
  edges.push({ from: 'in', to: 'route', label: kw ? `关键词 ${kw} 个` : '原文' })

  // 本地直答 / 没有模型轮次：输入 → 路由 → 输出
  if (trace.route.decided === 'local' || trace.rounds.length === 0) {
    nodes.push(outputNode(trace, hasOutput))
    edges.push({
      from: 'route',
      to: 'out',
      label: trace.route.decided === 'local' ? '规则直答' : '无模型调用'
    })
    return { nodes, edges }
  }

  let prev = 'route'
  let prevLabel = kw ? `上下文 · ${kw} 词` : '问题'
  trace.rounds.forEach((r, idx) => {
    const isLast = idx === trace.rounds.length - 1
    const mid = `m${r.round}`
    const running = isLast && !hasOutput && r.toolCalls.length === 0
    nodes.push({
      id: mid,
      kind: 'model',
      title: `模型 · 第 ${r.round + 1} 轮`,
      subtitle: r.model,
      status: running ? 'running' : 'done',
      meta: `${r.toolCalls.length} 次工具`
    })
    edges.push({ from: prev, to: mid, label: prevLabel })
    prev = mid
    prevLabel = '下一轮'

    if (r.toolCalls.length) {
      const ok = r.toolCalls.filter((c) => c.ok).length
      const first = r.toolCalls[0]
      const onlySubagents = r.toolCalls.every((c) => c.executor?.kind === 'subagent')
      if (onlySubagents) {
        r.toolCalls.forEach((call, callIdx) => {
          const tid = `t${r.round}-${callIdx}`
          nodes.push({
            id: tid,
            kind: 'tool',
            title: call.executor?.label ?? toolMeta(call.name).label,
            subtitle: call.ok ? clip(call.resultPreview, 28) : '失败已隔离',
            status: call.ok ? 'done' : 'error',
            meta: `${call.ms}ms · ${call.executor?.id ?? 'agent'}`,
            tools: [call],
            error: call.error
          })
          edges.push({
            from: prev,
            to: tid,
            label: `任务 · ${clip(String(call.args.query ?? call.name), 14)}`
          })
          prev = tid
          prevLabel = call.ok ? '只读结果' : '失败已隔离'
        })
      } else {
        const tid = `t${r.round}`
        nodes.push({
          id: tid,
          kind: 'tool',
          title: `工具调用 · ${r.toolCalls.length}`,
          subtitle: `${toolMeta(first.name).label}${r.toolCalls.length > 1 ? ` +${r.toolCalls.length - 1}` : ''}`,
          status: ok === r.toolCalls.length ? 'done' : 'error',
          meta: `${toolGroupLabel(first.name)} · ${ok}/${r.toolCalls.length} 成功`,
          tools: r.toolCalls,
          error: r.toolCalls.find((c) => !c.ok)?.error
        })
        edges.push({
          from: prev,
          to: tid,
          label: `参数 · ${clip(argsText(first), 14) || first.name}`
        })
        prev = tid
        prevLabel = `结果 · ${ok}/${r.toolCalls.length}`
      }
    }
  })

  nodes.push(outputNode(trace, hasOutput))
  edges.push({
    from: prev,
    to: 'out',
    label: hasOutput ? `回答 · ${trace.output.text.length} 字` : '等待输出'
  })
  return { nodes, edges }
}

function outputNode(trace: PipelineTrace, hasOutput: boolean): FlowNode {
  return {
    id: 'out',
    kind: 'output',
    title: '输出',
    subtitle: hasOutput ? clip(trace.output.text, 24) : '等待输出',
    status: hasOutput ? 'done' : 'running',
    meta: hasOutput ? `${trace.output.text.length} 字` : '',
    output: trace.output.text
  }
}

export function TraceFlow({
  graph,
  selectedId,
  onSelect
}: {
  graph: TraceGraph
  selectedId?: string | null
  onSelect?: (id: string) => void
}): JSX.Element {
  const yOf = useMemo(() => {
    const map = new Map<string, number>()
    graph.nodes.forEach((n, i) => map.set(n.id, PAD + i * (NODE_H + GAP)))
    return map
  }, [graph])
  const height = PAD * 2 + graph.nodes.length * NODE_H + Math.max(0, graph.nodes.length - 1) * GAP
  const selectable = !!onSelect

  return (
    <svg
      className="v10-trace-svg"
      viewBox={`0 0 360 ${height}`}
      width="100%"
      height="auto"
      role="img"
      aria-label="问答处理流程"
    >
      <defs>
        <marker
          id="v10-tf-ar"
          viewBox="0 0 8 8"
          refX="7"
          refY="4"
          markerWidth="8"
          markerHeight="8"
          markerUnits="userSpaceOnUse"
          orient="auto"
        >
          <path d="M1 1 L7 4 L1 7 Z" fill="var(--tf-muted)" />
        </marker>
      </defs>

      {graph.edges.map((e, i) => {
        const y1 = (yOf.get(e.from) ?? 0) + NODE_H
        const y2 = yOf.get(e.to) ?? y1 + GAP
        const mid = y1 + (y2 - y1) / 2
        const label = clip(e.label, 16)
        const w = Math.min(190, 16 + label.length * 11)
        return (
          <g key={`${e.from}-${e.to}-${i}`}>
            <path className="v10-tf-arr" d={`M${LINE_X} ${y1} V${y2 - 5}`} markerEnd="url(#v10-tf-ar)" />
            <rect className="v10-tf-elabel" x={LINE_X + 12} y={mid - 9} width={w} height={18} rx={9} />
            <text className="v10-tf-edge" x={LINE_X + 20} y={mid + 4}>
              {label}
            </text>
          </g>
        )
      })}

      {graph.nodes.map((n) => {
        const y = yOf.get(n.id) ?? 0
        return (
          <g
            key={n.id}
            className="v10-tf-g"
            onClick={selectable ? () => onSelect?.(n.id) : undefined}
            role={selectable ? 'button' : undefined}
            tabIndex={selectable ? 0 : undefined}
            onKeyDown={
              selectable
                ? (e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      onSelect?.(n.id)
                    }
                  }
                : undefined
            }
          >
            <rect
              className={`v10-tf-node${selectedId === n.id ? ' sel' : ''}`}
              x={NODE_X}
              y={y}
              width={NODE_W}
              height={NODE_H}
              rx={8}
            />
            <rect className={`v10-tf-accent ${n.kind}`} x={NODE_X} y={y + 10} width={3} height={NODE_H - 20} rx={1.5} />
            <text className="v10-tf-title" x={NODE_X + 12} y={y + 20}>
              {clip(n.title, 22)}
            </text>
            <text className="v10-tf-sub" x={NODE_X + 12} y={y + 37}>
              {clip(n.subtitle, 30)}
            </text>
            <circle className={`v10-tf-dot ${n.status}`} cx={NODE_X + NODE_W - 10} cy={y + 14} r={3.5} />
          </g>
        )
      })}
    </svg>
  )
}

export function TraceNodeDetail({ node }: { node: FlowNode }): JSX.Element {
  return (
    <div className="v10-trace-detail">
      <div className="v10-trace-detail-head">
        <b>{node.title}</b>
        {node.meta ? <span>{node.meta}</span> : null}
      </div>
      {node.error ? <div className="v10-trace-error">{clip(node.error, 200)}</div> : null}
      {node.input ? (
        <div>
          <span className="k">输入</span>
          <span className="v">{clip(node.input, 240)}</span>
        </div>
      ) : null}
      {node.output ? (
        <div>
          <span className="k">输出</span>
          <span className="v">{clip(node.output, 240)}</span>
        </div>
      ) : null}
      {node.tools?.map((c, i) => (
        <div className="v10-trace-tool" key={`${c.name}-${i}`}>
          <div>
            <span className="k">{c.executor?.label ?? toolMeta(c.name).label}</span>
            <span className="v">
              {c.ok ? '成功' : '失败'} · {c.ms}ms
            </span>
          </div>
          {argsText(c) ? <div className="v">{argsText(c)}</div> : null}
          {c.error ? (
            <div className="v10-trace-error">{clip(c.error, 160)}</div>
          ) : c.resultPreview ? (
            <div className="v">{clip(c.resultPreview, 200)}</div>
          ) : null}
        </div>
      ))}
      {!node.input && !node.output && !node.tools?.length && !node.error ? (
        <div className="v">这个节点没有额外数据。</div>
      ) : null}
    </div>
  )
}

function timeAgo(ts: number): string {
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000))
  if (s < 10) return '刚刚'
  if (s < 60) return `${s}s 前`
  const m = Math.round(s / 60)
  if (m < 60) return `${m}m 前`
  return new Date(ts).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
}

function percent(value: number): string {
  return `${Math.round(value * 100)}%`
}

function duration(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`
}

function TraceOpsPanel({
  metrics,
  cases,
  currentTrace,
  onRefresh
}: {
  metrics: TraceRunMetrics | null
  cases: TraceEvalCase[]
  currentTrace: PipelineTrace | null
  onRefresh: () => Promise<void>
}): JSX.Element {
  const [editingId, setEditingId] = useState('')
  const [input, setInput] = useState('')
  const [keywords, setKeywords] = useState('')
  const [expectedRoute, setExpectedRoute] = useState<'' | 'llm' | 'local'>('')
  const [runningId, setRunningId] = useState('')
  const [message, setMessage] = useState('')
  const [preview, setPreview] = useState<TraceExportPreview | null>(null)
  const [saving, setSaving] = useState(false)

  const resetEditor = (): void => {
    setEditingId('')
    setInput('')
    setKeywords('')
    setExpectedRoute('')
  }

  const editCase = (item: TraceEvalCase): void => {
    setEditingId(item.id)
    setInput(item.input)
    setKeywords(item.expectedKeywords.join('，'))
    setExpectedRoute(item.expectedRoute ?? '')
    setMessage('')
  }

  const saveCase = async (): Promise<void> => {
    if (!input.trim()) return
    setMessage('正在保存用例…')
    try {
      await window.api.saveTraceEvalCase({
        id: editingId || undefined,
        input,
        expectedKeywords: keywords.split(/[,，\n]/).map((item) => item.trim()).filter(Boolean),
        expectedRoute: expectedRoute || undefined
      })
      resetEditor()
      setMessage('用例已保存到本地。')
      await onRefresh()
    } catch (error) {
      setMessage((error as Error).message)
    }
  }

  const runCase = async (id: string): Promise<void> => {
    setRunningId(id)
    setMessage('正在通过 Super Agent 运行单条评测…')
    try {
      const result = await window.api.runTraceEvalCase(id) as TraceEvalCase
      setMessage(result.lastResult?.passed ? '评测通过。' : '评测未通过，请查看缺失关键词与路由结果。')
      await onRefresh()
    } catch (error) {
      setMessage((error as Error).message)
    } finally {
      setRunningId('')
    }
  }

  const createPreview = async (): Promise<void> => {
    setMessage('正在生成脱敏预览…')
    try {
      setPreview(await window.api.previewTraceExport() as TraceExportPreview)
      setMessage('预览仅生成在内存中；确认保存前不会写入文件。')
    } catch (error) {
      setMessage((error as Error).message)
    }
  }

  const saveExport = async (): Promise<void> => {
    if (!preview) return
    setSaving(true)
    try {
      const result = await window.api.saveTraceExport(preview.id, true) as { ok: boolean; canceled?: boolean; filePath?: string }
      if (result.ok) {
        setMessage(`已保存：${result.filePath}`)
        setPreview(null)
      } else if (result.canceled) {
        setMessage('已取消保存，未写入文件。')
      }
    } catch (error) {
      setMessage((error as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="v10-trace-ops">
      <div className="v10-trace-metrics">
        <div><b>{metrics ? `${metrics.sampleSize}/50` : '—'}</b><span>内存样本</span></div>
        <div><b>{metrics ? percent(metrics.successRate) : '—'}</b><span>完成成功率</span></div>
        <div><b>{metrics ? duration(metrics.avgDurationMs) : '—'}</b><span>平均耗时</span></div>
        <div><b>{metrics?.fallbackRuns ?? '—'}</b><span>降级次数</span></div>
      </div>
      <div className="v10-trace-tool-metric">
        工具 {metrics?.toolCalls ?? 0} 次 · 成功率 {metrics ? percent(metrics.toolSuccessRate) : '—'}
      </div>
      {metrics?.subagents.length ? (
        <div className="v10-trace-subagents">
          {metrics.subagents.map((agent) => (
            <div key={agent.id}>
              <span>{agent.label}</span>
              <b>{percent(agent.successRate)}</b>
              <small>{agent.calls} 次 · 均 {duration(agent.avgMs)}</small>
            </div>
          ))}
        </div>
      ) : null}

      <div className="v10-trace-ops-section">
        <div className="v10-trace-ops-title"><b>Super Agent 评测集</b><span>只单条运行，不批量触发</span></div>
        <textarea
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder="输入一个开放型只读问题"
          rows={2}
        />
        <input
          value={keywords}
          onChange={(event) => setKeywords(event.target.value)}
          placeholder="期望答案包含的关键词，用逗号分隔"
        />
        <div className="v10-trace-eval-editor">
          <select value={expectedRoute} onChange={(event) => setExpectedRoute(event.target.value as '' | 'llm' | 'local')}>
            <option value="">不校验路由</option>
            <option value="llm">模型 / Super Agent</option>
            <option value="local">本地直答</option>
          </select>
          <button disabled={!input.trim() || !!runningId} onClick={() => void saveCase()}>{editingId ? '更新用例' : '保存用例'}</button>
          {editingId ? <button onClick={resetEditor}>取消编辑</button> : null}
          <button
            disabled={!currentTrace || !!runningId}
            onClick={() => {
              resetEditor()
              setInput(currentTrace?.input.text ?? '')
            }}
          >填入当前问题</button>
        </div>
        <div className="v10-trace-eval-list">
          {cases.map((item) => (
            <div className="v10-trace-eval-case" key={item.id}>
              <button className="name" onClick={() => editCase(item)} title={item.input}>{item.name}</button>
              {item.lastResult ? (
                <span className={item.lastResult.passed ? 'pass' : 'fail'}>
                  {item.lastResult.passed ? '通过' : '未通过'} · {item.lastResult.outputChars} 字
                  {item.lastResult.missingKeywords.length ? ` · 缺 ${item.lastResult.missingKeywords.join('、')}` : ''}
                  {!item.lastResult.routeOk ? ' · 路由不符' : ''}
                  {item.lastResult.fallback ? ' · 降级' : ''}
                </span>
              ) : <span>未运行</span>}
              <button disabled={!!runningId} onClick={() => void runCase(item.id)}>{runningId === item.id ? '运行中' : '运行'}</button>
              <button onClick={() => void window.api.removeTraceEvalCase(item.id).then(onRefresh)}>删除</button>
            </div>
          ))}
        </div>
      </div>

      <div className="v10-trace-ops-section">
        <div className="v10-trace-ops-title"><b>脱敏 JSONL</b><span>最近 50 条 · 不上传</span></div>
        <button onClick={() => void createPreview()}>预览导出内容</button>
        {preview ? (
          <div className="v10-trace-export-preview">
            <div>{preview.records} 条 · {(preview.bytes / 1024).toFixed(1)} KB · 已脱敏 {preview.redactions} 处</div>
            <textarea readOnly value={preview.content} rows={7} />
            <div className="v10-trace-export-actions">
              <button disabled={saving} onClick={() => void saveExport()}>{saving ? '等待保存…' : '确认保存到本地'}</button>
              <button disabled={saving} onClick={() => setPreview(null)}>取消</button>
            </div>
          </div>
        ) : null}
      </div>
      {message ? <div className="v10-trace-ops-message">{message}</div> : null}
    </div>
  )
}

/** 右页常驻块：最新一次问答的处理流程 */
export function TraceFlowBlock(): JSX.Element {
  const [trace, setTrace] = useState<PipelineTrace | null>(() => getLatestTrace())
  const [open, setOpen] = useState<boolean>(() => {
    try {
      return window.localStorage.getItem('v10-trace-open') !== '0'
    } catch {
      return true
    }
  })
  const [selected, setSelected] = useState<string | null>(null)
  const [opsOpen, setOpsOpen] = useState(false)
  const [metrics, setMetrics] = useState<TraceRunMetrics | null>(null)
  const [evalCases, setEvalCases] = useState<TraceEvalCase[]>([])
  const [opsError, setOpsError] = useState('')

  useEffect(() => {
    let alive = true
    const apply = (t: PipelineTrace): void => {
      if (alive) setTrace(t)
    }
    const unsub = subscribeTrace(apply)
    void window.api
      ?.listAITraces?.(1)
      .then((xs) => {
        const first = (xs as PipelineTrace[] | undefined)?.[0]
        if (alive && first) setLatestTrace(first)
      })
      .catch(() => undefined)
    const off = window.api?.onAITrace?.((e) => {
      if (alive && e?.trace) setLatestTrace(e.trace)
    })
    return () => {
      alive = false
      unsub()
      off?.()
    }
  }, [])

  useEffect(() => {
    setSelected(null)
  }, [trace?.id])

  const refreshOps = async (): Promise<void> => {
    try {
      const [nextMetrics, nextCases] = await Promise.all([
        window.api.getAITraceMetrics(),
        window.api.listTraceEvalCases()
      ])
      setMetrics(nextMetrics as TraceRunMetrics)
      setEvalCases(nextCases as TraceEvalCase[])
      setOpsError('')
    } catch (error) {
      setOpsError((error as Error).message)
    }
  }

  useEffect(() => {
    if (opsOpen) void refreshOps()
  }, [opsOpen, trace?.endedAt])

  const graph = useMemo(() => (trace ? buildTraceGraph(trace) : null), [trace])
  const node = graph?.nodes.find((n) => n.id === selected) ?? null
  const toggle = (): void => {
    setOpen((v) => {
      const next = !v
      try {
        window.localStorage.setItem('v10-trace-open', next ? '1' : '0')
      } catch {
        /* ignore */
      }
      return next
    })
  }

  return (
    <section className="v10-block v10-trace-block v10-trace-scope">
      <div className="v10-block-kick">
        <span className="aura-mark">◇</span>
        <span>处理流程</span>
        <span>· {trace ? `${graph?.nodes.length ?? 0} 个节点` : '等一次问答'}</span>
        <span className="acts">
          {trace ? <span className="v10-trace-time">{timeAgo(trace.ts)}</span> : null}
          <button onClick={() => { setOpsOpen((value) => !value); setOpen(true) }}>{opsOpen ? '隐藏观测' : '观测'}</button>
          <button onClick={toggle}>{open ? '收起' : '展开'}</button>
        </span>
      </div>
      {open ? (
        <>
          {graph && trace ? (
            <>
              <TraceFlow graph={graph} selectedId={selected} onSelect={setSelected} />
              {node ? (
                <TraceNodeDetail node={node} />
              ) : (
                <div className="v10-trace-hint">点节点看输入 / 输出与耗时；边上的标签是这一步传了什么。</div>
              )}
            </>
          ) : (
            <div className="v10-trace-empty">
              问一句，这里会显示「输入 → 路由 → 工具 → 模型 → 输出」的全过程，边上标着传了什么数据。
            </div>
          )}
          {opsOpen ? (
            <TraceOpsPanel metrics={metrics} cases={evalCases} currentTrace={trace} onRefresh={refreshOps} />
          ) : null}
          {opsError ? <div className="v10-trace-error">{opsError}</div> : null}
        </>
      ) : null}
    </section>
  )
}
