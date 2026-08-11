import { useCallback, useEffect, useRef, useState } from 'react'
import type { PlanForecast, PlanVsActual, TimeEntry, UserHabits, WorkState, MergedTrail } from '@shared/types'
import { ALL_STATES, WORK_STATES } from '@shared/stateMeta'
import { genId } from '@shared/types'
import { Icon } from '../components/Icon'
import { EmptyState } from '../components/EmptyState'
import { useSettingsStore } from '../stores/settingsStore'
import HeatmapView from './HeatmapView'
import {
  WEEK_LABELS,
  addDays,
  clockOf,
  fmtDateLabel,
  fmtMin,
  minutesOfDay,
  timeToMin,
  todayKey,
  weekDays
} from '../components/utils'

type CalMode = 'day' | 'week' | 'heat'

// 持久化视图选择
function savedMode(): CalMode {
  try { return (localStorage.getItem('calMode') as CalMode) ?? 'heat' } catch { return 'heat' }
}
function saveMode(v: CalMode) { try { localStorage.setItem('calMode', v) } catch { /* */ } }

const DEFAULT_HOUR_H = 44 // 默认每小时高度 px（可缩放 22-88）

const SOURCE_LABEL: Record<TimeEntry['source'], string> = {
  manual: '手动',
  monitor: '监控',
  import: '导入',
  ai: 'AI'
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

/* ── 日视图：24h 时间格（可竖向缩放 + 计划叠加层） ── */
type SourceFilter = 'all' | 'monitor' | 'manual'

interface DayGridProps {
  date: string
  entries: TimeEntry[]
  trail: MergedTrail | null
  pva: PlanVsActual | null
  forecasts?: Map<string, PlanForecast>
  filter: SourceFilter
  hourH: number
  habits: UserHabits | null
  showBands: boolean
  onChanged: () => void
}

/** 应用名简写（作业链标签用） */
function shortApp(app: string): string {
  const base = app.replace(/\.exe$/i, '')
  return base.length > 8 ? base.slice(0, 8) : base
}

function DayGrid({ date, entries, trail, pva, forecasts, filter, hourH, habits, showBands, onChanged }: DayGridProps) {
  const gridRef = useRef<HTMLDivElement>(null)
  const [local, setLocal] = useState<TimeEntry[]>(entries)
  const [editor, setEditor] = useState<{ entry: TimeEntry; isNew: boolean } | null>(null)
  const [segDetail, setSegDetail] = useState<{ seg: MergedTrail['segments'][number]; x: number; y: number } | null>(null)
  const [planDetail, setPlanDetail] = useState<PlanVsActual['items'][number] | null>(null)
  const localRef = useRef(local)
  localRef.current = local
  const HOUR_H = hourH
  const DAY_H = HOUR_H * 24

  useEffect(() => setLocal(entries), [entries])

  const nowMinInit = date === todayKey() ? minutesOfDay(Date.now()) : null
  // 日视图打开时自动滚动到当前时间（定位在视口 1/3 处）
  useEffect(() => {
    if (nowMinInit === null) return
    const el = gridRef.current
    if (!el) return
    const scroller = el.closest('.overflow-auto') as HTMLElement | null
    if (!scroller) return
    const nowY = (nowMinInit / 1440) * DAY_H
    scroller.scrollTo({ top: Math.max(0, el.offsetTop + nowY - scroller.clientHeight / 3) })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, hourH])

  const yToMin = (clientY: number): number => {
    const rect = gridRef.current?.getBoundingClientRect()
    if (!rect) return 0
    const y = Math.max(0, Math.min(DAY_H, clientY - rect.top))
    return Math.round(((y / DAY_H) * 1440) / 5) * 5
  }

  /** 点击空白 → 新建（默认 1 小时） */
  const onGridMouseDown = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('[data-entry]')) return
    if ((e.target as HTMLElement).closest('[data-monitor-seg]')) return
    if ((e.target as HTMLElement).closest('[data-plan]')) return
    const start = Math.floor(yToMin(e.clientY) / 30) * 30
    setEditor({
      isNew: true,
      entry: {
        id: genId('entry'),
        date,
        startMin: start,
        endMin: Math.min(1440, start + 60),
        title: '',
        state: 'focus',
        source: 'manual',
        ts: Date.now()
      }
    })
  }

  /** 监控片段转手动记录 */
  const segToManual = async (seg: MergedTrail['segments'][number]) => {
    const startMin = minutesOfDay(seg.startTs)
    const endMin = Math.min(1440, minutesOfDay(seg.endTs))
    await window.api.saveEntry({
      id: genId('entry'),
      date,
      startMin,
      endMin: Math.max(startMin + 5, endMin),
      title: `${seg.mainApp}${seg.auxApp ? ' + ' + seg.auxApp : ''}`,
      state: seg.mainState,
      source: 'manual',
      ts: Date.now()
    })
    setSegDetail(null)
    onChanged()
  }

  /** 拖拽上下边缘调整起止 */
  const onHandleMouseDown = (e: React.MouseEvent, entry: TimeEntry, edge: 'start' | 'end') => {
    e.preventDefault()
    e.stopPropagation()
    const move = (ev: MouseEvent) => {
      const min = yToMin(ev.clientY)
      setLocal((prev) =>
        prev.map((en) => {
          if (en.id !== entry.id) return en
          if (edge === 'start') return { ...en, startMin: Math.max(0, Math.min(min, en.endMin - 15)) }
          return { ...en, endMin: Math.min(1440, Math.max(min, en.startMin + 15)) }
        })
      )
    }
    const up = () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
      const latest = localRef.current.find((en) => en.id === entry.id)
      if (latest && (latest.startMin !== entry.startMin || latest.endMin !== entry.endMin)) {
        void window.api.saveEntry(latest).then(onChanged)
      }
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  const nowMin = date === todayKey() ? minutesOfDay(Date.now()) : null
  const showMonitor = filter !== 'manual'
  const showManual = filter !== 'monitor'
  const monitorSegs = showMonitor && trail ? trail.segments : []

  return (
    <div className="flex gap-2">
      {/* 时间刻度 */}
      <div className="w-12 shrink-0 select-none">
        {Array.from({ length: 24 }, (_, h) => (
          <div key={h} className="relative text-right tabular-nums" style={{ height: HOUR_H }}>
            <span className="absolute -top-1.5 right-1.5 text-[11px] text-slate-400">{h}:00</span>
          </div>
        ))}
      </div>
      {/* 网格 */}
      <div
        ref={gridRef}
        className="relative flex-1 cursor-crosshair rounded-xl border border-white/[0.06] bg-transparent"
        style={{ height: DAY_H }}
        onMouseDown={onGridMouseDown}
        title="点击空白处补录时段"
      >
        {Array.from({ length: 24 }, (_, h) => (
          <div key={h} className="absolute left-0 right-0 border-t border-white/[0.05]" style={{ top: h * HOUR_H }} />
        ))}
        {/* 用户分析背景带（开关开启时：午休/高效时段底色） */}
        {showBands && habits ? (
          <>
            {habits.lunchTime
              ? (() => {
                  const m = habits.lunchTime!.match(/(\d+):(\d+)-(\d+):(\d+)/)
                  if (!m) return null
                  const s = Number(m[1]) * 60 + Number(m[2])
                  const e = Number(m[3]) * 60 + Number(m[4])
                  return (
                    <div
                      className="pointer-events-none absolute left-0 right-0"
                      style={{
                        top: (s / 1440) * DAY_H,
                        height: ((e - s) / 1440) * DAY_H,
                        background: 'rgba(251,146,60,0.07)',
                        borderLeft: '3px solid rgba(251,146,60,0.4)'
                      }}
                    >
                      <span className="absolute right-2 top-1 text-[10px] text-neon-amber/70">🍚 习惯午休 {habits.lunchTime}</span>
                    </div>
                  )
                })()
              : null}
            {(habits.preferredWorkHours ?? '').split('/').map((part) => {
              const m = part.trim().match(/^(\d+):00$/)
              if (!m) return null
              const s = Number(m[1]) * 60
              return (
                <div
                  key={part}
                  className="pointer-events-none absolute left-0 right-0"
                  style={{
                    top: (s / 1440) * DAY_H,
                    height: (120 / 1440) * DAY_H,
                    background: 'rgba(16,185,129,0.05)',
                    borderLeft: '3px solid rgba(16,185,129,0.35)'
                  }}
                >
                  <span className="absolute right-2 top-1 text-[10px] text-neon-green/70">⚡ 高效时段 {part.trim()}</span>
                </div>
              )
            })}
          </>
        ) : null}
        {/* 底层：监控实际轨迹（半透明，按主状态着色；段内作业链应用标签） */}
        {monitorSegs.map((seg, i) => {
          const start = minutesOfDay(seg.startTs)
          const end = Math.max(start + 2, Math.min(1440, minutesOfDay(seg.endTs)))
          const meta = WORK_STATES[seg.mainState]
          const top = (start / 1440) * DAY_H
          const height = Math.max(6, ((end - start) / 1440) * DAY_H)
          return (
            <div
              key={`seg-${seg.startTs}-${i}`}
              data-monitor-seg
              className="absolute left-0.5 right-0.5 cursor-pointer overflow-hidden rounded transition-all hover:z-10 hover:opacity-70"
              style={{ top, height, background: meta.color, opacity: 0.3 }}
              title={`${meta.emoji} ${meta.label} · ${seg.mainApp}`}
              onClick={(e) => {
                e.stopPropagation()
                setSegDetail({ seg, x: e.clientX, y: e.clientY })
              }}
            >
              {height >= 26 ? (
                <div className="pointer-events-none truncate px-1 text-[9px] leading-6 text-white/90" style={{ textShadow: '0 1px 2px rgba(0,0,0,0.6)' }}>
                  {meta.emoji} {shortApp(seg.mainApp)}{seg.auxApp ? ` ⇄ ${shortApp(seg.auxApp)}` : ''}
                </div>
              ) : null}
            </div>
          )
        })}
        {showManual && local.length === 0 && monitorSegs.length === 0 ? (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <span className="rounded-full border border-white/[0.06] bg-ink-900/70 px-3.5 py-1.5 text-[12px] text-slate-500">点击空白处补录时段</span>
          </div>
        ) : null}
        {/* 中层：计划叠加层（预测三色虚线框：绿=可完成 橙=可能延迟 红=高风险/已延期） */}
        {(pva?.items ?? [])
          .filter((it) => it.plan.startMin !== undefined && it.plan.endMin !== undefined && it.plan.endMin > it.plan.startMin)
          .map((it) => {
            const top = (it.plan.startMin! / 1440) * DAY_H
            const height = Math.max(14, ((it.plan.endMin! - it.plan.startMin!) / 1440) * DAY_H)
            const ok = it.matched
            const fc = forecasts?.get(it.plan.id)
            const prob = fc?.completionProb
            const color =
              it.plan.status === 'delayed' ? '#EF4444' : prob !== undefined ? (prob >= 60 ? '#10B981' : prob >= 30 ? '#F59E0B' : '#EF4444') : ok ? '#10B981' : '#F59E0B'
            const textColor = ok ? '#7FE8C0' : '#FCD08A'
            return (
              <button
                key={`plan-${it.plan.id}`}
                data-plan
                className="absolute left-2 right-2 z-[5] overflow-hidden rounded-md border border-dashed px-1.5 text-left text-[10px] leading-5 transition-all hover:z-[15] hover:brightness-125"
                style={{
                  top,
                  height,
                  borderColor: color,
                  background: `${color}14`,
                  color: textColor
                }}
                title={`${it.plan.title}${prob !== undefined ? ` · 完成概率 ${prob}%` : ok ? ' · ✓ 已覆盖' : ' · ⚠ 未覆盖'}`}
                onClick={(e) => {
                  e.stopPropagation()
                  setPlanDetail(it)
                }}
              >
                <span className="truncate">📋 {it.plan.title}</span>
              </button>
            )
          })}
        {/* 上层：手动记录条目（实线边框） */}
        {showManual
          ? local.map((en) => {
              const meta = en.state ? WORK_STATES[en.state] : null
              const color = meta?.color ?? '#3B82F6'
              const top = (en.startMin / 1440) * DAY_H
              const height = Math.max(14, ((en.endMin - en.startMin) / 1440) * DAY_H)
              return (
                <div
                  key={en.id}
                  data-entry
                   className="group absolute left-1 right-1 z-10 cursor-pointer rounded-xl border border-white/[0.04] bg-white/[0.03] border-l-4 px-2 py-0.5 shadow-sm transition-all hover:z-20 hover:brightness-125"
                  style={{
                    top,
                    height,
                    borderColor: color,
                    background: `linear-gradient(90deg, ${color}2E, ${color}14)`,
                    transitionDuration: '150ms'
                  }}
                  onClick={() => setEditor({ entry: en, isNew: false })}
                >
                  {/* 拖拽手柄 */}
                  <div
                    className="absolute inset-x-0 top-0 h-1.5 cursor-ns-resize opacity-0 transition-opacity group-hover:opacity-100"
                    style={{ background: `${color}66`, transitionDuration: '150ms' }}
                    onMouseDown={(e) => onHandleMouseDown(e, en, 'start')}
                  />
                  <div
                    className="absolute inset-x-0 bottom-0 h-1.5 cursor-ns-resize opacity-0 transition-opacity group-hover:opacity-100"
                    style={{ background: `${color}66`, transitionDuration: '150ms' }}
                    onMouseDown={(e) => onHandleMouseDown(e, en, 'end')}
                  />
                  <div className="pointer-events-none truncate text-[11px] font-medium text-slate-200">
                    {meta ? `${meta.emoji} ` : ''}
                    {en.title || '（未命名）'}
                  </div>
                  {height > 30 ? (
                    <div className="pointer-events-none text-[10px] text-slate-400">
                      {clockOf(en.startMin)}–{clockOf(en.endMin)} · {fmtMin(en.endMin - en.startMin)}
                    </div>
                  ) : null}
                </div>
              )
            })
          : null}
        {nowMin !== null ? (
          <div
            className="pointer-events-none absolute left-0 right-0 z-10 h-px bg-cyan-500/30"
            style={{ top: (nowMin / 1440) * DAY_H, boxShadow: '0 0 4px rgba(6,182,212,0.3)' }}
          >
            <span
              className="pulse-dot absolute -left-1 -top-[3px] h-[7px] w-[7px] rounded-full bg-cyan-500/50"
              style={{ boxShadow: '0 0 4px rgba(6,182,212,0.3)' }}
            />
          </div>
        ) : null}
      </div>
      {editor ? (
        <EntryEditor entry={editor.entry} isNew={editor.isNew} onClose={() => setEditor(null)} onSaved={onChanged} />
      ) : null}
      {/* 监控片段详情 */}
      {segDetail ? (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/55 backdrop-blur-sm" onClick={() => setSegDetail(null)}>
          <div className="glass-card anim-scale-in w-[300px]" onClick={(e) => e.stopPropagation()}>
            {(() => {
              const seg = segDetail.seg
              const meta = WORK_STATES[seg.mainState]
              const start = minutesOfDay(seg.startTs)
              const end = Math.min(1440, minutesOfDay(seg.endTs))
              return (
                <div className="flex flex-col gap-2 text-[12px]">
                  <div className="flex items-center gap-2">
                    <span className="chip" style={{ borderColor: `${meta.color}66` }}>
                      {meta.emoji} {meta.label}
                    </span>
                    <span className="text-slate-400">
                      {clockOf(start)}–{clockOf(end)}（{fmtMin(seg.durationMin)}）
                    </span>
                  </div>
                  <div className="text-slate-300">主屏：{seg.mainApp}</div>
                  {seg.auxApp ? (
                    <div className="text-slate-400">
                      副屏：{WORK_STATES[seg.auxState ?? 'idle'].emoji} {seg.auxApp}
                    </div>
                  ) : null}
                  {/* 作业链：前后相邻的不同应用序列 */}
                  {(() => {
                    const idx = monitorSegs.findIndex((s) => s.startTs === seg.startTs)
                    const chain: string[] = []
                    for (let j = Math.max(0, idx - 2); j <= Math.min(monitorSegs.length - 1, idx + 2); j++) {
                      const app = shortApp(monitorSegs[j].mainApp)
                      if (chain[chain.length - 1] !== app) chain.push(app)
                    }
                    return chain.length > 1 ? (
                      <div className="rounded-lg bg-white/[0.04] px-2 py-1.5 text-[11px] text-slate-400">
                        🔗 作业链：{chain.map((c, ci) => (
                          <span key={ci} className={c === shortApp(seg.mainApp) ? 'font-semibold text-neon-cyan' : ''}>
                            {ci > 0 ? ' → ' : ''}{c}
                          </span>
                        ))}
                      </div>
                    ) : null
                  })()}
                  <div className="mt-1 flex justify-end gap-2">
                    <button className="glass-btn" onClick={() => setSegDetail(null)}>
                      关闭
                    </button>
                    <button className="glass-btn primary" onClick={() => void segToManual(seg)}>
                      <Icon name="plus" size={13} /> 转为手动记录
                    </button>
                  </div>
                </div>
              )
            })()}
          </div>
        </div>
      ) : null}
      {/* 计划详情弹窗 */}
      {planDetail ? (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/55 backdrop-blur-sm" onClick={() => setPlanDetail(null)}>
          <div className="glass-card anim-scale-in w-[320px]" onClick={(e) => e.stopPropagation()}>
            {(() => {
              const it = planDetail
              const plannedMin = it.plan.durationMin ?? (it.plan.endMin! - it.plan.startMin!)
              const pct = plannedMin > 0 ? Math.min(100, Math.round((it.coveredMin / plannedMin) * 100)) : 0
              const fc = forecasts?.get(it.plan.id)
              return (
                <div className="flex flex-col gap-2 text-[12px]">
                  <div className="text-[14px] font-semibold text-slate-100">{it.plan.title}</div>
                  <div className="text-slate-400">
                    {it.plan.startMin !== undefined && it.plan.endMin !== undefined
                      ? `${clockOf(it.plan.startMin)}–${clockOf(it.plan.endMin)}`
                      : '无固定时间窗'}
                    {' · 计划 '}
                    {fmtMin(plannedMin)} · 实际 {fmtMin(it.coveredMin)}
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/[0.06]">
                      <div className={`h-full rounded-full ${pct >= 80 ? 'bg-neon-green' : pct >= 40 ? 'bg-neon-amber' : 'bg-neon-pink'}`} style={{ width: `${pct}%` }} />
                    </div>
                    <span className={it.matched ? 'text-neon-green' : 'text-neon-amber'}>{it.matched ? '✓ 已覆盖' : '⚠ 未覆盖'}</span>
                  </div>
                  {fc ? (
                    <div className="rounded-lg bg-white/[0.04] px-2.5 py-1.5 text-[11px]">
                      <span className={fc.completionProb >= 60 ? 'text-neon-green' : fc.completionProb >= 30 ? 'text-neon-amber' : 'text-neon-pink'}>
                        完成概率 {fc.completionProb}%
                      </span>
                      {fc.estimatedEndMin ? <span className="text-slate-400"> · 预计完成 {clockOf(fc.estimatedEndMin)}</span> : null}
                      <div className="mt-0.5 text-slate-500">{fc.recommendation}</div>
                    </div>
                  ) : null}
                  <div className="mt-1 flex justify-end gap-2">
                    <button className="glass-btn" onClick={() => setPlanDetail(null)}>
                      关闭
                    </button>
                    <button
                      className="glass-btn primary"
                      onClick={() => {
                        void window.api.setPlanStatus(it.plan.id, 'done').then(() => {
                          setPlanDetail(null)
                          onChanged()
                        })
                      }}
                    >
                      <Icon name="check" size={13} /> 标记完成
                    </button>
                  </div>
                </div>
              )
            })()}
          </div>
        </div>
      ) : null}
    </div>
  )
}

/* ── 周视图：七列状态色块概览 ── */
function WeekGrid({ date }: { date: string }) {
  const [trails, setTrails] = useState<(MergedTrail | null)[]>([])
  const days = weekDays(date)

  useEffect(() => {
    Promise.all(days.map((d) => window.api.getTrail(d).catch(() => null))).then((ts) =>
      setTrails(ts as (MergedTrail | null)[])
    )
  }, [date]) // eslint-disable-line react-hooks/exhaustive-deps

  const today = todayKey()

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

  return (
    <div className="anim-fade-up grid grid-cols-7 gap-3" style={{ animationDelay: '120ms' }}>
      {days.map((d, i) => {
        const trail = trails[i] ?? null
        const states: (WorkState | null)[] = trails.length ? hourStates(trail) : new Array(24).fill(null)
        const dt = new Date(`${d}T00:00:00`)
        const isToday = d === today
        return (
          <div
            key={d}
            className={`glass-card !p-2 rounded-xl bg-white/[0.02] transition-transform hover:-translate-y-0.5 ${isToday ? '!border-neon-cyan/40' : ''}`}
            style={isToday ? { boxShadow: '0 0 16px rgba(34,211,238,0.15)' } : undefined}
          >
            <div className="mb-2 text-center">
              <div className={`text-[11px] ${isToday ? 'font-semibold text-neon-cyan' : 'text-slate-400'}`}>
                周{WEEK_LABELS[i]} {dt.getMonth() + 1}/{dt.getDate()}
              </div>
              <div className="text-[10px] text-slate-500">{trail && trail.totalMin > 0 ? fmtMin(trail.totalMin) : '—'}</div>
            </div>
            <div className="flex flex-col gap-[2px]">
              {states.map((s, h) => (
                <div
                  key={h}
                  title={`${d} ${h}:00${s ? ` · ${WORK_STATES[s].label}` : ''}`}
                  className="h-[13px] w-full rounded-[3px]"
                  style={{ background: s ? WORK_STATES[s].color : 'rgba(255,255,255,0.03)', opacity: s ? 0.85 : 1 }}
                />
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}

/* ── 日历主视图 ── */
export default function CalendarView() {
  const [mode, setMode] = useState<CalMode>(savedMode)
  const [date, setDate] = useState(todayKey())
  const [entries, setEntries] = useState<TimeEntry[]>([])
  const [trail, setTrail] = useState<MergedTrail | null>(null)
  const [pva, setPva] = useState<PlanVsActual | null>(null)
  const [filter, setFilter] = useState<SourceFilter>('all')
  const [hourH, setHourH] = useState(DEFAULT_HOUR_H)
  const showBands = useSettingsStore((s) => s.settings.calAnalysisBands)
  const forecastEnabled = useSettingsStore((s) => s.settings.planForecastEnabled)
  const [habits, setHabits] = useState<UserHabits | null>(null)
  const [forecasts, setForecasts] = useState<Map<string, PlanForecast>>(new Map())

  const load = useCallback(async () => {
    try {
      const [list, t, pv] = await Promise.all([
        window.api.listEntries(date) as Promise<TimeEntry[]>,
        window.api.getTrail(date).catch(() => null),
        window.api.planVsActual(date).catch(() => null)
      ])
      setEntries(list ?? [])
      setTrail(t as MergedTrail | null)
      setPva(pv as PlanVsActual | null)
    } catch {
      setEntries([])
      setTrail(null)
      setPva(null)
    }
  }, [date])

  useEffect(() => {
    void load()
  }, [load])

  // 计划完成预测（日视图计划框三色标注用）
  useEffect(() => {
    if (!forecastEnabled || date !== todayKey()) {
      setForecasts(new Map())
      return
    }
    window.api
      .getForecast(date)
      .then((list) => {
        const m = new Map<string, PlanForecast>()
        for (const f of (list as PlanForecast[]) ?? []) m.set(f.planId, f)
        setForecasts(m)
      })
      .catch(() => setForecasts(new Map()))
  }, [forecastEnabled, date])

  // 用户分析背景带开启时拉取习惯画像（午休/高效时段）
  useEffect(() => {
    if (!showBands) return
    window.api
      .getHabits()
      .then((h) => setHabits(h as UserHabits | null))
      .catch(() => setHabits(null))
  }, [showBands])

  const MODES: { key: CalMode; label: string }[] = [
    { key: 'day', label: '日' },
    { key: 'week', label: '周' },
    { key: 'heat', label: '热度' }
  ]

  const FILTERS: { key: SourceFilter; label: string }[] = [
    { key: 'all', label: '全部' },
    { key: 'monitor', label: '仅监控' },
    { key: 'manual', label: '仅手动' }
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
          <p className="mt-0.5 text-[11px] text-slate-500">时间轴日程视图 · 计划与实际轨迹对照，点击空白补录、拖拽边缘调整</p>
        </div>
      </header>

      {/* 工具条 */}
      <div className="anim-fade-up flex flex-wrap items-center gap-2" style={{ animationDelay: '60ms' }}>
        <button className="glass-btn !px-2" onClick={() => setDate((d) => addDays(d, mode === 'week' ? -7 : -1))}>
          <Icon name="chevronLeft" size={14} />
        </button>
        <button className="glass-btn" onClick={() => setDate(todayKey())}>
          今天
        </button>
        <button className="glass-btn !px-2" onClick={() => setDate((d) => addDays(d, mode === 'week' ? 7 : 1))}>
          <Icon name="chevronRight" size={14} />
        </button>
        <span className="ml-1 text-[16px] font-semibold tabular-nums text-slate-100">{fmtDateLabel(date)}</span>
        <div className="flex-1" />
        {mode === 'day' ? (
          <>
            {/* 竖向缩放：1 小时行高 22-88px */}
            <div className="flex items-center gap-1 rounded-lg border border-white/[0.08] bg-white/[0.03] px-1 py-0.5">
              <button
                className="glass-btn !px-2 !py-1 !text-[11px]"
                title="缩小时间范围"
                disabled={hourH <= 22}
                onClick={() => setHourH((h) => Math.max(22, h - 11))}
              >
                −
              </button>
              <span className="w-10 text-center text-[10px] text-slate-500">{hourH}px</span>
              <button
                className="glass-btn !px-2 !py-1 !text-[11px]"
                title="放大时间范围"
                disabled={hourH >= 88}
                onClick={() => setHourH((h) => Math.min(88, h + 11))}
              >
                ＋
              </button>
            </div>
            <div className="flex rounded-lg border border-white/[0.08] bg-white/[0.03] p-0.5">
              {FILTERS.map((f) => (
                <button
                  key={f.key}
                  className={`rounded-md px-2.5 py-1 text-[12px] transition-all ${
                    filter === f.key ? 'bg-neon-cyan/15 font-medium text-neon-cyan' : 'text-slate-400 hover:bg-white/[0.04] hover:text-slate-200'
                  }`}
                  style={{ transitionDuration: '150ms' }}
                  onClick={() => setFilter(f.key)}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </>
        ) : null}
        <div className="flex rounded-lg border border-white/[0.08] bg-white/[0.03] p-0.5">
          {MODES.map((m) => (
            <button
              key={m.key}
              className={`rounded-md px-3 py-1 text-[12px] transition-all ${
                mode === m.key ? 'bg-neon-cyan/15 font-medium text-neon-cyan' : 'text-slate-400 hover:bg-white/[0.04] hover:text-slate-200'
              }`}
              style={{ transitionDuration: '150ms' }}
              onClick={() => { setMode(m.key); saveMode(m.key) }}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>

      {mode === 'day' ? (
        <div className="glass-card hoverable anim-fade-up" style={{ animationDelay: '120ms' }}>
          {entries.length === 0 && (!trail || trail.segments.length === 0) ? (
            <EmptyState
              emoji="📅"
              title="这一天还没有时间条目"
              hint="点击下方时间格空白处即可补录；也可拖拽条目上下边缘调整起止时间。"
            />
          ) : null}
          <DayGrid date={date} entries={entries} trail={trail} pva={pva} forecasts={forecasts} filter={filter} hourH={hourH} habits={habits} showBands={showBands} onChanged={() => void load()} />
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-white/[0.05] pt-3 text-[10px] text-slate-500">
            <span className="flex items-center gap-1.5">
              <span className="h-2.5 w-4 rounded-sm bg-neon-green/30" /> 自动监控（实际轨迹）
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2.5 w-4 rounded-sm border-l-2 border-neon-green bg-neon-green/20" /> 手动记录
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2.5 w-4 rounded-sm border border-dashed border-neon-amber bg-neon-amber/10" /> 计划时段
            </span>
            {/* 状态 mini 图例：当日实际出现过的状态 */}
            {trail
              ? [...new Set(trail.segments.map((s) => s.mainState))].map((st) => {
                  const m = WORK_STATES[st]
                  return (
                    <span key={st} className="flex items-center gap-1" title={m.label}>
                      <span className="inline-block h-2 w-2 rounded-full" style={{ background: m.color }} />
                      {m.emoji} {m.label}
                    </span>
                  )
                })
              : null}
            <span className="ml-auto">点击监控色块可看详情 / 转手动记录</span>
          </div>
          {/* 今日统计摘要：各状态时长 + 计划达成率 */}
          {trail && trail.totalMin > 0 ? (
            <div className="mt-3 grid grid-cols-2 gap-2 border-t border-white/[0.05] pt-3 sm:grid-cols-5">
              {(() => {
                const sm = trail.stateMinutes
                const workMin = (sm.focus ?? 0) + (sm.coding ?? 0) + (sm.writing ?? 0) + (sm.aiqa ?? 0) + (sm.aidev ?? 0) + (sm.remote ?? 0)
                const meetingMin = sm.meeting ?? 0
                const relaxMin = (sm.relax ?? 0) + (sm.break ?? 0) + (sm.lunch ?? 0)
                const slackMin = sm.slack ?? 0
                const cards: [string, string, number, string][] = [
                  ['💼', '工作专注', workMin, '#10B981'],
                  ['📞', '会议', meetingMin, '#F59E0B'],
                  ['🍃', '休闲放松', relaxMin, '#34D399'],
                  ['🐟', '摸鱼', slackMin, '#EC4899']
                ]
                return (
                  <>
                    {cards.map(([emoji, label, min, color]) => (
                      <div key={label} className="rounded-xl border border-white/[0.05] bg-white/[0.03] px-3 py-2.5 transition-colors hover:bg-white/[0.06]">
                        <div className="text-[10px] text-slate-500">
                          {emoji} {label}
                        </div>
                        <div className="text-[15px] font-semibold tabular-nums" style={{ color }}>
                          {min > 0.5 ? fmtMin(min) : '—'}
                        </div>
                      </div>
                    ))}
                    <div className="rounded-xl border border-white/[0.05] bg-white/[0.03] px-3 py-2.5 transition-colors hover:bg-white/[0.06]">
                      <div className="text-[10px] text-slate-500">🎯 计划达成</div>
                      <div className={`text-[15px] font-semibold tabular-nums ${pva && pva.achievement >= 80 ? 'text-neon-green' : pva && pva.achievement >= 40 ? 'text-neon-amber' : 'text-slate-300'}`}>
                        {pva && pva.plannedMin > 0 ? `${Math.round(pva.achievement)}%` : '—'}
                      </div>
                    </div>
                  </>
                )
              })()}
            </div>
          ) : null}
        </div>
      ) : mode === 'week' ? (
        <WeekGrid date={date} />
      ) : (
        <div className="glass-card hoverable anim-fade-up" style={{ animationDelay: '120ms' }}>
          <h2 className="mb-3 flex items-center gap-2 text-[15px] font-semibold text-slate-200">
            <Icon name="flame" size={15} className="text-neon-amber" />
            近 7 天工作热度
          </h2>
          <HeatmapView />
        </div>
      )}
    </div>
  )
}
