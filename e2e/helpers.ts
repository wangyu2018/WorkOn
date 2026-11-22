import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { chromium, type Browser, type Page } from '@playwright/test'

export const CDP_URL = process.env.WORKON_CDP_URL ?? 'http://127.0.0.1:9333'

export interface Plan {
  id: string
  date: string
  title: string
  source: string
  status: string
  planType?: string
  note?: string
  ts?: number
  archived?: boolean
}

export interface KnowledgeLink {
  type: string
  id: string
  title?: string
}

export interface Knowledge {
  id: string
  title: string
  body?: string
  source: string
  links?: KnowledgeLink[]
}

export interface IntelItem {
  id: string
  title: string
  url: string
}

export interface AgentRunRecord {
  id: string
  agentId: string
  agentName: string
  protocol: string
  input: string
  output: string
  ok: boolean
  error?: string
  durationMs: number
  startedAt: number
  endedAt: number
  reference?: boolean
}

export interface WorkflowReferenceSample {
  id: string
  agentName: string
  protocol: string
  endedAt: number
  inputPreview: string
  outputPreview: string
}

export interface WorkflowRun {
  id: string
  workflowId: string
  name: string
  ok: boolean
  error?: string
  nodes: number
  output?: string
}

export interface WatchPoint {
  id: string
  url: string
  baselineAt?: number
  failures: number
  lastError?: string
}

export interface WatchTask {
  id: string
  title: string
  status: 'active' | 'paused'
  findingsCount: number
  points: WatchPoint[]
}

export interface WatchSnapshot {
  tasks: WatchTask[]
  recent: Array<{ id: string; taskId: string; title: string; url: string }>
}

/** 连接正在运行的 WorkOn；失败时给出明确启动方式 */
export async function connectApp(): Promise<{ browser: Browser; page: Page }> {
  let browser: Browser
  try {
    browser = await chromium.connectOverCDP(CDP_URL)
  } catch (e) {
    throw new Error(
      `无法连接 WorkOn 调试端口 ${CDP_URL}。请先运行 npm run dev:debug，再运行 npm run test:e2e。\n${(e as Error).message}`
    )
  }
  const page = browser
    .contexts()
    .flatMap((c) => c.pages())
    .find((p) => p.url().includes('index.html'))
  if (!page) throw new Error('已连接调试端口，但没有找到 WorkOn 主窗口')
  await page.waitForLoadState('domcontentloaded')
  return { browser, page }
}

export async function waitForApi(page: Page): Promise<void> {
  await page.waitForFunction(() => Boolean((window as { api?: unknown }).api), null, { timeout: 15_000 })
}

/** 点击顶部导航（今天 / 计划 / 情报 / Agent / 工作流 / 回顾 / 更多） */
export async function openView(page: Page, label: string): Promise<void> {
  await page.getByRole('button', { name: label, exact: true }).click()
  await page.waitForTimeout(400)
}

/** 回顾页内部页签：今日回顾 / 本周 / 知识沉淀 */
export async function openReportTab(page: Page, label: string): Promise<void> {
  await page.getByRole('tab', { name: label, exact: true }).click()
  await page.waitForTimeout(400)
}

export const appApi = {
  listPlans: (page: Page) =>
    page.evaluate(() =>
      (window as unknown as { api: { listPlans: () => Promise<Plan[]> } }).api.listPlans()
    ) as Promise<Plan[]>,
  savePlan: (page: Page, plan: Record<string, unknown>) =>
    page.evaluate(
      (p) => (window as unknown as { api: { savePlan: (x: unknown) => Promise<Plan> } }).api.savePlan(p),
      plan
    ) as Promise<Plan>,
  removePlan: (page: Page, id: string) =>
    page.evaluate(
      (pid) =>
        (window as unknown as { api: { removePlan: (x: string) => Promise<unknown> } }).api.removePlan(pid),
      id
    ),
  delayPlan: (page: Page, id: string, targetDate: string, reason?: string) =>
    page.evaluate(
      ({ pid, date, why }) =>
        (window as unknown as {
          api: {
            delayPlan: (
              x: string,
              d: string,
              r?: string
            ) => Promise<{ newPlan?: Plan } | null>
          }
        }).api.delayPlan(pid, date, why),
      { pid: id, date: targetDate, why: reason }
    ) as Promise<{ newPlan?: Plan } | null>,
  listKnowledge: (page: Page) =>
    page.evaluate(() =>
      (window as unknown as { api: { listKnowledge: () => Promise<Knowledge[]> } }).api.listKnowledge()
    ) as Promise<Knowledge[]>,
  addKnowledge: (page: Page, input: Record<string, unknown>) =>
    page.evaluate(
      (k) =>
        (window as unknown as { api: { addKnowledge: (x: unknown) => Promise<Knowledge> } }).api.addKnowledge(k),
      input
    ) as Promise<Knowledge>,
  removeKnowledge: (page: Page, id: string) =>
    page.evaluate(
      (kid) =>
        (window as unknown as { api: { removeKnowledge: (x: string) => Promise<unknown> } }).api.removeKnowledge(
          kid
        ),
      id
    ),
  getIntelState: (page: Page) =>
    page.evaluate(() =>
      (window as unknown as {
        api: { getIntelState: () => Promise<{ items?: IntelItem[] }> }
      }).api.getIntelState()
    ) as Promise<{ items?: IntelItem[] }>,
  addAgent: (page: Page, input: Record<string, unknown>) =>
    page.evaluate(
      (a) =>
        (window as unknown as {
          api: { addAgent: (x: unknown) => Promise<{ ok: boolean; agent?: { id: string; name: string }; error?: string }> }
        }).api.addAgent(a),
      input
    ) as Promise<{ ok: boolean; agent?: { id: string; name: string }; error?: string }>,
  removeAgent: (page: Page, id: string) =>
    page.evaluate(
      (aid) =>
        (window as unknown as { api: { removeAgent: (x: string) => Promise<boolean> } }).api.removeAgent(aid),
      id
    ) as Promise<boolean>,
  listAgentRuns: (page: Page, agentId?: string) =>
    page.evaluate(
      (aid) =>
        (window as unknown as {
          api: { listAgentRuns: (x?: string) => Promise<AgentRunRecord[]> }
        }).api.listAgentRuns(aid),
      agentId
    ) as Promise<AgentRunRecord[]>,
  dispatchAgent: (page: Page, id: string, prompt: string, cwd?: string) =>
    page.evaluate(
      ({ aid, text, dir }) =>
        (window as unknown as {
          api: {
            dispatchAgent: (
              x: string,
              p: string,
              c?: string,
              ok?: boolean
            ) => Promise<{ ok: boolean; output: string; error?: string; durationMs: number }>
          }
        }).api.dispatchAgent(aid, text, dir, true),
      { aid: id, text: prompt, dir: cwd }
    ) as Promise<{ ok: boolean; output: string; error?: string; durationMs: number }>,
  setAgentRunReference: (page: Page, runId: string, reference: boolean) =>
    page.evaluate(
      ({ rid, ref }) =>
        (window as unknown as {
          api: { setAgentRunReference: (x: string, r: boolean) => Promise<AgentRunRecord | null> }
        }).api.setAgentRunReference(rid, ref),
      { rid: runId, ref: reference }
    ) as Promise<AgentRunRecord | null>,
  listWorkflowReferences: (page: Page) =>
    page.evaluate(() =>
      (window as unknown as {
        api: { listWorkflowReferences: () => Promise<WorkflowReferenceSample[]> }
      }).api.listWorkflowReferences()
    ) as Promise<WorkflowReferenceSample[]>,
  workflowList: (page: Page) =>
    page.evaluate(() =>
      (window as unknown as {
        api: { workflowList: () => Promise<{ workflows: Array<{ id: string; name: string }> }> }
      }).api.workflowList()
    ) as Promise<{ workflows: Array<{ id: string; name: string }> }>,
  workflowSave: (page: Page, def: Record<string, unknown>) =>
    page.evaluate(
      (input) =>
        (window as unknown as {
          api: { workflowSave: (x: unknown) => Promise<{ ok: boolean; error?: string }> }
        }).api.workflowSave(input),
      def
    ) as Promise<{ ok: boolean; error?: string }>,
  workflowRemove: (page: Page, id: string) =>
    page.evaluate(
      (wid) =>
        (window as unknown as { api: { workflowRemove: (x: string) => Promise<boolean> } }).api.workflowRemove(wid),
      id
    ) as Promise<boolean>,
  workflowRunById: (page: Page, id: string, input: string) =>
    page.evaluate(
      ({ wid, text }) =>
        (window as unknown as {
          api: { workflowRunById: (x: string, input?: string) => Promise<WorkflowRun> }
        }).api.workflowRunById(wid, text),
      { wid: id, text: input }
    ) as Promise<WorkflowRun>,
  workflowRuns: (page: Page, id: string) =>
    page.evaluate(
      (wid) =>
        (window as unknown as { api: { workflowRuns: (x?: string) => Promise<WorkflowRun[]> } }).api.workflowRuns(wid),
      id
    ) as Promise<WorkflowRun[]>,
  getWatchSnapshot: (page: Page) =>
    page.evaluate(() =>
      (window as unknown as { api: { getWatchSnapshot: () => Promise<WatchSnapshot> } }).api.getWatchSnapshot()
    ) as Promise<WatchSnapshot>,
  createWatchTask: (page: Page, input: Record<string, unknown>) =>
    page.evaluate(
      (value) =>
        (window as unknown as { api: { createWatchTask: (x: unknown) => Promise<WatchTask> } }).api.createWatchTask(value),
      input
    ) as Promise<WatchTask>,
  removeWatchTask: (page: Page, id: string) =>
    page.evaluate(
      (wid) =>
        (window as unknown as { api: { removeWatchTask: (x: string) => Promise<boolean> } }).api.removeWatchTask(wid),
      id
    ) as Promise<boolean>,
  patchWatchTask: (page: Page, id: string, patch: { status?: 'active' | 'paused'; intervalMin?: number }) =>
    page.evaluate(
      ({ wid, value }) =>
        (window as unknown as {
          api: { patchWatchTask: (x: string, p: unknown) => Promise<WatchTask> }
        }).api.patchWatchTask(wid, value),
      { wid: id, value: patch }
    ) as Promise<WatchTask>,
  runWatchNow: (page: Page, id: string) =>
    page.evaluate(
      (wid) =>
        (window as unknown as {
          api: { runWatchNow: (x?: string) => Promise<{ checked: number; found: number; errors: string[] }> }
        }).api.runWatchNow(wid),
      id
    ) as Promise<{ checked: number; found: number; errors: string[] }>
}

/** 本地日期 YYYY-MM-DD（与界面同一个时区口径） */
export function dateKey(d: Date = new Date()): string {
  const pad = (n: number): string => `${n}`.padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export function shiftDate(key: string, days: number): string {
  const d = new Date(`${key}T00:00:00`)
  d.setDate(d.getDate() + days)
  return dateKey(d)
}

export function uniqueTitle(tag: string): string {
  return `SCENARIO-E2E-${tag}-${Date.now().toString(36)}`
}

/**
 * 清理本套件创建的测试数据：
 * - 标题以 SCENARIO-E2E- 开头的计划（包括顺延生成的次日副本）与知识
 * - 额外登记的 id（例如情报转计划沿用了真实情报标题）
 */
export async function cleanupScenarioData(page: Page, extraPlanIds: Set<string> = new Set()): Promise<void> {
  const plans = await appApi.listPlans(page)
  for (const p of plans) {
    if (p.title?.startsWith('SCENARIO-E2E-') || extraPlanIds.has(p.id)) {
      await appApi.removePlan(page, p.id).catch(() => undefined)
    }
  }
  const knowledge = await appApi.listKnowledge(page)
  for (const k of knowledge) {
    if (k.title?.startsWith('SCENARIO-E2E-')) {
      await appApi.removeKnowledge(page, k.id).catch(() => undefined)
    }
  }
}

/** 运行记录没有删除 IPC；测试端只按自建 workflowId 精确回收，其他记录原样保留。 */
export function cleanupWorkflowRuns(workflowIds: Set<string>): void {
  if (!workflowIds.size) return
  const userData = process.env.WORKON_USER_DATA_DIR ?? (
    process.platform === 'darwin'
      ? path.join(os.homedir(), 'Library', 'Application Support', 'workon')
      : process.platform === 'win32'
        ? path.join(process.env.APPDATA ?? path.join(os.homedir(), 'AppData', 'Roaming'), 'workon')
        : path.join(process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), '.config'), 'workon')
  )
  const file = path.join(userData, 'workflow-runs.json')
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as unknown
    if (!Array.isArray(raw)) return
    const next = raw.filter((r) => !workflowIds.has(String((r as { workflowId?: unknown }).workflowId ?? '')))
    if (next.length === raw.length) return
    const tmp = `${file}.e2e.tmp`
    fs.writeFileSync(tmp, JSON.stringify(next, null, 2), 'utf8')
    fs.renameSync(tmp, file)
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e
  }
}
