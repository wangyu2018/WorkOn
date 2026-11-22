/** 工作流图工具：上下游推导 / 拓扑排序 / 节点提示词（渲染端与主进程定时运行共用） */
import type { WorkflowDef, WorkflowNode } from './workflow'

export function upstreamIdsOf(def: WorkflowDef, nodeId: string): string[] {
  const node = def.nodes.find((n) => n.id === nodeId)
  const fromEdges = def.edges.filter((e) => e.to === nodeId).map((e) => e.from)
  return [...new Set([...fromEdges, ...(node?.upstreamIds ?? [])])]
}

export function topoSort(def: WorkflowDef): WorkflowNode[] | null {
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

export function systemFor(node: WorkflowNode): string {
  const lines = [
    node.role ? `你的角色：${node.role}` : '',
    node.duty ? `你的工作：${node.duty}` : '',
    node.outputSpec ? `输出要求：${node.outputSpec}` : '',
    '只输出最终结果，不要复述要求，不要输出多余寒暄。'
  ].filter(Boolean)
  return lines.length ? lines.join('\n') : '你是工作流中的一个执行节点。'
}

export function promptFor(node: WorkflowNode, upstream: string, input: string): string {
  if (node.promptTemplate?.trim()) {
    return node.promptTemplate.replace(/\{\{input\}\}/g, input).replace(/\{\{upstream\}\}/g, upstream)
  }
  return [
    `上游节点输出：\n${upstream || '（无）'}`,
    `本次输入：\n${input || '（无）'}`,
    '请按你的工作定义完成，并直接给出结果。'
  ].join('\n\n')
}
