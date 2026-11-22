import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { expect, test, type Browser, type Page } from '@playwright/test'
import { appApi, cleanupWorkflowRuns, connectApp, openView, uniqueTitle, waitForApi } from './helpers'

/**
 * C8：外部 Agent 输入 / 输出留痕
 * 用一个本机真实 HTTP Agent（回声）验证：
 *  - Agent 实际收到的请求体与 WorkOn 发送的 prompt 完全一致
 *  - 返回内容原样进入结果
 *  - Agent 页「记录」能查看每次调用的输入与输出
 */
test.describe.configure({ mode: 'serial' })

let browser: Browser
let page: Page
let server: http.Server
let endpoint = ''
let probePath = ''
let agentId = ''
let agentIdA = ''
let agentIdB = ''
const agentName = uniqueTitle('回声Agent')
const agentNameA = uniqueTitle('串联AgentA')
const agentNameB = uniqueTitle('串联AgentB')
const workflowIds = new Set<string>()
const received: Array<Record<string, unknown>> = []

test.beforeAll(async () => {
  const conn = await connectApp()
  browser = conn.browser
  page = conn.page
  await waitForApi(page)

  server = http.createServer((req, res) => {
    if (req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'text/plain' })
      res.end('ok')
      return
    }
    let body = ''
    req.on('data', (chunk) => { body += chunk })
    req.on('end', () => {
      let parsed: Record<string, unknown> = {}
      try {
        parsed = JSON.parse(body) as Record<string, unknown>
        received.push(parsed)
      } catch { /* 非 JSON 请求不纳入断言 */ }
      const prompt = String(parsed.prompt ?? '')
      if (prompt.includes('FORCE-FAIL')) {
        res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' })
        res.end('forced agent failure')
        return
      }
      const suffix = req.url?.includes('/a') ? 'A' : req.url?.includes('/b') ? 'B' : ''
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' })
      res.end(`ECHO${suffix ? `-${suffix}` : ''}:${prompt}`)
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as AddressInfo).port
  endpoint = `http://127.0.0.1:${port}/run`
  probePath = `http://127.0.0.1:${port}/health`

  const added = await appApi.addAgent(page, {
    name: agentName,
    protocol: 'http',
    endpoint,
    probePath,
    auth: 'none',
    capabilities: ['echo', 'input-output'],
    enabled: true
  })
  if (!added.ok || !added.agent) throw new Error(`注册回声 Agent 失败：${added.error ?? '未知错误'}`)
  agentId = added.agent.id

  const addA = await appApi.addAgent(page, {
    name: agentNameA,
    protocol: 'http',
    endpoint: `http://127.0.0.1:${port}/a`,
    probePath,
    auth: 'none',
    capabilities: ['echo', 'input-output'],
    enabled: true
  })
  if (!addA.ok || !addA.agent) throw new Error(`注册串联 Agent A 失败：${addA.error ?? '未知错误'}`)
  agentIdA = addA.agent.id

  const addB = await appApi.addAgent(page, {
    name: agentNameB,
    protocol: 'http',
    endpoint: `http://127.0.0.1:${port}/b`,
    probePath,
    auth: 'none',
    capabilities: ['echo', 'input-output'],
    enabled: true
  })
  if (!addB.ok || !addB.agent) throw new Error(`注册串联 Agent B 失败：${addB.error ?? '未知错误'}`)
  agentIdB = addB.agent.id
})

test.afterEach(async () => {
  for (const id of workflowIds) await appApi.workflowRemove(page, id).catch(() => undefined)
  cleanupWorkflowRuns(workflowIds)
  workflowIds.clear()
})

test.afterAll(async () => {
  await page.keyboard.press('Escape').catch(() => undefined)
  await appApi.removeAgent(page, agentId).catch(() => undefined)
  await appApi.removeAgent(page, agentIdA).catch(() => undefined)
  await appApi.removeAgent(page, agentIdB).catch(() => undefined)
  const runsAfterRemove = await appApi.listAgentRuns(page, agentId).catch(() => [])
  expect(runsAfterRemove).toHaveLength(0)
  const close = page.getByTitle('关闭浮窗')
  if (await close.count()) await close.first().click()
  await new Promise<void>((resolve) => server.close(() => resolve()))
  await browser.close().catch(() => undefined)
})

test('C8-01 外部 Agent 收到的输入与返回的输出一致', async () => {
  const prompt = `SCENARIO-E2E-外部Agent输入-${Date.now().toString(36)}`
  const result = await appApi.dispatchAgent(page, agentId, prompt)

  expect(result.ok).toBe(true)
  expect(result.output).toBe(`ECHO:${prompt}`)
  expect(received).toHaveLength(1)
  expect(received[0].prompt).toBe(prompt)
  expect(String(received[0].cwd ?? '')).not.toBe('')
  const envelopeAgent = received[0].agent as { name?: string } | undefined
  expect(envelopeAgent?.name).toBe(agentName)

  const runs = await appApi.listAgentRuns(page, agentId)
  expect(runs.length).toBeGreaterThanOrEqual(1)
  expect(runs[0].input).toBe(prompt)
  expect(runs[0].output).toBe(`ECHO:${prompt}`)
  expect(runs[0].ok).toBe(true)
})

test('C8-02 Agent 页可查看每次调用的输入与输出', async ({}, testInfo) => {
  const prompt = `SCENARIO-E2E-记录查看-${Date.now().toString(36)}`
  const result = await appApi.dispatchAgent(page, agentId, prompt)
  expect(result.ok).toBe(true)

  await openView(page, 'Agent')
  const card = page.locator('section').filter({ hasText: agentName }).last()
  await expect(card).toBeVisible({ timeout: 15_000 })
  await card.getByRole('button', { name: '记录', exact: true }).click()

  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await expect(dialog).toContainText('调用记录')
  await dialog.locator('summary').first().click()
  await expect(dialog).toContainText(prompt)
  await expect(dialog).toContainText(`ECHO:${prompt}`)

  await page.screenshot({ path: testInfo.outputPath('c8-agent-io-record.png') })
  await dialog.getByRole('button', { name: '关闭', exact: true }).last().click()
})

test('C8-03 标记参考后进入下一次编排的参考库，取消后移除', async () => {
  const prompt = `SCENARIO-E2E-参考样本-${Date.now().toString(36)}`
  const result = await appApi.dispatchAgent(page, agentId, prompt)
  expect(result.ok).toBe(true)

  const runs = await appApi.listAgentRuns(page, agentId)
  const target = runs.find((r) => r.input === prompt)
  expect(target).toBeTruthy()
  if (!target) return

  const marked = await appApi.setAgentRunReference(page, target.id, true)
  expect(marked?.reference).toBe(true)
  const refs = await appApi.listWorkflowReferences(page)
  const sample = refs.find((r) => r.id === target.id)
  expect(sample).toBeTruthy()
  expect(sample?.agentName).toBe(agentName)
  expect(sample?.outputPreview).toBe(`ECHO:${prompt}`)

  const unmarked = await appApi.setAgentRunReference(page, target.id, false)
  expect(unmarked?.reference).toBeFalsy()
  const after = await appApi.listWorkflowReferences(page)
  expect(after.some((r) => r.id === target.id)).toBe(false)
})

test('C8-08 HTTP 500 留失败记录，不伪造成功也不进入参考库', async () => {
  const prompt = uniqueTitle('FORCE-FAIL')
  const result = await appApi.dispatchAgent(page, agentId, prompt)

  expect(result.ok).toBe(false)
  expect(result.error).toContain('HTTP 500')
  expect(result.output).not.toContain(`ECHO:${prompt}`)
  expect(received.some((r) => r.prompt === prompt)).toBe(true)

  const runs = await appApi.listAgentRuns(page, agentId)
  const failed = runs.find((r) => r.input === prompt)
  expect(failed).toBeTruthy()
  expect(failed?.ok).toBe(false)
  expect(failed?.error).toContain('HTTP 500')

  if (failed) {
    await appApi.setAgentRunReference(page, failed.id, true)
    const refs = await appApi.listWorkflowReferences(page)
    expect(refs.some((r) => r.id === failed.id)).toBe(false)
    await appApi.setAgentRunReference(page, failed.id, false)
  }
})

test('C8-06 / C8-07 空内容与未确认的派发被拒绝且不触达外部 Agent', async () => {
  const before = received.length

  const unconfirmed = await page.evaluate(
    ({ aid }) =>
      (window as unknown as {
        api: {
          dispatchAgent: (
            id: string,
            prompt: string,
            cwd?: string,
            confirm?: boolean
          ) => Promise<{ ok: boolean; error?: string }>
        }
      }).api.dispatchAgent(aid, 'SCENARIO-E2E-未确认派发', undefined, false),
    { aid: agentId }
  )
  expect(unconfirmed.ok).toBe(false)
  expect(unconfirmed.error).toContain('显式确认')

  const empty = await appApi.dispatchAgent(page, agentId, '   ')
  expect(empty.ok).toBe(false)
  expect(empty.error).toContain('任务内容为空')

  expect(received).toHaveLength(before)
})

test('C8-12 删除 Agent 清理其调用记录且不影响其他 Agent', async () => {
  const added = await appApi.addAgent(page, {
    name: uniqueTitle('临时Agent'),
    protocol: 'http',
    endpoint,
    probePath,
    auth: 'none',
    capabilities: ['echo'],
    enabled: true
  })
  expect(added.ok).toBe(true)
  const tempId = added.agent?.id ?? ''
  if (!tempId) return

  const prompt = uniqueTitle('临时调用')
  const result = await appApi.dispatchAgent(page, tempId, prompt)
  expect(result.ok).toBe(true)
  expect((await appApi.listAgentRuns(page, tempId)).length).toBeGreaterThanOrEqual(1)

  const otherRunsBefore = (await appApi.listAgentRuns(page, agentId)).length
  await appApi.removeAgent(page, tempId)

  expect(await appApi.listAgentRuns(page, tempId)).toHaveLength(0)
  expect((await appApi.listAgentRuns(page, agentId)).length).toBe(otherRunsBefore)
})

test('C8-14 工作流外部 Agent A→B 串联保留每跳输入输出', async () => {
  const wfId = `wf-e2e-chain-${Date.now().toString(36)}`
  workflowIds.add(wfId)
  const input = uniqueTitle('串联输入')
  const now = Date.now()
  const save = await appApi.workflowSave(page, {
    id: wfId,
    name: uniqueTitle('外部Agent串联'),
    createdAt: now,
    updatedAt: now,
    nodes: [
      { id: 'input', kind: 'input', title: '需求输入', x: 0, y: 0 },
      { id: 'a', kind: 'agent', title: 'Agent A', agentId: agentIdA, x: 180, y: 0, duty: '处理当前输入并交给下游' },
      { id: 'b', kind: 'agent', title: 'Agent B', agentId: agentIdB, x: 360, y: 0, duty: '读取上游输出并补充本节点结果' },
      { id: 'output', kind: 'output', title: '交付结果', x: 540, y: 0 }
    ],
    edges: [
      { id: 'e1', from: 'input', to: 'a' },
      { id: 'e2', from: 'a', to: 'b' },
      { id: 'e3', from: 'b', to: 'output' }
    ]
  })
  expect(save.ok).toBe(true)

  const run = await appApi.workflowRunById(page, wfId, input)
  expect(run.ok).toBe(true)
  expect(run.nodes).toBe(4)
  expect(run.output).toContain(input)
  expect(run.output).toContain('ECHO-A:')
  expect(run.output).toContain('ECHO-B:')

  const runsA = await appApi.listAgentRuns(page, agentIdA)
  const runA = runsA.find((r) => r.input.includes(input) && r.output.startsWith('ECHO-A:'))
  expect(runA).toBeTruthy()

  const runsB = await appApi.listAgentRuns(page, agentIdB)
  const runB = runsB.find((r) => r.input.includes('ECHO-A:') && r.output.startsWith('ECHO-B:'))
  expect(runB).toBeTruthy()

  const history = await appApi.workflowRuns(page, wfId)
  expect(history.some((r) => r.id === run.id && r.ok && r.output?.includes('ECHO-B:'))).toBe(true)
})
