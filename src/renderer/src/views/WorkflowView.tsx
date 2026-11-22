/**
 * 工作流 Studio：可视化编排 + 节点即 Agent + 每一步输入/输出可见
 * - 节点：角色 / 工作定义 / 输出物 → 自动拼系统提示词
 * - 连线：下游读取上游输出；也可显式增加上游（跨层级）
 * - 图像节点：视觉模型优先，不支持视觉时自动 OCR
 * - 群组节点：聚合子节点与上游，形成动态层级
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { ChatSession, Project } from '@shared/types'
import type { AgentListResult, AgentView } from '@shared/agents'
import {
  WORKFLOW_NODE_CATALOG,
  type WorkflowAutomationCapabilities,
  type WorkflowBrowserSite,
  type WorkflowCollectResult,
  type WorkflowDef,
  type WorkflowEdge,
  type WorkflowModelsResult,
  type WorkflowNode,
  type WorkflowNodeKind,
  type WorkflowNodeRun,
  type WorkflowRunRecord,
  type WorkflowRunResult,
  type WorkflowSchedule
} from '@shared/workflow'
import { PageHeader } from '../components/PageHeader'
import { Icon } from '../components/Icon'
import { WorkflowBattleBoard } from './WorkflowBattleBoard'

type WorkflowApi = {
  workflowList: () => Promise<{ workflows: WorkflowDef[] }>
  workflowSave: (def: WorkflowDef) => Promise<{ ok: boolean; error?: string }>
  workflowRemove: (id: string) => Promise<boolean>
  workflowModels: (force?: boolean) => Promise<WorkflowModelsResult>
  workflowRun: (req: {
    model?: string
    system?: string
    prompt: string
    images?: string[]
    timeoutMs?: number
    think?: boolean
  }) => Promise<WorkflowRunResult>
  workflowCancel: () => Promise<{ ok: boolean }>
  /** 主进程完整运行（定时方式）+ 运行记录 */
  workflowRuns: (id?: string) => Promise<WorkflowRunRecord[]>
  workflowRunById: (id: string, input?: string) => Promise<WorkflowRunRecord>
  onWorkflowRunDone: (cb: (rec: WorkflowRunRecord) => void) => () => void
  /** 外部 Agent 注册表（节点执行方式选择用） */
  listAgents: () => Promise<AgentListResult>
  dispatchAgent: (
    id: string,
    prompt: string,
    cwd?: string,
    confirm?: boolean
  ) => Promise<{ ok: boolean; output: string; error?: string; durationMs: number }>
  workflowOcr: (dataUrl: string) => Promise<{ ok: boolean; text: string; error?: string }>
  workflowCollect: () => Promise<WorkflowCollectResult>
  workflowAutomation: () => Promise<WorkflowAutomationCapabilities>
  /** 视频字幕（本机 yt-dlp）/ RSS 阅读 */
  workflowVideo: (input: { url?: string; langs?: string; maxChars?: number }) => Promise<{ ok: boolean; text: string; title?: string; error?: string }>
  workflowFeed: (input: { url?: string; limit?: number }) => Promise<{ ok: boolean; text: string; title?: string; error?: string }>
  /** 产物归档：写入本地知识库 */
  addKnowledge: (p: {
    title?: string
    body?: string
    source?: string
    links?: Array<{ type: string; id: string; title?: string }>
    tags?: string[]
  }) => Promise<{ id: string; title: string } | null>
  /** 会话（问答页共享的 chatSessions）：节点可接续已有会话或新建会话 */
  listSessions: () => Promise<ChatSession[]>
  createSession: (input: {
    title?: string
    topic?: string
    target?: { kind: 'local' } | { kind: 'node'; nodeId: string }
    first?: { role: 'user' | 'ai'; text: string; time: number }
  }) => Promise<ChatSession>
  addSessionItem: (
    id: string,
    item: { role: 'user' | 'ai'; text: string; time: number }
  ) => Promise<ChatSession | null>
  /** 浏览器节点：内置浏览器 / 本机 Chrome 走同一套接口 */
  browserNavigate: (url: string) => Promise<{ ok: boolean; detail?: string; error?: string }>
  browserAsk: (input: {
    site?: WorkflowBrowserSite
    url?: string
    question: string
    answerSelector?: string
    timeoutMs?: number
  }) => Promise<{ ok: boolean; answer?: string; title?: string; url?: string; waitedMs?: number; error?: string }>
  browserRead: () => Promise<{ ok: boolean; title?: string; url?: string; text?: string; error?: string }>
  browserScreenshot: () => Promise<{ ok: boolean; dataUrl?: string; path?: string; error?: string }>
  listProjects: () => Promise<Project[]>
  /** 把画布导出为可分享的 HTML 流程图（复用交付物渲染链路） */
  exportFlow: (input: {
    title?: string
    nodes: Array<{ id: string; label: string; kind?: string }>
    edges: Array<{ from: string; to: string; label?: string }>
  }) => Promise<{ ok?: boolean; path?: string; error?: string }>
}

const api = window.api as unknown as WorkflowApi

const NODE_META = Object.fromEntries(
  WORKFLOW_NODE_CATALOG.map((n) => [n.kind, { label: n.label, hint: n.hint, color: n.color }])
) as Record<WorkflowNodeKind, { label: string; hint: string; color: string }>

const KIND_ORDER: WorkflowNodeKind[] = WORKFLOW_NODE_CATALOG.map((n) => n.kind)

const RUN_COLOR: Record<WorkflowNodeRun['status'], string> = {
  idle: '#64748b',
  running: '#f59e0b',
  done: '#34d399',
  error: '#f87171'
}

const PROTOCOL_LABEL: Record<string, string> = {
  cli: 'CLI',
  http: 'HTTP',
  mcp: 'MCP',
  acp: 'ACP',
  process: '进程',
  manual: '手动'
}

/** 网页问答站点预设：地址与主进程保持一致，自定义时用节点里的目标网址 */
const BROWSER_SITE_META: Record<WorkflowBrowserSite, { label: string; url: string }> = {
  deepseek: { label: 'DeepSeek', url: 'https://chat.deepseek.com/' },
  doubao: { label: '豆包', url: 'https://www.doubao.com/chat/' },
  qwen: { label: 'Qwen', url: 'https://chat.qwen.ai/' },
  chatglm: { label: '智谱清言', url: 'https://chatglm.cn/' },
  wenxin: { label: '文心一言', url: 'https://yiyan.baidu.com/' },
  yuanbao: { label: '腾讯元宝', url: 'https://yuanbao.tencent.com/chat/' },
  kimi: { label: 'Kimi', url: 'https://www.kimi.com/' },
  custom: { label: '自定义', url: '' }
}

const AGENT_STATUS_COLOR: Record<AgentView['status'], string> = {
  online: '#34d399',
  offline: '#64748b',
  error: '#f87171',
  unavailable: '#64748b',
  unknown: '#64748b'
}

/** 节点可派发条件：启用 + 支持派发 + 探测在线 */
function isAgentUsable(agent: AgentView): boolean {
  return agent.enabled && agent.dispatchable && agent.status === 'online'
}

interface AgentRecommendation {
  name: string
  reason: string
}

interface WorkflowPlanStep {
  task: string
  who: string
  mode: string
}

/** 按 Agent 的协议与能力，给出它能承接的任务（本地规则，不调用模型） */
function recommendationsFor(agent: AgentView | null): AgentRecommendation[] {
  if (!agent) {
    return [
      { name: '需求理解与拆解', reason: '适合没有工具依赖的文本任务' },
      { name: '长文总结与标签', reason: '使用默认模型，成本最低' },
      { name: '知识条目入库', reason: '直接写入本地知识库' }
    ]
  }
  const text = `${agent.capabilities.join(' ')} ${agent.name} ${agent.detail}`
  if (agent.protocol === 'http') {
    return [
      { name: '远端服务调用', reason: 'POST JSON 派发到已配置端点' },
      { name: '鉴权与超时校验', reason: '确认 token 与超时设置可用' },
      { name: '长任务提交', reason: '适合耗时子任务，需设超时' }
    ]
  }
  if (/回显|echo/i.test(text)) {
    return [
      { name: '提示词链路回显', reason: '即时返回输入，校验拼装结果' },
      { name: '下游参数验证', reason: '确认上游输出完整透传' },
      { name: '工作流快速验收', reason: '不产出业务内容，只做链路确认' }
    ]
  }
  if (/代码|工作区|工具执行|无头|文件/.test(text)) {
    return [
      { name: '代码检索与修改', reason: '具备工作区与工具执行能力' },
      { name: '命令行任务执行', reason: '可跑多步骤实现类子任务' },
      { name: '变更复核', reason: '输出 diff 与自测结果' }
    ]
  }
  if (agent.protocol === 'acp') {
    return [
      { name: '会话式派发', reason: '通过 ACP 建立多轮会话' },
      { name: '上下文延续', reason: '保留前序步骤继续执行' },
      { name: '工具结果回传', reason: '执行结果直接进入下游' }
    ]
  }
  const declared = agent.capabilities.slice(0, 3)
  if (declared.length) {
    return declared.map((cap) => ({ name: cap, reason: '该 Agent 已声明此能力' }))
  }
  return [
    { name: '按节点工作定义执行', reason: '未声明细分能力，按提示词运行' },
    { name: '结果进入下游', reason: '输出会透传给后续节点' }
  ]
}

/** 依据画布上下游，把当前节点的工作拆成分配步骤（仅建议，不改变运行链路） */
function allocatePlan(
  def: WorkflowDef,
  node: WorkflowNode,
  executor: string
): { steps: WorkflowPlanStep[]; meta: string } {
  const steps: WorkflowPlanStep[] = []
  const upstream = upstreamIdsOf(def, node.id)
    .map((id) => def.nodes.find((n) => n.id === id))
    .filter((n): n is WorkflowNode => !!n)
  if (upstream.length) {
    steps.push({
      task: `汇总上游：${upstream.map((n) => n.title).join('、')}`,
      who: `上游 ×${upstream.length}`,
      mode: upstream.length > 1 ? `并行 ×${upstream.length}` : '串行'
    })
  }
  steps.push({ task: node.duty?.trim() || node.title, who: executor, mode: '串行' })
  const next = def.edges
    .filter((e) => e.from === node.id)
    .map((e) => def.nodes.find((n) => n.id === e.to))
    .filter((n): n is WorkflowNode => !!n && n.kind !== 'output')
  if (next.length) {
    steps.push({
      task: next.length > 1 ? `并行处理 ${next.length} 个下游` : `交给「${next[0].title}」`,
      who: next.length > 1 ? `下游 ×${next.length}` : next[0].title,
      mode: next.length > 1 ? `并行 ×${next.length}` : '串行'
    })
  }
  const output = def.nodes.find((n) => n.kind === 'output')
  steps.push({
    task: output ? `写入「${output.title}」` : '生成最终结果',
    who: output?.title ?? '输出',
    mode: '串行'
  })
  const parallel = steps.filter((s) => s.mode.startsWith('并行')).length
  return { steps, meta: `${steps.length} 步 · ${parallel ? `${parallel} 个可并行` : '串行执行'}` }
}

interface LogEntry {
  nodeId: string
  title: string
  status: 'done' | 'error'
  input: string
  output: string
  error?: string
  ms?: number
  startedAt?: number
  endedAt?: number
}

function uid(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`
}

function createDefaultWorkflow(): WorkflowDef {
  const now = Date.now()
  const nodes: WorkflowNode[] = [
    { id: 'n_input', kind: 'input', title: '需求输入', x: 60, y: 220 },
    { id: 'n_collect', kind: 'collect', title: '系统采集', x: 300, y: 70 },
    {
      id: 'n_agent',
      kind: 'agent',
      title: '拆解 Agent',
      x: 300,
      y: 330,
      role: '信息架构师',
      duty: '读取需求与系统采集，把内容拆成可独立执行的小任务，并标注归属主题',
      outputSpec: '任务清单（每条含：任务、输入、产出、归属主题）',
      promptTemplate: ''
    },
    { id: 'n_output', kind: 'output', title: '输出 / 入库', x: 700, y: 220 }
  ]
  const edges = [
    { id: 'e1', from: 'n_input', to: 'n_collect' },
    { id: 'e2', from: 'n_input', to: 'n_agent' },
    { id: 'e3', from: 'n_collect', to: 'n_agent' },
    { id: 'e4', from: 'n_agent', to: 'n_output' }
  ]
  return {
    id: uid('wf'),
    name: '需求拆解工作流',
    goal: '把一段需求拆成多个子 Agent 任务，并输出可入库的知识条目',
    nodes,
    edges,
    createdAt: now,
    updatedAt: now
  }
}

function upstreamIdsOf(def: WorkflowDef, nodeId: string): string[] {
  const node = def.nodes.find((n) => n.id === nodeId)
  const fromEdges = def.edges.filter((e) => e.to === nodeId).map((e) => e.from)
  return [...new Set([...fromEdges, ...(node?.upstreamIds ?? [])])]
}

function topoSort(def: WorkflowDef): WorkflowNode[] | null {
  const map = new Map(def.nodes.map((n) => [n.id, n]))
  const indeg = new Map<string, number>(def.nodes.map((n) => [n.id, 0]))
  const adj = new Map<string, string[]>(def.nodes.map((n) => [n.id, []]))
  const add = (from: string, to: string): void => {
    if (from === to || !map.has(from) || !map.has(to)) return
    const list = adj.get(from) ?? []
    if (list.includes(to)) return
    list.push(to)
    adj.set(from, list)
    indeg.set(to, (indeg.get(to) ?? 0) + 1)
  }
  def.edges.forEach((e) => add(e.from, e.to))
  def.nodes.forEach((n) => (n.upstreamIds ?? []).forEach((u) => add(u, n.id)))
  const queue = def.nodes.filter((n) => (indeg.get(n.id) ?? 0) === 0).map((n) => n.id)
  const out: WorkflowNode[] = []
  while (queue.length) {
    const id = queue.shift() as string
    const node = map.get(id)
    if (node) out.push(node)
    for (const to of adj.get(id) ?? []) {
      const next = (indeg.get(to) ?? 1) - 1
      indeg.set(to, next)
      if (next === 0) queue.push(to)
    }
  }
  return out.length === def.nodes.length ? out : null
}

function reaches(def: WorkflowDef, start: string, target: string): boolean {
  const seen = new Set<string>()
  const stack = [start]
  while (stack.length) {
    const id = stack.pop() as string
    if (id === target) return true
    if (seen.has(id)) continue
    seen.add(id)
    for (const e of def.edges) if (e.from === id) stack.push(e.to)
    const node = def.nodes.find((n) => n.id === id)
    for (const u of node?.upstreamIds ?? []) stack.push(u)
  }
  return false
}

function edgePath(x1: number, y1: number, x2: number, y2: number): string {
  const dx = Math.max(60, Math.abs(x2 - x1) * 0.5)
  return `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`
}

function systemFor(node: WorkflowNode): string {
  const lines = [
    node.role ? `你的角色：${node.role}` : '',
    node.duty ? `你的工作：${node.duty}` : '',
    node.outputSpec ? `输出要求：${node.outputSpec}` : '',
    '只输出最终结果，不要复述要求，不要输出多余寒暄。'
  ].filter(Boolean)
  return lines.length ? lines.join('\n') : '你是工作流中的一个执行节点。'
}

function promptFor(node: WorkflowNode, upstream: string, input: string): string {
  if (node.promptTemplate?.trim()) {
    return node.promptTemplate.replace(/\{\{input\}\}/g, input).replace(/\{\{upstream\}\}/g, upstream)
  }
  return [
    `上游节点输出：\n${upstream || '（无）'}`,
    `本次输入：\n${input || '（无）'}`,
    '请按你的工作定义完成，并直接给出结果。'
  ].join('\n\n')
}

function parseBoundary(text: string): { role?: string; duty?: string; outputSpec?: string } {
  const pick = (labels: string): string | undefined => {
    const m = new RegExp(`(?:${labels})[:：]\\s*(.+)`).exec(text)
    return m?.[1]?.trim()
  }
  return {
    role: pick('角色'),
    duty: pick('工作|工作定义|职责'),
    outputSpec: pick('输出|输出物|产出')
  }
}

/** 会话目标标签：缺省 target 视为本机（历史会话兼容） */
function sessionTargetLabel(s: ChatSession): string {
  return s.target?.kind === 'node' ? '远程节点' : '本机'
}

/** 把已有会话的最近消息拼成节点上下文；控制总字数，避免超过 Agent 派发的 8000 字上限 */
function sessionContextOf(s: ChatSession): string {
  const items = s.items.slice(-20)
  if (!items.length) return ''
  const lines: string[] = []
  let budget = 4000
  let omitted = false
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i]
    const line = `${it.role === 'user' ? '用户' : '助手'}：${it.text.slice(0, 1500)}`
    if (line.length > budget) {
      omitted = true
      break
    }
    lines.unshift(line)
    budget -= line.length
  }
  return `【已有会话：${s.title}】${omitted ? '（更早消息已省略）' : ''}\n${lines.join('\n')}`
}

/** 节点写回会话的用户侧内容：节点身份 + 本次工作（不写入整段系统提示词） */
function sessionAskText(node: WorkflowNode, input: string): string {
  const head = `【工作流节点：${node.title}】${node.duty ? `\n${node.duty}` : ''}`
  const brief = input.trim()
  return brief ? `${head}\n\n本次输入：\n${brief.slice(0, 1200)}` : head
}

export default function WorkflowView(): JSX.Element {
  const [defs, setDefs] = useState<WorkflowDef[]>([])
  const [activeId, setActiveId] = useState('')
  const [models, setModels] = useState<WorkflowModelsResult['models']>([])
  const [agents, setAgents] = useState<AgentView[]>([])
  /** 问答页共享的会话列表：agent 节点可接续已有会话或新建会话 */
  const [sessions, setSessions] = useState<ChatSession[]>([])
  const [modelInfo, setModelInfo] = useState<{ baseUrl: string; ollama: boolean; error?: string } | null>(null)
  const [projects, setProjects] = useState<Project[]>([])
  const [automation, setAutomation] = useState<WorkflowAutomationCapabilities | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  /** 多选（Shift 点击 / 框选）；selectedId 是主选中项，配置悬窗用它 */
  const [selectedMulti, setSelectedMulti] = useState<string[]>([])
  const [snapEnabled, setSnapEnabled] = useState<boolean>(() => {
    try {
      return localStorage.getItem('workon:wf-snap') !== '0'
    } catch {
      return true
    }
  })
  const [marquee, setMarquee] = useState<{ x1: number; y1: number; x2: number; y2: number } | null>(null)
  const [guides, setGuides] = useState<{ vertical: number[]; horizontal: number[] }>({ vertical: [], horizontal: [] })
  const [dropActive, setDropActive] = useState(false)
  const [historyTick, setHistoryTick] = useState(0)
  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState<number | null>(null)
  const [inputText, setInputText] = useState('')
  const [runs, setRuns] = useState<Record<string, WorkflowNodeRun>>({})
  const [log, setLog] = useState<LogEntry[]>([])
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')
  const [runRecords, setRunRecords] = useState<WorkflowRunRecord[]>([])
  const [recordsOpen, setRecordsOpen] = useState(false)
  const [viewMode, setViewMode] = useState<'board' | 'studio'>('board')
  /** 已归档的产物：key = 节点 id + 输出长度，避免同一条重复入库 */
  const [archived, setArchived] = useState<Record<string, boolean>>({})
  const [linking, setLinking] = useState<{ from: string; x: number; y: number } | null>(null)
  /** 连线时悬停的合法目标节点（高亮 + 预览吸附到输入口） */
  const [linkHover, setLinkHover] = useState<string | null>(null)
  const [hoverEdgeId, setHoverEdgeId] = useState<string | null>(null)
  const [collectPreview, setCollectPreview] = useState('')
  const [assistResult, setAssistResult] = useState('')
  const [assistBusy, setAssistBusy] = useState(false)
  const [splitBusy, setSplitBusy] = useState(false)
  // 画布视图（平移 / 缩放）
  const [view, setView] = useState({ x: 0, y: 0, zoom: 1 })
  const [viewportSize, setViewportSize] = useState({ w: 0, h: 0 })
  const viewportRef = useRef<HTMLDivElement>(null)
  const miniMapRef = useRef<HTMLDivElement>(null)
  const panRef = useRef<{ sx: number; sy: number; ox: number; oy: number } | null>(null)
  const runStopRef = useRef(false)
  // 右键菜单 / 节点配置悬窗
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; nodeId?: string; edgeId?: string } | null>(null)
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null)
  const [panelOpen, setPanelOpen] = useState(false)
  const [panelPos, setPanelPos] = useState(() => ({ x: Math.max(16, window.innerWidth - 392), y: 104 }))
  const panelPlacedRef = useRef(false)
  const sceneRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{
    ids: string[]
    primary: string
    startX: number
    startY: number
    base: Record<string, { x: number; y: number }>
    moved: boolean
    before: WorkflowDef
  } | null>(null)
  const undoRef = useRef<WorkflowDef[]>([])
  const redoRef = useRef<WorkflowDef[]>([])
  const activeRef = useRef<WorkflowDef | null>(null)
  const clipboardRef = useRef<{ nodes: WorkflowNode[]; edges: WorkflowEdge[] } | null>(null)

  /** 打开节点配置悬窗：首次贴在画布右侧，之后保留用户拖到的位置 */
  const openPanelFor = (id: string): void => {
    setSelectedId(id)
    if (!panelPlacedRef.current) {
      const r = viewportRef.current?.getBoundingClientRect()
      if (r) {
        setPanelPos({ x: Math.max(8, r.right - 372), y: Math.max(56, r.top + 12) })
      }
      panelPlacedRef.current = true
    }
    setPanelOpen(true)
  }

  const active = defs.find((d) => d.id === activeId) ?? null
  const selected = active?.nodes.find((n) => n.id === selectedId) ?? null
  const selectedAgent = selected?.agentId ? (agents.find((a) => a.id === selected.agentId) ?? null) : null
  /** 先给能力推荐，再按画布上下游生成分配规划 */
  const agentRecs =
    selected?.kind === 'agent' && (!selected.agentId || selectedAgent) ? recommendationsFor(selectedAgent) : []
  const agentPlan =
    active && selected?.kind === 'agent'
      ? allocatePlan(active, selected, selectedAgent?.name ?? (selected.agentId ? '未知 Agent' : '内置模型'))
      : null
  const selectedSession =
    selected?.sessionMode === 'existing' && selected.sessionId
      ? (sessions.find((s) => s.id === selected.sessionId) ?? null)
      : null
  /** 会话下拉当前值：none / new / existing:<id> */
  const sessionValue =
    selected?.kind === 'agent'
      ? selected.sessionMode === 'existing' && selected.sessionId
        ? `existing:${selected.sessionId}`
        : (selected.sessionMode ?? 'none')
      : 'none'
  /** 当前选中集合：selectedId + Shift/框选进来的节点 */
  const selectedIds = useMemo(() => {
    const set = new Set(selectedMulti)
    if (selectedId) set.add(selectedId)
    return set
  }, [selectedId, selectedMulti])
  /** 可派发的 Agent 排前面，其余保留注册顺序 */
  const orderedAgents = useMemo(() => {
    const rank = (a: AgentView): number => (isAgentUsable(a) ? 0 : 1)
    return [...agents].sort((a, b) => rank(a) - rank(b))
  }, [agents])
  /** 画布随内容扩展，避免大工作流被 1500×900 裁掉 */
  const sceneSize = useMemo(() => {
    const nodes = active?.nodes ?? []
    return {
      w: Math.max(1500, ...nodes.map((n) => n.x + 340)),
      h: Math.max(900, ...nodes.map((n) => n.y + 240))
    }
  }, [active])
  /** 小地图：把 sceneSize 映射到右下角固定画幅 */
  const mini = useMemo(() => {
    const w = 168
    const h = 104
    const s = Math.min(w / sceneSize.w, h / sceneSize.h)
    return { w, h, s, ox: (w - sceneSize.w * s) / 2, oy: (h - sceneSize.h * s) / 2 }
  }, [sceneSize])
  /** historyTick 用于让撤销/重做按钮在栈变化后刷新可用态 */
  const canUndo = historyTick >= 0 && undoRef.current.length > 0
  const canRedo = historyTick >= 0 && redoRef.current.length > 0

  useEffect(() => {
    activeRef.current = active
  }, [active])

  // 记录画布可视区尺寸（小地图视口框 / 快速定位需要）
  useEffect(() => {
    const el = viewportRef.current
    if (!el) return
    const update = (): void => setViewportSize({ w: el.clientWidth, h: el.clientHeight })
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // 切换工作流时清空撤销栈与多选（不同画布之间不串历史）
  useEffect(() => {
    undoRef.current = []
    redoRef.current = []
    setSelectedMulti([])
    setMarquee(null)
    setGuides({ vertical: [], horizontal: [] })
    setHistoryTick((t) => t + 1)
  }, [activeId])

  const updateActive = useCallback(
    (updater: (def: WorkflowDef) => WorkflowDef) => {
      setDefs((prev) =>
        prev.map((d) => {
          if (d.id !== activeId) return d
          const next = updater(d)
          activeRef.current = next
          return next
        })
      )
    },
    [activeId]
  )

  const patchNode = useCallback(
    (id: string, patch: Partial<WorkflowNode>) => {
      updateActive((d) => ({ ...d, nodes: d.nodes.map((n) => (n.id === id ? { ...n, ...patch } : n)) }))
    },
    [updateActive]
  )

  /** 记录一次可撤销的结构变更（传变更前的快照） */
  const commitUndo = useCallback((before: WorkflowDef | null) => {
    if (!before) return
    undoRef.current = [...undoRef.current.slice(-49), structuredClone(before)]
    redoRef.current = []
    setHistoryTick((t) => t + 1)
  }, [])

  const applyDef = useCallback((def: WorkflowDef) => {
    activeRef.current = structuredClone(def)
    setDefs((prev) => prev.map((d) => (d.id === def.id ? structuredClone(def) : d)))
  }, [])

  const undo = useCallback(() => {
    const cur = activeRef.current
    const prev = undoRef.current.pop()
    if (!cur || !prev) return
    redoRef.current = [...redoRef.current.slice(-49), structuredClone(cur)]
    applyDef(prev)
    setSelectedId((id) => (id && prev.nodes.some((n) => n.id === id) ? id : null))
    setSelectedMulti((ids) => ids.filter((id) => prev.nodes.some((n) => n.id === id)))
    setPanelOpen(false)
    setStatus('已撤销')
    setHistoryTick((t) => t + 1)
  }, [applyDef])

  const redo = useCallback(() => {
    const cur = activeRef.current
    const next = redoRef.current.pop()
    if (!cur || !next) return
    undoRef.current = [...undoRef.current.slice(-49), structuredClone(cur)]
    applyDef(next)
    setSelectedId((id) => (id && next.nodes.some((n) => n.id === id) ? id : null))
    setSelectedMulti((ids) => ids.filter((id) => next.nodes.some((n) => n.id === id)))
    setPanelOpen(false)
    setStatus('已重做')
    setHistoryTick((t) => t + 1)
  }, [applyDef])

  const copySelection = useCallback(() => {
    const def = activeRef.current
    if (!def) return
    const ids = new Set(selectedIds)
    if (!ids.size) return
    const nodes = def.nodes.filter((n) => ids.has(n.id))
    const edges = def.edges.filter((e) => ids.has(e.from) && ids.has(e.to))
    clipboardRef.current = { nodes: structuredClone(nodes), edges: structuredClone(edges) }
    setStatus(`已复制 ${nodes.length} 个节点`)
  }, [selectedIds])

  const pasteClipboard = useCallback(() => {
    const def = activeRef.current
    const clip = clipboardRef.current
    if (!def || !clip?.nodes.length) return
    commitUndo(def)
    const idMap = new Map<string, string>()
    clip.nodes.forEach((n) => idMap.set(n.id, uid('n')))
    const nodes: WorkflowNode[] = clip.nodes.map((n) => ({
      ...n,
      id: idMap.get(n.id) as string,
      x: n.x + 40,
      y: n.y + 40,
      parentId: n.parentId ? idMap.get(n.parentId) : undefined,
      upstreamIds: (n.upstreamIds ?? []).map((u) => idMap.get(u)).filter((x): x is string => !!x)
    }))
    const edges: WorkflowEdge[] = clip.edges.map((e) => ({
      id: uid('e'),
      from: idMap.get(e.from) as string,
      to: idMap.get(e.to) as string
    }))
    updateActive((d) => ({ ...d, nodes: [...d.nodes, ...nodes], edges: [...d.edges, ...edges] }))
    setSelectedMulti(nodes.map((n) => n.id))
    setSelectedId(nodes[nodes.length - 1]?.id ?? null)
    setStatus(`已粘贴 ${nodes.length} 个节点`)
  }, [commitUndo, updateActive])

  const removeNodes = useCallback(
    (ids: string[]): void => {
      const def = activeRef.current
      const set = new Set(ids)
      if (!def || !set.size) return
      commitUndo(def)
      updateActive((d) => ({
        ...d,
        nodes: d.nodes
          .filter((n) => !set.has(n.id))
          .map((n) => ({
            ...n,
            parentId: n.parentId && set.has(n.parentId) ? undefined : n.parentId,
            upstreamIds: (n.upstreamIds ?? []).filter((u) => !set.has(u))
          })),
        edges: d.edges.filter((e) => !set.has(e.from) && !set.has(e.to))
      }))
      setRuns((prev) => {
        const next = { ...prev }
        ids.forEach((id) => delete next[id])
        return next
      })
      setSelectedId(null)
      setSelectedMulti([])
      setPanelOpen(false)
    },
    [commitUndo, updateActive]
  )

  const setRun = useCallback((id: string, patch: Partial<WorkflowNodeRun>) => {
    setRuns((prev) => {
      const base: WorkflowNodeRun = prev[id] ?? { nodeId: id, status: 'idle' }
      return { ...prev, [id]: { ...base, ...patch } }
    })
  }, [])

  /** 定时配置：只改 schedule，自动保存沿用上面的防抖逻辑 */
  const updateSchedule = useCallback(
    (patch: Partial<WorkflowSchedule>) => {
      updateActive((d) => ({
        ...d,
        schedule: { enabled: false, mode: 'daily', atHHMM: '09:00', ...(d.schedule ?? {}), ...patch }
      }))
    },
    [updateActive]
  )

  const refreshRunRecords = useCallback(async (id: string) => {
    if (!id) return
    try {
      const list = await api.workflowRuns(id)
      setRunRecords(Array.isArray(list) ? list : [])
    } catch {
      setRunRecords([])
    }
  }, [])

  useEffect(() => {
    void refreshRunRecords(activeId)
  }, [activeId, refreshRunRecords])

  // 主进程完成一次完整运行（手动「立即跑一次」/定时）后刷新记录
  useEffect(
    () =>
      api.onWorkflowRunDone?.((rec) => {
        if (rec.workflowId !== activeId) return
        setRunRecords((prev) => [rec, ...prev].slice(0, 100))
        setStatus(rec.ok ? `「${rec.name}」后台运行完成` : `「${rec.name}」后台运行失败：${rec.error ?? ''}`)
      }),
    [activeId]
  )

  /** 按定时执行的方式在后台完整跑一次（结果进运行记录；不占用画布） */
  const runScheduledOnce = async (): Promise<void> => {
    if (!active) return
    setStatus('后台运行中…')
    try {
      const rec = await api.workflowRunById(active.id, inputText.trim() || undefined)
      setStatus(rec.ok ? '后台运行完成' : `后台运行失败：${rec.error ?? ''}`)
      void refreshRunRecords(active.id)
    } catch (e) {
      setStatus(`后台运行失败：${(e as Error).message}`)
    }
  }

  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        const [list, modelRes, projs, auto] = await Promise.all([
          api.workflowList(),
          api.workflowModels(),
          api.listProjects(),
          api.workflowAutomation()
        ])
        if (!alive) return
        let arr = list?.workflows ?? []
        if (!arr.length) {
          const def = createDefaultWorkflow()
          arr = [def]
          void api.workflowSave(def)
        }
        // 加载慢于用户操作时，保留本地新建/已修改的工作流，避免被快照覆盖
        setDefs((prev) => {
          const merged = new Map(arr.map((d) => [d.id, d]))
          prev.forEach((d) => {
            if (!merged.has(d.id)) merged.set(d.id, d)
          })
          return [...merged.values()]
        })
        setActiveId((cur) => cur || arr[0].id)
        setSelectedId((cur) => (cur ? cur : (arr[0].nodes[0]?.id ?? null)))
        setModels(modelRes?.models ?? [])
        setModelInfo({ baseUrl: modelRes?.baseUrl ?? '', ollama: !!modelRes?.ollama, error: modelRes?.error })
        setProjects(projs ?? [])
        setAutomation(auto ?? null)
        void api
          .listAgents()
          .then((res) => {
            if (alive) setAgents((res?.agents ?? []).filter((a) => !a.builtin))
          })
          .catch(() => {
            /* Agent 注册表不可用时不影响工作流本身 */
          })
        void api
          .listSessions()
          .then((list) => {
            if (alive) setSessions((list ?? []).filter((s) => !s.archived))
          })
          .catch(() => {
            /* 会话不可用时不影响工作流本身 */
          })
      } catch (e) {
        setStatus(`加载失败：${(e as Error).message}`)
      }
    })()
    return () => {
      alive = false
    }
  }, [])

  // 全局对话确认生成后：已经停在编排页时也能直接定位到新工作流
  useEffect(() => {
    const onGenerated = (e: Event): void => {
      const id = String((e as CustomEvent<string>).detail ?? '')
      void api
        .workflowList()
        .then((res) => {
          const arr = res?.workflows ?? []
          if (!arr.length) return
          setDefs(arr)
          const target = arr.find((d) => d.id === id) ?? arr[0]
          setActiveId(target.id)
          setSelectedId(target.nodes[0]?.id ?? null)
          setStatus(`已打开新生成的工作流「${target.name}」`)
        })
        .catch(() => {
          /* 读取失败时保持当前画布 */
        })
    }
    window.addEventListener('workon:workflow-generated', onGenerated)
    return () => window.removeEventListener('workon:workflow-generated', onGenerated)
  }, [])

  // 自动保存（拖拽/输入变化 600ms 防抖）+ 保存状态
  useEffect(() => {
    if (!active) return
    setSaving(true)
    const timer = window.setTimeout(() => {
      void api
        .workflowSave(active)
        .then((res) => {
          setSaving(false)
          if (res?.ok) setSavedAt(Date.now())
          else setStatus(`保存失败：${res?.error ?? '未知错误'}`)
        })
        .catch((e: Error) => {
          setSaving(false)
          setStatus(`保存失败：${e.message}`)
        })
    }, 600)
    return () => window.clearTimeout(timer)
  }, [active])

  // 连线拖拽：预览跟随指针，悬停合法目标时吸附到其输入口
  useEffect(() => {
    if (!linking) return
    const targetAt = (clientX: number, clientY: number): string | undefined => {
      for (const el of document.elementsFromPoint(clientX, clientY)) {
        const port = (el as HTMLElement).closest?.('[data-input-port]') as HTMLElement | null
        if (port?.dataset.inputPort) return port.dataset.inputPort
        const node = (el as HTMLElement).closest?.('[data-node]') as HTMLElement | null
        if (node?.dataset.node) return node.dataset.node
      }
      return undefined
    }
    const validTarget = (to?: string): { id: string | null; reason?: 'self' | 'dup' | 'cycle' } => {
      const def = activeRef.current
      if (!def || !to) return { id: null }
      if (to === linking.from) return { id: null, reason: 'self' }
      if (def.edges.some((e) => e.from === linking.from && e.to === to)) return { id: null, reason: 'dup' }
      if (reaches(def, to, linking.from)) return { id: null, reason: 'cycle' }
      return { id: to }
    }
    const move = (e: PointerEvent): void => {
      const rect = sceneRef.current?.getBoundingClientRect()
      if (!rect) return
      const zoom = view.zoom || 1
      const x = (e.clientX - rect.left) / zoom
      const y = (e.clientY - rect.top) / zoom
      const hoverId = validTarget(targetAt(e.clientX, e.clientY)).id
      setLinkHover(hoverId)
      const target = hoverId ? activeRef.current?.nodes.find((n) => n.id === hoverId) : null
      setLinking((prev) =>
        prev ? (target ? { ...prev, x: target.x - 8, y: target.y + 46 } : { ...prev, x, y }) : prev
      )
    }
    const up = (e: PointerEvent): void => {
      // 圆点只有一半露在节点外，落点常命中节点本体；整块节点都算有效落点
      const target = validTarget(targetAt(e.clientX, e.clientY))
      if (target.id) connect(linking.from, target.id)
      else if (target.reason === 'self') setStatus('不能把节点连到自身')
      else if (target.reason === 'dup') setStatus('这两个节点之间已有连线')
      else if (target.reason === 'cycle') setStatus('这条连线会形成环，已忽略')
      setLinking(null)
      setLinkHover(null)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linking, activeId, view.zoom])

  const connect = (from: string, to: string): void => {
    const def = activeRef.current
    if (!def || from === to) return
    if (def.edges.some((e) => e.from === from && e.to === to)) return
    if (reaches(def, to, from)) {
      setStatus('这条连线会形成环，已忽略')
      return
    }
    commitUndo(def)
    updateActive((d) => ({ ...d, edges: [...d.edges, { id: uid('e'), from, to }] }))
  }

  const addNode = (kind: WorkflowNodeKind, x: number, y: number): void => {
    const snapPos = (v: number): number => (snapEnabled ? Math.round(v / 8) * 8 : Math.round(v))
    const node: WorkflowNode = {
      id: uid('n'),
      kind,
      title: NODE_META[kind].label,
      x: Math.max(0, snapPos(x)),
      y: Math.max(0, snapPos(y)),
      ...(kind === 'image' ? { imageMode: 'auto' as const } : {}),
      ...(kind === 'tool' ? { toolKind: 'browser' as const, browserAction: 'read' as const } : {})
    }
    commitUndo(activeRef.current)
    updateActive((d) => ({ ...d, nodes: [...d.nodes, node] }))
    setSelectedId(node.id)
    setSelectedMulti([])
  }

  const removeNode = (id: string): void => removeNodes([id])

  const onNodePointerDown = (e: React.PointerEvent<HTMLDivElement>, node: WorkflowNode): void => {
    if ((e.target as HTMLElement).closest('[data-port], [data-input-port]')) return
    if (e.button !== 0) return
    // 连线中：不进入拖动，由 window pointerup 统一判定落点
    if (linking) return
    setSelectedEdgeId(null)
    setCtxMenu(null)
    // Shift / Cmd 点击：加入多选，不进入拖动
    if (e.shiftKey || e.metaKey || e.ctrlKey) {
      e.preventDefault()
      setSelectedMulti((prev) => (prev.includes(node.id) ? prev : [...prev, node.id]))
      setSelectedId(node.id)
      return
    }
    // 点在已有多选集合内：保持整组选中，拖动时整组移动
    const inGroup = selectedIds.has(node.id) && selectedIds.size > 1
    if (!inGroup) setSelectedMulti([])
    setSelectedId(node.id)
    const def = activeRef.current
    if (!def) return
    const ids = inGroup ? [...selectedIds] : [node.id]
    const base: Record<string, { x: number; y: number }> = {}
    def.nodes.forEach((n) => {
      if (ids.includes(n.id)) base[n.id] = { x: n.x, y: n.y }
    })
    dragRef.current = {
      ids,
      primary: node.id,
      startX: e.clientX,
      startY: e.clientY,
      base,
      moved: false,
      before: structuredClone(def)
    }
    const zoom = view.zoom
    const move = (ev: PointerEvent): void => {
      const drag = dragRef.current
      if (!drag) return
      const dx = (ev.clientX - drag.startX) / zoom
      const dy = (ev.clientY - drag.startY) / zoom
      if (!drag.moved) {
        if (Math.abs(dx) + Math.abs(dy) < 2) return
        drag.moved = true
        commitUndo(drag.before)
      }
      const allowSnap = ev.altKey ? !snapEnabled : snapEnabled
      const primary = drag.base[drag.primary]
      if (!primary) return
      let targetX = allowSnap ? Math.round((primary.x + dx) / 8) * 8 : Math.round(primary.x + dx)
      let targetY = allowSnap ? Math.round((primary.y + dy) / 8) * 8 : Math.round(primary.y + dy)
      // 对齐辅助线：与其它节点的左/中/右、上/中/下对齐（4px 内吸附）
      let guideX: number | null = null
      let guideY: number | null = null
      if (allowSnap) {
        const others = (activeRef.current?.nodes ?? []).filter((n) => !drag.ids.includes(n.id))
        const xAnchors = [0, 95, 190]
        const yAnchors = [0, 58, 116]
        const baseX = targetX
        const baseY = targetY
        let bestDX = 5
        let bestDY = 5
        let snapDX = 0
        let snapDY = 0
        for (const o of others) {
          for (const mx of xAnchors) {
            for (const ox of xAnchors) {
              const delta = o.x + ox - (baseX + mx)
              if (Math.abs(delta) < bestDX) {
                bestDX = Math.abs(delta)
                snapDX = delta
                guideX = o.x + ox
              }
            }
          }
          for (const my of yAnchors) {
            for (const oy of yAnchors) {
              const delta = o.y + oy - (baseY + my)
              if (Math.abs(delta) < bestDY) {
                bestDY = Math.abs(delta)
                snapDY = delta
                guideY = o.y + oy
              }
            }
          }
        }
        targetX += snapDX
        targetY += snapDY
      }
      setGuides({
        vertical: guideX === null ? [] : [guideX],
        horizontal: guideY === null ? [] : [guideY]
      })
      const offX = targetX - primary.x
      const offY = targetY - primary.y
      updateActive((d) => ({
        ...d,
        nodes: d.nodes.map((n) => {
          const b = drag.base[n.id]
          return b ? { ...n, x: Math.max(0, b.x + offX), y: Math.max(0, b.y + offY) } : n
        })
      }))
    }
    const up = (): void => {
      dragRef.current = null
      setGuides({ vertical: [], horizontal: [] })
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  /** 屏幕坐标 → 画布坐标（考虑平移与缩放） */
  const toScene = (clientX: number, clientY: number): { x: number; y: number } => {
    const rect = viewportRef.current?.getBoundingClientRect()
    if (!rect) return { x: 100, y: 100 }
    return { x: (clientX - rect.left - view.x) / view.zoom, y: (clientY - rect.top - view.y) / view.zoom }
  }

  const zoomBy = (factor: number, centerX?: number, centerY?: number): void => {
    const rect = viewportRef.current?.getBoundingClientRect()
    setView((prev) => {
      const next = Math.min(1.8, Math.max(0.4, prev.zoom * factor))
      const k = next / prev.zoom
      const px = centerX != null && rect ? centerX - rect.left : (rect?.width ?? 0) / 2
      const py = centerY != null && rect ? centerY - rect.top : (rect?.height ?? 0) / 2
      return { zoom: next, x: px - (px - prev.x) * k, y: py - (py - prev.y) * k }
    })
  }

  const fitView = (target?: WorkflowDef): void => {
    const def = target ?? activeRef.current
    if (!def || !def.nodes.length || !viewportRef.current) {
      setView({ x: 0, y: 0, zoom: 1 })
      return
    }
    const xs = def.nodes.map((n) => n.x)
    const ys = def.nodes.map((n) => n.y)
    const minX = Math.min(...xs) - 40
    const minY = Math.min(...ys) - 40
    const maxX = Math.max(...xs) + 230
    const maxY = Math.max(...ys) + 130
    const rect = viewportRef.current.getBoundingClientRect()
    const zoom = Math.min(1.2, Math.max(0.4, Math.min(rect.width / (maxX - minX), rect.height / (maxY - minY))))
    setView({ zoom, x: -minX * zoom + 24, y: -minY * zoom + 20 })
  }

  /** 小地图点击 / 拖动：把对应场景点移到可视区中心 */
  const miniJump = (clientX: number, clientY: number): void => {
    const el = miniMapRef.current
    if (!el || !mini.s || !viewportSize.w || !viewportSize.h) return
    const r = el.getBoundingClientRect()
    const sx = (clientX - r.left - mini.ox) / mini.s
    const sy = (clientY - r.top - mini.oy) / mini.s
    setView((prev) => ({
      ...prev,
      x: viewportSize.w / 2 - sx * prev.zoom,
      y: viewportSize.h / 2 - sy * prev.zoom
    }))
  }

  /** 按连线层级自动排列：上游在左、下游在右，同列垂直居中，可撤销 */
  const autoLayout = (): void => {
    const def = activeRef.current
    if (!def?.nodes.length) return
    const ordered = topoSort(def)
    if (!ordered) {
      setStatus('检测到环形依赖，请先调整连线再自动排列')
      return
    }
    const levelOf = new Map<string, number>()
    for (const n of ordered) {
      const ups = upstreamIdsOf(def, n.id).filter((id) => levelOf.has(id))
      levelOf.set(n.id, ups.length ? Math.max(...ups.map((id) => levelOf.get(id) as number)) + 1 : 0)
    }
    const columns = new Map<number, WorkflowNode[]>()
    for (const n of def.nodes) {
      const lv = levelOf.get(n.id) ?? 0
      columns.set(lv, [...(columns.get(lv) ?? []), n])
    }
    const levels = [...columns.keys()].sort((a, b) => a - b)
    const maxRows = Math.max(...levels.map((lv) => columns.get(lv)?.length ?? 0))
    const COL_W = 300
    const ROW_H = 150
    const pos = new Map<string, { x: number; y: number }>()
    for (const lv of levels) {
      const col = columns.get(lv) ?? []
      const offsetY = ((maxRows - col.length) * ROW_H) / 2
      col.forEach((n, i) => pos.set(n.id, { x: 60 + lv * COL_W, y: 80 + offsetY + i * ROW_H }))
    }
    commitUndo(def)
    const nextNodes = def.nodes.map((n) => ({ ...n, ...(pos.get(n.id) ?? {}) }))
    updateActive((d) => ({ ...d, nodes: nextNodes }))
    setSelectedMulti([])
    setStatus(`已按连线层级自动排列（${levels.length} 列 / ${def.nodes.length} 个节点）`)
    fitView({ ...def, nodes: nextNodes })
  }

  const duplicateNode = (id: string): void => {
    const def = activeRef.current
    if (!def) return
    const source = def.nodes.find((n) => n.id === id)
    if (!source) return
    const copy: WorkflowNode = {
      ...source,
      id: uid('n'),
      title: `${source.title} 副本`,
      x: source.x + 48,
      y: source.y + 48,
      parentId: undefined,
      upstreamIds: undefined
    }
    commitUndo(def)
    updateActive((d) => ({ ...d, nodes: [...d.nodes, copy] }))
    setSelectedId(copy.id)
    setSelectedMulti([])
  }

  const deleteEdge = (edgeId: string): void => {
    commitUndo(activeRef.current)
    updateActive((d) => ({ ...d, edges: d.edges.filter((e) => e.id !== edgeId) }))
    setSelectedEdgeId(null)
    setStatus('已删除连线')
  }

  const startPanelDrag = (e: React.PointerEvent<HTMLDivElement>): void => {
    if ((e.target as HTMLElement).closest('button')) return
    const start = { sx: e.clientX, sy: e.clientY, ox: panelPos.x, oy: panelPos.y }
    const move = (ev: PointerEvent): void => {
      setPanelPos({
        x: Math.max(8, Math.min(window.innerWidth - 140, start.ox + ev.clientX - start.sx)),
        y: Math.max(56, Math.min(window.innerHeight - 90, start.oy + ev.clientY - start.sy))
      })
    }
    const up = (): void => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  // 画布滚轮缩放（非 passive，避免页面跟着滚）
  useEffect(() => {
    const el = viewportRef.current
    if (!el) return
    const onWheel = (e: WheelEvent): void => {
      e.preventDefault()
      zoomBy(e.deltaY < 0 ? 1.1 : 0.9, e.clientX, e.clientY)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 键盘：撤销/重做、复制/粘贴、全选、删除（输入框内不拦截）
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return
      const mod = e.metaKey || e.ctrlKey
      const key = e.key.toLowerCase()
      if (mod && key === 'z') {
        e.preventDefault()
        if (e.shiftKey) redo()
        else undo()
        return
      }
      if (mod && key === 'y') {
        e.preventDefault()
        redo()
        return
      }
      if (mod && key === 'c') {
        e.preventDefault()
        copySelection()
        return
      }
      if (mod && key === 'v') {
        e.preventDefault()
        pasteClipboard()
        return
      }
      if (mod && key === 'a') {
        e.preventDefault()
        const ids = activeRef.current?.nodes.map((n) => n.id) ?? []
        setSelectedMulti(ids)
        setSelectedId(ids[ids.length - 1] ?? null)
        return
      }
      if (e.key.startsWith('Arrow')) {
        const def = activeRef.current
        const ids = new Set(selectedMulti)
        if (selectedId) ids.add(selectedId)
        if (!def || !ids.size || selectedEdgeId) return
        const step = e.shiftKey ? 1 : snapEnabled ? 8 : 1
        const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0
        const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0
        if (!dx && !dy) return
        e.preventDefault()
        commitUndo(def)
        updateActive((d) => ({
          ...d,
          nodes: d.nodes.map((n) =>
            ids.has(n.id) ? { ...n, x: Math.max(0, n.x + dx), y: Math.max(0, n.y + dy) } : n
          )
        }))
        return
      }
      if (e.key === 'Escape') {
        if (linking) {
          setLinking(null)
          setLinkHover(null)
          return
        }
        setSelectedEdgeId(null)
        setSelectedId(null)
        setSelectedMulti([])
        setMarquee(null)
        setCtxMenu(null)
        return
      }
      if (e.key !== 'Delete' && e.key !== 'Backspace') return
      if (selectedEdgeId) {
        e.preventDefault()
        deleteEdge(selectedEdgeId)
        return
      }
      const ids = new Set(selectedMulti)
      if (selectedId) ids.add(selectedId)
      if (ids.size) {
        e.preventDefault()
        removeNodes([...ids])
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [linking, selectedEdgeId, selectedId, selectedMulti, snapEnabled, undo, redo, copySelection, pasteClipboard, removeNodes, deleteEdge, commitUndo, updateActive])

  const visionOf = (modelId?: string): boolean => models.find((m) => m.id === modelId)?.vision ?? false

  /**
   * 浏览器节点：真实操作网页（内置浏览器 / 本机 Chrome 用同一套 API）
   * - read：打开后读取正文，交给下游 Agent
   * - extract：读取正文后交给模型按「提炼要求」输出结构化结果
   * - screenshot：截图留档，返回落盘路径
   */
  const runBrowserNode = async (
    node: WorkflowNode,
    upstream: string,
    input: string
  ): Promise<{ ok: boolean; text: string; error?: string }> => {
    const action = node.browserAction ?? 'read'
    const fill = (s: string): string =>
      s.replace(/\{\{upstream\}\}/g, upstream).replace(/\{\{input\}\}/g, input)
    // 网页问答：打开站点 → 自动填入问题 → 发送 → 等回答稳定 → 返回回答文本
    if (action === 'ask') {
      const question = fill(node.browserQuestion ?? '').trim()
      if (!question) return { ok: false, text: '', error: '请先在节点里填写「提问内容」（支持 {{input}} / {{upstream}}）' }
      const site = node.browserSite ?? 'deepseek'
      const preset = BROWSER_SITE_META[site]
      const customUrl = fill(node.browserUrl ?? '').trim()
      if (site === 'custom' && !customUrl) return { ok: false, text: '', error: '自定义站点需要填写目标网址' }
      const res = await api.browserAsk({
        site,
        url: customUrl || preset.url,
        question,
        answerSelector: fill(node.browserAnswerSelector ?? '').trim() || undefined,
        timeoutMs: 180_000
      })
      if (!res?.ok) return { ok: false, text: '', error: res?.error || '网页问答失败' }
      const head = `【网页问答 · ${preset.label}】${res.title ? ` ${res.title}` : ''}\n${res.url || ''}`
      return { ok: true, text: `${head}\n\n${res.answer ?? ''}` }
    }
    // 目标网址：优先节点配置；留空则取上游 / 本次输入里的第一个链接；都没有就读当前页面
    let url = fill(node.browserUrl ?? '').trim()
    if (!url) {
      const found = `${upstream}\n${input}`.match(/https?:\/\/[^\s"'”’）)】\]]+/)
      url = found ? found[0] : ''
    }
    if (url) {
      const nav = await api.browserNavigate(url)
      if (!nav?.ok) return { ok: false, text: '', error: nav?.error || '打开网页失败' }
    }
    if (action === 'screenshot') {
      const shot = await api.browserScreenshot()
      if (!shot?.ok) return { ok: false, text: '', error: shot?.error || '截图失败' }
      return { ok: true, text: `【网页截图】${shot.path || '已保存'}${url ? `\n${url}` : ''}` }
    }
    const read = await api.browserRead()
    if (!read?.ok) return { ok: false, text: '', error: read?.error || '读取网页失败' }
    const body = (read.text ?? '').trim()
    if (!body) return { ok: false, text: '', error: '页面没有可读正文（可能需要登录或尚未加载完）' }
    const head = `【网页】${read.title || '（无标题）'}\n${read.url || url}`
    if (action === 'read') {
      const limit = 8000
      const cut = body.length > limit ? `\n\n…（正文共 ${body.length} 字，已截断）` : ''
      return { ok: true, text: `${head}\n\n${body.slice(0, limit)}${cut}` }
    }
    // extract：把网页正文交给模型提炼，下游可直接消费
    const ask = fill(node.browserTask ?? '').trim() || '提炼这个网页的核心信息，输出要点清单。'
    const res = await api.workflowRun({
      model: node.model || undefined,
      system: '你是网页信息提炼助手。只依据给定网页正文作答，忠于原文、不编造；按要求输出结构化结果。',
      prompt: [
        `【提炼要求】\n${ask}`,
        upstream ? `【上游目标 / 上下文】\n${upstream}` : '',
        `${head}\n\n【网页正文】\n${body.slice(0, 12000)}`
      ]
        .filter(Boolean)
        .join('\n\n')
    })
    if (!res.ok) return { ok: false, text: '', error: res.error || '网页提炼失败' }
    return { ok: true, text: `${head}\n\n${res.text}` }
  }

  /** 视频 / RSS 节点：优先节点里的链接，其次取上游或本次输入里的第一个链接 */
  const linkFor = (
    node: WorkflowNode,
    field: 'videoUrl' | 'rssUrl',
    upstream: string,
    input: string
  ): string => {
    const fill = (s: string): string =>
      s.replace(/\{\{upstream\}\}/g, upstream).replace(/\{\{input\}\}/g, input)
    const direct = fill(node[field] ?? '').trim()
    if (direct) return direct
    const found = `${upstream}\n${input}`.match(/https?:\/\/[^\s"'”’）)】\]]+/)
    return found ? found[0] : ''
  }

  /** 视频字幕：本机 yt-dlp 提取，失败时给出可执行的修复提示 */
  const runVideoNode = async (
    node: WorkflowNode,
    upstream: string,
    input: string
  ): Promise<{ ok: boolean; text: string; error?: string }> => {
    const url = linkFor(node, 'videoUrl', upstream, input)
    if (!url) return { ok: false, text: '', error: '请填写视频链接，或在上游提供链接' }
    const res = await api.workflowVideo({ url, langs: node.videoLang?.trim() || undefined })
    if (!res?.ok) return { ok: false, text: '', error: res?.error || '字幕提取失败' }
    return { ok: true, text: res.text }
  }

  /** RSS 阅读：抓取订阅源并解析成标题 + 摘要 + 链接 */
  const runRssNode = async (
    node: WorkflowNode,
    upstream: string,
    input: string
  ): Promise<{ ok: boolean; text: string; error?: string }> => {
    const url = linkFor(node, 'rssUrl', upstream, input)
    if (!url) return { ok: false, text: '', error: '请填写 RSS / Atom 地址，或在上游提供链接' }
    const res = await api.workflowFeed({ url, limit: node.rssLimit ?? 10 })
    if (!res?.ok) return { ok: false, text: '', error: res?.error || 'RSS 抓取失败' }
    return { ok: true, text: res.text }
  }

  const runNode = async (node: WorkflowNode, def: WorkflowDef, input: string, previous: Record<string, WorkflowNodeRun>): Promise<{ ok: boolean; text: string; error?: string }> => {
    const upstream = upstreamIdsOf(def, node.id)
      .map((id) => {
        const up = def.nodes.find((n) => n.id === id)
        const out = previous[id]?.output?.trim()
        return out ? `【${up?.title ?? id}】\n${out}` : ''
      })
      .filter(Boolean)
      .join('\n\n---\n\n')

    if (node.kind === 'input') {
      return input.trim() ? { ok: true, text: input.trim() } : { ok: false, text: '', error: '本次输入为空' }
    }
    if (node.kind === 'collect') {
      const res = await api.workflowCollect()
      if (!res?.ok) return { ok: false, text: '', error: res?.error || '采集失败' }
      return { ok: true, text: res.text }
    }
    if (node.kind === 'group') {
      const upIds = new Set(upstreamIdsOf(def, node.id))
      const children = def.nodes.filter((n) => n.parentId === node.id && !upIds.has(n.id))
      const childText = children
        .map((c) => (previous[c.id]?.output ? `【子节点 · ${c.title}】\n${previous[c.id]?.output}` : ''))
        .filter(Boolean)
        .join('\n\n')
      const text = [upstream, childText].filter(Boolean).join('\n\n')
      return text ? { ok: true, text } : { ok: false, text: '', error: '群组没有可聚合的上游或子节点输出' }
    }
    if (node.kind === 'output') {
      return upstream ? { ok: true, text: upstream } : { ok: false, text: '', error: '输出节点没有上游输出' }
    }
    if (node.kind === 'tool') {
      if (node.toolKind === 'video') return runVideoNode(node, upstream, input)
      if (node.toolKind === 'rss') return runRssNode(node, upstream, input)
      if (node.toolKind !== 'computer') return runBrowserNode(node, upstream, input)
      const cap = automation
      return {
        ok: true,
        text: [
          '【电脑操作节点】当前为能力入口，运行时待平台接入。',
          `Computer Use：${cap?.computerUse ? '系统支持（需在系统设置里授予辅助功能权限）' : '当前平台不支持'}`,
          upstream ? `上游输入：\n${upstream}` : '（无上游输入）'
        ].join('\n\n')
      }
    }
    if (node.kind === 'image') {
      if (!node.imageDataUrl) return { ok: false, text: '', error: '请先在右侧为图像节点选择图片' }
      const useOcr = node.imageMode === 'ocr' || (node.imageMode !== 'vision' && !visionOf(node.model))
      if (useOcr) {
        const r = await api.workflowOcr(node.imageDataUrl)
        return r.ok ? { ok: true, text: r.text } : { ok: false, text: '', error: r.error || 'OCR 未识别到文字' }
      }
      const r = await api.workflowRun({
        model: node.model || undefined,
        system: systemFor(node),
        prompt: promptFor(node, upstream, input),
        images: [node.imageDataUrl],
        think: false,
        timeoutMs: 180_000
      })
      if (r.ok) return { ok: true, text: r.text }
      if (node.imageMode === 'auto') {
        const ocr = await api.workflowOcr(node.imageDataUrl)
        if (ocr.ok) return { ok: true, text: `（视觉模型不可用，已回退 OCR）\n\n${ocr.text}` }
      }
      return { ok: false, text: '', error: r.error || '图像处理失败' }
    }

    // 会话上下文：agent 节点可接续已有会话 / 每次新建；其他节点不读写会话
    const sessionMode: 'none' | 'new' | 'existing' = node.kind === 'agent' ? (node.sessionMode ?? 'none') : 'none'
    let session: ChatSession | null = null
    if (sessionMode === 'existing' && node.sessionId) {
      try {
        session = (await api.listSessions()).find((s) => s.id === node.sessionId) ?? null
      } catch {
        session = null
      }
    }
    const sessionCtx = session ? sessionContextOf(session) : ''
    /** 运行成功后把节点输入与结果写回会话；写入失败不影响节点结果 */
    const rememberSession = async (output: string): Promise<void> => {
      if (sessionMode === 'none' || !output.trim()) return
      const ask = { role: 'user' as const, text: sessionAskText(node, input), time: Date.now() }
      try {
        if (sessionMode === 'existing') {
          if (!session) return
          await api.addSessionItem(session.id, ask)
          await api.addSessionItem(session.id, { role: 'ai', text: output, time: Date.now() })
        } else {
          const title = `${node.title} · ${new Date().toLocaleString('zh-CN', { hour12: false })}`
          const created = await api.createSession({ title, topic: 'general', target: { kind: 'local' }, first: ask })
          await api.addSessionItem(created.id, { role: 'ai', text: output, time: Date.now() })
        }
        await refreshSessions()
      } catch {
        /* 忽略：会话写入失败不回滚节点输出 */
      }
    }

    if (node.kind === 'agent' && node.agentId) {
      const agent = agents.find((a) => a.id === node.agentId)
      if (!agent) return { ok: false, text: '', error: '节点选择的 Agent 已不存在，请重新选择执行方式' }
      if (!agent.enabled || !agent.dispatchable || agent.status !== 'online') {
        return {
          ok: false,
          text: '',
          error: `Agent「${agent.name}」当前不可派发：${agent.detail || agent.lastError || '不在线'}`
        }
      }
      const res = await api.dispatchAgent(
        agent.id,
        [sessionCtx, systemFor(node), promptFor(node, upstream, input)].filter(Boolean).join('\n\n'),
        agent.cwd || undefined,
        true
      )
      if (res.ok) await rememberSession(res.output)
      return { ok: res.ok, text: res.output, error: res.error }
    }

    const res = await api.workflowRun({
      model: node.model || undefined,
      system: systemFor(node),
      prompt: [sessionCtx, promptFor(node, upstream, input)].filter(Boolean).join('\n\n')
    })
    if (res.ok) await rememberSession(res.text)
    return { ok: res.ok, text: res.text, error: res.error }
  }

  const runAll = async (onlyId?: string): Promise<void> => {
    if (!active || busy) return
    const ordered = topoSort(active)
    if (!ordered) {
      setStatus('检测到环形依赖，请检查连线')
      return
    }
    const targets = onlyId ? ordered.filter((n) => n.id === onlyId) : ordered
    if (!targets.length) return
    runStopRef.current = false
    setBusy(true)
    setStatus(onlyId ? '运行当前节点…' : '开始运行…')
    const outputs: Record<string, WorkflowNodeRun> = onlyId ? { ...runs } : {}
    if (!onlyId) {
      setRuns({})
      setLog([])
    }
    for (const node of targets) {
      if (runStopRef.current) break
      const startedAt = Date.now()
      setRun(node.id, { status: 'running', error: undefined, startedAt, endedAt: undefined, ms: undefined })
      let result: { ok: boolean; text: string; error?: string }
      try {
        result = await runNode(node, active, inputText, outputs)
      } catch (e) {
        result = { ok: false, text: '', error: (e as Error).message }
      }
      if (runStopRef.current) {
        const endedAt = Date.now()
        setRun(node.id, { status: 'idle', endedAt, ms: endedAt - startedAt })
        setBusy(false)
        setStatus('运行已停止')
        return
      }
      const endedAt = Date.now()
      const ms = endedAt - startedAt
      outputs[node.id] = { nodeId: node.id, status: result.ok ? 'done' : 'error', output: result.text, error: result.error, ms, startedAt, endedAt }
      setRun(node.id, { status: result.ok ? 'done' : 'error', output: result.text, error: result.error, ms, startedAt, endedAt })
      setLog((prev) => [
        ...prev,
        { nodeId: node.id, title: node.title, status: result.ok ? 'done' : 'error', input: inputText, output: result.text, error: result.error, ms, startedAt, endedAt }
      ])
      if (!result.ok) {
        setStatus(`节点「${node.title}」失败：${result.error ?? '未知错误'}`)
        setBusy(false)
        return
      }
    }
    setBusy(false)
    setStatus(runStopRef.current ? '运行已停止' : onlyId ? `节点「${targets[0].title}」完成` : '运行完成')
  }

  /** 停止运行：中止主进程里的模型调用 + 让渲染层循环不再继续 */
  const stopRun = async (): Promise<void> => {
    runStopRef.current = true
    setStatus('正在停止…')
    try {
      await api.workflowCancel()
    } catch {
      /* ignore */
    }
  }

  const assistBoundary = async (): Promise<void> => {
    if (!active || !selected || assistBusy) return
    setAssistBusy(true)
    setAssistResult('')
    try {
      const res = await api.workflowRun({
        model: selected.model || undefined,
        system:
          '你是多 Agent 工作流架构师。帮用户把一个节点定义成清晰边界：与上下游不重叠、可独立执行。只输出三行，格式必须是「角色：…」「工作：…」「输出：…」，不要解释。',
        prompt: [
          `工作流目标：${active.goal || active.name}`,
          `节点名称：${selected.title}`,
          `节点类型：${NODE_META[selected.kind].label}`,
          `已有角色：${selected.role || '无'}`,
          `已有工作：${selected.duty || '无'}`,
          `已有输出：${selected.outputSpec || '无'}`,
          '请给出更清晰、可执行、与其他节点不重叠的边界。'
        ].join('\n'),
        think: false,
        timeoutMs: 180_000
      })
      if (!res.ok) {
        setStatus(`辅助定义失败：${res.error ?? '未知错误'}`)
        return
      }
      setAssistResult(res.text)
    } finally {
      setAssistBusy(false)
    }
  }

  const applyAssist = (): void => {
    if (!selected) return
    const parsed = parseBoundary(assistResult)
    patchNode(selected.id, {
      ...(parsed.role ? { role: parsed.role } : {}),
      ...(parsed.duty ? { duty: parsed.duty } : {}),
      ...(parsed.outputSpec ? { outputSpec: parsed.outputSpec } : {})
    })
    setStatus('已填入节点边界')
  }

  /** 让本地模型把需求拆成多个子 Agent，挂在当前群组节点下 */
  const splitGroup = async (): Promise<void> => {
    if (!active || !selected || selected.kind !== 'group' || splitBusy) return
    setSplitBusy(true)
    setStatus('正在把需求拆成子 Agent…')
    try {
      const upstream = upstreamIdsOf(active, selected.id)
        .map((id) => {
          const node = active.nodes.find((n) => n.id === id)
          const out = runs[id]?.output
          return `【${node?.title ?? id}】\n${out ?? ''}`
        })
        .filter((t) => t.trim())
        .join('\n\n')
      const res = await api.workflowRun({
        model: selected.model || undefined,
        system: [
          '你是多 Agent 架构师。把用户的需求拆成 2-6 个可独立执行的子 Agent。',
          '只返回 JSON 数组，不要 Markdown，不要解释。',
          '每个元素格式：{"title":"子 Agent 名称","role":"角色","duty":"工作定义","output":"输出物"}'
        ].join('\n'),
        prompt: [
          `总目标：${active.goal || active.name}`,
          `本次输入：${inputText || '（无）'}`,
          upstream ? `上游输出：\n${upstream}` : '',
          '请按信息处理链路拆分，每个子 Agent 边界清晰、互不重叠。'
        ]
          .filter(Boolean)
          .join('\n\n'),
        think: false,
        timeoutMs: 240_000
      })
      if (!res.ok) {
        setStatus(`拆解失败：${res.error ?? '未知错误'}`)
        return
      }
      const raw = res.text.replace(/```json|```/gi, '').trim()
      const start = raw.indexOf('[')
      const end = raw.lastIndexOf(']')
      const jsonText = start >= 0 && end > start ? raw.slice(start, end + 1) : raw
      let items: Array<{ title?: string; role?: string; duty?: string; output?: string }> = []
      try {
        const parsed = JSON.parse(jsonText) as unknown
        if (Array.isArray(parsed)) items = parsed as typeof items
      } catch {
        setStatus('模型没有返回可解析的 JSON，请重试或换模型')
        setAssistResult(res.text)
        return
      }
      const children = items.slice(0, 8).map((it, i) => ({
        id: uid('n'),
        kind: 'agent' as const,
        title: String(it.title || `子 Agent ${i + 1}`).slice(0, 40),
        role: String(it.role || '').slice(0, 200),
        duty: String(it.duty || '').slice(0, 500),
        outputSpec: String(it.output || '').slice(0, 400),
        x: selected.x + 250,
        y: selected.y + i * 130,
        parentId: selected.id
      }))
      if (!children.length) {
        setStatus('模型没有拆出子 Agent')
        return
      }
      const source = upstreamIdsOf(active, selected.id)[0]
      const edges = [
        ...(source ? children.map((c) => ({ id: uid('e'), from: source, to: c.id })) : []),
        ...children.map((c) => ({ id: uid('e'), from: c.id, to: selected.id }))
      ]
      updateActive((d) => ({ ...d, nodes: [...d.nodes, ...children], edges: [...d.edges, ...edges] }))
      setStatus(`已拆出 ${children.length} 个子 Agent，挂在「${selected.title}」下`)
    } finally {
      setSplitBusy(false)
    }
  }

  const onImageFile = (file: File): void => {
    if (!selected) return
    if (file.size > 6 * 1024 * 1024) {
      setStatus('图片超过 6MB，请压缩后再试')
      return
    }
    const reader = new FileReader()
    reader.onload = () => patchNode(selected.id, { imageDataUrl: String(reader.result ?? '') })
    reader.readAsDataURL(file)
  }

  const applyTemplate = (): void => {
    const now = Date.now()
    const nodes: WorkflowNode[] = [
      { id: 'n_input', kind: 'input', title: '需求输入', x: 60, y: 240 },
      { id: 'n_collect', kind: 'collect', title: '系统采集', x: 300, y: 70 },
      {
        id: 'n_split',
        kind: 'agent',
        title: '信息拆解 Agent',
        x: 300,
        y: 240,
        role: '信息拆解专家',
        duty: '把输入信息按主题拆成结构化知识条目，判断每条是否属于健康知识',
        outputSpec: 'JSON 数组：[{主题, 标题, 要点, 是否健康知识, 归属知识库}]'
      },
      {
        id: 'n_group',
        kind: 'group',
        title: '健康知识库群组',
        x: 560,
        y: 240,
        note: '后续可在这里挂载：清洗、去重、审核、入库等子 Agent'
      },
      { id: 'n_output', kind: 'output', title: '知识入库', x: 820, y: 240 }
    ]
    const edges = [
      { id: 'e1', from: 'n_input', to: 'n_collect' },
      { id: 'e2', from: 'n_input', to: 'n_split' },
      { id: 'e3', from: 'n_collect', to: 'n_split' },
      { id: 'e4', from: 'n_split', to: 'n_group' },
      { id: 'e5', from: 'n_group', to: 'n_output' }
    ]
    updateActive((d) => ({ ...d, nodes, edges, goal: '把杂乱信息拆解为健康知识库可入库的结构化条目', updatedAt: now }))
    setSelectedId('n_split')
    setRuns({})
    setLog([])
    setStatus('已套用示例：情报 → 健康知识库')
  }

  const createWorkflow = (): void => {
    const def = createDefaultWorkflow()
    setDefs((prev) => [...prev, def])
    setActiveId(def.id)
    setSelectedId(def.nodes[0].id)
    setRuns({})
    setLog([])
  }

  const removeWorkflow = async (): Promise<void> => {
    if (!active || defs.length <= 1) return
    if (!window.confirm(`删除工作流「${active.name}」？`)) return
    await api.workflowRemove(active.id)
    const next = defs.filter((d) => d.id !== active.id)
    setDefs(next)
    setActiveId(next[0]?.id ?? '')
    setSelectedId(next[0]?.nodes[0]?.id ?? null)
  }

  const duplicateWorkflow = (): void => {
    const def = activeRef.current
    if (!def) return
    const now = Date.now()
    const copy: WorkflowDef = {
      ...structuredClone(def),
      id: uid('wf'),
      name: `${def.name} 副本`,
      createdAt: now,
      updatedAt: now
    }
    setDefs((prev) => [...prev, copy])
    setActiveId(copy.id)
    setSelectedId(copy.nodes[0]?.id ?? null)
    setRuns({})
    setLog([])
    setStatus('已复制工作流')
  }

  const refreshAgents = async (): Promise<void> => {
    try {
      const res = await api.listAgents()
      setAgents((res?.agents ?? []).filter((a) => !a.builtin))
      setStatus('已刷新 Agent 状态')
    } catch (e) {
      setStatus(`刷新 Agent 失败：${(e as Error).message}`)
    }
  }

  const refreshModels = async (): Promise<void> => {
    setStatus('探测模型能力…')
    const res = await api.workflowModels(true)
    setModels(res?.models ?? [])
    setModelInfo({ baseUrl: res?.baseUrl ?? '', ollama: !!res?.ollama, error: res?.error })
    setStatus(res?.error ?? `模型 ${res?.models.length ?? 0} 个 ${res?.ollama ? '（Ollama）' : ''}`)
  }

  const previewCollect = async (): Promise<void> => {
    setStatus('采集本机上下文…')
    const res = await api.workflowCollect()
    setCollectPreview(res?.ok ? res.text : res?.error ?? '采集失败')
    setStatus(res?.ok ? '采集完成' : res?.error ?? '采集失败')
  }

  /** 重新拉取问答页会话列表（新建/删除会话后同步） */
  const refreshSessions = async (): Promise<void> => {
    try {
      setSessions(((await api.listSessions()) ?? []).filter((s) => !s.archived))
    } catch {
      /* 忽略：会话不可用不影响编排 */
    }
  }

  /** 把节点真实产物存进本地知识库；回顾页「知识沉淀」会直接看到 */
  const archiveNode = async (node: WorkflowNode): Promise<void> => {
    const body = (runs[node.id]?.output ?? '').trim()
    if (!body) {
      setStatus('这个节点还没有可归档的输出')
      return
    }
    const key = `${node.id}:${body.length}`
    if (archived[key]) {
      setStatus('这条产物已经存入知识库')
      return
    }
    try {
      const item = await api.addKnowledge?.({
        title: `${active?.name ?? '工作流'} · ${node.title}`,
        body,
        source: 'workflow',
        links: active ? [{ type: 'workflow', id: active.id, title: active.name }] : [],
        tags: ['工作流产物']
      })
      if (!item) {
        setStatus('归档失败：知识库接口不可用')
        return
      }
      setArchived((prev) => ({ ...prev, [key]: true }))
      setStatus(`已存入知识：${item.title}`)
    } catch (e) {
      setStatus(`归档失败：${(e as Error).message}`)
    }
  }

  const visionCount = models.filter((m) => m.vision).length
  const finalText = useMemo(() => {
    if (!active) return ''
    const outputs = active.nodes.filter((n) => n.kind === 'output')
    const last = outputs[outputs.length - 1]
    return last ? runs[last.id]?.output ?? '' : ''
  }, [active, runs])

  return (
    <div>
      <PageHeader
        icon="sparkles"
        title="工作流"
        desc={viewMode === 'board' ? '实时查看成员分工、依赖调度、真实产物与执行时间轴' : '拖入节点 → 右键或双击配置 → 从节点右侧圆点拖出连线 → 运行；Shift+拖动框选、⌘C/V 复制粘贴、⌘Z 撤销、滚轮缩放、空白拖动平移'}
        actions={
          <>
            <div className="flex rounded-lg p-0.5" style={{ background: 'var(--surface-2)', border: '1px solid var(--line)' }}>
              <button className={`rounded-md px-2.5 py-1 text-xs ${viewMode === 'board' ? 'primary' : 'text-slate-500'}`} style={viewMode === 'board' ? { background: 'var(--surface-3)', color: 'var(--text-1)' } : undefined} onClick={() => setViewMode('board')}>作战板</button>
              <button className={`rounded-md px-2.5 py-1 text-xs ${viewMode === 'studio' ? 'primary' : 'text-slate-500'}`} style={viewMode === 'studio' ? { background: 'var(--surface-3)', color: 'var(--text-1)' } : undefined} onClick={() => setViewMode('studio')}>编排</button>
            </div>
            <button className="glass-btn px-2.5 py-1.5 text-xs" onClick={() => void refreshModels()}>
              模型能力 {models.length ? `· ${models.length}` : ''}
            </button>
            {viewMode === 'studio' ? (
              <button className="glass-btn primary px-3 py-1.5 text-xs" disabled={busy || !active} onClick={() => void runAll()}>
                {busy ? '运行中…' : '运行全部'}
              </button>
            ) : null}
          </>
        }
      />

      {viewMode === 'board' ? (
        <WorkflowBattleBoard
          def={active}
          defs={defs}
          agents={agents}
          runs={runs}
          runRecords={runRecords}
          inputText={inputText}
          finalText={finalText}
          busy={busy}
          status={status}
          archived={archived}
          onArchive={(node) => void archiveNode(node)}
          onInputChange={setInputText}
          onSelectWorkflow={(id) => {
            const next = defs.find((item) => item.id === id)
            setActiveId(id)
            setSelectedId(next?.nodes[0]?.id ?? null)
            setRuns({})
            setLog([])
          }}
          onRun={() => void runAll()}
          onStop={() => void stopRun()}
          onOpenStudio={(nodeId) => {
            if (nodeId) setSelectedId(nodeId)
            setViewMode('studio')
          }}
        />
      ) : (
        <>
      <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-slate-500">
        <span className="rounded-full px-2 py-0.5" style={{ background: 'var(--surface-2)' }}>
          {modelInfo?.ollama ? '本机 Ollama' : 'OpenAI 兼容接口'}
        </span>
        <span className="rounded-full px-2 py-0.5" style={{ background: 'var(--surface-2)' }}>
          视觉模型 {visionCount}/{models.length || '—'}
        </span>
        {modelInfo?.error ? <span className="text-amber-400">{modelInfo.error}</span> : null}
        {automation ? <span className="truncate text-slate-600">{automation.detail}</span> : null}
        <span className="ml-auto text-slate-600">{status}</span>
      </div>

      <div className="mt-4 grid gap-4" style={{ gridTemplateColumns: '188px minmax(0, 1fr)' }}>
        {/* 左：节点面板 + 本次输入 */}
        <aside className="flex flex-col gap-3">
          <section className="glass-card !p-3">
            <div className="mb-2 text-2xs uppercase tracking-wider text-slate-600">节点</div>
            <div className="flex flex-col gap-1.5">
              {KIND_ORDER.map((kind) => (
                <button
                  key={kind}
                  type="button"
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData('application/x-workflow-kind', kind)
                    e.dataTransfer.effectAllowed = 'copy'
                  }}
                  onClick={() => addNode(kind, 120 + Math.random() * 160, 120 + Math.random() * 260)}
                  className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs text-slate-300 transition-colors hover:bg-[var(--surface-2)]"
                  title={NODE_META[kind].hint}
                >
                  <span className="inline-block h-2 w-2 shrink-0 rounded-full" style={{ background: NODE_META[kind].color }} />
                  <span className="truncate">{NODE_META[kind].label}</span>
                  <span className="ml-auto text-2xs text-slate-600">拖动</span>
                </button>
              ))}
            </div>
          </section>

          <section className="glass-card !p-3">
            <div className="mb-2 flex items-center gap-2 text-2xs uppercase tracking-wider text-slate-600">
              本次输入
              <button className="ml-auto normal-case tracking-normal text-slate-500 hover:text-slate-200" onClick={() => void previewCollect()}>
                采集预览
              </button>
            </div>
            <textarea
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              placeholder="把这次要处理的需求 / 信息贴进来"
              className="h-28 w-full resize-none rounded-lg px-2 py-1.5 text-xs text-slate-200 outline-none"
              style={{ background: 'var(--surface-2)', border: '1px solid var(--line)' }}
            />
            {collectPreview ? (
              <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap text-2xs leading-relaxed text-slate-500">{collectPreview}</pre>
            ) : null}
          </section>

          <section className="glass-card !p-3">
            <div className="mb-2 text-2xs uppercase tracking-wider text-slate-600">工作流</div>
            <div className="flex flex-col gap-1.5">
              {defs.map((d) => (
                <button
                  key={d.id}
                  onClick={() => {
                    setActiveId(d.id)
                    setSelectedId(d.nodes[0]?.id ?? null)
                    setRuns({})
                    setLog([])
                  }}
                  className={`truncate rounded-lg px-2 py-1.5 text-left text-xs ${d.id === activeId ? 'bg-[var(--surface-3)] text-slate-100' : 'text-slate-400 hover:bg-[var(--surface-2)]'}`}
                >
                  {d.name}
                </button>
              ))}
            </div>
            <div className="mt-2 flex gap-1.5">
              <button className="glass-btn flex-1 px-2 py-1 text-2xs" onClick={createWorkflow}>新建</button>
              <button className="glass-btn flex-1 px-2 py-1 text-2xs" onClick={duplicateWorkflow} disabled={!active}>复制</button>
              <button className="glass-btn flex-1 px-2 py-1 text-2xs" onClick={() => void removeWorkflow()} disabled={defs.length <= 1}>删除</button>
            </div>
            <button className="glass-btn mt-1.5 w-full px-2 py-1 text-2xs" onClick={applyTemplate}>套用示例：情报 → 健康知识库</button>
          </section>

          <section className="glass-card !p-3">
            <div className="mb-2 flex items-center gap-2 text-2xs uppercase tracking-wider text-slate-600">
              定时运行
              <label className="ml-auto flex cursor-pointer items-center gap-1.5 normal-case tracking-normal text-slate-500">
                <input
                  type="checkbox"
                  checked={!!active?.schedule?.enabled}
                  onChange={(e) => updateSchedule({ enabled: e.target.checked })}
                  className="accent-[var(--aura)]"
                />
                启用
              </label>
            </div>
            <div className="flex items-center gap-1.5">
              <input
                type="time"
                value={active?.schedule?.atHHMM ?? '09:00'}
                onChange={(e) => updateSchedule({ atHHMM: e.target.value })}
                className="min-w-0 flex-1 rounded-lg px-2 py-1 text-xs text-slate-200 outline-none"
                style={{ background: 'var(--surface-2)', border: '1px solid var(--line)' }}
              />
              <select
                value={active?.schedule?.mode ?? 'daily'}
                onChange={(e) => updateSchedule({ mode: e.target.value as 'daily' | 'night' })}
                className="rounded-lg px-2 py-1 text-xs text-slate-300 outline-none"
                style={{ background: 'var(--surface-2)', border: '1px solid var(--line)' }}
              >
                <option value="daily">每天</option>
                <option value="night">夜间</option>
              </select>
            </div>
            <input
              value={active?.schedule?.input ?? ''}
              onChange={(e) => updateSchedule({ input: e.target.value })}
              placeholder="定时输入（留空 = 定时运行）"
              className="mt-1.5 w-full rounded-lg px-2 py-1 text-2xs text-slate-300 outline-none"
              style={{ background: 'var(--surface-2)', border: '1px solid var(--line)' }}
            />
            <div className="mt-1.5 flex gap-1.5">
              <button
                className="glass-btn flex-1 px-2 py-1 text-2xs"
                disabled={!active || busy}
                title="按定时的执行方式在后台完整跑一次，结果写入运行记录"
                onClick={() => void runScheduledOnce()}
              >
                立即跑一次
              </button>
              <button
                className="glass-btn px-2 py-1 text-2xs"
                disabled={!active}
                title="把当前画布导出为可分享的 HTML 流程图"
                onClick={() => {
                  if (!active) return
                  void api
                    .exportFlow({
                      title: active.name,
                      nodes: active.nodes.map((n) => ({ id: n.id, label: n.title, kind: n.kind })),
                      edges: active.edges.map((e) => ({ from: e.from, to: e.to }))
                    })
                    .then((r) => setStatus(`已导出流程图：${r.path ?? ''}`))
                    .catch((e: unknown) => setStatus(`导出失败：${(e as Error).message}`))
                }}
              >
                导出流程图
              </button>
              <button
                className="glass-btn px-2 py-1 text-2xs"
                onClick={() => {
                  setRecordsOpen((v) => !v)
                  void refreshRunRecords(activeId)
                }}
              >
                记录 {runRecords.length || ''}
              </button>
            </div>
            {active?.schedule?.lastRunAt ? (
              <div className="mt-1.5 text-2xs text-slate-600">
                上次定时：
                {new Date(active.schedule.lastRunAt).toLocaleString('zh-CN', { hour12: false })}
              </div>
            ) : null}
            {recordsOpen ? (
              <div className="mt-1.5 max-h-44 overflow-auto rounded-lg" style={{ background: 'var(--surface-2)' }}>
                {runRecords.length ? (
                  runRecords.map((r) => (
                    <details key={r.id} className="border-b px-1.5 py-1 text-2xs last:border-0" style={{ borderColor: 'var(--line)' }}>
                      <summary className="flex cursor-pointer list-none items-center gap-1.5 text-slate-400">
                        <span
                          className="inline-block h-1.5 w-1.5 shrink-0 rounded-full"
                          style={{ background: r.ok ? '#34d399' : '#f87171' }}
                        />
                        <span className="shrink-0 text-slate-500">
                          {new Date(r.startedAt).toLocaleTimeString('zh-CN', { hour12: false })}
                        </span>
                        <span className="truncate">{r.trigger === 'schedule' ? '定时' : '手动'}</span>
                        <span className="ml-auto shrink-0 text-slate-600">
                          {Math.round((r.endedAt - r.startedAt) / 1000)}s
                        </span>
                      </summary>
                      <div className="mt-1 whitespace-pre-wrap break-words text-slate-500">
                        {r.error ?? r.output ?? '（无输出）'}
                      </div>
                    </details>
                  ))
                ) : (
                  <div className="px-2 py-2 text-2xs text-slate-600">还没有运行记录</div>
                )}
              </div>
            ) : null}
          </section>
        </aside>

        {/* 中：画布 + 执行记录 */}
        <section className="min-w-0">
          <div className="mb-2 flex items-center gap-2">
            <input
              value={active?.name ?? ''}
              onChange={(e) => updateActive((d) => ({ ...d, name: e.target.value }))}
              className="min-w-0 flex-1 rounded-lg px-2 py-1 text-sm font-medium text-slate-200 outline-none"
              style={{ background: 'var(--surface-2)', border: '1px solid var(--line)' }}
            />
            <span className="shrink-0 text-2xs text-slate-600" title="工作流会自动保存">
              {saving ? '保存中…' : savedAt ? `已保存 ${new Date(savedAt).toLocaleTimeString('zh-CN', { hour12: false })}` : '未保存'}
            </span>
            {busy ? (
              <button className="glass-btn px-2 py-1 text-2xs" onClick={() => void stopRun()}>停止</button>
            ) : (
              <button className="glass-btn px-2 py-1 text-2xs" onClick={() => void runAll()}>运行</button>
            )}
          </div>
          <input
            value={active?.goal ?? ''}
            onChange={(e) => updateActive((d) => ({ ...d, goal: e.target.value }))}
            placeholder="工作流目标（辅助定义边界时会用到）"
            className="mb-2 w-full rounded-lg px-2 py-1 text-2xs text-slate-400 outline-none"
            style={{ background: 'var(--surface-2)', border: '1px solid var(--line)' }}
          />

          <div
            ref={viewportRef}
            className="relative overflow-hidden rounded-xl"
            style={{
              height: 'clamp(480px, calc(100vh - 380px), 920px)',
              background: 'var(--bg-surface)',
              border: `1px solid ${dropActive ? 'var(--accent)' : 'var(--line)'}`,
              backgroundImage: 'radial-gradient(circle, rgba(148,163,184,0.16) 1px, transparent 1px)',
              backgroundSize: `${24 * view.zoom}px ${24 * view.zoom}px`,
              backgroundPosition: `${view.x}px ${view.y}px`,
              cursor: linking ? 'crosshair' : undefined
            }}
            onDragOver={(e) => {
              e.preventDefault()
              e.dataTransfer.dropEffect = 'copy'
              if (!dropActive) setDropActive(true)
            }}
            onDragLeave={() => setDropActive(false)}
            onDrop={(e) => {
              e.preventDefault()
              setDropActive(false)
              const kind = e.dataTransfer.getData('application/x-workflow-kind') as WorkflowNodeKind
              if (!KIND_ORDER.includes(kind)) return
              const p = toScene(e.clientX, e.clientY)
              addNode(kind, p.x - 95, p.y - 40)
            }}
            onPointerDown={(e) => {
              if (e.button !== 0 && e.button !== 1) return
              if ((e.target as HTMLElement).closest('[data-node]')) return
              // Shift + 左键：框选；普通左键 / 中键：平移画布
              if (e.shiftKey && e.button === 0) {
                e.preventDefault()
                const start = toScene(e.clientX, e.clientY)
                setMarquee({ x1: start.x, y1: start.y, x2: start.x, y2: start.y })
                const move = (ev: PointerEvent): void => {
                  const p = toScene(ev.clientX, ev.clientY)
                  setMarquee({ x1: start.x, y1: start.y, x2: p.x, y2: p.y })
                }
                const up = (ev: PointerEvent): void => {
                  const p = toScene(ev.clientX, ev.clientY)
                  const x1 = Math.min(start.x, p.x)
                  const y1 = Math.min(start.y, p.y)
                  const x2 = Math.max(start.x, p.x)
                  const y2 = Math.max(start.y, p.y)
                  if (x2 - x1 > 6 && y2 - y1 > 6) {
                    const ids = (activeRef.current?.nodes ?? [])
                      .filter((n) => n.x < x2 && n.x + 190 > x1 && n.y < y2 && n.y + 116 > y1)
                      .map((n) => n.id)
                    setSelectedMulti(ids)
                    setSelectedId(ids[ids.length - 1] ?? null)
                    setStatus(ids.length ? `框选 ${ids.length} 个节点` : '')
                  }
                  setMarquee(null)
                  window.removeEventListener('pointermove', move)
                  window.removeEventListener('pointerup', up)
                }
                window.addEventListener('pointermove', move)
                window.addEventListener('pointerup', up)
                return
              }
              panRef.current = { sx: e.clientX, sy: e.clientY, ox: view.x, oy: view.y }
              const move = (ev: PointerEvent): void => {
                const p = panRef.current
                if (!p) return
                setView((prev) => ({ ...prev, x: p.ox + ev.clientX - p.sx, y: p.oy + ev.clientY - p.sy }))
              }
              const up = (): void => {
                panRef.current = null
                window.removeEventListener('pointermove', move)
                window.removeEventListener('pointerup', up)
              }
              window.addEventListener('pointermove', move)
              window.addEventListener('pointerup', up)
            }}
            onClick={(e) => {
              if ((e.target as HTMLElement).closest('[data-node]')) return
              setSelectedEdgeId(null)
              setCtxMenu(null)
            }}
            onContextMenu={(e) => {
              if ((e.target as HTMLElement).closest('[data-node]')) return
              e.preventDefault()
              setCtxMenu({ x: e.clientX, y: e.clientY })
            }}
          >
            {/* 画布工具条：撤销 / 重做 / 网格吸附 */}
            <div
              className="absolute right-2 top-2 z-10 flex items-center gap-1 rounded-lg px-1.5 py-1 text-2xs"
              style={{ background: 'var(--bg-deep)', border: '1px solid var(--line)' }}
            >
              <button
                className="ui-icon-btn h-5 px-1 disabled:opacity-35"
                title="撤销（⌘Z）"
                onClick={undo}
                disabled={!canUndo}
              >
                ↶
              </button>
              <button
                className="ui-icon-btn h-5 px-1 disabled:opacity-35"
                title="重做（⇧⌘Z）"
                onClick={redo}
                disabled={!canRedo}
              >
                ↷
              </button>
              <span className="mx-0.5 h-3 w-px" style={{ background: 'var(--line)' }} />
              <button
                type="button"
                aria-pressed={snapEnabled}
                title="8px 网格吸附（按住 Alt 临时反转）"
                onClick={() => {
                  const next = !snapEnabled
                  setSnapEnabled(next)
                  try {
                    localStorage.setItem('workon:wf-snap', next ? '1' : '0')
                  } catch { /* ignore */ }
                }}
                className={`rounded px-1.5 py-0.5 ${snapEnabled ? 'text-slate-200' : 'text-slate-600'}`}
                style={snapEnabled ? { background: 'var(--surface-2)' } : undefined}
              >
                吸附
              </button>
              <button
                type="button"
                title="按连线层级自动排列（可撤销）"
                onClick={autoLayout}
                className="rounded px-1.5 py-0.5 text-slate-400 hover:bg-[var(--surface-2)] hover:text-slate-200"
              >
                排列
              </button>
              {selectedIds.size > 1 ? <span className="ml-0.5 text-slate-500">已选 {selectedIds.size}</span> : null}
            </div>
            {linking ? (
              <div
                className="pointer-events-none absolute left-1/2 top-2 z-10 -translate-x-1/2 rounded-md px-2 py-1 text-2xs"
                style={{ background: 'var(--bg-deep)', border: '1px solid var(--accent)', color: 'var(--accent)' }}
              >
                连线中：拖到目标节点松开 · Esc 取消
              </div>
            ) : null}
            <div
              ref={sceneRef}
              className="relative origin-top-left"
              style={{
                width: sceneSize.w,
                height: sceneSize.h,
                transform: `translate(${view.x}px, ${view.y}px) scale(${view.zoom})`
              }}
            >
              <svg className="absolute inset-0" width={sceneSize.w} height={sceneSize.h}>
                <defs>
                  <marker
                    id="wf-arrow"
                    viewBox="0 0 10 10"
                    refX="9"
                    refY="5"
                    markerWidth="6"
                    markerHeight="6"
                    orient="auto-start-reverse"
                  >
                    <path d="M 0 0 L 10 5 L 0 10 z" fill="rgba(148,163,184,0.72)" />
                  </marker>
                </defs>
                {active?.edges.map((e) => {
                  const from = active.nodes.find((n) => n.id === e.from)
                  const to = active.nodes.find((n) => n.id === e.to)
                  if (!from || !to) return null
                  const d = edgePath(from.x + 190, from.y + 46, to.x, to.y + 46)
                  const isSel = selectedEdgeId === e.id
                  const hot = isSel || hoverEdgeId === e.id
                  return (
                    <g key={e.id}>
                      <path
                        d={d}
                        fill="none"
                        stroke={isSel ? 'var(--accent)' : hot ? 'rgba(96,165,250,0.82)' : 'rgba(148,163,184,0.4)'}
                        strokeWidth={isSel ? 2.4 : hot ? 2.1 : 1.5}
                        markerEnd="url(#wf-arrow)"
                        style={{ transition: 'stroke 120ms ease, stroke-width 120ms ease', pointerEvents: 'none' }}
                      />
                      <path
                        d={d}
                        data-edge={e.id}
                        fill="none"
                        stroke="transparent"
                        strokeWidth={14}
                        style={{ pointerEvents: 'stroke', cursor: 'pointer' }}
                        onPointerEnter={() => setHoverEdgeId(e.id)}
                        onPointerLeave={() => setHoverEdgeId((prev) => (prev === e.id ? null : prev))}
                        onClick={(ev) => {
                          ev.stopPropagation()
                          setSelectedId(null)
                          setSelectedEdgeId(e.id)
                        }}
                        onContextMenu={(ev) => {
                          ev.preventDefault()
                          ev.stopPropagation()
                          setSelectedEdgeId(e.id)
                          setCtxMenu({ x: ev.clientX, y: ev.clientY, edgeId: e.id })
                        }}
                      />
                    </g>
                  )
                })}
                {linking ? (
                  <path
                    d={edgePath(
                      (active?.nodes.find((n) => n.id === linking.from)?.x ?? 0) + 190,
                      (active?.nodes.find((n) => n.id === linking.from)?.y ?? 0) + 46,
                      linking.x,
                      linking.y
                    )}
                    fill="none"
                    stroke="rgba(96,165,250,0.8)"
                    strokeWidth={1.5}
                    strokeDasharray="4 4"
                    markerEnd="url(#wf-arrow)"
                  />
                ) : null}
              </svg>

              {active?.nodes.map((n) => {
                const run = runs[n.id]
                const isSelected = selectedIds.has(n.id)
                const isLinkTarget = linkHover === n.id
                const isLinkSource = linking?.from === n.id
                const nodeAgent = n.agentId ? agents.find((a) => a.id === n.agentId) : undefined
                return (
                  <div
                    key={n.id}
                    data-node={n.id}
                    onPointerDown={(e) => onNodePointerDown(e, n)}
                    onDoubleClick={(e) => {
                      e.preventDefault()
                      openPanelFor(n.id)
                    }}
                    onContextMenu={(e) => {
                      e.preventDefault()
                      e.stopPropagation()
                      setSelectedId(n.id)
                      setSelectedMulti([])
                      setSelectedEdgeId(null)
                      setCtxMenu({ x: e.clientX, y: e.clientY, nodeId: n.id })
                    }}
                    className={`absolute w-[190px] select-none rounded-xl p-3 ${
                      linking ? 'cursor-crosshair' : 'cursor-grab active:cursor-grabbing'
                    }`}
                    style={{
                      left: n.x,
                      top: n.y,
                      background: 'var(--bg-deep)',
                      border: `1px ${isLinkTarget ? 'dashed' : 'solid'} ${
                        isSelected || isLinkTarget ? 'var(--accent)' : 'var(--line)'
                      }`,
                      boxShadow: isLinkTarget
                        ? '0 0 0 3px var(--accent-softer), var(--shadow-lg)'
                        : isSelected
                          ? '0 0 0 1px var(--accent-softer), var(--shadow-lg)'
                          : 'var(--shadow-sm)'
                    }}
                  >
                    <div className="flex items-center gap-1.5">
                      <span className="inline-block h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: NODE_META[n.kind].color }} />
                      <span className="truncate text-xs font-medium text-slate-200">{n.title}</span>
                      <span className="ml-auto shrink-0 text-2xs text-slate-600">{NODE_META[n.kind].label}</span>
                    </div>
                    <div className="mt-1 line-clamp-2 min-h-[26px] text-2xs leading-relaxed text-slate-500">
                      {n.kind === 'tool' && (n.browserUrl || n.videoUrl || n.rssUrl)
                        ? (n.browserUrl || n.videoUrl || n.rssUrl)
                        : n.role || n.duty || NODE_META[n.kind].hint}
                    </div>
                    <div className="mt-1.5 flex items-center gap-1.5 text-2xs">
                      <span className="inline-block h-1 w-1 rounded-full" style={{ background: RUN_COLOR[run?.status ?? 'idle'] }} />
                      <span className="text-slate-600">
                        {run?.status === 'running' ? '运行中' : run?.status === 'done' ? `完成 ${run.ms ?? 0}ms` : run?.status === 'error' ? '失败' : '未运行'}
                      </span>
                      {n.agentId ? (
                        <span className="ml-auto max-w-[100px] truncate text-slate-600" title={nodeAgent?.name ?? 'Agent 已移除'}>
                          {nodeAgent?.name ?? 'Agent 已移除'}
                        </span>
                      ) : n.model ? (
                        <span className="ml-auto max-w-[90px] truncate text-slate-600">{n.model}</span>
                      ) : null}
                    </div>

                    <div
                      data-input-port={n.id}
                      title="输入口：把上游输出拖到这里"
                      className="absolute -left-2 h-4 w-4 rounded-full border-2 transition-all"
                      style={{
                        top: 38,
                        background: 'var(--bg-deep)',
                        borderColor: isLinkTarget
                          ? 'var(--accent)'
                          : linking
                            ? 'rgba(96,165,250,0.8)'
                            : 'var(--line-strong)',
                        boxShadow: isLinkTarget ? '0 0 0 4px var(--accent-softer)' : 'none',
                        transform: isLinkTarget ? 'scale(1.25)' : undefined
                      }}
                    />
                    <div
                      data-port="out"
                      title="输出口：拖到下游节点（也可右键节点选择「从这里连线」）"
                      onPointerDown={(e) => {
                        e.stopPropagation()
                        setLinking({ from: n.id, x: n.x + 190, y: n.y + 46 })
                        setLinkHover(null)
                      }}
                      className="absolute -right-2 h-4 w-4 cursor-crosshair rounded-full border-2 transition-transform hover:scale-125"
                      style={{
                        top: 38,
                        background: 'var(--accent)',
                        borderColor: 'var(--accent)',
                        boxShadow: isLinkSource ? '0 0 0 3px var(--accent-softer)' : '0 0 0 2px var(--bg-deep)'
                      }}
                    />
                  </div>
                )
              })}

              {/* 拖动对齐辅助线 */}
              {guides.vertical.map((x) => (
                <div
                  key={`gv_${x}`}
                  data-guide="v"
                  className="pointer-events-none absolute top-0"
                  style={{ left: x, width: 0, height: sceneSize.h, borderLeft: '1px dashed var(--accent)', opacity: 0.7 }}
                />
              ))}
              {guides.horizontal.map((y) => (
                <div
                  key={`gh_${y}`}
                  data-guide="h"
                  className="pointer-events-none absolute left-0"
                  style={{ top: y, height: 0, width: sceneSize.w, borderTop: '1px dashed var(--accent)', opacity: 0.7 }}
                />
              ))}

              {/* Shift 拖动框选 */}
              {marquee ? (
                <div
                  className="pointer-events-none absolute rounded-sm"
                  style={{
                    left: Math.min(marquee.x1, marquee.x2),
                    top: Math.min(marquee.y1, marquee.y2),
                    width: Math.abs(marquee.x2 - marquee.x1),
                    height: Math.abs(marquee.y2 - marquee.y1),
                    background: 'var(--accent-softer)',
                    border: '1px dashed var(--accent)'
                  }}
                />
              ) : null}
            </div>

            {/* 缩放 / 视图控件 */}
            <div
              className="absolute bottom-2 left-2 flex items-center gap-1 rounded-lg px-1.5 py-1 text-2xs"
              style={{ background: 'var(--bg-deep)', border: '1px solid var(--line)' }}
            >
              <button className="ui-icon-btn h-5 w-5" title="缩小" onClick={() => zoomBy(0.9)}>−</button>
              <span className="w-9 text-center text-slate-500">{Math.round(view.zoom * 100)}%</span>
              <button className="ui-icon-btn h-5 w-5" title="放大" onClick={() => zoomBy(1.1)}>＋</button>
              <button className="ui-icon-btn ml-1 h-5 px-1 text-2xs" title="适应画布" onClick={() => fitView()}>适应</button>
            </div>
            {active?.nodes.length ? (
              <div
                ref={miniMapRef}
                title="小地图：点击或拖动快速定位"
                className="absolute bottom-9 right-2 z-10 overflow-hidden rounded-lg"
                style={{
                  width: mini.w,
                  height: mini.h,
                  background: 'var(--bg-deep)',
                  border: '1px solid var(--line)',
                  boxShadow: 'var(--shadow-sm)',
                  cursor: 'pointer'
                }}
                onPointerDown={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  miniJump(e.clientX, e.clientY)
                  const move = (ev: PointerEvent): void => miniJump(ev.clientX, ev.clientY)
                  const up = (): void => {
                    window.removeEventListener('pointermove', move)
                    window.removeEventListener('pointerup', up)
                  }
                  window.addEventListener('pointermove', move)
                  window.addEventListener('pointerup', up)
                }}
              >
                <svg width={mini.w} height={mini.h}>
                  <g transform={`translate(${mini.ox},${mini.oy}) scale(${mini.s})`}>
                    {active.nodes.map((n) => (
                      <rect
                        key={n.id}
                        x={n.x}
                        y={n.y}
                        width={190}
                        height={116}
                        rx={10}
                        fill="rgba(148,163,184,0.3)"
                        stroke="rgba(148,163,184,0.55)"
                        strokeWidth={2 / mini.s}
                      />
                    ))}
                    <rect
                      x={-view.x / view.zoom}
                      y={-view.y / view.zoom}
                      width={viewportSize.w / view.zoom}
                      height={viewportSize.h / view.zoom}
                      fill="rgba(96,165,250,0.12)"
                      stroke="var(--accent)"
                      strokeWidth={2 / mini.s}
                    />
                  </g>
                </svg>
              </div>
            ) : null}
            <div
              className="pointer-events-none absolute bottom-2 right-2 rounded-md px-2 py-1 text-2xs text-slate-600"
              style={{ background: 'var(--bg-deep)', border: '1px solid var(--line)' }}
            >
              左侧拖入节点 · 右侧圆点拖出连线 · Shift+拖动框选 · 方向键微调 · ⌘C/V · ⌘Z · 滚轮缩放 · 空白拖动平移
            </div>
          </div>

          <div className="mt-3 glass-card !p-3">
            <div className="mb-2 flex items-center gap-2 text-2xs uppercase tracking-wider text-slate-600">
              执行记录
              <span className="ml-auto normal-case tracking-normal">{log.length ? `${log.length} 个节点` : '运行后逐步显示输入 / 输出'}</span>
            </div>
            {log.length === 0 ? (
              <div className="py-3 text-center text-xs text-slate-600">还没有执行记录</div>
            ) : (
              <div className="flex max-h-[300px] flex-col gap-1.5 overflow-auto">
                {log.map((entry, i) => (
                  <details key={`${entry.nodeId}-${i}`} className="rounded-lg" style={{ background: 'var(--surface-2)' }}>
                    <summary className="flex cursor-pointer items-center gap-2 px-2 py-1.5 text-xs text-slate-300">
                      <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: entry.status === 'done' ? '#34d399' : '#f87171' }} />
                      {entry.title}
                      <span className="ml-auto text-2xs text-slate-600">{entry.ms ?? 0}ms</span>
                    </summary>
                    <div className="px-2 pb-2">
                      <div className="text-2xs text-slate-600">输入</div>
                      <pre className="max-h-28 overflow-auto whitespace-pre-wrap text-2xs text-slate-400">{entry.input || '（空）'}</pre>
                      <div className="mt-1 text-2xs text-slate-600">输出</div>
                      <pre className="max-h-40 overflow-auto whitespace-pre-wrap text-2xs text-slate-300">{entry.output || '（空）'}</pre>
                      {entry.error ? <div className="mt-1 text-2xs text-rose-400">{entry.error}</div> : null}
                    </div>
                  </details>
                ))}
              </div>
            )}
            {finalText ? (
              <div className="mt-3 border-t pt-3" style={{ borderColor: 'var(--line)' }}>
                <div className="mb-1 flex items-center gap-2 text-2xs uppercase tracking-wider text-slate-600">
                  最终结果
                  <button
                    className="ml-auto normal-case tracking-normal text-slate-500 hover:text-slate-200"
                    onClick={() => void navigator.clipboard.writeText(finalText).then(() => setStatus('已复制最终结果'))}
                  >
                    复制
                  </button>
                </div>
                <pre className="max-h-56 overflow-auto whitespace-pre-wrap text-xs leading-relaxed text-slate-300">{finalText}</pre>
              </div>
            ) : null}
          </div>
        </section>
      </div>

      {/* 节点配置悬窗（可拖动，右键 / 双击节点打开） */}
      {panelOpen ? (
        <div
          className="fixed z-[55] flex max-h-[78vh] w-[356px] flex-col overflow-hidden rounded-2xl"
          style={{
            left: panelPos.x,
            top: panelPos.y,
            background: 'var(--bg-surface)',
            border: '1px solid var(--line)',
            boxShadow: 'var(--shadow-lg)'
          }}
        >
          <div
            className="flex shrink-0 cursor-move select-none items-center gap-2 px-3 py-2"
            style={{ borderBottom: '1px solid var(--line)' }}
            onPointerDown={startPanelDrag}
          >
            <span className="text-xs font-medium text-slate-300">节点配置</span>
            {selected ? <span className="text-2xs text-slate-600">{NODE_META[selected.kind].label}</span> : null}
            <button className="ui-icon-btn ml-auto" title="关闭配置" onClick={() => setPanelOpen(false)}>
              <Icon name="x" size={12} />
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-auto p-3">
            {!selected ? (
              <div className="py-8 text-center text-xs text-slate-600">右键节点或双击节点打开配置</div>
            ) : (
              <div className="flex flex-col gap-2.5">
                <div className="flex items-center gap-2">
                  <span className="inline-block h-2 w-2 rounded-full" style={{ background: NODE_META[selected.kind].color }} />
                  <span className="text-xs font-medium text-slate-200">{NODE_META[selected.kind].label}</span>
                  <button className="ml-auto text-2xs text-slate-600 hover:text-rose-400" onClick={() => removeNode(selected.id)}>删除节点</button>
                </div>

                <Field label="节点标题">
                  <input
                    value={selected.title}
                    onChange={(e) => patchNode(selected.id, { title: e.target.value })}
                    className="w-full rounded-lg px-2 py-1 text-xs text-slate-200 outline-none"
                    style={{ background: 'var(--surface-2)', border: '1px solid var(--line)' }}
                  />
                </Field>

                {selected.kind === 'agent' ? (
                  <div className="flex flex-col gap-1">
                    <div className="flex items-center gap-2">
                      <span className="text-2xs text-slate-600">执行方式</span>
                      <button className="ml-auto text-2xs text-slate-500 hover:text-slate-200" onClick={() => void refreshAgents()}>
                        刷新 Agent
                      </button>
                    </div>
                    <div className="flex flex-col gap-1">
                      <button
                        type="button"
                        onClick={() => patchNode(selected.id, { agentId: undefined })}
                        className="flex items-start gap-2 rounded-lg px-2 py-1.5 text-left"
                        style={{
                          background: selected.agentId ? 'var(--surface-2)' : 'var(--accent-softer)',
                          border: `1px solid ${selected.agentId ? 'var(--line)' : 'var(--accent)'}`
                        }}
                      >
                        <span className="mt-1 inline-block h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: '#64748b' }} />
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-1.5 text-xs text-slate-200">
                            内置模型
                            <span className="rounded px-1 text-2xs text-slate-600" style={{ background: 'var(--surface-3)' }}>默认</span>
                            {!selected.agentId ? <span className="ml-auto text-2xs text-[var(--accent)]">当前</span> : null}
                          </span>
                          <span className="mt-0.5 block truncate text-2xs text-slate-600">
                            {selected.model || '设置里的默认模型'}
                          </span>
                        </span>
                      </button>
                      {orderedAgents.map((a) => {
                        const usable = isAgentUsable(a)
                        const isSel = selected.agentId === a.id
                        return (
                          <button
                            key={a.id}
                            type="button"
                            disabled={!usable && !isSel}
                            onClick={() => patchNode(selected.id, { agentId: a.id })}
                            className="flex items-start gap-2 rounded-lg px-2 py-1.5 text-left disabled:cursor-not-allowed disabled:opacity-40"
                            style={{
                              background: isSel ? 'var(--accent-softer)' : 'var(--surface-2)',
                              border: `1px solid ${isSel ? 'var(--accent)' : 'var(--line)'}`
                            }}
                          >
                            <span className="mt-1 inline-block h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: AGENT_STATUS_COLOR[a.status] }} />
                            <span className="min-w-0 flex-1">
                              <span className="flex items-center gap-1.5 text-xs text-slate-200">
                                <span className="truncate">{a.name}</span>
                                <span className="shrink-0 rounded px-1 text-2xs text-slate-600" style={{ background: 'var(--surface-3)' }}>
                                  {PROTOCOL_LABEL[a.protocol] ?? a.protocol}
                                </span>
                                {isSel ? <span className="ml-auto shrink-0 text-2xs text-[var(--accent)]">当前</span> : null}
                              </span>
                              <span className="mt-0.5 block truncate text-2xs text-slate-600">
                                {usable ? a.capabilities.join(' / ') || a.detail : a.detail || a.lastError || '不可用'}
                              </span>
                            </span>
                          </button>
                        )
                      })}
                    </div>
                    {orderedAgents.length === 0 ? (
                      <div className="rounded-lg p-2 text-2xs text-slate-600" style={{ background: 'var(--surface-2)' }}>
                        还没有接入外部 Agent，可在「Agent」页添加后刷新。
                      </div>
                    ) : null}
                    {selectedAgent ? (
                      <div className="rounded-lg p-2 text-2xs leading-relaxed text-slate-500" style={{ background: 'var(--surface-2)' }}>
                        <div className="flex items-center gap-1.5">
                          <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: AGENT_STATUS_COLOR[selectedAgent.status] }} />
                          <span className="text-slate-300">{selectedAgent.name}</span>
                          <span className="text-slate-600">{selectedAgent.detail}</span>
                        </div>
                        <div className="mt-1 truncate">端点：{selectedAgent.endpoint || '—'}</div>
                        <div className="truncate">能力：{selectedAgent.capabilities.join(' / ') || '—'}</div>
                        <div className="truncate">工作目录：{selectedAgent.cwd || 'Agent 默认'}</div>
                        {!isAgentUsable(selectedAgent) ? (
                          <div className="mt-1 text-amber-400">当前不可派发，运行会失败；请刷新或换执行方式。</div>
                        ) : null}
                      </div>
                    ) : selected.agentId ? (
                      <div className="rounded-lg p-2 text-2xs text-amber-400" style={{ background: 'var(--surface-2)' }}>
                        节点选择的 Agent 已不存在，请重新选择执行方式。
                      </div>
                    ) : (
                      <div className="text-2xs text-slate-600">
                        内置模型会根据角色 / 工作定义 / 输出物拼提示词执行。
                      </div>
                    )}
                    {agentRecs.length ? (
                      <div className="rounded-lg p-2" style={{ background: 'var(--surface-2)' }}>
                        <div className="flex items-center gap-2">
                          <span className="text-2xs text-slate-600">推荐能干啥</span>
                          <span className="ml-auto text-2xs text-slate-600">按能力匹配</span>
                        </div>
                        <div className="mt-1 flex flex-col gap-1">
                          {agentRecs.map((r) => (
                            <div key={r.name} className="flex items-start gap-1.5">
                              <span className="mt-1 inline-block h-1 w-1 shrink-0 rounded-full" style={{ background: 'var(--accent)' }} />
                              <span className="min-w-0">
                                <span className="block text-2xs text-slate-300">{r.name}</span>
                                <span className="block text-2xs text-slate-600">{r.reason}</span>
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : null}
                    {agentPlan ? (
                      <div className="rounded-lg p-2" style={{ background: 'var(--surface-2)' }}>
                        <div className="flex items-center gap-2">
                          <span className="text-2xs text-slate-600">分配规划</span>
                          <span className="ml-auto text-2xs text-slate-600">{agentPlan.meta}</span>
                        </div>
                        <div className="mt-1 flex flex-col gap-1">
                          {agentPlan.steps.map((s, i) => (
                            <div key={`${i}-${s.task}`} className="flex items-center gap-1.5">
                              <span className="w-4 shrink-0 font-mono text-2xs text-slate-600">{String(i + 1).padStart(2, '0')}</span>
                              <span className="min-w-0 flex-1 truncate text-2xs text-slate-300" title={s.task}>{s.task}</span>
                              <span className="shrink-0 rounded px-1 text-2xs text-slate-500" style={{ background: 'var(--surface-3)' }}>{s.who}</span>
                              <span className="shrink-0 text-2xs text-slate-600">{s.mode}</span>
                            </div>
                          ))}
                        </div>
                        {selectedAgent && !isAgentUsable(selectedAgent) ? (
                          <div className="mt-1 text-2xs text-amber-400">当前 Agent 不可派发，规划仅供查看。</div>
                        ) : null}
                      </div>
                    ) : null}
                    <div className="flex flex-col gap-1">
                      <div className="flex items-center gap-2">
                        <span className="text-2xs text-slate-600">会话</span>
                        <button className="ml-auto text-2xs text-slate-500 hover:text-slate-200" onClick={() => void refreshSessions()}>
                          刷新会话
                        </button>
                      </div>
                      <select
                        value={sessionValue}
                        onChange={(e) => {
                          const v = e.target.value
                          if (v === 'none' || v === 'new') patchNode(selected.id, { sessionMode: v, sessionId: undefined })
                          else patchNode(selected.id, { sessionMode: 'existing', sessionId: v.replace('existing:', '') })
                        }}
                        className="w-full rounded-lg px-2 py-1 text-xs text-slate-200 outline-none"
                        style={{ background: 'var(--surface-2)', border: '1px solid var(--line)' }}
                      >
                        <option value="none">不关联会话（默认）</option>
                        <option value="new">新建会话（每次运行）</option>
                        {selected.sessionMode === 'existing' && selected.sessionId && !selectedSession ? (
                          <option value={`existing:${selected.sessionId}`}>
                            {sessions.length ? `会话已删除（${selected.sessionId}）` : '会话加载中…'}
                          </option>
                        ) : null}
                        {sessions.map((s) => (
                          <option key={s.id} value={`existing:${s.id}`}>
                            {s.title} · {s.items.length} 条 · {sessionTargetLabel(s)}
                          </option>
                        ))}
                      </select>
                      <div className="rounded-lg p-2 text-2xs leading-relaxed text-slate-500" style={{ background: 'var(--surface-2)' }}>
                        {selected.sessionMode === 'existing' ? (
                          selectedSession ? (
                            <>已选「{selectedSession.title}」（{sessionTargetLabel(selectedSession)}）：最近 20 条消息作为上下文带入，运行结果追加回该会话。</>
                          ) : sessions.length ? (
                            <span className="text-amber-400">所选会话不存在或已删除，运行将忽略会话上下文。</span>
                          ) : (
                            <>会话加载中…</>
                          )
                        ) : selected.sessionMode === 'new' ? (
                          <>每次运行新建一个本机会话，写入节点输入与运行结果。</>
                        ) : (
                          <>节点独立执行，不读写问答页会话。共 {sessions.length} 个已有会话可选。</>
                        )}
                      </div>
                    </div>
                  </div>
                ) : null}

                {selected.kind === 'agent' || selected.kind === 'image' ? (
                  <>
                    <Field label="角色（是谁）">
                      <input
                        value={selected.role ?? ''}
                        onChange={(e) => patchNode(selected.id, { role: e.target.value })}
                        placeholder="例：健康知识拆解专家"
                        className="w-full rounded-lg px-2 py-1 text-xs text-slate-200 outline-none"
                        style={{ background: 'var(--surface-2)', border: '1px solid var(--line)' }}
                      />
                    </Field>
                    <Field label="工作定义（做什么）">
                      <textarea
                        value={selected.duty ?? ''}
                        onChange={(e) => patchNode(selected.id, { duty: e.target.value })}
                        className="h-20 w-full resize-none rounded-lg px-2 py-1 text-xs text-slate-200 outline-none"
                        style={{ background: 'var(--surface-2)', border: '1px solid var(--line)' }}
                      />
                    </Field>
                    <Field label="输出物（产出什么）">
                      <textarea
                        value={selected.outputSpec ?? ''}
                        onChange={(e) => patchNode(selected.id, { outputSpec: e.target.value })}
                        className="h-16 w-full resize-none rounded-lg px-2 py-1 text-xs text-slate-200 outline-none"
                        style={{ background: 'var(--surface-2)', border: '1px solid var(--line)' }}
                      />
                    </Field>
                    <button className="glass-btn w-full px-2 py-1.5 text-2xs" onClick={() => void assistBoundary()} disabled={assistBusy}>
                      {assistBusy ? '正在生成边界…' : '辅助定义边界（本地模型）'}
                    </button>
                    {assistResult ? (
                      <div className="rounded-lg p-2" style={{ background: 'var(--surface-2)' }}>
                        <pre className="max-h-28 overflow-auto whitespace-pre-wrap text-2xs text-slate-400">{assistResult}</pre>
                        <button className="glass-btn mt-1.5 w-full px-2 py-1 text-2xs" onClick={applyAssist}>填入节点</button>
                      </div>
                    ) : null}
                  </>
                ) : null}

                {selected.kind === 'image' ? (
                  <>
                    <Field label="处理方式">
                      <select
                        value={selected.imageMode ?? 'auto'}
                        onChange={(e) => patchNode(selected.id, { imageMode: e.target.value as WorkflowNode['imageMode'] })}
                        className="w-full rounded-lg px-2 py-1 text-xs text-slate-200 outline-none"
                        style={{ background: 'var(--surface-2)', border: '1px solid var(--line)' }}
                      >
                        <option value="auto">自动（视觉优先，失败回退 OCR）</option>
                        <option value="vision">只用视觉模型</option>
                        <option value="ocr">只用 OCR 提取文字</option>
                      </select>
                    </Field>
                    <label className="glass-btn cursor-pointer px-2 py-1.5 text-center text-2xs">
                      选择图片
                      <input type="file" accept="image/*" className="hidden" onChange={(e) => {
                        const file = e.target.files?.[0]
                        if (file) onImageFile(file)
                      }} />
                    </label>
                    {selected.imageDataUrl ? (
                      <img src={selected.imageDataUrl} alt="节点图片" className="max-h-40 w-full rounded-lg object-contain" style={{ background: 'var(--surface-2)' }} />
                    ) : null}
                    <div className="text-2xs leading-relaxed text-slate-600">
                      当前模型{visionOf(selected.model) ? '支持视觉' : '不支持视觉'}；自动模式会在视觉失败时回退本机 OCR。
                    </div>
                  </>
                ) : null}

                {selected.kind === 'tool' ? (
                  <>
                    <Field label="能力类型">
                      <select
                        value={selected.toolKind ?? 'browser'}
                        onChange={(e) => patchNode(selected.id, { toolKind: e.target.value as WorkflowNode['toolKind'] })}
                        className="w-full rounded-lg px-2 py-1 text-xs text-slate-200 outline-none"
                        style={{ background: 'var(--surface-2)', border: '1px solid var(--line)' }}
                      >
                        <option value="browser">浏览器操作（真实执行）</option>
                        <option value="video">视频字幕（本机 yt-dlp）</option>
                        <option value="rss">RSS / Atom 阅读</option>
                        <option value="computer">电脑操作（Computer Use）</option>
                      </select>
                    </Field>
                    {selected.toolKind === 'video' ? (
                      <>
                        <Field label="视频链接">
                          <input
                            value={selected.videoUrl ?? ''}
                            onChange={(e) => patchNode(selected.id, { videoUrl: e.target.value })}
                            placeholder="https://www.youtube.com/watch?v=… 或 B站链接；留空则用上游里的第一个链接"
                            className="w-full rounded-lg px-2 py-1 text-xs text-slate-200 outline-none"
                            style={{ background: 'var(--surface-2)', border: '1px solid var(--line)' }}
                          />
                        </Field>
                        <Field label="字幕语言优先级">
                          <input
                            value={selected.videoLang ?? ''}
                            onChange={(e) => patchNode(selected.id, { videoLang: e.target.value })}
                            placeholder="zh-Hans,zh-CN,zh,en"
                            className="w-full rounded-lg px-2 py-1 text-xs text-slate-200 outline-none"
                            style={{ background: 'var(--surface-2)', border: '1px solid var(--line)' }}
                          />
                        </Field>
                        <div className="rounded-lg p-2 text-2xs leading-relaxed text-slate-500" style={{ background: 'var(--surface-2)' }}>
                          调用本机 yt-dlp 提取字幕，支持 YouTube、B站等 yt-dlp 覆盖的站点，输出纯文本进入下游。需要先自行安装
                          <span className="text-slate-400"> brew install yt-dlp</span>；没有字幕或需要登录时直接报错，不会自动安装任何依赖。
                        </div>
                      </>
                    ) : selected.toolKind === 'rss' ? (
                      <>
                        <Field label="RSS / Atom 地址">
                          <input
                            value={selected.rssUrl ?? ''}
                            onChange={(e) => patchNode(selected.id, { rssUrl: e.target.value })}
                            placeholder="https://example.com/feed.xml；留空则用上游里的第一个链接"
                            className="w-full rounded-lg px-2 py-1 text-xs text-slate-200 outline-none"
                            style={{ background: 'var(--surface-2)', border: '1px solid var(--line)' }}
                          />
                        </Field>
                        <Field label="最多条目数">
                          <input
                            type="number"
                            min={1}
                            max={30}
                            value={selected.rssLimit ?? 10}
                            onChange={(e) =>
                              patchNode(selected.id, { rssLimit: Math.max(1, Math.min(30, Number(e.target.value) || 10)) })
                            }
                            className="w-full rounded-lg px-2 py-1 text-xs text-slate-200 outline-none"
                            style={{ background: 'var(--surface-2)', border: '1px solid var(--line)' }}
                          />
                        </Field>
                        <div className="rounded-lg p-2 text-2xs leading-relaxed text-slate-500" style={{ background: 'var(--surface-2)' }}>
                          直接抓取订阅源，输出每条标题、时间、摘要与链接，交给下游 Agent 总结或入库。需要登录的私有源不支持。
                        </div>
                      </>
                    ) : selected.toolKind !== 'computer' ? (
                      <>
                        <Field label="目标网址">
                          <input
                            value={selected.browserUrl ?? ''}
                            onChange={(e) => patchNode(selected.id, { browserUrl: e.target.value })}
                            placeholder={
                              (selected.browserAction ?? 'read') === 'ask' && selected.browserSite !== 'custom'
                                ? `留空使用 ${BROWSER_SITE_META[selected.browserSite ?? 'deepseek'].url}`
                                : 'https://… 留空则用上游里的第一个链接'
                            }
                            className="w-full rounded-lg px-2 py-1 text-xs text-slate-200 outline-none"
                            style={{ background: 'var(--surface-2)', border: '1px solid var(--line)' }}
                          />
                        </Field>
                        <Field label="执行动作">
                          <select
                            value={selected.browserAction ?? 'read'}
                            onChange={(e) => patchNode(selected.id, { browserAction: e.target.value as WorkflowNode['browserAction'] })}
                            className="w-full rounded-lg px-2 py-1 text-xs text-slate-200 outline-none"
                            style={{ background: 'var(--surface-2)', border: '1px solid var(--line)' }}
                          >
                            <option value="read">读取正文（交给下游）</option>
                            <option value="extract">模型提炼要点</option>
                            <option value="screenshot">截图留档</option>
                            <option value="ask">网页问答（自动提问获取回答）</option>
                          </select>
                        </Field>
                        {(selected.browserAction ?? 'read') === 'ask' ? (
                          <>
                            <Field label="问答站点">
                              <select
                                value={selected.browserSite ?? 'deepseek'}
                                onChange={(e) => patchNode(selected.id, { browserSite: e.target.value as WorkflowBrowserSite, browserUrl: undefined })}
                                className="w-full rounded-lg px-2 py-1 text-xs text-slate-200 outline-none"
                                style={{ background: 'var(--surface-2)', border: '1px solid var(--line)' }}
                              >
                                {(Object.keys(BROWSER_SITE_META) as WorkflowBrowserSite[]).map((key) => (
                                  <option key={key} value={key}>
                                    {BROWSER_SITE_META[key].label}
                                    {BROWSER_SITE_META[key].url ? ` · ${BROWSER_SITE_META[key].url}` : ''}
                                  </option>
                                ))}
                              </select>
                            </Field>
                            <Field label="提问内容">
                              <textarea
                                value={selected.browserQuestion ?? ''}
                                onChange={(e) => patchNode(selected.id, { browserQuestion: e.target.value })}
                                placeholder="例：根据以下材料提炼三条结论并给出处：{{upstream}}"
                                className="h-20 w-full resize-none rounded-lg px-2 py-1 text-xs text-slate-200 outline-none"
                                style={{ background: 'var(--surface-2)', border: '1px solid var(--line)' }}
                              />
                            </Field>
                            <Field label="回答选择器（可选）">
                              <input
                                value={selected.browserAnswerSelector ?? ''}
                                onChange={(e) => patchNode(selected.id, { browserAnswerSelector: e.target.value })}
                                placeholder="留空用站点默认 / 通用 markdown 容器"
                                className="w-full rounded-lg px-2 py-1 text-xs text-slate-200 outline-none"
                                style={{ background: 'var(--surface-2)', border: '1px solid var(--line)' }}
                              />
                            </Field>
                            <div className="rounded-lg p-2 text-2xs leading-relaxed text-slate-500" style={{ background: 'var(--surface-2)' }}>
                              首次使用需先在内置浏览器手动登录站点（登录态会持久保存）；运行时会打开站点、填入问题、发送并等待回答稳定，回答作为节点输出进入下游。站点改版可能导致选择器失效，可在上面指定回答选择器兜底。仅支持内置浏览器模式。
                            </div>
                          </>
                        ) : null}
                        {(selected.browserAction ?? 'read') === 'extract' ? (
                          <Field label="提炼要求">
                            <textarea
                              value={selected.browserTask ?? ''}
                              onChange={(e) => patchNode(selected.id, { browserTask: e.target.value })}
                              placeholder="例：提取价格、发布时间和三条核心结论；支持 {{upstream}} / {{input}}"
                              className="h-20 w-full resize-none rounded-lg px-2 py-1 text-xs text-slate-200 outline-none"
                              style={{ background: 'var(--surface-2)', border: '1px solid var(--line)' }}
                            />
                          </Field>
                        ) : null}
                        {(selected.browserAction ?? 'read') !== 'ask' ? (
                          <div className="rounded-lg p-2 text-2xs leading-relaxed text-slate-500" style={{ background: 'var(--surface-2)' }}>
                            运行时自动打开右侧浏览器（内置 / 本机 Chrome 均可用），打开
                            {selected.browserUrl ? '配置的网址' : '上游链接或当前页面'}后执行，输出直接进入下游节点。
                          </div>
                        ) : null}
                      </>
                    ) : (
                      <div className="rounded-lg p-2 text-2xs leading-relaxed text-slate-500" style={{ background: 'var(--surface-2)' }}>
                        {automation?.detail ?? '能力检测中…'}
                        <div className="mt-1 text-slate-600">电脑操作运行时待接入；浏览器节点已可真实执行。</div>
                      </div>
                    )}
                  </>
                ) : null}

                {selected.kind === 'group' ? (
                  <>
                    <Field label="群组说明">
                      <textarea
                        value={selected.note ?? ''}
                        onChange={(e) => patchNode(selected.id, { note: e.target.value })}
                        placeholder="后续要挂载哪些子 Agent / 后续会话"
                        className="h-16 w-full resize-none rounded-lg px-2 py-1 text-xs text-slate-200 outline-none"
                        style={{ background: 'var(--surface-2)', border: '1px solid var(--line)' }}
                      />
                    </Field>
                    <div className="text-2xs text-slate-600">
                      子节点：{active?.nodes.filter((n) => n.parentId === selected.id).map((n) => n.title).join('、') || '暂无（在下方把节点挂到这个群组）'}
                    </div>
                    <button className="glass-btn w-full px-2 py-1.5 text-2xs" onClick={() => void splitGroup()} disabled={splitBusy}>
                      {splitBusy ? '正在拆解…' : 'AI 拆解为子 Agent（本地模型）'}
                    </button>
                  </>
                ) : null}

                {selected.kind === 'image' || (selected.kind === 'tool' && selected.toolKind !== 'video' && selected.toolKind !== 'rss') || (selected.kind === 'agent' && !selected.agentId) ? (
                  <Field label="模型（空 = 默认）">
                    <select
                      value={selected.model ?? ''}
                      onChange={(e) => patchNode(selected.id, { model: e.target.value || undefined })}
                      className="w-full rounded-lg px-2 py-1 text-xs text-slate-200 outline-none"
                      style={{ background: 'var(--surface-2)', border: '1px solid var(--line)' }}
                    >
                      <option value="">默认模型</option>
                      {models.map((m) => (
                        <option key={m.id} value={m.id}>{m.name}{m.vision ? ' · 视觉' : ''}</option>
                      ))}
                    </select>
                  </Field>
                ) : null}

                {selected.kind === 'agent' ? (
                  <Field label="提示词模板（可选）">
                    <textarea
                      value={selected.promptTemplate ?? ''}
                      onChange={(e) => patchNode(selected.id, { promptTemplate: e.target.value })}
                      placeholder={'{{upstream}} / {{input}} 会被替换'}
                      className="h-20 w-full resize-none rounded-lg px-2 py-1 font-mono text-2xs text-slate-300 outline-none"
                      style={{ background: 'var(--surface-2)', border: '1px solid var(--line)' }}
                    />
                  </Field>
                ) : null}

                <Field label="所属项目">
                  <select
                    value={selected.projectId ?? ''}
                    onChange={(e) => patchNode(selected.id, { projectId: e.target.value || undefined })}
                    className="w-full rounded-lg px-2 py-1 text-xs text-slate-200 outline-none"
                    style={{ background: 'var(--surface-2)', border: '1px solid var(--line)' }}
                  >
                    <option value="">未归属</option>
                    {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </Field>

                <Field label="挂到群组（动态层级）">
                  <select
                    value={selected.parentId ?? ''}
                    onChange={(e) => patchNode(selected.id, { parentId: e.target.value || undefined })}
                    className="w-full rounded-lg px-2 py-1 text-xs text-slate-200 outline-none"
                    style={{ background: 'var(--surface-2)', border: '1px solid var(--line)' }}
                  >
                    <option value="">无</option>
                    {active?.nodes.filter((n) => n.kind === 'group' && n.id !== selected.id).map((n) => (
                      <option key={n.id} value={n.id}>{n.title}</option>
                    ))}
                  </select>
                </Field>

                {active ? (
                  <Field label="增加上游（显式引用）">
                    <div className="flex max-h-28 flex-col gap-1 overflow-auto">
                      {active.nodes.filter((n) => n.id !== selected.id && n.kind !== 'input').map((n) => {
                        const checked = (selected.upstreamIds ?? []).includes(n.id)
                        return (
                          <label key={n.id} className="flex items-center gap-1.5 text-2xs text-slate-400">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={(e) => {
                                const cur = new Set(selected.upstreamIds ?? [])
                                if (e.target.checked) cur.add(n.id)
                                else cur.delete(n.id)
                                patchNode(selected.id, { upstreamIds: [...cur] })
                              }}
                            />
                            <span className="truncate">{n.title}</span>
                          </label>
                        )
                      })}
                    </div>
                  </Field>
                ) : null}

                {selected.kind === 'agent' ? (
                  <div className="rounded-lg p-2" style={{ background: 'var(--surface-2)' }}>
                    <div className="mb-1 text-2xs text-slate-600">提示词预览</div>
                    <pre className="max-h-32 overflow-auto whitespace-pre-wrap text-2xs text-slate-500">
                      {systemFor(selected)}
                    </pre>
                  </div>
                ) : null}

                <button
                  className="glass-btn w-full px-2 py-1.5 text-2xs"
                  disabled={busy}
                  onClick={() => active && void runAll(selected.id)}
                >
                  只运行这个节点
                </button>
                {runs[selected.id]?.output ? (
                  <div>
                    <div className="mb-1 text-2xs text-slate-600">该节点最近输出</div>
                    <pre className="max-h-44 overflow-auto whitespace-pre-wrap rounded-lg p-2 text-2xs text-slate-300" style={{ background: 'var(--surface-2)' }}>
                      {runs[selected.id]?.output}
                    </pre>
                  </div>
                ) : null}
              </div>
            )}
          </div>
        </div>
      ) : null}

      {/* 右键菜单：节点 / 连线 / 空白画布 */}
      {ctxMenu ? (
        <>
          <div
            className="fixed inset-0 z-[70]"
            onClick={() => setCtxMenu(null)}
            onContextMenu={(e) => {
              e.preventDefault()
              setCtxMenu(null)
            }}
          />
          <div
            className="fixed z-[71] w-52 overflow-hidden rounded-xl p-1 text-xs"
            style={{
              left: Math.min(ctxMenu.x, window.innerWidth - 228),
              top: Math.min(ctxMenu.y, window.innerHeight - 320),
              background: 'var(--bg-surface)',
              border: '1px solid var(--line)',
              boxShadow: 'var(--shadow-lg)'
            }}
          >
            {ctxMenu.nodeId ? (
              <>
                <MenuBtn onClick={() => { openPanelFor(ctxMenu.nodeId!); setCtxMenu(null) }}>
                  配置节点…
                </MenuBtn>
                <MenuBtn
                  onClick={() => {
                    const node = active?.nodes.find((n) => n.id === ctxMenu.nodeId)
                    if (node) setLinking({ from: node.id, x: node.x + 190, y: node.y + 46 })
                    setCtxMenu(null)
                  }}
                >
                  从这里连线
                </MenuBtn>
                <MenuBtn onClick={() => { void runAll(ctxMenu.nodeId); setCtxMenu(null) }}>运行该节点</MenuBtn>
                <MenuBtn onClick={() => { duplicateNode(ctxMenu.nodeId!); setCtxMenu(null) }}>复制节点</MenuBtn>
                <div className="my-1 h-px" style={{ background: 'var(--line)' }} />
                <MenuBtn danger onClick={() => { removeNode(ctxMenu.nodeId!); setCtxMenu(null) }}>删除节点</MenuBtn>
              </>
            ) : ctxMenu.edgeId ? (
              <MenuBtn danger onClick={() => { deleteEdge(ctxMenu.edgeId!); setCtxMenu(null) }}>删除这条连线</MenuBtn>
            ) : (
              <>
                <div className="px-2 py-1 text-2xs text-slate-600">添加节点</div>
                <div className="grid grid-cols-2 gap-1 p-1">
                  {KIND_ORDER.map((kind) => (
                    <button
                      key={kind}
                      type="button"
                      onClick={() => {
                        const p = toScene(ctxMenu.x, ctxMenu.y)
                        addNode(kind, p.x, p.y)
                        setCtxMenu(null)
                      }}
                      className="flex items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-2xs text-slate-300 hover:bg-[var(--surface-2)]"
                    >
                      <span className="inline-block h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: NODE_META[kind].color }} />
                      <span className="truncate">{NODE_META[kind].label}</span>
                    </button>
                  ))}
                </div>
                <div className="my-1 h-px" style={{ background: 'var(--line)' }} />
                <MenuBtn onClick={() => { fitView(); setCtxMenu(null) }}>适应画布</MenuBtn>
                <MenuBtn onClick={() => { setView({ x: 0, y: 0, zoom: 1 }); setCtxMenu(null) }}>重置视图</MenuBtn>
              </>
            )}
          </div>
        </>
      ) : null}
        </>
      )}
    </div>
  )
}

function MenuBtn({ children, onClick, danger }: { children: ReactNode; onClick: () => void; danger?: boolean }): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs ${
        danger ? 'text-rose-300 hover:bg-[rgba(244,63,94,0.12)]' : 'text-slate-300 hover:bg-[var(--surface-2)]'
      }`}
    >
      {children}
    </button>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }): JSX.Element {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-2xs text-slate-600">{label}</span>
      {children}
    </label>
  )
}
