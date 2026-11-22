/**
 * 关联图谱（P2 关联面板 + P3 分析预测）
 * - 索引由主进程派生（项目/任务/会话/计划/知识/工作流/目标），这里只读展示
 * - 搜索 / 类型筛选 → 节点列表 → 关联面板（1~2 跳）
 * - 分析：停滞项目 / 孤立知识 / 最大关联簇 / 关键路径预计完成
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import type {
  GraphAnalysis,
  GraphInsight,
  GraphNeighbor,
  GraphNode,
  GraphNodeKind,
  GraphViewData
} from '@shared/types'
import { PageHeader } from '../components/PageHeader'

const KIND_META: Record<GraphNodeKind, { label: string; color: string; view: string }> = {
  project: { label: '项目', color: '#22d3ee', view: 'mainline' },
  task: { label: '任务', color: '#60a5fa', view: 'mainline' },
  session: { label: '会话', color: '#a78bfa', view: 'qa' },
  plan: { label: '计划', color: '#34d399', view: 'plan' },
  knowledge: { label: '知识', color: '#fbbf24', view: 'knowledge' },
  workflow: { label: '工作流', color: '#f472b6', view: 'workflow' },
  goal: { label: '目标', color: '#f59e0b', view: 'mainline' }
}

const EDGE_LABEL: Record<string, string> = {
  belongs: '归属',
  references: '引用',
  derived: '派生'
}

const INSIGHT_COLOR: Record<GraphInsight['kind'], string> = {
  stalled: '#f59e0b',
  isolated: '#94a3b8',
  cluster: '#22d3ee',
  critical: '#f472b6'
}

const FILTERS: Array<{ key: GraphNodeKind | 'all'; label: string }> = [
  { key: 'all', label: '全部' },
  { key: 'project', label: '项目' },
  { key: 'task', label: '任务' },
  { key: 'session', label: '会话' },
  { key: 'plan', label: '计划' },
  { key: 'knowledge', label: '知识' },
  { key: 'workflow', label: '工作流' },
  { key: 'goal', label: '目标' }
]

export default function GraphView() {
  const [data, setData] = useState<GraphViewData | null>(null)
  const [analysis, setAnalysis] = useState<GraphAnalysis | null>(null)
  const [filter, setFilter] = useState<GraphNodeKind | 'all'>('all')
  const [keyword, setKeyword] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [neighbors, setNeighbors] = useState<GraphNeighbor[]>([])
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')

  const load = useCallback(async (rebuild = false): Promise<void> => {
    setBusy(true)
    try {
      if (rebuild) await window.api.graphRebuild()
      const [graph, ana] = await Promise.all([window.api.graphGet(), window.api.graphAnalyze()])
      setData(graph as GraphViewData)
      setAnalysis(ana as GraphAnalysis)
      setStatus('')
    } catch (e) {
      setStatus(`图谱加载失败：${(e as Error).message}`)
    } finally {
      setBusy(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const loadNeighbors = useCallback(async (id: string): Promise<void> => {
    try {
      setNeighbors((await window.api.graphNeighbors(id, 1)) as GraphNeighbor[])
    } catch {
      setNeighbors([])
    }
  }, [])

  const select = (id: string): void => {
    setSelectedId(id)
    void loadNeighbors(id)
  }

  const nodes = data?.nodes ?? []
  const selected = nodes.find((n) => n.id === selectedId) ?? null

  const filtered = useMemo(() => {
    const kw = keyword.trim().toLowerCase()
    return nodes
      .filter((n) => (filter === 'all' ? true : n.kind === filter))
      .filter((n) => !kw || n.label.toLowerCase().includes(kw) || (n.status ?? '').toLowerCase().includes(kw))
      .sort((a, b) => b.ts - a.ts)
      .slice(0, 200)
  }, [nodes, filter, keyword])

  const relatedTasks = useMemo(() => {
    if (!selected || selected.kind !== 'project') return []
    return neighbors.filter((x) => x.node.kind === 'task')
  }, [selected, neighbors])

  const breakdown = async (): Promise<void> => {
    if (!selected || selected.kind !== 'project') return
    setBusy(true)
    setStatus('AI 拆解中…')
    try {
      await window.api.aiBreakdown(selected.refId, `拆解项目「${selected.label}」：给出可执行的开发任务清单`)
      await load(true)
      setStatus('拆解完成：新任务已进入项目与图谱')
      void loadNeighbors(selected.id)
    } catch (e) {
      setStatus(`拆解失败：${(e as Error).message}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="view-enter flex h-full min-h-0 flex-col gap-4">
      <PageHeader
        icon="activity"
        title="图谱"
        desc="项目 / 任务 / 会话 / 计划 / 知识 / 工作流 / 目标 的关联索引：点节点看关联，分析停滞与关键路径"
        actions={
          <>
            <button className="glass-btn px-2.5 py-1.5 text-xs" disabled={busy} onClick={() => void load(true)}>
              {busy ? '重建中…' : '重建索引'}
            </button>
          </>
        }
      />

      <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
        {analysis ? (
          <>
            <span className="rounded-full px-2 py-0.5" style={{ background: 'var(--surface-2)' }}>
              节点 {analysis.stats.nodes} · 边 {analysis.stats.edges}
            </span>
            <span className="rounded-full px-2 py-0.5" style={{ background: 'var(--surface-2)' }}>
              关联簇 {analysis.stats.components} · 孤立 {analysis.stats.orphans}
            </span>
            <span className="text-2xs text-slate-600">
              索引于 {new Date(analysis.stats.builtAt).toLocaleTimeString('zh-CN', { hour12: false })}
            </span>
          </>
        ) : null}
        <span className="ml-auto text-2xs text-slate-600">{status}</span>
      </div>

      <div className="grid min-h-0 flex-1 gap-4" style={{ gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1.15fr)' }}>
        {/* 左：筛选 + 节点列表 */}
        <section className="glass-card flex min-h-0 flex-col !p-3">
          <div className="flex flex-wrap items-center gap-1">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                type="button"
                onClick={() => setFilter(f.key)}
                className={`rounded-md px-2 py-0.5 text-2xs transition-colors ${
                  filter === f.key ? 'text-white' : 'text-slate-500 hover:text-slate-300'
                }`}
                style={filter === f.key ? { background: 'var(--accent)' } : undefined}
              >
                {f.label}
              </button>
            ))}
          </div>
          <input
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="搜索节点名称 / 状态"
            className="mt-2 w-full rounded-lg px-2 py-1 text-xs text-slate-200 outline-none"
            style={{ background: 'var(--surface-2)', border: '1px solid var(--line)' }}
          />
          <div className="mt-2 min-h-0 flex-1 overflow-y-auto">
            {filtered.length ? (
              filtered.map((n) => (
                <button
                  key={n.id}
                  type="button"
                  onClick={() => select(n.id)}
                  className={`mb-0.5 flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors ${
                    selectedId === n.id ? 'bg-[var(--surface-3)]' : 'hover:bg-[var(--surface-2)]'
                  }`}
                >
                  <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: KIND_META[n.kind].color }} />
                  <span className="min-w-0 flex-1 truncate text-xs text-slate-300">{n.label}</span>
                  <span className="shrink-0 text-2xs text-slate-600">{KIND_META[n.kind].label}</span>
                </button>
              ))
            ) : (
              <div className="px-2 py-6 text-center text-2xs text-slate-600">没有匹配节点</div>
            )}
          </div>
        </section>

        {/* 右：关联面板 + 分析 */}
        <section className="flex min-h-0 flex-col gap-3 overflow-y-auto">
          <div className="glass-card !p-3">
            {selected ? (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="h-2 w-2 rounded-full" style={{ background: KIND_META[selected.kind].color }} />
                  <span className="min-w-0 truncate text-sm text-slate-100">{selected.label}</span>
                  <span className="text-2xs text-slate-500">
                    {KIND_META[selected.kind].label}
                    {selected.status ? ` · ${selected.status}` : ''}
                  </span>
                  <button
                    className="glass-btn ml-auto px-2 py-1 text-2xs"
                    onClick={() => window.api.openMain(KIND_META[selected.kind].view)}
                  >
                    打开对应页
                  </button>
                  {selected.kind === 'project' ? (
                    <button className="glass-btn primary px-2 py-1 text-2xs" disabled={busy} onClick={() => void breakdown()}>
                      AI 拆解
                    </button>
                  ) : null}
                </div>
                {selected.meta ? (
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {Object.entries(selected.meta)
                      .filter(([, v]) => v !== '' && v !== 0)
                      .slice(0, 8)
                      .map(([k, v]) => (
                        <span key={k} className="rounded-full px-2 py-0.5 text-2xs text-slate-500" style={{ background: 'var(--surface-2)' }}>
                          {k}: {String(v)}
                        </span>
                      ))}
                  </div>
                ) : null}
                <div className="mt-2 text-2xs text-slate-600">
                  {relatedTasks.length ? `未完成/关联任务 ${relatedTasks.length} 个 · ` : ''}
                  关联节点 {neighbors.length} 个（1 跳）
                </div>
                <div className="mt-1.5 max-h-64 overflow-y-auto">
                  {neighbors.length ? (
                    neighbors.map((nb) => (
                      <button
                        key={`${nb.edge.id}-${nb.node.id}`}
                        type="button"
                        onClick={() => select(nb.node.id)}
                        className="mb-0.5 flex w-full items-center gap-2 rounded-lg px-2 py-1 text-left hover:bg-[var(--surface-2)]"
                      >
                        <span className="text-2xs text-slate-600">{EDGE_LABEL[nb.edge.kind] ?? nb.edge.kind}</span>
                        <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: KIND_META[nb.node.kind].color }} />
                        <span className="min-w-0 flex-1 truncate text-xs text-slate-300">{nb.node.label}</span>
                        <span className="shrink-0 text-2xs text-slate-600">{KIND_META[nb.node.kind].label}</span>
                      </button>
                    ))
                  ) : (
                    <div className="px-2 py-3 text-2xs text-slate-600">这个节点还没有关联（在项目/知识里绑定后会出现在这里）。</div>
                  )}
                </div>
              </>
            ) : (
              <div className="px-2 py-6 text-center text-2xs text-slate-600">左侧选一个节点，这里显示它的关联面板</div>
            )}
          </div>

          <div className="glass-card !p-3">
            <div className="mb-2 flex items-center gap-2 text-2xs uppercase tracking-wider text-slate-600">
              分析
              {analysis?.criticalPath ? (
                <span className="ml-auto normal-case tracking-normal text-2xs text-slate-500">
                  关键路径预计 {analysis.criticalPath.estimatedDays} 天
                </span>
              ) : null}
            </div>
            {analysis?.insights.length ? (
              analysis.insights.map((ins, i) => (
                <button
                  key={`${ins.kind}-${i}`}
                  type="button"
                  onClick={() => ins.nodeIds[0] && select(ins.nodeIds[0])}
                  className="mb-1 block w-full rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-[var(--surface-2)]"
                  style={{ background: 'var(--surface-2)' }}
                >
                  <div className="flex items-center gap-1.5">
                    <span className="h-1.5 w-1.5 rounded-full" style={{ background: INSIGHT_COLOR[ins.kind] }} />
                    <span className="text-xs text-slate-200">{ins.title}</span>
                  </div>
                  <div className="mt-0.5 text-2xs leading-relaxed text-slate-500">{ins.detail}</div>
                </button>
              ))
            ) : (
              <div className="px-2 py-3 text-2xs text-slate-600">暂时没有发现异常——项目都在动，知识都有归处。</div>
            )}
            {analysis?.criticalPath ? (
              <div className="mt-2 rounded-lg px-2 py-1.5" style={{ background: 'var(--surface-2)' }}>
                <div className="text-2xs text-slate-500">
                  剩余 {Math.round(analysis.criticalPath.remainingMin / 60)} 小时 · 按每天 2 小时估算
                </div>
                <div className="mt-1 flex flex-wrap gap-1">
                  {analysis.criticalPath.nodes.slice(0, 8).map((n) => (
                    <button
                      key={n.id}
                      type="button"
                      onClick={() => select(n.id)}
                      className="rounded-full border border-white/[0.08] px-2 py-0.5 text-2xs text-slate-400 hover:border-white/20 hover:text-slate-200"
                    >
                      {n.label}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        </section>
      </div>
    </div>
  )
}
