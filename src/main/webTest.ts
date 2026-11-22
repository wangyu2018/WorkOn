/**
 * Web 测试引擎（参考 Qoder CN 的浏览器测试流程）
 * - 页面巡检：加载状态、空白页、坏图、错误文案、告警、控制台报错、横向溢出、输入框可访问性
 * - 流程回归 / 表单边界：模型按目标生成步骤，用浏览器工具执行点击/填表/断言/截图
 * - 全程本地：操作的是当前浏览器模式（应用内或本机 Chrome）
 */
import { app } from 'electron'
import fs from 'fs'
import path from 'path'
import { sendTo } from './windows'
import {
  browserNavigate,
  browserState,
  browserRead,
  browserClick,
  browserFill,
  browserScreenshot,
  browserInspect,
  getBrowserMode,
  normalizeUrl,
  type PageInspectResult
} from './browser'
import { llmChat } from './ai'
import { genId } from '@shared/types'
import type {
  WebTestAction,
  WebTestInput,
  WebTestIssue,
  WebTestKind,
  WebTestProgress,
  WebTestReport,
  WebTestStep
} from '@shared/webtest'

interface PlanStep {
  action: WebTestAction
  target?: string
  text?: string
  expect?: string
  note?: string
}

const ALLOWED: WebTestAction[] = ['goto', 'click', 'fill', 'assert', 'screenshot', 'wait']

let running = false
let lastReport: WebTestReport | null = null

export function getLastWebTest(): WebTestReport | null {
  return lastReport
}

function emit(evt: WebTestProgress): void {
  sendTo('main', 'webtest:progress', evt)
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

/** 巡检指标 → 问题清单 */
function inspectIssues(page: PageInspectResult): WebTestIssue[] {
  const issues: WebTestIssue[] = []
  if (!page.ok) {
    issues.push({ level: 'high', title: '页面无法加载', detail: page.error })
    return issues
  }
  if ((page.textLen ?? 0) < 20) {
    issues.push({ level: 'high', title: '页面疑似空白', detail: `可见文本仅 ${page.textLen ?? 0} 字` })
  }
  const broken = page.images?.broken ?? []
  if (broken.length) {
    issues.push({
      level: 'medium',
      title: `${broken.length} 张图片加载失败`,
      detail: broken.slice(0, 5).map((b) => b.src || b.alt).join('\n')
    })
  }
  if (page.errorTexts?.length) {
    issues.push({ level: 'medium', title: '页面出现错误提示文案', detail: page.errorTexts.slice(0, 5).join(' / ') })
  }
  if (page.alerts?.length) {
    issues.push({ level: 'medium', title: '页面弹出告警', detail: page.alerts.slice(0, 3).join(' / ') })
  }
  const errs = page.consoleErrors ?? []
  if (errs.length) {
    issues.push({
      level: 'medium',
      title: `控制台报错 ${errs.length} 条`,
      detail: errs.slice(-5).map((e) => `[${e.kind}] ${e.message}`).join('\n')
    })
  }
  if (page.overflowX) {
    issues.push({ level: 'low', title: '页面存在横向溢出', detail: 'scrollWidth 超过视口宽度' })
  }
  const noLabel = (page.inputs ?? []).filter((i) => !i.hasLabel && i.type !== 'hidden')
  if (noLabel.length) {
    issues.push({
      level: 'low',
      title: `${noLabel.length} 个输入框缺少可访问标签`,
      detail: noLabel.slice(0, 5).map((i) => i.placeholder || i.name || i.type || 'input').join(' / ')
    })
  }
  return issues
}

function asText(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v.trim() : undefined
}

function parsePlan(text: string, maxSteps: number): PlanStep[] | null {
  const match = text.match(/\{[\s\S]*\}|\[[\s\S]*\]/)
  if (!match) return null
  let data: unknown
  try {
    data = JSON.parse(match[0])
  } catch {
    return null
  }
  const raw = Array.isArray(data) ? data : (data as { steps?: unknown })?.steps
  if (!Array.isArray(raw)) return null
  const out: PlanStep[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const o = item as Record<string, unknown>
    const action = String(o.action ?? '').trim() as WebTestAction
    if (!ALLOWED.includes(action)) continue
    out.push({
      action,
      target: asText(o.target),
      text: asText(o.text),
      expect: asText(o.expect),
      note: asText(o.note)
    })
    if (out.length >= maxSteps) break
  }
  return out.length ? out : null
}

async function planSteps(
  page: PageInspectResult,
  goal: string,
  kinds: WebTestKind[],
  maxSteps: number
): Promise<PlanStep[] | null> {
  const read = await browserRead()
  const elements = (read.items ?? [])
    .slice(0, 60)
    .map((it) => `${it.tag}｜${it.text.slice(0, 40)}｜${it.selector}`)
    .join('\n')
  const headings = (page.headings ?? []).map((h) => `${h.tag}: ${h.text}`).join('\n')
  const labels = kinds.map((k) => (k === 'flow' ? '核心流程回归' : k === 'form' ? '表单与边界值' : '页面巡检')).join('、')
  const prompt = [
    '为下面的页面设计可执行测试步骤，覆盖：' + labels,
    `页面标题：${page.title || '(空)'}  地址：${page.url || read.url || ''}`,
    headings ? `页面大标题：\n${headings}` : '',
    elements ? `可交互元素（标签｜文案｜选择器）：\n${elements}` : '',
    `测试目标：${goal}`,
    '',
    '约束：',
    `1. 最多 ${maxSteps} 步，只使用动作 goto / click / fill / assert / screenshot / wait`,
    '2. click 的 target 优先用上面的选择器，没有选择器时用页面上的精确文案',
    '3. fill 的 target 必须是选择器，text 用合理测试数据（如 test@example.com、边界值 200 字）',
    '4. assert 的 expect 用 url:片段 / text:文案 / element:选择器',
    '5. 不要设计删除、支付、真实下单等不可逆操作',
    '6. 每步给 note 说明意图',
    '只输出 JSON：{"steps":[{"action":"click","target":"...","note":"..."}]}'
  ]
    .filter(Boolean)
    .join('\n')
  const reply = await llmChat(
    [
      { role: 'system', content: '你是资深 Web 测试工程师，只输出 JSON，不要解释。' },
      { role: 'user', content: prompt }
    ],
    60000,
    'complex'
  )
  return reply ? parsePlan(reply, maxSteps) : null
}

async function checkExpect(expectRaw: string): Promise<{ ok: boolean; detail: string }> {
  const exp = expectRaw.trim()
  if (!exp) return { ok: false, detail: '断言为空' }
  if (exp.startsWith('url:')) {
    const want = exp.slice(4).trim()
    const st = await browserState()
    return { ok: st.url.includes(want), detail: `当前 url=${st.url}` }
  }
  if (exp.startsWith('element:')) {
    const want = exp.slice(8).trim()
    const read = await browserRead()
    const hit = (read.items ?? []).some((it) => it.selector === want || it.selector.includes(want) || it.text.includes(want))
    return { ok: hit, detail: hit ? `找到元素 ${want}` : `未找到元素 ${want}` }
  }
  const want = exp.startsWith('text:') ? exp.slice(5).trim() : exp
  const read = await browserRead()
  const hit = (read.text ?? '').includes(want) || (read.items ?? []).some((it) => it.text.includes(want))
  return { ok: hit, detail: hit ? `页面包含「${want}」` : `页面未包含「${want}」` }
}

async function summarize(report: WebTestReport, page: PageInspectResult): Promise<string | undefined> {
  const evidence = {
    page: {
      title: page.title,
      url: page.url,
      textLen: page.textLen,
      brokenImages: page.images?.broken.length ?? 0,
      consoleErrors: (page.consoleErrors ?? []).slice(0, 5).map((e) => e.message)
    },
    steps: report.steps.map((s) => ({ action: s.action, target: s.target, status: s.status, detail: s.detail })),
    issues: report.issues.slice(0, 10)
  }
  const reply = await llmChat(
    [
      { role: 'system', content: '你是资深 Web 测试工程师，用中文给结论，最多 3 句，直接说人话。' },
      {
        role: 'user',
        content: `根据测试证据总结：整体结论、最严重问题、下一步建议。证据：${JSON.stringify(evidence).slice(0, 4000)}`
      }
    ],
    30000
  )
  return reply?.trim() || undefined
}

export async function runWebTest(input: WebTestInput): Promise<WebTestReport> {
  if (running) throw new Error('已有测试正在运行，请等它结束')
  const url = normalizeUrl(String(input.url ?? ''))
  if (!url) throw new Error('地址无效：只支持 http / https')
  const goal = String(input.goal ?? '').trim()
  const kinds = (
    Array.isArray(input.kinds) && input.kinds.length ? input.kinds : (['flow', 'inspect', 'form'] as WebTestKind[])
  ).filter((k): k is WebTestKind => k === 'flow' || k === 'inspect' || k === 'form')
  const maxSteps = Math.min(15, Math.max(3, Number(input.maxSteps) || 8))
  const id = genId('wt')
  const startedAt = Date.now()
  const steps: WebTestStep[] = []
  const issues: WebTestIssue[] = []
  const screenshots: string[] = []

  const capture = async (tag: string): Promise<string | null> => {
    try {
      const shot = await browserScreenshot()
      if (!shot.ok || !shot.dataUrl) return null
      const dir = path.join(app.getPath('userData'), 'webtest', 'shots')
      fs.mkdirSync(dir, { recursive: true })
      const file = path.join(dir, `${id}-${tag}.png`)
      fs.writeFileSync(file, Buffer.from(shot.dataUrl.split(',')[1] ?? '', 'base64'))
      screenshots.push(file)
      return file
    } catch {
      return null
    }
  }

  const runStep = async (plan: PlanStep, index: number): Promise<WebTestStep> => {
    const started = Date.now()
    const step: WebTestStep = {
      index,
      action: plan.action,
      target: plan.target,
      text: plan.text,
      expect: plan.expect,
      note: plan.note,
      status: 'pass',
      durationMs: 0
    }
    try {
      if (plan.action === 'goto') {
        if (!plan.target) throw new Error('缺少地址')
        const r = await browserNavigate(plan.target)
        if (!r.ok) throw new Error(r.error ?? '打开失败')
        step.detail = r.detail
        await sleep(900)
      } else if (plan.action === 'click') {
        if (!plan.target) throw new Error('缺少点击目标')
        const r = await browserClick(plan.target)
        if (!r.ok) throw new Error(r.error ?? '点击失败')
        step.detail = r.detail
        await sleep(700)
      } else if (plan.action === 'fill') {
        if (!plan.target) throw new Error('缺少选择器')
        const r = await browserFill(plan.target, plan.text ?? '')
        if (!r.ok) throw new Error(r.error ?? '填写失败')
        step.detail = r.detail
        await sleep(200)
      } else if (plan.action === 'assert') {
        const r = await checkExpect(plan.expect ?? '')
        step.detail = r.detail
        if (!r.ok) throw new Error(r.detail)
      } else if (plan.action === 'wait') {
        const ms = Math.min(5000, Math.max(200, Number(plan.text) || 800))
        await sleep(ms)
        step.detail = `等待 ${ms}ms`
      } else if (plan.action === 'screenshot') {
        step.shot = (await capture(`step-${index}`)) ?? undefined
        step.detail = '截图已保存'
      }
    } catch (e) {
      step.status = 'fail'
      step.detail = (e as Error).message
      step.shot = (await capture(`fail-${index}`)) ?? undefined
    }
    step.durationMs = Date.now() - started
    return step
  }

  running = true
  try {
    emit({ phase: 'navigate', message: `打开 ${url}` })
    const nav = await browserNavigate(url)
    if (!nav.ok) throw new Error(nav.error ?? '打开失败')
    await sleep(900)

    emit({ phase: 'inspect', message: '页面巡检…' })
    const page = await browserInspect()
    if (kinds.includes('inspect')) issues.push(...inspectIssues(page))
    else if (!page.ok) issues.push({ level: 'high', title: '页面无法巡检', detail: page.error })

    let planned: PlanStep[] = []
    if (goal && (kinds.includes('flow') || kinds.includes('form'))) {
      emit({ phase: 'plan', message: '生成测试用例…' })
      const plan = await planSteps(page, goal, kinds, maxSteps)
      if (plan) planned = plan
      else
        issues.push({
          level: 'medium',
          title: '未能生成测试步骤',
          detail: '模型不可用或输出无法解析，请在设置里检查模型配置'
        })
    } else if (kinds.includes('form') && !goal) {
      issues.push({
        level: 'low',
        title: '未填写测试目标，未执行表单交互',
        detail: '填写目标后会生成点击 / 填表 / 断言步骤'
      })
    }

    for (let i = 0; i < planned.length; i++) {
      const plan = planned[i]
      emit({
        phase: 'step',
        message: `执行 ${i + 1}/${planned.length}：${plan.action} ${plan.target ?? plan.expect ?? ''}`,
        index: i + 1,
        total: planned.length
      })
      const step = await runStep(plan, i + 1)
      steps.push(step)
      if (step.status === 'fail') {
        issues.push({ level: 'high', title: `步骤失败：${plan.note || plan.action}`, detail: step.detail, step: i + 1 })
      }
      emit({ phase: 'step', message: 'step', index: i + 1, total: planned.length, step })
      await sleep(150)
    }

    await capture('final')

    const report: WebTestReport = {
      id,
      url,
      pageTitle: page.title,
      goal,
      kinds,
      mode: getBrowserMode(),
      startedAt,
      durationMs: Date.now() - startedAt,
      steps,
      issues,
      summary: {
        pass: steps.filter((s) => s.status === 'pass').length,
        fail: steps.filter((s) => s.status === 'fail').length,
        skip: steps.filter((s) => s.status === 'skip').length
      },
      screenshots
    }
    report.conclusion = await summarize(report, page)
    const dir = path.join(app.getPath('userData'), 'webtest')
    fs.mkdirSync(dir, { recursive: true })
    report.reportPath = path.join(dir, `${id}.json`)
    fs.writeFileSync(report.reportPath, JSON.stringify(report, null, 2))
    lastReport = report
    emit({ phase: 'done', message: '测试完成', report })
    return report
  } catch (e) {
    const message = (e as Error).message
    issues.push({ level: 'high', title: '测试中断', detail: message })
    const report: WebTestReport = {
      id,
      url,
      goal,
      kinds,
      mode: getBrowserMode(),
      startedAt,
      durationMs: Date.now() - startedAt,
      steps,
      issues,
      summary: { pass: 0, fail: 0, skip: 0 },
      screenshots
    }
    lastReport = report
    emit({ phase: 'error', message, report })
    return report
  } finally {
    running = false
  }
}
