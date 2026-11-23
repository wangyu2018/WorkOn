/**
 * 工作流定时执行 + 运行记录（FEAT-4）
 * - 每天到点（atHHMM）自动跑一次，lastRunDate 去重
 * - 夜间模式只是语义标签（适合放在 02:00 等安静时段）
 * - 记录写 userData/workflow-runs.json，最多 100 条
 * - 目前支持 input / collect / group / output / image / agent 节点；
 *   浏览器等工具节点需内置浏览器在前台，定时运行时给出明确提示
 */
import { app } from 'electron'
import fs from 'fs'
import path from 'path'
import type { WorkflowDef, WorkflowNode, WorkflowRunRecord } from '@shared/workflow'
import type { WorkflowNodeRun } from '@shared/workflow'
import { dateKey } from '@shared/trail'
import { promptFor, systemFor, topoSort, upstreamIdsOf } from '@shared/workflowGraph'
import {
  collectWorkflowContext,
  listWorkflows,
  ocrWorkflowImage,
  runWorkflowNode,
  saveWorkflow
} from './workflow'
import { dispatchAgent } from './agents'
import { pushNotify } from './notify'
import { getSettings } from './settings'
import { sendTo } from './windows'

const RUNS_FILE = 'workflow-runs.json'
const MAX_RUNS = 100
const running = new Set<string>()

function runsFile(): string {
  return path.join(app.getPath('userData'), RUNS_FILE)
}

export function listWorkflowRuns(workflowId?: string): WorkflowRunRecord[] {
  try {
    const raw = fs.readFileSync(runsFile(), 'utf8')
    const list = JSON.parse(raw) as WorkflowRunRecord[]
    const arr = Array.isArray(list) ? list : []
    return (workflowId ? arr.filter((r) => r.workflowId === workflowId) : arr).slice(0, MAX_RUNS)
  } catch {
    return []
  }
}

function appendRun(record: WorkflowRunRecord): void {
  const list = [record, ...listWorkflowRuns()].slice(0, MAX_RUNS)
  try {
    fs.mkdirSync(path.dirname(runsFile()), { recursive: true })
    fs.writeFileSync(runsFile(), JSON.stringify(list, null, 2), 'utf8')
  } catch (e) {
    console.warn('[workflowRunner] 运行记录写入失败', e)
  }
  sendTo('main', 'workflow:runDone', record)
}

function upstreamText(def: WorkflowDef, node: WorkflowNode, outputs: Record<string, WorkflowNodeRun>): string {
  return upstreamIdsOf(def, node.id)
    .map((id) => {
      const up = def.nodes.find((n) => n.id === id)
      const out = outputs[id]?.output?.trim()
      return out ? `【${up?.title ?? id}】\n${out}` : ''
    })
    .filter(Boolean)
    .join('\n\n---\n\n')
}

interface NodeResult {
  ok: boolean
  text: string
  error?: string
  /** 实际使用的模型（OCR 路径单独标注） */
  model?: string
  fallback?: 'ocr' | 'text-only' | 'model'
}

function defaultModelLabel(): string {
  const model = String(getSettings().aiModel || '').trim()
  return model || '默认模型'
}

/**
 * 节点模型调用：指定模型失败时自动切到默认模型重试一次。
 * 对应 HiRoute 的「低分保护 / 候选兜底」：不让单个模型故障中断整条工作流。
 */
async function runModelWithFallback(
  req: { system: string; prompt: string; images?: string[]; think?: boolean; timeoutMs?: number },
  model?: string
): Promise<NodeResult> {
  const primary = String(model || '').trim()
  if (!primary) {
    const r = await runWorkflowNode({ ...req })
    return { ...r, model: defaultModelLabel() }
  }
  const first = await runWorkflowNode({ ...req, model: primary })
  if (first.ok) return { ...first, model: primary }
  const fallbackModel = defaultModelLabel()
  if (!fallbackModel || fallbackModel === primary) return { ...first, model: primary }
  const second = await runWorkflowNode({ ...req })
  if (second.ok) return { ...second, model: fallbackModel, fallback: 'model' }
  return {
    ok: false,
    text: '',
    error: `${first.error || '模型调用失败'}；兜底模型「${fallbackModel}」也失败：${second.error || '未知错误'}`,
    model: fallbackModel,
    fallback: 'model'
  }
}

async function runOne(
  node: WorkflowNode,
  def: WorkflowDef,
  input: string,
  outputs: Record<string, WorkflowNodeRun>,
  trigger: 'manual' | 'schedule'
): Promise<NodeResult> {
  const upstream = upstreamText(def, node, outputs)

  if (node.kind === 'input') {
    const text = input.trim() || '定时运行'
    return { ok: true, text }
  }
  if (node.kind === 'collect') {
    const res = await collectWorkflowContext()
    return res.ok ? { ok: true, text: res.text } : { ok: false, text: '', error: res.error || '采集失败' }
  }
  if (node.kind === 'group') {
    const upIds = new Set(upstreamIdsOf(def, node.id))
    const childText = def.nodes
      .filter((n) => n.parentId === node.id && !upIds.has(n.id))
      .map((c) => (outputs[c.id]?.output ? `【子节点 · ${c.title}】\n${outputs[c.id]?.output}` : ''))
      .filter(Boolean)
      .join('\n\n')
    const text = [upstream, childText].filter(Boolean).join('\n\n')
    return text ? { ok: true, text } : { ok: false, text: '', error: '群组没有可聚合的输出' }
  }
  if (node.kind === 'output') {
    return upstream ? { ok: true, text: upstream } : { ok: false, text: '', error: '输出节点没有上游输出' }
  }
  if (node.kind === 'tool') {
    return { ok: false, text: '', error: '定时运行暂不支持浏览器 / 电脑操作节点，请打开工作流手动运行' }
  }
  if (node.kind === 'image') {
    if (!node.imageDataUrl) return { ok: false, text: '', error: '图像节点没有图片' }
    if (node.imageMode === 'ocr') {
      const r = await ocrWorkflowImage(node.imageDataUrl)
      return r.ok ? { ok: true, text: r.text, model: 'OCR（本地）' } : { ok: false, text: '', error: r.error || 'OCR 失败' }
    }
    const r = await runModelWithFallback(
      {
        system: systemFor(node),
        prompt: promptFor(node, upstream, input),
        images: [node.imageDataUrl],
        think: false,
        timeoutMs: 180_000
      },
      node.model
    )
    if (r.ok) return r
    if (node.imageMode === 'auto' || !node.imageMode) {
      const ocr = await ocrWorkflowImage(node.imageDataUrl)
      if (ocr.ok) return { ok: true, text: `（视觉模型不可用，已回退 OCR）\n\n${ocr.text}`, model: 'OCR（本地）', fallback: 'ocr' }
    }
    return { ok: false, text: '', error: r.error || '图像处理失败', model: r.model, fallback: r.fallback }
  }

  // agent
  const prompt = promptFor(node, upstream, input)
  if (node.agentId) {
    // 手动运行工作流视为用户已确认执行；定时运行仍保留外部 Agent 派发确认门槛，避免后台擅自调用外部服务。
    const r = await dispatchAgent(node.agentId, prompt, undefined, trigger === 'manual')
    return r.ok ? { ok: true, text: r.output } : { ok: false, text: r.output ?? '', error: r.error || 'Agent 派发失败' }
  }
  const r = await runModelWithFallback(
    { system: systemFor(node), prompt, timeoutMs: 180_000 },
    node.model
  )
  return r.ok ? r : { ok: false, text: '', error: r.error || '模型调用失败', model: r.model, fallback: r.fallback }
}

/** 执行一个完整工作流（定时或手动「立即运行」） */
export async function runWorkflowById(
  id: string,
  trigger: 'manual' | 'schedule' = 'manual',
  inputOverride?: string
): Promise<WorkflowRunRecord> {
  const started = Date.now()
  const base: WorkflowRunRecord = {
    id: `wfr${started}${Math.floor(Math.random() * 1000)}`,
    workflowId: id,
    name: '未知工作流',
    trigger,
    startedAt: started,
    endedAt: started,
    ok: false,
    nodes: 0
  }
  if (running.has(id)) {
    const rec = { ...base, error: '该工作流正在运行，本次跳过', endedAt: Date.now() }
    appendRun(rec)
    return rec
  }
  const def = listWorkflows().workflows.find((w) => w.id === id)
  if (!def) {
    const rec = { ...base, error: '工作流不存在', endedAt: Date.now() }
    appendRun(rec)
    return rec
  }
  const ordered = topoSort(def)
  if (!ordered) {
    const rec = { ...base, name: def.name, error: '检测到环形依赖', endedAt: Date.now() }
    appendRun(rec)
    return rec
  }
  running.add(id)
  const input = (inputOverride ?? def.schedule?.input ?? '定时运行').trim()
  const outputs: Record<string, WorkflowNodeRun> = {}
  const nodeRuns: WorkflowNodeRun[] = []
  let lastText = ''
  let error: string | undefined

  try {
    for (const node of ordered) {
      const t0 = Date.now()
      let r: NodeResult
      try {
        r = await runOne(node, def, input, outputs, trigger)
      } catch (e) {
        r = { ok: false, text: '', error: (e as Error).message }
      }
      const ms = Date.now() - t0
      outputs[node.id] = {
        nodeId: node.id,
        status: r.ok ? 'done' : 'error',
        output: r.text,
        error: r.error,
        ms
      }
      nodeRuns.push({
        nodeId: node.id,
        title: node.title,
        status: r.ok ? 'done' : 'error',
        output: r.text.slice(0, 2000),
        error: r.error,
        ms,
        model: r.model,
        fallback: r.fallback
      })
      if (!r.ok) {
        error = `「${node.title}」${r.error ?? '执行失败'}`
        break
      }
      lastText = r.text
    }
  } finally {
    running.delete(id)
  }

  const rec: WorkflowRunRecord = {
    ...base,
    name: def.name,
    endedAt: Date.now(),
    ok: !error,
    error,
    nodes: ordered.length,
    output: lastText.slice(0, 4000),
    nodeRuns
  }
  appendRun(rec)
  if (trigger === 'schedule') {
    if (rec.ok) {
      pushNotify('ai', `定时工作流完成：${def.name}`, `${rec.nodes} 个节点 · ${Math.round((rec.endedAt - rec.startedAt) / 1000)}s`, [], 20)
    } else {
      pushNotify('ai', `定时工作流失败：${def.name}`, rec.error ?? '未知错误', [], 30)
    }
  }
  return rec
}

let timer: NodeJS.Timeout | null = null
let lastTickMinute = ''

/** 每 20 秒检查一次；同一分钟只处理一次 */
export function startWorkflowScheduler(): void {
  if (timer) clearInterval(timer)
  const tick = (): void => {
    const now = new Date()
    const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
    if (hhmm === lastTickMinute) return
    lastTickMinute = hhmm
    const today = dateKey(Date.now())
    const { workflows } = listWorkflows()
    for (const def of workflows) {
      const sched = def.schedule
      if (!sched?.enabled) continue
      if (sched.atHHMM !== hhmm) continue
      if (sched.lastRunDate === today) continue
      const next: WorkflowDef = {
        ...def,
        schedule: { ...sched, lastRunDate: today, lastRunAt: Date.now() }
      }
      saveWorkflow(next)
      void runWorkflowById(def.id, 'schedule')
    }
  }
  timer = setInterval(tick, 20_000)
}
