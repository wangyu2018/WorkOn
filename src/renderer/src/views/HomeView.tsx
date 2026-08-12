/**
 * 首页 — 今日图谱 + 工作/生活时间轴 + 标签面板（PRD v3.1 G+H）
 */
import { useEffect, useState, useMemo, useCallback } from 'react'
import { WORK_LIKE_STATES, WORK_STATES } from '@shared/stateMeta'
import type { MergedTrail, TrailSegment, WorkState, PlanItem } from '@shared/types'
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
  const [tagsOpen, setTagsOpen] = useState(false)
  const [newTag, setNewTag] = useState({ app: '', label: '', state: 'focus' as WorkState })
  const [tlOpen, setTlOpen] = useState(() => { try { return localStorage.getItem('workon.tlOpen') !== '0' } catch { return true } })
  const [starHover, setStarHover] = useState<number | null>(null)
  const [dragSeg, setDragSeg] = useState<number | null>(null)
  const [planSegments, setPlanSegments] = useState<Map<number, string>>(new Map())

  useEffect(() => {
    void (async () => {
      const t = await window.api?.getTrail?.() as MergedTrail | undefined
      const p = await window.api?.listPlans?.() as PlanItem[] | undefined
      if (t) {
        setTrail(t)
        const segs = t.segments.filter((s) => !s.glance && s.durationMin > 0)
        setItems(segs.map((seg) => ({ seg, channel: mapChannel(seg.mainApp), column: WORK_LIKE_STATES.includes(seg.mainState) ? 'work' : 'life' })))
        if (p) {
          setPlans(p)
        }
      }
    })()
  }, [])

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

  const unassignedSegs = useMemo(() =>
    items.filter(i => !planSegments.has(i.seg.startTs)),
    [items, planSegments]
  )
  const getPlanSegs = useCallback((planId: string) =>
    items.filter(i => planSegments.get(i.seg.startTs) === planId),
    [items, planSegments]
  )
  const coverMin = useCallback((planId: string) =>
    getPlanSegs(planId).reduce((a, i) => a + i.seg.durationMin, 0),
    [getPlanSegs]
  )
  const maxTotalMin = useMemo(() => Math.max(60, ...items.map(i => i.seg.durationMin)), [items])

  const renderSegBlock = useCallback((seg: TrailSegment & { planId?: string }, planTitle?: string) => {
    const w = Math.max(40, (seg.durationMin / maxTotalMin) * 300)
    const senseColor = senseOf(seg.mainState) === 'work' ? '#7c9eff' : senseOf(seg.mainState) === 'slack' ? '#ff7c7c' : '#94a3b8'
    return (
      <div key={seg.startTs} draggable onDragStart={() => setDragSeg(seg.startTs)}
        className="shrink-0 rounded px-1.5 py-0.5 text-[10px] cursor-grab hover:brightness-110 transition-all relative"
        style={{ width: w, background: `${senseColor}22`, border: `1px solid ${senseColor}44`, color: '#334155' }}
        title={`${displayApp(seg.mainApp)} · ${fmtTime(seg.startTs)} · ${fmtDur(seg.durationMin)}${seg.mainTitle ? '\n' + seg.mainTitle : ''}${planTitle ? '\n📋 ' + planTitle : ''}`}>
        {displayApp(seg.mainApp)}
        {(seg as any).microActivity && <span className="text-[9px] ml-1" style={{color:'#94a3b8'}}>{(seg as any).microActivity}</span>}
        {planTitle && <span className="absolute -top-1 -right-1 text-[8px] px-1 rounded-full" style={{background:'#a78bfa',color:'#fff'}}>↳</span>}
      </div>
    )
  }, [maxTotalMin])

  const handleAssignPlan = useCallback(async (planId: string | null) => {
    if (dragSeg === null) return
    await window.api?.assignSegmentPlan?.(dragSeg, planId)
    if (planId) {
      setPlanSegments(prev => { const next = new Map(prev); next.set(dragSeg, planId); return next })
    } else {
      setPlanSegments(prev => { const next = new Map(prev); next.delete(dragSeg); return next })
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
      <section className="glass-card hoverable" style={{ background: '#fff', maxHeight: '80vh', overflowY: 'auto' }}>
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <span className="text-base">⏱️</span>
            <h3 className="text-[13px] font-semibold text-slate-800">时间轴</h3>
            <span className="text-[10px] text-slate-400">{plans.length} 计划 · {fmtDur(items.reduce((a, i) => a + i.seg.durationMin, 0))}</span>
          </div>
          <button onClick={() => { const v = !tlOpen; setTlOpen(v); try { localStorage.setItem('workon.tlOpen', v ? '1' : '0') } catch {} }} className="text-[11px] text-slate-500 hover:text-slate-600">{tlOpen ? '收起 ▲' : '展开 ▼'}</button>
        </div>
        {tlOpen && (
          <div className="overflow-x-auto" style={{ minHeight: 168 }}>
            <div className="flex text-[10px] text-slate-400 pl-20 pr-4 mb-1">
              {[8,10,12,14,16,18,20,22].map(h => <div key={h} style={{flex:1}}>{h}:00</div>)}
            </div>
            <div className="flex items-center mb-1.5">
              <span className="w-20 shrink-0 text-[11px] text-slate-600 pl-2 font-medium">今日</span>
              <div className="flex-1 flex items-center gap-1 min-h-[28px] rounded-lg bg-slate-100/50 px-1 py-0.5 overflow-hidden">
                {items.map(item => {
                  const pid = planSegments.get(item.seg.startTs)
                  const planTitle = pid ? (plans.find(p => p.id === pid)?.title ?? '') : ''
                  return renderSegBlock({...item.seg, planId: pid || undefined}, planTitle)
                })}
                {items.length === 0 && <span className="text-[10px] text-slate-400 px-2">暂无活动记录</span>}
              </div>
            </div>
            {plans.map(plan => (
              <div key={plan.id} className="flex items-center mb-1.5"
                onDragOver={e => e.preventDefault()} onDrop={() => handleAssignPlan(plan.id)}>
                <span className="w-20 shrink-0 text-[11px] text-slate-600 pl-2 truncate" title={plan.title}>
                  {plan.status === 'done' ? '✓ ' : plan.status === 'cancelled' ? '✕ ' : ''}{plan.title}
                </span>
                <div className="flex-1 flex items-center gap-1 min-h-[28px] rounded-lg px-1 py-0.5 overflow-hidden"
                  style={{ background: STATUS_BG[plan.status] || '#f8fafc', border: `1px solid ${STATUS_BORDER[plan.status] || '#e2e8f0'}` }}>
                  {getPlanSegs(plan.id).map(s => renderSegBlock({...s.seg, planId: plan.id}, plan.title))}
                {getPlanSegs(plan.id).length === 0 && <span className="text-[10px] text-slate-400 px-2">拖拽工作块到此处关联</span>}
                </div>
                <span className="w-16 shrink-0 text-right text-[10px] text-slate-400 pr-2">
                  {coverMin(plan.id)}/{plan.durationMin ?? '—'}m
                </span>
              </div>
            ))}
          </div>
        )}
      </section>

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
