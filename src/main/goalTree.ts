/**
 * 目标树闭环：一句话 → 路径/里程碑/本周块 → 整树确认后一次落库。
 * 拆解只生成草案；applyGoalTree 是唯一写库入口，失败时回滚本次新增记录。
 */
import { genId } from '@shared/types'
import type {
  GoalDayState, GoalTreeApplyResult, GoalTreeDraft, LifeGoal, MilestoneDraft, PathDraft,
  PlanItem, Project, WeekBlockDraft
} from '@shared/types'
import { dateKey } from '@shared/trail'
import { col, insertInto, removeFrom } from './db'
import { createGoal, parseDeadline } from './lifeGoal'
import { extractJson, llmChat } from './ai'
import { broadcast } from './windows'

const DAY_MS = 86_400_000

function fmtDate(ts: number): string {
  return dateKey(ts)
}

function validDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  return !Number.isNaN(new Date(`${value}T12:00:00`).getTime())
}

function addDays(date: string, days: number): string {
  return fmtDate(new Date(`${date}T12:00:00`).getTime() + days * DAY_MS)
}

function daysBetween(from: string, to: string): number {
  return Math.round((new Date(`${to}T12:00:00`).getTime() - new Date(`${from}T12:00:00`).getTime()) / DAY_MS)
}

function clampDate(date: string, min: string, max: string): string {
  if (!validDate(date) || date < min) return min
  return date > max ? max : date
}

function text(value: unknown, max: number): string {
  return String(value ?? '').trim().slice(0, max)
}

function existingProjectId(name: string): string | undefined {
  const lower = name.trim().toLowerCase()
  return col<Project>('projects').find((p) =>
    p.status !== 'archived' && p.status !== 'done' && p.name.trim().toLowerCase() === lower
  )?.id
}

/** 所有日期和时间都在主进程重新归一，不能信任模型或渲染端原值。 */
function normalizeTree(raw: Partial<GoalTreeDraft>, sourceText: string, deadlineOverride?: string): GoalTreeDraft | null {
  const deadline = parseDeadline(deadlineOverride ?? sourceText)
  if (!deadline) return null
  const today = dateKey(Date.now())
  if (deadline <= today) return null
  const rawPaths = Array.isArray(raw.paths) ? raw.paths : []
  const paths: PathDraft[] = rawPaths.slice(0, 3).map((p, pi) => {
    const path = (p ?? {}) as Partial<PathDraft>
    const milestones = (Array.isArray(path.milestones) ? path.milestones : []).slice(0, 3).map((m, mi) => {
      const item = (m ?? {}) as Partial<MilestoneDraft>
      const projectName = text(item.projectName, 40) || text(path.title, 40)
      const bound = text(item.bindProjectId, 80)
      const boundExists = bound && col<Project>('projects').some((x) => x.id === bound)
      return {
        id: text(item.id, 80) || genId('gm'),
        title: text(item.title, 40) || `里程碑 ${mi + 1}`,
        targetDate: clampDate(String(item.targetDate ?? ''), addDays(today, 1), deadline),
        deliverables: (Array.isArray(item.deliverables) ? item.deliverables : []).map((x) => text(x, 60)).filter(Boolean).slice(0, 3),
        projectName,
        bindProjectId: boundExists ? bound : existingProjectId(projectName)
      }
    }).filter((m) => m.title)
    return {
      id: text(path.id, 80) || genId('gp'),
      title: text(path.title, 40) || `路径 ${pi + 1}`,
      weight: Math.max(0, Math.min(1, Number(path.weight) || 0)),
      rationale: text(path.rationale, 100),
      skills: (Array.isArray(path.skills) ? path.skills : []).map((x) => text(x, 30)).filter(Boolean).slice(0, 4),
      milestones
    }
  }).filter((p) => p.title && p.milestones.length > 0)
  if (paths.length < 2) return null

  // 按层保留，全局最多 8 个；顺序裁剪会把最后一条路径掏空。
  const kept = paths.map((): MilestoneDraft[] => [])
  let remaining = 8
  for (let level = 0; level < 3 && remaining > 0; level += 1) {
    for (let pi = 0; pi < paths.length && remaining > 0; pi += 1) {
      const milestone = paths[pi].milestones[level]
      if (milestone) {
        kept[pi].push(milestone)
        remaining -= 1
      }
    }
  }
  paths.forEach((p, i) => { p.milestones = kept[i] })
  const weightSum = paths.reduce((sum, p) => sum + p.weight, 0)
  paths.forEach((p) => { p.weight = Math.round((weightSum > 0 ? p.weight / weightSum : 1 / paths.length) * 100) / 100 })

  const allMilestones = paths.flatMap((p) => p.milestones)
  const milestoneIds = new Set(allMilestones.map((m) => m.id))
  const rawBlocks = Array.isArray(raw.weekBlocks) ? raw.weekBlocks : []
  const weekBlocks: WeekBlockDraft[] = rawBlocks.slice(0, 5).map((b, i) => {
    const block = (b ?? {}) as Partial<WeekBlockDraft>
    const durationMin = Math.max(25, Math.min(180, Math.round(Number(block.durationMin) || 60)))
    const startMin = Math.max(0, Math.min(1439 - durationMin, Math.round(Number(block.startMin) || 20 * 60)))
    const milestoneId = milestoneIds.has(String(block.milestoneId)) ? String(block.milestoneId) : allMilestones[0].id
    return {
      date: clampDate(String(block.date ?? ''), today, addDays(today, 6)),
      startMin,
      durationMin,
      title: text(block.title, 50) || `推进「${paths[0].title}」`,
      milestoneId
    }
  })
  for (let i = weekBlocks.length; i < 3; i += 1) {
    const milestone = allMilestones[i % allMilestones.length]
    weekBlocks.push({
      date: addDays(today, Math.min(i * 2, 6)), startMin: 20 * 60, durationMin: 60,
      title: `推进：${milestone.title}`, milestoneId: milestone.id
    })
  }

  const event = text(raw.event, 60) || sourceText.replace(/^(我|俺)?\s*(想|要|打算|希望|计划|目标(是|为)?|争取)\s*/g, '').slice(0, 60)
  return {
    event,
    deadline,
    dailyTargetMin: Math.max(30, Math.min(240, Math.round(Number(raw.dailyTargetMin) || 90))),
    keywords: (Array.isArray(raw.keywords) ? raw.keywords : []).map((k) => text(k, 20)).filter(Boolean).slice(0, 6),
    paths,
    source: raw.source === 'ai' ? 'ai' : 'local',
    confidence: Math.max(0, Math.min(1, Number(raw.confidence) || 0)),
    weekBlocks: scheduleBlocks(weekBlocks)
  }
}

/** 第一块优先落在今天下一个空档；21 点后顺延到明天上午。 */
function scheduleBlocks(blocks: WeekBlockDraft[]): WeekBlockDraft[] {
  const now = new Date()
  const nowMin = now.getHours() * 60 + now.getMinutes()
  const late = nowMin >= 21 * 60
  const today = dateKey(Date.now())
  const scheduled: WeekBlockDraft[] = []
  for (const [i, block] of blocks.entries()) {
    const next = { ...block }
    if (i === 0) {
      next.date = late ? addDays(today, 1) : today
      next.startMin = late ? 9 * 60 : Math.max(next.startMin, Math.ceil((nowMin + 30) / 30) * 30)
    } else if (next.date === today && (late || scheduled.filter((p) => p.date === today).length >= 3)) {
      next.date = addDays(today, 1)
    }
    next.startMin = Math.min(next.startMin, 1439 - next.durationMin)
    next.startMin = avoidOverlap(next.date, next.startMin, next.durationMin, scheduled)
    scheduled.push(next)
  }
  return scheduled
}

function avoidOverlap(date: string, start: number, duration: number, scheduled: WeekBlockDraft[]): number {
  const busy = col<PlanItem>('plans')
    .filter((p) => p.date === date && !p.archived && p.status !== 'cancelled' && typeof p.startMin === 'number')
    .map((p) => ({ start: p.startMin as number, end: p.endMin ?? ((p.startMin as number) + (p.durationMin ?? 60)) }))
    .concat(scheduled.filter((p) => p.date === date).map((p) => ({ start: p.startMin, end: p.startMin + p.durationMin })))
  let candidate = start
  for (let tries = 0; tries < 20; tries += 1) {
    const hit = busy.find((b) => candidate < b.end && candidate + duration > b.start)
    if (!hit) break
    candidate = hit.end + 15
    if (candidate + duration > 1439) candidate = 8 * 60
  }
  return Math.max(0, Math.min(candidate, 1439 - duration))
}

function localTree(sourceText: string, deadline: string): GoalTreeDraft {
  const today = dateKey(Date.now())
  const days = Math.max(7, daysBetween(today, deadline))
  const event = sourceText
    .replace(/^(我|俺)?\s*(想|要|打算|希望|计划|目标(是|为)?|争取)\s*/g, '')
    .replace(/\s+/g, ' ')
    .slice(0, 60)
  const money = /赚|收入|变现|接单|营收/.test(sourceText)
  const titles = money ? ['产品与作品', '展示与获客', '交付与变现'] : ['核心训练', '实战验证', '复盘沉淀']
  const weights = [0.45, 0.35, 0.2]
  const paths: PathDraft[] = titles.map((title, i) => {
    const end = fmtDate(Date.now() + Math.max(DAY_MS, (days * (i + 1) / 3) * DAY_MS))
    return {
      id: genId('gp'), title, weight: weights[i],
      rationale: money ? ['先做出能展示的成果', '让成果被目标用户或评委看见', '把成果转成可核验收入'][i] : ['先补齐最关键的能力', '用真实结果检验投入', '把有效做法固定下来'][i],
      skills: [i === 0 ? '专项能力' : i === 1 ? '项目实践' : '结果复盘'],
      milestones: [0, 1].map((mi) => ({
        id: genId('gm'),
        title: mi === 0 ? `${title} · 第一阶段` : `${title} · 可核验交付`,
        targetDate: mi === 0 ? clampDate(fmtDate(Date.now() + days / 6 * DAY_MS), addDays(today, 1), deadline) : clampDate(end, addDays(today, 1), deadline),
        deliverables: [mi === 0 ? '一份阶段产出' : '一项可展示结果'],
        projectName: title
      }))
    }
  })
  const milestones = paths.flatMap((p) => p.milestones)
  const nowMin = new Date().getHours() * 60 + new Date().getMinutes()
  const firstDate = nowMin >= 21 * 60 ? addDays(today, 1) : today
  return {
    event, deadline, dailyTargetMin: 90,
    keywords: titles.concat(event.split(/[，。；、\s]+/).filter((x) => x.length >= 2 && x.length <= 8)).slice(0, 6),
    paths, source: 'local', confidence: 0.35,
    weekBlocks: [
      { date: firstDate, startMin: nowMin >= 21 * 60 ? 540 : Math.max(1200, Math.ceil((nowMin + 30) / 30) * 30), durationMin: 90, title: `启动：${paths[0].milestones[0].title}`, milestoneId: milestones[0].id },
      { date: addDays(firstDate, 2), startMin: 1200, durationMin: 60, title: `推进：${paths[1].milestones[0].title}`, milestoneId: paths[1].milestones[0].id },
      { date: addDays(firstDate, 4), startMin: 600, durationMin: 45, title: '复盘本周产出并排下一步', milestoneId: paths[2].milestones[0].id }
    ]
  }
}

/** AI 优先，失败/超时回退到明确标注的本地粗略版。 */
export async function decomposeGoalTree(sourceText: string, hint?: string, deadlineOverride?: string): Promise<GoalTreeDraft | null> {
  const deadline = parseDeadline(deadlineOverride ?? sourceText)
  if (!deadline) return null
  const today = dateKey(Date.now())
  const totalDays = Math.max(1, daysBetween(today, deadline))
  const system = '你是目标执行规划器。把用户目标拆成可落地、可核验的目标树，只输出 JSON，不要 Markdown。' +
    '结构：{"event":"目标","dailyTargetMin":30-240,"keywords":["行为归因词"],"paths":[{"title":"路径","weight":0.45,"rationale":"为什么","skills":["能力"],"milestones":[{"title":"里程碑","targetDate":"YYYY-MM-DD","deliverables":["可核验产出"],"projectName":"项目名"}]}],"weekBlocks":[{"date":"YYYY-MM-DD","startMin":1200,"durationMin":90,"title":"具体动作","milestoneIndex":0}]}。' +
    `今天 ${today}，截止 ${deadline}，共 ${totalDays} 天。路径 2-3 条，weight 合计 1；每条 1-3 个里程碑，总数不超过 8；` +
    'weekBlocks 3-5 块，只在今天起未来 7 天，每块 25-180 分钟；今天 1-3 块（21 点后第一块可顺延明天）；milestoneIndex 是按 paths 顺序展开后的里程碑下标（从 0 开始）。' +
    '动作必须具体到产出，禁止“努力学习”“持续推进”这类空话。'
  const raw = await llmChat([
    { role: 'system', content: system },
    { role: 'user', content: `目标：「${sourceText}」${hint ? `。调整要求：${hint}` : ''}` }
  ], 45_000, 'complex')
  const parsed = raw ? extractJson<Partial<GoalTreeDraft> & { weekBlocks?: Array<Partial<WeekBlockDraft> & { milestoneIndex?: number }> }>(raw) : null
  if (parsed?.paths?.length) {
    const aiWeekBlocks = (parsed.weekBlocks ?? []) as Array<Partial<WeekBlockDraft> & { milestoneIndex?: number }>
    const withIds: Partial<GoalTreeDraft> = {
      ...parsed,
      source: 'ai', confidence: 0.85,
      paths: parsed.paths.map((p) => ({
        ...p,
        milestones: (p.milestones ?? []).map((m) => ({ ...m, id: genId('gm') }))
      })),
      weekBlocks: []
    }
    const idFlat = withIds.paths!.flatMap((p) => p.milestones)
    withIds.weekBlocks = aiWeekBlocks.map((b, i) => ({
      date: String(b.date ?? today),
      startMin: Number(b.startMin ?? 20 * 60),
      durationMin: Number(b.durationMin ?? 60),
      title: String(b.title ?? `执行块 ${i + 1}`),
      milestoneId: idFlat[Math.max(0, Math.min(idFlat.length - 1, Number(b.milestoneIndex) || 0))]?.id ?? ''
    }))
    const normalized = normalizeTree(withIds, sourceText, deadlineOverride)
    if (normalized) return normalized
  }
  const normalized = normalizeTree(localTree(sourceText, deadline), sourceText, deadlineOverride)
  return normalized
}

/** 整树一次落库；新增集合逐项登记，异常时逆序回滚。 */
export function applyGoalTree(sourceText: string, rawDraft: GoalTreeDraft, deadlineOverride?: string): GoalTreeApplyResult {
  const draft = normalizeTree(rawDraft, sourceText, deadlineOverride)
  if (!draft) throw new Error('目标树校验失败，请重新拆解')
  const createdProjects: Project[] = []
  const createdPlans: PlanItem[] = []
  const existingGoalIds = new Set(col<LifeGoal>('lifeGoals').map((g) => g.id))
  let goal: LifeGoal | null = null
  try {
    const milestoneProject = new Map<string, string>()
    const pathProject = new Map<string, string>()
    for (const path of draft.paths) {
      const name = path.milestones[0]?.projectName || path.title
      const existing = path.milestones.find((m) => m.bindProjectId)?.bindProjectId ?? existingProjectId(name)
      let projectId = existing
      if (!projectId) {
        const now = Date.now()
        const project = insertInto<Project>('projects', {
          id: genId('proj'), name, status: 'active', priority: 'high', goal: draft.event,
          deadline: path.milestones[path.milestones.length - 1].targetDate,
          color: '#0FB5A4', createdAt: now, updatedAt: now
        })
        createdProjects.push(project)
        projectId = project.id
      }
      pathProject.set(path.id, projectId)
      for (const m of path.milestones) milestoneProject.set(m.id, projectId)
    }
    const projectIds = [...new Set(pathProject.values())]
    const totalDays = Math.max(1, daysBetween(dateKey(Date.now()), draft.deadline))
    const totalMin = totalDays * draft.dailyTargetMin
    const anchors = draft.paths.flatMap((p) => p.milestones)
      .sort((a, b) => a.targetDate.localeCompare(b.targetDate))
      .map((m) => ({
        title: m.title, targetDate: m.targetDate,
        cumTargetMin: Math.max(1, Math.round(totalMin * Math.max(1, daysBetween(dateKey(Date.now()), m.targetDate)) / totalDays))
      }))
    goal = createGoal({
      sourceText, event: draft.event, deadline: draft.deadline, dailyTargetMin: draft.dailyTargetMin,
      keywords: [...new Set([...draft.keywords, ...draft.paths.flatMap((p) => p.skills)])].slice(0, 8),
      projectIds, anchors
    })
    for (const block of draft.weekBlocks) {
      const plan = insertInto<PlanItem>('plans', {
        id: genId('plan'), date: block.date, title: block.title, category: 'other',
        startMin: block.startMin, endMin: block.startMin + block.durationMin, durationMin: block.durationMin,
        status: 'planned', source: 'goal', planType: 'phase', confirmedFromQA: true,
        note: `goalTree:${goal.id};milestone:${block.milestoneId}`,
        projectId: milestoneProject.get(block.milestoneId), linkedProjectId: milestoneProject.get(block.milestoneId), ts: Date.now()
      })
      createdPlans.push(plan)
    }
    broadcast('plan-updated')
    return {
      goalId: goal.id, projectIds, planIds: createdPlans.map((p) => p.id),
      todayCount: createdPlans.filter((p) => p.date === dateKey(Date.now())).length
    }
  } catch (error) {
    for (const p of createdPlans) removeFrom('plans', p.id)
    for (const g of col<LifeGoal>('lifeGoals').filter((x) => !existingGoalIds.has(x.id))) {
      for (const s of col<GoalDayState>('goalDayStates').filter((x) => x.goalId === g.id)) removeFrom('goalDayStates', s.id)
      removeFrom('lifeGoals', g.id)
    }
    for (const p of createdProjects) removeFrom('projects', p.id)
    broadcast('plan-updated')
    throw error
  }
}
