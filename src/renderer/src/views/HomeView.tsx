/**
 * 首页 — 今日图谱 + 工作/生活时间轴（PRD v3.1 G+H）
 */
import { useEffect, useState, useMemo, useCallback, useRef } from 'react'
import { createPortal } from 'react-dom'
import { WORK_LIKE_STATES } from '@shared/stateMeta'
import type { MergedTrail, TrailSegment, WorkState, PlanItem } from '@shared/types'
import { dateKey } from '@shared/trail'
import { ActivityHoverCard } from '../components/ActivityHoverCard'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { Icon } from '../components/Icon'
import { displayApp } from '@shared/appDisplayName'
import { useSettingsStore } from '../stores/settingsStore'
import { CATEGORY_META, categoryOfWithOverride, type AppCategory } from '@shared/appCategory'

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
const fmtMin = (min?: number) =>
  min == null ? '—' : `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`

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

function STATE_TEXT_VAR(seg: TrailSegment): string {
  const s = senseOf(seg.mainState)
  if (s === 'work') return '--tl-work-text'
  if (s === 'slack') return '--tl-slack-text'
  return '--tl-other-text'
}

type SenseKind = 'work' | 'slack' | 'other'
function senseOf(state: WorkState): SenseKind {
  const slackStates: WorkState[] = ['slack', 'relax', 'break', 'lunch', 'idle', 'away']
  if (slackStates.includes(state)) return 'slack'
  if (WORK_LIKE_STATES.includes(state)) return 'work'
  return 'other'
}

/** 时间轴散点语义色（RGB 通道，与星图 chroma 保持一致） */
function CHROMA_OF(seg: TrailSegment): string {
  const s = senseOf(seg.mainState)
  if (s === 'work') return '124 158 255'
  if (s === 'slack') return '255 124 124'
  return '148 163 184'
}

type StarNodeKind = 'core' | 'cat' | 'app'
interface StarNode {
  kind: StarNodeKind
  key: string
  x: number
  y: number
  size: number
  label?: string      // 主星：工作 / 摸鱼
  cat?: AppCategory   // 分类节点
  apps?: number       // 分类下应用数
  item?: GraphItem    // 应用节点
  min: number
}
interface StarConnection { x1: number; y1: number; x2: number; y2: number; level: 1 | 2 }

const sumDur = (list: GraphItem[]) => list.reduce((s, i) => s + i.seg.durationMin, 0)

/** 星图层级布局：主星（工作/摸鱼）→ 子星（分类）→ 最末级（应用） */
function computeStarHierarchy(filtered: GraphItem[], isWork: boolean, override: Record<string, string> | undefined): { nodes: StarNode[]; connections: StarConnection[] } {
  if (filtered.length === 0) return { nodes: [], connections: [] }
  const nodes: StarNode[] = []
  const connections: StarConnection[] = []
  const totalMin = sumDur(filtered)
  // 主星：工作 / 摸鱼
  nodes.push({ kind: 'core', key: isWork ? 'work-core' : 'life-core', x: 50, y: 50, size: 54, label: isWork ? '工作' : '摸鱼', min: totalMin })
  // 按分类聚合
  const byCat = new Map<AppCategory, GraphItem[]>()
  for (const i of filtered) {
    const c = categoryOfWithOverride(i.seg.mainApp, override)
    if (!byCat.has(c)) byCat.set(c, [])
    byCat.get(c)!.push(i)
  }
  const cats = [...byCat.entries()].sort((a, b) => sumDur(b[1]) - sumDur(a[1]))
  const maxCatMin = sumDur(cats[0][1]) || 1
  const CAT_R = 30
  cats.forEach(([cat, items], ci) => {
    const baseAngle = (ci / cats.length) * 2 * Math.PI - Math.PI / 2
    const catMin = sumDur(items)
    const cx = 50 + CAT_R * Math.cos(baseAngle)
    const cy = 50 + CAT_R * Math.sin(baseAngle)
    nodes.push({ kind: 'cat', key: `cat-${cat}`, x: cx, y: cy, size: Math.max(22, Math.round(25 + (catMin / maxCatMin) * 10)), cat, apps: items.length, min: catMin })
    connections.push({ x1: 50, y1: 50, x2: cx, y2: cy, level: 1 })
    // 应用围绕各自分类
    const apps = [...items].sort((a, b) => b.seg.durationMin - a.seg.durationMin)
    const APP_R = 49
    const n = apps.length
    const spread = Math.min(0.4, 0.12 * Math.max(1, n - 1))
    apps.forEach((item, ai) => {
      const aAngle = baseAngle + (n === 1 ? 0 : ((ai - (n - 1) / 2) / Math.max(1, n - 1)) * spread)
      nodes.push({
        kind: 'app',
        key: item.seg.mainApp,
        x: 50 + APP_R * Math.cos(aAngle),
        y: 50 + APP_R * Math.sin(aAngle),
        size: Math.max(16, Math.round(18 + (item.seg.durationMin / (apps[0].seg.durationMin || 1)) * 9)),
        item,
        min: item.seg.durationMin
      })
      connections.push({ x1: cx, y1: cy, x2: 50 + APP_R * Math.cos(aAngle), y2: 50 + APP_R * Math.sin(aAngle), level: 2 })
    })
  })
  return { nodes, connections }
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
  focusMin: number
  topApps: { app: string; min: number }[]
  text: string
  workVsYesterday: number | null // 今日工作 vs 昨日工作百分比变化（null=无昨日数据）
}

function insight(trail: MergedTrail, yesterday: MergedTrail | null): DailyInsight {
  if (!trail || trail.totalMin < 1) {
    return { workMin: 0, slackMin: 0, focusMin: 0, topApps: [], text: '今天刚开始，随着时间推进洞察会自动长出来 ✨', workVsYesterday: null }
  }
  const focusMin = (trail.stateMinutes.focus ?? 0) + (trail.stateMinutes.coding ?? 0) + (trail.stateMinutes.aidev ?? 0) + (trail.stateMinutes.aiqa ?? 0)
  const slackMin = (trail.stateMinutes.slack ?? 0) + (trail.stateMinutes.relax ?? 0) + (trail.stateMinutes.break ?? 0) + (trail.stateMinutes.lunch ?? 0)
  const workMin = trail.totalMin - slackMin - (trail.stateMinutes.idle ?? 0) - (trail.stateMinutes.away ?? 0)
  // TOP 应用
  const appMap = new Map<string, number>()
  for (const s of trail.segments) {
    if (s.glance || s.mainState === 'idle' || s.mainState === 'away') continue
    appMap.set(s.mainApp, (appMap.get(s.mainApp) ?? 0) + s.durationMin)
  }
  const topApps = [...appMap.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([app, min]) => ({ app, min }))
  // 与昨日对比
  let workVsYesterday: number | null = null
  if (yesterday && yesterday.totalMin > 1) {
    const ySlack = (yesterday.stateMinutes.slack ?? 0) + (yesterday.stateMinutes.relax ?? 0) + (yesterday.stateMinutes.break ?? 0) + (yesterday.stateMinutes.lunch ?? 0)
    const yWork = yesterday.totalMin - ySlack - (yesterday.stateMinutes.idle ?? 0) - (yesterday.stateMinutes.away ?? 0)
    if (yWork > 1) workVsYesterday = Math.round(((workMin - yWork) / yWork) * 100)
  }
  // 一句话
  let text: string
  if (focusMin > slackMin * 3 && focusMin > 120) {
    text = `深度工作 ${Math.round(focusMin)} 分钟，占全天 ${Math.round((focusMin / trail.totalMin) * 100)}%，状态很好 🎯`
  } else if (slackMin > trail.totalMin * 0.4) {
    text = `摸鱼 ${Math.round(slackMin)} 分钟（${Math.round((slackMin / trail.totalMin) * 100)}%），要不要拉回一点节奏？`
  } else if (workVsYesterday !== null && workVsYesterday > 20) {
    text = `工作时长比昨天多 ${workVsYesterday}%，节奏不错 👍`
  } else if (workVsYesterday !== null && workVsYesterday < -20) {
    text = `工作时长比昨天少 ${Math.abs(workVsYesterday)}%，注意别太放松～`
  } else {
    text = `一天平稳推进，工作 ${Math.round(workMin)} 分钟，继续保持 👍`
  }
  return { workMin, slackMin, focusMin, topApps, text, workVsYesterday }
}

export default function HomeView() {
  /** 主页模块显隐（类似小组件管理，localStorage 持久化） */
  const [widgets, setWidgets] = useState<{ insight: boolean; timeline: boolean; starmap: boolean }>(() => {
    try {
      const s = localStorage.getItem('homeWidgets')
      if (s) return { insight: true, timeline: true, starmap: true, ...JSON.parse(s) }
    } catch { /* ignore */ }
    return { insight: true, timeline: true, starmap: true }
  })
  const [editing, setEditing] = useState(false)
  const setWidget = (k: 'insight' | 'timeline' | 'starmap', v: boolean) => {
    setWidgets((prev) => {
      const next = { ...prev, [k]: v }
      try { localStorage.setItem('homeWidgets', JSON.stringify(next)) } catch { /* ignore */ }
      return next
    })
  }
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
  const [yesterdayTrail, setYesterdayTrail] = useState<MergedTrail | null>(null)
  const [items, setItems] = useState<GraphItem[]>([])
  const [plans, setPlans] = useState<PlanItem[]>([])
  const [dragFrom, setDragFrom] = useState<{ app: string; col: Column } | null>(null)
  const [hoverCol, setHoverCol] = useState<Column | null>(null)
  const [tlHover, setTlHover] = useState<{ seg: TrailSegment; rect: DOMRect } | null>(null)
  const [nowMin, setNowMin] = useState(() => {
    const d = new Date(); return d.getHours() * 60 + d.getMinutes()
  })
  // 默认以「现在」为核心居中，前后各 3 小时
  const [rangeLo, setRangeLo] = useState(() => Math.max(0, nowMin - 180))
  const [rangeHi, setRangeHi] = useState(() => Math.min(1440, nowMin + 180))
  const [starHover, setStarHover] = useState<string | null>(null)
  const [starHoverRect, setStarHoverRect] = useState<DOMRect | null>(null)
  const [dragSeg, setDragSeg] = useState<number | null>(null)
  const [planSegments, setPlanSegments] = useState<Map<number, string>>(new Map())
  const [dragTs, setDragTs] = useState<number | null>(null)
  const [dragOverLane, setDragOverLane] = useState<'today' | string | null>(null)

  const lastPresenceRefresh = useRef<number>(0)
  const trailingRefreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  /** 悬浮卡粘滞：鼠标移出段落后短暂延迟再收起，留出移动到卡上的时间 */
  const hoverLeaveTimer = useRef<number | null>(null)
  /** 时间轴自适应宽度：泳道跟随容器宽度（全屏撑满，不再固定 760） */
  const timelineScrollRef = useRef<HTMLDivElement>(null)
  const [laneW, setLaneW] = useState(LANE_W)
  /** 隐私排除的应用（时间轴末尾管理区 + 刷新过滤共用） */
  const excludedApps = useSettingsStore((s) => s.settings.privacyExcludedApps ?? [])

  const refresh = useCallback(() => {
    void (async () => {
      const t = await window.api?.getTrail?.() as MergedTrail | undefined
      const p = await window.api?.listPlans?.(dateKey(Date.now())) as PlanItem[] | undefined
      // 应用图标/主题色缓存（监控识别新应用时主进程会增量写入）
      window.api?.getAppVisuals?.().then((v) => setAppVisuals((v as Record<string, { iconDataUrl: string; themeColor: string }>) ?? {})).catch(() => undefined)
      // 昨日对比（洞察卡用）
      const yesterday = new Date()
      yesterday.setDate(yesterday.getDate() - 1)
      const yt = await window.api?.getTrail?.(dateKey(yesterday.getTime())) as MergedTrail | undefined
      if (yt && yt.segments && yt.segments.length > 0) setYesterdayTrail(yt)
      if (t) {
        setTrail(t)
        // 隐私排除的应用不再进入时间轴/星图（0 采集；历史数据也一并隐去）
        const excludedApps = useSettingsStore.getState().settings.privacyExcludedApps ?? []
        const isExcluded = (app?: string | null) => !!app && excludedApps.includes(app)
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

  const totalWorkMin = useMemo(() => items.filter((i) => i.column === 'work').reduce((a, i) => a + i.seg.durationMin, 0), [items])
  const totalLifeMin = useMemo(() => items.filter((i) => i.column === 'life').reduce((a, i) => a + i.seg.durationMin, 0), [items])
  void totalWorkMin; void totalLifeMin
  const insightData = useMemo(() => (trail ? insight(trail, yesterdayTrail) : null), [trail, yesterdayTrail])

  // 星图按应用聚合：一个应用一个节点（累计时长），不用时间段
  const starItems = useMemo(() => {
    const m = new Map<string, GraphItem>()
    for (const i of items) {
      const ex = m.get(i.seg.mainApp)
      if (ex) {
        ex.seg = { ...ex.seg, durationMin: (ex.seg.durationMin ?? 0) + (i.seg.durationMin ?? 0) }
      } else {
        m.set(i.seg.mainApp, { ...i, seg: { ...i.seg } })
      }
    }
    return [...m.values()]
  }, [items])
  const workChart = useMemo(() => computeStarHierarchy(starItems.filter(i => i.column === 'work'), true, override), [starItems, override])
  const lifeChart = useMemo(() => computeStarHierarchy(starItems.filter(i => i.column === 'life'), false, override), [starItems, override])

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
      durToW: (dur: number) => Math.max(16, (dur / span) * (W - PAD * 2)),
    }
  }, [items, plans, rangeLo, rangeHi, laneW])

  const renderSegBlock = useCallback((seg: TrailSegment, left: number, width: number, colorRgb?: string) => {
    const app = displayApp(seg.mainApp)
    const ma = (seg as any).microActivity
    const c = STATE_TEXT_VAR(seg)
    const chroma = colorRgb || CHROMA_OF(seg)
    const ghost = dragTs === seg.startTs
    const glance = !!seg.glance
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
          setTlHover({ seg, rect: e.currentTarget.getBoundingClientRect() })
        }}
        onMouseLeave={() => {
          hoverLeaveTimer.current = window.setTimeout(() => setTlHover(null), 400)
        }}
        title={`${app}${ma ? ' · ' + ma : ''} · ${fmtTime(seg.startTs)}${glance ? ' · 短切换' : ''}`}
        style={{ position: 'absolute', left, width, top: 6, bottom: 6,
                 background: ghost ? 'rgba(136,135,128,0.12)' : `linear-gradient(180deg, rgb(${chroma}/0.36), rgb(${chroma}/0.12))`,
                 border: ghost ? '1px dashed var(--tl-other-stroke)' : 'none',
                 borderRadius: 999,
                 cursor: dragTs ? 'grabbing' : 'grab',
                 opacity: ghost ? 0.4 : glance ? 0.35 : 1,
                 transition: 'opacity .12s, box-shadow .12s',
                 boxShadow: ghost ? 'none' : `0 0 5px rgb(${chroma}/0.22), 0 0 10px rgb(${chroma}/0.06)`,
                 display: 'flex', alignItems: 'center', justifyContent: 'center',
                 overflow: 'hidden' }}
      >
        {!ghost && !glance && width > 44 && (
          <span style={{
            fontSize: 11, fontWeight: 500,
            color: `var(${c})`,
            textShadow: '0 0 8px rgba(0,0,0,0.45)',
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
  const onRulerPointerUp = () => { panRef.current = null }

  // 滚轮缩放：以鼠标位置为中心缩放时间范围
  const onRulerWheel = (e: React.WheelEvent) => {
    e.preventDefault()
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

  const moveItem = useCallback((appKey: string, toCol: Column) => {
    setItems((prev) => prev.map((i) => (i.seg.mainApp === appKey ? { ...i, column: toCol } : i)))
    // 持久化工作/摸鱼归属，refresh 不再还原
    const st = useSettingsStore.getState()
    const k = appKey.trim().toLowerCase().replace(/\.exe$/i, '')
    const cur = { ...(st.settings.appColumnOverride ?? {}) }
    cur[k] = toCol
    void st.patch({ appColumnOverride: cur })
  }, [])

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

  const starDropProps = (col: Column) => ({
    onDragOver: (e: React.DragEvent) => { e.preventDefault(); setHoverCol(col) },
    onDragLeave: () => setHoverCol(null),
    onDrop: () => { if (dragFrom && dragFrom.col !== col) moveItem(dragFrom.app, col); setHoverCol(null); setDragFrom(null) }
  })

  const renderStarNode = (node: StarNode, isWork: boolean) => {
    // 主星：工作 / 摸鱼（不可拖）
    if (node.kind === 'core') {
      const colChroma = isWork ? 'var(--star-work)' : 'var(--star-life)'
      return (
        <div
          key={node.key}
          onMouseEnter={() => setStarHover(node.key)}
          onMouseLeave={() => setStarHover(null)}
          className="absolute flex items-center justify-center rounded-full"
          title={`${node.label} · 共 ${fmtDur(node.min)}`}
          style={{
            left: `${node.x}%`, top: `${node.y}%`,
            width: node.size, height: node.size,
            transform: 'translate(-50%, -50%)',
            background: `radial-gradient(circle at 35% 35%, ${isWork ? 'rgb(124 158 255 / 0.95)' : 'rgb(255 124 124 / 0.95)'}, ${isWork ? 'rgb(124 158 255 / 0.45)' : 'rgb(255 124 124 / 0.45)'})`,
            boxShadow: `0 0 14px ${isWork ? 'rgb(124 158 255 / 0.55)' : 'rgb(255 124 124 / 0.5)'}`,
            zIndex: 10,
            scale: starHover === node.key ? '1.08' : '1',
            border: `1px solid ${isWork ? 'rgb(124 158 255 / 0.4)' : 'rgb(255 124 124 / 0.4)'}`,
            color: '#fff',
            fontSize: 11.5,
            fontWeight: 600,
          }}
        >
          <div className="text-center leading-tight">
            <div>{node.label}</div>
            <div style={{ fontSize: 8.5, fontWeight: 400, opacity: 0.85 }}>{fmtDur(node.min)}</div>
          </div>
        </div>
      )
    }
    // 子星：分类（不可拖，下方显示分类用时）
    if (node.kind === 'cat') {
      const catMeta = CATEGORY_META[node.cat!]
      return (
        <div
          key={node.key}
          className="absolute flex flex-col items-center"
          style={{ left: `${node.x}%`, top: `${node.y}%`, transform: 'translate(-50%, -50%)', zIndex: 6 }}
        >
          <div
            onMouseEnter={() => setStarHover(node.key)}
            onMouseLeave={() => setStarHover(null)}
            className="flex items-center justify-center rounded-full"
            title={`${catMeta.label} · ${node.apps ?? 0} 个应用 · ${fmtDur(node.min)}`}
            style={{
              width: node.size, height: node.size,
              background: hexBg(catMeta.color, 0.28),
              boxShadow: `0 0 10px ${catMeta.color}55`,
              scale: starHover === node.key ? '1.1' : '1',
              border: `1px solid ${catMeta.color}66`,
              cursor: 'default',
            }}
          >
            <svg width={node.size * 0.5} height={node.size * 0.5} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" style={{ color: catMeta.color }}>
              <use href={`#cat-${node.cat}`} />
            </svg>
          </div>
          <span
            className="mt-0.5 rounded-full px-1.5 py-px text-[9px] tabular-nums"
            style={{ background: 'var(--pop-bg)', color: catMeta.color, border: `1px solid ${catMeta.color}44` }}
          >
            {fmtDur(node.min)}
          </span>
        </div>
      )
    }
    // 最末级：应用（可拖到另一列改工作/摸鱼；有真实图标时显示图标+主题色）
    const isDragging = dragFrom?.app === node.key
    const isGlance = !!node.item?.seg.glance
    const visualKey = node.item!.seg.mainApp.trim().toLowerCase().replace(/\.exe$/i, '')
    const visual = appVisuals[visualKey]
    const chroma = (() => {
      const s = senseOf(node.item!.seg.mainState)
      if (s === 'work') return '124 158 255'
      if (s === 'slack') return '255 124 124'
      return isWork ? 'var(--star-work)' : 'var(--star-life)'
    })()
    const nodeColor = visual?.themeColor ?? chroma
    return (
      <div
        key={node.key}
        draggable
        onDragStart={() => setDragFrom({ app: node.key, col: node.item!.column })}
        onDragEnd={() => { setDragFrom(null); setHoverCol(null) }}
        onMouseEnter={(e) => { setStarHover(node.key); setStarHoverRect(e.currentTarget.getBoundingClientRect()) }}
        onMouseLeave={() => { setStarHover(null); setStarHoverRect(null) }}
        className="absolute rounded-full transition-all duration-300 cursor-grab active:cursor-grabbing group"
        style={{
          left: `${node.x}%`, top: `${node.y}%`,
          width: node.size, height: node.size,
          transform: 'translate(-50%, -50%)',
          background: visual ? '#ffffff' : `radial-gradient(circle at 35% 35%, rgb(${chroma}/0.85), rgb(${chroma}/0.35))`,
          boxShadow: `0 0 6px ${nodeColor}/0.45, 0 0 14px ${nodeColor}/0.18`,
          opacity: isDragging ? 0.25 : isGlance ? 0.3 : 1,
          zIndex: 5,
          scale: starHover === node.key ? '1.2' : '1',
          border: `1px solid ${nodeColor}/0.45`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
        }}
      >
        {visual ? (
          <img src={visual.iconDataUrl} alt="" className="h-full w-full object-contain" draggable={false} style={{ padding: 3 }} />
        ) : null}
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col gap-4 overflow-auto">
      {widgets.insight ? (
      <>
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
            <div className="grid grid-cols-3 gap-2">
              <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-2 text-center">
                <div className="text-[15px] font-semibold tabular-nums text-neon-green">{fmtDur(insightData.workMin)}</div>
                <div className="mt-0.5 text-[10px] text-slate-500">工作</div>
              </div>
              <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-2 text-center">
                <div className="text-[15px] font-semibold tabular-nums text-neon-red">{fmtDur(insightData.slackMin)}</div>
                <div className="mt-0.5 text-[10px] text-slate-500">摸鱼</div>
              </div>
              <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-2 text-center">
                <div
                  className="text-[15px] font-semibold tabular-nums"
                  style={{ color: insightData.workVsYesterday === null ? 'var(--text-secondary)' : (insightData.workVsYesterday >= 0 ? 'var(--accent)' : '#f87171') }}
                  title={insightData.workVsYesterday === null ? '暂无昨日数据' : '较昨日工作增减'}
                >
                  {insightData.workVsYesterday === null ? '—' : `${insightData.workVsYesterday >= 0 ? '+' : ''}${insightData.workVsYesterday}%`}
                </div>
                <div className="mt-0.5 text-[10px] text-slate-500">较昨日</div>
              </div>
            </div>
            <p className="mt-2.5 text-[13px] leading-relaxed text-slate-400">{insightData.text}</p>
            {insightData.topApps.length > 0 ? (
              <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                <span className="text-[11px] text-slate-500">TOP：</span>
                {insightData.topApps.map((a) => (
                  <span key={a.app} className="chip">
                    {displayApp(a.app)}
                    <span className="text-slate-500">{fmtDur(a.min)}</span>
                  </span>
                ))}
              </div>
            ) : null}
          </>
        ) : (
          <p className="text-[13px] text-slate-400 leading-relaxed">加载中...</p>
        )}
      </section>
      </>
      ) : null}

      {widgets.timeline ? (
      <>
      {/* 时间轴 — 水平泳道 */}
      <section className="glass-card">
        <div className="mb-3 flex items-center gap-2.5">
          <span
            className="flex h-6 w-6 items-center justify-center rounded-lg border"
            style={{ background: 'var(--accent-softer)', borderColor: 'var(--border-active)', color: 'var(--accent)' }}
          >
            <Icon name="clock" size={13} />
          </span>
          <span className="text-[13px] font-semibold text-slate-200">时间轴</span>
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
          <div ref={timelineScrollRef} style={{ overflowX: 'auto', overflowY: 'visible', position: 'relative' }}>
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
                  const rgb = hexToRgb(meta.color)
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
                          {apps.flatMap(([, segsArr]) => segsArr.map((s) => renderSegBlock(s.seg, ruler.minToX(startMinOf(s.seg)), ruler.durToW(s.seg.durationMin || 30), rgb)))}
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
                                  {segsArr.map((s) => renderSegBlock(s.seg, ruler.minToX(startMinOf(s.seg)), ruler.durToW(s.seg.durationMin || 30), rgb))}
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
                    {segs.map(s => renderSegBlock(s.seg, ruler.minToX(startMinOf(s.seg)), ruler.durToW(s.seg.durationMin || 30)))}
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
                              width: 1, background: 'var(--tl-now)', zIndex: 50, pointerEvents: 'none' }}>
                  <div style={{ position: 'absolute', top: 0, left: '50%', transform: 'translateX(-50%)',
                                width: 7, height: 7, borderRadius: '50%', background: 'var(--tl-now)' }} />
                  <div style={{ position: 'absolute', top: 9, left: '50%', transform: 'translateX(-50%)',
                                background: 'var(--tl-now)', color: '#ffffff',
                                fontSize: 11, fontWeight: 500, padding: '1px 8px', borderRadius: 8,
                                whiteSpace: 'nowrap' }}>
                    {String(Math.floor(nowMin / 60)).padStart(2,'0')}:{String(nowMin % 60).padStart(2,'0')}
                  </div>
                  <div style={{ position: 'absolute', bottom: 0, left: -1.5, width: 4.5, height: 18,
                                background: 'linear-gradient(to bottom, transparent, var(--tl-now))' }} />
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
      </>
      ) : null}

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

      {widgets.starmap ? (
      <>
      {/* 星图 — 主星(工作/摸鱼) → 子星(分类) → 末级(应用) */}
      <section className="star-map glass-card hoverable" style={{ background: 'var(--star-card-bg)' }}>
        <div className="flex items-center justify-between mb-3 px-1">
          <div className="flex items-center gap-2">
            <Icon name="chart" size={16} className="shrink-0" style={{ color: 'var(--star-text)' }} />
            <h3 className="text-[13px] font-semibold" style={{ color: 'var(--star-text)' }}>今日星图</h3>
          </div>
          <span className="text-[11px]" style={{ color: 'var(--star-text-muted)' }}>主星=工作/摸鱼 · 子星=分类 · 末级=应用 · 拖动应用可调整</span>
        </div>
        <div className="relative flex rounded-xl" style={{ minHeight: 340, background: 'var(--star-card-bg)' }}>
          <div className="absolute left-1/2 top-4 bottom-4 border-l-2 border-dashed z-10" style={{ borderColor: 'var(--star-line)' }} />
          {/* 图例 */}
          <div className="absolute bottom-2 left-3 z-20 flex items-center gap-3 text-[10px]" style={{ color: 'var(--star-text-muted)' }}>
            <span className="flex items-center gap-1"><i className="inline-block w-2 h-2 rounded-full" style={{ background: '#7c9eff' }} />工作</span>
            <span className="flex items-center gap-1"><i className="inline-block w-2 h-2 rounded-full" style={{ background: '#ff7c7c' }} />摸鱼</span>
            <span className="flex items-center gap-1"><i className="inline-block w-2 h-2 rounded-full" style={{ background: '#94a3b8' }} />其他</span>
          </div>
          <div className={`relative flex-1 min-h-[340px] transition-colors ${hoverCol === 'work' && dragFrom && dragFrom.col !== 'work' ? 'bg-[rgb(var(--star-work)/0.06)]' : ''}`} style={{ background: 'var(--star-work-bg)' }} {...starDropProps('work')}>
            <svg className="absolute inset-0 w-full h-full pointer-events-none" viewBox="0 0 100 100" preserveAspectRatio="none">
              {workChart.connections.map((c, i) => (
                <line
                  key={i} x1={c.x1} y1={c.y1} x2={c.x2} y2={c.y2}
                  strokeWidth={c.level === 1 ? 0.35 : 0.22}
                  stroke="var(--star-work-line)"
                  strokeDasharray={c.level === 2 ? '1.5 2' : undefined}
                  opacity={c.level === 2 ? 0.55 : 0.8}
                />
              ))}
            </svg>
            {workChart.nodes.length === 0 ? (
              <p className="absolute inset-0 flex items-center justify-center text-[12px]" style={{ color: 'var(--star-text-muted)' }}>从右边拖应用过来 ✦</p>
            ) : workChart.nodes.map(n => renderStarNode(n, true))}
          </div>
          <div className={`relative flex-1 min-h-[340px] transition-colors ${hoverCol === 'life' && dragFrom && dragFrom.col !== 'life' ? 'bg-[rgb(var(--star-life)/0.06)]' : ''}`} style={{ background: 'var(--star-life-bg)' }} {...starDropProps('life')}>
            <svg className="absolute inset-0 w-full h-full pointer-events-none" viewBox="0 0 100 100" preserveAspectRatio="none">
              {lifeChart.connections.map((c, i) => (
                <line
                  key={i} x1={c.x1} y1={c.y1} x2={c.x2} y2={c.y2}
                  strokeWidth={c.level === 1 ? 0.35 : 0.22}
                  stroke="var(--star-life-line)"
                  strokeDasharray={c.level === 2 ? '1.5 2' : undefined}
                  opacity={c.level === 2 ? 0.55 : 0.8}
                />
              ))}
            </svg>
            {lifeChart.nodes.length === 0 ? (
              <p className="absolute inset-0 flex items-center justify-center text-[12px]" style={{ color: 'var(--star-text-muted)' }}>把左边应用拖过来 ✦</p>
            ) : lifeChart.nodes.map(n => renderStarNode(n, false))}
          </div>
        </div>
      </section>
      </>
      ) : null}

      {/* 底部编辑按钮（小组件管理风格） */}
      <div className="flex items-center justify-center py-1">
        <button
          className="glass-btn !px-3 !py-1 !text-[11px]"
          onClick={() => setEditing((e) => !e)}
          title="管理首页模块"
        >
          <Icon name="sliders" size={12} /> {editing ? '完成' : '编辑'}
        </button>
      </div>
      {editing ? (
        <div className="glass-card anim-scale-in flex items-center gap-2 !p-3">
          <span className="text-[12px] font-medium text-slate-300">首页模块：</span>
          <button
            className={`chip ${widgets.insight ? '!text-neon-green' : 'opacity-50'}`}
            onClick={() => setWidget('insight', !widgets.insight)}
          >
            今日洞察 {widgets.insight ? '✓' : '✕'}
          </button>
          <button
            className={`chip ${widgets.timeline ? '!text-neon-green' : 'opacity-50'}`}
            onClick={() => setWidget('timeline', !widgets.timeline)}
          >
            时间轴 {widgets.timeline ? '✓' : '✕'}
          </button>
          <button
            className={`chip ${widgets.starmap ? '!text-neon-green' : 'opacity-50'}`}
            onClick={() => setWidget('starmap', !widgets.starmap)}
          >
            今日星图 {widgets.starmap ? '✓' : '✕'}
          </button>
          <span className="ml-auto text-[10px] text-slate-600">点击切换显隐 · 选择会记住</span>
        </div>
      ) : null}

      {/* 星图应用节点悬浮卡：portal 渲染避免被星图边界裁剪 */}
      {starHover && starHoverRect && (() => {
        const hoverNode = [...workChart.nodes, ...lifeChart.nodes].find((n) => n.kind === 'app' && n.key === starHover)
        if (!hoverNode?.item) return null
        return createPortal(
          <ActivityHoverCard
            a={{
              app: displayApp(hoverNode.item.seg.mainApp),
              title: hoverNode.item.seg.mainTitle ?? '',
              state: hoverNode.item.seg.mainState,
              startText: fmtTime(hoverNode.item.seg.startTs),
              endText: fmtTime(hoverNode.item.seg.endTs),
              durationText: fmtDur(hoverNode.item.seg.durationMin),
              source: '监控',
              microActivity: (hoverNode.item.seg as any).microActivity ?? null,
              operation: (hoverNode.item.seg as any).operation ?? null,
              mode: 'fixed',
              pos: { x: starHoverRect.left + starHoverRect.width / 2, y: starHoverRect.top },
            }}
          />,
          document.body
        )
      })()}

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
      </div>
    </section>
  )
}
