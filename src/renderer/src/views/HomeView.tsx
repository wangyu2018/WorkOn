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
import { displayApp } from '@shared/appDisplayName'
import { useSettingsStore } from '../stores/settingsStore'

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

const LABEL_W = 80
const LANE_W = 760

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

interface StarNode { item: GraphItem; key: string; x: number; y: number; size: number; isCore: boolean }
interface StarConnection { x1: number; y1: number; x2: number; y2: number }

function computeStarLayout(filtered: GraphItem[], allItems: GraphItem[]): { nodes: StarNode[]; connections: StarConnection[] } {
  if (filtered.length === 0) return { nodes: [], connections: [] }
  const sorted = [...filtered].sort((a, b) => b.seg.durationMin - a.seg.durationMin)
  const maxDur = sorted[0].seg.durationMin || 1
  const nodes: StarNode[] = [{ item: sorted[0], key: sorted[0].seg.mainApp, x: 50, y: 50, size: 56, isCore: true }]
  const children = sorted.slice(1)
  const ring1R = 32; const ring1N = Math.min(children.length, 6); const ring2R = 44
  children.forEach((item, i) => {
    const angle = i < ring1N ? (i / ring1N) * 2 * Math.PI - Math.PI / 2 : ((i - ring1N) / Math.max(1, children.length - ring1N)) * 2 * Math.PI - Math.PI / 2 + 0.35
    const radius = i < ring1N ? ring1R : ring2R
    const durRatio = item.seg.durationMin / maxDur
    nodes.push({ item, key: item.seg.mainApp, x: 50 + radius * Math.cos(angle), y: 50 + radius * Math.sin(angle), size: Math.max(20, Math.round(24 + durRatio * 14)), isCore: false })
  })
  const connections: StarConnection[] = nodes.slice(1).map(n => ({ x1: 50, y1: 50, x2: n.x, y2: n.y }))
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

function insight(trail: MergedTrail): string {
  if (!trail || trail.totalMin < 1) return '今天刚开始，随着时间推进图谱会自动长出来 ✨'
  const focusMin = (trail.stateMinutes.focus ?? 0) + (trail.stateMinutes.coding ?? 0)
  const slackMin = (trail.stateMinutes.slack ?? 0) + (trail.stateMinutes.relax ?? 0)
  if (focusMin > slackMin * 3 && focusMin > 120) return `专注力充沛！深度工作 ${Math.round(focusMin)} 分钟 🎯`
  if (slackMin > trail.totalMin * 0.4) return `今天稍微放松了些～要不要定个小目标把节奏拉回来？`
  return `一天平稳推进，继续保持这个状态 👍`
}

export default function HomeView() {
  const [trail, setTrail] = useState<MergedTrail | null>(null)
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
      if (t) {
        setTrail(t)
        // 隐私排除的应用不再进入时间轴/星图（0 采集；历史数据也一并隐去）
        const excludedApps = useSettingsStore.getState().settings.privacyExcludedApps ?? []
        const isExcluded = (app?: string | null) => !!app && excludedApps.includes(app)
        // 只保留「有实际工作」的段：过滤短切换(<30s glance)、前台无操作(idle/away)
        const segs = t.segments.filter((s) => s.durationMin > 0 && !s.glance && s.mainState !== 'idle' && s.mainState !== 'away' && !isExcluded(s.mainApp) && !isExcluded(s.auxApp))
        // 主屏 + 副屏都进今日池：副屏重要工作（如 opencode）也显示为独立行，双屏并行一眼看清
        const list: GraphItem[] = []
        for (const s of segs) {
          list.push({ seg: s, channel: mapChannel(s.mainApp), column: WORK_LIKE_STATES.includes(s.mainState) ? 'work' : 'life' })
          if (s.auxApp && s.auxApp !== s.mainApp && !isExcluded(s.auxApp)) {
            const auxSeg: TrailSegment = { ...s, id: s.id + ':aux', mainApp: s.auxApp, mainState: s.auxState ?? 'other', mainTitle: s.auxTitle ?? '' }
            list.push({ seg: auxSeg, channel: mapChannel(auxSeg.mainApp), column: WORK_LIKE_STATES.includes(auxSeg.mainState) ? 'work' : 'life' })
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
  const insightText = useMemo(() => (trail ? insight(trail) : ''), [trail])

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
  const workChart = useMemo(() => computeStarLayout(starItems.filter(i => i.column === 'work'), starItems), [starItems])
  const lifeChart = useMemo(() => computeStarLayout(starItems.filter(i => i.column === 'life'), starItems), [starItems])

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

  const renderSegBlock = useCallback((seg: TrailSegment, left: number, width: number) => {
    const app = displayApp(seg.mainApp)
    const ma = (seg as any).microActivity
    const c = STATE_TEXT_VAR(seg)
    const chroma = CHROMA_OF(seg)
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

  const overviewRef = useRef<HTMLDivElement>(null)
  const overviewPanRef = useRef<{ x: number; lo: number; hi: number } | null>(null)

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

  // 左右平移按钮：移动半个可视范围
  const panBy = (dir: -1 | 1) => {
    const span = rangeHi - rangeLo
    const r = clampRange(rangeLo + (dir * span) / 2, rangeHi + (dir * span) / 2)
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

  // 迷你地图（全天概览）：点击定位 + 拖动平移可视窗口
  const onOverviewPointerDown = (e: React.PointerEvent) => {
    e.preventDefault()
    const el = overviewRef.current; if (!el) return
    const rect = el.getBoundingClientRect()
    el.setPointerCapture(e.pointerId)
    const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width))
    const center = ratio * 1440
    const span = rangeHi - rangeLo
    let lo = center - span / 2
    let hi = center + span / 2
    if (lo < 0) { lo = 0; hi = span }
    if (hi > 1440) { hi = 1440; lo = 1440 - span }
    setRangeLo(Math.round(lo))
    setRangeHi(Math.round(hi))
    overviewPanRef.current = { x: e.clientX, lo, hi }
  }
  const onOverviewPointerMove = (e: React.PointerEvent) => {
    if (!overviewPanRef.current) return
    const el = overviewRef.current; if (!el) return
    const rect = el.getBoundingClientRect()
    const span = overviewPanRef.current.hi - overviewPanRef.current.lo
    const dt = ((e.clientX - overviewPanRef.current.x) / rect.width) * 1440
    let lo = overviewPanRef.current.lo + dt
    let hi = overviewPanRef.current.hi + dt
    if (lo < 0) { lo = 0; hi = span }
    if (hi > 1440) { hi = 1440; lo = 1440 - span }
    setRangeLo(Math.round(lo))
    setRangeHi(Math.round(hi))
  }
  const onOverviewPointerUp = () => { overviewPanRef.current = null }

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

  const starDropProps = (col: Column) => ({
    onDragOver: (e: React.DragEvent) => { e.preventDefault(); setHoverCol(col) },
    onDragLeave: () => setHoverCol(null),
    onDrop: () => { if (dragFrom && dragFrom.col !== col) moveItem(dragFrom.app, col); setHoverCol(null); setDragFrom(null) }
  })

  const renderStarNode = (node: StarNode, isWork: boolean) => {
    const isDragging = dragFrom?.app === node.key
    const isGlance = !!node.item.seg.glance
    const chroma = (() => {
      const s = senseOf(node.item.seg.mainState)
      if (s === 'work') return '124 158 255'
      if (s === 'slack') return '255 124 124'
      return isWork ? 'var(--star-work)' : 'var(--star-life)'
    })()
    return (
      <div
        key={node.key}
        draggable
        onDragStart={() => setDragFrom({ app: node.key, col: node.item.column })}
        onDragEnd={() => { setDragFrom(null); setHoverCol(null) }}
        onMouseEnter={() => setStarHover(node.key)}
        onMouseLeave={() => setStarHover(null)}
        className="absolute rounded-full transition-all duration-300 cursor-grab active:cursor-grabbing group"
        style={{
          left: `${node.x}%`, top: `${node.y}%`,
          width: node.size, height: node.size,
          transform: 'translate(-50%, -50%)',
          background: node.isCore
              ? `radial-gradient(circle at 35% 35%, rgb(${chroma}/0.95), rgb(${chroma}/0.5))`
              : `radial-gradient(circle at 35% 35%, rgb(${chroma}/0.7), rgb(${chroma}/0.25))`,
          boxShadow: node.isCore
            ? `0 0 12px rgb(${chroma}/0.7), 0 0 28px rgb(${chroma}/0.25)`
            : `0 0 6px rgb(${chroma}/0.4), 0 0 14px rgb(${chroma}/0.12)`,
          opacity: isDragging ? 0.25 : isGlance ? 0.3 : 1,
          zIndex: node.isCore ? 10 : 5,
          scale: starHover === node.key ? '1.15' : '1',
          border: `1px solid rgb(${chroma}/0.3)`,
        }}>

        {starHover === node.key && (
          <ActivityHoverCard a={{
            app: displayApp(node.item.seg.mainApp),
            title: node.item.seg.mainTitle ?? '',
            state: node.item.seg.mainState,
            startText: fmtTime(node.item.seg.startTs),
            endText: fmtTime(node.item.seg.endTs),
            durationText: fmtDur(node.item.seg.durationMin),
            source: '监控',
            microActivity: (node.item.seg as any).microActivity ?? null,
            operation: (node.item.seg as any).operation ?? null,
          }} />
        )}
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col gap-4 overflow-auto">
      {/* 一句话洞察 */}
      <section className="glass-card hoverable">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-base">💡</span>
          <h3 className="text-[13px] font-semibold text-slate-200">今日洞察</h3>
        </div>
        <p className="text-[13px] text-slate-400 leading-relaxed">{insightText || '加载中...'}</p>
      </section>

      {/* 时间轴 — 水平泳道 */}
      <section className="glass-card">
        <div className="flex items-center gap-2 mb-2">
          <span style={{ fontSize: 14, fontWeight: 500, color: 'var(--tl-ruler-label)' }}>时间轴</span>
          <span style={{ fontSize: 12, color: 'var(--tl-ruler-label)' }}>{plans.length} 计划 · {fmtDur(items.reduce((a, i) => a + i.seg.durationMin, 0))}</span>
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
            <button onClick={() => panBy(-1)}
              style={{ width: 28, height: 28, borderRadius: 6, border: '0.5px solid var(--tl-lane-border)', background: 'transparent', color: 'var(--tl-ruler-label)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
              title="向左平移">◀</button>
            <button onClick={centerOnNow}
              style={{ height: 28, padding: '0 12px', borderRadius: 6, border: '0.5px solid var(--tl-now)', background: 'transparent', color: 'var(--tl-now)', fontSize: 11, fontWeight: 500, cursor: 'pointer' }}
              title="回到当前时间">现在</button>
            <button onClick={() => panBy(1)}
              style={{ width: 28, height: 28, borderRadius: 6, border: '0.5px solid var(--tl-lane-border)', background: 'transparent', color: 'var(--tl-ruler-label)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
              title="向右平移">▶</button>
          </div>
        </div>
          <div ref={timelineScrollRef} style={{ overflowX: 'auto', overflowY: 'visible', position: 'relative' }}>
            <div className="relative" style={{ width: LABEL_W + laneW }}>
            <div className="flex items-center mb-1">
              <span style={{ width: LABEL_W, fontSize: 11, color: 'var(--tl-ruler-label)', paddingLeft: 8 }} className="shrink-0">全天</span>
              <div ref={overviewRef} className="relative"
                style={{ width: laneW, height: 10, borderRadius: 999, background: 'var(--tl-lane-today-bg)', cursor: 'grab', touchAction: 'none' }}
                onPointerDown={onOverviewPointerDown}
                onPointerMove={onOverviewPointerMove}
                onPointerUp={onOverviewPointerUp}
                onPointerCancel={onOverviewPointerUp}
                title="全天概览 · 点击定位 · 拖动平移">
                {[360, 720, 1080].map((m) => (
                  <div key={m} className="absolute top-0 bottom-0" style={{ left: `${(m / 1440) * 100}%`, width: 0.5, background: 'var(--tl-lane-border)' }} />
                ))}
                <div className="absolute top-0 bottom-0" style={{
                  left: `${(rangeLo / 1440) * 100}%`,
                  width: `${((rangeHi - rangeLo) / 1440) * 100}%`,
                  background: 'rgba(55,138,221,0.32)',
                  borderRadius: 999,
                }} />
              </div>
            </div>
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
                    <div style={{ width: 0.5, height: 6, background: 'var(--tl-ruler-tick)' }} />
                    <span className="absolute" style={{ top: 10, left: '50%', transform: 'translateX(-50%)', fontSize: 11, color: 'var(--tl-ruler-label)', fontFamily: 'var(--font-mono, "JetBrains Mono", monospace)', fontVariantNumeric: 'tabular-nums' }}>
                      {String(Math.floor(t / 60))}
                    </span>
                  </div>
                ))}
              </div>
            </div>
            {/* 今日操作区 header */}
            <div className="flex items-center gap-1.5 mb-2">
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--tl-accent)', display: 'inline-block' }} />
              <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--tl-ruler-label)' }}>今日操作</span>
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
            ) : todayByApp.map(([app, segsArr]) => (
              <div key={app} className="flex items-center mb-1.5">
                <span style={{ width: LABEL_W, fontSize: 11, color: 'var(--tl-other-text)', paddingLeft: 8, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} className="shrink-0">{displayApp(app)}</span>
                <div className="relative" style={{
                     width: laneW, height: 30, overflow: 'hidden',
                     background: dragOverLane === 'today' ? 'rgba(55,138,221,0.08)' : 'transparent',
                     borderBottom: '0.5px solid var(--tl-lane-border)',
                     boxShadow: dragOverLane === 'today' ? 'inset 0 -1.5px 0 var(--tl-accent)' : 'none',
                     transition: 'background .12s, box-shadow .12s',
                   }}
                  onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setDragOverLane('today') }}
                  onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOverLane(null) }}
                  onDrop={e => {
                    e.preventDefault(); setDragOverLane(null)
                    const ts = parseInt(e.dataTransfer.getData('text/start-ts'))
                    if (!isNaN(ts)) handleAssignPlan(null, ts)
                  }}>
                  {dragOverLane === 'today' && (
                    <span style={{ position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%,-50%)', background: 'var(--tl-accent)', color: '#fff', fontSize: 11, fontWeight: 500, borderRadius: 999, padding: '2px 8px' }}>松开归入 · 今日</span>
                  )}
                  {segsArr.map(s => renderSegBlock(s.seg, ruler.minToX(startMinOf(s.seg)), ruler.durToW(s.seg.durationMin || 30)))}
                </div>
              </div>
            ))}
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

      {/* 星图 — 双模式卡片（暗色玻璃 / 亮色白底）；深色模式整卡隐藏 */}
      <section className="star-map glass-card hoverable" style={{ background: 'var(--star-card-bg)' }}>
        <div className="flex items-center justify-between mb-3 px-1">
          <div className="flex items-center gap-2">
            <span className="text-base">🗂️</span>
            <h3 className="text-[13px] font-semibold" style={{ color: 'var(--star-text)' }}>今日星图</h3>
          </div>
          <span className="text-[11px]" style={{ color: 'var(--star-text-muted)' }}>工作 ✦ {fmtDur(totalWorkMin)} · 生活 ✦ {fmtDur(totalLifeMin)} · 拖动星点调整</span>
        </div>
        <div className="relative flex rounded-xl" style={{ minHeight: 320, background: 'var(--star-card-bg)' }}>
          <div className="absolute left-1/2 top-4 bottom-4 border-l-2 border-dashed z-10" style={{ borderColor: 'var(--star-line)' }} />
          {/* 图例 */}
          <div className="absolute bottom-2 left-3 z-20 flex items-center gap-3 text-[10px]" style={{ color: 'var(--star-text-muted)' }}>
            <span className="flex items-center gap-1"><i className="inline-block w-2 h-2 rounded-full" style={{ background: '#7c9eff' }} />办公</span>
            <span className="flex items-center gap-1"><i className="inline-block w-2 h-2 rounded-full" style={{ background: '#ff7c7c' }} />摸鱼</span>
            <span className="flex items-center gap-1"><i className="inline-block w-2 h-2 rounded-full" style={{ background: '#94a3b8' }} />其他</span>
          </div>
          <div className={`relative flex-1 min-h-[320px] transition-colors ${hoverCol === 'work' && dragFrom && dragFrom.col !== 'work' ? 'bg-[rgb(var(--star-work)/0.06)]' : ''}`} style={{ background: 'var(--star-work-bg)' }} {...starDropProps('work')}>
            <svg className="absolute inset-0 w-full h-full pointer-events-none" viewBox="0 0 100 100" preserveAspectRatio="none">
              {workChart.connections.map((c, i) => (
                <line key={i} x1={c.x1} y1={c.y1} x2={c.x2} y2={c.y2} strokeWidth="0.3" stroke="var(--star-work-line)" />
              ))}
            </svg>
            <span className="absolute top-3 left-3 text-[11px] font-semibold z-10" style={{ color: 'var(--star-work-label)' }}>工作</span>
            {workChart.nodes.length === 0 ? (
              <p className="absolute inset-0 flex items-center justify-center text-[12px]" style={{ color: 'var(--star-text-muted)' }}>从右边拖星点过来 ✦</p>
            ) : workChart.nodes.map(n => renderStarNode(n, true))}
          </div>
          <div className={`relative flex-1 min-h-[320px] transition-colors ${hoverCol === 'life' && dragFrom && dragFrom.col !== 'life' ? 'bg-[rgb(var(--star-life)/0.06)]' : ''}`} style={{ background: 'var(--star-life-bg)' }} {...starDropProps('life')}>
            <svg className="absolute inset-0 w-full h-full pointer-events-none" viewBox="0 0 100 100" preserveAspectRatio="none">
              {lifeChart.connections.map((c, i) => (
                <line key={i} x1={c.x1} y1={c.y1} x2={c.x2} y2={c.y2} strokeWidth="0.3" stroke="var(--star-life-line)" />
              ))}
            </svg>
            <span className="absolute top-3 right-3 text-[11px] font-semibold z-10" style={{ color: 'var(--star-life-label)' }}>生活</span>
            {lifeChart.nodes.length === 0 ? (
              <p className="absolute inset-0 flex items-center justify-center text-[12px]" style={{ color: 'var(--star-text-muted)' }}>把左边星点拖过来 ✦</p>
            ) : lifeChart.nodes.map(n => renderStarNode(n, false))}
          </div>
        </div>
      </section>

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
