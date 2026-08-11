/**
 * 首页 — 今日图谱 + 工作/生活时间轴 + 标签面板（PRD v3.1 G+H）
 */
import { useEffect, useState, useMemo, useCallback } from 'react'
import { WORK_LIKE_STATES, WORK_STATES } from '@shared/stateMeta'
import type { MergedTrail, TrailSegment, WorkState, PlanItem } from '@shared/types'

const CHANNELS = ['CMD', '浏览器', '微信', 'IDE', '其他'] as const
type Channel = (typeof CHANNELS)[number]
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

  const renderCard = (item: GraphItem, idx: number) => {
    const { seg, column } = item
    const stateInfo = WORK_STATES[seg.mainState]
    const isDragging = dragFrom?.idx === idx
    return (
      <div key={`${seg.id}-${idx}`} draggable onDragStart={() => setDragFrom({ idx, col: column })} onDragEnd={() => { setDragFrom(null); setHoverCol(null) }}
        className={`group relative cursor-grab rounded-xl px-3 py-2 text-[12px] leading-tight transition-all active:cursor-grabbing ${isDragging ? 'opacity-30 scale-95' : ''} ${column === 'work' ? 'bg-emerald-500/10 border border-emerald-500/20 hover:bg-emerald-500/15' : 'bg-slate-400/10 border border-slate-400/15 hover:bg-slate-400/15'}`}
        style={{ minWidth: 80 }}
        title={`${seg.mainApp} · ${fmtTime(seg.startTs)}-${fmtTime(seg.endTs)} · ${fmtDur(seg.durationMin)}${seg.mainTitle ? `\n${seg.mainTitle}` : ''}`}>
        <div className="flex items-center gap-1.5"><span className="text-[13px]">{stateInfo?.emoji ?? '📌'}</span><span className="truncate font-medium text-slate-200">{seg.mainApp}</span></div>
        <div className="mt-0.5 text-[10px] text-slate-400 flex items-center justify-between"><span>{fmtDur(seg.durationMin)}</span><span>{fmtTime(seg.startTs)}</span></div>
        {seg.mainTitle && <div className="mt-0.5 truncate text-[10px] text-slate-500 max-w-[140px]">{seg.mainTitle}</div>}
      </div>
    )
  }

  const colDropProps = (col: Column) => ({
    onDragOver: (e: React.DragEvent) => { e.preventDefault(); setHoverCol(col) },
    onDragLeave: () => setHoverCol(null),
    onDrop: () => { if (dragFrom && dragFrom.col !== col) moveItem(dragFrom.idx, col); setHoverCol(null); setDragFrom(null) }
  })

  const tlIcons: Record<string, string> = { focus: '🔵', plan: '📋', switch: '🔄', meeting: '📝' }

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

      {/* 图谱 */}
      <section className="glass-card hoverable">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <span className="text-base">🗂️</span>
            <h3 className="text-[13px] font-semibold text-slate-200">今日图谱</h3>
          </div>
          <span className="text-[11px] text-slate-500">工作🟢 {fmtDur(totalWorkMin)} · 生活⚪ {fmtDur(totalLifeMin)} · 拖动卡片可纠偏分类</span>
        </div>
        <div className="flex gap-4">
          <div className={`flex w-1/2 flex-col gap-2 rounded-xl border p-3 transition-all ${hoverCol === 'work' && dragFrom && dragFrom.col !== 'work' ? 'border-emerald-400/40 bg-emerald-500/8' : 'border-transparent bg-slate-500/5'}`} {...colDropProps('work')}>
            <h4 className="text-[12px] font-semibold text-emerald-400 pb-1">🟢 工作</h4>
            <div className="flex min-h-0 flex-col gap-1.5">
              {CHANNELS.map((ch) => {
                const chItems = items.filter((i) => i.column === 'work' && i.channel === ch)
                if (chItems.length === 0) return null
                return <div key={ch} className="flex flex-col gap-1"><span className="text-[10px] uppercase tracking-wider text-slate-600 pl-1">{ch}</span><div className="flex flex-wrap gap-1.5">{chItems.map((item) => renderCard(item, items.indexOf(item)))}</div></div>
              })}
              {items.filter((i) => i.column === 'work').length === 0 && <p className="py-8 text-center text-[12px] text-slate-600">从右边拖卡片过来分类 📥</p>}
            </div>
          </div>
          <div className={`flex w-1/2 flex-col gap-2 rounded-xl border p-3 transition-all ${hoverCol === 'life' && dragFrom && dragFrom.col !== 'life' ? 'border-slate-400/30 bg-slate-500/8' : 'border-transparent bg-slate-500/5'}`} {...colDropProps('life')}>
            <h4 className="text-[12px] font-semibold text-slate-400 pb-1">⚪ 生活</h4>
            <div className="flex min-h-0 flex-col gap-1.5">
              {CHANNELS.map((ch) => {
                const chItems = items.filter((i) => i.column === 'life' && i.channel === ch)
                if (chItems.length === 0) return null
                return <div key={ch} className="flex flex-col gap-1"><span className="text-[10px] uppercase tracking-wider text-slate-600 pl-1">{ch}</span><div className="flex flex-wrap gap-1.5">{chItems.map((item) => renderCard(item, items.indexOf(item)))}</div></div>
              })}
              {items.filter((i) => i.column === 'life').length === 0 && <p className="py-8 text-center text-[12px] text-slate-600">把左边误判的工作卡片拖过来 🔄</p>}
            </div>
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
              <div key={i} className="shrink-0 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 min-w-[140px]">
                <div className="flex items-center gap-1.5 text-[11px] text-slate-400 mb-0.5">
                  <span>{tlIcons[e.type]}</span><span>{e.type === 'focus' ? e.app : '计划'}</span><span className="ml-auto">{fmtTime(e.ts)}</span>
                </div>
                <p className="text-[12px] text-slate-200 truncate">{e.title || '无标题'}</p>
                {e.duration && <span className="text-[10px] text-slate-500">{fmtDur(e.duration)}</span>}
              </div>
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
