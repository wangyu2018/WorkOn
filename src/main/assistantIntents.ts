/**
 * 本地助手意图路由（主进程）：
 * - 待办梳理（行为证据 → 自动完成 / 保留 / 取消建议）
 * - 列表全览（待办 / 提醒）
 * - 天气卡
 * - 应用接管卡（今日用量 + 可接管动作）
 *
 * 这些问题的数据都在本机，先本地答；返回 matched=false 时渲染端再走 LLM。
 */
import type { AssistantCard, AssistantIntentResult, AssistantListRow, AssistantTodoSuggestion } from '@shared/assistant'
import type { MergedTrail, PlanItem, Project } from '@shared/types'
import { buildMergedTrail, dateKey } from '@shared/trail'
import { displayApp } from '@shared/appDisplayName'
import { CATEGORY_META, categoryOf } from '@shared/appCategory'
import { WORK_STATES } from '@shared/stateMeta'
import { col, listActivities } from './db'
import { listReminders } from './reminders'
import { getWeather } from './weather'
import { listProjects, saveProject } from './projects'

const WEATHER_RE = /(天气|气温|下雨|下雪|带伞|穿什么|冷不冷|热不热|几度|多少度)/
const TODO_CLEAN_RE = /(梳理|清理|整理|清仓|盘点|太多|积压)/ 
const TODO_WORD_RE = /(待办|任务|计划|todo)/
const LIST_RE = /(待办|todo|任务清单|要做的事|还有什么事|提醒|清单)/
const APP_USAGE_RE = /(接管|用量|用了多久|用了多少|时长|用了什么)/
/** 明确要新建本地项目（项目 ≠ 计划 ≠ 远程节点仓库） */
const PROJECT_CREATE_RE = /(增加|添加|新建|创建|建立|建|开)(一下|一个|一条|一项|个)?[^，。；\n]{1,20}项目/

/** 从「我想增加 Trae 大赛项目」里取出项目名；不像项目名就返回 null，交回 LLM */
function projectNameFrom(q: string): string | null {
  const first = q.split(/[，。；\n]/)[0]
  const quoted = /[「『“"]([^」』”"]{2,20})[」』”"]/.exec(first)
  const name = (quoted?.[1] ??
    first
      .replace(/(帮我|请|麻烦|我想|我要|想要|给我|能不能|可以)/g, '')
      .replace(/(增加|添加|新建|创建|建立|建|开)(一下|一个|一条|一项|个)?/g, '')
      .replace(/^项目(叫|名为|名称是)?/, '')
      .replace(/项目$/, ''))
    .replace(/^[「『“"]+|[」』”"]+$/g, '')
    .trim()
  if (name.length < 2 || name.length > 20) return null
  // 「项目入口 / 新建一个开发的项目」这类不是要给项目取名
  if (/入口|页面|按钮|功能|能力|支持|哪些|这个|那个|的$/.test(name)) return null
  return name
}

const STATUS_LABEL: Record<PlanItem['status'], string> = {
  planned: '待办',
  in_progress: '进行中',
  partial: '部分完成',
  done: '已完成',
  delayed: '已延期',
  cancelled: '已取消'
}

/** 剥掉会话上下文前缀、引用前缀，避免前缀关键词截胡 */
function normalize(q: string): string {
  return q
    .replace(/^【当前会话：[\s\S]*?\n\n/, '')
    .replace(/^（关于我引用的内容：「[\s\S]*?」）\s*/, '')
    .trim()
}

function daysBetween(from: string, to: string): number {
  const a = new Date(`${from}T00:00:00`).getTime()
  const b = new Date(`${to}T00:00:00`).getTime()
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0
  return Math.max(0, Math.round((b - a) / 86400000))
}

/** 计划标题 → 可匹配的 2~4 字关键词 */
function keywordsOf(title: string): string[] {
  const cleaned = title
    .replace(/[（(][^)）]*[)）]/g, ' ')
    .replace(/[，。,.、；;：:!?！？\-_/\\|「」『』【】\[\]]/g, ' ')
  const out = new Set<string>()
  for (const part of cleaned.split(/\s+/)) {
    if (!part) continue
    if (part.length >= 2) out.add(part)
    if (/^[\u4e00-\u9fa5]+$/.test(part) && part.length > 4) {
      for (let i = 0; i + 2 <= part.length; i += 2) out.add(part.slice(i, i + 2))
    }
  }
  return [...out].slice(0, 8)
}

interface DayHaystack {
  date: string
  segments: { app: string; title: string; text: string }[]
}

/** 近 N 天轨迹（只留匹配用的轻量文本） */
function recentHaystacks(days: number): DayHaystack[] {
  const list: DayHaystack[] = []
  for (let i = 0; i < days; i++) {
    const d = dateKey(Date.now() - i * 86400000)
    let trail: MergedTrail | null = null
    try {
      trail = buildMergedTrail(listActivities(d), d)
    } catch {
      trail = null
    }
    if (!trail) continue
    list.push({
      date: d,
      segments: trail.segments
        .filter((s) => !s.glance)
        .map((s) => ({
          app: s.mainApp,
          title: s.mainTitle ?? '',
          text: [s.mainApp, s.mainTitle, s.operation, s.microActivity].filter(Boolean).join(' ').toLowerCase()
        }))
    })
  }
  return list
}

function buildTodoCleanup(): AssistantCard | null {
  const today = dateKey(Date.now())
  const open = col<PlanItem>('plans').filter(
    (p) => !p.archived && p.status !== 'done' && p.status !== 'cancelled'
  )
  if (open.length === 0) return null
  const hay = recentHaystacks(14)

  const items: AssistantTodoSuggestion[] = open.slice(0, 60).map((p) => {
    const ageDays = daysBetween(p.date, today)
    const kws = keywordsOf(p.title)
    let hits = 0
    let hitWord = ''
    for (const day of hay) {
      for (const seg of day.segments) {
        const kw = kws.find((k) => seg.text.includes(k.toLowerCase()))
        if (kw) {
          hits++
          if (!hitWord) hitWord = kw
        }
      }
    }
    let suggestion: AssistantTodoSuggestion['suggestion'] = 'keep'
    let evidence = ''
    let confidence = 0.4
    if (hits >= 3) {
      suggestion = 'auto_done'
      evidence = `近 14 天有 ${hits} 段轨迹命中「${hitWord}」——看起来已经做了`
      confidence = Math.min(0.92, 0.55 + hits * 0.04)
    } else if (ageDays >= 21 && hits === 0) {
      suggestion = 'cancel'
      evidence = `积压 ${ageDays} 天 · 近 14 天没有相关轨迹`
      confidence = Math.min(0.85, 0.5 + ageDays / 120)
    } else {
      evidence = hits > 0 ? `近 14 天 ${hits} 段相关轨迹，建议保留` : `积压 ${ageDays} 天 · 尚未发现相关轨迹`
      confidence = 0.5
    }
    return { id: p.id, title: p.title, status: p.status, date: p.date, ageDays, evidence, suggestion, confidence }
  })

  // 先给「可自动完成 / 可取消」，保留项靠后
  const rank = { auto_done: 0, cancel: 1, keep: 2 }
  items.sort((a, b) => rank[a.suggestion] - rank[b.suggestion] || b.ageDays - a.ageDays)

  return {
    kind: 'todo_cleanup',
    items,
    stats: {
      total: items.length,
      autoDone: items.filter((i) => i.suggestion === 'auto_done').length,
      keep: items.filter((i) => i.suggestion === 'keep').length,
      cancel: items.filter((i) => i.suggestion === 'cancel').length
    }
  }
}

function buildList(q: string): AssistantCard | null {
  if (/提醒/.test(q)) {
    const rows: AssistantListRow[] = listReminders()
      .map((r) => ({
        id: r.id,
        title: r.title,
        meta: r.recurring === 'daily' ? `每天 ${r.atHHMM ?? '--:--'}` : new Date(r.atTs ?? 0).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }),
        status: r.enabled ? '开启' : '暂停'
      }))
    return { kind: 'list', title: '提醒', source: 'reminders', rows }
  }
  const projects = new Map(col<Project>('projects').map((p) => [p.id, p.name]))
  const rows: AssistantListRow[] = col<PlanItem>('plans')
    .filter((p) => !p.archived)
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
    .slice(0, 120)
    .map((p) => ({
      id: p.id,
      title: p.title,
      meta: [p.date, STATUS_LABEL[p.status], p.projectId ? projects.get(p.projectId) : ''].filter(Boolean).join(' · '),
      status: p.status
    }))
  return { kind: 'list', title: '待办 / 计划', source: 'plans', rows }
}

async function buildWeatherCard(): Promise<AssistantIntentResult> {
  const data = await getWeather()
  if ('error' in data) return { matched: true, text: data.error }
  const card: AssistantCard = {
    kind: 'weather',
    city: data.city,
    now: {
      text: data.text,
      tempC: data.tempC,
      feelsC: data.feelsC,
      humidity: data.humidity,
      windKph: data.windKph,
      maxC: data.maxC,
      minC: data.minC
    },
    hours: data.hourly.slice(0, 8).map((h) => ({ hour: h.hour, text: h.text, tempC: h.tempC, chanceOfRain: h.chanceOfRain })),
    tomorrow: data.tomorrow
  }
  const rain = data.hourly.slice(0, 8).find((h) => /雨|雪/.test(h.text))
  const text = `${data.city}现在 ${data.text} ${Math.round(data.tempC)}°C（体感 ${Math.round(data.feelsC)}°C），今天 ${Math.round(data.minC)}~${Math.round(data.maxC)}°C。${
    rain ? `未来几小时 ${rain.hour}:00 有${/雪/.test(rain.text) ? '雪' : '雨'}，出门记得带伞。` : ''
  }`
  return { matched: true, text, card }
}

function buildAppCard(q: string): AssistantCard | null {
  const today = dateKey(Date.now())
  const trail = buildMergedTrail(listActivities(today), today)
  const segs = trail.segments.filter((s) => !s.glance)
  if (segs.length === 0) return null
  const byApp = new Map<string, { min: number; n: number; last: number }>()
  for (const s of segs) {
    const cur = byApp.get(s.mainApp) ?? { min: 0, n: 0, last: 0 }
    cur.min += s.durationMin
    cur.n += 1
    cur.last = Math.max(cur.last, s.endTs)
    byApp.set(s.mainApp, cur)
  }
  const ql = q.toLowerCase()
  let hit: { app: string; min: number; n: number; last: number } | null = null
  for (const [app, v] of byApp) {
    const label = displayApp(app).toLowerCase()
    if (ql.includes(label) || ql.includes(app.toLowerCase())) {
      if (!hit || v.min > hit.min) hit = { app, ...v }
    }
  }
  // 裸应用名：不超过 16 字、没有明显动词，也当作应用查询
  if (!hit && ql.length <= 16 && !/[?？]/.test(ql)) {
    for (const [app, v] of byApp) {
      const label = displayApp(app).toLowerCase()
      if (label.startsWith(ql) || app.toLowerCase().startsWith(ql)) {
        hit = { app, ...v }
        break
      }
    }
  }
  if (!hit) return null
  const cat = categoryOf(hit.app)
  const im = cat === 'im' || /wechat|weixin|feishu|lark|dingtalk|qq|slack|teams|telegram/i.test(hit.app)
  const state = trail.segments.filter((s) => s.mainApp === hit!.app).sort((a, b) => b.durationMin - a.durationMin)[0]?.mainState
  const hm = new Date(hit.last).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
  return {
    kind: 'app',
    app: hit.app,
    display: displayApp(hit.app),
    minutes: Math.round(hit.min),
    segments: hit.n,
    lastHM: hm,
    stateLabel: state ? WORK_STATES[state].label : '—',
    category: CATEGORY_META[cat].label,
    im,
    actions: [...(im ? ['开启消息监控'] : []), '打开应用']
  }
}

export async function runAssistantIntent(raw: string): Promise<AssistantIntentResult> {
  const q = normalize(raw)
  if (!q) return { matched: false }
  const ql = q.toLowerCase()

  if (WEATHER_RE.test(q)) {
    try {
      return await buildWeatherCard()
    } catch {
      return { matched: false }
    }
  }

  if (TODO_CLEAN_RE.test(q) && TODO_WORD_RE.test(q)) {
    const card = buildTodoCleanup()
    if (card) {
      const stats = card.kind === 'todo_cleanup' ? card.stats : null
      return {
        matched: true,
        text: stats
          ? `共 ${stats.total} 项待办：建议自动完成 ${stats.autoDone} 项、取消 ${stats.cancel} 项、保留 ${stats.keep} 项。依据是近 14 天轨迹，逐条可改。`
          : '没有需要梳理的待办。',
        card
      }
    }
    return { matched: true, text: '目前没有未完成的待办，很干净。' }
  }

  // 项目 ≠ 计划：明确说「新建 XXX 项目」时直接落到本地项目，别让模型误建成计划
  if (PROJECT_CREATE_RE.test(q)) {
    const name = projectNameFrom(q)
    if (name) {
      const existing = listProjects().find((p) => p.name === name)
      if (existing) {
        return {
          matched: true,
          text: `项目「${existing.name}」已经存在，没有重复创建。入口在「计划 → 项目」，要加任务直接说就行。`
        }
      }
      const project = saveProject({ name })
      return {
        matched: true,
        text: `已创建项目「${project.name}」。入口在「计划 → 项目」，可以继续让我加任务或关联应用；这不是计划，所以没有弹计划预览卡。`
      }
    }
  }

  if (APP_USAGE_RE.test(q) || ql.length <= 16) {
    const card = buildAppCard(q)
    if (card && card.kind === 'app') {
      return {
        matched: true,
        text: `${card.display}：今天 ${card.minutes} 分钟 · ${card.segments} 段，最近 ${card.lastHM}（${card.stateLabel}）。${card.im ? '要接管说「开启消息监控」。' : ''}`,
        card
      }
    }
  }

  if (LIST_RE.test(q) && !/提醒我|新增|加一个|设置.*提醒/.test(q)) {
    const card = buildList(q)
    if (card && card.kind === 'list') {
      return { matched: true, text: `共 ${card.rows.length} 条，点「展开全览」看全部、搜索或按状态筛选。`, card }
    }
  }

  return { matched: false }
}
