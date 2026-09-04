/**
 * 开发会话识别（P0）：vibecoding 会话检测 → 会话卡 → 机动片段落库 + 积分
 *
 * 识别：
 *   - 开发 IDE/AI 编码器/终端前台 → 计入会话
 *   - localhost/127.0.0.1 自测页（浏览器）→ 计入会话
 *   - 活动间隔 > 5 分钟 → 会话结束；时长 ≥ 10 分钟 → 结算
 *
 * 结算产出：
 *   - PlanItem（planType='burst'，source='session'，无时段不占计划泳道）
 *   - ProjectTimeLink（source='auto'）：时长自动归入匹配的项目
 *   - 积分 = 分钟数；桌宠告知卡（数据已自动落库，确认仅回执）
 *   - 若匹配项目尚无任务清单且 AI 已启用 → 自动跑一次 aiBreakdown 拆解后续任务
 *
 * 隐私：只记录应用名/窗口标题摘要/时长
 */
import { col, insertInto } from './db'
import { addPoints } from './motions'
import { bus } from './state'
import { getSettings } from './settings'
import { genId } from '@shared/types'
import type { PlanItem, Project, ProjectTimeLink, WorkState } from '@shared/types'
import { dateKey } from '@shared/trail'

const MIN_SESSION_MS = 10 * 60_000
const END_GAP_MS = 5 * 60_000
const POINTS_PER_MIN = 1

const DEV_APP_RE = /^(zcode|cursor|code|code - insiders|windsurf|trae|devenv|idea64|pycharm64|webstorm64|goland64|clion64|rider64)/i
const SELF_TEST_TITLE = /localhost|127\.0\.0\.1|:5173|:3000|:8080|vite/i

let enabled = true
let inSession = false
let sessionStart = 0
let lastActiveTs = 0
let mainApp = ''
const apps = new Set<string>()
let titles: string[] = []

export function setDevSessionEnabled(on: boolean): void {
  enabled = on
  if (!on) resetSession()
}

function resetSession(): void {
  inSession = false
  sessionStart = 0
  lastActiveTs = 0
  mainApp = ''
  apps.clear()
  titles = []
}

function isDevApp(app: string): boolean {
  return DEV_APP_RE.test(app.trim().toLowerCase())
}

function isSelfTest(app: string, title: string): boolean {
  return /chrome|msedge|edge|firefox/i.test(app) && SELF_TEST_TITLE.test(title)
}

/** 项目归属：会话应用 ↔ 各项目已链接应用（projectTimeLinks）交集最大者 */
function matchProject(sessionApps: Set<string>): Project | null {
  const projects = col<Project>('projects')
  const links = col<ProjectTimeLink>('projectTimeLinks')
  const hits = new Map<string, number>()
  for (const l of links) {
    if (l.projectId && sessionApps.has(l.app.toLowerCase())) {
      hits.set(l.projectId, (hits.get(l.projectId) ?? 0) + 1)
    }
  }
  let best: Project | null = null
  let bestHits = 0
  for (const proj of projects) {
    const h = hits.get(proj.id) ?? 0
    if (h > bestHits) { bestHits = h; best = proj }
  }
  return best
}

/** 会话结束结算：机动片段落库 + 项目时长关联 + 积分 + 桌宠告知卡 */
function settle(): void {
  const minutes = Math.max(1, Math.round((lastActiveTs - sessionStart) / 60000))
  const appsArr = [...apps]
  const main = mainApp || appsArr[0] || '开发'
  const summary = (titles[titles.length - 1] || main).slice(0, 40)

  const proj = matchProject(apps)

  const plan: PlanItem = {
    id: genId('plan'),
    date: dateKey(Date.now()),
    title: `机动开发 · ${summary}`,
    category: 'ai-dev',
    durationMin: minutes,
    status: 'done',
    planType: 'burst',
    source: 'session',
    sessionDerived: true,
    completionRatio: 1,
    linkedProjectId: proj?.id,
    ts: Date.now()
  }
  insertInto<PlanItem>('plans', plan)

  if (proj) {
    insertInto<ProjectTimeLink>('projectTimeLinks', {
      id: genId('ptl'),
      projectId: proj.id,
      date: plan.date,
      app: main,
      min: minutes,
      source: 'auto',
      ts: Date.now()
    })
  }

  const pts = addPoints(minutes * POINTS_PER_MIN, `burst:${plan.title}`).delta

  // 回执走桌宠气泡（低打扰），不占确认通道——数据已自动落库，无需用户确认
  bus.setPet({ message: `${minutes} 分钟冲刺「${summary}」已记入${proj ? `「${proj.name}」` : ''} +${pts} ⭐` })

  resetSession()
}

/** 每轮采样喂入（monitor tick 调用）。idleSec：系统空闲秒数 */
export function devSessionTick(app: string, title: string, ts: number, idleSec: number): void {
  if (!enabled) return
  const devHit = isDevApp(app) || isSelfTest(app, title)

  if (inSession) {
    if (devHit || idleSec < 2) {
      lastActiveTs = ts
      if (devHit) {
        apps.add(app)
        if (isDevApp(app)) mainApp = app
        const t = title.slice(0, 40)
        if (titles[titles.length - 1] !== t) titles.push(t)
      }
      if (ts - lastActiveTs > END_GAP_MS) settle()
      return
    }
    settle()
    return
  }

  if (devHit && idleSec < 5) {
    inSession = true
    sessionStart = ts
    lastActiveTs = ts
    mainApp = app
    apps.add(app)
    titles = [title.slice(0, 40)]
    console.info(`[devSession] 开发会话开始：${app}`)
  }
}

/** 结算后异步调一次：若匹配项目还没有任务清单且 AI 已启用，自动拆解后续任务 */
export function maybeAutoBreakdownFor(plan: PlanItem): void {
  if (!plan.linkedProjectId) return
  try {
    const s = getSettings()
    if (!s.aiEnabled || !s.aiApiKey) return
    const projectId = plan.linkedProjectId
    void import('./projects').then(({ aiBreakdown, listTasks }) => {
      const existing = listTasks(projectId)
      if (existing.length > 0) return null
      const proj = col<Project>('projects').find((x) => x.id === projectId)
      return aiBreakdown(projectId, `根据最近的开发会话「${plan.title}」拆解后续任务（项目目标：${proj?.goal ?? '见项目描述'}）`)
    }).then((tasks) => {
      if (tasks && tasks.length) {
        bus.setPet({ message: `已为项目拆解 ${tasks.length} 个后续任务 ✓` })
      }
    }).catch(() => undefined)
  } catch { /* ignore */ }
}
