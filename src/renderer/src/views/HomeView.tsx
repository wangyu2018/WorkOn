/**
 * 首页 — 今日图谱 + 一句话洞察 + 标签面板（PRD v3.0 P0）
 */
import { useEffect, useState, useMemo, useCallback } from 'react'
import { WORK_LIKE_STATES, WORK_STATES } from '@shared/stateMeta'
import type { MergedTrail, TrailSegment, WorkState } from '@shared/types'

const CHANNELS = ['CMD', '浏览器', '微信', 'IDE', '其他'] as const
type Channel = (typeof CHANNELS)[number]

function mapChannel(app: string): Channel {
  const lower = app.toLowerCase()
  if (['cmd', 'powershell', 'terminal', 'alacritty', 'kitty', 'wt'].some((n) => lower.includes(n))) return 'CMD'
  if (['chrome', 'edge', 'firefox', 'brave', 'safari', 'opera'].some((n) => lower.includes(n))) return '浏览器'
  if (['wechat', '微信', 'weixin', 'wecom'].some((n) => lower.includes(n))) return '微信'
  if (['code', 'vscode', 'cursor', 'intellij', 'idea', 'webstorm', 'pycharm', 'android studio', 'eclipse'].some((n) => lower.includes(n))) return 'IDE'
  return '其他'
}

function formatTime(ts: number): string {
  const d = new Date(ts)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function formatDuration(min: number): string {
  if (min < 1) return '<1m'
  if (min < 60) return `${Math.round(min)}m`
  const h = Math.floor(min / 60)
  const m = Math.round(min % 60)
  return m > 0 ? `${h}h${m}m` : `${h}h`
}

type Column = 'work' | 'life'

interface GraphItem {
  seg: TrailSegment
  channel: Channel
  column: Column
}

interface TagRule {
  id: string
  app: string
  label: string
  state: WorkState
  hitCount: number
  enabled: boolean
}

function generateInsight(trail: MergedTrail): string {
  if (!trail || trail.totalMin < 1) return '今天刚开始，图谱会慢慢长出来 ~'
  const totalH = Math.round(trail.totalMin / 60 * 10) / 10
  const focusMin = (trail.stateMinutes.focus ?? 0) + (trail.stateMinutes.coding ?? 0)
  const slackMin = (trail.stateMinutes.slack ?? 0) + (trail.stateMinutes.relax ?? 0) + (trail.stateMinutes.break ?? 0)
  const segments = trail.segments.filter((s) => !s.glance)
  const topApp = segments.reduce<Record<string, number>>((acc, s) => { acc[s.mainApp] = (acc[s.mainApp] ?? 0) + s.durationMin; return acc }, {})
  const top = Object.entries(topApp).sort((a, b) => b[1] - a[1])[0]
  if (focusMin > slackMin * 3 && focusMin > 120) return `今天深度专注 ${Math.round(focusMin)} 分钟，状态很好，主要泡在 ${top?.[0] ?? '工作中'} 里。`
  if (slackMin > totalH * 60 * 0.4) return `今天摸鱼偏多（${Math.round(slackMin)}m），要不要下一段集中一下？`
  return `今天工作了 ${totalH}h，主要在 ${top?.[0] ?? '各种工具'} 上，节奏平稳。`
}

export default function HomeView() {
  const [trail, setTrail] = useState<MergedTrail | null>(null)
  const [items, setItems] = useState<GraphItem[]>([])
  const [tags, setTags] = useState<TagRule[]>([])
  const [dragFrom, setDragFrom] = useState<{ idx: number; col: Column } | null>(null)
  const [hoverCol, setHoverCol] = useState<Column | null>(null)
  const [tagsOpen, setTagsOpen] = useState(false)
  const [newTag, setNewTag] = useState({ app: '', label: '', state: 'focus' as WorkState })

  useEffect(() => {
    void (async () => {
      const t = await window.api?.getTrail?.()
      if (t) {
        const trail = t as MergedTrail
        setTrail(trail)
        const segs = trail.segments.filter((s) => !s.glance && s.durationMin > 0)
        setItems(segs.map((seg) => ({
          seg,
          channel: mapChannel(seg.mainApp),
          column: WORK_LIKE_STATES.includes(seg.mainState) ? 'work' : 'life' as Column
        })))
      }
    })()
  }, [])

  const loadTags = useCallback(() => {
    void window.api?.listRules?.().then((rules) => {
      const mapped = (rules as Array<Record<string, unknown>>)?.map((r) => ({
        id: r.id as string,
        app: r.matchApp as string,
        label: (r.setState ?? 'focus') as WorkState,
        state: (r.setState ?? 'focus') as WorkState,
        hitCount: (r.hitCount ?? 0) as number,
        enabled: (r.enabled ?? true) as boolean
      })) ?? []
      setTags(mapped)
    })
  }, [])

  useEffect(() => { loadTags() }, [loadTags])

  const insight = useMemo(() => (trail ? generateInsight(trail) : ''), [trail])

  const totalWorkMin = useMemo(
    () => items.filter((i) => i.column === 'work').reduce((a, i) => a + i.seg.durationMin, 0),
    [items]
  )
  const totalLifeMin = useMemo(
    () => items.filter((i) => i.column === 'life').reduce((a, i) => a + i.seg.durationMin, 0),
    [items]
  )

  const moveItem = useCallback((idx: number, toCol: Column) => {
    setItems((prev) => {
      const next = [...prev]
      const item = next[idx]
      next[idx] = { ...item, column: toCol }

      // 拖拽纠偏 → 自动沉淀规则
      void window.api?.saveRule?.({
        screen: 0,
        matchApp: item.seg.mainApp,
        matchTitleContains: '',
        setState: toCol === 'work' ? 'coding' : 'slack' as WorkState,
        weight: 1,
        enabled: true
      }).then(() => loadTags())

      return next
    })
  }, [loadTags])

  const addTagRule = useCallback(async () => {
    if (!newTag.app.trim() || !newTag.label.trim()) return
    await window.api?.saveRule?.({
      screen: 0,
      matchApp: newTag.app.trim(),
      matchTitleContains: newTag.label.trim(),
      setState: newTag.state,
      weight: 1,
      enabled: true
    })
    setNewTag({ app: '', label: '', state: 'focus' })
    loadTags()
  }, [newTag, loadTags])

  const toggleTag = useCallback((id: string, enabled: boolean) => {
    void window.api?.saveRule?.({ id, enabled }).then(() => loadTags())
  }, [loadTags])

  const removeTag = useCallback((id: string) => {
    void window.api?.removeRule?.(id).then(() => loadTags())
  }, [loadTags])

  const renderCard = (item: GraphItem, idx: number) => {
    const { seg, column } = item
    const stateInfo = WORK_STATES[seg.mainState]
    const isDragging = dragFrom?.idx === idx

    return (
      <div
        key={`${seg.id}-${idx}`}
        draggable
        onDragStart={() => setDragFrom({ idx, col: column })}
        onDragEnd={() => { setDragFrom(null); setHoverCol(null) }}
        className={`group relative cursor-grab rounded-xl px-3 py-2 text-[12px] leading-tight transition-all active:cursor-grabbing ${
          isDragging ? 'opacity-30 scale-95' : ''
        } ${
          column === 'work'
            ? 'bg-emerald-500/10 border border-emerald-500/20 hover:bg-emerald-500/15'
            : 'bg-slate-500/10 border border-slate-500/15 hover:bg-slate-500/15'
        }`}
        style={{ minWidth: 80 }}
        title={`${seg.mainApp} · ${formatTime(seg.startTs)}-${formatTime(seg.endTs)} · ${formatDuration(seg.durationMin)}${seg.mainTitle ? `\n${seg.mainTitle}` : ''}`}
      >
        <div className="flex items-center gap-1.5">
          <span className="text-[13px]">{stateInfo?.emoji ?? '📌'}</span>
          <span className="truncate font-medium text-slate-200">{seg.mainApp}</span>
        </div>
        <div className="mt-0.5 text-[10px] text-slate-500 flex items-center justify-between">
          <span>{formatDuration(seg.durationMin)}</span>
          <span>{formatTime(seg.startTs)}</span>
        </div>
        {seg.mainTitle && (
          <div className="mt-0.5 truncate text-[10px] text-slate-600 max-w-[140px]">{seg.mainTitle}</div>
        )}
      </div>
    )
  }

  const columnDropProps = (col: Column) => ({
    onDragOver: (e: React.DragEvent) => { e.preventDefault(); setHoverCol(col) },
    onDragLeave: () => setHoverCol(null),
    onDrop: () => { if (dragFrom && dragFrom.col !== col) moveItem(dragFrom.idx, col); setHoverCol(null); setDragFrom(null) }
  })

  return (
    <div className="flex h-full flex-col gap-4">
      {/* 一句话洞察 */}
      {insight && (
        <div className="anim-fade-in rounded-2xl bg-gradient-to-r from-violet-500/10 to-cyan-500/10 border border-violet-500/15 px-5 py-3">
          <p className="text-[14px] text-slate-300 leading-relaxed">💡 {insight}</p>
        </div>
      )}

      {/* 图谱主区域 */}
      <div className="flex min-h-0 flex-1 gap-4">
        {/* 工作区 */}
        <div
          className={`flex w-1/2 flex-col gap-2 rounded-2xl border p-3 transition-all ${
            hoverCol === 'work' && dragFrom && dragFrom.col !== 'work'
              ? 'border-emerald-400/40 bg-emerald-500/8'
              : 'border-white/5 bg-ink-950/40'
          }`}
          {...columnDropProps('work')}
        >
          <div className="flex items-center justify-between px-1">
            <h3 className="text-[13px] font-semibold text-emerald-400">🟢 工作</h3>
            <span className="text-[11px] text-slate-500">{formatDuration(totalWorkMin)}</span>
          </div>
          <div className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-auto">
            {CHANNELS.map((ch) => {
              const chItems = items.filter((i) => i.column === 'work' && i.channel === ch)
              if (chItems.length === 0) return null
              return (
                <div key={ch} className="flex flex-col gap-1">
                  <span className="text-[10px] uppercase tracking-wider text-slate-600 pl-1">{ch}</span>
                  <div className="flex flex-wrap gap-1.5">
                    {chItems.map((item) => {
                      const idx = items.indexOf(item)
                      return renderCard(item, idx)
                    })}
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* 生活区 */}
        <div
          className={`flex w-1/2 flex-col gap-2 rounded-2xl border p-3 transition-all ${
            hoverCol === 'life' && dragFrom && dragFrom.col !== 'life'
              ? 'border-slate-400/30 bg-slate-500/8'
              : 'border-white/5 bg-ink-950/40'
          }`}
          {...columnDropProps('life')}
        >
          <div className="flex items-center justify-between px-1">
            <h3 className="text-[13px] font-semibold text-slate-400">⚪ 生活</h3>
            <span className="text-[11px] text-slate-500">{formatDuration(totalLifeMin)}</span>
          </div>
          <div className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-auto">
            {CHANNELS.map((ch) => {
              const chItems = items.filter((i) => i.column === 'life' && i.channel === ch)
              if (chItems.length === 0) return null
              return (
                <div key={ch} className="flex flex-col gap-1">
                  <span className="text-[10px] uppercase tracking-wider text-slate-600 pl-1">{ch}</span>
                  <div className="flex flex-wrap gap-1.5">
                    {chItems.map((item) => {
                      const idx = items.indexOf(item)
                      return renderCard(item, idx)
                    })}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {/* 标签管理面板（折叠） */}
      <div className="rounded-2xl border border-white/5 bg-ink-950/40 p-3">
        <button
          onClick={() => setTagsOpen(!tagsOpen)}
          className="flex w-full items-center justify-between text-left"
        >
          <div className="flex items-center gap-2">
            <span className="text-[13px] font-semibold text-slate-300">🏷️ 分类标签规则</span>
            <span className="text-[11px] text-slate-600">{tags.length} 条</span>
          </div>
          <span className="text-[11px] text-slate-500">{tagsOpen ? '收起 ▲' : '展开 ▼'}</span>
        </button>

        {tagsOpen && (
          <div className="mt-3 space-y-2">
            {tags.length === 0 ? (
              <p className="text-[12px] text-slate-600 py-2">
                还没有标签规则。在右边图谱中拖拽卡片到工作/生活区会自动创建规则；也可以手动添加。
              </p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {tags.map((t) => (
                  <div
                    key={t.id}
                    className={`flex items-center gap-2 rounded-lg px-3 py-1.5 text-[11px] ${
                      t.enabled ? 'bg-neon-cyan/10 border border-neon-cyan/20' : 'bg-slate-500/5 border border-slate-500/10 opacity-50'
                    }`}
                  >
                    <span className="text-slate-300">{WORK_STATES[t.state]?.emoji ?? '📌'}</span>
                    <span className="text-slate-200">{t.app}</span>
                    <span className="text-slate-500">→ {WORK_STATES[t.state]?.label ?? t.state}</span>
                    <span className="text-slate-600 text-[10px]">({t.hitCount}次)</span>
                    <button
                      onClick={() => toggleTag(t.id, !t.enabled)}
                      className="ml-1 text-slate-500 hover:text-slate-300"
                      title={t.enabled ? '禁用' : '启用'}
                    >
                      {t.enabled ? '✓' : '○'}
                    </button>
                    <button onClick={() => removeTag(t.id)} className="text-slate-600 hover:text-red-400" title="删除">
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* 手动添加标签规则 */}
            <div className="mt-3 flex items-center gap-2">
              <input
                className="w-32 rounded-lg border border-white/10 bg-ink-900 px-2 py-1 text-[11px] text-slate-200 placeholder-slate-600 outline-none focus:border-neon-cyan/30"
                placeholder="应用名"
                value={newTag.app}
                onChange={(e) => setNewTag({ ...newTag, app: e.target.value })}
              />
              <input
                className="w-32 rounded-lg border border-white/10 bg-ink-900 px-2 py-1 text-[11px] text-slate-200 placeholder-slate-600 outline-none focus:border-neon-cyan/30"
                placeholder="关键词（可选）"
                value={newTag.label}
                onChange={(e) => setNewTag({ ...newTag, label: e.target.value })}
              />
              <select
                className="rounded-lg border border-white/10 bg-ink-900 px-2 py-1 text-[11px] text-slate-300 outline-none"
                value={newTag.state}
                onChange={(e) => setNewTag({ ...newTag, state: e.target.value as WorkState })}
              >
                {Object.entries(WORK_STATES).map(([k, v]) => (
                  <option key={k} value={k}>{v.emoji} {v.label}</option>
                ))}
              </select>
              <button
                onClick={addTagRule}
                className="rounded-lg bg-neon-cyan/15 border border-neon-cyan/25 px-3 py-1 text-[11px] text-neon-cyan hover:bg-neon-cyan/25 transition-colors"
              >
                + 添加
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
