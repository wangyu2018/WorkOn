/**
 * 工作闭环助手（coach）
 * 监控 → 提示 → 行动 → 验证，形成真正闭环：
 *   1. 每 75s 读取 presence / 今日计划 / 项目任务，命中规则生成一条可操作提示
 *   2. 渲染层悬浮卡 + 右栏时间线展示，动作回传主进程
 *   3. 采纳「开始」后 10 分钟内用 presence 验证是否真的进入工作 → followed / missed
 *   4. 优先级：连续专注过久 > 计划到点 > 摸鱼拉回 > 项目推进 > 晚间收尾 > 手动兜底
 * 存储：userData/coach.json（保留最近 300 条）
 */
import { app, ipcMain, Notification } from 'electron'
import fs from 'fs'
import path from 'path'
import type { PlanItem, Project, ProjectTask } from '@shared/types'
import type {
  CoachActionKey,
  CoachCard,
  CoachKind,
  CoachState,
  CoachStats
} from '@shared/coach'
import { genId } from '@shared/types'
import { DEEP_WORK_STATES } from '@shared/attention'
import { buildMergedTrail, dateKey } from '@shared/trail'
import { col, listActivities, updateIn } from './db'
import { getSettings } from './settings'
import { presence } from './presence'
import { broadcast, mainWindow, sendTo } from './windows'

const TICK_MS = 75_000
const MIN_GAP_MS = 20 * 60_000
const VERIFY_MS = 10 * 60_000
const TTL_SEC = 90
const OVERWORK_SEC = 100 * 60
const SLACK_SEC = 15 * 60
const MAX_ITEMS = 300

let items: CoachCard[] = []
let snoozeUntil = 0
let lastShownAt = 0
let lastEvalAt = 0
let timer: NodeJS.Timeout | null = null

function storeFile(): string {
  return path.join(app.getPath('userData'), 'coach.json')
}

function load(): void {
  try {
    const raw = JSON.parse(fs.readFileSync(storeFile(), 'utf-8')) as {
      items?: CoachCard[]
      snoozeUntil?: number
    }
    items = Array.isArray(raw.items) ? raw.items : []
    snoozeUntil = Number(raw.snoozeUntil) || 0
  } catch {
    items = []
    snoozeUntil = 0
  }
}

function save(): void {
  try {
    items = items.slice(0, MAX_ITEMS)
    fs.mkdirSync(path.dirname(storeFile()), { recursive: true })
    fs.writeFileSync(storeFile(), JSON.stringify({ items, snoozeUntil }, null, 2), 'utf-8')
  } catch (e) {
    console.warn('[coach] 写入失败', e)
  }
}

function todayItems(): CoachCard[] {
  const today = dateKey(Date.now())
  return items.filter((c) => dateKey(c.ts) === today)
}

function statsOf(): CoachStats {
  const list = todayItems()
  const shown = list.length
  const accepted = list.filter(
    (c) => (c.status === 'accepted' || c.status === 'followed' || c.status === 'missed') && c.actionKey !== 'snooze'
  ).length
  const followed = list.filter((c) => c.status === 'followed').length
  return { shown, accepted, followed, followRate: accepted > 0 ? Math.round((followed / accepted) * 100) / 100 : 0 }
}

function stateOf(): CoachState {
  return {
    items: todayItems()
      .sort((a, b) => b.ts - a.ts)
      .slice(0, 60),
    stats: statsOf(),
    snoozeUntil
  }
}

function hhmm(min: number): string {
  return `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`
}

/** 主窗在后台时用系统通知兜底，点一下把主窗拉回来（提示不能因为窗口藏着就消失） */
function notifySystem(card: CoachCard): void {
  try {
    if (!Notification.isSupported()) return
    const win = mainWindow
    if (win && !win.isDestroyed() && win.isVisible() && !win.isMinimized()) return
    const n = new Notification({ title: card.title, body: card.body })
    n.on('click', () => {
      if (!win || win.isDestroyed()) return
      if (win.isMinimized()) win.restore()
      win.show()
      win.focus()
    })
    n.show()
  } catch {
    /* 系统通知不可用时不阻塞主流程 */
  }
}

function nowMinute(): number {
  const d = new Date()
  return d.getHours() * 60 + d.getMinutes()
}

/** 同类提示冷却：overwork 3h，slack 90min，其余当天一次 */
function kindAllowed(kind: CoachKind, now: number): boolean {
  const last = todayItems().filter((c) => c.kind === kind).sort((a, b) => b.ts - a.ts)[0]
  if (!last) return true
  const gap = kind === 'overwork' ? 3 * 3600_000 : kind === 'slack_return' ? 90 * 60_000 : 24 * 3600_000
  return now - last.ts >= gap
}

/** 今日有效工作分钟（深度工作态 + 会议） */
function todayWorkMin(): number {
  const today = dateKey(Date.now())
  const trail = buildMergedTrail(listActivities(today), today)
  let min = 0
  for (const s of [...DEEP_WORK_STATES, 'meeting' as const]) min += trail.stateMinutes[s] ?? 0
  return Math.round(min)
}

function openPlans(): PlanItem[] {
  const today = dateKey(Date.now())
  return col<PlanItem>('plans')
    .filter((p) => p.date === today && !p.archived && p.planType !== 'reminder' && p.status !== 'done' && p.status !== 'cancelled')
    .sort((a, b) => {
      if (a.status !== b.status) return a.status === 'in_progress' ? -1 : 1
      return (a.startMin ?? 1e9) - (b.startMin ?? 1e9)
    })
}

function duePlan(nowMin: number): PlanItem | null {
  const today = dateKey(Date.now())
  const list = col<PlanItem>('plans').filter(
    (p) =>
      p.date === today &&
      !p.archived &&
      p.planType !== 'reminder' &&
      p.status === 'planned' &&
      p.startMin != null &&
      nowMin - p.startMin >= 10 &&
      nowMin - p.startMin <= 180
  )
  const fresh = list.filter((p) => !items.some((c) => c.kind === 'plan_due' && c.planId === p.id && dateKey(c.ts) === today))
  return fresh.sort((a, b) => (a.startMin ?? 0) - (b.startMin ?? 0))[0] ?? null
}

function activeProjectTask(): { project: Project; task: ProjectTask } | null {
  const projects = col<Project>('projects').filter((p) => p.status === 'active')
  if (!projects.length) return null
  const tasks = col<ProjectTask>('projectTasks')
    .filter((t) => t.status === 'in_progress')
    .sort((a, b) => a.sort - b.sort)
  for (const t of tasks) {
    const p = projects.find((x) => x.id === t.projectId)
    if (p) return { project: p, task: t }
  }
  return null
}

function makeCard(input: {
  kind: CoachKind
  title: string
  body: string
  reason: string
  actions: CoachCard['actions']
  planId?: string
  projectId?: string
  prompt?: string
}): CoachCard {
  return {
    id: genId('coach'),
    kind: input.kind,
    title: input.title,
    body: input.body,
    reason: input.reason,
    ts: Date.now(),
    ttlSec: TTL_SEC,
    actions: input.actions,
    planId: input.planId,
    projectId: input.projectId,
    prompt: input.prompt,
    status: 'shown'
  }
}

/** 依据规则选一条最该出现的提示；force=true 时兜底给 check_in */
function buildCandidate(force: boolean): CoachCard | null {
  const now = Date.now()
  const snap = presence.getSnapshot()
  const nowMin = nowMinute()

  // 1. 连续专注过久：优先保护身体，即使在深度工作也要提示
  if (snap.continuousFocusSec >= OVERWORK_SEC && kindAllowed('overwork', now)) {
    const min = Math.round(snap.continuousFocusSec / 60)
    return makeCard({
      kind: 'overwork',
      title: `已经连续专注 ${min} 分钟`,
      body: '起来接杯水、看看窗外，5 分钟就够。回来我帮你把节奏接上。',
      reason: `presence 连续专注 ${min} 分钟`,
      actions: [
        { key: 'dismiss', label: '先歇 5 分钟', primary: true },
        { key: 'snooze', label: '再干 30 分钟' }
      ]
    })
  }

  // 2. 计划到点还没开始
  const due = duePlan(nowMin)
  if (due) {
    const late = nowMin - (due.startMin ?? nowMin)
    return makeCard({
      kind: 'plan_due',
      title: `「${due.title}」该开始了`,
      body: `计划 ${hhmm(due.startMin ?? nowMin)} 开始，现在 ${hhmm(nowMin)}。先做 25 分钟把节奏起起来？`,
      reason: `计划时间已过 ${late} 分钟 · 今日还有 ${openPlans().length} 项未完成`,
      planId: due.id,
      actions: [
        { key: 'start', label: '开始这 25 分钟', primary: true },
        { key: 'snooze', label: '推后 30 分钟' },
        { key: 'dismiss', label: '今天不做' }
      ]
    })
  }

  // 3. 连续摸鱼：拉回工作（必须有明确目标，不空喊）
  if (snap.continuousSlackSec >= SLACK_SEC && ['slack', 'relax', 'break', 'lunch'].includes(snap.state) && kindAllowed('slack_return', now)) {
    const min = Math.round(snap.continuousSlackSec / 60)
    const plan = openPlans()[0]
    if (plan) {
      return makeCard({
        kind: 'slack_return',
        title: `休息够了，回来做「${plan.title}」`,
        body: `已经连续放松 ${min} 分钟。不用一下做完，先推进 25 分钟就算赢。`,
        reason: `presence 连续摸鱼 ${min} 分钟 · 当前状态 ${snap.state}`,
        planId: plan.id,
        actions: [
          { key: 'start', label: '回去做 25 分钟', primary: true },
          { key: 'snooze', label: '再休息 10 分钟' },
          { key: 'dismiss', label: '今天先这样' }
        ]
      })
    }
    const at = activeProjectTask()
    if (at) {
      return makeCard({
        kind: 'slack_return',
        title: `回来推进「${at.task.title}」`,
        body: `已经连续放松 ${min} 分钟。项目「${at.project.name}」还有一个进行中的任务。`,
        reason: `presence 连续摸鱼 ${min} 分钟 · 项目任务进行中`,
        projectId: at.project.id,
        actions: [
          { key: 'open_project', label: '打开项目继续', primary: true },
          { key: 'snooze', label: '再休息 10 分钟' },
          { key: 'dismiss', label: '今天先这样' }
        ]
      })
    }
  }

  // 4. 项目有待办但当前不在这个项目
  if (nowMin >= 9 * 60 && nowMin <= 21 * 60 + 30 && kindAllowed('project_resume', now)) {
    const at = activeProjectTask()
    if (at && snap.projectName !== at.project.name) {
      const openCount = col<ProjectTask>('projectTasks').filter((t) => t.projectId === at.project.id && t.status !== 'done').length
      return makeCard({
        kind: 'project_resume',
        title: `项目「${at.project.name}」还等着你`,
        body: `「${at.task.title}」还在进行中，项目里还有 ${openCount} 项没完成。`,
        reason: `当前归属${snap.projectName ? `「${snap.projectName}」` : '未归类'} · 该项目任务处于进行中`,
        projectId: at.project.id,
        actions: [
          { key: 'open_project', label: '打开项目', primary: true },
          { key: 'snooze', label: '稍后' },
          { key: 'dismiss', label: '今天不处理' }
        ]
      })
    }
  }

  // 5. 晚间收尾：把今天的监控结果变成回顾
  if (nowMin >= 20 * 60 + 30 && kindAllowed('wrap_up', now)) {
    const work = todayWorkMin()
    if (work >= 120) {
      const date = dateKey(now)
      return makeCard({
        kind: 'wrap_up',
        title: '今天差不多可以收了',
        body: `已记录 ${Math.floor(work / 60)} 小时 ${work % 60} 分有效工作。生成一份今日回顾，顺手定好明天三件事？`,
        reason: `今日有效工作 ${work} 分钟 · 已到 ${hhmm(nowMin)}`,
        prompt: `帮我生成今天（${date}）的工作回顾：先按时间分布总结主要产出，再指出一个可以改进的点，最后给出明天最重要的三件事。`,
        actions: [
          { key: 'ask_ai', label: '生成今日回顾', primary: true },
          { key: 'dismiss', label: '今晚先不用' }
        ]
      })
    }
  }

  // 6. 手动评估兜底：至少给一条能落地的建议
  if (force) {
    const plan = openPlans()[0]
    if (plan) {
      return makeCard({
        kind: 'check_in',
        title: `接下来做「${plan.title}」？`,
        body: plan.status === 'in_progress' ? '这项正在进行中，继续推进 25 分钟？' : '今天还没完成，挑它先起个步。',
        reason: `手动评估 · 今日 ${openPlans().length} 项计划未完成`,
        planId: plan.id,
        actions: [
          { key: 'start', label: '现在开始', primary: true },
          { key: 'open_plan', label: '看全部计划' },
          { key: 'dismiss', label: '先不用' }
        ]
      })
    }
    const work = todayWorkMin()
    return makeCard({
      kind: 'check_in',
      title: work > 0 ? `今天已专注 ${work} 分钟` : '还没有记录到工作',
      body: work > 0 ? '要不要生成一份当前进展回顾，看看接下来做什么？' : '保持 WorkOn 在后台运行，我会在合适的时候提示你。',
      reason: `手动评估 · ${work > 0 ? `今日有效工作 ${work} 分钟` : '今日暂无有效工作记录'}`,
      prompt: `帮我回顾今天到目前为止的工作进展，并建议接下来 1 小时最值得做的事。`,
      actions: [
        { key: 'ask_ai', label: '让 Agent 给建议', primary: true },
        { key: 'dismiss', label: '先不用' }
      ]
    })
  }

  return null
}

/** 标记到期的展示卡（前端没点也没关） */
function expireStale(): void {
  const now = Date.now()
  let changed = false
  for (const c of items) {
    if (c.status === 'shown' && now - c.ts > c.ttlSec * 1000) {
      c.status = 'expired'
      c.closedAt = now
      changed = true
      sendTo('main', 'coach:update', c)
    }
  }
  if (changed) save()
}

/** 闭环验证：采纳「开始」后 10 分钟内是否真的进入深度工作 */
function checkFollowThrough(): void {
  const now = Date.now()
  const snap = presence.getSnapshot()
  const deep = DEEP_WORK_STATES.includes(snap.state) && snap.focusLevel >= 35
  let changed = false
  for (const c of items) {
    if (c.status !== 'accepted' || c.actionKey !== 'start' || !c.verifyUntil || c.closedAt) continue
    if (now < c.verifyUntil) {
      if (deep) {
        c.status = 'followed'
        c.followedAt = now
        c.closedAt = now
        changed = true
        sendTo('main', 'coach:update', c)
      }
    } else {
      c.status = deep ? 'followed' : 'missed'
      c.closedAt = now
      if (deep) c.followedAt = now
      changed = true
      sendTo('main', 'coach:update', c)
    }
  }
  if (changed) save()
}

/**
 * 评估并可能推送一条提示
 * @param force 手动评估（忽略静默/间隔；无真实条件时给 check_in 兜底）
 */
export function evaluateCoach(force = false): CoachCard | null {
  checkFollowThrough()
  expireStale()
  const now = Date.now()
  if (!force) {
    if (now - lastEvalAt < 60_000) return null
    lastEvalAt = now
    const s = getSettings()
    if (s.privacyConsent !== 'granted' || s.recordingPaused) return null
    if (now < snoozeUntil) return null
    if (now < (s.petDndUntilTs ?? 0)) return null
    if (now - lastShownAt < MIN_GAP_MS) return null
    const snap = presence.getSnapshot()
    if (snap.state === 'idle' || snap.state === 'away' || snap.idleSec > 300) return null
  } else {
    lastEvalAt = now
  }
  const card = buildCandidate(force)
  if (!card) return null
  // 同内容 2 分钟内不重复（手动连点）
  const dup = items.find((c) => c.status === 'shown' && c.kind === card.kind && now - c.ts < 120_000)
  if (dup) return dup
  items.unshift(card)
  lastShownAt = now
  save()
  sendTo('main', 'coach:card', card)
  notifySystem(card)
  console.log(`[coach] 提示 ${card.kind}：${card.title}`)
  return card
}

function act(id: string, key: CoachActionKey): CoachState {
  const card = items.find((c) => c.id === id)
  if (!card) return stateOf()
  const now = Date.now()
  if (key === 'expire') {
    if (card.status === 'shown') {
      card.status = 'expired'
      card.closedAt = now
    }
  } else if (key === 'dismiss') {
    card.status = 'dismissed'
    card.actionKey = key
    card.closedAt = now
  } else if (key === 'snooze') {
    card.status = 'accepted'
    card.actionKey = key
    card.closedAt = now
    const clone: CoachCard = {
      ...card,
      id: genId('coach'),
      ts: now + 15 * 60_000,
      status: 'shown',
      actionKey: undefined,
      closedAt: undefined,
      verifyUntil: undefined,
      followedAt: undefined
    }
    setTimeout(() => {
      clone.ts = Date.now()
      items.unshift(clone)
      lastShownAt = Date.now()
      save()
      sendTo('main', 'coach:card', clone)
    }, 15 * 60_000)
  } else {
    card.status = 'accepted'
    card.actionKey = key
    if (key === 'start') {
      card.verifyUntil = now + VERIFY_MS
      if (card.planId) {
        updateIn<PlanItem>('plans', card.planId, { status: 'in_progress' })
        broadcast('plan-updated')
      }
    } else if (key === 'open_plan') {
      sendTo('main', 'nav:view', 'plan')
    } else if (key === 'open_project') {
      sendTo('main', 'nav:view', 'mainline')
    } else if (key === 'open_report') {
      sendTo('main', 'nav:view', 'report')
    } else if (key === 'ask_ai' && card.prompt) {
      sendTo('main', 'composer:ask', card.prompt)
    }
  }
  save()
  sendTo('main', 'coach:update', card)
  return stateOf()
}

/** 启动：加载存储 + 注册 IPC + 定时评估 */
export function startCoach(): void {
  load()
  ipcMain.handle('coach:list', () => stateOf())
  ipcMain.handle('coach:act', (_e, id: string, key: CoachActionKey) => act(String(id), key))
  ipcMain.handle('coach:evaluate', (_e, force?: boolean) => evaluateCoach(!!force))
  ipcMain.handle('coach:snooze', (_e, minutes?: number) => {
    const raw = Number(minutes)
    const m = Math.max(0, Math.min(240, Number.isFinite(raw) ? raw : 30))
    snoozeUntil = m > 0 ? Date.now() + m * 60_000 : 0
    save()
    return stateOf()
  })
  ipcMain.handle('coach:clear', () => {
    const today = dateKey(Date.now())
    items = items.filter((c) => dateKey(c.ts) !== today)
    save()
    return stateOf()
  })
  if (timer) clearInterval(timer)
  timer = setInterval(() => {
    try {
      evaluateCoach(false)
    } catch (e) {
      console.warn('[coach] 定时评估失败', e)
    }
  }, TICK_MS)
  console.log('[coach] 闭环助手已启动')
}
