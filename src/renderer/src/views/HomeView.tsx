/**
 * 首页 — 今日图谱 + 工作/生活时间轴 + 标签面板（PRD v3.1 G+H）
 */
import { useEffect, useState, useMemo, useCallback, useRef } from 'react'
import { createPortal } from 'react-dom'
import { WORK_LIKE_STATES, WORK_STATES } from '@shared/stateMeta'
import type { MergedTrail, TrailSegment, WorkState, PlanItem } from '@shared/types'
import { dateKey } from '@shared/trail'
import { ActivityHoverCard } from '../components/ActivityHoverCard'
import { displayApp } from '@shared/appDisplayName'

type Channel = 'CMD' | '浏览器' | '微信' | 'IDE' | '其他'
type Column = 'work' | 'life'

interface GraphItem {
  seg: TrailSegment
  channel: Channel
  column: Column
}

interface TagRule {
  id: string; app: string; label: string; state: WorkState; hitCount: number; enabled: boolean
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

// 双区淡框（"不明显"：淡底 + 1px 极淡描边 + 左上角小标签，无阴影无粗边）
const ZONE_TODAY = {
  background: 'rgba(15,23,42,0.028)',
  border: '1px solid rgba(148,163,184,0.28)',
  borderRadius: 10,
  padding: '8px 8px 4px',
  position: 'relative' as const,
}
const ZONE_PLAN = {
  background: 'rgba(124,158,255,0.045)',
  border: '1px solid rgba(124,158,255,0.30)',
  borderRadius: 10,
  padding: '8px 8px 4px',
  position: 'relative' as const,
}
const ZONE_LABEL_STYLE = { fontSize: 11, fontWeight: 600, letterSpacing: 0.3 } as const

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

function STATE_COLOR_OF(seg: TrailSegment) {
  const s = senseOf(seg.mainState)
  if (s === 'work') return { bg: '#7c9eff22', border: '#7c9eff44', text: '#4c6ed9', band: '#7c9eff' }
  if (s === 'slack') return { bg: '#ff7c7c22', border: '#ff7c7c44', text: '#d94c4c', band: '#ff7c7c' }
  return { bg: '#94a3b822', border: '#94a3b844', text: '#64748b', band: '#94a3b8' }
}

type SenseKind = 'work' | 'slack' | 'other'
function senseOf(state: WorkState): SenseKind {
  const slackStates: WorkState[] = ['slack', 'relax', 'break', 'lunch', 'idle', 'away']
  if (slackStates.includes(state)) return 'slack'
  if (WORK_LIKE_STATES.includes(state)) return 'work'
  return 'other'
}

interface StarNode { item: GraphItem; idx: number; x: number; y: number; size: number; isCore: boolean }
interface StarConnection { x1: number; y1: number; x2: number; y2: number }

function computeStarLayout(filtered: GraphItem[], allItems: GraphItem[]): { nodes: StarNode[]; connections: StarConnection[] } {
  if (filtered.length === 0) return { nodes: [], connections: [] }
  const sorted = [...filtered].sort((a, b) => b.seg.durationMin - a.seg.durationMin)
  const maxDur = sorted[0].seg.durationMin || 1
  const nodes: StarNode[] = [{ item: sorted[0], idx: allItems.indexOf(sorted[0]), x: 50, y: 50, size: 56, isCore: true }]
  const children = sorted.slice(1)
  const ring1R = 32; const ring1N = Math.min(children.length, 6); const ring2R = 44
  children.forEach((item, i) => {
    const angle = i < ring1N ? (i / ring1N) * 2 * Math.PI - Math.PI / 2 : ((i - ring1N) / Math.max(1, children.length - ring1N)) * 2 * Math.PI - Math.PI / 2 + 0.35
    const radius = i < ring1N ? ring1R : ring2R
    const durRatio = item.seg.durationMin / maxDur
    nodes.push({ item, idx: allItems.indexOf(item), x: 50 + radius * Math.cos(angle), y: 50 + radius * Math.sin(angle), size: Math.max(20, Math.round(24 + durRatio * 14)), isCore: false })
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
  const [tags, setTags] = useState<TagRule[]>([])
  const [plans, setPlans] = useState<PlanItem[]>([])
  const [dragFrom, setDragFrom] = useState<{ idx: number; col: Column } | null>(null)
  const [hoverCol, setHoverCol] = useState<Column | null>(null)
  const [tlHover, setTlHover] = useState<{ seg: TrailSegment; rect: DOMRect } | null>(null)
  const WORK_START = 9 * 60
  const WORK_END = 18 * 60
  const [rangeLo, setRangeLo] = useState(WORK_START)
  const [rangeHi, setRangeHi] = useState(WORK_END)
  const [tagsOpen, setTagsOpen] = useState(false)
  const [newTag, setNewTag] = useState({ app: '', label: '', state: 'focus' as WorkState })
  const [starHover, setStarHover] = useState<number | null>(null)
  const [dragSeg, setDragSeg] = useState<number | null>(null)
  const [planSegments, setPlanSegments] = useState<Map<number, string>>(new Map())
  const [nowMin, setNowMin] = useState(() => {
    const d = new Date(); return d.getHours() * 60 + d.getMinutes()
  })
  const [dragTs, setDragTs] = useState<number | null>(null)
  const [dragOverLane, setDragOverLane] = useState<'today' | string | null>(null)
  const [inferences, setInferences] = useState<Map<string, { category: WorkState; microActivity: string | null; confidence: number }>>(new Map())

  const lastPresenceRefresh = useRef<number>(0)
  const trailingRefreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const refresh = useCallback(() => {
    void (async () => {
      const t = await window.api?.getTrail?.() as MergedTrail | undefined
      const p = await window.api?.listPlans?.(dateKey(Date.now())) as PlanItem[] | undefined
      if (t) {
        setTrail(t)
        const segs = t.segments.filter((s) => !s.glance && s.durationMin > 0)
        // 主屏 + 副屏都进今日池：副屏重要工作（如 opencode）也显示为独立行，双屏并行一眼看清
        const list: GraphItem[] = []
        for (const s of segs) {
          list.push({ seg: s, channel: mapChannel(s.mainApp), column: WORK_LIKE_STATES.includes(s.mainState) ? 'work' : 'life' })
          if (s.auxApp && s.auxApp !== s.mainApp) {
            const auxSeg: TrailSegment = { ...s, id: s.id + ':aux', mainApp: s.auxApp, mainState: s.auxState ?? 'other', mainTitle: s.auxTitle ?? '' }
            list.push({ seg: auxSeg, channel: mapChannel(auxSeg.mainApp), column: WORK_LIKE_STATES.includes(auxSeg.mainState) ? 'work' : 'life' })
          }
        }
        setItems(list)
        if (p) setPlans(p)
      }
      void window.api?.getInferences?.().then((infs) => {
        const list = (infs as Array<{ segId: string; category: WorkState; microActivity: string | null; confidence: number }>) ?? []
        setInferences(new Map(list.map((i) => [i.segId, { category: i.category, microActivity: i.microActivity, confidence: i.confidence }])))
      }).catch(() => undefined)
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
    return () => {
      clearInterval(poll)
      off?.()
      if (trailingRefreshTimer.current) clearTimeout(trailingRefreshTimer.current)
    }
  }, [refresh])

  const loadTags = useCallback(() => {
    void window.api?.listRules?.().then((rules) => {
      const mapped = (rules as Array<Record<string, unknown>>)?.map((r) => ({ id: r.id as string, app: r.matchApp as string, label: (r.setState ?? 'focus') as WorkState, state: (r.setState ?? 'focus') as WorkState, hitCount: (r.hitCount ?? 0) as number, enabled: (r.enabled ?? true) as boolean })) ?? []
      setTags(mapped)
    })
  }, [])
  useEffect(() => { loadTags() }, [loadTags])

  const totalWorkMin = useMemo(() => items.filter((i) => i.column === 'work').reduce((a, i) => a + i.seg.durationMin, 0), [items])
  const totalLifeMin = useMemo(() => items.filter((i) => i.column === 'life').reduce((a, i) => a + i.seg.durationMin, 0), [items])
  const insightText = useMemo(() => (trail ? insight(trail) : ''), [trail])
  const workChart = useMemo(() => computeStarLayout(items.filter(i => i.column === 'work'), items), [items])
  const lifeChart = useMemo(() => computeStarLayout(items.filter(i => i.column === 'life'), items), [items])

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

  const ruler = useMemo(() => {
    const lo = rangeLo, hi = rangeHi
    const PAD = 8, W = LANE_W, span = hi - lo || 1
    return {
      lo, hi,
      minToX: (m: number) => PAD + ((m - lo) / span) * (W - PAD * 2),
      durToW: (dur: number) => Math.max(16, (dur / span) * (W - PAD * 2)),
    }
  }, [items, plans, rangeLo, rangeHi])

  const renderSegBlock = useCallback((seg: TrailSegment, left: number, width: number) => {
    const app = displayApp(seg.mainApp)
    const ma = (seg as any).microActivity
    const c = STATE_COLOR_OF(seg)
    const ghost = dragTs === seg.startTs
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
        onMouseEnter={e => !dragTs && setTlHover({ seg, rect: e.currentTarget.getBoundingClientRect() })}
        onMouseLeave={() => setTlHover(null)}
        title={`${app}${ma ? ' · ' + ma : ''} · ${fmtTime(seg.startTs)}`}
        style={{ position: 'absolute', left, width, top: 3, bottom: 3,
                 background: ghost ? 'rgba(148,163,184,0.12)' : c.band,
                 border: ghost ? '1px dashed #94a3b8' : 'none',
                 borderRadius: 5,
                 cursor: dragTs ? 'grabbing' : 'grab',
                 opacity: ghost ? 0.35 : 1, transition: 'opacity .1s' }} />
    )
  }, [setTlHover, dragTs])

  const rangeRef = useRef<HTMLDivElement>(null)
  const hourTicks = useMemo(() => {
    const arr: number[] = []
    for (let t = rangeLo; t <= rangeHi; t += 60) arr.push(t)
    return arr
  }, [rangeLo, rangeHi])
  const fmtHHMM = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
  const onHandleDown = (which: 'lo' | 'hi') => (e: React.PointerEvent) => {
    e.preventDefault(); e.stopPropagation()
    const el = rangeRef.current; if (!el) return
    const rect = el.getBoundingClientRect()
    const lo0 = rangeLo, hi0 = rangeHi
    const move = (ev: PointerEvent) => {
      const ratio = Math.min(1, Math.max(0, (ev.clientX - rect.left) / rect.width))
      const m = Math.round(lo0 + ratio * (hi0 - lo0))
      if (which === 'lo') setRangeLo(Math.min(m, hi0 - 30))
      else setRangeHi(Math.max(m, lo0 + 30))
    }
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up) }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
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

  const moveItem = useCallback((idx: number, toCol: Column) => {
    setItems((prev) => {
      const next = [...prev]; const item = next[idx]
      next[idx] = { ...item, column: toCol }
      void window.api?.saveRule?.({ screen: 0, matchApp: item.seg.mainApp, matchTitleContains: '', setState: toCol === 'work' ? 'coding' : 'slack' as WorkState, weight: 1, enabled: true }).then(() => loadTags())
      return next
    })
  }, [loadTags])

  const addTagRule = useCallback(async () => {
    if (!newTag.app.trim() || !newTag.label.trim()) return
    await window.api?.saveRule?.({ screen: 0, matchApp: newTag.app.trim(), matchTitleContains: newTag.label.trim(), setState: newTag.state, weight: 1, enabled: true })
    setNewTag({ app: '', label: '', state: 'focus' }); loadTags()
  }, [newTag, loadTags])

  const toggleTag = useCallback((id: string, enabled: boolean) => { void window.api?.saveRule?.({ id, enabled }).then(() => loadTags()) }, [loadTags])
  const removeTag = useCallback((id: string) => { void window.api?.removeRule?.(id).then(() => loadTags()) }, [loadTags])

  const starDropProps = (col: Column) => ({
    onDragOver: (e: React.DragEvent) => { e.preventDefault(); setHoverCol(col) },
    onDragLeave: () => setHoverCol(null),
    onDrop: () => { if (dragFrom && dragFrom.col !== col) moveItem(dragFrom.idx, col); setHoverCol(null); setDragFrom(null) }
  })

  const renderStarNode = (node: StarNode, isWork: boolean) => {
    const isDragging = dragFrom?.idx === node.idx
    const chroma = (() => {
      const s = senseOf(node.item.seg.mainState)
      if (s === 'work') return '124 158 255'
      if (s === 'slack') return '255 124 124'
      return isWork ? 'var(--star-work)' : 'var(--star-life)'
    })()
    return (
      <div
        key={node.idx}
        draggable
        onDragStart={() => setDragFrom({ idx: node.idx, col: node.item.column })}
        onDragEnd={() => { setDragFrom(null); setHoverCol(null) }}
        onMouseEnter={() => setStarHover(node.idx)}
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
          opacity: isDragging ? 0.25 : 1,
          zIndex: node.isCore ? 10 : 5,
          scale: starHover === node.idx ? '1.15' : '1',
          border: `1px solid rgb(${chroma}/0.3)`,
        }}>

        {starHover === node.idx && (
          <ActivityHoverCard a={{
            app: displayApp(node.item.seg.mainApp),
            title: node.item.seg.mainTitle ?? '',
            state: node.item.seg.mainState,
            startText: fmtTime(node.item.seg.startTs),
            endText: fmtTime(node.item.seg.endTs),
            durationText: fmtDur(node.item.seg.durationMin),
            source: '监控',
            microActivity: (node.item.seg as any).microActivity ?? null,
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
      <section className="glass-card hoverable" style={{ background: '#fff' }}>
        <div className="flex items-center gap-2 mb-2">
          <span className="text-base">⏱️</span>
          <h3 className="text-[13px] font-semibold text-slate-800">时间轴</h3>
          <span className="text-[10px] text-slate-400">{plans.length} 计划 · {fmtDur(items.reduce((a, i) => a + i.seg.durationMin, 0))}</span>
        </div>
          <div style={{ overflowX: 'auto', overflowY: 'visible', position: 'relative' }}>
            <div className="relative" style={{ width: LABEL_W + LANE_W }}>
            <div className="flex items-center mb-1.5">
              <span style={{ width: LABEL_W }} className="shrink-0 text-[11px] text-slate-500 pl-2">范围 {fmtHHMM(rangeLo)}–{fmtHHMM(rangeHi)}</span>
              <div ref={rangeRef} className="relative" style={{ width: LANE_W, height: 18, cursor: 'pointer' }}>
                <div className="absolute left-0 right-0 top-1/2 -translate-y-1/2 h-0.5" style={{ background: '#e2e8f0' }} />
                {hourTicks.map(t => (
                  <div key={t} className="absolute top-0 bottom-0" style={{ left: ruler.minToX(t) }}>
                    <div className="w-px h-2" style={{ background: '#cbd5e1' }} />
                    <span className="absolute top-2 left-1/2 -translate-x-1/2 text-[9px]" style={{ color: '#94a3b8' }}>{String(Math.floor(t / 60)).padStart(2, '0')}</span>
                  </div>
                ))}
                <div onPointerDown={onHandleDown('lo')} className="absolute top-0 bottom-0 -ml-1 w-2 rounded cursor-ew-resize"
                     style={{ left: ruler.minToX(rangeLo), background: '#7c9eff', boxShadow: '0 0 0 1px #fff' }} title="拖拽调整起始时间" />
                <div onPointerDown={onHandleDown('hi')} className="absolute top-0 bottom-0 -ml-1 w-2 rounded cursor-ew-resize"
                     style={{ left: ruler.minToX(rangeHi), background: '#7c9eff', boxShadow: '0 0 0 1px #fff' }} title="拖拽调整结束时间" />
              </div>
            </div>
            {/* —— 今日操作区（淡框） —— */}
            <div style={ZONE_TODAY} className="mb-2">
              <span style={{ ...ZONE_LABEL_STYLE, color: '#64748b', background: '#fff' }} className="absolute -top-2 left-3 px-1">今日 · 未归类操作</span>
              {todayByApp.length === 0 ? (
                <div className="flex items-center mb-1.5">
                  <span style={{ width: LABEL_W }} className="shrink-0 text-[11px] text-slate-500 pl-2">今日</span>
                  <div className="relative" style={{
                       width: LANE_W, height: 30, borderRadius: 8, overflow: 'hidden', background: '#f8fafc',
                     }}
                    onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setDragOverLane('today') }}
                    onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOverLane(null) }}
                    onDrop={e => {
                      e.preventDefault(); setDragOverLane(null)
                      const ts = parseInt(e.dataTransfer.getData('text/start-ts'))
                      if (!isNaN(ts)) handleAssignPlan(null, ts)
                    }}>
                    <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[10px] text-slate-400">今日活动已全部归入计划 ✓</span>
                  </div>
                </div>
              ) : todayByApp.map(([app, segsArr]) => (
                <div key={app} className="flex items-center mb-1.5">
                  <span style={{ width: LABEL_W, color: '#475569' }} className="shrink-0 text-[11px] pl-2 truncate">{displayApp(app)}</span>
                  <div className="relative" style={{
                       width: LANE_W, height: 30, borderRadius: 8, overflow: 'hidden',
                       background: dragOverLane === 'today' ? 'rgba(124,158,255,0.07)' : '#f8fafc',
                       boxShadow: dragOverLane === 'today' ? 'inset 0 0 0 2px rgba(124,158,255,0.55)' : 'none',
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
                      <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-[10px] px-2 py-0.5 rounded-full"
                            style={{ background: '#7c9eff', color: '#fff' }}>松开归入 · 今日</span>
                    )}
                    {segsArr.map(s => renderSegBlock(s.seg, ruler.minToX(startMinOf(s.seg)), ruler.durToW(s.seg.durationMin || 30)))}
                  </div>
                </div>
              ))}
            </div>
            {/* —— 计划泳道区（淡框） —— */}
            <div style={ZONE_PLAN} className="mb-1">
              <span style={{ ...ZONE_LABEL_STYLE, color: '#5b78d6', background: '#fff' }} className="absolute -top-2 left-3 px-1">计划泳道</span>
              {plans.map(plan => {
                const segs = getPlanSegs(plan.id)
                const covered = segs.reduce((a, s) => a + (s.seg.durationMin || 0), 0)
                return (
                  <div key={plan.id} className="flex items-center mb-1.5">
                    <span style={{ width: LABEL_W, color: STATUS_TEXT[plan.status] || '#475569' }} className="shrink-0 text-[11px] pl-2 truncate">{plan.title}</span>
                    <div className="relative" style={{
                             width: LANE_W, height: 30, borderRadius: 8, overflow: 'hidden',
                             borderLeft: `3px solid ${STATUS_BORDER[plan.status] || '#e2e8f0'}`,
                             background: dragOverLane === plan.id ? 'rgba(124,158,255,0.07)' : '#fff',
                             boxShadow: dragOverLane === plan.id ? 'inset 0 0 0 2px rgba(124,158,255,0.55)' : 'none',
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
                        <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-[10px] px-2 py-0.5 rounded-full"
                              style={{ background: '#7c9eff', color: '#fff' }}>松开归入 · {plan.title}</span>
                      )}
                      <div style={{ position: 'absolute', left: ruler.minToX(plan.startMin ?? 0), width: ruler.durToW(plan.durationMin ?? 60),
                                   top: 2, bottom: 2, background: STATUS_BG[plan.status] || '#f8fafc',
                                   border: `1px dashed ${STATUS_BORDER[plan.status] || '#e2e8f0'}`, borderRadius: 6 }} />
                      {segs.map(s => renderSegBlock(s.seg, ruler.minToX(startMinOf(s.seg)), ruler.durToW(s.seg.durationMin || 30)))}
                      <span className="absolute right-1 top-1/2 -translate-y-1/2 text-[9px] text-slate-400">
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
            </div>
            {nowMin >= rangeLo && nowMin <= rangeHi && (() => {
              const x = LABEL_W + ruler.minToX(nowMin)
              return (
                <div style={{ position: 'absolute', left: x, top: 0, bottom: 0, width: 2,
                              background: '#ef4444', zIndex: 50, pointerEvents: 'none' }}>
                  <div style={{ position: 'absolute', top: -2, left: '50%', transform: 'translateX(-50%)',
                                background: '#fff', border: '1px solid #ef4444', color: '#ef4444',
                                fontSize: 10, fontWeight: 600, padding: '1px 6px', borderRadius: 999,
                                whiteSpace: 'nowrap' }}>
                    现在 {String(Math.floor(nowMin / 60)).padStart(2,'0')}:{String(nowMin % 60).padStart(2,'0')}
                  </div>
                  <div style={{ position: 'absolute', bottom: 0, left: -1, width: 4, height: 18,
                                background: 'linear-gradient(to bottom, rgba(239,68,68,0), #ef4444)' }} />
                </div>
              )
            })()}
            </div>
          </div>
      </section>

      {tlHover && createPortal(
        <ActivityHoverCard a={{
          app: displayApp(tlHover.seg.mainApp),
          title: tlHover.seg.mainTitle ?? '(未命名)',
          state: tlHover.seg.mainState,
          startText: fmtTime(tlHover.seg.startTs),
          endText: fmtTime(tlHover.seg.endTs),
          durationText: fmtDur(tlHover.seg.durationMin),
          source: '监控',
          microActivity: (tlHover.seg as any).microActivity ?? null,
          aiInfer: (() => {
            const i = inferences.get(tlHover.seg.id ?? 's' + tlHover.seg.startTs)
            return i ? { label: WORK_STATES[i.category]?.label ?? i.category, confidence: i.confidence } : undefined
          })(),
          counterpart: (tlHover.seg as any).counterpart ?? undefined,
          topic: (tlHover.seg as any).topic ?? undefined,
          mode: 'fixed',
          pos: { x: tlHover.rect.left + tlHover.rect.width / 2, y: tlHover.rect.top },
        }} />,
        document.body
      )}

      {/* 星图 — 白底卡片 */}
      <section className="glass-card hoverable" style={{ background: '#fff' }}>
        <div className="flex items-center justify-between mb-3 px-1">
          <div className="flex items-center gap-2">
            <span className="text-base">🗂️</span>
            <h3 className="text-[13px] font-semibold text-slate-800">今日星图</h3>
          </div>
          <span className="text-[11px] text-slate-500">工作 ✦ {fmtDur(totalWorkMin)} · 生活 ✦ {fmtDur(totalLifeMin)} · 拖动星点可纠偏</span>
        </div>
        <div className="relative flex rounded-xl" style={{ minHeight: 320, background: '#ffffff' }}>
          <div className="absolute left-1/2 top-4 bottom-4 border-l-2 border-dashed border-slate-200 z-10" />
          {/* 图例 */}
          <div className="absolute bottom-2 left-3 z-20 flex items-center gap-3 text-[10px]" style={{ color: '#475569' }}>
            <span className="flex items-center gap-1"><i className="inline-block w-2 h-2 rounded-full" style={{ background: '#7c9eff' }} />办公</span>
            <span className="flex items-center gap-1"><i className="inline-block w-2 h-2 rounded-full" style={{ background: '#ff7c7c' }} />摸鱼</span>
            <span className="flex items-center gap-1"><i className="inline-block w-2 h-2 rounded-full" style={{ background: '#94a3b8' }} />其他</span>
          </div>
          <div className={`relative flex-1 min-h-[320px] transition-colors ${hoverCol === 'work' && dragFrom && dragFrom.col !== 'work' ? 'bg-[rgb(var(--star-work)/0.04)]' : ''}`} style={{ background: 'rgb(var(--star-work)/0.03)' }} {...starDropProps('work')}>
            <svg className="absolute inset-0 w-full h-full pointer-events-none" viewBox="0 0 100 100" preserveAspectRatio="none">
              {workChart.connections.map((c, i) => (
                <line key={i} x1={c.x1} y1={c.y1} x2={c.x2} y2={c.y2} strokeWidth="0.3" stroke={`rgb(var(--star-work)/0.2)`} />
              ))}
            </svg>
            <span className="absolute top-3 left-3 text-[11px] font-semibold z-10" style={{ color: 'rgb(var(--star-work-fg))' }}>工作</span>
            {workChart.nodes.length === 0 ? (
              <p className="absolute inset-0 flex items-center justify-center text-[12px]" style={{ color: 'rgb(var(--star-work-fg)/0.3)' }}>从右边拖星点过来 ✦</p>
            ) : workChart.nodes.map(n => renderStarNode(n, true))}
          </div>
          <div className={`relative flex-1 min-h-[320px] transition-colors ${hoverCol === 'life' && dragFrom && dragFrom.col !== 'life' ? 'bg-[rgb(var(--star-life)/0.04)]' : ''}`} style={{ background: 'rgb(var(--star-life)/0.03)' }} {...starDropProps('life')}>
            <svg className="absolute inset-0 w-full h-full pointer-events-none" viewBox="0 0 100 100" preserveAspectRatio="none">
              {lifeChart.connections.map((c, i) => (
                <line key={i} x1={c.x1} y1={c.y1} x2={c.x2} y2={c.y2} strokeWidth="0.3" stroke={`rgb(var(--star-life)/0.15)`} />
              ))}
            </svg>
            <span className="absolute top-3 right-3 text-[11px] font-semibold z-10" style={{ color: 'rgb(var(--star-life-fg))' }}>生活</span>
            {lifeChart.nodes.length === 0 ? (
              <p className="absolute inset-0 flex items-center justify-center text-[12px]" style={{ color: 'rgb(var(--star-life-fg)/0.3)' }}>把左边星点拖过来 ✦</p>
            ) : lifeChart.nodes.map(n => renderStarNode(n, false))}
          </div>
        </div>
      </section>

      {/* 标签管理 */}
      <section className="glass-card hoverable">
        <button onClick={() => setTagsOpen(!tagsOpen)} className="flex w-full items-center justify-between text-left">
          <div className="flex items-center gap-2"><span className="text-base">🏷️</span><h3 className="text-[13px] font-semibold text-slate-200">分类标签</h3><span className="text-[11px] text-slate-500">{tags.length} 条规则</span></div>
          <span className="text-[11px] text-slate-500">{tagsOpen ? '收起 ▲' : '展开 ▼'}</span>
        </button>
        {tagsOpen && (
          <div className="mt-3 space-y-2">
            {tags.length === 0 ? <p className="text-[12px] text-slate-500 py-2">图谱中拖拽卡片会自动创建规则；也可以手动添加。</p> : (
              <div className="flex flex-wrap gap-2">
                {tags.map((t) => (
                  <div key={t.id} className={`flex items-center gap-2 rounded-lg px-3 py-1.5 text-[11px] ${t.enabled ? 'bg-neon-cyan/10 border border-neon-cyan/20' : 'bg-slate-500/5 border border-slate-500/10 opacity-50'}`}>
                    <span className="text-slate-200">{WORK_STATES[t.state]?.emoji ?? '📌'} {t.app}</span>
                    <span className="text-slate-400">→ {WORK_STATES[t.state]?.label ?? t.state}</span>
                    <span className="text-slate-500">({t.hitCount}次)</span>
                    <button onClick={() => toggleTag(t.id, !t.enabled)} className="text-slate-500 hover:text-slate-300">{t.enabled ? '✓' : '○'}</button>
                    <button onClick={() => removeTag(t.id)} className="text-slate-500 hover:text-red-400">✕</button>
                  </div>
                ))}
              </div>
            )}
            <div className="mt-3 flex items-center gap-2 flex-wrap">
              <input className="w-28 rounded-lg border border-white/10 bg-white/[0.04] px-2 py-1 text-[11px] text-slate-200 placeholder-slate-500 outline-none" placeholder="应用名" value={newTag.app} onChange={(e) => setNewTag({ ...newTag, app: e.target.value })} />
              <input className="w-28 rounded-lg border border-white/10 bg-white/[0.04] px-2 py-1 text-[11px] text-slate-200 placeholder-slate-500 outline-none" placeholder="关键词" value={newTag.label} onChange={(e) => setNewTag({ ...newTag, label: e.target.value })} />
              <select className="rounded-lg border border-white/10 bg-white/[0.04] px-2 py-1 text-[11px] text-slate-300 outline-none" value={newTag.state} onChange={(e) => setNewTag({ ...newTag, state: e.target.value as WorkState })}>
                {Object.entries(WORK_STATES).map(([k, v]) => <option key={k} value={k}>{v.emoji} {v.label}</option>)}
              </select>
              <button onClick={addTagRule} className="rounded-lg bg-neon-cyan/15 border border-neon-cyan/25 px-3 py-1 text-[11px] text-neon-cyan hover:bg-neon-cyan/25">+ 添加</button>
            </div>
          </div>
        )}
      </section>


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
