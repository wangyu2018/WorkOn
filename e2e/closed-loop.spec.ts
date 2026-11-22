import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { expect, test, type Browser, type Page } from '@playwright/test'
import {
  appApi,
  cleanupScenarioData,
  cleanupWorkflowRuns,
  connectApp,
  dateKey,
  openReportTab,
  openView,
  shiftDate,
  uniqueTitle,
  waitForApi
} from './helpers'

/**
 * 闭环自测（需先运行 npm run dev:debug）
 * 覆盖：主导航冒烟、知识→计划、情报→计划、今日回顾单项/批量顺延。
 * 所有测试数据以 SCENARIO-E2E- 开头，用例结束后自动删除。
 */
test.describe.configure({ mode: 'serial' })

let browser: Browser
let page: Page
const extraPlanIds = new Set<string>()
const workflowIds = new Set<string>()
const watchTaskIds = new Set<string>()

test.beforeAll(async () => {
  const conn = await connectApp()
  browser = conn.browser
  page = conn.page
  await waitForApi(page)
})

test.afterEach(async () => {
  for (const id of watchTaskIds) await appApi.removeWatchTask(page, id).catch(() => undefined)
  for (const id of workflowIds) await appApi.workflowRemove(page, id).catch(() => undefined)
  cleanupWorkflowRuns(workflowIds)
  await cleanupScenarioData(page, extraPlanIds)
  watchTaskIds.clear()
  workflowIds.clear()
  extraPlanIds.clear()
})

test.afterAll(async () => {
  await cleanupScenarioData(page, extraPlanIds).catch(() => undefined)
  const restore = page.getByTitle('还原浮窗')
  if (await restore.count()) await restore.first().click()
  const close = page.getByTitle('关闭浮窗')
  if (await close.count()) await close.first().click()
  await browser.close().catch(() => undefined)
})

test('SMOKE-01 主导航与回顾页签可用', async ({}, testInfo) => {
  const navLabels = await page.locator('nav button').evaluateAll((els) =>
    els.map((el) => el.getAttribute('aria-label') ?? el.textContent?.trim() ?? '')
  )
  expect(navLabels).toEqual(expect.arrayContaining(['今天', '计划', '情报', 'Agent', '工作流', '回顾', '更多']))

  await openView(page, '回顾')
  await expect(page.getByRole('tab', { name: '今日回顾', exact: true })).toBeVisible()
  await expect(page.getByRole('tab', { name: '知识沉淀', exact: true })).toBeVisible()

  await page.screenshot({ path: testInfo.outputPath('smoke-review.png') })
})

test('C4-01 知识转为今日计划并回写 links', async ({}, testInfo) => {
  const title = uniqueTitle('知识转计划')
  const body = 'E2E：验证知识转计划后写回关联，测试结束自动清理。'
  const knowledge = await appApi.addKnowledge(page, {
    title,
    body,
    source: 'manual',
    tags: ['E2E']
  })

  await openView(page, '回顾')
  await openReportTab(page, '知识沉淀')

  const item = page.getByRole('button', { name: title })
  await expect(item).toBeVisible({ timeout: 15_000 })
  await item.click()

  const convert = page.getByRole('button', { name: '转为今日计划', exact: true })
  await expect(convert).toBeVisible({ timeout: 10_000 })
  await convert.click()

  await expect(page.getByRole('button', { name: '已关联计划', exact: true })).toBeVisible({ timeout: 15_000 })

  const today = dateKey()
  await expect
    .poll(
      async () =>
        (await appApi.listPlans(page)).filter(
          (p) => p.source === 'knowledge' && p.date === today && p.title === title
        ).length,
      { timeout: 15_000, message: '今日计划中未出现知识创建的任务' }
    )
    .toBe(1)

  const plan = (await appApi.listPlans(page)).find(
    (p) => p.source === 'knowledge' && p.date === today && p.title === title
  )
  expect(plan?.planType).toBe('task')

  const savedKnowledge = (await appApi.listKnowledge(page)).find((k) => k.id === knowledge.id)
  expect(savedKnowledge?.links?.some((l) => l.type === 'plan' && l.id === plan?.id)).toBe(true)

  await page.screenshot({ path: testInfo.outputPath('c4-knowledge-to-plan.png') })
})

test('C1-01 情报转为今日计划', async ({}, testInfo) => {
  const intel = await appApi.getIntelState(page)
  const items = intel.items ?? []
  test.skip(items.length === 0, '当前情报流为空，跳过的同时不造模拟情报')

  const beforeIds = new Set(
    (await appApi.listPlans(page)).filter((p) => p.source === 'intel').map((p) => p.id)
  )

  await openView(page, '情报')
  const convert = page.getByRole('button', { name: '转今日计划', exact: true }).first()
  await expect(convert).toBeVisible({ timeout: 15_000 })
  await convert.click()

  await expect
    .poll(
      async () =>
        (await appApi.listPlans(page)).filter((p) => p.source === 'intel' && !beforeIds.has(p.id)).length,
      { timeout: 15_000, message: '情报转计划后未在计划库中找到 source=intel 的新计划' }
    )
    .toBeGreaterThanOrEqual(1)

  const created = (await appApi.listPlans(page)).find(
    (p) => p.source === 'intel' && !beforeIds.has(p.id)
  )
  expect(created).toBeTruthy()
  if (!created) return
  extraPlanIds.add(created.id)

  const today = dateKey()
  expect(created.date).toBe(today)
  expect(created.planType).toBe('task')
  expect(items.some((it) => it.title.trim().slice(0, 60) === created.title)).toBe(true)
  expect(created.note ?? '').toContain('http')

  await page.screenshot({ path: testInfo.outputPath('c1-intel-to-plan.png') })
})

test('C5-01 今日回顾单项顺延到明天', async ({}, testInfo) => {
  const today = dateKey()
  const tomorrow = shiftDate(today, 1)
  const title = uniqueTitle('单项顺延')

  await appApi.savePlan(page, {
    date: today,
    title,
    category: 'other',
    status: 'planned',
    source: 'manual',
    planType: 'phase',
    startMin: 120,
    endMin: 150
  })

  await openView(page, '回顾')
  await openReportTab(page, '今日回顾')
  await expect(page.getByText(title, { exact: true }).first()).toBeVisible({ timeout: 30_000 })

  const row = page
    .locator('div.flex.items-center.gap-2.rounded-lg')
    .filter({ hasText: title })
    .filter({ has: page.getByRole('button', { name: '顺延', exact: true }) })
    .first()
  await row.getByRole('button', { name: '顺延', exact: true }).click()

  await expect(page.getByText(`已顺延 1 项到 ${tomorrow}`)).toBeVisible({ timeout: 15_000 })

  await expect
    .poll(
      async () => (await appApi.listPlans(page)).find((p) => p.title === title && p.date === today)?.status,
      { timeout: 15_000, message: '原计划未标记 delayed' }
    )
    .toBe('delayed')

  await expect
    .poll(
      async () =>
        (await appApi.listPlans(page)).filter(
          (p) => p.title === title && p.date === tomorrow && p.status === 'planned'
        ).length,
      { timeout: 15_000, message: '未生成次日的 planned 副本' }
    )
    .toBe(1)

  const copy = (await appApi.listPlans(page)).find(
    (p) => p.title === title && p.date === tomorrow && p.status === 'planned'
  )
  expect(copy?.note).toContain(`延期自 ${today}`)

  await page.screenshot({ path: testInfo.outputPath('c5-single-delay.png') })
})

test('C5-02 今日回顾批量顺延到明天', async ({}, testInfo) => {
  const today = dateKey()
  const tomorrow = shiftDate(today, 1)

  const activeToday = (await appApi.listPlans(page)).filter(
    (p) =>
      p.date === today &&
      !p.archived &&
      p.status !== 'done' &&
      p.status !== 'cancelled' &&
      p.status !== 'delayed'
  )
  test.skip(activeToday.length > 0, '今日已有真实计划，为避免批量顺延影响真实数据而跳过')

  const titles = [uniqueTitle('批量A'), uniqueTitle('批量B')]
  await appApi.savePlan(page, {
    date: today,
    title: titles[0],
    category: 'other',
    status: 'planned',
    source: 'manual',
    planType: 'phase',
    startMin: 120,
    endMin: 150
  })
  await appApi.savePlan(page, {
    date: today,
    title: titles[1],
    category: 'other',
    status: 'planned',
    source: 'manual',
    planType: 'phase',
    startMin: 150,
    endMin: 180
  })

  await openView(page, '回顾')
  await openReportTab(page, '今日回顾')
  // 回顾页在上一用例后仍挂载着旧报告，先刷新再断言本次新种的计划
  // 内置浏览器也可能有「刷新」；回顾页刷新位于其后的主内容区。
  await page.getByRole('button', { name: '刷新', exact: true }).last().click()
  await page.waitForTimeout(1500)
  await expect(page.getByText(titles[0], { exact: true }).first()).toBeVisible({ timeout: 30_000 })

  await page.getByRole('button', { name: /^全部顺延到/ }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: '顺延', exact: true }).click()

  await expect(page.getByText(`已顺延 2 项到 ${tomorrow}`)).toBeVisible({ timeout: 20_000 })

  const plans = await appApi.listPlans(page)
  for (const title of titles) {
    expect(plans.find((p) => p.title === title && p.date === today)?.status).toBe('delayed')
    expect(
      plans.filter((p) => p.title === title && p.date === tomorrow && p.status === 'planned')
    ).toHaveLength(1)
  }

  await page.screenshot({ path: testInfo.outputPath('c5-batch-delay.png') })
})

test('WF-01 工作流真实执行、失败留痕并跨刷新持久化', async () => {
  const okId = `wf-e2e-ok-${Date.now().toString(36)}`
  const failId = `wf-e2e-fail-${Date.now().toString(36)}`
  workflowIds.add(okId)
  workflowIds.add(failId)
  const now = Date.now()
  const nodes = {
    input: { id: 'input', kind: 'input', title: '需求输入', x: 0, y: 0 },
    output: { id: 'output', kind: 'output', title: '交付结果', x: 240, y: 0 },
    tool: { id: 'tool', kind: 'tool', title: '不支持的工具', toolKind: 'browser', x: 120, y: 0 }
  }
  const base = { createdAt: now, updatedAt: now, nodes: [], edges: [] }

  expect((await appApi.workflowSave(page, {
    ...base,
    id: okId,
    name: uniqueTitle('确定性工作流'),
    nodes: [nodes.input, nodes.output],
    edges: [{ id: 'ok-edge', from: 'input', to: 'output' }]
  })).ok).toBe(true)
  expect((await appApi.workflowSave(page, {
    ...base,
    id: failId,
    name: uniqueTitle('失败工作流'),
    nodes: [nodes.input, nodes.tool, nodes.output],
    edges: [
      { id: 'fail-edge-1', from: 'input', to: 'tool' },
      { id: 'fail-edge-2', from: 'tool', to: 'output' }
    ]
  })).ok).toBe(true)

  const input = uniqueTitle('工作流输入')
  const success = await appApi.workflowRunById(page, okId, input)
  expect(success.ok).toBe(true)
  expect(success.nodes).toBe(2)
  expect(success.output).toContain('【需求输入】')
  expect(success.output).toContain(input)

  const failure = await appApi.workflowRunById(page, failId, uniqueTitle('失败输入'))
  expect(failure.ok).toBe(false)
  expect(failure.error).toContain('定时运行暂不支持浏览器 / 电脑操作节点')

  await page.reload()
  await waitForApi(page)
  expect((await appApi.workflowList(page)).workflows.some((w) => w.id === okId)).toBe(true)
  expect((await appApi.workflowRuns(page, okId)).some((r) => r.id === success.id && r.ok)).toBe(true)
  expect((await appApi.workflowRuns(page, failId)).some((r) => r.id === failure.id && !r.ok)).toBe(true)
})

test('C10 盯守基线、增量、去重、失败隔离与刷新持久化', async () => {
  const prefix = uniqueTitle('盯守')
  let links = [
    { path: '/a', title: `${prefix}-基线文章甲` },
    { path: '/b', title: `${prefix}-基线文章乙` }
  ]
  const server = http.createServer((req, res) => {
    if (req.url === '/broken') {
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' })
      res.end('forced watch failure')
      return
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
    res.end(`<html><head><title>${prefix}</title></head><body>${links.map((l) => `<a href="${l.path}">${l.title}</a>`).join('')}</body></html>`)
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as AddressInfo).port
  let taskId = ''

  try {
    const task = await appApi.createWatchTask(page, {
      title: prefix,
      points: [
        { url: `http://127.0.0.1:${port}/source`, label: '正常源' },
        { url: `http://127.0.0.1:${port}/broken`, label: '失败源' }
      ],
      sinks: { knowledge: true, persona: false, plan: false },
      intervalMin: 60
    })
    taskId = task.id
    watchTaskIds.add(taskId)

    const baseline = await appApi.runWatchNow(page, taskId)
    expect(baseline.checked).toBe(2)
    expect(baseline.found).toBe(0)
    expect(baseline.errors).toHaveLength(1)
    let snapshot = await appApi.getWatchSnapshot(page)
    let current = snapshot.tasks.find((t) => t.id === taskId)
    expect(current?.points[0].baselineAt).toBeTruthy()
    expect(current?.points[1].failures).toBe(1)
    expect(current?.points[1].lastError).toContain('HTTP 500')

    links = [...links, { path: '/c', title: `${prefix}-新增文章丙` }]
    const increment = await appApi.runWatchNow(page, taskId)
    expect(increment.checked).toBe(2)
    expect(increment.found).toBe(1)
    expect(increment.errors).toHaveLength(1)
    expect((await appApi.listKnowledge(page)).filter((k) => k.title === `${prefix}-新增文章丙`)).toHaveLength(1)

    const unchanged = await appApi.runWatchNow(page, taskId)
    expect(unchanged.found).toBe(0)
    expect((await appApi.listKnowledge(page)).filter((k) => k.title === `${prefix}-新增文章丙`)).toHaveLength(1)

    // C10-12 超过 8 个盯点时截断，重复 URL 去重
    const capTask = await appApi.createWatchTask(page, {
      title: uniqueTitle('盯点上限'),
      points: Array.from({ length: 10 }, (_, i) => ({
        url: `http://127.0.0.1:${port}/cap-${i}`,
        label: `上限${i}`
      })),
      sinks: { knowledge: false, persona: false, plan: false },
      intervalMin: 60
    })
    watchTaskIds.add(capTask.id)
    expect(capTask.points).toHaveLength(8)
    expect(new Set(capTask.points.map((p) => p.url)).size).toBe(8)
    await appApi.removeWatchTask(page, capTask.id)
    watchTaskIds.delete(capTask.id)

    await page.reload()
    await waitForApi(page)
    snapshot = await appApi.getWatchSnapshot(page)
    current = snapshot.tasks.find((t) => t.id === taskId)
    expect(current?.findingsCount).toBe(1)
    // 调度器 tick 可能在断言前再失败一次，这里只要求失败计数已累积（不退避为 0）
    expect(current?.points[1].failures).toBeGreaterThanOrEqual(3)
    expect(snapshot.recent.filter((f) => f.taskId === taskId)).toHaveLength(1)
    expect((await appApi.listKnowledge(page)).some((k) => k.title === `${prefix}-新增文章丙`)).toBe(true)

    // C10-07 暂停后状态可见；恢复会重置失败退避，便于继续巡检
    await appApi.patchWatchTask(page, taskId, { status: 'paused' })
    let paused = await appApi.getWatchSnapshot(page)
    expect(paused.tasks.find((t) => t.id === taskId)?.status).toBe('paused')
    await appApi.patchWatchTask(page, taskId, { status: 'active' })
    paused = await appApi.getWatchSnapshot(page)
    const resumed = paused.tasks.find((t) => t.id === taskId)
    expect(resumed?.status).toBe('active')
    expect(resumed?.points[1].failures).toBe(0)
  } finally {
    if (taskId) {
      await appApi.removeWatchTask(page, taskId).catch(() => undefined)
      watchTaskIds.delete(taskId)
      const snapshot = await appApi.getWatchSnapshot(page).catch(() => null)
      expect(snapshot?.tasks.some((t) => t.id === taskId) ?? false).toBe(false)
      expect(snapshot?.recent.some((f) => f.taskId === taskId) ?? false).toBe(false)
    }
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})

test('C11-02 浏览器页未登录时提示登录且不写入落点', async () => {
  const title = uniqueTitle('抖音未登录')
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
    res.end('<html><head><title>抖音未登录模拟</title></head><body>请先登录 / 扫码验证后继续</body></html>')
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as AddressInfo).port
  let taskId = ''

  try {
    const before = (await appApi.listKnowledge(page)).length
    const task = await appApi.createWatchTask(page, {
      title,
      points: [{ url: `http://127.0.0.1:${port}/user/self`, label: '抖音未登录页' }],
      sourceKind: 'browser-page',
      sourceLabel: '抖音 · 未登录模拟',
      sinks: { knowledge: true, persona: false, plan: false },
      intervalMin: 60
    })
    taskId = task.id
    watchTaskIds.add(taskId)

    const result = await appApi.runWatchNow(page, taskId)
    expect(result.checked).toBe(1)
    expect(result.found).toBe(0)
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]).toContain('需要先在应用内浏览器登录一次')

    const snapshot = await appApi.getWatchSnapshot(page)
    const current = snapshot.tasks.find((t) => t.id === taskId)
    expect(current?.points[0].failures).toBe(1)
    expect(current?.points[0].lastError).toContain('登录')
    expect((await appApi.listKnowledge(page)).length).toBe(before)
  } finally {
    if (taskId) {
      await appApi.removeWatchTask(page, taskId).catch(() => undefined)
      watchTaskIds.delete(taskId)
    }
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})
