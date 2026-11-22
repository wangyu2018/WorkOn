/**
 * 关联图谱（P1 索引 / P2 关联面板 / P3 拆解分析预测）
 * - 索引来源：项目 / 任务 / 会话 / 计划 / 知识 / 工作流 / 人生目标（全量派生，不新增用户输入）
 * - 边：belongs（子→父）、references（目标/知识引用）、derived（子会话接续）
 * - TTL 2 分钟 + 显式 rebuild；数据量小，全量重建比增量简单可靠
 */
import { col, replaceCollection } from './db'
import type {
  ChatSession,
  GraphAnalysis,
  GraphCriticalPath,
  GraphEdge,
  GraphInsight,
  GraphNeighbor,
  GraphNode,
  GraphStats,
  GraphViewData,
  KnowledgeItem,
  LifeGoal,
  PlanItem,
  Project,
  ProjectTask
} from '@shared/types'
import { listWorkflows } from './workflow'

const TTL_MS = 120_000
const MAX_SESSIONS = 300
const MAX_KNOWLEDGE = 500
const MAX_PLANS = 400
let builtAt = 0

function nid(kind: GraphNode['kind'], refId: string): string {
  return `${kind}:${refId}`
}

/** 全量重建索引（幂等） */
export function rebuildGraph(): GraphStats {
  const now = Date.now()
  const nodes: GraphNode[] = []
  const edges: GraphEdge[] = []
  const nodeIds = new Set<string>()
  const edgeIds = new Set<string>()

  const addNode = (n: GraphNode): void => {
    if (!n.refId || nodeIds.has(n.id)) return
    nodeIds.add(n.id)
    nodes.push(n)
  }
  const addEdge = (from: string, to: string, kind: GraphEdge['kind'], weight?: number): void => {
    if (from === to || !nodeIds.has(from) || !nodeIds.has(to)) return
    const id = `${kind}:${from}->${to}`
    if (edgeIds.has(id)) return
    edgeIds.add(id)
    edges.push({ id, from, to, kind, weight, ts: now })
  }

  const projects = col<Project>('projects')
  const tasks = col<ProjectTask>('projectTasks')
  const sessions = col<ChatSession>('chatSessions')
    .slice()
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, MAX_SESSIONS)
  const plans = col<PlanItem>('plans')
    .filter((p) => p.projectId || p.projectTaskId)
    .slice(-MAX_PLANS)
  const knowledge = col<KnowledgeItem>('knowledge').slice(-MAX_KNOWLEDGE)
  const goals = col<LifeGoal>('lifeGoals')
  const { workflows } = listWorkflows()

  for (const p of projects) {
    addNode({
      id: nid('project', p.id),
      kind: 'project',
      refId: p.id,
      label: p.name,
      status: p.status,
      meta: { priority: p.priority, deadline: p.deadline ?? '', domain: p.domain ?? '' },
      ts: p.updatedAt
    })
  }
  for (const t of tasks) {
    addNode({
      id: nid('task', t.id),
      kind: 'task',
      refId: t.id,
      label: t.title,
      status: t.status,
      meta: { projectId: t.projectId, priority: t.priority, estMin: t.estMin ?? 0, actualMin: t.actualMin ?? 0 },
      ts: t.updatedAt
    })
  }
  for (const s of sessions) {
    addNode({
      id: nid('session', s.id),
      kind: 'session',
      refId: s.id,
      label: s.title,
      status: s.topic,
      meta: { items: s.items.length, projectId: s.projectId ?? '', participants: (s.participants ?? []).length },
      ts: s.updatedAt
    })
  }
  for (const p of plans) {
    addNode({
      id: nid('plan', p.id),
      kind: 'plan',
      refId: p.id,
      label: p.title,
      status: p.status,
      meta: { date: p.date, projectId: p.projectId ?? '', projectTaskId: p.projectTaskId ?? '' },
      ts: p.completedAt ?? p.ts ?? now
    })
  }
  for (const k of knowledge) {
    addNode({
      id: nid('knowledge', k.id),
      kind: 'knowledge',
      refId: k.id,
      label: k.title,
      status: k.source,
      meta: { tags: k.tags.join(','), links: k.links.length },
      ts: k.ts
    })
  }
  for (const w of workflows) {
    addNode({
      id: nid('workflow', w.id),
      kind: 'workflow',
      refId: w.id,
      label: w.name,
      status: w.schedule?.enabled ? 'scheduled' : 'manual',
      meta: { nodes: w.nodes.length, projectId: w.projectId ?? '' },
      ts: w.updatedAt
    })
  }
  for (const g of goals) {
    addNode({
      id: nid('goal', g.id),
      kind: 'goal',
      refId: g.id,
      label: g.event,
      status: g.status,
      meta: { deadline: g.deadline, dailyTargetMin: g.dailyTargetMin },
      ts: g.updatedAt
    })
  }

  // 边：belongs / references / derived
  for (const t of tasks) addEdge(nid('task', t.id), nid('project', t.projectId), 'belongs')
  for (const p of plans) {
    if (p.projectId) addEdge(nid('plan', p.id), nid('project', p.projectId), 'belongs')
    if (p.projectTaskId) addEdge(nid('plan', p.id), nid('task', p.projectTaskId), 'belongs')
  }
  for (const s of sessions) {
    if (s.projectId) addEdge(nid('session', s.id), nid('project', s.projectId), 'belongs')
    if (s.parentSessionId) addEdge(nid('session', s.id), nid('session', s.parentSessionId), 'derived')
  }
  for (const w of workflows) {
    if (w.projectId) addEdge(nid('workflow', w.id), nid('project', w.projectId), 'belongs')
  }
  for (const g of goals) {
    for (const pid of g.attribution.projectIds) addEdge(nid('goal', g.id), nid('project', pid), 'references')
  }
  for (const k of knowledge) {
    for (const link of k.links) {
      const target =
        link.type === 'project'
          ? nid('project', link.id)
          : link.type === 'task'
            ? nid('task', link.id)
            : link.type === 'plan'
              ? nid('plan', link.id)
              : ''
      if (target) addEdge(nid('knowledge', k.id), target, 'references')
    }
  }

  replaceCollection('graphNodes', nodes)
  replaceCollection('graphEdges', edges)
  builtAt = now
  return computeStats(nodes, edges, now)
}

function computeStats(nodes: GraphNode[], edges: GraphEdge[], stamp = builtAt): GraphStats {
  const byKind: Record<string, number> = {}
  for (const n of nodes) byKind[n.kind] = (byKind[n.kind] ?? 0) + 1
  const linked = new Set<string>()
  for (const e of edges) {
    linked.add(e.from)
    linked.add(e.to)
  }
  return {
    nodes: nodes.length,
    edges: edges.length,
    byKind,
    orphans: nodes.filter((n) => !linked.has(n.id)).length,
    components: componentsOf(nodes, edges).length,
    builtAt: stamp
  }
}

function componentsOf(nodes: GraphNode[], edges: GraphEdge[]): string[][] {
  const parent = new Map<string, string>()
  const find = (x: string): string => {
    let p = parent.get(x) ?? x
    if (p !== x) {
      p = find(p)
      parent.set(x, p)
    }
    return p
  }
  for (const n of nodes) parent.set(n.id, n.id)
  for (const e of edges) {
    const ra = find(e.from)
    const rb = find(e.to)
    if (ra !== rb) parent.set(ra, rb)
  }
  const groups = new Map<string, string[]>()
  for (const n of nodes) {
    const r = find(n.id)
    const arr = groups.get(r) ?? []
    arr.push(n.id)
    groups.set(r, arr)
  }
  return [...groups.values()]
}

function ensureFresh(force = false): void {
  if (force || !builtAt || Date.now() - builtAt > TTL_MS) rebuildGraph()
}

/** 全量视图（GraphView 渲染 / 搜索） */
export function getGraph(): GraphViewData {
  ensureFresh()
  const nodes = col<GraphNode>('graphNodes')
  const edges = col<GraphEdge>('graphEdges')
  return { nodes, edges, stats: computeStats(nodes, edges) }
}

/** P2 关联面板：某节点的邻居（默认 1 跳，最多 2 跳） */
export function graphNeighbors(nodeId: string, depth = 1): GraphNeighbor[] {
  ensureFresh()
  const nodes = col<GraphNode>('graphNodes')
  const edges = col<GraphEdge>('graphEdges')
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const out: GraphNeighbor[] = []
  const seen = new Set<string>([nodeId])
  let frontier = [nodeId]
  const hops = Math.max(1, Math.min(2, depth))
  for (let d = 0; d < hops; d++) {
    const next: string[] = []
    for (const e of edges) {
      if (frontier.includes(e.from) && byId.has(e.to) && !seen.has(e.to)) {
        const node = byId.get(e.to) as GraphNode
        out.push({ node, edge: e, direction: 'out' })
        seen.add(node.id)
        next.push(node.id)
      } else if (frontier.includes(e.to) && byId.has(e.from) && !seen.has(e.from)) {
        const node = byId.get(e.from) as GraphNode
        out.push({ node, edge: e, direction: 'in' })
        seen.add(node.id)
        next.push(node.id)
      }
    }
    frontier = next
    if (!frontier.length) break
  }
  return out
}

/** P1 AI/搜索用：关键词命中的节点 + 邻居摘要（纯文本，不泄漏标题以外内容） */
export function graphContext(keyword: string, limit = 6): string {
  const kw = keyword.trim().toLowerCase()
  if (!kw) return ''
  const { nodes } = getGraph()
  const hits = nodes.filter((n) => n.label.toLowerCase().includes(kw)).slice(0, Math.max(1, Math.min(12, limit)))
  if (!hits.length) return ''
  return hits
    .map((n) => {
      const nb = graphNeighbors(n.id, 1)
      const rel = nb
        .slice(0, 6)
        .map((x) => `${x.node.kind}「${x.node.label}」`)
        .join('、')
      return `${n.kind}「${n.label}」${n.status ? `（${n.status}）` : ''}${rel ? `：关联 ${rel}` : ''}`
    })
    .join('\n')
}

const DAY_MS = 86400000

/** P3 分析：停滞 / 孤立知识 / 最大关联簇 / 关键路径预测 */
export function analyzeGraph(): GraphAnalysis {
  ensureFresh(true)
  const nodes = col<GraphNode>('graphNodes')
  const edges = col<GraphEdge>('graphEdges')
  const stats = computeStats(nodes, edges)
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const insights: GraphInsight[] = []
  const now = Date.now()

  // 停滞项目：项目及关联节点 14 天没更新，且项目未完成
  for (const p of nodes.filter((n) => n.kind === 'project' && n.status !== 'done' && n.status !== 'archived')) {
    const related = graphNeighbors(p.id, 1).map((x) => x.node)
    const latest = Math.max(p.ts, ...related.map((r) => r.ts))
    const idleDays = Math.round((now - latest) / DAY_MS)
    if (idleDays >= 14) {
      insights.push({
        kind: 'stalled',
        title: `「${p.label}」已停滞 ${idleDays} 天`,
        detail: '项目与关联任务/会话/计划都没有新动静——重新排一次任务或把它归档。',
        nodeIds: [p.id, ...related.slice(0, 6).map((r) => r.id)]
      })
    }
  }

  // 孤立知识：没有任何关联边
  const linkedIds = new Set<string>()
  for (const e of edges) {
    linkedIds.add(e.from)
    linkedIds.add(e.to)
  }
  const isolated = nodes.filter((n) => n.kind === 'knowledge' && !linkedIds.has(n.id))
  if (isolated.length) {
    insights.push({
      kind: 'isolated',
      title: `${isolated.length} 条知识还没关联`,
      detail: '在知识库把它们链接到项目 / 任务 / 计划，之后项目视图能直接召回。',
      nodeIds: isolated.slice(0, 12).map((n) => n.id)
    })
  }

  // 最大关联簇：组件 ≥3 个节点
  const comps = componentsOf(nodes, edges).sort((a, b) => b.length - a.length)
  const largest = comps[0]
  if (largest && largest.length >= 3) {
    const labels = largest
      .slice(0, 5)
      .map((id) => byId.get(id)?.label ?? id)
      .join('、')
    insights.push({
      kind: 'cluster',
      title: `最大关联簇：${largest.length} 个节点`,
      detail: `${labels}${largest.length > 5 ? ' …' : ''}`,
      nodeIds: largest.slice(0, 12)
    })
  }

  // 关键路径：有截止日、仍有未完成任务的最近项目；按每日 120 分钟估算剩余天数
  const criticalPath = computeCriticalPath(nodes, edges)
  if (criticalPath) {
    const head = criticalPath.nodes[0]
    const proj = [...criticalPath.nodes].reverse().find((n) => n.kind === 'project')
    insights.push({
      kind: 'critical',
      title: `关键路径：${proj?.label ?? head?.label ?? ''} 预计 ${criticalPath.estimatedDays} 天`,
      detail: `剩余 ${Math.round(criticalPath.remainingMin / 60)} 小时工作量（按每日 2 小时估算）——先推路径上的第一个任务。`,
      nodeIds: criticalPath.nodes.map((n) => n.id)
    })
  }

  return { stats, insights, criticalPath }
}

function computeCriticalPath(nodes: GraphNode[], edges: GraphEdge[]): GraphCriticalPath | null {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const projects = nodes
    .filter((n) => n.kind === 'project' && n.status !== 'done' && n.status !== 'archived')
    .map((n) => {
      const deadline = String(n.meta?.deadline ?? '')
      const ts = deadline ? new Date(`${deadline}T00:00:00`).getTime() : Number.POSITIVE_INFINITY
      return { node: n, deadlineTs: Number.isFinite(ts) ? ts : Number.POSITIVE_INFINITY }
    })
    .filter((p) => p.deadlineTs >= today.getTime())
    .sort((a, b) => a.deadlineTs - b.deadlineTs)
  if (!projects.length) return null
  const project = projects[0].node
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const openTasks = edges
    .filter((e) => e.kind === 'belongs' && e.to === project.id && byId.get(e.from)?.kind === 'task')
    .map((e) => byId.get(e.from) as GraphNode)
    .filter((t) => t.status !== 'done')
    .sort((a, b) => {
      const rank = (s?: string): number => (s === 'in_progress' ? 0 : s === 'blocked' ? 1 : 2)
      return rank(a.status) - rank(b.status)
    })
  if (!openTasks.length) return null
  const remainingMin = openTasks.reduce((sum, t) => {
    const est = Number(t.meta?.estMin ?? 0)
    const actual = Number(t.meta?.actualMin ?? 0)
    return sum + (est || actual || 60)
  }, 0)
  return {
    nodes: [project, ...openTasks].map((n) => n),
    estimatedDays: Math.max(1, Math.ceil(remainingMin / 120)),
    remainingMin
  }
}

/** 启动时/数据变更后调用：后台重建（失败不影响主流程） */
export function startGraphIndex(): void {
  try {
    rebuildGraph()
    console.log('[graph] 关联图谱索引已建立')
  } catch (e) {
    console.warn('[graph] 索引建立失败', e)
  }
  const timer = setInterval(() => {
    try {
      ensureFresh()
    } catch (e) {
      console.warn('[graph] 周期重建失败', e)
    }
  }, TTL_MS)
  timer.unref?.()
}
