import { expect, test, type Browser, type Page } from '@playwright/test'
import {
  appApi,
  cleanupScenarioData,
  connectApp,
  dateKey,
  openReportTab,
  openView,
  shiftDate,
  uniqueTitle,
  waitForApi
} from './helpers'

/**
 * 跨闭环一致性与边界自测（需先运行 npm run dev:debug）
 * 覆盖：知识↔计划关联清理、顺延副本来源/备注可追溯、快速连点幂等、标题转义。
 * 所有测试数据以 SCENARIO-E2E- 开头，用例结束后自动删除。
 */
test.describe.configure({ mode: 'serial' })

let browser: Browser
let page: Page
const extraPlanIds = new Set<string>()

test.beforeAll(async () => {
  const conn = await connectApp()
  browser = conn.browser
  page = conn.page
  await waitForApi(page)
})

test.afterEach(async () => {
  await cleanupScenarioData(page, extraPlanIds)
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

test('C4-14 / C6-05 删除计划后知识关联清理并可重新转计划', async () => {
  const title = uniqueTitle('关联清理')
  const knowledge = await appApi.addKnowledge(page, {
    title,
    body: 'E2E：计划删除后知识不应留下死链。',
    source: 'manual',
    tags: ['E2E']
  })
  await page.reload()
  await waitForApi(page)

  await openView(page, '回顾')
  await openReportTab(page, '知识沉淀')
  await page.getByRole('button', { name: title }).click()
  await page.getByRole('button', { name: '转为今日计划', exact: true }).click()
  await expect(page.getByRole('button', { name: '已关联计划', exact: true })).toBeVisible({ timeout: 15_000 })

  const plan = (await appApi.listPlans(page)).find(
    (p) => p.source === 'knowledge' && p.date === dateKey() && p.title === title
  )
  expect(plan).toBeTruthy()
  if (!plan) return

  await appApi.removePlan(page, plan.id)
  await page.reload()
  await waitForApi(page)
  await openView(page, '回顾')
  await openReportTab(page, '知识沉淀')
  await page.getByRole('button', { name: title }).click()

  await expect(page.getByRole('button', { name: '转为今日计划', exact: true })).toBeEnabled({ timeout: 15_000 })
  const saved = (await appApi.listKnowledge(page)).find((k) => k.id === knowledge.id)
  expect((saved?.links ?? []).some((l) => l.type === 'plan' && l.id === plan.id)).toBe(false)
})

test('C6-02 / C5-11 顺延副本保留来源与原备注（含情报 URL）', async () => {
  const today = dateKey()
  const tomorrow = shiftDate(today, 1)
  const title = uniqueTitle('情报顺延')
  const url = 'https://example.com/workon-e2e-intel'
  const plan = await appApi.savePlan(page, {
    date: today,
    title,
    category: 'other',
    status: 'planned',
    source: 'intel',
    planType: 'task',
    note: `E2E 情报摘要\n${url}`
  })

  const result = await appApi.delayPlan(page, plan.id, tomorrow, '回顾页顺延')
  expect(result?.newPlan).toBeTruthy()
  const copy = result?.newPlan
  if (!copy) return
  extraPlanIds.add(copy.id)

  expect(copy.date).toBe(tomorrow)
  expect(copy.status).toBe('planned')
  expect(copy.source).toBe('intel')
  expect(copy.planType).toBe('task')
  expect(copy.note).toContain(`延期自 ${today}`)
  expect(copy.note).toContain(url)

  const original = (await appApi.listPlans(page)).find((p) => p.id === plan.id)
  expect(original?.status).toBe('delayed')
})

test('C6-01 知识→计划→顺延副本可追溯原知识内容', async () => {
  const today = dateKey()
  const tomorrow = shiftDate(today, 1)
  const title = uniqueTitle('知识顺延')
  const body = 'E2E：知识正文应随顺延副本保留，便于次日继续。'

  await appApi.addKnowledge(page, { title, body, source: 'manual', tags: ['E2E'] })
  // 知识页可能仍挂载着上一用例的旧列表，刷新让新数据进入本轮渲染
  await page.reload()
  await waitForApi(page)
  await openView(page, '回顾')
  await openReportTab(page, '知识沉淀')
  await page.getByRole('button', { name: title }).click()
  await page.getByRole('button', { name: '转为今日计划', exact: true }).click()
  await expect(page.getByRole('button', { name: '已关联计划', exact: true })).toBeVisible({ timeout: 15_000 })

  const plan = (await appApi.listPlans(page)).find(
    (p) => p.source === 'knowledge' && p.date === today && p.title === title
  )
  expect(plan).toBeTruthy()
  if (!plan) return

  const result = await appApi.delayPlan(page, plan.id, tomorrow, '回顾页顺延')
  const copy = result?.newPlan
  expect(copy).toBeTruthy()
  if (!copy) return
  extraPlanIds.add(copy.id)

  expect(copy.title).toBe(title)
  expect(copy.planType).toBe('task')
  expect(copy.source).toBe('knowledge')
  expect(copy.note).toContain(body)
})

test('C4-17 / C7-05 知识转计划快速连点只创建一条', async () => {
  const title = uniqueTitle('连点知识')
  await appApi.addKnowledge(page, {
    title,
    body: 'E2E：同一帧内连点转计划只应创建一条。',
    source: 'manual',
    tags: ['E2E']
  })
  await page.reload()
  await waitForApi(page)

  await openView(page, '回顾')
  await openReportTab(page, '知识沉淀')
  await page.getByRole('button', { name: title }).click()
  const convert = page.getByRole('button', { name: '转为今日计划', exact: true })
  await expect(convert).toBeVisible({ timeout: 10_000 })

  // 同步触发 10 次点击：React state 尚未刷新，只有同步防重入能拦住
  await convert.evaluate((el) => {
    for (let i = 0; i < 10; i += 1) (el as HTMLButtonElement).click()
  })
  await expect(page.getByRole('button', { name: '已关联计划', exact: true })).toBeVisible({ timeout: 15_000 })
  await page.waitForTimeout(1500)

  const created = (await appApi.listPlans(page)).filter(
    (p) => p.source === 'knowledge' && p.date === dateKey() && p.title === title
  )
  expect(created).toHaveLength(1)
  extraPlanIds.add(created[0].id)
})

test('C1-09 / C1-18 情报转计划后刷新仍为已加入计划，连点只创建一条', async () => {
  const intel = await appApi.getIntelState(page)
  const items = intel.items ?? []
  test.skip(items.length === 0, '当前情报流为空，跳过的同时不造模拟情报')
  const first = items[0]

  const beforeIds = new Set(
    (await appApi.listPlans(page)).filter((p) => p.source === 'intel').map((p) => p.id)
  )

  await openView(page, '情报')
  const article = page.locator('article').filter({ hasText: first.title }).first()
  const convert = article.getByRole('button', { name: '转今日计划', exact: true })
  await expect(convert).toBeVisible({ timeout: 15_000 })
  await convert.evaluate((el) => {
    for (let i = 0; i < 10; i += 1) (el as HTMLButtonElement).click()
  })

  await expect
    .poll(
      async () =>
        (await appApi.listPlans(page)).filter((p) => p.source === 'intel' && !beforeIds.has(p.id)).length,
      { timeout: 15_000, message: '情报转计划后未在计划库中找到 source=intel 的新计划' }
    )
    .toBe(1)

  const created = (await appApi.listPlans(page)).find(
    (p) => p.source === 'intel' && !beforeIds.has(p.id)
  )
  if (created) extraPlanIds.add(created.id)

  // 刷新页面后按钮态应从真实计划回填，不因重启而允许重复转计划
  await page.reload()
  await waitForApi(page)
  await openView(page, '情报')
  const reloaded = page.locator('article').filter({ hasText: first.title }).first()
  await expect(reloaded.getByRole('button', { name: '已加入计划', exact: true })).toBeVisible({
    timeout: 15_000
  })
})

test('C7-07 知识标题中的 HTML 按纯文本渲染', async () => {
  const marker = uniqueTitle('转义')
  const title = `${marker}<img src=x onerror="window.__workonXss=1">`
  const knowledge = await appApi.addKnowledge(page, {
    title,
    body: 'E2E：标题里的 HTML 不应被执行。',
    source: 'manual',
    tags: ['E2E']
  })
  await page.reload()
  await waitForApi(page)

  await openView(page, '回顾')
  await openReportTab(page, '知识沉淀')
  const item = page.getByRole('button', { name: title })
  await expect(item).toBeVisible({ timeout: 15_000 })

  expect(await page.evaluate(() => (window as { __workonXss?: number }).__workonXss)).toBeUndefined()
  expect(await page.locator('img[src="x"]').count()).toBe(0)

  await appApi.removeKnowledge(page, knowledge.id).catch(() => undefined)
})
