import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { AgentView } from '@shared/agents'
import {
  WORKFLOW_NODE_CATALOG,
  type WorkflowDef,
  type WorkflowNode,
  type WorkflowNodeRun,
  type WorkflowRunRecord
} from '@shared/workflow'
import { Icon, type IconName } from '../components/Icon'

type RunStatus = WorkflowNodeRun['status']

interface WorkflowBattleBoardProps {
  def: WorkflowDef | null
  defs: WorkflowDef[]
  agents: AgentView[]
  runs: Record<string, WorkflowNodeRun>
  runRecords: WorkflowRunRecord[]
  inputText: string
  finalText: string
  busy: boolean
  status: string
  /** 已归档产物：key = 节点 id + 输出长度 */
  archived: Record<string, boolean>
  onArchive: (node: WorkflowNode) => void
  onInputChange: (value: string) => void
  onSelectWorkflow: (id: string) => void
  onRun: () => void
  onStop: () => void
  onOpenStudio: (nodeId?: string) => void
}

interface BoardMember {
  id: string
  name: string
  detail: string
  color: string
  agent?: AgentView
  nodes: WorkflowNode[]
}

interface BoardLink {
  id: string
  from: string
  to: string
  explicit?: boolean
}

interface NodePosition {
  node: WorkflowNode
  x: number
  y: number
}

interface ArtifactGroup {
  key: string
  label: string
  icon: IconName
  tone: string
  nodes: WorkflowNode[]
}

const KIND_META = Object.fromEntries(
  WORKFLOW_NODE_CATALOG.map((item) => [item.kind, item])
) as Record<WorkflowNode['kind'], (typeof WORKFLOW_NODE_CATALOG)[number]>

const STATUS_META: Record<RunStatus, { label: string; color: string; bg: string }> = {
  idle: { label: '等待', color: '#8291a8', bg: 'rgba(130,145,168,.1)' },
  running: { label: '执行中', color: '#f8c85a', bg: 'rgba(248,200,90,.12)' },
  done: { label: '已完成', color: '#45dfb2', bg: 'rgba(69,223,178,.1)' },
  error: { label: '失败', color: '#ff7e91', bg: 'rgba(255,126,145,.12)' }
}

const AGENT_STATUS: Record<AgentView['status'], string> = {
  online: '在线',
  offline: '离线',
  error: '异常',
  unavailable: '不可用',
  unknown: '未探测'
}

const BROWSER_ACTION: Record<string, string> = {
  read: '读取正文',
  extract: '提炼要点',
  screenshot: '截图',
  ask: '网页问答'
}

const MEMBER_COLORS = ['#ff967d', '#72a7ff', '#45dfb2', '#f8c85a', '#b99aff', '#5bd4e8', '#f38bb8']
const NODE_W = 150
const NODE_H = 62

function runOf(runs: Record<string, WorkflowNodeRun>, id: string): WorkflowNodeRun {
  return runs[id] ?? { nodeId: id, status: 'idle' }
}

function memberStatus(member: BoardMember, runs: Record<string, WorkflowNodeRun>): RunStatus {
  const states = member.nodes.map((node) => runOf(runs, node.id).status)
  if (states.includes('running')) return 'running'
  if (states.includes('error')) return 'error'
  if (states.length > 0 && states.every((status) => status === 'done')) return 'done'
  return 'idle'
}

function formatTime(value: number): string {
  return new Date(value).toLocaleTimeString('zh-CN', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.max(0, ms)}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)}s`
  return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`
}

function shortText(text: string, length: number): string {
  return text.length > length ? `${text.slice(0, length - 1)}…` : text
}

/** 用中文分词把输出聚成可读的词块；运行环境不支持时返回 null 交给兜底切分 */
function segmentWords(text: string, max: number): string[] | null {
  const ctor = (Intl as unknown as {
    Segmenter?: new (locale: string, options: { granularity: 'word' }) => {
      segment: (input: string) => Iterable<{ segment: string; isWordLike?: boolean }>
    }
  }).Segmenter
  if (!ctor) return null
  try {
    const segments = [...new ctor('zh-CN', { granularity: 'word' }).segment(text)]
    const words = segments.filter((item) => item.isWordLike !== false).map((item) => item.segment)
    const tokens: string[] = []
    let buffer = ''
    for (const word of words) {
      if (tokens.length >= max) break
      buffer += word
      if (buffer.length >= 3) {
        tokens.push(buffer.length > 9 ? `${buffer.slice(0, 8)}…` : buffer)
        buffer = ''
      }
    }
    if (buffer && tokens.length < max) tokens.push(buffer)
    return tokens
  } catch {
    return null
  }
}

/** 把真实输出切成短句片段，作为连线上流动的分词卡片 */
function splitTokens(text: string, max = 3): string[] {
  const plain = text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[#*_>`]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (!plain) return []
  const segmented = segmentWords(plain, max)
  if (segmented?.length) return segmented
  const parts = plain.split(/[，。、；：！？,.;:!?/\\|()[\]{}"'“”‘’\s]+/).filter(Boolean)
  const tokens: string[] = []
  for (const part of parts) {
    if (tokens.length >= max) break
    if (part.length <= 8) {
      tokens.push(part)
      continue
    }
    // 长句按块均分，避免切出单个字
    const chunks = Math.ceil(part.length / 8)
    const size = Math.ceil(part.length / chunks)
    for (let index = 0; index < part.length && tokens.length < max; index += size) {
      tokens.push(part.slice(index, index + size))
    }
  }
  return tokens
}

function buildLayout(def: WorkflowDef, links: BoardLink[], vertical: boolean): { positions: NodePosition[]; width: number; height: number } {
  const levels = new Map<string, number>()
  const visiting = new Set<string>()
  const levelOf = (id: string): number => {
    const cached = levels.get(id)
    if (cached !== undefined) return cached
    if (visiting.has(id)) return 0
    visiting.add(id)
    const upstream = links.filter((link) => link.to === id).map((link) => link.from)
    const level = upstream.length ? Math.max(...upstream.map(levelOf)) + 1 : 0
    visiting.delete(id)
    levels.set(id, level)
    return level
  }
  def.nodes.forEach((node) => levelOf(node.id))
  const groups = new Map<number, WorkflowNode[]>()
  def.nodes.forEach((node) => {
    const level = levels.get(node.id) ?? 0
    groups.set(level, [...(groups.get(level) ?? []), node])
  })
  const maxLevel = Math.max(0, ...groups.keys())
  const maxRows = Math.max(1, ...[...groups.values()].map((group) => group.length))
  const width = vertical ? Math.max(360, maxRows * (NODE_W + 18) + 26) : 760
  const height = vertical ? (maxLevel + 1) * 92 + 24 : Math.max(340, maxRows * 82 + 44)
  const positions: NodePosition[] = []
  ;[...groups.entries()].sort(([a], [b]) => a - b).forEach(([level, nodes]) => {
    if (vertical) {
      const occupied = nodes.length * (NODE_W + 18) - 18
      const startX = (width - occupied) / 2
      nodes.forEach((node, index) => positions.push({ node, x: startX + index * (NODE_W + 18), y: 20 + level * 92 }))
      return
    }
    const x = maxLevel === 0 ? (width - NODE_W) / 2 : 22 + level * ((width - NODE_W - 44) / maxLevel)
    const occupied = nodes.length * 82
    const startY = (height - occupied) / 2 + 10
    nodes.forEach((node, index) => positions.push({ node, x, y: startY + index * 82 }))
  })
  return { positions, width, height }
}

function Panel({ title, meta, children, className = '' }: { title: string; meta?: ReactNode; children: ReactNode; className?: string }): JSX.Element {
  return (
    <section className={`overflow-hidden rounded-xl border border-[#1b2b45] bg-[#0b1424]/95 ${className}`}>
      <header className="flex h-10 shrink-0 items-center gap-2 border-b border-[#182840] px-3">
        <span className="text-xs font-medium tracking-wide text-[#c9d6eb]">{title}</span>
        <span className="ml-auto max-w-[62%] truncate text-2xs text-[#60728f]">{meta}</span>
      </header>
      {children}
    </section>
  )
}

function StatusPill({ status }: { status: RunStatus }): JSX.Element {
  const meta = STATUS_META[status]
  return (
    <span className="inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-2xs" style={{ color: meta.color, background: meta.bg }}>
      <i className={`h-1.5 w-1.5 rounded-full ${status === 'running' ? 'wf-board-running' : ''}`} style={{ background: meta.color }} />
      {meta.label}
    </span>
  )
}

export function WorkflowBattleBoard({
  def,
  defs,
  agents,
  runs,
  runRecords,
  inputText,
  finalText,
  busy,
  status,
  archived,
  onArchive,
  onInputChange,
  onSelectWorkflow,
  onRun,
  onStop,
  onOpenStudio
}: WorkflowBattleBoardProps): JSX.Element {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const [topologyWidth, setTopologyWidth] = useState(760)
  const topologyRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setSelectedId(null)
  }, [def?.id])

  useEffect(() => {
    setNow(Date.now())
    if (!busy) return
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [busy])

  useEffect(() => {
    const element = topologyRef.current
    if (!element) return
    const observer = new ResizeObserver(([entry]) => setTopologyWidth(entry.contentRect.width))
    observer.observe(element)
    return () => observer.disconnect()
  }, [def?.id])

  const reduceMotion = useMemo(() => {
    try {
      return window.matchMedia('(prefers-reduced-motion: reduce)').matches
    } catch {
      return false
    }
  }, [])

  const members = useMemo<BoardMember[]>(() => {
    if (!def) return []
    const map = new Map<string, BoardMember>()
    def.nodes.forEach((node) => {
      const agent = node.agentId ? agents.find((item) => item.id === node.agentId) : undefined
      const role = node.kind === 'agent' ? node.role?.trim() : undefined
      const id = agent ? `agent:${agent.id}` : node.kind === 'agent' ? `builtin:model:${role || node.id}` : `system:${node.kind}`
      const existing = map.get(id)
      if (existing) {
        existing.nodes.push(node)
        return
      }
      const color = agent || node.kind === 'agent' ? MEMBER_COLORS[map.size % MEMBER_COLORS.length] : KIND_META[node.kind].color
      map.set(id, {
        id,
        name: agent?.name ?? (node.kind === 'agent' ? role || '内置模型' : KIND_META[node.kind].label),
        detail: agent
          ? `${agent.protocol.toUpperCase()} · ${AGENT_STATUS[agent.status]}`
          : node.kind === 'agent'
            ? '内置模型 · 按节点工作定义执行'
            : '系统执行器',
        color,
        agent,
        nodes: [node]
      })
    })
    return [...map.values()]
  }, [agents, def])

  const links = useMemo<BoardLink[]>(() => {
    if (!def) return []
    const seen = new Set<string>()
    const result: BoardLink[] = []
    const add = (from: string, to: string, id: string, explicit = false): void => {
      const key = `${from}->${to}`
      if (from === to || seen.has(key)) return
      if (!def.nodes.some((node) => node.id === from) || !def.nodes.some((node) => node.id === to)) return
      seen.add(key)
      result.push({ from, to, id, explicit })
    }
    def.edges.forEach((edge) => add(edge.from, edge.to, edge.id))
    def.nodes.forEach((node) => node.upstreamIds?.forEach((from) => add(from, node.id, `explicit:${from}:${node.id}`, true)))
    return result
  }, [def])

  const verticalTopology = topologyWidth < 560
  const layout = useMemo(
    () => (def ? buildLayout(def, links, verticalTopology) : { positions: [], width: 760, height: 340 }),
    [def, links, verticalTopology]
  )
  const positionMap = useMemo(() => new Map(layout.positions.map((item) => [item.node.id, item])), [layout])
  const memberOf = useMemo(() => {
    const map = new Map<string, BoardMember>()
    members.forEach((member) => member.nodes.forEach((node) => map.set(node.id, member)))
    return map
  }, [members])
  const selected = def?.nodes.find((node) => node.id === selectedId) ?? def?.nodes[0] ?? null
  const selectedRun = selected ? runOf(runs, selected.id) : null
  const states = def?.nodes.map((node) => runOf(runs, node.id).status) ?? []
  const doneCount = states.filter((state) => state === 'done').length
  const errorCount = states.filter((state) => state === 'error').length
  const runningCount = states.filter((state) => state === 'running').length
  const runningNode = def?.nodes.find((node) => runs[node.id]?.status === 'running')
  const runningStart = runningNode ? runs[runningNode.id]?.startedAt : undefined
  const runningMs = runningStart ? now - runningStart : 0
  const records = runRecords.filter((record) => record.workflowId === def?.id).slice(0, 4)

  const artifactGroups = useMemo<ArtifactGroup[]>(() => {
    const groups: ArtifactGroup[] = [
      { key: 'final', label: '最终产物', icon: 'check', tone: '#45dfb2', nodes: [] },
      { key: 'browser', label: '浏览器操作', icon: 'monitor', tone: '#f8c85a', nodes: [] },
      { key: 'media', label: '媒体 / 订阅', icon: 'activity', tone: '#5bd4e8', nodes: [] },
      { key: 'attachment', label: '附件 / 图像', icon: 'eye', tone: '#f38bb8', nodes: [] },
      { key: 'other', label: '其他产物', icon: 'book', tone: '#8fb9ff', nodes: [] }
    ]
    if (!def) return groups
    def.nodes.forEach((node) => {
      if (!runs[node.id]?.output?.trim()) return
      if (node.kind === 'output') groups[0].nodes.push(node)
      else if (node.kind === 'tool' && (node.toolKind === 'video' || node.toolKind === 'rss')) groups[2].nodes.push(node)
      else if (node.kind === 'tool') groups[1].nodes.push(node)
      else if (node.kind === 'image') groups[3].nodes.push(node)
      else groups[4].nodes.push(node)
    })
    return groups
  }, [def, runs])
  const artifactCount = artifactGroups.reduce((total, group) => total + group.nodes.length, 0)

  const timeline = useMemo(() => {
    const timed = Object.values(runs).filter((run) => !!run.startedAt)
    if (!timed.length) return null
    const start = Math.min(...timed.map((run) => run.startedAt as number))
    const actualEnd = Math.max(...timed.map((run) => run.endedAt ?? (run.status === 'running' ? now : (run.startedAt as number))))
    const end = Math.max(actualEnd, start + 1000)
    return { start, end, actualEnd, duration: end - start }
  }, [now, runs])

  if (!def) {
    return <div className="wf-board mt-4 rounded-2xl border border-[#1b2b45] bg-[#08101d] p-10 text-center text-sm text-[#8291a8]">正在加载工作流…</div>
  }

  return (
    <div className="wf-board mt-4 overflow-hidden rounded-2xl border border-[#1b2b45] bg-[#07101d] text-[#c9d6eb] shadow-[0_20px_60px_rgba(2,8,20,.28)]">
      <style>{`
        .wf-board { color-scheme: dark; container-type: inline-size; }
        .wf-board * { scrollbar-width: thin; scrollbar-color: #263b5b transparent; }
        @container (max-width: 720px) {
          .wf-board-grid { grid-template-columns: minmax(0, 1fr); }
          .wf-board-left { grid-row: auto; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); align-items: start; }
          .wf-board-right { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); }
          .wf-board-span { grid-column: auto; }
        }
        @container (max-width: 480px) {
          .wf-board-left, .wf-board-right { grid-template-columns: minmax(0, 1fr); }
        }
        .wf-board button:focus-visible, .wf-board select:focus-visible, .wf-board textarea:focus-visible, .wf-board [tabindex]:focus-visible { outline: 2px solid #72a7ff; outline-offset: 2px; }
        .wf-board-running { animation: wf-board-pulse 1.5s ease-in-out infinite; }
        .wf-board-flow { stroke-dasharray: 7 7; animation: wf-board-dash 1s linear infinite; }
        .wf-board-packet { filter: drop-shadow(0 0 4px rgba(114,167,255,.45)); }
        @keyframes wf-board-pulse { 0%,100% { opacity: 1; } 50% { opacity: .42; } }
        @keyframes wf-board-dash { to { stroke-dashoffset: -14; } }
        @media (prefers-reduced-motion: reduce) { .wf-board-running, .wf-board-flow { animation: none; } }
      `}</style>

      <div className="border-b border-[#1b2b45] bg-[#0a1322] px-4 py-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#172a49] text-[#8fb9ff]">
            <Icon name="command" size={16} />
          </div>
          <div className="min-w-0">
            <div className="text-2xs font-medium uppercase tracking-[.16em] text-[#6f87aa]">Workflow Operations</div>
            <select
              aria-label="当前工作流"
              value={def.id}
              onChange={(event) => onSelectWorkflow(event.target.value)}
              className="mt-0.5 max-w-[330px] cursor-pointer truncate border-0 bg-transparent p-0 text-sm font-medium text-[#edf4ff] outline-none"
            >
              {defs.map((item) => <option key={item.id} value={item.id} className="bg-[#0b1424]">{item.name}</option>)}
            </select>
          </div>
          <div className="ml-auto flex items-center gap-4 text-2xs text-[#8291a8]">
            <span><b className="mr-1 text-base font-medium text-[#edf4ff]">{members.length}</b>执行成员</span>
            <span><b className="mr-1 text-base font-medium text-[#edf4ff]">{def.nodes.length}</b>节点任务</span>
            <span><b className="mr-1 text-base font-medium text-[#45dfb2]">{doneCount}</b>已完成</span>
            <span className={runningCount ? 'text-[#f8c85a]' : ''}><b className="mr-1 text-base font-medium">{runningCount}</b>执行中</span>
            {errorCount ? <span className="text-[#ff7e91]"><b className="mr-1 text-base font-medium">{errorCount}</b>失败</span> : null}
          </div>
        </div>
      </div>

      <div className="overflow-x-auto">
        <div className="wf-board-grid grid min-w-0 grid-cols-[190px_minmax(0,1fr)_260px] gap-3 p-3">
          <aside className="wf-board-left flex min-w-0 flex-col gap-3">
            <Panel title="运行记录" meta={`${runRecords.length} 次`}>
              <div className="max-h-[150px] overflow-y-auto p-2">
                {records.length ? records.map((record) => (
                  <div key={record.id} className="mb-1.5 rounded-lg border border-[#1b2d47] bg-[#0e1a2c] p-2 last:mb-0">
                    <div className="flex items-center gap-1.5 text-2xs">
                      <i className="h-1.5 w-1.5 rounded-full" style={{ background: record.ok ? '#45dfb2' : '#ff7e91' }} />
                      <span className={record.ok ? 'text-[#a5b8d1]' : 'text-[#ff9bac]'}>{record.ok ? '运行完成' : '运行失败'}</span>
                      <span className="ml-auto text-[#5f7391]">{record.trigger === 'manual' ? '手动' : '定时'}</span>
                    </div>
                    <div className="mt-1 flex items-center text-2xs text-[#5f7391]">
                      <span>{formatTime(record.startedAt)}</span>
                      <span className="ml-auto">{formatDuration(record.endedAt - record.startedAt)} · {record.nodes} 节点</span>
                    </div>
                  </div>
                )) : <div className="px-2 py-4 text-center text-2xs text-[#5f7391]">还没有运行记录</div>}
              </div>
            </Panel>

            <Panel title="执行成员" meta={`${members.length} 位`}>
              <div className="space-y-1 p-2">
                {members.map((member) => {
                  const state = memberStatus(member, runs)
                  return (
                    <button
                      key={member.id}
                      type="button"
                      onClick={() => setSelectedId(member.nodes[0]?.id ?? null)}
                      className="flex w-full items-center gap-2 rounded-lg px-1.5 py-2 text-left transition-colors hover:bg-[#0f1d30]"
                    >
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border text-xs font-semibold" style={{ color: member.color, borderColor: `${member.color}55`, background: `${member.color}16` }}>
                        {member.name.slice(0, 1).toUpperCase()}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-xs text-[#d5e1f1]">{member.name}</div>
                        <div className="truncate text-2xs text-[#617693]">{member.detail}</div>
                      </div>
                      <StatusPill status={state} />
                    </button>
                  )
                })}
              </div>
            </Panel>

            <Panel title="任务队列" meta={`${doneCount}/${def.nodes.length}`}>
              <div className="max-h-[260px] space-y-1 overflow-y-auto p-2">
                {def.nodes.map((node, index) => {
                  const run = runOf(runs, node.id)
                  const member = memberOf.get(node.id)
                  return (
                    <button
                      key={node.id}
                      type="button"
                      onClick={() => setSelectedId(node.id)}
                      className={`w-full rounded-lg border p-2 text-left transition-colors ${selected?.id === node.id ? 'border-[#365c91] bg-[#13243b]' : 'border-transparent hover:border-[#203550] hover:bg-[#0f1d30]'}`}
                    >
                      <div className="flex items-center gap-1.5">
                        <span className="font-mono text-2xs text-[#536b8c]">T{index + 1}</span>
                        <span className="truncate text-xs text-[#c7d5e8]">{node.title}</span>
                        <span className="ml-auto"><StatusPill status={run.status} /></span>
                      </div>
                      <div className="mt-1 flex items-center gap-1 text-2xs text-[#607693]">
                        <i className="h-1 w-1 rounded-full" style={{ background: member?.color ?? '#8291a8' }} />
                        <span className="truncate">{member?.name}</span>
                        {run.ms !== undefined ? <span className="ml-auto shrink-0">{formatDuration(run.ms)}</span> : null}
                      </div>
                    </button>
                  )
                })}
              </div>
            </Panel>
          </aside>

          <div className="min-w-0">
            <Panel title="依赖拓扑" meta={busy ? `正在执行：${runningNode?.title ?? '调度中'}` : '真实连线 · 点击节点查看结果'}>
              <div ref={topologyRef} className="relative bg-[radial-gradient(circle_at_1px_1px,#1b2d47_1px,transparent_0)] [background-size:22px_22px]">
                <svg viewBox={`0 0 ${layout.width} ${layout.height}`} className="block h-auto w-full" role="img" aria-label="工作流真实依赖拓扑图">
                  <defs>
                    <marker id="wf-board-arrow" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto">
                      <path d="M0,0 L7,3.5 L0,7 Z" fill="#355273" />
                    </marker>
                    <filter id="wf-board-glow" x="-40%" y="-40%" width="180%" height="180%">
                      <feGaussianBlur stdDeviation="3" result="blur" />
                      <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
                    </filter>
                  </defs>
                  {links.map((link) => {
                    const from = positionMap.get(link.from)
                    const to = positionMap.get(link.to)
                    if (!from || !to) return null
                    const sourceRun = runOf(runs, link.from)
                    const targetRun = runOf(runs, link.to)
                    const active = sourceRun.status === 'done' && targetRun.status === 'running'
                    const complete = sourceRun.status === 'done' && targetRun.status === 'done'
                    const failed = sourceRun.status === 'error' || targetRun.status === 'error'
                    const color = failed ? '#a84961' : active || complete ? '#36b795' : '#355273'
                    const sx = verticalTopology ? from.x + NODE_W / 2 : from.x + NODE_W
                    const sy = verticalTopology ? from.y + NODE_H : from.y + NODE_H / 2
                    const tx = verticalTopology ? to.x + NODE_W / 2 : to.x
                    const ty = verticalTopology ? to.y : to.y + NODE_H / 2
                    const bend = Math.max(32, Math.abs(verticalTopology ? ty - sy : tx - sx) * 0.46)
                    const path = verticalTopology
                      ? `M ${sx} ${sy} C ${sx} ${sy + bend}, ${tx} ${ty - bend}, ${tx} ${ty}`
                      : `M ${sx} ${sy} C ${sx + bend} ${sy}, ${tx - bend} ${ty}, ${tx} ${ty}`
                    const tokens = splitTokens(sourceRun.output ?? '')
                    const sourceMember = memberOf.get(link.from)
                    const midX = (sx + tx) / 2
                    const midY = (sy + ty) / 2
                    return (
                      <g key={link.id}>
                        <path
                          d={path}
                          fill="none"
                          stroke={color}
                          strokeWidth={active ? 2 : 1.35}
                          strokeDasharray={link.explicit && !active ? '4 5' : undefined}
                          className={active ? 'wf-board-flow' : undefined}
                          markerEnd="url(#wf-board-arrow)"
                          opacity={sourceRun.status === 'idle' && targetRun.status === 'idle' ? 0.58 : 0.95}
                        />
                        {active && tokens.length && !reduceMotion
                          ? tokens.slice(0, 3).map((token, index) => {
                              const cardW = Math.max(34, Math.min(112, 14 + token.length * 8))
                              return (
                                <g key={`${link.id}-pkt-${index}`} className="wf-board-packet">
                                  <animateMotion path={path} dur="2.4s" repeatCount="indefinite" rotate="0" begin={`${index * 0.8}s`} />
                                  <rect x={-cardW / 2} y="-9" width={cardW} height="18" rx="5" fill="#0d2237" stroke={sourceMember?.color ?? '#72a7ff'} strokeWidth="0.9" opacity="0.97" />
                                  <text x="0" y="3.2" textAnchor="middle" fill="#d8e8ff" fontSize="8.5">{token}</text>
                                </g>
                              )
                            })
                          : null}
                        {complete && (sourceRun.output ?? '').trim() ? (
                          <g>
                            <rect x={midX - 21} y={midY - 8} width="42" height="16" rx="8" fill="#0a1a2b" stroke="#2a5550" strokeWidth="0.8" />
                            <text x={midX} y={midY + 3.2} textAnchor="middle" fill="#63c9ae" fontSize="8.5">
                              {`${sourceRun.output?.length ?? 0} 字`}
                            </text>
                          </g>
                        ) : null}
                      </g>
                    )
                  })}
                  {layout.positions.map(({ node, x, y }) => {
                    const run = runOf(runs, node.id)
                    const meta = STATUS_META[run.status]
                    const member = memberOf.get(node.id)
                    const selectedNode = selected?.id === node.id
                    return (
                      <g
                        key={node.id}
                        transform={`translate(${x} ${y})`}
                        role="button"
                        tabIndex={0}
                        aria-label={`${node.title}，${meta.label}`}
                        onClick={() => setSelectedId(node.id)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault()
                            setSelectedId(node.id)
                          }
                        }}
                        className="cursor-pointer"
                        filter={run.status === 'running' ? 'url(#wf-board-glow)' : undefined}
                      >
                        <title>{`${node.title} · ${member?.name ?? ''} · ${meta.label}`}</title>
                        <rect width={NODE_W} height={NODE_H} rx="10" fill={selectedNode ? '#142844' : '#0e1b2e'} stroke={run.status === 'running' || selectedNode ? meta.color : '#29405e'} strokeWidth={run.status === 'running' ? 1.8 : 1.1} />
                        <circle cx="14" cy="16" r="4" fill={member?.color ?? KIND_META[node.kind].color} className={run.status === 'running' ? 'wf-board-running' : undefined} />
                        <text x="25" y="20" fill="#d7e3f3" fontSize="11" fontWeight="500">{shortText(node.title, 11)}</text>
                        <text x="12" y="39" fill="#687f9e" fontSize="9">{shortText(member?.name ?? KIND_META[node.kind].label, 15)}</text>
                        <circle cx="13" cy="51" r="2.5" fill={meta.color} />
                        <text x="21" y="54" fill={meta.color} fontSize="9">{meta.label}</text>
                        {run.ms !== undefined ? <text x={NODE_W - 10} y="54" textAnchor="end" fill="#617795" fontSize="8">{formatDuration(run.ms)}</text> : null}
                      </g>
                    )
                  })}
                </svg>
              </div>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-[#182840] px-3 py-2 text-2xs text-[#5d7391]">
                <span>实线：画布连线</span>
                <span>虚线：显式上游</span>
                <span className="text-[#63c9ae]">流动卡片：真实输出片段正在传向下游</span>
                <span className="ml-auto">绿色：已执行</span>
              </div>
            </Panel>
          </div>

          <aside className="wf-board-right min-w-0 space-y-3">
            <Panel title="产物" meta={`${artifactCount} 份 · 按方向归类`}>
              <div className="max-h-[300px] overflow-y-auto p-2">
                {artifactCount ? artifactGroups.map((group) => group.nodes.length ? (
                  <div key={group.key} className="mb-2 last:mb-0">
                    <div className="mb-1 flex items-center gap-1.5 px-0.5 text-2xs" style={{ color: group.tone }}>
                      <Icon name={group.icon} size={11} />
                      <span>{group.label}</span>
                      <span className="ml-auto opacity-60">{group.nodes.length}</span>
                    </div>
                    {group.nodes.map((node) => {
                      const output = runs[node.id]?.output ?? ''
                      const detail = node.kind === 'tool'
                        ? node.toolKind === 'video'
                          ? '视频字幕'
                          : node.toolKind === 'rss'
                            ? 'RSS 订阅'
                            : BROWSER_ACTION[node.browserAction ?? 'read'] ?? '浏览器 / 工具'
                        : node.kind === 'image'
                          ? '图像处理结果'
                          : `${output.length} 字`
                      return (
                        <button
                          key={node.id}
                          type="button"
                          onClick={() => setSelectedId(node.id)}
                          className={`mb-1 flex w-full items-center gap-2 rounded-lg border px-2.5 py-2 text-left last:mb-0 ${group.key === 'final' ? 'border-[#245044] bg-[#0e2826] hover:border-[#367765]' : 'border-[#1b2d47] bg-[#0e1a2c] hover:border-[#2d4d70]'}`}
                        >
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-2xs text-[#b8c9dd]">{node.title}</span>
                            <span className="mt-0.5 block truncate text-2xs text-[#5f7694]">{detail}</span>
                          </span>
                          <Icon name="chevronRight" size={12} className="shrink-0 text-[#4d6583]" />
                        </button>
                      )
                    })}
                  </div>
                ) : null) : (
                  <div className="px-2 py-8 text-center text-2xs text-[#5f7391]">
                    节点完成后，产物会按最终结果 / 浏览器操作 / 媒体订阅 / 附件图像 / 其他方向归类到这里
                  </div>
                )}
              </div>
            </Panel>

            <Panel title="任务报告" meta={selected ? selected.title : '未选择'}>
              {selected ? (
                <div className="p-3">
                  <div className="flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full" style={{ background: memberOf.get(selected.id)?.color ?? KIND_META[selected.kind].color }} />
                    <span className="min-w-0 flex-1 truncate text-xs font-medium text-[#e0eaf7]">{selected.title}</span>
                    {selectedRun ? <StatusPill status={selectedRun.status} /> : null}
                  </div>
                  <div className="mt-2 text-2xs leading-relaxed text-[#6f85a3]">{selected.duty || KIND_META[selected.kind].hint}</div>
                  {selectedRun?.startedAt ? (
                    <div className="mt-2 flex items-center gap-2 font-mono text-2xs text-[#607895]">
                      <span>{formatTime(selectedRun.startedAt)}</span>
                      <span>→</span>
                      <span>{selectedRun.endedAt ? formatTime(selectedRun.endedAt) : '进行中'}</span>
                    </div>
                  ) : null}
                  <pre className={`mt-3 max-h-[220px] min-h-[92px] overflow-auto whitespace-pre-wrap rounded-lg border p-2.5 font-sans text-2xs leading-relaxed ${selectedRun?.status === 'error' ? 'border-[#51283a] bg-[#251521] text-[#ff9bac]' : 'border-[#1b2d47] bg-[#091321] text-[#9cb1ca]'}`}>
                    {selectedRun?.error || selectedRun?.output || (selectedRun?.status === 'running' ? '节点正在执行，等待真实输出…' : '尚未产生输出')}
                  </pre>
                  <button type="button" onClick={() => onOpenStudio(selected.id)} className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-[#263c5a] bg-[#101e32] py-1.5 text-2xs text-[#8ca5c4] hover:bg-[#162840] hover:text-[#c9dcf4]">
                    <Icon name="edit" size={12} />在编排中配置
                  </button>
                  <button
                    type="button"
                    disabled={!selectedRun?.output?.trim()}
                    onClick={() => onArchive(selected)}
                    title={selectedRun?.output?.trim() ? '把这条真实产物存入本地知识库，回顾页的知识沉淀会直接看到' : '该节点还没有可归档的输出'}
                    className={`mt-1.5 flex w-full items-center justify-center gap-1.5 rounded-lg border py-1.5 text-2xs transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                      archived[`${selected.id}:${(selectedRun?.output ?? '').trim().length}`]
                        ? 'border-[#2b5a4c] bg-[#0f2a24] text-[#63d9b6]'
                        : 'border-[#2c4a3f] bg-[#0f1d2a] text-[#8fb9a8] hover:bg-[#132a33] hover:text-[#a9dbc8]'
                    }`}
                  >
                    <Icon name="book" size={12} />
                    {archived[`${selected.id}:${(selectedRun?.output ?? '').trim().length}`] ? '已存入知识' : '存入知识'}
                  </button>
                </div>
              ) : null}
            </Panel>
          </aside>

          <Panel title="执行控制台" meta={busy ? '运行中' : status || '待命'} className="wf-board-span col-span-3">
            <div className="flex flex-col gap-2.5 p-3">
              <div className="flex items-stretch gap-2">
                <textarea
                  value={inputText}
                  onChange={(event) => onInputChange(event.target.value)}
                  placeholder="输入本次作战目标或原始材料，运行时会进入工作流的需求输入节点"
                  aria-label="本次工作流输入"
                  className="min-h-[46px] flex-1 resize-none rounded-lg border border-[#223651] bg-[#0d192b] px-3 py-2 text-xs leading-relaxed text-[#dce8f8] outline-none placeholder:text-[#536785]"
                />
                <div className="flex w-[116px] shrink-0 flex-col gap-1.5">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={onRun}
                    className="flex-1 rounded-lg bg-[#356fe5] px-3 text-xs font-medium text-white transition-colors hover:bg-[#4782f2] disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {busy ? '运行中…' : '运行全部'}
                  </button>
                  {busy ? (
                    <button type="button" onClick={onStop} className="rounded-lg border border-[#633246] bg-[#301827] py-1.5 text-xs text-[#ff9bac] hover:bg-[#421e30]">停止</button>
                  ) : null}
                </div>
              </div>
              <div className="flex items-center gap-3 rounded-lg border border-[#223651] bg-[#0c1828] px-3 py-2">
                <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${busy ? 'wf-board-running' : ''}`} style={{ color: busy ? '#f8c85a' : '#8fb9ff', background: busy ? '#382e19' : '#172c4c' }}>
                  <Icon name="sparkles" size={16} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-2xs font-medium text-[#dbe7f6]">拓扑调度主控</span>
                    <span className="truncate text-2xs text-[#7288a7]">
                      {runningNode ? `正在执行「${runningNode.title}」` : status || '等待运行指令'}
                    </span>
                    {runningMs > 0 ? <span className="ml-auto shrink-0 font-mono text-2xs text-[#f8c85a]">{formatDuration(runningMs)}</span> : null}
                  </div>
                  <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-[#17243a]">
                    <div className="h-full rounded-full bg-[#45dfb2] transition-[width] duration-300" style={{ width: `${def.nodes.length ? (doneCount / def.nodes.length) * 100 : 0}%` }} />
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  <div className="font-mono text-sm text-[#b9cbe2]">{doneCount}/{def.nodes.length}</div>
                  <div className="text-2xs text-[#607693]">节点进度</div>
                </div>
              </div>
            </div>
          </Panel>

          <Panel title="执行时间轴" meta={timeline ? `${formatTime(timeline.start)} — ${formatTime(timeline.actualEnd)}` : '等待真实运行数据'} className="wf-board-span col-span-3">
            <div className="p-3">
              {timeline ? (
                <>
                  <div className="mb-1 flex pl-[124px] font-mono text-2xs text-[#536b89]">
                    {[0, 0.25, 0.5, 0.75, 1].map((ratio) => <span key={ratio} className="flex-1 last:flex-none last:text-right">{formatTime(timeline.start + timeline.duration * ratio)}</span>)}
                  </div>
                  <div className="space-y-1">
                    {members.map((member) => (
                      <div key={member.id} className="flex min-h-[34px] items-center">
                        <div className="flex w-[124px] shrink-0 items-center gap-2 pr-3">
                          <i className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: member.color }} />
                          <span className="truncate text-2xs text-[#8298b4]">{member.name}</span>
                        </div>
                        <div className="relative h-[30px] min-w-0 flex-1 rounded-md bg-[#0a1525]">
                          <div className="absolute inset-x-0 top-1/2 h-px bg-[#1b2d45]" />
                          {member.nodes.map((node) => {
                            const run = runs[node.id]
                            if (!run?.startedAt) return null
                            const end = run.endedAt ?? (run.status === 'running' ? now : run.startedAt)
                            const left = ((run.startedAt - timeline.start) / timeline.duration) * 100
                            const width = ((Math.max(end, run.startedAt) - run.startedAt) / timeline.duration) * 100
                            return (
                              <button
                                key={node.id}
                                type="button"
                                title={`${node.title} · ${formatTime(run.startedAt)} — ${run.endedAt ? formatTime(run.endedAt) : '进行中'}`}
                                onClick={() => setSelectedId(node.id)}
                                className={`absolute top-[6px] h-[17px] min-w-[4px] overflow-hidden rounded-md border px-1.5 text-left text-2xs leading-[15px] ${run.status === 'running' ? 'wf-board-running' : ''}`}
                                style={{
                                  left: `${left}%`,
                                  width: `${Math.max(width, 0.7)}%`,
                                  color: STATUS_META[run.status].color,
                                  borderColor: `${STATUS_META[run.status].color}66`,
                                  background: STATUS_META[run.status].bg
                                }}
                              >
                                <span className="block truncate">{shortText(node.title, 12)}</span>
                              </button>
                            )
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <div className="flex h-[104px] flex-col items-center justify-center gap-2 text-center">
                  <Icon name="clock" size={19} className="text-[#405a7a]" />
                  <div className="text-2xs text-[#5f7592]">运行后，这里会按成员泳道绘制节点的真实开始与结束时间</div>
                </div>
              )}
            </div>
          </Panel>
        </div>
      </div>
    </div>
  )
}
