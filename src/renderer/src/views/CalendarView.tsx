import { useEffect, useState, useRef, useCallback } from 'react'
import type { TimeEntry, WorkState, MergedTrail } from '@shared/types'
import { ALL_STATES, WORK_STATES, WORK_LIKE_STATES } from '@shared/stateMeta'
import { genId } from '@shared/types'
import { displayApp } from '@shared/appDisplayName'
import { Icon } from '../components/Icon'
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

const SLACK_STATES: WorkState[] = ['slack', 'relax', 'break', 'lunch', 'idle', 'away']

type CalMode = 'week' | 'month'

function savedMode(): CalMode {
  try {
    const v = localStorage.getItem('calMode') as CalMode | null
    if (v === 'day' || v === 'heat') return 'week'
    return (v as CalMode) ?? 'week'
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

const SLACK_STATES: WorkState[] = ['slack', 'relax', 'break', 'lunch', 'idle', 'away']

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
  const meta = WORK_STATES[entry.state] ?? WORK_STATES.idle
  const sense = SENSE_META[senseOf(entry.state ?? 'idle')]
  const app = matchedApp ?? displayApp(entry.title)
  const title = matchedTitle ?? entry.title

  return (
    <>
      <div className="fixed inset-0 z-[55]" onClick={onClose} />
      <div
        className="fixed z-[56] rounded-xl px-3 py-2 shadow-lg"
        style={{
          width: 240,
          background: '#ffffff',
          border: `1px solid rgb(${sense.rgb}/0.55)`,
          boxShadow: '0 4px 18px rgba(15,23,42,0.15)',
          color: '#1e293b',
          left: `${pos.x}px`,
          top: `${pos.y}px`,
          transform: pos.x + 240 + 16 > window.innerWidth
            ? 'translate(calc(-100% - 16px), 16px)'
            : 'translate(0, 16px)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-2">
          <span className="text-[12px] font-semibold truncate">{app}</span>
          <span className="shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium"
            style={{ color: `rgb(${sense.rgb})`, background: `rgb(${sense.rgb}/0.12)` }}>
            {sense.label}
          </span>
        </div>
        <div className="mt-1 text-[11px] leading-snug" style={{ color: '#334155' }}>
          {title || '（未命名）'}
        </div>
        {(counterpart || topic) ? (
          <div className="mt-1 text-[11px] leading-snug" style={{ color: '#64748b' }}>
            {counterpart ? <span>与 <b style={{ color: '#334155' }}>{counterpart}</b> 沟通</span> : null}
            {topic ? <span>查看：<b style={{ color: '#334155' }}>{topic}</b></span> : null}
          </div>
        ) : null}
        <div className="mt-1.5 flex items-center gap-2 text-[10px]" style={{ color: '#64748b' }}>
          <span>{clockOf(entry.startMin)} – {clockOf(entry.endMin)}</span>
          <span style={{ color: '#94a3b8' }}>·</span>
          <span>{fmtMin(entry.endMin - entry.startMin)}</span>
          <span className="ml-auto rounded px-1 py-0.5" style={{ background: '#f1f5f9', color: '#475569' }}>{SOURCE_LABEL[entry.source]}</span>
        </div>
        <div className="mt-2 flex items-center gap-2">
          <button
            className="flex-1 rounded-lg border border-slate-200 py-1 text-[10px] text-slate-600 transition-colors hover:bg-slate-100"
            onClick={onEdit}
          >
            ✏️ 编辑
          </button>
          <button
            className="rounded-lg border border-slate-200 px-2 py-1 text-[10px] text-slate-400 transition-colors hover:bg-slate-100"
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

  const setTime = (key: 'startMin' | 'endMin', v: string) => {
    const min = timeToMin(v)
    if (min !== undefined) setDraft((d) => ({ ...d, [key]: min }))
  }

  const save = async () => {
    if (!draft.title.trim()) return
    const startMin = Math.min(draft.startMin, draft.endMin - 5)
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
function WeekGrid({ date }: { date: string }) {
  const [trails, setTrails] = useState<(MergedTrail | null)[]>([])
  const [dayEntries, setDayEntries] = useState<Record<string, TimeEntry[]>>({})
  const [editor, setEditor] = useState<{ entry: TimeEntry; isNew: boolean } | null>(null)
  const [hoverEntry, setHoverEntry] = useState<string | null>(null)
  const [mouse, setMouse] = useState({ x: 0, y: 0 })
  const [detailEntry, setDetailEntry] = useState<TimeEntry | null>(null)
  const [detailPos, setDetailPos] = useState({ x: 0, y: 0 })
  const detailRef = useRef<HTMLDivElement | null>(null)
  const days = weekDays(date)

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
    if (!trail) return
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
      setDetailPos({ x: e.clientX, y: e.clientY })
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
              {states.map((s, h) => (
                <div
                  key={h}
                  title={`${d} ${h}:00${s ? ` · ${WORK_STATES[s].label}` : ''}`}
                  className="w-full cursor-pointer rounded-lg px-2 py-1 text-[10px] transition-colors hover:brightness-110"
                  style={{
                    borderLeft: s ? `2px solid ${WORK_STATES[s].color}` : '2px solid transparent',
                    background: s ? `${WORK_STATES[s].color}14` : 'rgba(255,255,255,0.03)',
                    color: s ? '#cbd5e1' : '#475569'
                  }}
                  onClick={(e) => handleHourClick(d, h, trail, e)}
                >
                  {String(h).padStart(2, '0')}:00
                  {s ? <span> {WORK_STATES[s].emoji} {WORK_STATES[s].label}</span> : null}
                </div>
              ))}
            </div>
            <div className="mt-2 border-t border-white/[0.05] pt-1.5">
              {entries.length === 0 ? (
                <div className="text-center text-[10px] text-slate-600">—</div>
              ) : (
                entries
                  .sort((a, b) => a.endMin - b.endMin)
                  .map((entry) => {
                    const meta = WORK_STATES[entry.state]
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
                                state: entry.state,
                                startText: clockOf(entry.startMin),
                                endText: clockOf(entry.endMin),
                                durationText: fmtMin(entry.endMin - entry.startMin),
                                source: SOURCE_LABEL[entry.source],
                                mode: 'fixed',
                                pos: mouse,
                                counterpart: seg && /wechat|weixin|wchar|wecom|企业微信/.test(seg.mainApp.toLowerCase()) ? counterpart : undefined,
                                topic: seg && /chrome|edge|firefox|brave|safari|opera/i.test(seg.mainApp) ? counterpart : undefined,
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
    { key: 'month', label: '月' }
  ]

  return (
    <div className="view-enter flex flex-col gap-5">
      {/* 页面标题区 */}
      <header className="anim-fade-up flex items-center gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-neon-cyan/25 bg-neon-cyan/10 text-neon-cyan shadow-glow">
          <Icon name="calendar" size={20} />
        </div>
        <div className="min-w-0">
          <h1 className="text-[17px] font-semibold leading-tight text-slate-100">时间日历</h1>
          <p className="mt-0.5 text-[11px] text-slate-500">周视图概览 · 月度热力图 · 点击 ＋ 补录时段</p>
        </div>
      </header>

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
      ) : (
        <div className="glass-card hoverable anim-fade-up" style={{ animationDelay: '120ms' }}>
          <h2 className="mb-3 flex items-center gap-2 text-[15px] font-semibold text-slate-200">
            <Icon name="flame" size={15} className="text-neon-amber" />
            {monthLabel} 工作热度
          </h2>
          <HeatmapView range="month" yearMonth={currentMonth} />
        </div>
      )}
    </div>
  )
}
