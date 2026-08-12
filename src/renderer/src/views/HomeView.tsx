/**
 * 首页 — 今日图谱 + 工作/生活时间轴 + 标签面板（PRD v3.1 G+H）
 */
import { useEffect, useState, useMemo, useCallback } from 'react'
import { WORK_LIKE_STATES, WORK_STATES } from '@shared/stateMeta'
import type { MergedTrail, TrailSegment, WorkState, PlanItem } from '@shared/types'
import ActionCard from '../components/ActionCard'

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

interface TimelineEntry {
  type: 'focus' | 'plan' | 'switch' | 'meeting'
  ts: number; app: string; title: string; duration?: number
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
  const [timeline, setTimeline] = useState<TimelineEntry[]>([])
  const [dragFrom, setDragFrom] = useState<{ idx: number; col: Column } | null>(null)
  const [hoverCol, setHoverCol] = useState<Column | null>(null)
  const [tagsOpen, setTagsOpen] = useState(false)
  const [newTag, setNewTag] = useState({ app: '', label: '', state: 'focus' as WorkState })
  const [tlOpen, setTlOpen] = useState(false)
  const [starHover, setStarHover] = useState<number | null>(null)

  useEffect(() => {
    void (async () => {
      const t = await window.api?.getTrail?.() as MergedTrail | undefined
      const p = await window.api?.listPlans?.() as PlanItem[] | undefined
      if (t) {
        setTrail(t)
        const segs = t.segments.filter((s) => !s.glance && s.durationMin > 0)
        setItems(segs.map((seg) => ({ seg, channel: mapChannel(seg.mainApp), column: WORK_LIKE_STATES.includes(seg.mainState) ? 'work' : 'life' })))
        // 构建时间轴
        const tl: TimelineEntry[] = segs.map((s) => ({ type: 'focus' as const, ts: s.startTs, app: s.mainApp, title: s.mainTitle ?? '', duration: s.durationMin }))
        if (p) {
          setPlans(p)
          for (const plan of p) {
            if (plan.startMin) tl.push({ type: 'plan', ts: new Date().setHours(0, 0, 0, 0) + plan.startMin * 60000, app: '📋', title: plan.title })
          }
        }
        tl.sort((a, b) => a.ts - b.ts)
        setTimeline(tl)
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
    const glowColor = isWork ? 'rgba(16,185,129,' : 'rgba(251,191,36,'
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
            ? isWork
              ? 'radial-gradient(circle at 35% 35%, rgba(110,231,183,0.95), rgba(16,185,129,0.5))'
              : 'radial-gradient(circle at 35% 35%, rgba(252,211,77,0.95), rgba(251,191,36,0.5))'
            : isWork
              ? 'radial-gradient(circle at 35% 35%, rgba(16,185,129,0.7), rgba(16,185,129,0.25))'
              : 'radial-gradient(circle at 35% 35%, rgba(251,191,36,0.7), rgba(251,191,36,0.25))',
          boxShadow: `0 0 ${node.isCore ? 12 : 6}px ${glowColor}${node.isCore ? 0.7 : 0.4}), 0 0 ${node.isCore ? 28 : 14}px ${glowColor}${node.isCore ? 0.25 : 0.12})`,
          opacity: isDragging ? 0.25 : 1,
          zIndex: node.isCore ? 10 : 5,
          scale: starHover === node.idx ? '1.15' : '1',
        }}
        title={`${node.item.seg.mainApp} · ${fmtTime(node.item.seg.startTs)}-${fmtTime(node.item.seg.endTs)} · ${fmtDur(node.item.seg.durationMin)}${node.item.seg.mainTitle ? '\n' + node.item.seg.mainTitle : ''}`}
      >
        {starHover === node.idx && (
          <div className="absolute -top-7 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-md bg-black/85 px-2 py-0.5 text-[10px] text-slate-200 pointer-events-none z-20">
            {node.item.seg.mainApp} · {fmtDur(node.item.seg.durationMin)}
          </div>
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

      {/* 星图 */}
      <section className="glass-card hoverable overflow-hidden">
        <div className="flex items-center justify-between mb-3 px-1">
          <div className="flex items-center gap-2">
            <span className="text-base">🗂️</span>
            <h3 className="text-[13px] font-semibold text-slate-200">今日星图</h3>
          </div>
          <span className="text-[11px] text-slate-500">工作 ✦ {fmtDur(totalWorkMin)} · 生活 ✦ {fmtDur(totalLifeMin)} · 拖动星点可纠偏</span>
        </div>
        <div className="relative flex rounded-xl overflow-hidden" style={{ minHeight: 320, background: 'radial-gradient(ellipse at center, rgba(15,23,42,0.45) 0%, rgba(3,7,17,0.95) 70%)' }}>
          <div className="absolute left-1/2 top-4 bottom-4 border-l-2 border-dashed border-white/[0.07] z-10" />
          <div className={`relative flex-1 min-h-[320px] transition-colors ${hoverCol === 'work' && dragFrom && dragFrom.col !== 'work' ? 'bg-emerald-500/[0.06]' : ''}`} {...starDropProps('work')}>
            <svg className="absolute inset-0 w-full h-full pointer-events-none" viewBox="0 0 100 100" preserveAspectRatio="none">
              {workChart.connections.map((c, i) => (
                <line key={i} x1={c.x1} y1={c.y1} x2={c.x2} y2={c.y2} stroke="rgba(16,185,129,0.12)" strokeWidth="0.3" />
              ))}
            </svg>
            <span className="absolute top-3 left-3 text-[11px] font-semibold text-emerald-400/60 z-10">工作</span>
            {workChart.nodes.length === 0 ? (
              <p className="absolute inset-0 flex items-center justify-center text-[12px] text-slate-600">从右边拖星点过来 ✦</p>
            ) : workChart.nodes.map(n => renderStarNode(n, true))}
          </div>
          <div className={`relative flex-1 min-h-[320px] transition-colors ${hoverCol === 'life' && dragFrom && dragFrom.col !== 'life' ? 'bg-amber-500/[0.06]' : ''}`} {...starDropProps('life')}>
            <svg className="absolute inset-0 w-full h-full pointer-events-none" viewBox="0 0 100 100" preserveAspectRatio="none">
              {lifeChart.connections.map((c, i) => (
                <line key={i} x1={c.x1} y1={c.y1} x2={c.x2} y2={c.y2} stroke="rgba(251,191,36,0.12)" strokeWidth="0.3" />
              ))}
            </svg>
            <span className="absolute top-3 right-3 text-[11px] font-semibold text-amber-400/60 z-10">生活</span>
            {lifeChart.nodes.length === 0 ? (
              <p className="absolute inset-0 flex items-center justify-center text-[12px] text-slate-600">把左边星点拖过来 ✦</p>
            ) : lifeChart.nodes.map(n => renderStarNode(n, false))}
          </div>
        </div>
      </section>

      {/* 时间轴 */}
      <section className="glass-card hoverable">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <span className="text-base">⏱️</span>
            <h3 className="text-[13px] font-semibold text-slate-200">时间轴</h3>
          </div>
          <button onClick={() => setTlOpen(!tlOpen)} className="text-[11px] text-slate-500 hover:text-slate-300">{tlOpen ? '收起 ▲' : '展开 ▼'}</button>
        </div>
        {tlOpen && (
          <div className="flex gap-2 overflow-x-auto pb-1">
            {timeline.length === 0 ? <p className="text-[12px] text-slate-600 py-2">暂无数据</p> : timeline.map((e, i) => (
              <ActionCard key={i}
                data={{ id: `${e.ts}-${i}`, title: e.title, startTs: e.ts, endTs: e.ts + (e.duration ?? 0) * 60000, app: e.app, type: e.type }}
                onUpdate={(patch) => {
                  setTimeline(prev => prev.map((t, idx) => idx === i ? { ...t, title: patch.title ?? t.title, ts: patch.startTs ?? t.ts, duration: patch.endTs ? (patch.endTs - (patch.startTs ?? t.ts)) / 60000 : t.duration } : t))
                }}
                onDelete={() => setTimeline(prev => prev.filter((_, idx) => idx !== i))}
              />
            ))}
          </div>
        )}
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
