/**
 * Super Agent 最小垂直闭环
 * Supervisor 负责拆解与汇总；一级 Subagent 仅执行白名单只读任务。
 * 不递归派生，最多 3 个并发任务、2 次模型轮次；任何子任务失败都隔离降级。
 */
import type {
  GoalDayState, KnowledgeItem, LifeGoal, PlanItem, Project, ProjectTask, QAMessage
} from '@shared/types'
import { genId } from '@shared/types'
import { buildMergedTrail, dateKey } from '@shared/trail'
import { WORK_LIKE_STATES } from '@shared/stateMeta'
import { clipText, extractTraceKeywords, summarizeArgs } from '@shared/trace'
import {
  SUPER_AGENT_LIMITS,
  superAgentLabel,
  webOnlyUrlQuestion,
  type SuperAgentCitation,
  type SuperAgentKind,
  type SuperAgentRunResult,
  type SuperAgentTask,
  type SuperAgentTaskResult
} from '@shared/superAgent'
import { col, insertInto, listActivities } from './db'
import { search as searchMemory, type MemoryHit } from './memory'
import { getIntelState, listBookmarkSites, listBookmarkSources, readIntelPage } from './intel'
import { extractJson, llmChat, selectModel } from './ai'
import { buildOrchestrationRecommendations } from './recommendations'
import { beginRound, endTrace, markRoute, recordToolCall, setOutput, startTrace } from './trace'

interface SubagentOutput {
  summary: string
  citations: SuperAgentCitation[]
}

const DAY_MS = 86_400_000

function heuristicTasks(question: string): SuperAgentTask[] {
  const tasks: SuperAgentTask[] = []
  if (/目标|计划|项目|轨迹|今日|今天|专注|效率|工作统计|时间安排/.test(question)) {
    tasks.push({ agent: 'data', query: '读取目标、近期计划、项目与今日轨迹，提取和原问题相关的事实' })
  }
  if (/知识库|记忆|资料|文档|笔记|引用|沉淀/.test(question)) {
    tasks.push({ agent: 'knowledge', query: question })
  }
  if (/网页|网址|链接|收藏|书签|情报|抓取|https?:\/\//i.test(question)) {
    tasks.push({ agent: 'web', query: question })
  }
  if (!tasks.length) tasks.push({ agent: 'data', query: question })
  return tasks.slice(0, SUPER_AGENT_LIMITS.maxTasks)
}

function validTasks(value: unknown, fallback: SuperAgentTask[]): SuperAgentTask[] {
  const raw = (value as { tasks?: unknown } | null)?.tasks
  if (!Array.isArray(raw)) return fallback
  const out: SuperAgentTask[] = []
  const used = new Set<SuperAgentKind>()
  for (const item of raw) {
    const rec = item as { agent?: unknown; query?: unknown }
    const agent = rec.agent
    if (agent !== 'data' && agent !== 'knowledge' && agent !== 'web') continue
    if (used.has(agent)) continue
    const query = String(rec.query ?? '').trim().slice(0, SUPER_AGENT_LIMITS.maxQueryChars)
    if (!query) continue
    used.add(agent)
    out.push({ agent, query })
    if (out.length >= SUPER_AGENT_LIMITS.maxTasks) break
  }
  return out.length ? out : fallback
}

async function planTasks(question: string, deadline: number): Promise<{ tasks: SuperAgentTask[]; llm: boolean }> {
  const fallback = heuristicTasks(question)
  const webOnly = webOnlyUrlQuestion(question)
  const timeout = Math.min(SUPER_AGENT_LIMITS.plannerMs, Math.max(1, deadline - Date.now()))
  if (timeout <= 1) return { tasks: webOnly ? fallback.filter((t) => t.agent === 'web') : fallback, llm: false }
  const raw = await llmChat([
    {
      role: 'system',
      content: webOnly
        ? `你是 WorkOn 主 Agent（Supervisor）。用户只给了一个网页地址，只允许安排一个 web（网页/收藏/情报）只读任务。不要调用 data 或 knowledge，不要安排写操作。只输出 JSON：{"tasks":[{"agent":"web","query":"具体只读抓取任务"}]}。`
        : `你是 WorkOn 主 Agent（Supervisor）。把开放型只读问题拆给一级 Subagent，只允许 data（目标/计划/项目/轨迹）、knowledge（知识库/记忆/引用）、web（网页/收藏/情报）。不要调用其他 Agent，不要安排写操作。最多 3 个任务，每个 agent 最多一次。只输出 JSON：{"tasks":[{"agent":"data","query":"具体只读任务"}]}。`
    },
    { role: 'user', content: question.slice(0, 4000) }
  ], timeout, 'fast')
  if (!raw) return { tasks: webOnly ? fallback.filter((t) => t.agent === 'web') : fallback, llm: false }
  let selected = validTasks(extractJson<unknown>(raw), fallback)
  if (webOnly) {
    selected = selected.filter((t) => t.agent === 'web')
    if (!selected.length) selected = [{ agent: 'web', query: question }]
  }
  const tasks = [...selected]
  // 模型可以细化任务，但不能漏掉用户在原问题中明确点名的数据域；纯网址问题不补无关本地数据。
  if (!webOnly) {
    for (const task of fallback) {
      if (tasks.length >= SUPER_AGENT_LIMITS.maxTasks) break
      if (!tasks.some((t) => t.agent === task.agent)) tasks.push(task)
    }
  }
  return { tasks, llm: true }
}

async function dataAgent(): Promise<SubagentOutput> {
  const today = dateKey(Date.now())
  const activities = listActivities(today)
  const trail = buildMergedTrail(activities, today)
  const workMin = WORK_LIKE_STATES.reduce((sum, key) => sum + (trail.stateMinutes[key] ?? 0), 0)
  const goals = col<LifeGoal>('lifeGoals').filter((g) => g.status === 'active').slice(0, 6)
  const goalDays = col<GoalDayState>('goalDayStates')
  const plans = col<PlanItem>('plans')
    .filter((p) => !p.archived && p.date >= today && p.date <= dateKey(Date.now() + 7 * DAY_MS))
    .sort((a, b) => a.date.localeCompare(b.date) || (a.startMin ?? 9999) - (b.startMin ?? 9999))
    .slice(0, 12)
  const tasks = col<ProjectTask>('projectTasks')
  const projects = col<Project>('projects').filter((p) => p.status !== 'archived').slice(0, 8)
  const citations: SuperAgentCitation[] = [
    ...goals.map((g) => ({ source: 'goal', ref: g.id, title: g.event })),
    ...plans.map((p) => ({ source: 'plan', ref: p.id, title: p.title })),
    ...projects.map((p) => ({ source: 'project', ref: p.id, title: p.name }))
  ]
  const lines = [
    `今日轨迹：墙钟 ${Math.round(trail.totalMin)} 分钟，工作 ${Math.round(workMin)} 分钟，${trail.segments.length} 个片段。`,
    `目标 ${goals.length} 个：${goals.map((g) => {
      const invested = goalDays.filter((d) => d.goalId === g.id).reduce((sum, d) => sum + d.investedMin, 0)
      return `「${g.event}」（截止 ${g.deadline}，已归因 ${Math.round(invested)} 分钟）`
    }).join('；') || '无'}`,
    `近 7 天计划 ${plans.length} 条：${plans.map((p) => `${p.date}「${p.title}」(${p.status})`).join('；') || '无'}`,
    `项目 ${projects.length} 个：${projects.map((p) => `「${p.name}」(${p.status}，${tasks.filter((t) => t.projectId === p.id).length} 项任务)`).join('；') || '无'}`
  ]
  return { summary: lines.join('\n'), citations }
}

async function knowledgeAgent(query: string): Promise<SubagentOutput> {
  const variants = [...new Set([query, ...extractTraceKeywords(query)].map((q) => q.trim()).filter((q) => q.length >= 2))].slice(0, 4)
  const byKey = new Map<string, MemoryHit>()
  for (const q of variants) {
    const hits = [
      ...searchMemory(q, { start: 0, limit: 8, sources: ['file'] }),
      ...searchMemory(q, { start: Date.now() - 89 * DAY_MS, limit: 8, sources: ['note'] })
    ]
    for (const hit of hits) byKey.set(`${hit.source}:${hit.ref}:${hit.text}`, hit)
    if (byKey.size >= 8) break
  }
  const hits = [...byKey.values()].sort((a, b) => b.score - a.score || b.ts - a.ts).slice(0, 8)
  const knowledgeCount = col<KnowledgeItem>('knowledge').length
  if (!hits.length) {
    return {
      summary: `本地知识库共 ${knowledgeCount} 条；用原任务及 ${Math.max(0, variants.length - 1)} 个关键词检索，未找到可引用内容。`,
      citations: []
    }
  }
  return {
    summary: hits.map((h, i) => `[知识${i + 1}] ${h.text}（来源 ${h.source}，引用 ${h.ref}）`).join('\n'),
    citations: hits.map((h, i) => ({ source: h.source, ref: h.ref, title: `知识${i + 1}` }))
  }
}

function explicitUrl(text: string): string | null {
  const raw = /https?:\/\/[^\s<>"'）】]+/i.exec(text)?.[0].replace(/[，。；,.;]+$/, '')
  if (!raw) return null
  try {
    const url = new URL(raw)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null
  } catch {
    return null
  }
}

async function webAgent(query: string): Promise<SubagentOutput> {
  const url = explicitUrl(query)
  if (url) {
    const page = await readIntelPage(url)
    return {
      summary: `已只读抓取「${page.title || page.url}」：\n${clipText(page.text, 3500)}\n来源：${page.url}`,
      citations: [{ source: 'web', ref: page.url, title: page.title, url: page.url }]
    }
  }

  const state = getIntelState()
  const keywords = extractTraceKeywords(query).filter((k) => !/网页|收藏|书签|情报|抓取/.test(k))
  const matched = state.items.filter((item) => {
    if (!keywords.length) return true
    const blob = `${item.title} ${item.summary} ${item.tags.join(' ')}`.toLowerCase()
    return keywords.some((k) => blob.includes(k.toLowerCase()))
  }).slice(0, 6)
  const lines = [
    `本地情报 ${state.items.length} 条，关注站点 ${state.watch.length} 个；本次未写情报库。`,
    ...matched.map((item) => `「${item.title}」${item.summary || item.excerpt || '（无摘要）'} 来源：${item.url}`)
  ]
  const citations: SuperAgentCitation[] = matched.map((item) => ({ source: 'intel', ref: item.id, title: item.title, url: item.url }))

  if (/收藏|书签/.test(query)) {
    const bookmarks = listBookmarkSources().filter((s) => s.exists).slice(0, 2)
      .flatMap((s) => listBookmarkSites(s.id, 200))
      .filter((b) => !keywords.length || keywords.some((k) => `${b.title} ${b.url}`.toLowerCase().includes(k.toLowerCase())))
      .slice(0, 6)
    lines.push(`匹配收藏 ${bookmarks.length} 条：${bookmarks.map((b) => `「${b.title}」${b.url}`).join('；') || '无'}`)
    citations.push(...bookmarks.map((b) => ({ source: 'bookmark', ref: b.id, title: b.title, url: b.url })))
  }
  if (!matched.length && citations.length === 0) lines.push('没有匹配的既有情报；未擅自联网搜索，可提供网址后只读抓取。')
  return { summary: lines.join('\n'), citations }
}

function runSubagent(task: SuperAgentTask): Promise<SubagentOutput> {
  if (task.agent === 'data') return dataAgent()
  if (task.agent === 'knowledge') return knowledgeAgent(task.query)
  return webAgent(task.query)
}

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`超过 ${Math.round(ms / 1000)} 秒执行上限`)), Math.max(1, ms))
  })
  try {
    return await Promise.race([promise, timeout])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

async function executeTask(task: SuperAgentTask, traceId: string, deadline: number): Promise<SuperAgentTaskResult> {
  const started = Date.now()
  let output: SubagentOutput = { summary: '', citations: [] }
  let error: string | undefined
  let attempts = 0
  // 本地确定性任务不重试；网页明确失败可补一次，超时不叠加并发请求。
  for (let attempt = 1; attempt <= (task.agent === 'web' ? 2 : 1); attempt++) {
    attempts = attempt
    const remaining = Math.min(SUPER_AGENT_LIMITS.subagentMs, Math.max(1, deadline - Date.now()))
    if (Date.now() >= deadline) {
      error = '已达到本轮总预算'
      break
    }
    try {
      output = await withTimeout(runSubagent(task), remaining)
      error = undefined
      break
    } catch (e) {
      error = (e as Error).message
      if (/超过 .* 秒执行上限/.test(error)) break
    }
  }
  const ms = Date.now() - started
  const ok = !error
  const summary = ok ? output.summary : ''
  recordToolCall(traceId, {
    name: `agent:${task.agent}`,
    args: summarizeArgs(`agent:${task.agent}`, { query: task.query, attempts }),
    ok,
    ms,
    resultPreview: clipText(summary || error || '无结果'),
    error,
    executor: { kind: 'subagent', id: task.agent, label: superAgentLabel(task.agent), parentId: 'supervisor' }
  })
  return { ...task, ok, ms, summary, error, citations: output.citations }
}

function fallbackAnswer(results: SuperAgentTaskResult[]): string {
  const sections = results.map((r) => `【${superAgentLabel(r.agent)}】\n${r.ok ? r.summary : `执行失败：${r.error ?? '未知错误'}`}`)
  const refs = results.flatMap((r) => r.citations).slice(0, 10)
  return [
    '主 Agent 已完成只读汇总：',
    ...sections,
    refs.length ? `来源：${refs.map((r) => r.title ? `${r.title}（${r.url ?? r.ref}）` : (r.url ?? r.ref)).join('；')}` : '',
    '以上创建、修改或入库动作均未执行；如需落地，请在对应确认卡中确认。'
  ].filter(Boolean).join('\n\n')
}

export async function runSuperAgent(question: string): Promise<SuperAgentRunResult> {
  const q = String(question ?? '').trim().slice(0, 4000)
  if (!q) throw new Error('问题不能为空')
  insertInto<QAMessage>('qa', { id: genId('qa'), role: 'user', content: q, ts: Date.now() })
  const traceId = startTrace('qa', q)
  markRoute(traceId, 'llm', 'super_agent', 'super_agent')
  const deadline = Date.now() + SUPER_AGENT_LIMITS.totalMs
  let results: SuperAgentTaskResult[] = []
  let answer = ''
  let fallback = false
  try {
    beginRound(traceId, 0, `Supervisor · ${selectModel('fast')}`)
    const plan = await planTasks(q, deadline)
    markRoute(traceId, 'llm', plan.llm ? 'super_agent_llm_planner' : 'super_agent_rule_planner')
    results = await Promise.all(plan.tasks.map((task) => executeTask(task, traceId, deadline)))

    beginRound(traceId, 1, `Supervisor 汇总 · ${selectModel('standard')}`)
    const context = results.map((r) => ({
      executor: superAgentLabel(r.agent), ok: r.ok, error: r.error,
      output: clipText(r.summary, SUPER_AGENT_LIMITS.maxContextChars), citations: r.citations
    }))
    const remaining = Math.min(SUPER_AGENT_LIMITS.synthesisMs, Math.max(1, deadline - Date.now()))
    const llm = Date.now() < deadline && results.some((r) => r.ok)
      ? await llmChat([
          {
            role: 'system',
            content: '你是 WorkOn 主 Agent，负责汇总一级 Subagent 的只读结果。只能引用 Subagent 输出中明确出现的事实，不要补充常识性判断、用途限制、技术推测或页面未出现的词；某信息没有出现就不要写。直接回答用户，保留关键来源（标题/URL/引用 id），不得声称已创建、修改、入库或执行任何写操作。子任务失败时明确说明，不补造事实。用简洁中文输出。'
          },
          { role: 'user', content: `原问题：${q}\n\nSubagent 结果：${JSON.stringify(context)}` }
        ], remaining, 'standard')
      : null
    answer = llm ?? fallbackAnswer(results)
    fallback = !llm
  } catch (e) {
    fallback = true
    answer = `主 Agent 调度失败：${(e as Error).message}\n\n${fallbackAnswer(results)}`
  }
  insertInto<QAMessage>('qa', { id: genId('qa'), role: 'assistant', content: answer, ts: Date.now() })
  setOutput(traceId, answer, { fallback })
  endTrace(traceId)
  return {
    content: answer,
    traceId,
    tasks: results,
    recommendations: buildOrchestrationRecommendations(q, results)
  }
}
