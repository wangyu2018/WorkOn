import { useEffect, useState, useRef, useCallback, useMemo } from 'react'
import { createPortal } from 'react-dom'
import type { TimeEntry, WorkState, MergedTrail } from '@shared/types'
import { ALL_STATES, WORK_STATES, WORK_LIKE_STATES } from '@shared/stateMeta'
import { genId } from '@shared/types'
import { displayApp } from '@shared/appDisplayName'
import { Icon } from '../components/Icon'
import { PageHeader } from '../components/PageHeader'
import { ActivityHoverCard } from '../components/ActivityHoverCard'
import HeatmapView from './HeatmapView'
import {
  WEEK_LABELS,
  addDays,
  clockOf,
  fmtDateLabel,
  fmtMin,
  timeToMin,
  todayKey,
  weekDays
} from '../components/utils'

const SLACK_STATES: WorkState[] = ['slack', 'relax', 'break', 'lunch'] // 口径统一到 shared（不再含 idle/away）

type CalMode = 'week' | 'month' | 'heat'

function savedMode(): CalMode {
  try {
    const v = localStorage.getItem('calMode')
    if (v === 'week' || v === 'month' || v === 'heat') return v
    return 'week'
  } catch {
    return 'week'
  }
}
function saveMode(v: CalMode) {
  try {
    localStorage.setItem('calMode', v)
  } catch {
    /* */
  }
}

function parseCounterpart(app?: string, title?: string): string | undefined {
  if (!app || !title) return undefined
  const a = app.toLowerCase()
  if (/(wechat|weixin|wchar|wecom|企业微信)/.test(a)) {
    return title.replace(/\s*[-–]\s*(微信|WeChat|企业微信|WeCom).*$/i, '').trim() || undefined
  }
  if (/(chrome|edge|firefox|brave|safari|opera|浏览器)/.test(a)) {
    return title.replace(/\s*[-–]\s*(Chrome|Edge|Firefox|Brave|Safari|Opera|浏览器).*$/i, '').trim() || undefined
  }
  return undefined
}

const SOURCE_LABEL: Record<TimeEntry['source'], string> = {
  manual: '手动',
  monitor: '监控',
  import: '导入',
  ai: 'AI'
}

function senseOf(state: WorkState): 'work' | 'slack' | 'other' {
  if (SLACK_STATES.includes(state)) return 'slack'
  if (WORK_LIKE_STATES.includes(state)) return 'work'
  return 'other'
}

const SENSE_META = {
  work:  { label: '办公', rgb: '124 158 255' },
  slack: { label: '摸鱼', rgb: '255 124 124' },
  other: { label: '其他', rgb: '148 163 184' },
} as const

function ActivityDetailCard({ entry, pos, onEdit, onClose, matchedApp, matchedTitle, counterpart, topic }: {
  entry: TimeEntry
  pos: { x: number; y: number }
  onEdit: () => void
  onClose: () => void
  matchedApp?: string
  matchedTitle?: string
  counterpart?: string
  topic?: string
}) {
  const meta = WORK_STATES[entry.state ?? 'idle'] ?? WORK_STATES.idle
  const sense = SENSE_META[senseOf(entry.state ?? 'idle')]
  const app = matchedApp ?? displayApp(entry.title)
  const title = matchedTitle ?? entry.title
  // 智能贴边：锚点 = 色块右上角。卡片优先显示在色块右侧、向下；右侧/下方放不下则向左/向上，并钳制在可视区内
  const W = 260
  const H = 190
  const margin = 8
  let left = pos.x + margin
  let top = pos.y
  if (left + W > window.innerWidth - margin) left = pos.x - W - margin
  left = Math.max(margin, Math.min(left, window.innerWidth - W - margin))
  if (top + H > window.innerHeight - margin) top = Math.max(margin, window.innerHeight - H - margin)

  return (
    <>
      <div className="fixed inset-0 z-[55]" onClick={onClose} />
      <div
        className="fixed z-[56] rounded-xl px-3 py-2 anim-scale-in"
        style={{
          width: W,
          background: 'var(--pop-bg)',
          border: `1px solid rgb(${sense.rgb}/0.35)`,
          boxShadow: 'var(--pop-shadow)',
          backdropFilter: 'blur(12px)',
          WebkitBackdropFilter: 'blur(12px)',
          color: 'var(--pop-text)',
          left: `${left}px`,
          top: `${top}px`,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-2">
          <span className="text-[12px] font-semibold truncate">{app}</span>
          <span className="shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium"
            style={{ color: `rgb(${sense.rgb})`, background: `rgb(${sense.rgb}/0.14)` }}>
            {sense.label}
          </span>
        </div>
        <div className="mt-1 text-[11px] leading-snug" style={{ color: 'var(--pop-text-strong)' }}>
          {title || '（未命名）'}
        </div>
        {(counterpart || topic) ? (
          <div className="mt-1 text-[11px] leading-snug" style={{ color: 'var(--pop-text-muted)' }}>
            {counterpart ? <span>与 <b style={{ color: 'var(--pop-text-strong)' }}>{counterpart}</b> 沟通</span> : null}
            {topic ? <span>查看：<b style={{ color: 'var(--pop-text-strong)' }}>{topic}</b></span> : null}
          </div>
        ) : null}
        <div className="mt-1.5 flex items-center gap-2 text-[10px]" style={{ color: 'var(--pop-text-muted)' }}>
          <span>{clockOf(entry.startMin)} – {clockOf(entry.endMin)}</span>
          <span style={{ color: 'var(--pop-text-muted)' }}>·</span>
          <span>{fmtMin(entry.endMin - entry.startMin)}</span>
          <span className="ml-auto rounded px-1 py-0.5" style={{ background: 'var(--pop-badge-bg)', color: 'var(--pop-badge-text)' }}>{SOURCE_LABEL[entry.source]}</span>
        </div>
        <div className="mt-2 flex items-center gap-2">
          <button
            className="flex-1 rounded-lg border border-white/10 py-1 text-[10px] text-slate-300 transition-colors hover:bg-white/[0.08]"
            onClick={onEdit}
          >
            ✏️ 编辑
          </button>
          <button
            className="rounded-lg border border-white/10 px-2 py-1 text-[10px] text-slate-400 transition-colors hover:bg-white/[0.08]"
            onClick={onClose}
          >
            关闭
          </button>
        </div>
      </div>
    </>
  )
}

/* ── 条目编辑弹窗 ── */
interface EditorProps {
  entry: TimeEntry
  isNew: boolean
  onClose: () => void
  onSaved: () => void
}

function EntryEditor({ entry, isNew, onClose, onSaved }: EditorProps) {
  const [draft, setDraft] = useState<TimeEntry>(entry)
  const [timeHint, setTimeHint] = useState('')

  const setTime = (key: 'startMin' | 'endMin', v: string) => {
    const min = timeToMin(v)
    if (min !== undefined) setDraft((d) => ({ ...d, [key]: min }))
  }

  const save = async () => {
    if (draft.endMin <= draft.startMin) {
      setTimeHint('结束时间需晚于开始时间（至少 5 分钟），已自动修正')
    } else {
      setTimeHint('')
    }
    if (!draft.title.trim()) return
    const startMin = Math.max(0, Math.min(draft.startMin, draft.endMin - 5))
    await window.api.saveEntry({ ...draft, startMin, title: draft.title.trim() })
    onSaved()
    onClose()
  }

  const remove = async () => {
    await window.api.removeEntry(draft.id)
    onSaved()
    onClose()
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div className="glass-card anim-scale-in w-[340px]" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="flex items-center gap-2 text-[15px] font-semibold text-slate-200">
            <Icon name="edit" size={14} className="text-neon-cyan" />
            {isNew ? '补录时段' : '编辑时段'}
          </h3>
          <span className="chip">{SOURCE_LABEL[draft.source]}</span>
        </div>
        <div className="flex flex-col gap-3">
          <input
            className="glass-input"
            placeholder="这段时间在做什么？"
            autoFocus
            value={draft.title}
            onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void save()
              if (e.key === 'Escape') onClose()
            }}
          />
            <label className="flex items-center gap-1.5 text-[11px] text-slate-500">
              日期
              <input type="date" value={draft.date}
                onChange={(e) => setDraft((d) => ({ ...d, date: e.target.value }))}
                className="glass-input !px-2 !py-1 !text-[11px]"
              />
            </label>
          <div className="grid grid-cols-2 gap-2">
            <label className="text-[11px] text-slate-500">
              开始
              <input
                type="time"
                className="glass-input mt-1"
                value={clockOf(draft.startMin)}
                onChange={(e) => setTime('startMin', e.target.value)}
              />
            </label>
            <label className="text-[11px] text-slate-500">
              结束
              <input
                type="time"
                className="glass-input mt-1"
                value={clockOf(draft.endMin)}
                onChange={(e) => setTime('endMin', e.target.value)}
              />
            </label>
          </div>
          <div>
            <div className="mb-1.5 text-[11px] text-slate-500">状态</div>
            <div className="grid grid-cols-4 gap-1.5">
              {ALL_STATES.map((s) => {
                const m = WORK_STATES[s]
                const active = draft.state === s
                return (
                  <button
                    key={s}
                    className={`rounded-lg border px-1 py-1 text-[11px] transition-all ${
                      active ? 'border-neon-cyan/60 bg-neon-cyan/10 text-slate-100' : 'border-white/[0.07] text-slate-400 hover:bg-white/[0.05]'
                    }`}
                    style={active ? { boxShadow: `0 0 10px ${m.color}33` } : undefined}
                    onClick={() => setDraft((d) => ({ ...d, state: s }))}
                  >
                    {m.emoji} {m.label}
                  </button>
                )
              })}
            </div>
          </div>
          <div className="mt-1 flex items-center gap-2">
            {!isNew ? (
              <button className="glass-btn danger" onClick={() => void remove()}>
                <Icon name="trash" size={13} /> 删除
              </button>
            ) : null}
            <div className="flex-1" />
            <button className="glass-btn" onClick={onClose}>
              取消
            </button>
            {timeHint ? <div className="mb-1.5 text-[11px] text-amber-300">⚠ {timeHint}</div> : null}
            <button className="glass-btn primary" disabled={!draft.title.trim()} onClick={() => void save()}>
              <Icon name="check" size={13} /> 保存
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

/* ── 周视图：七列状态色块概览 + 事儿层 ── */
/* ── 月模式：滚动月历（月份流 + 视口高亮 + 天格点击补录） ── */
function monthKeyOf(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function MonthStream() {
  const months = useMemo(() => {
    const now = new Date()
    const out: string[] = []
    for (let i = 0; i < 12; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
      out.push(monthKeyOf(d))
    }
    return out
  }, [])
  const [active, setActive] = useState(() => monthKeyOf(new Date()))
  const [stats, setStats] = useState<Record<string, { date: string; min: number; topState: WorkState }[]>>({})
  const [editor, setEditor] = useState<{ entry: TimeEntry; isNew: boolean } | null>(null)
  const sectionRefs = useRef<Record<string, HTMLDivElement | null>>({})

  const loadMonth = useCallback(async (ym: string) => {
    const [y, m] = ym.split('-').map(Number)
    const dayCount = new Date(y, m, 0).getDate()
    const stats: { date: string; min: number; topState: WorkState }[] = []
    for (let d = 1; d <= dayCount; d++) {
      const date = `${ym}-${String(d).padStart(2, '0')}`
      try {
        const trail = await window.api?.getTrail?.(date)
        if (!trail) continue
        let topState: WorkState = 'idle'
        let topMin = 0
        ;(Object.entries(trail.stateMinutes) as [WorkState, number][]).forEach(([st, min]) => {
          if (min > topMin) { topState = st; topMin = min }
        })
        if (trail.totalMin > 0) stats.push({ date, min: Math.round(trail.totalMin), topState })
      } catch { /* ignore */ }
    }
    setStats((prev) => ({ ...prev, [ym]: stats }))
  }, [])

  useEffect(() => {
    months.forEach((ym) => void loadMonth(ym))
  }, [months, loadMonth])

  // 视口高亮：滚动时取与视口中线最近的月份
  useEffect(() => {
    const onScroll = (): void => {
      const mid = window.innerHeight * 0.4
      let best: string | null = null
      let bestDist = Infinity
      for (const ym of months) {
        const el = sectionRefs.current[ym]
        if (!el) continue
        const r = el.getBoundingClientRect()
        const dist = Math.abs(r.top + r.height / 2 - mid)
        if (dist < bestDist) { bestDist = dist; best = ym }
      }
      if (best) setActive(best)
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    onScroll()
    return () => window.removeEventListener('scroll', onScroll)
  }, [months])

  const scrollToMonth = (ym: string): void => {
    sectionRefs.current[ym]?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    setActive(ym)
  }

  const monthLabelOf = (ym: string): string => {
    const [y, m] = ym.split('-').map(Number)
    return `${y}年${m}月`
  }

  return (
    <div className="view-enter flex flex-col gap-4">
      <div className="anim-fade-up flex items-center gap-2">
        <button className="glass-btn !px-2" onClick={() => scrollToMonth(months[Math.min(months.indexOf(active) + 1, months.length - 1)])}>
          <Icon name="chevronLeft" size={14} />
        </button>
        <button className="glass-btn" onClick={() => scrollToMonth(monthKeyOf(new Date()))}>本月</button>
        <button className="glass-btn !px-2" onClick={() => scrollToMonth(months[Math.max(0, months.indexOf(active) - 1)])}>
          <Icon name="chevronRight" size={14} />
        </button>
        <span className="ml-1 text-[16px] font-semibold tabular-nums text-slate-100">{monthLabelOf(active)}</span>
        <span className="ml-2 text-[11px] text-slate-500">滚动页面浏览历史月份 · 点击日期补录</span>
      </div>

      {months.map((ym) => {
        const days = stats[ym]
        const total = (days ?? []).reduce((s, d) => s + d.min, 0)
        const isActive = active === ym
        return (
          <div
            key={ym}
            data-month={ym}
            ref={(el) => { sectionRefs.current[ym] = el }}
            className="glass-card anim-fade-up"
            style={{
              borderColor: isActive ? 'var(--tl-now)' : undefined,
              boxShadow: isActive ? '0 0 0 1px var(--tl-now), 0 8px 30px rgba(0,0,0,0.25)' : undefined,
              scrollMarginTop: 16
            }}
          >
            <div className="mb-2 flex items-center justify-between">
              <h3 className={`text-[15px] font-semibold ${isActive ? 'text-neon-cyan' : 'text-slate-200'}`}>
                {monthLabelOf(ym)}
                {ym === monthKeyOf(new Date()) ? <span className="ml-2 text-[10px] text-slate-500">本月</span> : null}
              </h3>
              <span className="text-[11px] text-slate-500">
                {total > 0 ? `合计 ${Math.floor(total / 60)}h ${total % 60}m` : '当月无记录'}
              </span>
            </div>
            {!days ? (
              <div className="py-4 text-center text-[11px] text-slate-600">加载中…</div>
            ) : days.length === 0 ? (
              <div className="py-4 text-center text-[11px] text-slate-600">当月无记录</div>
            ) : (
              <div className="grid grid-cols-7 gap-1.5">
                {days.map((d) => {
                  const meta = WORK_STATES[d.topState] ?? WORK_STATES.idle
                  const dayNum = Number(d.date.slice(-2))
                  return (
                    <button
                      key={d.date}
                      className="rounded-lg border p-2 text-left transition-all hover:border-neon-cyan/40 hover:bg-white/[0.04]"
                      style={{ borderColor: 'rgba(255,255,255,0.07)', background: 'rgba(255,255,255,0.02)' }}
                      onClick={() => setEditor({
                        isNew: true,
                        entry: {
                          id: `new-${d.date}`,
                          date: d.date,
                          startMin: 9 * 60,
                          endMin: 18 * 60,
                          title: '',
                          source: 'manual',
                          ts: Date.now()
                        }
                      })}
                      title={`${d.date} · ${meta.label} ${d.min}m · 点击补录`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-[12px] font-semibold text-slate-200">{dayNum}</span>
                        <span className="h-2 w-2 rounded-full" style={{ background: meta.color, opacity: Math.min(1, 0.3 + d.min / 240) }} />
                      </div>
                      <div className="mt-0.5 text-[10px] tabular-nums text-slate-500">{d.min > 0 ? `${Math.floor(d.min / 60)}h ${d.min % 60}m` : '—'}</div>
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        )
      })}

      {editor ? (
        <EntryEditor
          entry={editor.entry}
          isNew={editor.isNew}
          onClose={() => setEditor(null)}
          onSaved={() => { setEditor(null); void loadMonth(monthKeyOf(new Date())) }}
        />
      ) : null}
    </div>
  )
}

function WeekGrid({ date }: { date: string }) {
  const [trails, setTrails] = useState<(MergedTrail | null)[]>([])
  const [dayEntries, setDayEntries] = useState<Record<string, TimeEntry[]>>({})
  const [editor, setEditor] = useState<{ entry: TimeEntry; isNew: boolean } | null>(null)
  const [hoverEntry, setHoverEntry] = useState<string | null>(null)
  const [mouse, setMouse] = useState({ x: 0, y: 0 })
  const [detailEntry, setDetailEntry] = useState<TimeEntry | null>(null)
  const [detailPos, setDetailPos] = useState({ x: 0, y: 0 })
  /** 小时 hover 预览：hour + 色块 rect + 该小时 top5 应用 */
  const [hourHover, setHourHover] = useState<{ day: string; hour: number; apps: { app: string; min: number }[]; rect: DOMRect } | null>(null)
  const detailRef = useRef<HTMLDivElement | null>(null)
  const days = weekDays(date)
  /** 应用图标/主题色缓存 */
  const [appVisuals, setAppVisuals] = useState<Record<string, { iconDataUrl: string; themeColor: string }>>({})
  useEffect(() => {
    window.api.getAppVisuals?.().then((v) => setAppVisuals((v as Record<string, { iconDataUrl: string; themeColor: string }>) ?? {})).catch(() => undefined)
  }, [])

  useEffect(() => {
    Promise.all(days.map((d) => window.api.getTrail(d).catch(() => null))).then((ts) =>
      setTrails(ts as (MergedTrail | null)[])
    )
    Promise.all(
      days.map((d) =>
        window.api
          .listEntries(d)
          .then((list) => (list as TimeEntry[]) ?? [])
          .catch(() => [] as TimeEntry[])
      )
    ).then((entries) => {
      const map: Record<string, TimeEntry[]> = {}
      days.forEach((d, i) => {
        map[d] = entries[i]
      })
      setDayEntries(map)
    })
  }, [date]) // eslint-disable-line react-hooks/exhaustive-deps

  const refetchDay = async (dayKey: string) => {
    const entries = ((await window.api.listEntries(dayKey)) as TimeEntry[]) ?? []
    setDayEntries((prev) => ({ ...prev, [dayKey]: entries }))
  }

  const getEntrySegment = (entry: TimeEntry, trail: MergedTrail | null) => {
    if (!trail) return null
    const dayTs = new Date(`${entry.date}T00:00:00`).getTime()
    const sTs = dayTs + entry.startMin * 60000
    const eTs = dayTs + entry.endMin * 60000
    let best: (typeof trail.segments)[number] | null = null
    let bestOverlap = 0
    for (const seg of trail.segments) {
      const overlap = Math.max(0, Math.min(eTs, seg.endTs) - Math.max(sTs, seg.startTs))
      if (overlap > bestOverlap) {
        bestOverlap = overlap
        best = seg
      }
    }
    return best
  }

  const handleEntryClick = (entry: TimeEntry, dayKey: string, trailsData: (MergedTrail | null)[]) => {
    setDetailPos(mouse)
    setDetailEntry(entry)
  }

  const handleHourClick = (dayKey: string, hour: number, trail: MergedTrail | null, e: React.MouseEvent) => {
    if (!trail) {
      // B19：空白小时也可点击补录（预填该小时时间段）
      setEditor({
        isNew: true,
        entry: {
          id: `new-${dayKey}-${hour}`,
          date: dayKey,
          startMin: hour * 60,
          endMin: hour * 60 + 60,
          title: '',
          source: 'manual',
          ts: Date.now()
        }
      })
      return
    }
    const dayTs = new Date(`${dayKey}T00:00:00`).getTime()
    const hStart = dayTs + hour * 3600000
    const hEnd = hStart + 3600000
    let best: (typeof trail.segments)[number] | null = null
    let bestOverlap = 0
    for (const seg of trail.segments) {
      const overlap = Math.max(0, Math.min(hEnd, seg.endTs) - Math.max(hStart, seg.startTs))
      if (overlap > bestOverlap) {
        bestOverlap = overlap
        best = seg
      }
    }
    if (best && bestOverlap > 0) {
      const sMin = new Date(best.startTs).getHours() * 60 + new Date(best.startTs).getMinutes()
      const eMin = new Date(best.endTs).getHours() * 60 + new Date(best.endTs).getMinutes()
      // 锚点用色块右上角（靠近图标），而非鼠标坐标，卡片贴近色块显示
      const rect = e.currentTarget.getBoundingClientRect()
      setDetailPos({ x: rect.right, y: rect.top })
      setDetailEntry({
        id: best.id ?? `seg-${best.startTs}`,
        date: dayKey,
        startMin: Math.max(sMin, 0),
        endMin: Math.min(eMin, 1440),
        title: best.mainApp,
        state: best.mainState,
        source: 'monitor',
        ts: best.startTs
      })
    }
  }

  /** 每小时主导态 */
  const hourStates = (trail: MergedTrail | null): (WorkState | null)[] => {
    const result: (WorkState | null)[] = new Array(24).fill(null)
    if (!trail) return result
    const acc: Map<WorkState, number>[] = Array.from({ length: 24 }, () => new Map())
    for (const seg of trail.segments) {
      let ts = seg.startTs
      while (ts < seg.endTs) {
        const h = new Date(ts).getHours()
        const next = new Date(ts)
        next.setHours(h + 1, 0, 0, 0)
        const end = Math.min(seg.endTs, next.getTime())
        const m = acc[h]
        m.set(seg.mainState, (m.get(seg.mainState) ?? 0) + (end - ts))
        ts = end
      }
    }
    for (let h = 0; h < 24; h++) {
      let best: WorkState | null = null
      let bestV = 0
      for (const [s, v] of acc[h]) {
        if (v > bestV) {
          bestV = v
          best = s
        }
      }
      result[h] = best
    }
    return result
  }

  /** 每小时主要应用：按该小时占用时长取 top5（含时长，供 hover 预览） */
  const hourApps = (trail: MergedTrail | null): ({ app: string; min: number }[] | null)[] => {
    const result: ({ app: string; min: number }[] | null)[] = new Array(24).fill(null)
    if (!trail) return result
    const acc: Map<string, number>[] = Array.from({ length: 24 }, () => new Map())
    for (const seg of trail.segments) {
      if (seg.glance || !seg.mainApp) continue
      let ts = seg.startTs
      while (ts < seg.endTs) {
        const h = new Date(ts).getHours()
        const next = new Date(ts)
        next.setHours(h + 1, 0, 0, 0)
        const end = Math.min(seg.endTs, next.getTime())
        const m = acc[h]
        m.set(seg.mainApp, (m.get(seg.mainApp) ?? 0) + (end - ts))
        ts = end
      }
    }
    for (let h = 0; h < 24; h++) {
      if (!acc[h].size) continue
      const sorted = [...acc[h].entries()].sort((a, b) => b[1] - a[1])
      result[h] = sorted.slice(0, 5).map(([app, min]) => ({ app, min: min / 60000 }))
    }
    return result
  }

  const today = todayKey()

  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setDetailEntry(null)
    }
    window.addEventListener('keydown', handleEsc)
    return () => window.removeEventListener('keydown', handleEsc)
  }, [])

  return (
    <div className="anim-fade-up grid grid-cols-7 gap-3" style={{ animationDelay: '120ms' }}>
      {days.map((d, i) => {
        const trail = trails[i] ?? null
        const states: (WorkState | null)[] = trails.length ? hourStates(trail) : new Array(24).fill(null)
        const dt = new Date(`${d}T00:00:00`)
        const isToday = d === today
        const entries = dayEntries[d] ?? []
        return (
          <div
            key={d}
            className={`glass-card !p-2 rounded-xl bg-white/[0.02] transition-transform hover:-translate-y-0.5 ${isToday ? '!border-neon-cyan/40' : ''}`}
            style={isToday ? { boxShadow: '0 0 16px rgba(34,211,238,0.15)' } : undefined}
          >
            <div className="mb-2 flex items-center justify-between">
              <div>
                <div className={`text-[11px] ${isToday ? 'font-semibold text-cyan-400' : 'text-slate-400'}`}>
                  周{WEEK_LABELS[i]} {dt.getMonth() + 1}/{dt.getDate()}
                </div>
                <div className="text-[10px] text-slate-500">
                  {trail && trail.totalMin > 0 ? fmtMin(trail.totalMin) : '—'}
                </div>
              </div>
              <button
                className="text-[14px] leading-none text-slate-500 transition-colors hover:text-neon-cyan"
                title="补录时段"
                onClick={() =>
                  setEditor({
                    isNew: true,
                    entry: {
                      id: genId('entry'),
                      date: d,
                      startMin: 9 * 60,
                      endMin: 10 * 60,
                      title: '',
                      state: 'focus',
                      source: 'manual',
                      ts: Date.now()
                    }
                  })
                }
              >
                ＋
              </button>
            </div>
            <div className="flex flex-col gap-1">
              {(() => { const appList = hourApps(trail); return states.map((s, h) => {
                const apps = appList[h]
                return (
                <div
                  key={h}
                  title={`${d} ${h}:00${s ? ` · ${WORK_STATES[s].label}` : ''}${apps ? ` · ${apps.map((a) => displayApp(a.app)).join('、')}` : ''}`}
                  className="w-full cursor-pointer rounded-lg px-2 py-1 text-[10px] transition-colors hover:brightness-110"
                  style={{
                    borderLeft: s ? `2px solid ${WORK_STATES[s].color}` : '2px solid transparent',
                    background: s ? `${WORK_STATES[s].color}14` : 'rgba(255,255,255,0.03)',
                    color: s ? '#cbd5e1' : '#475569'
                  }}
                  onClick={(e) => handleHourClick(d, h, trail, e)}
                  onMouseEnter={(e) => { if (apps) setHourHover({ day: d, hour: h, apps, rect: e.currentTarget.getBoundingClientRect() }) }}
                  onMouseLeave={() => setHourHover(null)}
                >
                  <span className="flex items-center gap-1.5">
                    <span className="shrink-0 text-slate-500">{String(h).padStart(2, '0')}:00</span>
                    {apps ? (
                      <span className="flex min-w-0 flex-1 items-center gap-1">
                        {apps.slice(0, 2).map((a) => {
                          const v = appVisuals[a.app.trim().toLowerCase().replace(/\.exe$/i, '')]
                          return v ? (
                            <img key={a.app} src={v.iconDataUrl} alt={displayApp(a.app)} title={displayApp(a.app)} className="h-3.5 w-3.5 shrink-0 rounded-[3px]" style={{ background: 'rgba(255,255,255,0.06)' }} />
                          ) : (
                            <span key={a.app} className="truncate text-slate-400" title={displayApp(a.app)}>{displayApp(a.app)}</span>
                          )
                        })}
                      </span>
                    ) : s ? (
                      <span className="min-w-0 flex-1 truncate"> {WORK_STATES[s].emoji} {WORK_STATES[s].label}</span>
                    ) : null}
                  </span>
                </div>
                )
              }) })()}
            </div>
            <div className="mt-2 border-t border-white/[0.05] pt-1.5">
              {entries.length === 0 ? (
                <div className="text-center text-[10px] text-slate-600">—</div>
              ) : (
                [...entries]
                  .sort((a, b) => a.endMin - b.endMin)
                  .map((entry) => {
                    const meta = WORK_STATES[entry.state ?? 'idle'] ?? WORK_STATES.idle
                    return (
                       <div
                        key={entry.id}
                        className="relative mb-1 cursor-pointer rounded-lg border-l-2 px-2 py-1 text-[10px] transition-all hover:brightness-125"
                        style={{
                          borderColor: meta.color,
                          background: `${meta.color}12`
                        }}
                        onClick={() => handleEntryClick(entry, d, trails)}
                        onMouseEnter={() => setHoverEntry(entry.id)}
                        onMouseLeave={() => setHoverEntry(null)}
                        onMouseMove={(e) => setMouse({ x: e.clientX, y: e.clientY })}
                      >
                        <div className="flex items-center gap-1">
                          <span>{meta.emoji}</span>
                          <span className="truncate">{entry.title || '（未命名）'}</span>
                        </div>
                        <div className="mt-0.5 text-[9px] text-slate-500">
                          {clockOf(entry.startMin)}–{clockOf(entry.endMin)} · {fmtMin(entry.endMin - entry.startMin)}
                        </div>
                        {hoverEntry === entry.id && (
                          (() => {
                            const seg = getEntrySegment(entry, trail)
                            const app = seg ? displayApp(seg.mainApp) : (meta.emoji + ' ' + meta.label)
                            const title = seg?.mainTitle ?? entry.title
                            const counterpart = seg ? parseCounterpart(seg.mainApp, seg.mainTitle) : undefined
                            return (
                              <ActivityHoverCard a={{
                                app,
                                title: title || '（未命名）',
                                state: entry.state ?? 'idle',
                                startText: clockOf(entry.startMin),
                                endText: clockOf(entry.endMin),
                                durationText: fmtMin(entry.endMin - entry.startMin),
                                source: SOURCE_LABEL[entry.source],
                                mode: 'fixed',
                                pos: mouse,
                                counterpart: seg && /wechat|weixin|wchar|wecom|企业微信/.test(seg.mainApp.toLowerCase()) ? counterpart : undefined,
                                topic: seg && /chrome|edge|firefox|brave|safari|opera/i.test(seg.mainApp) ? counterpart : undefined,
                                microActivity: (seg as any)?.microActivity ?? null,
                              }} />
                            )
                          })()
                        )}
                      </div>
                    )
                  })
              )}
            </div>
          </div>
        )
      })}
      {editor ? (
        <EntryEditor
          entry={editor.entry}
          isNew={editor.isNew}
          onClose={() => setEditor(null)}
          onSaved={() => {
            void refetchDay(editor.entry.date)
          }}
        />
      ) : null}
      {detailEntry ? (
        (() => {
          const dayTrail = trails[days.indexOf(detailEntry.date)] ?? null
          const seg = getEntrySegment(detailEntry, dayTrail)
          const app = seg ? displayApp(seg.mainApp) : displayApp(detailEntry.title)
          const title = seg?.mainTitle ?? detailEntry.title
          const cpt = seg ? parseCounterpart(seg.mainApp, seg.mainTitle) : undefined
          const isWechat = seg && /wechat|weixin|wchar|wecom|企业微信/.test(seg.mainApp.toLowerCase())
          const isBrowser = seg && /chrome|edge|firefox|brave|safari|opera/i.test(seg.mainApp)
          return (
            <ActivityDetailCard
              entry={detailEntry}
              pos={detailPos}
              matchedApp={app}
              matchedTitle={title}
              counterpart={isWechat ? cpt : undefined}
              topic={isBrowser ? cpt : undefined}
              onEdit={() => { setEditor({ entry: detailEntry, isNew: false }); setDetailEntry(null) }}
              onClose={() => setDetailEntry(null)}
            />
          )
        })()
      ) : null}
      {hourHover ? createPortal(
        <HourPreviewCard apps={hourHover.apps} rect={hourHover.rect} hour={hourHover.hour} day={hourHover.day} visuals={appVisuals} />,
        document.body
      ) : null}
    </div>
  )
}

/** 小时 hover 预览：显示该小时 top5 应用（图标 + 名称 + 时长），贴色块边缘翻转防溢出 */
function HourPreviewCard({ apps, rect, hour, day, visuals }: {
  apps: { app: string; min: number }[]
  rect: DOMRect
  hour: number
  day: string
  visuals: Record<string, { iconDataUrl: string; themeColor: string }>
}) {
  const W = 220
  const H = Math.min(apps.length * 30 + 40, 200)
  const margin = 8
  let left = rect.right + margin
  if (left + W > window.innerWidth - margin) left = rect.left - W - margin
  left = Math.max(margin, Math.min(left, window.innerWidth - W - margin))
  let top = rect.top
  if (top + H > window.innerHeight - margin) top = Math.max(margin, window.innerHeight - H - margin)
  return (
    <div
      className="fixed z-[58] rounded-xl border px-3 py-2 anim-scale-in"
      style={{
        width: W,
        left, top,
        background: 'var(--pop-bg)',
        borderColor: 'var(--pop-border)',
        boxShadow: 'var(--pop-shadow)',
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
        color: 'var(--pop-text)',
        pointerEvents: 'none'
      }}
    >
      <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold" style={{ color: 'var(--pop-text)' }}>
        <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: 'var(--accent)' }} />
        {day} {String(hour).padStart(2, '0')}:00 主要操作
      </div>
      <div className="flex flex-col gap-1">
        {apps.map((a) => {
          const v = visuals[a.app.trim().toLowerCase().replace(/\.exe$/i, '')]
          return (
            <div key={a.app} className="flex items-center gap-2">
              {v ? (
                <img src={v.iconDataUrl} alt="" className="h-4 w-4 shrink-0 rounded-[3px]" style={{ background: 'rgba(0,0,0,0.05)' }} />
              ) : (
                <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-[3px] text-[9px]" style={{ background: 'rgba(0,0,0,0.05)' }}>·</span>
              )}
              <span className="min-w-0 flex-1 truncate text-[11px]" style={{ color: 'var(--pop-text-strong)' }}>{displayApp(a.app)}</span>
              <span className="shrink-0 text-[10px] tabular-nums" style={{ color: 'var(--pop-text-muted)' }}>{Math.round(a.min)}m</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

/** 当天应用图标行：真实图标 + hover 应用名；宽度不够时省略只留主要工作 */
function DayAppIcons({ trail, visuals }: {
  trail: MergedTrail
  visuals: Record<string, { iconDataUrl: string; themeColor: string }>
}) {
  // 按应用聚合时长，取前 6（有图标的优先显示图标）
  const apps = useMemo(() => {
    const m = new Map<string, number>()
    for (const s of trail.segments) {
      if (s.glance || s.mainState === 'idle' || s.mainState === 'away') continue
      m.set(s.mainApp, (m.get(s.mainApp) ?? 0) + s.durationMin)
    }
    return [...m.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([app, min]) => ({ app, min }))
  }, [trail])

  if (apps.length === 0) return null
  return (
    <div
      className="mb-2 flex items-center gap-1 overflow-hidden"
      title={apps.map((a) => `${displayApp(a.app)} · ${fmtMin(a.min)}`).join('\n')}
    >
      {apps.map((a, i) => {
        const v = visuals[a.app.trim().toLowerCase().replace(/\.exe$/i, '')]
        return (
          <span
            key={a.app}
            className="flex shrink-0 items-center gap-1 rounded px-0.5 py-0.5 transition-colors hover:bg-white/[0.06]"
            title={`${displayApp(a.app)} · ${fmtMin(a.min)}`}
            style={{ maxWidth: 44 }}
          >
            {v ? (
              <img src={v.iconDataUrl} alt="" className="h-4 w-4 rounded-[3px]" style={{ background: 'rgba(255,255,255,0.06)' }} />
            ) : (
              <span className="text-[9px] text-slate-500">{displayApp(a.app)}</span>
            )}
            {/* 宽度不足时默认显示主要工作（第一个应用的名称） */}
            {i === 0 ? (
              <span className="max-w-[40px] overflow-hidden text-ellipsis whitespace-nowrap text-[9px] text-slate-500">{displayApp(a.app)}</span>
            ) : null}
          </span>
        )
      })}
    </div>
  )
}

/* ── 日历主视图 ── */
export default function CalendarView() {
  const [mode, setMode] = useState<CalMode>(savedMode)
  const [date, setDate] = useState(todayKey())
  const [currentMonth, setCurrentMonth] = useState(() => {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
  })

  const navigateMonth = (offset: number) => {
    const [y, m] = currentMonth.split('-').map(Number)
    const d = new Date(y, m - 1 + offset, 1)
    setCurrentMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
  }

  const monthLabel = (() => {
    const [y, m] = currentMonth.split('-').map(Number)
    return `${y}年${m}月`
  })()

  const MODES: { key: CalMode; label: string }[] = [
    { key: 'week', label: '周' },
    { key: 'month', label: '月' },
    { key: 'heat', label: '热度' }
  ]

  return (
    <div className="view-enter flex flex-col gap-5">
      {/* 页面标题区 */}
      <PageHeader icon="calendar" title="时间日历" desc="周视图概览 · 月度热力图 · 点击 ＋ 补录时段" />

      {/* 工具条 */}
      <div className="anim-fade-up flex flex-wrap items-center gap-2" style={{ animationDelay: '60ms' }}>
        {mode === 'week' ? (
          <>
            <button className="glass-btn !px-2" onClick={() => setDate((d) => addDays(d, -7))}>
              <Icon name="chevronLeft" size={14} />
            </button>
            <button className="glass-btn" onClick={() => setDate(todayKey())}>
              今天
            </button>
            <button className="glass-btn !px-2" onClick={() => setDate((d) => addDays(d, 7))}>
              <Icon name="chevronRight" size={14} />
            </button>
            <span className="ml-1 text-[16px] font-semibold tabular-nums text-slate-100">
              {fmtDateLabel(date)}
            </span>
          </>
        ) : (
          <>
            <button className="glass-btn !px-2" onClick={() => navigateMonth(-1)}>
              <Icon name="chevronLeft" size={14} />
            </button>
            <button
              className="glass-btn"
              onClick={() => {
                const d = new Date()
                setCurrentMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
              }}
            >
              本月
            </button>
            <button className="glass-btn !px-2" onClick={() => navigateMonth(1)}>
              <Icon name="chevronRight" size={14} />
            </button>
            <span className="ml-1 text-[16px] font-semibold tabular-nums text-slate-100">
              {monthLabel}
            </span>
          </>
        )}
        <div className="flex-1" />
        <div className="flex rounded-full border border-white/10 bg-white/[0.03] p-0.5">
          {MODES.map((m) => (
            <button
              key={m.key}
              className={`rounded-full px-4 py-1.5 text-[12px] ${
                mode === m.key ? 'bg-white/[0.08] text-slate-200' : 'text-slate-500 hover:text-slate-300'
              }`}
              onClick={() => {
                setMode(m.key)
                saveMode(m.key)
              }}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>

      {mode === 'week' ? (
        <WeekGrid date={date} />
      ) : mode === 'heat' ? (
        <div className="glass-card hoverable anim-fade-up" style={{ animationDelay: '120ms' }}>
          <h2 className="mb-3 flex items-center gap-2 text-[15px] font-semibold text-slate-200">
            <Icon name="flame" size={15} className="text-neon-amber" />
            {monthLabel} 工作热度
          </h2>
          <HeatmapView range="month" yearMonth={currentMonth} />
        </div>
      ) : (
        <MonthStream />
      )}
    </div>
  )
}
