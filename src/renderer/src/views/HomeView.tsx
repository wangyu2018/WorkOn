/**
 * 首页 — 今日图谱 + 工作/生活时间轴（PRD v3.1 G+H）
 */
import { useEffect, useState, useMemo, useCallback, useRef } from 'react'
import { createPortal } from 'react-dom'
import { WORK_LIKE_STATES } from '@shared/stateMeta'
import type { MergedTrail, TrailSegment, WorkState, PlanItem, AttentionScore } from '@shared/types'
import { dateKey } from '@shared/trail'
import { ActivityHoverCard } from '../components/ActivityHoverCard'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { Icon } from '../components/Icon'
import { InsightCard } from '../components/ui/InsightCard'
import { Seg } from '../components/ui/Seg'
import { displayApp } from '@shared/appDisplayName'
import { matchesExcludedApp } from '@shared/stateMeta'
import { useSettingsStore } from '../stores/settingsStore'
import { useAppStore } from '../stores/appStore'
import { CATEGORY_META, categoryOfWithOverride, type AppCategory } from '@shared/appCategory'
import MonitorView, { MONITOR_SECTION_META, type MonitorSectionKey } from './MonitorView'
import {
  buildHomeRenderSlots,
  HOME_BLOCK_META,
  loadHomeOrder,
  loadHomeWidgets,
  metaOf,
  saveHomeLayout,
  type HomeBlockKey,
  type HomeWidgets
} from '../lib/homeLayout'

type Channel = 'CMD' | '浏览器' | '微信' | 'IDE' | '其他'
type Column = 'work' | 'life'

interface GraphItem {
  seg: TrailSegment
  channel: Channel
  column: Column
}

function mapChannel(app: string): Channel {
  const lower = app.toLowerCase()
  if (['cmd', 'powershell', 'terminal', 'alacritty', 'kitty', 'wt'].some((n) => lower.includes(n))) return 'CMD'
  if (['chrome', 'edge', 'firefox', 'brave', 'safari', 'opera'].some((n) => lower.includes(n))) return '浏览器'
  if (['wechat', '微信', 'weixin', 'wecom'].some((n) => lower.includes(n))) return '微信'
  if (['code', 'vscode', 'cursor', 'intellij', 'idea', 'webstorm', 'pycharm', 'android studio', 'eclipse'].some((n) => lower.includes(n))) return 'IDE'
  return '其他'
}

function fmtTime(ts: number): string { const d = new Date(ts); return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}` }
function fmtDur(min: number): string { if (min < 1) return '<1m'; if (min < 60) return `${Math.round(min)}m`; const h = Math.floor(min / 60); const m = Math.round(min % 60); return m > 0 ? `${h}h${m}m` : `${h}h` }
const fmtMin = (min?: number) => {
  if (min == null) return '—'
  const total = Math.round(min)
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}

const LABEL_W = 128
const LANE_W = 760

/** 分类 hex → "r g b"（renderSegBlock 段色用） */
function hexToRgb(hex: string): string {
  const m = hex.replace('#', '')
  const n = m.length === 3 ? m.split('').map((c) => c + c).join('') : m
  const num = parseInt(n, 16)
  return `${(num >> 16) & 255} ${(num >> 8) & 255} ${num & 255}`
}

/** 分类 hex → 低透明底色（泳道底/磁贴底） */
function hexBg(hex: string, alpha: number): string {
  return `rgba(${hexToRgb(hex)}, ${alpha})`
}

/** v6 KPI 基线口径 */
type BaselineKey = 'yest' | 'week' | 'd30' | 'best'
const BASELINE_SHORT: Record<BaselineKey, string> = { yest: '昨日', week: '近7天', d30: '近30天', best: '高效日' }
const baselineSource = (key: BaselineKey, baseMin: number): string =>
  key === 'yest'
    ? `基线来源：昨日同时段 ${fmtMin(baseMin)}`
    : key === 'week'
      ? `基线来源：近 7 天同时段均值 ${fmtMin(baseMin)}`
      : key === 'd30'
        ? `基线来源：近 30 天同时段均值 ${fmtMin(baseMin)}`
        : `基线来源：高效日同时段 ${fmtMin(baseMin)}`

/** trail 内某组状态的墙钟分钟（glance 不计） */
function dayStateMin(tr: MergedTrail, states: string[]): number {
  let v = 0
  for (const s of tr.segments) {
    if (s.glance) continue
    if (states.includes(s.mainState)) v += s.durationMin
  }
  return v
}

/** 某段轨迹内，从 startTs 起等长 windowMs 的指定状态分钟（KPI 同时段基线用） */
function windowStateMin(tr: MergedTrail, states: string[], startTs: number, windowMs: number): number {
  const endTs = startTs + windowMs
  let v = 0
  for (const s of tr.segments) {
    const s0 = Math.max(s.startTs, startTs)
    const s1 = Math.min(s.endTs, endTs)
    if (s1 <= s0) continue
    if (states.includes(s.mainState)) v += (s1 - s0) / 60000
  }
  return v
}

// 时间轴缩放档位：从全天到 1 小时
const ZOOM_STOPS = [
  { label: '全天', span: 1440 },
  { label: '12h', span: 720 },
  { label: '6h', span: 360 },
  { label: '3h', span: 180 },
  { label: '1h', span: 60 },
] as const

function makeDragImage(app: string, ma?: string | null): HTMLDivElement {
  const el = document.createElement('div')
  el.textContent = ma ? `${app} · ${ma}` : app
  Object.assign(el.style, {
    position: 'absolute', top: '-1000px', left: '-1000px',
    padding: '4px 8px', borderRadius: '6px', fontSize: '11px',
    background: '#fff', border: '1px solid #cbd5e1', color: '#1e293b',
    boxShadow: '0 2px 8px rgba(15,23,42,0.18)', whiteSpace: 'nowrap',
  })
  document.body.appendChild(el)
  return el
}

type SenseKind = 'work' | 'slack' | 'other'
function senseOf(state: WorkState): SenseKind {
  const slackStates: WorkState[] = ['slack', 'relax', 'break', 'lunch', 'idle', 'away']
  if (slackStates.includes(state)) return 'slack'
  if (WORK_LIKE_STATES.includes(state)) return 'work'
  return 'other'
}

/** v6 星图数据源（window.api.getStarGraph(7) 返回，7 天聚合） */
interface StarGraphNode {
  app: string
  sec: number
  cluster: 'work' | 'play'
  /** 星团内排名 1=最重 */
  weight: number
}
interface StarGraphEdge { from: string; to: string; count: number }
interface StarGraphData {
  nodes: StarGraphNode[]
  edges: StarGraphEdge[]
  totalSwitches: number
  days: number
}
/** 布局后的星图节点（x/y 为画布百分比） */
interface StarPlanet extends StarGraphNode {
  x: number
  y: number
  size: number
}

/** v6 星图配色：work=teal / play=violet */
const STAR_CLUSTER_RGB: Record<StarGraphNode['cluster'], string> = { work: '15,181,164', play: '139,92,246' }
const starClusterRgba = (cluster: StarGraphNode['cluster'], a: number) => `rgba(${STAR_CLUSTER_RGB[cluster]}, ${a})`

/**
 * v6 星图布局：单一星团居中（不再区分工作/摸鱼分区）。
 * 按 sec 降序环形散布（weight 1 = 中心主星），椭圆补偿画布宽高比。
 */
function layoutStarCluster(nodes: StarGraphNode[]): StarPlanet[] {
  if (nodes.length === 0) return []
  const sorted = [...nodes].sort((a, b) => b.sec - a.sec)
  const cx = 50
  const cy = 50
  const maxSec = sorted[0].sec || 1
  const out: StarPlanet[] = []
  sorted.forEach((n, i) => {
    let x = cx
    let y = cy
    if (i > 0) {
      const ring = i <= 6 ? 1 : 2
      const ringIdx = ring === 1 ? i - 1 : i - 7
      const ringCap = ring === 1 ? 6 : Math.max(1, sorted.length - 7)
      const rx = ring === 1 ? 17 : 31
      const ry = ring === 1 ? 26 : 34
      const angle = -Math.PI / 2 + (ringIdx / ringCap) * Math.PI * 2 + (ring === 2 ? Math.PI / ringCap : 0)
      x = Math.min(94, Math.max(6, cx + rx * Math.cos(angle)))
      y = Math.min(88, Math.max(14, cy + ry * Math.sin(angle)))
    }
    // 节点大小 ∝ sqrt(sec)（全域归一）
    const size = Math.round(24 + 22 * Math.sqrt(n.sec / maxSec))
    out.push({ ...n, x, y, size })
  })
  return out
}

const STATUS_BG: Record<string,string> = {
  planned: '#eff6ff', in_progress: '#ecfdf5', partial: '#fefce8',
  done: '#f0fdf4', delayed: '#fef2f2', cancelled: '#f8fafc'
}
const STATUS_BORDER: Record<string,string> = {
  planned: '#bfdbfe', in_progress: '#a7f3d0', partial: '#fde68a',
  done: '#bbf7d0', delayed: '#fecaca', cancelled: '#e2e8f0'
}
const STATUS_TEXT: Record<string,string> = {
  planned: '#3b82f6', in_progress: '#10b981', partial: '#f59e0b',
  done: '#22c55e', delayed: '#ef4444', cancelled: '#94a3b8'
}

interface DailyInsight {
  workMin: number
  slackMin: number
  slackPct: number
  focusMin: number
  topApps: { app: string; min: number }[]
  /** 各基线同期工作差值（%） */
  baseline: { key: 'yest' | 'week' | 'best'; label: string; delta: number | null }[]
  /** 节奏预测：全天预计工作分钟 */
  forecastMin: number | null
  windowMin: number
  startedAt: string
  workDetail: string
}

/** 某段轨迹内，从 startTs 起等长 windowMs 的工作分钟（总−摸鱼−idle−away） */
function windowWorkMin(tr: MergedTrail, startTs: number, windowMs: number): number {
  const endTs = startTs + windowMs
  let work = 0
  let slack = 0
  let idle = 0
  let away = 0
  for (const s of tr.segments) {
    const s0 = Math.max(s.startTs, startTs)
    const s1 = Math.min(s.endTs, endTs)
    if (s1 <= s0) continue
    const d = (s1 - s0) / 60000
    if (s.mainState === 'idle') idle += d
    else if (s.mainState === 'away') away += d
    else if (['slack', 'relax', 'break', 'lunch'].includes(s.mainState)) slack += d
    else work += d
  }
  return work
}

function insight(trail: MergedTrail, recent: MergedTrail[]): DailyInsight {
  const empty: DailyInsight = {
    workMin: 0, slackMin: 0, slackPct: 0, focusMin: 0, topApps: [],
    baseline: [{ key: 'yest', label: '昨日同期', delta: null }, { key: 'week', label: '近7天同期', delta: null }, { key: 'best', label: '高效日同期', delta: null }],
    forecastMin: null, windowMin: 0, startedAt: '', workDetail: ''
  }
  if (!trail || trail.totalMin < 1) return empty
  // 今天窗口：首个有效段 → 现在
  const nowTs = Date.now()
  const active = trail.segments.filter((s) => !s.glance && s.mainState !== 'idle' && s.mainState !== 'away')
  if (!active.length) return empty
  const startTs = Math.min(...active.map((s) => s.startTs))
  const windowMs = nowTs - startTs
  if (windowMs < 30 * 60000) return { ...empty, workMin: windowWorkMin(trail, startTs, windowMs), windowMin: Math.round(windowMs / 60000), startedAt: new Date(startTs).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) }

  const todayWork = windowWorkMin(trail, startTs, windowMs)
  const todaySlack = (() => {
    const endTs = startTs + windowMs
    let slack = 0
    for (const s of trail.segments) {
      const s0 = Math.max(s.startTs, startTs); const s1 = Math.min(s.endTs, endTs)
      if (s1 <= s0) continue
      if (['slack', 'relax', 'break', 'lunch'].includes(s.mainState)) slack += (s1 - s0) / 60000
    }
    return slack
  })()
  const slackPct = Math.round((todaySlack / (todayWork + todaySlack || 1)) * 100)
  const focusMin = (trail.stateMinutes.focus ?? 0) + (trail.stateMinutes.coding ?? 0) + (trail.stateMinutes.aidev ?? 0) + (trail.stateMinutes.aiqa ?? 0)

  // TOP 应用（窗口内）
  const appMap = new Map<string, number>()
  for (const s of trail.segments) {
    if (s.glance || s.mainState === 'idle' || s.mainState === 'away') continue
    appMap.set(s.mainApp, (appMap.get(s.mainApp) ?? 0) + s.durationMin)
  }
  const topApps = [...appMap.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([app, min]) => ({ app, min }))

  // 各天窗口工作分钟（取每天自身窗口起点 + 等长 windowMs）
  const perDay = recent.map((r) => {
    const acts = r.segments.filter((s) => !s.glance && s.mainState !== 'idle' && s.mainState !== 'away')
    if (!acts.length) return null
    const dayStart = Math.min(...acts.map((s) => s.startTs))
    return { tr: r, dayStart, work: windowWorkMin(r, dayStart, windowMs) }
  }).filter((x): x is { tr: MergedTrail; dayStart: number; work: number } => !!x)

  const isWeekend = [0, 6].includes(new Date().getDay())
  const sameType = perDay.filter((d) => (isWeekend ? [0, 6].includes(new Date(d.dayStart).getDay()) : ![0, 6].includes(new Date(d.dayStart).getDay())))
  const pool = sameType.length ? sameType : perDay
  const yest = perDay[0] // recent 倒序：recent[0]=昨天
  const weekAvg = pool.length ? pool.reduce((a, d) => a + d.work, 0) / pool.length : 0
  const bestWork = pool.length ? Math.max(...pool.map((d) => d.work)) : 0

  const pct = (a: number, b: number) => (b > 1 ? Math.round(((a - b) / b) * 100) : null)
  const baseline: DailyInsight['baseline'] = [
    { key: 'yest', label: '昨日同期', delta: yest ? pct(todayWork, yest.work) : null },
    { key: 'week', label: '近7天同期', delta: weekAvg > 1 ? pct(todayWork, weekAvg) : null },
    { key: 'best', label: '高效日同期', delta: bestWork > 1 ? pct(todayWork, bestWork) : null }
  ]

  // 节奏预测：窗口工作密度 × 全天剩余
  const density = todayWork / (windowMs / 60000 || 1)
  const dayStartOfToday = new Date(startTs); dayStartOfToday.setHours(0, 0, 0, 0)
  const todayTotalMs = Math.max(1, nowTs - dayStartOfToday.getTime())
  const forecastMin = Math.round(density * (todayTotalMs / 60000))

  // 窗口内明细
  const winFocus = (() => {
    const endTs = startTs + windowMs
    let f = 0
    for (const s of trail.segments) {
      const s0 = Math.max(s.startTs, startTs); const s1 = Math.min(s.endTs, endTs)
      if (s1 <= s0) continue
      if (['focus', 'coding', 'aidev', 'aiqa'].includes(s.mainState)) f += (s1 - s0) / 60000
    }
    return Math.round(f)
  })()

  return {
    workMin: Math.round(todayWork),
    slackMin: Math.round(todaySlack),
    slackPct,
    focusMin,
    topApps,
    baseline,
    forecastMin,
    windowMin: Math.round(windowMs / 60000),
    startedAt: new Date(startTs).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }),
    workDetail: `聚焦 ${winFocus} · 窗口 ${new Date(startTs).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}–${new Date(nowTs).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`
  }
}

export default function HomeView() {
  /** 主页模块显隐 + 拖拽顺序 */
  const [widgets, setWidgets] = useState<HomeWidgets>(() => loadHomeWidgets())
  const [homeOrder, setHomeOrder] = useState<HomeBlockKey[]>(() => loadHomeOrder())
  const [editing, setEditing] = useState(false)
  const [dragKey, setDragKey] = useState<HomeBlockKey | null>(null)
  const [dragOverKey, setDragOverKey] = useState<HomeBlockKey | null>(null)
/** KPI 卡点击 → 跳转报表对应页签 */
function gotoReport(tab: 'smart' | 'smartWeekly' | 'ai', kpi?: 'focus' | 'slack'): void {
  window.dispatchEvent(new CustomEvent('workon:goto-report', { detail: { tab, kpi } }))
  useAppStore.getState().setView('report')
}

  /** 洞察卡对标基线：yest=昨日同期 week=近7天同期 d30=近30天均值 best=高效日同期 */
  const [baselineKey, setBaselineKey] = useState<BaselineKey>('d30')
  const persistLayout = (nextWidgets: HomeWidgets, nextOrder: HomeBlockKey[]) => {
    setWidgets(nextWidgets)
    setHomeOrder(nextOrder)
    saveHomeLayout(nextWidgets, nextOrder)
  }
  const setWidget = (k: HomeBlockKey, v: boolean) => {
    persistLayout({ ...widgets, [k]: v }, homeOrder)
  }
  const reorderBlock = (from: HomeBlockKey, to: HomeBlockKey) => {
    if (from === to) return
    const next = [...homeOrder]
    const fi = next.indexOf(from)
    const ti = next.indexOf(to)
    if (fi < 0 || ti < 0) return
    next.splice(fi, 1)
    next.splice(ti, 0, from)
    persistLayout(widgets, next)
  }
  const renderSlots = useMemo(() => buildHomeRenderSlots(homeOrder, widgets), [homeOrder, widgets])
  const monitorSectionsFor = (keys: MonitorSectionKey[]) =>
    Object.fromEntries(MONITOR_SECTION_META.map(({ key }) => [key, keys.includes(key)])) as Record<
      MonitorSectionKey,
      boolean
    >
  /** 用户自定义分类覆盖（星图分类层 + 时间轴分类组共用） */
  const override = useSettingsStore((s) => s.settings.appCategoryOverride)
  /** 应用视觉元数据：进程名(小写) → { iconDataUrl, themeColor } */
  const [appVisuals, setAppVisuals] = useState<Record<string, { iconDataUrl: string; themeColor: string }>>({})
  useEffect(() => {
    window.api?.getAppVisuals?.().then((v) => setAppVisuals((v as Record<string, { iconDataUrl: string; themeColor: string }>) ?? {})).catch(() => undefined)
  }, [])
  /** 项目→色标映射 + 应用→项目归类（时间轴着色） */
  const [projectColors, setProjectColors] = useState<Record<string, string>>({})
  const [projectAppMap, setProjectAppMap] = useState<Record<string, string>>({}) // app(小写) → projectId
  useEffect(() => {
    void (async () => {
      try {
        const [ps, links] = await Promise.all([window.api.listProjects(), window.api.getDayProjectLinks()])
        const colors: Record<string, string> = {}
        ;(ps as { id: string; color?: string }[]).forEach((x) => { colors[x.id] = x.color ?? '#22D3EE' })
        setProjectColors(colors)
        const appMap: Record<string, string> = {}
        ;(links as { app: string; projectId: string }[]).forEach((l) => { appMap[l.app] = l.projectId })
        setProjectAppMap(appMap)
      } catch { /* ignore */ }
    })()
  }, [])
  const [trail, setTrail] = useState<MergedTrail | null>(null)
  const [recentTrails, setRecentTrails] = useState<MergedTrail[]>([])
  /** 近 30 天 trail（KPI 卡「同时段均值」基线；复用现有 getTrail 按天拉取，仅首次加载） */
  const [recentTrails30, setRecentTrails30] = useState<MergedTrail[]>([])
  /** 注意力评分（今日 + 近 8 天走势，AI 综合评分卡用；接口不可用时回退「今日 AI 协作时长」） */
  const [attention, setAttention] = useState<{ today: AttentionScore; history: AttentionScore[] } | null>(null)
  const [items, setItems] = useState<GraphItem[]>([])
  const [plans, setPlans] = useState<PlanItem[]>([])
  const [tlHover, setTlHover] = useState<{ seg: TrailSegment; rect: DOMRect; mouse?: { x: number; y: number } } | null>(null)
  const [dragTs, setDragTs] = useState<number | null>(null)
  const [nowMin, setNowMin] = useState(() => {
    const d = new Date(); return d.getHours() * 60 + d.getMinutes()
  })
  // 默认以「现在」为核心居中，前后各 3 小时
  const [rangeLo, setRangeLo] = useState(() => Math.max(0, nowMin - 180))
  const [rangeHi, setRangeHi] = useState(() => Math.min(1440, nowMin + 180))
  const [starHover, setStarHover] = useState<string | null>(null)
  /** v6 星图数据：近 7 天聚合（getStarGraph），节点=应用 · 连线=切换次数 */
  const [starGraph, setStarGraph] = useState<StarGraphData | null>(null)
  /** 亮暗模式（星点/底纹透明度自适应；auto 跟随系统） */
  const appearanceMode = useSettingsStore((s) => s.settings.appearanceMode)
  const isDarkMode =
    appearanceMode === 'auto'
      ? typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches
      : appearanceMode === 'dark'
  const [dragSeg, setDragSeg] = useState<number | null>(null)
  const [planSegments, setPlanSegments] = useState<Map<number, string>>(new Map())
  const [dragOverLane, setDragOverLane] = useState<'today' | string | null>(null)

  const lastPresenceRefresh = useRef<number>(0)
  const trailingRefreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  /** 悬浮卡粘滞：鼠标移出段落后短暂延迟再收起，留出移动到卡上的时间 */
  const hoverLeaveTimer = useRef<number | null>(null)
  /** 时间轴自适应宽度：泳道跟随容器宽度（全屏撑满，不再固定 760） */
  const timelineScrollRef = useRef<HTMLDivElement>(null)
  const onRulerWheelRef = useRef<((e: { clientX: number; deltaY: number }) => void) | null>(null)
  // 时间轴区域滚轮 = 缩放（非被动监听，接管页面滚动）
  useEffect(() => {
    const el = timelineScrollRef.current
    if (!el) return
    const handler = (e: WheelEvent) => {
      e.preventDefault()
      const fn = onRulerWheelRef.current
      if (typeof fn === 'function') fn(e)
    }
    el.addEventListener('wheel', handler, { passive: false })
    return () => el.removeEventListener('wheel', handler)
  }, [])
  const [laneW, setLaneW] = useState(LANE_W)
  /** 隐私排除的应用（时间轴末尾管理区 + 刷新过滤共用） */
  const excludedApps = useSettingsStore((s) => s.settings.privacyExcludedApps ?? [])

  const refresh = useCallback(() => {
    void (async () => {
      const t = await window.api?.getTrail?.() as MergedTrail | undefined
      const p = await window.api?.listPlans?.(dateKey(Date.now())) as PlanItem[] | undefined
      // 应用图标/主题色缓存（监控识别新应用时主进程会增量写入）
      window.api?.getAppVisuals?.().then((v) => setAppVisuals((v as Record<string, { iconDataUrl: string; themeColor: string }>) ?? {})).catch(() => undefined)
      // 近 7 天 trail（洞察卡同期对比用）
      const days: (MergedTrail | null)[] = []
      for (let i = 1; i <= 7; i++) {
        const d = new Date()
        d.setDate(d.getDate() - i)
        days.push((await window.api?.getTrail?.(dateKey(d.getTime()))) as MergedTrail | null)
      }
      setRecentTrails(days.filter((x): x is MergedTrail => !!x && !!x.segments?.length))
      if (t) {
        setTrail(t)
        // 隐私排除的应用不再进入时间轴/星图（0 采集；历史数据也一并隐去）
        const excludedApps = useSettingsStore.getState().settings.privacyExcludedApps ?? []
        const isExcluded = (app?: string | null) => !!app && matchesExcludedApp(app, excludedApps)
        // 只保留「有实际工作」的段：过滤短切换(<30s glance)、前台无操作(idle/away)
        const segs = t.segments.filter((s) => s.durationMin > 0 && !s.glance && s.mainState !== 'idle' && s.mainState !== 'away' && !isExcluded(s.mainApp) && !isExcluded(s.auxApp))
        // 工作/摸鱼归属：用户自定义优先，否则按状态默认
        const colOverride = useSettingsStore.getState().settings.appColumnOverride
        const colOf = (app: string, def: Column): Column => {
          const k = app.trim().toLowerCase().replace(/\.exe$/i, '')
          const v = colOverride?.[k]
          return v === 'work' || v === 'life' ? v : def
        }
        // 主屏 + 副屏都进今日池：副屏重要工作（如 opencode）也显示为独立行，双屏并行一眼看清
        const list: GraphItem[] = []
        for (const s of segs) {
          list.push({ seg: s, channel: mapChannel(s.mainApp), column: colOf(s.mainApp, WORK_LIKE_STATES.includes(s.mainState) ? 'work' : 'life') })
          if (s.auxApp && s.auxApp !== s.mainApp && !isExcluded(s.auxApp)) {
            const auxSeg: TrailSegment = { ...s, id: s.id + ':aux', mainApp: s.auxApp, mainState: s.auxState ?? 'other', mainTitle: s.auxTitle ?? '' }
            ;(auxSeg as TrailSegment & { aux?: boolean }).aux = true // 标记副屏复制段：总时长/星图聚合不计入，防双屏重复累计
            list.push({ seg: auxSeg, channel: mapChannel(auxSeg.mainApp), column: colOf(auxSeg.mainApp, WORK_LIKE_STATES.includes(auxSeg.mainState) ? 'work' : 'life') })
          }
        }
        setItems(list)
        if (p) setPlans(p)
      }
      const d = new Date()
      setNowMin(d.getHours() * 60 + d.getMinutes())
    })()
  }, [])

  useEffect(() => {
    void window.api?.getSegmentPlans?.().then((links) => {
      const list = (links as Array<{ segStartTs: number; planId: string }>) ?? []
      if (list.length) setPlanSegments(new Map(list.map((l) => [l.segStartTs, l.planId])))
    }).catch(() => undefined)
  }, [])

  // 近 30 天 trail：KPI 卡「同时段均值」基线数据源（现有 getTrail 日聚合，仅首次加载）
  useEffect(() => {
    void (async () => {
      const days: (MergedTrail | null)[] = []
      for (let i = 1; i <= 30; i++) {
        const d = new Date()
        d.setDate(d.getDate() - i)
        try {
          days.push((await window.api?.getTrail?.(dateKey(d.getTime()))) as MergedTrail | null)
        } catch {
          days.push(null)
        }
      }
      setRecentTrails30(days.filter((x): x is MergedTrail => !!x && !!x.segments?.length))
    })()
  }, [])

  // 注意力评分：今日 + 近 8 天走势（与报表页同一口径；缺失则 KPI 卡回退 AI 协作时长）
  useEffect(() => {
    Promise.all([window.api.todayAttention?.(), window.api.rangeAttention?.(8)])
      .then(([a, h]) => {
        if (!a) return
        setAttention({ today: a as AttentionScore, history: (h as AttentionScore[] | undefined) ?? [] })
      })
      .catch(() => setAttention(null))
  }, [])

  // v6 星图数据：近 7 天聚合（应用节点 + 切换连线），仅首次加载
  useEffect(() => {
    window.api?.getStarGraph?.(7)
      ?.then((g) => setStarGraph(g as StarGraphData))
      .catch(() => undefined)
  }, [])

  // NOW 竖线每分钟自动更新
  useEffect(() => {
    const t = setInterval(() => {
      const d = new Date()
      setNowMin(d.getHours() * 60 + d.getMinutes())
    }, 60000)
    return () => clearInterval(t)
  }, [])

  // 时间轴泳道自适应容器宽度（全屏撑满）
  useEffect(() => {
    const el = timelineScrollRef.current
    if (!el) return
    const update = () => setLaneW(Math.max(560, el.clientWidth - LABEL_W))
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    refresh()
    const poll = setInterval(refresh, 30000)
    const off = window.api?.onPresence?.(() => {
      const now = Date.now()
      if (now - lastPresenceRefresh.current >= 2000) {
        lastPresenceRefresh.current = now
        refresh()
      } else {
        if (trailingRefreshTimer.current) clearTimeout(trailingRefreshTimer.current)
        trailingRefreshTimer.current = setTimeout(() => {
          lastPresenceRefresh.current = Date.now()
          refresh()
        }, 2000 - (now - lastPresenceRefresh.current))
      }
    })
    const offPlan = window.api?.onPlanUpdated?.(() => refresh())
    return () => {
      clearInterval(poll)
      off?.()
      offPlan?.()
      if (trailingRefreshTimer.current) clearTimeout(trailingRefreshTimer.current)
    }
  }, [refresh])

  const insightData = useMemo(() => (trail ? insight(trail, recentTrails) : null), [trail, recentTrails])

  /** KPI 趋势：今日专注/摸鱼/AI 分钟 vs 近 30 天「同时段」基线（窗口对齐，等长外推），附近 7 天 spark */
  const kpi = useMemo(() => {
    const dayStartOf = (tr: MergedTrail): number | null => {
      const acts = tr.segments.filter((s) => !s.glance && s.mainState !== 'idle' && s.mainState !== 'away')
      if (!acts.length) return null
      return Math.min(...acts.map((s) => s.startTs))
    }
    const build = (states: string[]) => {
      const dayTotalOf = (tr: MergedTrail) => dayStateMin(tr, states)
      let today = 0
      const per: number[] = [] // 近 30 天同时段值，倒序（[0]=昨天）
      if (trail) {
        const tStart = dayStartOf(trail)
        if (tStart != null) {
          const windowMs = Math.max(60000, Date.now() - tStart)
          today = windowStateMin(trail, states, tStart, windowMs)
          for (const tr of recentTrails30) {
            const dStart = dayStartOf(tr)
            if (dStart == null) continue
            per.push(windowStateMin(tr, states, dStart, windowMs))
          }
        } else {
          today = dayTotalOf(trail)
        }
      }
      const mean = (arr: number[]) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0)
      const pct = (a: number, b: number) => (b > 1 ? Math.round(((a - b) / b) * 100) : null)
      const base: Record<BaselineKey, number> = {
        yest: per[0] ?? 0,
        week: mean(per.slice(0, 7)),
        d30: mean(per),
        best: per.length ? Math.max(...per) : 0
      }
      const delta: Record<BaselineKey, number | null> = {
        yest: pct(today, base.yest),
        week: pct(today, base.week),
        d30: pct(today, base.d30),
        best: pct(today, base.best)
      }
      const spark = [...per.slice(0, 7)].reverse().map((v) => Math.round(v))
      spark.push(Math.round(today))
      return { today: Math.round(today), base, delta, spark }
    }
    return {
      focus: build(['focus', 'coding', 'aidev', 'aiqa']),
      slack: build(['slack', 'relax', 'break', 'lunch']),
      ai: build(['aidev', 'aiqa'])
    }
  }, [trail, recentTrails30])

  /** AI 综合评分 spark：近 8 天评分走势（日期升序 + 今日） */
  const scoreSpark = useMemo(() => {
    if (!attention) return undefined
    const hs = [...(attention.history ?? [])]
      .sort((a, b) => String(a.date).localeCompare(String(b.date)))
      .map((h) => h.finalScore)
    hs.push(attention.today.finalScore)
    return hs.length >= 2 ? hs : undefined
  }, [attention])

  // v6 星图布局：work=左半区 / play=右半区，各自按 sec 降序环形散布（weight1 居中）
  const starPlanets = useMemo(() => (starGraph ? layoutStarCluster(starGraph.nodes) : []), [starGraph])
  const planetPos = useMemo(() => new Map(starPlanets.map((p) => [p.app, p])), [starPlanets])

  /** v6 连线：亮度/粗细 ∝ 切换次数（rgba(139,92,246,α)，α=0.25+count/max*0.6；宽 1+count/max*1.5） */
  const starEdges = useMemo(() => {
    if (!starGraph) return []
    const maxCount = Math.max(1, ...starGraph.edges.map((e) => e.count))
    return starGraph.edges
      .map((e) => {
        const a = planetPos.get(e.from)
        const b = planetPos.get(e.to)
        if (!a || !b) return null
        return {
          key: `${e.from}→${e.to}`,
          from: e.from,
          to: e.to,
          count: e.count,
          x1: a.x, y1: a.y, x2: b.x, y2: b.y,
          alpha: 0.25 + (e.count / maxCount) * 0.6,
          width: 1 + (e.count / maxCount) * 1.5,
        }
      })
      .filter((e): e is NonNullable<typeof e> => e !== null)
  }, [starGraph, planetPos])

  /** 星空底：确定性伪随机小星点（绝对定位 span），亮色模式透明度降低 */
  const starDots = useMemo(() => {
    let seed = 20260903
    const rnd = () => {
      seed = (seed * 16807) % 2147483647
      return seed / 2147483647
    }
    return Array.from({ length: 56 }, () => ({ x: rnd() * 100, y: rnd() * 100, s: rnd() > 0.86 ? 2 : 1, o: 0.12 + rnd() * 0.5 }))
  }, [])

  const startMinOf = (seg: TrailSegment) => {
    const d = new Date(seg.startTs)
    return d.getHours() * 60 + d.getMinutes()
  }

  const todaySegs = useMemo(
    () => items.filter(i => !planSegments.has(i.seg.startTs)),
    [items, planSegments]
  )

  // 今日：按产品(mainApp)分行，每行一个产品；某产品块全部关联后该行自然消失
  const todayByApp = useMemo(() => {
    const m = new Map<string, GraphItem[]>()
    for (const i of todaySegs) {
      const k = i.seg.mainApp
      if (!m.has(k)) m.set(k, [])
      m.get(k)!.push(i)
    }
    return [...m.entries()]
  }, [todaySegs])

  const getPlanSegs = useCallback((planId: string) =>
    items.filter(i => planSegments.get(i.seg.startTs) === planId),
    [items, planSegments]
  )

  // 计划三类型分流：reminder 走里程碑轨道，phase 走泳道，task 不显示
  const reminders = useMemo(() => plans.filter(p => (p.planType ?? 'phase') === 'reminder' && p.startMin != null), [plans])
  const phasePlans = useMemo(() => plans.filter(p => (p.planType ?? 'phase') === 'phase'), [plans])

  const ruler = useMemo(() => {
    const lo = rangeLo, hi = rangeHi
    const PAD = 8, W = laneW, span = hi - lo || 1
    return {
      lo, hi,
      minToX: (m: number) => PAD + ((m - lo) / span) * (W - PAD * 2),
      durToW: (dur: number) => Math.max(2, (dur / span) * (W - PAD * 2)),
    }
  }, [items, plans, rangeLo, rangeHi, laneW])

  const renderSegBlock = useCallback((seg: TrailSegment, left: number, width: number) => {
    const app = displayApp(seg.mainApp)
    const ma = (seg as any).microActivity
    const sense = senseOf(seg.mainState)
    const ghost = dragTs === seg.startTs
    const glance = !!seg.glance
    // v6 色块：按语义渐变 — 工作=青绿→青 / 摸鱼=琥珀 / 其他=中性面板色（token，亮暗模式自适应）
    const grad = sense === 'work'
      ? 'linear-gradient(90deg, #0fb5a4, #22d3ee)'
      : sense === 'slack'
        ? 'linear-gradient(90deg, #f59e0b, #fbbf24)'
        : 'var(--surface-3)'
    const glow = sense === 'work' ? 'rgba(15,181,164,0.30)' : sense === 'slack' ? 'rgba(245,158,11,0.28)' : 'rgba(100,116,139,0.20)'
    const blockText = sense === 'work' ? '#ffffff' : sense === 'slack' ? '#451a03' : 'var(--text-2)'
    const accent = sense === 'other' ? 'var(--text-3)' : 'rgba(255,255,255,0.45)'
    const baseShadow = `0 1px 5px ${glow}`
    const hoverShadow = `0 5px 14px ${glow}`
    return (
      <div key={seg.startTs}
        draggable
        onDragStart={e => {
          e.dataTransfer.setData('text/start-ts', String(seg.startTs))
          e.dataTransfer.effectAllowed = 'move'
          const img = makeDragImage(app, ma); e.dataTransfer.setDragImage(img, 8, 12)
          setTimeout(() => img.remove(), 0)
          setTlHover(null); setDragTs(seg.startTs)
        }}
        onDragEnd={() => { setDragTs(null); setDragOverLane(null) }}
        onMouseEnter={e => {
          if (dragTs) return
          if (hoverLeaveTimer.current) { window.clearTimeout(hoverLeaveTimer.current); hoverLeaveTimer.current = null }
          setTlHover({ seg, rect: e.currentTarget.getBoundingClientRect(), mouse: { x: e.clientX, y: e.clientY } })
          if (!ghost) { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = hoverShadow }
        }}
        onMouseLeave={e => {
          hoverLeaveTimer.current = window.setTimeout(() => setTlHover(null), 400)
          e.currentTarget.style.transform = ''
          e.currentTarget.style.boxShadow = baseShadow
        }}
        title={`${app}${ma ? ' · ' + ma : ''} · ${fmtTime(seg.startTs)}${glance ? ' · 短切换' : ''}`}
        style={{ position: 'absolute', left, width, top: 6, bottom: 6,
                 background: ghost ? 'rgba(136,135,128,0.12)' : grad,
                 border: ghost ? '1px dashed var(--tl-other-stroke)' : 'none',
                 borderRadius: 999,
                 cursor: dragTs ? 'grabbing' : 'grab',
                 opacity: ghost ? 0.4 : glance ? 0.45 : 1,
                 transition: 'opacity .12s, box-shadow .15s, transform .15s',
                 boxShadow: ghost ? 'none' : baseShadow,
                 display: 'flex', alignItems: 'center', justifyContent: 'center',
                 overflow: 'hidden' }}
      >
        {!ghost && (
          <span style={{ position: 'absolute', left: 0, top: 5, bottom: 5, width: 3, borderRadius: 2,
                         background: accent, opacity: 0.9, pointerEvents: 'none' }} />
        )}
        {!ghost && !glance && width > 44 && (
          <span style={{
            fontSize: 11, fontWeight: 600,
            color: blockText,
            textShadow: sense === 'slack' ? 'none' : '0 1px 3px rgba(0,0,0,0.2)',
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            padding: '0 4px', pointerEvents: 'none',
          }}>
            {app.length > Math.floor(width / 7) ? app.slice(0, Math.floor(width / 7) - 1) + '…' : app}
          </span>
        )}
      </div>
    )
  }, [setTlHover, dragTs])

  const rangeRef = useRef<HTMLDivElement>(null)
  const hourTicks = useMemo(() => {
    const arr: number[] = []
    const start = Math.ceil(rangeLo / 60) * 60
    for (let t = start; t <= rangeHi; t += 60) arr.push(t)
    return arr
  }, [rangeLo, rangeHi])
  const halfHourTicks = useMemo(() => hourTicks.flatMap((h) => [h + 30, h + 60]).filter((x) => x >= rangeLo && x <= rangeHi), [hourTicks, rangeLo, rangeHi])
  const fmtHHMM = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
  const panRef = useRef<{ x: number; lo: number; hi: number } | null>(null)

  // 时间轴平移：在刻度条空白处按住拖动，整体平移可视时间范围
  const onRulerPointerDown = (e: React.PointerEvent) => {
    e.preventDefault()
    const el = rangeRef.current; if (!el) return
    el.setPointerCapture(e.pointerId)
    panRef.current = { x: e.clientX, lo: rangeLo, hi: rangeHi }
  }
  const onRulerPointerMove = (e: React.PointerEvent) => {
    if (!panRef.current) return
    const el = rangeRef.current; if (!el) return
    const rect = el.getBoundingClientRect()
    const span = panRef.current.hi - panRef.current.lo
    const dt = -((e.clientX - panRef.current.x) / rect.width) * span
    let lo = panRef.current.lo + dt
    let hi = panRef.current.hi + dt
    if (lo < 0) { lo = 0; hi = span }
    if (hi > 1440) { hi = 1440; lo = 1440 - span }
    setRangeLo(Math.round(lo))
    setRangeHi(Math.round(hi))
  }
  const onRulerPointerUp = (e: React.PointerEvent) => {
    panRef.current = null
    const el = rangeRef.current
    try {
      if (el?.hasPointerCapture?.(e.pointerId)) el.releasePointerCapture(e.pointerId)
    } catch { /* ignore */ }
  }

  // 滚轮缩放：以鼠标位置为中心缩放时间范围
  const onRulerWheel = (e: React.WheelEvent) => {
    // 注意：合成 wheel 监听是 passive 的，这里不做 preventDefault（时间轴卡片自身不滚动页面）
    const el = rangeRef.current; if (!el) return
    const rect = el.getBoundingClientRect()
    const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width))
    const anchor = rangeLo + ratio * (rangeHi - rangeLo)
    const factor = e.deltaY < 0 ? 0.85 : 1.18
    let lo = anchor - (anchor - rangeLo) * factor
    let hi = anchor + (rangeHi - anchor) * factor
    const minSpan = 60
    if (hi - lo < minSpan) { lo = anchor - minSpan / 2; hi = anchor + minSpan / 2 }
    if (hi - lo > 1440) { lo = 0; hi = 1440 }
    if (lo < 0) { hi -= lo; lo = 0 }
  onRulerWheelRef.current = onRulerWheel as unknown as (e: { clientX: number; deltaY: number }) => void
    if (hi > 1440) { lo -= (hi - 1440); hi = 1440 }
    setRangeLo(Math.round(lo))
    setRangeHi(Math.round(hi))
  }

  const clampRange = (lo: number, hi: number) => {
    const span = hi - lo
    if (span >= 1440) return { lo: 0, hi: 1440 }
    let a = lo, b = hi
    if (a < 0) { a = 0; b = span }
    if (b > 1440) { b = 1440; a = 1440 - span }
    return { lo: Math.round(a), hi: Math.round(b) }
  }

  // 缩放档位：以当前范围中心为锚，缩放到目标跨度
  const zoomToSpan = (span: number) => {
    const center = (rangeLo + rangeHi) / 2
    const r = clampRange(center - span / 2, center + span / 2)
    setRangeLo(r.lo)
    setRangeHi(r.hi)
  }

  // 回到现在：让「现在」绿线居中
  const centerOnNow = () => {
    const span = rangeHi - rangeLo
    const r = clampRange(nowMin - span / 2, nowMin + span / 2)
    setRangeLo(r.lo)
    setRangeHi(r.hi)
  }

  const handleAssignPlan = useCallback(async (planId: string | null, startTs?: number) => {
    const ts = startTs ?? dragSeg
    if (ts === null || ts === undefined) return
    await window.api?.assignSegmentPlan?.(ts, planId)
    if (planId) {
      setPlanSegments(prev => { const next = new Map(prev); next.set(ts, planId); return next })
    } else {
      setPlanSegments(prev => { const next = new Map(prev); next.delete(ts); return next })
    }
    setDragSeg(null)
  }, [dragSeg])

  /** 不再记录某个程序：弹确认框，确认后加入隐私排除列表并移出时间轴 */
  const [confirmExclude, setConfirmExclude] = useState<TrailSegment | null>(null)
  const doExclude = useCallback((seg: TrailSegment) => {
    const app = seg.mainApp
    const st = useSettingsStore.getState()
    const cur = st.settings.privacyExcludedApps ?? []
    if (!cur.includes(app)) void st.patch({ privacyExcludedApps: [...cur, app] })
    setItems((prev) => prev.filter((i) => i.seg.mainApp !== app))
    setTlHover(null)
  }, [])

  /** 恢复记录某个程序：从排除列表移除（隐私页同列表，双向联动），并刷新时间轴 */
  const restoreExcluded = useCallback((app: string) => {
    const st = useSettingsStore.getState()
    const cur = st.settings.privacyExcludedApps ?? []
    void st.patch({ privacyExcludedApps: cur.filter((a) => a !== app) })
    refresh()
  }, [refresh])

  /** 分类分组：今日操作按分类分组展示，组可展开/收起 */
  const [openCats, setOpenCats] = useState<Set<AppCategory>>(new Set())
  const toggleCat = (c: AppCategory) => setOpenCats((prev) => {
    const next = new Set(prev)
    if (next.has(c)) next.delete(c); else next.add(c)
    return next
  })
  /** 应用行 → 分类：先按 override，再按默认 */
  const catOf = (app: string) => categoryOfWithOverride(app, override)
  /** 拖拽归类：把应用拖到某个分类，持久化 override */
  const [catDragApp, setCatDragApp] = useState<string | null>(null)
  const setAppCategory = useCallback((app: string, cat: AppCategory) => {
    const st = useSettingsStore.getState()
    const key = app.trim().toLowerCase().replace(/\.exe$/i, '')
    const cur = { ...(st.settings.appCategoryOverride ?? {}) }
    cur[key] = cat
    void st.patch({ appCategoryOverride: cur })
  }, [])

  /** 按分类分组：cat → 应用行列表（组内/组间按时长降序）；recent=最近 20 分钟内有活动 */
  const todayByCategory = useMemo(() => {
    const recentCut = Date.now() - 20 * 60 * 1000
    const m = new Map<AppCategory, [string, GraphItem[]][]>()
    const recentSet = new Set<AppCategory>()
    for (const [app, segsArr] of todayByApp) {
      const cat = catOf(app)
      if (!m.has(cat)) m.set(cat, [])
      m.get(cat)!.push([app, segsArr])
      if (segsArr.some((g) => g.seg.endTs >= recentCut)) recentSet.add(cat)
    }
    const sumOf = (apps: [string, GraphItem[]][]) => apps.reduce((s, [, x]) => s + x.reduce((t, g) => t + g.seg.durationMin, 0), 0)
    const rows = [...m.entries()].map(([cat, apps]) => ({
      cat,
      apps: apps.sort((a, b) => sumOf([b]) - sumOf([a])),
      min: sumOf(apps),
      recent: recentSet.has(cat)
    }))
    return rows.sort((a, b) => b.min - a.min)
  }, [todayByApp, override]) // eslint-disable-line react-hooks/exhaustive-deps

  // 首次加载后，默认展开最近 20 分钟涉及到的分类
  const catInitRef = useRef(false)
  useEffect(() => {
    if (catInitRef.current || todayByCategory.length === 0) return
    catInitRef.current = true
    const recentCats = todayByCategory.filter((g) => g.recent).map((g) => g.cat)
    if (recentCats.length > 0) setOpenCats(new Set(recentCats))
  }, [todayByCategory])

  // TODO: 节点拖拽重排 / 跨星团移动（v6 暂不实现，仅 hover 联动高亮）

  /** v6 星图节点：应用圆 + 应用名 + 时长 chip + W1/W2(P1/P2) 角标，hover 联动高亮相连边 */
  const renderPlanet = (p: StarPlanet) => {

    const hovered = starHover === p.app
    const dimmed = starHover !== null && !hovered && !starEdges.some((e) => (e.from === starHover && e.to === p.app) || (e.to === starHover && e.from === p.app))
    const visualKey = p.app.trim().toLowerCase().replace(/\.exe$/i, '')
    const visual = appVisuals[visualKey]
    const badge = `#${p.weight}`
    const nameColor = isDarkMode ? '#cbd5e1' : '#475569'
    return (
      <div
        key={p.app}
        className="absolute flex flex-col items-center transition-opacity duration-200"
        style={{
          left: `${p.x}%`, top: `${p.y}%`, transform: 'translate(-50%, -50%)',
          zIndex: p.weight === 1 ? 8 : 6,
          opacity: dimmed ? 0.35 : 1,
        }}
        onMouseEnter={() => setStarHover(p.app)}
        onMouseLeave={() => setStarHover(null)}
        title={`${displayApp(p.app)} · ${fmtDur(p.sec / 60)} · 停留 #${p.weight}`}
      >
        <div
          className="relative flex items-center justify-center rounded-full transition-transform duration-200"
          style={{
            width: p.size, height: p.size,
            background: starClusterRgba('work', 0.15),
            border: `1px solid ${starClusterRgba('work', hovered ? 0.75 : 0.45)}`,
            boxShadow: hovered ? `0 0 14px ${starClusterRgba('work', 0.5)}` : `0 0 8px ${starClusterRgba('work', 0.22)}`,
            scale: hovered ? '1.12' : '1',
          }}
        >
          {visual ? (
            <img src={visual.iconDataUrl} alt="" className="h-full w-full object-contain" draggable={false} style={{ padding: 4 }} />
          ) : (
            <span style={{ fontSize: Math.max(10, p.size * 0.4), fontWeight: 600, color: starClusterRgba('work', 0.95), pointerEvents: 'none' }}>
              {displayApp(p.app).replace(/\.exe$/i, '').slice(0, 1)}
            </span>
          )}
          {p.weight <= 2 && (
            <span
              className="absolute rounded-full font-bold"
              style={{
                top: -5, right: -6, fontSize: 8, lineHeight: '14px', padding: '0 4px',
                background: starClusterRgba('work', 0.9), color: '#ffffff',
                boxShadow: `0 0 6px ${starClusterRgba('work', 0.55)}`,
              }}
            >
              {badge}
            </span>
          )}
        </div>
        <span
          className="mt-1 max-w-[104px] truncate text-center text-[10px] leading-tight"
          style={{ color: hovered ? (isDarkMode ? '#f1f5f9' : '#0f172a') : nameColor, pointerEvents: 'none' }}
        >
          {displayApp(p.app)}
        </span>
        <span
          className="mt-0.5 rounded-full px-1.5 text-[9px] leading-4 tabular-nums"
          style={{
            background: isDarkMode ? 'rgba(255,255,255,0.08)' : 'rgba(15,23,42,0.06)',
            color: starClusterRgba('work', isDarkMode ? 0.95 : 0.9),
            pointerEvents: 'none',
          }}
        >
          {fmtDur(p.sec / 60)}
        </span>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col gap-4 overflow-auto">
      {/* 编辑布局：大卡片 + 拖拽排序 */}
      {editing ? (
        <div className="glass-card anim-scale-in sticky top-0 z-20 flex flex-col gap-3 !p-4" style={{ boxShadow: 'var(--shadow-md)' }}>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[13px] font-semibold text-slate-100">首页布局</span>
            <span className="text-[11px] text-slate-500">拖拽左侧把手调整顺序 · 点开关显隐 · 自动记住</span>
            <button className="glass-btn primary ml-auto !px-3 !py-1 !text-[11px]" onClick={() => setEditing(false)}>
              完成
            </button>
          </div>
          <div className="flex flex-col gap-2">
            {homeOrder.map((key) => {
              const meta = metaOf(key)
              const on = !!widgets[key]
              const dragging = dragKey === key
              const over = dragOverKey === key && dragKey && dragKey !== key
              return (
                <div
                  key={key}
                  draggable
                  onDragStart={(e) => {
                    setDragKey(key)
                    e.dataTransfer.effectAllowed = 'move'
                    e.dataTransfer.setData('text/home-block', key)
                  }}
                  onDragEnd={() => {
                    setDragKey(null)
                    setDragOverKey(null)
                  }}
                  onDragOver={(e) => {
                    e.preventDefault()
                    e.dataTransfer.dropEffect = 'move'
                    setDragOverKey(key)
                  }}
                  onDrop={(e) => {
                    e.preventDefault()
                    const from = (e.dataTransfer.getData('text/home-block') || dragKey) as HomeBlockKey | null
                    if (from) reorderBlock(from, key)
                    setDragKey(null)
                    setDragOverKey(null)
                  }}
                  className={`flex items-stretch gap-3 rounded-xl border px-3 py-2.5 transition-all ${
                    dragging ? 'opacity-40' : over ? 'border-[var(--border-active)] bg-[var(--accent-softer)]' : 'border-[var(--line)] bg-[var(--surface-2)]'
                  } ${on ? '' : 'opacity-55'}`}
                >
                  <div
                    className="flex cursor-grab items-center px-1 text-slate-500 active:cursor-grabbing"
                    title="拖动排序"
                    aria-label="拖动排序"
                  >
                    <span className="select-none text-[14px] leading-none tracking-tighter">⠿</span>
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[13px] font-semibold text-slate-100">{meta.label}</span>
                      <span
                        className="rounded-md px-1.5 py-0.5 text-[10px] font-bold"
                        style={{
                          background: meta.size === '整行' ? 'rgba(15,181,164,0.18)' : 'rgba(139,92,246,0.18)',
                          color: meta.size === '整行' ? 'var(--teal-deep)' : '#c4b5fd'
                        }}
                      >
                        {meta.size}
                      </span>
                      <span className="rounded-md border border-white/[0.08] px-1.5 py-0.5 text-[10px] text-slate-500">
                        {meta.group}
                      </span>
                    </div>
                    <div className="mt-0.5 text-[11px] leading-snug text-slate-500">{meta.desc}</div>
                  </div>
                  <button
                    type="button"
                    className={`shrink-0 self-center rounded-lg border px-2.5 py-1 text-[11px] font-semibold ${
                      on
                        ? 'border-[rgba(15,181,164,0.4)] bg-[var(--teal-soft)] text-[var(--teal-deep)]'
                        : 'border-white/10 text-slate-500'
                    }`}
                    onClick={() => setWidget(key, !on)}
                  >
                    {on ? '显示中' : '已隐藏'}
                  </button>
                </div>
              )
            })}
          </div>
          <div className="flex flex-wrap gap-2 border-t border-white/[0.06] pt-2">
            <button
              type="button"
              className="glass-btn !text-[11px]"
              onClick={() => {
                const next = { ...widgets }
                for (const m of HOME_BLOCK_META) next[m.key] = true
                persistLayout(next, homeOrder)
              }}
            >
              全部显示
            </button>
            <button
              type="button"
              className="glass-btn !text-[11px]"
              onClick={() => {
                const next = { ...widgets }
                for (const m of HOME_BLOCK_META) next[m.key] = false
                persistLayout(next, homeOrder)
              }}
            >
              全部隐藏
            </button>
            <button
              type="button"
              className="glass-btn !text-[11px]"
              onClick={() => persistLayout(widgets, [...HOME_BLOCK_META.map((m) => m.key)])}
            >
              恢复默认顺序
            </button>
          </div>
        </div>
      ) : null}

      {renderSlots.map((slot, si) => {
        if (slot.kind === 'monitor') {
          return (
            <section key={`mon-${si}-${slot.keys.join('-')}`} className="flex flex-col gap-4">
              <MonitorView embedded sections={monitorSectionsFor(slot.keys)} sectionOrder={slot.keys} />
            </section>
          )
        }
        if (slot.key === 'insight') {
          return (
      <div key="insight">
      {/* 今日洞察 */}
      <section className="glass-card hoverable">
        <div className="mb-2.5 flex items-center gap-2.5">
          <span
            className="flex h-6 w-6 items-center justify-center rounded-lg border"
            style={{ background: 'var(--accent-softer)', borderColor: 'var(--border-active)', color: 'var(--accent)' }}
          >
            <span className="text-[13px] leading-none">💡</span>
          </span>
          <h3 className="text-[13px] font-semibold text-slate-200">今日洞察</h3>
          {plans.length > 0 ? (
            <span className="text-[11px] text-slate-500">
              计划 {plans.filter((p) => p.status === 'done').length}/{plans.length} 完成
            </span>
          ) : null}
        </div>
        {insightData ? (
          <>
            {/* KPI 三卡（v6 InsightCard）：专注 / 摸鱼 / AI 综合评分（无评分数据时回退「今日 AI 协作时长」） */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <InsightCard
                tone="teal"
                highlight
                icon={<Icon name="target" size={14} />}
                label="专注时长"
                onClick={() => gotoReport('smart')}
                big={<span className="tabular-nums">{fmtMin(kpi.focus.today)}</span>}
                trend={(() => {
                  const d = kpi.focus.delta[baselineKey]
                  return d === null ? undefined : { dir: d >= 0 ? ('up' as const) : ('down' as const), text: `${Math.round(Math.abs(d))}% vs ${BASELINE_SHORT[baselineKey]}`, good: d >= 0 }
                })()}
                base={baselineSource(baselineKey, kpi.focus.base[baselineKey]) + (insightData.windowMin > 0 ? ` · 自 ${insightData.startedAt} 起` : '')}
                spark={kpi.focus.spark}
              />
              <InsightCard
                tone="red"
                icon={<Icon name="activity" size={14} />}
                label="摸鱼 / 分心"
                onClick={() => gotoReport('smart')}
                big={<span className="tabular-nums">{fmtMin(kpi.slack.today)}</span>}
                trend={(() => {
                  const d = kpi.slack.delta[baselineKey]
                  return d === null ? undefined : { dir: d >= 0 ? ('up' as const) : ('down' as const), text: `${Math.round(Math.abs(d))}% vs ${BASELINE_SHORT[baselineKey]}`, good: d <= 0 }
                })()}
                base={baselineSource(baselineKey, kpi.slack.base[baselineKey])}
                spark={kpi.slack.spark}
              />
              {attention?.today ? (
                <InsightCard
                  tone="ai"
                  highlight
                  icon={<span className="text-[13px] leading-none">✦</span>}
                  label="AI 综合评分"
                  onClick={() => gotoReport('ai')}
                  big={
                    <span className="tabular-nums">
                      {attention.today.finalScore}
                      <span className="ml-1 text-[11px] font-bold text-slate-500">/ 1000</span>
                    </span>
                  }
                  trend={(() => {
                    const v = attention.today.vsYesterday
                    return { dir: v >= 0 ? ('up' as const) : ('down' as const), text: `${v >= 0 ? '+' : ''}${Math.round(v)} 分 vs 昨日`, good: v >= 0 }
                  })()}
                  base={`五维加权注意力分 · 等级 ${attention.today.grade} · vs 上周均值 ${attention.today.vsLastWeekAvg >= 0 ? '+' : ''}${Math.round(attention.today.vsLastWeekAvg)}`}
                  spark={scoreSpark}
                />
              ) : (
                <InsightCard
                  tone="ai"
                  highlight
                  icon={<span className="text-[13px] leading-none">✦</span>}
                  label="今日 AI 协作时长"
                  big={<span className="tabular-nums">{fmtMin(kpi.ai.today)}</span>}
                  trend={(() => {
                    const d = kpi.ai.delta[baselineKey]
                    return d === null ? undefined : { dir: d >= 0 ? ('up' as const) : ('down' as const), text: `${Math.round(Math.abs(d))}% vs ${BASELINE_SHORT[baselineKey]}`, good: d >= 0 }
                  })()}
                  base={baselineSource(baselineKey, kpi.ai.base[baselineKey])}
                  spark={kpi.ai.spark}
                />
              )}
            </div>

            {/* 对标基线切换（v6 Seg 分段选择器，联动专注/摸鱼卡趋势徽章） */}
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span className="text-[11px] text-slate-500">对标基线：</span>
              <Seg
                options={[
                  { value: 'yest', label: '昨日同期' },
                  { value: 'week', label: '近7天同期' },
                  { value: 'd30', label: '近30天均值' },
                  { value: 'best', label: '高效日同期' }
                ]}
                value={baselineKey}
                onChange={(v) => setBaselineKey(v as BaselineKey)}
              />
            </div>

            {/* 节奏预测 */}
            {insightData.forecastMin ? (
              <div className="mt-2.5 border-t border-dashed border-white/[0.08] pt-2.5 text-[12px] text-slate-500">
                📈 节奏预测：按当前效率，预计全天 ≈ <b className="text-neon-cyan tabular-nums">{Math.round(insightData.forecastMin)} 分</b>（窗口法外推）
              </div>
            ) : null}

            {/* TOP 应用 */}
            {insightData.topApps.length > 0 ? (
              <div className="mt-3 flex gap-2">
                {insightData.topApps.map((a) => {
                  const ak = a.app.trim().toLowerCase().replace(/\.exe$/i, '')
                  const cat = categoryOfWithOverride(a.app, override)
                  const maxMin = insightData.topApps[0].min || 1
                  return (
                    <div key={a.app} className="min-w-0 flex-1 rounded-lg border border-white/[0.06] px-2.5 py-2" style={{ background: 'rgba(255,255,255,0.02)' }}>
                      <div className="flex items-center gap-1.5 text-[12px] font-semibold text-slate-200">
                        {appVisuals[ak] ? <img src={appVisuals[ak].iconDataUrl} alt="" className="h-3.5 w-3.5 rounded-[3px]" /> : null}
                        <span className="truncate">{displayApp(a.app)}</span>
                      </div>
                      <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-white/[0.06]">
                        <div className="h-full rounded-full" style={{ width: `${(a.min / maxMin) * 100}%`, background: CATEGORY_META[cat].color }} />
                      </div>
                    </div>
                  )
                })}
              </div>
            ) : null}
          </>
        ) : (
          <p className="text-[13px] text-slate-400 leading-relaxed">加载中...</p>
        )}
      </section>
      </div>
          )
        }
        if (slot.key === 'timeline') {
          return (
      <div key="timeline">
      {/* 时间轴 — 水平泳道 */}
      <section className="glass-card">
        <div className="mb-3 flex items-center gap-2.5">
          <span
            className="flex h-6 w-6 items-center justify-center rounded-lg border"
            style={{ background: 'var(--accent-softer)', borderColor: 'var(--border-active)', color: 'var(--accent)' }}
          >
            <Icon name="clock" size={13} />
          </span>
          <span className="text-[13px] font-semibold text-slate-200"><PinnedWidgets trail={trail} />
        时间轴</span>
          <span className="text-[12px] text-slate-500">{plans.length} 计划 · {fmtDur(items.reduce((a, i) => a + i.seg.durationMin, 0))}</span>
          <div className="ml-auto flex items-center gap-2">
            <div className="flex items-center gap-0.5 rounded-lg p-0.5"
              style={{ background: 'var(--tl-lane-today-bg)', border: '0.5px solid var(--tl-lane-border)' }}>
              {ZOOM_STOPS.map((z) => {
                const active = Math.round(rangeHi - rangeLo) === z.span
                return (
                  <button
                    key={z.span}
                    onClick={() => zoomToSpan(z.span)}
                    style={{
                      borderRadius: 5,
                      padding: '2px 8px',
                      fontSize: 11,
                      fontWeight: active ? 500 : 400,
                      background: active ? 'var(--tl-accent)' : 'transparent',
                      color: active ? '#ffffff' : 'var(--tl-ruler-label)',
                      border: 'none',
                      cursor: 'pointer',
                      transition: 'all .12s',
                    }}
                  >
                    {z.label}
                  </button>
                )
              })}
            </div>
            <button onClick={centerOnNow}
              style={{ height: 28, padding: '0 12px', borderRadius: 6, border: '0.5px solid var(--tl-now)', background: 'transparent', color: 'var(--tl-now)', fontSize: 11, fontWeight: 500, cursor: 'pointer' }}
              title="回到当前时间">现在</button>
          </div>
        </div>
          <div ref={timelineScrollRef}
            style={{ overflowX: 'auto', overflowY: 'visible', position: 'relative' }}>
            <div className="relative" style={{ width: LABEL_W + laneW }}>
            <div className="flex items-center mb-1.5">
              <span style={{ width: LABEL_W, fontSize: 11, color: 'var(--tl-ruler-label)', paddingLeft: 8 }} className="shrink-0">{fmtHHMM(rangeLo)}–{fmtHHMM(rangeHi)}</span>
                <div ref={rangeRef} className="relative"
                  style={{ width: laneW, height: 26, cursor: panRef.current ? 'grabbing' : 'grab', touchAction: 'none' }}
                onPointerDown={onRulerPointerDown}
                onPointerMove={onRulerPointerMove}
                onPointerUp={onRulerPointerUp}
                onPointerCancel={onRulerPointerUp}
                onWheel={onRulerWheel}
                title="按住拖动平移时间轴 · 滚轮缩放">
                <div className="absolute left-0 right-0 top-1/2 -translate-y-1/2" style={{ height: 0.5, background: 'var(--tl-ruler-line)' }} />
                {halfHourTicks.map(t => (
                  <div key={'h' + t} className="absolute top-0 bottom-0" style={{ left: ruler.minToX(t) }}>
                    <span className="absolute" style={{ top: 18, left: '50%', transform: 'translateX(-50%)', width: 1, height: 6, background: 'var(--tl-ruler-line)' }} />
                  </div>
                ))}
                {hourTicks.map(t => (
                  <div key={t} className="absolute top-0 bottom-0" style={{ left: ruler.minToX(t) }}>
                    <span className="absolute" style={{ top: 16, left: '50%', transform: 'translateX(-50%)', fontSize: 11, color: 'var(--tl-ruler-label)', fontFamily: 'var(--font-mono, "JetBrains Mono", monospace)', fontVariantNumeric: 'tabular-nums' }}>
                      {String(Math.floor(t / 60))}
                    </span>
                  </div>
                ))}
              </div>
            </div>
            {/* 今日操作区 header：与全局 Section 风格一致，与上方刻度区用分隔线隔开 */}
            <div className="mt-3 mb-2 flex items-center gap-2.5 border-t border-white/[0.05] pt-3">
              <span
                className="flex h-6 w-6 items-center justify-center rounded-lg border"
                style={{ background: 'var(--accent-softer)', borderColor: 'var(--border-active)', color: 'var(--accent)' }}
              >
                <Icon name="activity" size={13} />
              </span>
              <span className="text-[13px] font-semibold text-slate-200">今日操作</span>
              <span className="text-[11px] text-slate-500">按分类聚合 · 可展开应用泳道 · 拖拽归类</span>
            </div>
            {todayByApp.length === 0 ? (
              <div className="flex items-center mb-1.5">
                <span style={{ width: LABEL_W, fontSize: 11, color: 'var(--tl-other-text)', paddingLeft: 8 }} className="shrink-0">今日</span>
                <div className="relative" style={{
                     width: laneW, height: 30, overflow: 'hidden',
                     background: 'transparent',
                     borderBottom: '0.5px solid var(--tl-lane-border)',
                   }}
                  onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setDragOverLane('today') }}
                  onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOverLane(null) }}
                  onDrop={e => {
                    e.preventDefault(); setDragOverLane(null)
                    const ts = parseInt(e.dataTransfer.getData('text/start-ts'))
                    if (!isNaN(ts)) handleAssignPlan(null, ts)
                  }}>
                  <span style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', fontSize: 11, color: 'var(--tl-ruler-label)' }}>今日活动已全部归入计划 ✓</span>
                </div>
              </div>
            ) : (
              <>
                {/* 时间轴按分类聚合：泳道 = 分类，段块按真实时间铺，hover 显示应用详情 */}
                {todayByCategory.map(({ cat, apps, min }) => {
                  const meta = CATEGORY_META[cat]
                  const open = openCats.has(cat)
                  return (
                    <div key={cat} className="mb-1">
                      <div className="flex items-center">
                        {/* 分类标签列：图标 + 分类名 + 时长（点击分类名可展开/收起，拖入归类） */}
                        <span
                          className="flex shrink-0 cursor-pointer items-center gap-1.5 py-1 pr-1"
                          style={{ width: LABEL_W, fontSize: 11, color: meta.color }}
                          onClick={() => toggleCat(cat)}
                          onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move' }}
                          onDrop={(e) => {
                            e.preventDefault()
                            const app = e.dataTransfer.getData('text/app-cat')
                            if (app) setAppCategory(app, cat)
                            setCatDragApp(null)
                          }}
                          title={`${meta.label} · ${apps.length} 个应用 · ${fmtDur(min)} · 点击展开应用泳道，拖入应用可归类`}
                        >
                          <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" style={{ color: meta.color, flexShrink: 0 }}>
                            <use href={`#cat-${cat}`} />
                          </svg>
                          <span className="overflow-hidden text-ellipsis whitespace-nowrap">{meta.label}</span>
                          <span className="shrink-0 text-[10px]" style={{ color: 'var(--tl-ruler-label)' }}>{fmtDur(min)}</span>
                        </span>
                        {/* 分类泳道：段块按真实时间铺 */}
                        <div
                          className="relative"
                          style={{
                            width: laneW, height: 30, overflow: 'hidden',
                            background: hexBg(meta.color, 0.14),
                            borderBottom: '1px dashed rgba(255,255,255,0.05)',
                            transition: 'background .12s',
                          }}
                        >
                          {apps.flatMap(([, segsArr]) => segsArr.map((s) => renderSegBlock(s.seg, ruler.minToX(startMinOf(s.seg)), ruler.durToW(s.seg.durationMin || 0.5))))}
                        </div>
                        {/* 尾部展开按钮 */}
                        <button
                          className="ml-1 flex shrink-0 items-center gap-0.5 rounded px-1.5 py-1 text-[10px] text-slate-500 transition-colors hover:bg-white/[0.05] hover:text-slate-200"
                          onClick={() => toggleCat(cat)}
                          title={open ? '收起应用泳道' : '展开各应用泳道'}
                        >
                          {open ? '收起' : '展开'}
                          <span className={`text-[8px] transition-transform duration-200 ${open ? '' : '-rotate-90'}`}>▶</span>
                        </button>
                      </div>
                      {/* 展开：该分类下各应用独立泳道（每应用一行，段块按真实时间铺） */}
                      {open ? (
                        <div className="anim-fade-in ml-2 mt-0.5 flex flex-col gap-0.5 border-l-2 pl-2" style={{ borderColor: hexBg(meta.color, 0.5) }}>
                          {apps.map(([app, segsArr]) => {
                            const ak = app.trim().toLowerCase().replace(/\.exe$/i, '')
                            const v = appVisuals[ak]
                            const appMin = segsArr.reduce((s, g) => s + g.seg.durationMin, 0)
                            return (
                              <div key={app} className="flex items-center">
                                {/* 应用名标签列（可拖拽归类） */}
                                <span
                                  draggable
                                  onDragStart={(e) => { e.dataTransfer.setData('text/app-cat', app); e.dataTransfer.effectAllowed = 'move'; setCatDragApp(app) }}
                                  onDragEnd={() => setCatDragApp(null)}
                                  className="flex shrink-0 cursor-grab items-center gap-1.5 py-1 pr-1"
                                  style={{ width: LABEL_W, fontSize: 11, color: 'var(--tl-other-text)', opacity: catDragApp === app ? 0.4 : 1 }}
                                  title={`${displayApp(app)}（${meta.label}）· 拖到其他分类可重新归类`}
                                >
                                  {v ? (
                                    <img src={v.iconDataUrl} alt="" className="h-3.5 w-3.5 shrink-0 rounded-[3px]" style={{ background: 'rgba(0,0,0,0.05)' }} draggable={false} />
                                  ) : (
                                    <span className="h-3.5 w-3.5 shrink-0 rounded-[3px]" style={{ background: hexBg(meta.color, 0.3) }} />
                                  )}
                                  <span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">{displayApp(app)}</span>
                                  <span className="shrink-0 text-[10px]" style={{ color: 'var(--tl-ruler-label)' }}>{fmtDur(appMin)}</span>
                                </span>
                                {/* 应用泳道：段块按真实时间铺 */}
                                <div
                                  className="relative"
                                  style={{
                                    width: laneW, height: 26, overflow: 'hidden',
                                    background: 'transparent',
                                    borderBottom: '1px dashed rgba(255,255,255,0.04)',
                                  }}
                                >
                                  {segsArr.map((s) => renderSegBlock(s.seg, ruler.minToX(startMinOf(s.seg)), ruler.durToW(s.seg.durationMin || 0.5)))}
                                </div>
                              </div>
                            )
                          })}
                        </div>
                      ) : null}
                    </div>
                  )
                })}
              </>
            )}
            {/* 里程碑 · 提醒轨道 */}
            {reminders.length > 0 && (
              <>
                <div className="flex items-center gap-1.5 mb-2 mt-3">
                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#A78BFA', display: 'inline-block' }} />
                  <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--tl-ruler-label)' }}>里程碑 · 提醒</span>
                </div>
                <div className="flex items-center mb-1.5">
                  <span style={{ width: LABEL_W, fontSize: 11, color: 'var(--tl-ruler-label)', paddingLeft: 8 }} className="shrink-0">定时提醒</span>
                  <div className="relative" style={{ width: laneW, height: 24, overflow: 'hidden', background: 'transparent', borderBottom: '0.5px dashed var(--tl-lane-border)' }}>
                    {reminders.map(r => {
                      const t = r.startMin
                      if (t === undefined) return null
                      const x = ruler.minToX(t)
                      const rDone = r.status === 'done'
                      const rCancelled = r.status === 'cancelled'
                      return (
                        <div key={r.id} title={`${r.title} · ${fmtHHMM(t)}${rDone ? ' · 已完成' : ''}`}
                             style={{ position: 'absolute', left: x - 5, top: 2, bottom: 2, display: 'flex', alignItems: 'center', gap: 3, pointerEvents: 'auto', cursor: 'pointer' }}
                             onClick={() => void window.api?.setPlanStatus?.(r.id, rDone ? 'planned' : 'done')}>
                          <div style={{ width: 10, height: 10, transform: 'rotate(45deg)', background: rDone ? 'var(--tl-lane-plan-bg)' : '#A78BFA', border: `1px solid ${rDone ? 'var(--tl-lane-border)' : '#7C3AED'}`, borderRadius: 2, opacity: rCancelled ? 0.4 : 1 }} />
                          <span style={{ fontSize: 11, color: rDone ? 'var(--tl-ruler-label)' : '#A78BFA', textDecoration: rDone ? 'line-through' : 'none', whiteSpace: 'nowrap', maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {fmtHHMM(t)} {r.title}
                          </span>
                        </div>
                      )
                    })}
                  </div>
                </div>
              </>
            )}
            {/* 计划泳道区 header */}
            <div className="flex items-center gap-1.5 mb-2 mt-3">
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--tl-now)', display: 'inline-block' }} />
              <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--tl-ruler-label)' }}>计划泳道</span>
            </div>
            {phasePlans.map(plan => {
              const segs = getPlanSegs(plan.id)
              const covered = segs.reduce((a, s) => a + (s.seg.durationMin || 0), 0)
              return (
                <div key={plan.id} className="flex items-center mb-1.5">
                  <span style={{ width: LABEL_W, fontSize: 11, color: STATUS_TEXT[plan.status] || 'var(--tl-other-text)', paddingLeft: 8, display: 'flex', alignItems: 'center', gap: 6 }} className="shrink-0">
                    <i style={{ width: 6, height: 6, borderRadius: '50%', background: STATUS_BORDER[plan.status] || 'var(--tl-lane-border)', flexShrink: 0, display: 'inline-block' }} />
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{plan.title}</span>
                  </span>
                  <div className="relative" style={{
                           width: laneW, height: 30, overflow: 'hidden',
                           background: dragOverLane === plan.id ? 'rgba(55,138,221,0.08)' : 'transparent',
                           borderBottom: '0.5px solid var(--tl-lane-border)',
                           boxShadow: dragOverLane === plan.id ? 'inset 0 -1.5px 0 var(--tl-accent)' : 'none',
                           transition: 'background .12s, box-shadow .12s',
                         }}
                    onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setDragOverLane(plan.id) }}
                    onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOverLane(null) }}
                    onDrop={e => {
                      e.preventDefault(); setDragOverLane(null)
                      const ts = parseInt(e.dataTransfer.getData('text/start-ts'))
                      if (!isNaN(ts)) handleAssignPlan(plan.id, ts)
                    }}>
                    {dragOverLane === plan.id && (
                      <span style={{ position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%,-50%)', background: 'var(--tl-accent)', color: '#fff', fontSize: 11, fontWeight: 500, borderRadius: 999, padding: '2px 8px' }}>松开归入 · {plan.title}</span>
                    )}
                    <div style={{ position: 'absolute', left: ruler.minToX(plan.startMin ?? 0), width: ruler.durToW(plan.durationMin ?? 60),
                                 top: 5, bottom: 5, background: `${STATUS_BG[plan.status] || 'var(--tl-lane-today-bg)'}40`,
                                 borderRadius: 999 }} />
                    {segs.map(s => renderSegBlock(s.seg, ruler.minToX(startMinOf(s.seg)), ruler.durToW(s.seg.durationMin || 0.5)))}
                    <span style={{ position: 'absolute', right: 4, top: '50%', transform: 'translateY(-50%)', fontSize: 11, color: 'var(--tl-ruler-label)' }}>
                      {[
                        plan.startMin != null ? fmtHHMM(plan.startMin) : null,
                        plan.durationMin != null ? `${covered}/${plan.durationMin}m` : null,
                        (plan.completionRatio != null && plan.completionRatio > 0) ? `${Math.round(plan.completionRatio * 100)}%` : null
                      ].filter(Boolean).join(' · ') || '待办'}
                    </span>
                  </div>
                </div>
              )
            })}
            {nowMin >= rangeLo && nowMin <= rangeHi && (() => {
              const x = LABEL_W + ruler.minToX(nowMin)
              return (
                <div style={{ position: 'absolute', left: x, top: 0, bottom: 0,
                              width: 2, background: '#ef4444', borderRadius: 1,
                              boxShadow: '0 0 8px rgba(239,68,68,0.55)',
                              zIndex: 50, pointerEvents: 'none' }}>
                  <div style={{ position: 'absolute', top: 0, left: '50%', transform: 'translateX(-50%)',
                                width: 8, height: 8, borderRadius: '50%', background: '#ef4444',
                                boxShadow: '0 0 6px rgba(239,68,68,0.8)' }} />
                  <div style={{ position: 'absolute', top: 10, left: '50%', transform: 'translateX(-50%)',
                                background: '#ef4444', color: '#ffffff',
                                fontSize: 9, fontWeight: 700, letterSpacing: '0.08em',
                                padding: '1px 6px', borderRadius: 8, whiteSpace: 'nowrap' }}>
                    NOW
                  </div>
                  <div style={{ position: 'absolute', top: 25, left: '50%', transform: 'translateX(-50%)',
                                background: 'rgba(239,68,68,0.14)', color: '#ef4444',
                                fontSize: 10, fontWeight: 600, padding: '0 5px', borderRadius: 6,
                                fontFamily: 'var(--font-mono, "JetBrains Mono", monospace)',
                                fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
                    {String(Math.floor(nowMin / 60)).padStart(2,'0')}:{String(nowMin % 60).padStart(2,'0')}
                  </div>
                  <div style={{ position: 'absolute', bottom: 0, left: -2, width: 6, height: 22,
                                background: 'linear-gradient(to bottom, transparent, #ef4444)', opacity: 0.85 }} />
                </div>
              )
            })()}
            {/* 提醒时间点竖线：与当前时间线一致，临近时闪烁 */}
            {reminders.map(r => {
              const t = r.startMin
              if (t === undefined || t < rangeLo || t > rangeHi || r.status === 'cancelled') return null
              const x = LABEL_W + ruler.minToX(t)
              const color = STATUS_BORDER[r.status] || '#A78BFA'
              const deltaMin = t - nowMin
              const upcoming = deltaMin >= 0 && deltaMin <= 60
              const dur = upcoming ? Math.max(0.4, deltaMin / 12) : 0
              return (
                <div key={`rem-line-${r.id}`} style={{
                  position: 'absolute', left: x, top: 0, bottom: 0, width: 1,
                  background: color, zIndex: 40, pointerEvents: 'none',
                  opacity: r.status === 'done' ? 0.3 : upcoming ? undefined : 0.5,
                  animation: upcoming ? `tl-reminder-pulse ${dur.toFixed(2)}s ease-in-out infinite` : 'none',
                }}>
                  <div style={{ position: 'absolute', top: 0, left: '50%', transform: 'translateX(-50%)',
                                  width: 5, height: 5, borderRadius: '50%', background: color }} />
                </div>
              )
            })}
            {/* 图例行：色块语义 + 今日各分类时长合计（todayByCategory 聚合） */}
            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 pt-2.5" style={{ borderTop: '0.5px dashed var(--tl-lane-border)' }}>
              <span className="flex items-center gap-1.5 text-[10.5px]" style={{ color: 'var(--text-3)' }}>
                <i className="inline-block h-2.5 w-6 rounded-full" style={{ background: 'linear-gradient(90deg,#0fb5a4,#22d3ee)' }} />工作
              </span>
              <span className="flex items-center gap-1.5 text-[10.5px]" style={{ color: 'var(--text-3)' }}>
                <i className="inline-block h-2.5 w-6 rounded-full" style={{ background: 'linear-gradient(90deg,#f59e0b,#fbbf24)' }} />摸鱼
              </span>
              <span className="flex items-center gap-1.5 text-[10.5px]" style={{ color: 'var(--text-3)' }}>
                <i className="inline-block h-2.5 w-6 rounded-full" style={{ background: 'var(--surface-3)', border: '0.5px solid var(--tl-lane-border)' }} />其他
              </span>
              <span className="h-3 w-px" style={{ background: 'var(--tl-lane-border)' }} />
              {todayByCategory.map(({ cat, min }) => (
                <span key={cat} className="flex items-center gap-1 text-[10.5px]" style={{ color: 'var(--text-3)' }} title={`${CATEGORY_META[cat].label} · 今日合计`}>
                  <i className="inline-block h-2 w-2 rounded-full" style={{ background: CATEGORY_META[cat].color }} />
                  {CATEGORY_META[cat].label}
                  <b className="tabular-nums" style={{ color: 'var(--text-2)', fontWeight: 600 }}>{fmtDur(min)}</b>
                </span>
              ))}
            </div>
            {/* 已停止记录：与隐私页排除列表双向联动，可一键恢复 */}
            {excludedApps.length > 0 && (
              <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 pt-2"
                style={{ borderTop: '0.5px solid var(--tl-lane-border)' }}>
                <span className="text-[11px]" style={{ color: 'var(--tl-ruler-label)' }}>
                  <span style={{ color: 'var(--tl-accent)' }}>⛔</span> 已停止记录（点击 ✕ 恢复，与「隐私」页同步）
                </span>
                {excludedApps.map((a) => (
                  <span
                    key={a}
                    className="chip"
                    title={`点击恢复「${displayApp(a)}」的记录`}
                    style={{ cursor: 'pointer' }}
                    onClick={() => restoreExcluded(a)}
                  >
                    {displayApp(a)}
                    <span className="ml-0.5 text-slate-500 transition-colors hover:text-slate-200">✕</span>
                  </span>
                ))}
              </div>
            )}
            </div>
          </div>
      </section>

      {tlHover && createPortal(
        <ActivityHoverCard
          sticky
          onMouseEnter={() => { if (hoverLeaveTimer.current) { window.clearTimeout(hoverLeaveTimer.current); hoverLeaveTimer.current = null } }}
          onMouseLeave={() => setTlHover(null)}
          onExclude={() => setConfirmExclude(tlHover.seg)}
          a={{
            app: displayApp(tlHover.seg.mainApp),
            title: tlHover.seg.mainTitle ?? '(未命名)',
            state: tlHover.seg.mainState,
            startText: fmtTime(tlHover.seg.startTs),
            endText: fmtTime(tlHover.seg.endTs),
            durationText: fmtDur(tlHover.seg.durationMin),
            source: '监控',
            microActivity: (tlHover.seg as any).microActivity ?? null,
            operation: (tlHover.seg as any).operation ?? null,
            counterpart: (tlHover.seg as any).counterpart ?? undefined,
            topic: (tlHover.seg as any).topic ?? undefined,
            mode: 'fixed',
            pos: { x: tlHover.rect.left + tlHover.rect.width / 2, y: tlHover.rect.top },
          }}
        />,
        document.body
      )}

      </div>
          )
        }
        if (slot.key === 'starmap') {
          return (
      <div key="starmap">
      {/* v6 应用星图：星空画布 + 双星团（左=工作 / 右=摸鱼）+ 切换连线（近 7 天聚合） */}
      <section className="glass-card hoverable">
        <div className="flex items-center justify-between mb-2 px-1">
          <div className="flex items-center gap-2">
            <span
              className="flex h-6 w-6 items-center justify-center rounded-lg border"
              style={{ background: 'var(--accent-softer)', borderColor: 'var(--border-active)', color: 'var(--accent)' }}
            >
              <Icon name="chart" size={13} />
            </span>
            <h3 className="text-[13px] font-semibold text-slate-200">应用星图</h3>
            <span className="text-[11px]" style={{ color: 'var(--text-3)' }}>节点大小=时长 · 连线=切换频次</span>
          </div>
          <span className="text-[11px]" style={{ color: 'var(--text-3)' }}>近 {starGraph?.days ?? 7} 天聚合</span>
        </div>
        {/* 星空画布：深色=radial 星云底 + 星点；亮色=淡底 + 低透明星点 */}
        <div
          className="relative overflow-hidden"
          style={{
            minHeight: 360, borderRadius: 12,
            background: isDarkMode
              ? 'radial-gradient(ellipse 55% 75% at 25% 50%, rgba(15,181,164,0.12), transparent 70%), radial-gradient(ellipse 55% 75% at 75% 50%, rgba(139,92,246,0.14), transparent 70%), radial-gradient(circle at 50% 35%, #141d33 0%, #0b101b 100%)'
              : 'radial-gradient(ellipse 55% 75% at 25% 50%, rgba(15,181,164,0.07), transparent 70%), radial-gradient(ellipse 55% 75% at 75% 50%, rgba(139,92,246,0.08), transparent 70%), #f8fafc',
            border: isDarkMode ? '1px solid rgba(255,255,255,0.05)' : '1px solid rgba(15,23,42,0.06)',
          }}
        >
          {/* CSS 生成的小星点（确定性散布，亮色模式透明度降低） */}
          {starDots.map((d, i) => (
            <span
              key={i}
              className="pointer-events-none absolute rounded-full"
              style={{
                left: `${d.x}%`, top: `${d.y}%`, width: d.s, height: d.s,
                background: isDarkMode ? '#dbe4ff' : '#334155',
                opacity: d.o * (isDarkMode ? 1 : 0.32),
              }}
            />
          ))}
          {starGraph === null ? (
            <p className="absolute inset-0 flex items-center justify-center text-[12px]" style={{ color: 'var(--text-3)' }}>星图加载中… ✦</p>
          ) : starPlanets.length === 0 ? (
            <p className="absolute inset-0 flex items-center justify-center text-[12px]" style={{ color: 'var(--text-3)' }}>近 7 天暂无应用数据 ✦</p>
          ) : (
            <>
              {/* 切换连线：亮度/粗细 ∝ count；hover 节点时相连边高亮、其余降到 0.08 */}
              <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none">
                {starEdges.map((e) => {
                  const connected = starHover !== null && (e.from === starHover || e.to === starHover)
                  const opacity = starHover === null ? e.alpha : connected ? Math.max(e.alpha, 0.8) : 0.08
                  return (
                    <line
                      key={e.key} x1={e.x1} y1={e.y1} x2={e.x2} y2={e.y2}
                      vectorEffect="non-scaling-stroke"
                      stroke="rgba(139,92,246,1)"
                      strokeWidth={e.width}
                      opacity={opacity}
                      style={{ transition: 'opacity .15s' }}
                    />
                  )
                })}
              </svg>
              {starPlanets.map((p) => renderPlanet(p))}
            </>
          )}
        </div>
        {/* 图例 */}
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 px-1 text-[11px]" style={{ color: 'var(--text-3)' }}>
          <span className="flex items-center gap-1.5">
            <svg width="26" height="6" className="shrink-0">
              <line x1="1" y1="3" x2="25" y2="3" stroke="rgba(139,92,246,0.85)" strokeWidth="2.5" strokeLinecap="round" />
            </svg>
            线越亮 = 切换越频繁
          </span>
          <span className="opacity-50">·</span>
          <span>
            近 {starGraph?.days ?? 7} 天共 <b className="tabular-nums" style={{ color: 'var(--text-2)' }}>{starGraph?.totalSwitches ?? 0}</b> 次切换
          </span>
          <span className="ml-auto hidden items-center gap-1.5 sm:flex">
            <i className="inline-block h-2 w-2 rounded-full" style={{ background: starClusterRgba('work', 0.85) }} />#N=停留时长排名
          </span>
        </div>
      </section>
      </div>
          )
        }
        return null
      })}

      {/* 底部编辑按钮（小组件管理风格） */}
      {!editing ? (
      <div className="flex items-center justify-center py-1">
        <button
          className="glass-btn !px-3 !py-1.5 !text-[12px]"
          onClick={() => setEditing(true)}
          title="拖拽调整首页模块顺序与显隐"
        >
          <Icon name="sliders" size={12} /> 编辑布局
        </button>
      </div>
      ) : null}

      {/* 不再记录确认弹窗 */}
      <ConfirmDialog
        open={!!confirmExclude}
        title={`不再记录「${confirmExclude ? displayApp(confirmExclude.mainApp) : ''}」？`}
        message="此后该程序将完全停止采集（截屏/OCR/活动），可到「隐私」页恢复。"
        confirmLabel="不再记录"
        danger
        onConfirm={() => { if (confirmExclude) doExclude(confirmExclude); setConfirmExclude(null) }}
        onCancel={() => setConfirmExclude(null)}
      />

    </div>
  )
}

function AttentionPin() {
  const [score, setScore] = useState<number | null>(null)
  useEffect(() => {
    void (window.api as unknown as { todayAttention?: () => Promise<unknown> })?.todayAttention?.().then((r) => {
      const today = (r as { today?: { finalScore?: number } } | null)?.today ?? null
      setScore(today?.finalScore ?? null)
    }).catch(() => undefined)
  }, [])
  return (
    <div className="glass-card p-3">
      <h4 className="text-[11px] text-slate-400 mb-2">注意力评分</h4>
      <div className="text-[20px] font-extrabold tabular-nums text-neon-green">{score ?? '—'}</div>
      <div className="text-[10px] text-slate-500">五维综合（0-1000）</div>
    </div>
  )
}

function PinnedWidgets({ trail }: { trail: MergedTrail | null }) {
  const [pins, setPins] = useState<string[]>(() => { try { return (localStorage.getItem('pinnedWidgets')??'').split(',').filter(Boolean) } catch { return [] } })
  if (!trail || pins.length === 0) return null
  const stateMinutes = trail.stateMinutes as Record<string,number>
  const topApps = Object.entries(trail.segments.filter(s=>!s.glance).reduce<Record<string,number>>((a,s)=>{ a[s.mainApp]=(a[s.mainApp]??0)+s.durationMin; return a },{})).sort((a,b)=>b[1]-a[1]).slice(0,5).map(([a,m])=>({app:a,minutes:m}))

  return (
    <section className="glass-card hoverable">
      <div className="flex items-center gap-2 mb-3">
        <span>📌</span><h3 className="text-[13px] font-semibold text-slate-200">投送的 Widget</h3>
        <span className="text-[11px] text-slate-500 ml-auto">来自报表页的模块</span>
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        {pins.includes('state') && <div className="glass-card p-3"><h4 className="text-[11px] text-slate-400 mb-2">状态分布</h4>{Object.entries(stateMinutes).sort((a,b)=>b[1]-a[1]).slice(0,5).map(([s,m])=><div key={s} className="flex justify-between text-[11px] text-slate-300"><span>{s}</span><span>{Math.round(m)}m</span></div>)}</div>}
        {pins.includes('topapps') && <div className="glass-card p-3"><h4 className="text-[11px] text-slate-400 mb-2">TOP 应用</h4>{topApps.map(a=><div key={a.app} className="flex justify-between text-[11px] text-slate-300"><span>{a.app}</span><span>{Math.round(a.minutes)}m</span></div>)}</div>}
        {pins.includes('attention') && <AttentionPin />}
        {pins.includes('attention') && <AttentionPin />}
      </div>
    </section>
  )
}
