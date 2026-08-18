/**
 * 项目 AI 开发管理：项目 + 任务 + 开发时间归类 + AI 拆解
 * 数据：projects / projectTasks / projectTimeLinks（db.json）
 */
import { col, insertInto, updateIn, removeFrom } from './db'
import { genId } from '@shared/types'
import { llmChat, extractJson } from './ai'
import { getSettings } from './settings'
import { dateKey } from '@shared/trail'
import type { Project, ProjectTask, ProjectTimeLink } from '@shared/types'

const now = () => Date.now()

/* ── 项目 CRUD ── */
export function listProjects(): Project[] {
  return [...col<Project>('projects')].sort((a, b) => a.createdAt - b.createdAt)
}

export function saveProject(p: Partial<Project> & { id?: string }): Project {
  if (p.id) {
    const ex = col<Project>('projects').find((x) => x.id === p.id)
    if (ex) {
      const updated = { ...ex, ...p, updatedAt: now() }
      updateIn<Project>('projects', p.id, updated)
      return updated
    }
  }
  const proj: Project = {
    id: p.id ?? genId('proj'),
    name: p.name ?? '未命名项目',
    status: p.status ?? 'active',
    priority: p.priority ?? 'medium',
    goal: p.goal,
    color: p.color ?? '#22D3EE',
    createdAt: now(),
    updatedAt: now()
  }
  insertInto<Project>('projects', proj)
  return proj
}

export function removeProject(id: string): void {
  removeFrom('projects', id)
  // 级联删除任务与时间归类
  const tasks = col<ProjectTask>('projectTasks').filter((t) => t.projectId === id)
  tasks.forEach((t) => removeFrom('projectTasks', t.id))
  const links = col<ProjectTimeLink>('projectTimeLinks').filter((l) => l.projectId === id)
  links.forEach((l) => removeFrom('projectTimeLinks', l.id))
}

/* ── 任务 CRUD ── */
export function listTasks(projectId: string): ProjectTask[] {
  return col<ProjectTask>('projectTasks')
    .filter((t) => t.projectId === projectId)
    .sort((a, b) => a.sort - b.sort || a.createdAt - b.createdAt)
}

export function saveTask(t: Partial<ProjectTask> & { id?: string; projectId: string }): ProjectTask {
  if (t.id) {
    const ex = col<ProjectTask>('projectTasks').find((x) => x.id === t.id)
    if (ex) {
      const updated = { ...ex, ...t, updatedAt: now() }
      updateIn<ProjectTask>('projectTasks', t.id, updated)
      return updated
    }
  }
  const maxSort = col<ProjectTask>('projectTasks')
    .filter((x) => x.projectId === t.projectId)
    .reduce((m, x) => Math.max(m, x.sort ?? 0), 0)
  const task: ProjectTask = {
    id: t.id ?? genId('pt'),
    projectId: t.projectId,
    title: t.title ?? '新任务',
    status: t.status ?? 'todo',
    priority: t.priority ?? 'medium',
    estMin: t.estMin,
    actualMin: t.actualMin ?? 0,
    tags: t.tags,
    note: t.note,
    aiGenerated: t.aiGenerated,
    sort: t.sort ?? maxSort + 1,
    createdAt: now(),
    updatedAt: now()
  }
  insertInto<ProjectTask>('projectTasks', task)
  return task
}

export function removeTask(id: string): void {
  removeFrom('projectTasks', id)
}

/** 批量创建任务（AI 拆解用） */
export function createTasksBulk(projectId: string, titles: string[], priority: ProjectTask['priority'] = 'medium'): ProjectTask[] {
  return titles.filter(Boolean).map((title) => saveTask({ projectId, title: String(title).trim(), priority, aiGenerated: true }))
}

/* ── AI 拆解：需求 → 任务列表 ── */
export async function aiBreakdown(projectId: string, requirement: string): Promise<ProjectTask[]> {
  const proj = col<Project>('projects').find((p) => p.id === projectId)
  if (!proj) return []
  const s = getSettings()
  if (!s.aiEnabled || !s.aiApiKey) {
    // 未开 AI：按简单切分兜底
    const lines = requirement.split(/[\n\r]+/).map((l) => l.trim()).filter((l) => l && !/^(需求|目标|步骤|说明)[:：]/i.test(l))
    return lines.length ? createTasksBulk(projectId, lines) : []
  }
  const prompt = [
    `你是软件项目任务拆解助手。请把下面的需求拆解为可执行的开发任务清单。`,
    `项目：${proj.name}`,
    `需求：${requirement}`,
    ``,
    `要求：每个任务一句话、具体可执行、粒度适中（不要过于零碎）。只输出 JSON 数组，每个元素是任务的标题字符串，不要任何其他文字或注释。`,
    `示例输出：["搭建项目脚手架", "实现用户登录接口", "编写单元测试"]`
  ].join('\n')
  try {
    const raw = await llmChat([{ role: 'user', content: prompt }])
    if (!raw) {
      console.warn('[projects] aiBreakdown: llmChat 返回空（AI 未启用或调用失败）')
      return []
    }
    const arr = extractJson<string[]>(raw)
    if (!Array.isArray(arr)) {
      console.warn('[projects] aiBreakdown: AI 返回无法解析', String(raw).slice(0, 200))
      return []
    }
    const created = createTasksBulk(projectId, arr)
    console.log(`[projects] aiBreakdown: 生成 ${created.length} 个任务`)
    return created
  } catch (e) {
    console.warn('[projects] aiBreakdown 异常:', (e as Error).message)
    return []
  }
}

/* ── 开发时间归类 ── */
/**
 * 手动归类：把某应用当日时长归入项目。
 * 同 项目+日期+应用 覆盖更新，便于用户反复调整。
 */
export function linkAppToProject(projectId: string | null, app: string, date?: string): void {
  const d = date ?? dateKey(Date.now())
  const key = app.trim().toLowerCase().replace(/\.exe$/i, '')
  const links = col<ProjectTimeLink>('projectTimeLinks')
  const ex = links.find((l) => l.projectId === projectId && l.date === d && l.app === key)
  if (projectId == null) {
    // 解除归类
    const match = links.find((l) => l.date === d && l.app === key)
    if (match) removeFrom('projectTimeLinks', match.id)
    return
  }
  if (ex) return
  insertInto<ProjectTimeLink>('projectTimeLinks', {
    id: genId('ptl'),
    projectId,
    date: d,
    app: key,
    min: 0,
    source: 'manual',
    ts: now()
  })
}

/** 各项目关联应用（归类列表，实际时长由前端按当日 trail 计算） */
export function projectLinkedApps(): { projectId: string; apps: string[] }[] {
  const links = col<ProjectTimeLink>('projectTimeLinks')
  const agg = new Map<string, Set<string>>()
  for (const l of links) {
    if (!agg.has(l.projectId)) agg.set(l.projectId, new Set())
    agg.get(l.projectId)!.add(l.app)
  }
  return [...agg.entries()].map(([projectId, apps]) => ({ projectId, apps: [...apps] }))
}

/* ── 开发过程追踪聚合：某项目关联应用在某时段的真实时长 ── */
export function projectTimeForTrail(projectId: string, trail: { segments: { mainApp: string; durationMin: number; mainState: string }[] }): number {
  const apps = new Set(col<ProjectTimeLink>('projectTimeLinks').filter((l) => l.projectId === projectId).map((l) => l.app))
  let min = 0
  for (const seg of trail.segments) {
    const k = seg.mainApp.trim().toLowerCase().replace(/\.exe$/i, '')
    if (apps.has(k)) min += seg.durationMin
  }
  return min
}

/** 某项目全部分类链接（按日期+应用） */
export function projectLinks(projectId: string): ProjectTimeLink[] {
  return col<ProjectTimeLink>('projectTimeLinks').filter((l) => l.projectId === projectId)
}

/** 某日期所有应用的归类（app → projectId） */
export function dayProjectLinks(date?: string): { app: string; projectId: string }[] {
  const d = date ?? dateKey(Date.now())
  return col<ProjectTimeLink>('projectTimeLinks').filter((l) => l.date === d).map((l) => ({ app: l.app, projectId: l.projectId }))
}

/**
 * AI 任务排期：汇总各项目未完成任务 + 预估工时 + 优先级，AI 推荐今日优先安排。
 * 返回任务列表（含标题/所属项目/建议序号/理由）。未开 AI 则按时长与优先级本地排序。
 */
export async function aiSchedule(): Promise<{ taskId: string; title: string; projectName: string; priority: ProjectTask['priority']; estMin: number; reason: string }[]> {
  const projects = listProjects()
  const tasks = col<ProjectTask>('projectTasks').filter((t) => t.status !== 'done')
  const items = tasks.map((t) => {
    const proj = projects.find((p) => p.id === t.projectId)
    return {
      taskId: t.id,
      title: t.title,
      projectName: proj?.name ?? '未分组',
      priority: t.priority,
      estMin: t.estMin ?? 0
    }
  })
  if (items.length === 0) return []
  const s = getSettings()
  if (!s.aiEnabled || !s.aiApiKey) {
    // 未开 AI：按优先级（high>medium>low）+ 预估时长升序
    const rank = { high: 0, medium: 1, low: 2 }
    return items
      .sort((a, b) => (rank[a.priority] ?? 1) - (rank[b.priority] ?? 1) || (a.estMin || 0) - (b.estMin || 0))
      .map((it, i) => ({ ...it, reason: `优先级 ${it.priority}${it.estMin ? ` · 预估 ${Math.round(it.estMin / 60)}h` : ''}` }))
  }
  const prompt = [
    `你是开发任务排期助手。下面是今日各项目的待办开发任务，请为它们排出合理的执行顺序（考虑优先级、预估工时、项目集中度，尽量同项目连做）。`,
    items.map((it) => `- [${it.priority}] ${it.title}（项目：${it.projectName}${it.estMin ? `，预估 ${Math.round(it.estMin / 60)}h` : ''}）`).join('\n'),
    ``,
    `只输出 JSON 数组，每个元素是 { "taskId": 任务id, "reason": "一句话理由" }，按建议执行顺序排列。不要任何其他文字。`
  ].join('\n')
  try {
    const raw = await llmChat([{ role: 'user', content: prompt }])
    if (!raw) return []
    const order = extractJson<{ taskId: string; reason: string }[]>(raw)
    if (!Array.isArray(order)) return []
    const byId = new Map(items.map((it) => [it.taskId, it]))
    return order
      .map((o) => {
        const it = byId.get(o.taskId)
        return it ? { ...it, reason: o.reason || 'AI 建议优先' } : null
      })
      .filter((x): x is { taskId: string; title: string; projectName: string; priority: ProjectTask['priority']; estMin: number; reason: string } => !!x)
  } catch {
    return []
  }
}

/**
 * AI 项目复盘：汇总项目任务完成情况 + 开发时长，AI 生成复盘与改进建议。
 */
export async function aiReview(projectId: string, trailMinutes: number): Promise<{ text: string; ok: boolean }> {
  const proj = col<Project>('projects').find((p) => p.id === projectId)
  if (!proj) return { text: '', ok: false }
  const ts = listTasks(projectId)
  const done = ts.filter((t) => t.status === 'done')
  const pending = ts.filter((t) => t.status !== 'done')
  const s = getSettings()
  if (!s.aiEnabled || !s.aiApiKey) {
    // 未开 AI：本地汇总
    return {
      text: `项目「${proj.name}」：共 ${ts.length} 个任务，已完成 ${done.length}（${ts.length ? Math.round((done.length / ts.length) * 100) : 0}%）。本项目累计投入约 ${Math.round(trailMinutes / 60)}h。`,
      ok: true
    }
  }
  const prompt = [
    `你是开发复盘助手。基于以下项目信息生成简短复盘（3-5 条要点，含做了什么、耗时、效率、下一步建议）。`,
    `项目：${proj.name}`,
    `目标：${proj.goal || '（未填写）'}`,
    `累计投入：约 ${Math.round(trailMinutes / 60)}h`,
    `任务（${ts.length} 个）：已完成 ${done.map((t) => t.title).join('、') || '无'}；待办 ${pending.map((t) => t.title).join('、') || '无'}`,
    ``,
    `用简洁中文，分点输出。`
  ].join('\n')
  try {
    const raw = await llmChat([{ role: 'user', content: prompt }])
    if (!raw) return { text: '', ok: false }
    return { text: raw, ok: true }
  } catch {
    return { text: '', ok: false }
  }
}

/**
 * AI 实时建议：结合当前开发项目 + 连续开发时长 + 待办任务，生成一条针对性建议。
 * 由监控侧在检测到 AI 开发场景时调用（非阻塞）。未开 AI 返回本地规则建议。
 */
export async function aiDevAdvice(ctx: { currentApp: string; devMin: number; state: string }): Promise<{ text: string } | null> {
  const projects = listProjects()
  const active = projects.find((p) => p.status === 'active')
  const tasks = active ? col<ProjectTask>('projectTasks').filter((t) => t.projectId === active.id && t.status !== 'done') : []
  const rank = { high: 0, medium: 1, low: 2 }
  const topTask = tasks.sort((a, b) => (rank[a.priority] ?? 1) - (rank[b.priority] ?? 1))[0]
  const s = getSettings()
  const local = () => {
    if (ctx.devMin >= 60) return { text: `已连续开发 ${Math.round(ctx.devMin)} 分钟，休息一下让思路更清晰吧 ~` }
    if (topTask) return { text: `手头在做「${active?.name}」，接下来可以考虑继续 ${topTask.title}。` }
    return null
  }
  if (!s.aiEnabled || !s.aiApiKey) return local()
  const prompt = [
    `你是 WorkOn 的开发陪伴助手，根据用户当前状态给一条简短、温暖的实时建议（一句话）。`,
    `当前应用：${ctx.currentApp}（状态 ${ctx.state}）`,
    `连续开发：约 ${Math.round(ctx.devMin)} 分钟`,
    `活跃项目：${active?.name ?? '无'}${topTask ? `，下一个待办：${topTask.title}` : ''}`,
    `用一句话中文输出，不要解释。`
  ].join('\n')
  try {
    const raw = await llmChat([{ role: 'user', content: prompt }], 15000)
    return raw ? { text: raw.trim() } : local()
  } catch {
    return local()
  }
}
