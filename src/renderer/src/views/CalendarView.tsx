import { useEffect, useState, useRef, useCallback, useMemo } from 'react'
import { createPortal } from 'react-dom'
import type { CustomCategory, PlanItem, PlanStatus, TimeEntry, WorkState, MergedTrail } from '@shared/types'
import { ALL_STATES, WORK_STATES, WORK_LIKE_STATES } from '@shared/stateMeta'
import { BUILTIN_CATEGORIES } from '@shared/planAnalysis'
import { genId } from '@shared/types'
import { displayApp } from '@shared/appDisplayName'
import { CATEGORY_META, categoryOf, type AppCategory } from '@shared/appCategory'
import { Icon } from '../components/Icon'
import { PageHeader } from '../components/PageHeader'
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

type CalMode = 'month' | 'heat'

function savedMode(): CalMode {
  try {
    const v = localStorage.getItem('calMode')
    if (v === 'month' || v === 'heat') return v
    return 'month'
  } catch {
    return 'month'
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

/* ── 月模式：GitHub 风格专注热力月历（5 档 teal 透明度）+ AI 周回顾 + 选中日详情 ── */

/** 月视图单日统计（专注分钟 = WORK_LIKE_STATES 口径，与 HeatmapView/报表一致） */
interface MonthDayStat {
  date: string
  workMin: number
  totalMin: number
  topState: WorkState
}

/** 热力 5 档：surface-3 / teal .25 / .5 / .75 / 1 */
const HEAT_TIERS = ['var(--surface-3)', 'var(--teal-border)', 'rgb(var(--teal-rgb) / 0.5)', 'rgb(var(--teal-rgb) / 0.75)', 'var(--teal)']

const PLAN_STATUS_SHORT: Record<PlanStatus, string> = {
  planned: '待',
  in_progress: '中',
  partial: '部',
  done: '完',
  delayed: '延',
  cancelled: '消'
}

/** 分类色：自定义覆盖内置 */
function catColorOf(category: string, cats: CustomCategory[]): string {
  return cats.find((c) => c.id === category)?.color
    ?? BUILTIN_CATEGORIES.find((c) => c.id === category)?.color
    ?? '#64748B'
}

/** 单日计划进度：完成数 / 有效计划数 + 平均完成比 */
function dayPlanProgress(plans: PlanItem[]): { done: number; total: number; pct: number } {
  const active = plans.filter((p) => !p.archived && p.status !== 'cancelled')
  const total = active.length
  if (total === 0) return { done: 0, total: 0, pct: 0 }
  const done = active.filter((p) => p.status === 'done').length
  const ratioSum = active.reduce((s, p) => {
    if (p.status === 'done') return s + 1
    if (typeof p.completionRatio === 'number') return s + Math.max(0, Math.min(1, p.completionRatio))
    if (p.status === 'partial') return s + 0.5
    if (p.status === 'in_progress') return s + 0.25
    return s
  }, 0)
  return { done, total, pct: Math.round((ratioSum / total) * 100) }
}

/** 月历格内计划标签：格内只显示一行截断；悬停用 portal 浮层详情卡（避免穿模） */
function MonthPlanPill({
  plan,
  color,
  onHover,
  onLeave
}: {
  plan: PlanItem
  color: string
  onHover: (plan: PlanItem, pos: { x: number; y: number }) => void
  onLeave: () => void
}) {
  const done = plan.status === 'done'
  const delayed = plan.status === 'delayed'
  return (
    <span
      className={`month-plan-pill block w-full truncate rounded px-1 py-px text-left text-[9px] font-medium leading-snug${done ? ' is-done' : ''}`}
      style={{
        background: `${color}33`,
        borderLeft: `2px solid ${delayed ? '#EF4444' : color}`,
        textDecoration: done ? 'line-through' : undefined,
        opacity: plan.status === 'cancelled' ? 0.45 : 1
      }}
      onMouseEnter={(e) => {
        e.stopPropagation()
        onHover(plan, { x: e.clientX, y: e.clientY })
      }}
      onMouseMove={(e) => {
        onHover(plan, { x: e.clientX, y: e.clientY })
      }}
      onMouseLeave={onLeave}
    >
      {plan.title}
    </span>
  )
}

/** 待办悬停详情卡：贴着鼠标右下角弹出，贴边自动翻面 */
function PlanHoverCard({
  plan,
  color,
  pos,
  onEnter,
  onLeave
}: {
  plan: PlanItem
  color: string
  pos: { x: number; y: number }
  onEnter: () => void
  onLeave: () => void
}) {
  const W = 260
  const estH = 128
  const gap = 12
  const margin = 8
  let left = pos.x + gap
  let top = pos.y + gap
  if (left + W > window.innerWidth - margin) left = pos.x - W - gap
  if (top + estH > window.innerHeight - margin) top = pos.y - estH - gap
  left = Math.max(margin, Math.min(left, window.innerWidth - W - margin))
  top = Math.max(margin, Math.min(top, window.innerHeight - estH - margin))
  const ratio =
    plan.status === 'done'
      ? 100
      : typeof plan.completionRatio === 'number'
        ? Math.round(plan.completionRatio * 100)
        : plan.status === 'partial'
          ? 50
          : plan.status === 'in_progress'
            ? 25
            : 0
  const catLabel =
    BUILTIN_CATEGORIES.find((c) => c.id === plan.category)?.label ?? plan.category

  return createPortal(
    <div
      className="pointer-events-none fixed z-[200] rounded-xl border px-3 py-2.5"
      style={{
        width: W,
        left,
        top,
        background: 'var(--pop-bg)',
        borderColor: 'var(--pop-border)',
        boxShadow: 'var(--pop-shadow)',
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
        color: 'var(--pop-text)'
      }}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
    >
      <div className="flex items-start gap-2">
        <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: color }} />
        <div className="min-w-0 flex-1">
          <div className="text-[12.5px] font-semibold leading-snug" style={{ color: 'var(--pop-text-strong)' }}>
            {plan.title}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px]" style={{ color: 'var(--pop-text-muted)' }}>
            <span className="rounded px-1 py-px" style={{ background: `${color}33`, color }}>
              {catLabel}
            </span>
            <span>{PLAN_STATUS_SHORT[plan.status]}</span>
            <span className="tabular-nums">{ratio}%</span>
            {plan.startMin != null ? (
              <span className="tabular-nums">
                {clockOf(plan.startMin)}
                {plan.durationMin ? ` · ${fmtMin(plan.durationMin)}` : ''}
              </span>
            ) : null}
          </div>
          {plan.note ? (
            <div className="mt-1.5 text-[11px] leading-snug" style={{ color: 'var(--pop-text-muted)' }}>
              {plan.note}
            </div>
          ) : null}
        </div>
      </div>
    </div>,
    document.body
  )
}

/** 单日专注分钟（工作类状态墙钟合计） */
function dayWorkMin(trail: MergedTrail | null | undefined): number {
  if (!trail) return 0
  return WORK_LIKE_STATES.reduce((s, st) => s + (trail.stateMinutes[st] ?? 0), 0)
}

function monthLabelOf(ym: string): string {
  const [y, m] = ym.split('-').map(Number)
  return `${y}年${m}月`
}

/** 选中日详情卡：当日专注/墙钟 + 计划进度 + 条目列表（点击编辑）+ 底部分类占比堆叠条 */
function DayDetailCard({ date, reloadKey, onEditEntry, onAdd, dayPlans, categories }: {
  date: string
  reloadKey: number
  onEditEntry: (entry: TimeEntry) => void
  onAdd: () => void
  dayPlans: PlanItem[]
  categories: CustomCategory[]
}) {
  const today = todayKey()
  const [trail, setTrail] = useState<MergedTrail | null>(null)
  const [entries, setEntries] = useState<TimeEntry[]>([])
  /** v7 粗颗粒复盘：项目归属 / 摸鱼 / 专注代表活动 */
  const [projMin, setProjMin] = useState<{ name: string; min: number; progress: number | null }[]>([])
  const [slackMin, setSlackMin] = useState(0)
  const [focusActs, setFocusActs] = useState<{ app: string; title: string; min: number }[]>([])
  const planProg = dayPlanProgress(dayPlans)

  useEffect(() => {
    const tr = trail as MergedTrail | null
    if (!tr) return
    // 摸鱼时长 + 专注代表活动（工作类段按时长取 top3）
    let slack = 0
    const workSegs: { app: string; title: string; min: number }[] = []
    for (const seg of tr.segments ?? []) {
      if (seg.glance) continue
      if (seg.mainState === 'slack' || seg.mainState === 'relax') slack += seg.durationMin
      else if (WORK_LIKE_STATES.includes(seg.mainState)) {
        workSegs.push({ app: seg.mainApp, title: seg.mainTitle ?? '', min: seg.durationMin })
      }
    }
    setSlackMin(Math.round(slack))
    setFocusActs(workSegs.sort((a, b) => b.min - a.min).slice(0, 3).map((s) => ({ ...s, title: s.title || s.app })))
    // 项目归属：绑定应用/关键词命中 → 项目分钟 + 任务进展
    ;(async () => {
      try {
        const bindings = ((await window.api?.listBindings?.()) as { projectId: string; apps: string[]; keywords: string[] }[]) ?? []
        const projects = ((await window.api?.listProjects?.()) as { id: string; name: string }[]) ?? []
        const rows: { name: string; min: number; progress: number | null }[] = []
        for (const b of bindings) {
          const proj = projects.find((p) => p.id === b.projectId)
          if (!proj) continue
          let min = 0
          for (const seg of tr.segments ?? []) {
            if (seg.glance) continue
            const appHit = b.apps.some((a) => (seg.mainApp ?? '').toLowerCase().includes(a.toLowerCase()))
            const kwHit = b.keywords.some((k) => (seg.mainTitle ?? '').toLowerCase().includes(k.toLowerCase()))
            if (appHit || kwHit) min += seg.durationMin
          }
          if (min <= 0) continue
          const tasks = ((await window.api?.listProjectTasks?.(b.projectId)) as { status: string }[]) ?? []
          const progress = tasks.length ? Math.round((tasks.filter((x) => x.status === 'done').length / tasks.length) * 100) : null
          rows.push({ name: proj.name, min: Math.round(min), progress })
        }
        setProjMin(rows.sort((a, b) => b.min - a.min).slice(0, 4))
      } catch { /* ignore */ }
    })()
  }, [trail])

  useEffect(() => {
    let alive = true
    window.api.getTrail(date).then((t) => { if (alive) setTrail((t as MergedTrail) ?? null) }).catch(() => undefined)
    window.api
      .listEntries(date)
      .then((l) => {
        if (!alive) return
        setEntries((((l as TimeEntry[]) ?? []).slice()).sort((a, b) => a.startMin - b.startMin))
      })
      .catch(() => undefined)
    return () => { alive = false }
  }, [date, reloadKey])

  // 当日分类占比（segments 按应用业务分类聚合，与监控页应用分类同口径）
  const cats = useMemo(() => {
    if (!trail) return [] as { cat: AppCategory; min: number }[]
    const map = new Map<AppCategory, number>()
    for (const seg of trail.segments) {
      if (!seg.mainApp) continue
      const cat = categoryOf(seg.mainApp)
      map.set(cat, (map.get(cat) ?? 0) + seg.durationMin)
    }
    return [...map.entries()].filter(([, v]) => v > 0.5).map(([cat, min]) => ({ cat, min })).sort((a, b) => b.min - a.min)
  }, [trail])
  const catTotal = cats.reduce((s, c) => s + c.min, 0)

  return (
    <div className="glass-card anim-fade-up" style={{ animationDelay: '120ms' }}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[14px] font-semibold text-slate-200">{fmtDateLabel(date)}</span>
        {date === today ? <span className="chip text-[var(--teal)]">今天</span> : null}
        <span className="chip">专注 {fmtMin(dayWorkMin(trail))}</span>
        {trail && trail.totalMin > 0 ? <span className="chip">墙钟 {fmtMin(trail.totalMin)}</span> : null}
        {planProg.total > 0 ? (
          <span className="chip text-[var(--teal)]" title="当日计划完成进度">
            计划 {planProg.done}/{planProg.total} · {planProg.pct}%
          </span>
        ) : null}
        <div className="flex-1" />
        <button className="glass-btn !px-2.5 !py-1 text-[11px]" onClick={onAdd} title="为该日补录时段">
          <Icon name="plus" size={12} /> 补录
        </button>
      </div>
      {/* 当日计划状态与进度 */}
      {dayPlans.length > 0 ? (
        <div className="mt-3">
          <div className="mb-1.5 flex items-center justify-between">
            <div className="text-[10px] uppercase tracking-wider text-slate-600">当日计划</div>
            {planProg.total > 0 ? (
              <div className="h-1 w-24 overflow-hidden rounded-full bg-white/[0.06]">
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{
                    width: `${planProg.pct}%`,
                    background: planProg.pct >= 100 ? 'var(--teal)' : 'linear-gradient(90deg, var(--teal), #22D3EE)'
                  }}
                />
              </div>
            ) : null}
          </div>
          <div className="flex flex-col gap-1">
            {dayPlans.map((p) => {
              const color = catColorOf(p.category, categories)
              const ratio = p.status === 'done' ? 1 : typeof p.completionRatio === 'number' ? p.completionRatio : p.status === 'partial' ? 0.5 : p.status === 'in_progress' ? 0.25 : 0
              return (
                <div
                  key={p.id}
                  className="flex items-center gap-2 rounded-lg border border-white/[0.05] bg-white/[0.02] px-2.5 py-1.5 text-[11.5px]"
                >
                  <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: color }} />
                  <span className={`min-w-0 flex-1 truncate ${p.status === 'done' ? 'text-slate-500 line-through' : 'text-slate-300'}`}>{p.title}</span>
                  <span className="shrink-0 text-[10px] text-slate-500">{PLAN_STATUS_SHORT[p.status]}</span>
                  <span className="w-10 shrink-0 text-right text-[10px] tabular-nums text-slate-500">{Math.round(ratio * 100)}%</span>
                </div>
              )
            })}
          </div>
        </div>
      ) : null}
      {/* v7 粗颗粒复盘：项目进展 / 摸鱼 / 专注干了哪些活 */}
      <div className="mt-3 flex flex-col gap-2">
        {projMin.length ? (
          <div>
            <div className="mb-1 text-[10px] uppercase tracking-wider text-slate-600">项目进展</div>
            {projMin.map((r) => (
              <div key={r.name} className="flex items-center gap-2 py-0.5 text-[11.5px]">
                <span className="min-w-0 flex-1 truncate text-slate-300">{r.name}</span>
                {r.progress !== null ? <span className="shrink-0 text-[10px] tabular-nums text-[var(--teal-deep)]">{r.progress}%</span> : null}
                <span className="shrink-0 text-[10px] tabular-nums text-slate-500">{r.min}m</span>
              </div>
            ))}
          </div>
        ) : null}
        {slackMin > 0 ? (
          <div className="flex items-center gap-2 text-[11.5px]">
            <span className="text-slate-500">🐟 摸鱼</span>
            <span className="tabular-nums text-[#fbbf24]">{slackMin}m</span>
          </div>
        ) : null}
        {focusActs.length ? (
          <div>
            <div className="mb-1 text-[10px] uppercase tracking-wider text-slate-600">专注干了哪些活</div>
            {focusActs.map((a, i) => (
              <div key={i} className="flex items-center gap-2 py-0.5 text-[11.5px]">
                <span className="min-w-0 flex-1 truncate text-slate-300">{a.title}</span>
                <span className="shrink-0 text-[10px] tabular-nums text-slate-500">{a.min}m</span>
              </div>
            ))}
          </div>
        ) : null}
      </div>
      {/* 当日条目（手动/AI/导入）：点击进入编辑 */}
      <div className="mt-2.5 flex flex-col gap-1">
        {entries.length === 0 ? (
          <div className="text-[11px] text-slate-600">暂无手动记录 · 点击右上角「补录」添加时段</div>
        ) : (
          entries.map((e) => {
            const meta = WORK_STATES[e.state ?? 'idle'] ?? WORK_STATES.idle
            return (
              <button
                key={e.id}
                className="flex items-center gap-2 rounded-lg border border-white/[0.05] bg-white/[0.02] px-2.5 py-1.5 text-left text-[11.5px] transition-colors hover:border-white/[0.1] hover:bg-white/[0.05]"
                onClick={() => onEditEntry(e)}
                title="点击编辑该时段"
              >
                <span>{meta.emoji}</span>
                <span className="w-24 shrink-0 tabular-nums text-slate-500">{clockOf(e.startMin)}–{clockOf(e.endMin)}</span>
                <span className="min-w-0 flex-1 truncate text-slate-300">{e.title || '（未命名）'}</span>
                <span className="shrink-0 text-slate-500">{fmtMin(e.endMin - e.startMin)}</span>
                <span className="shrink-0 text-[10px] text-slate-600">{SOURCE_LABEL[e.source]}</span>
              </button>
            )
          })
        )}
      </div>
      {/* 底部：当日分类占比堆叠条 + 图例（与监控页状态分布堆叠彩条同款式） */}
      {cats.length > 0 && catTotal > 0 ? (
        <div className="mt-3 border-t border-white/[0.05] pt-2.5">
          <div className="mb-1.5 text-[10px] text-slate-500">当日分类占比</div>
          <div className="flex h-3.5 w-full overflow-hidden rounded-full border border-white/[0.06] bg-white/[0.03]">
            {cats.map(({ cat, min }) => (
              <div
                key={cat}
                className="h-full transition-all"
                style={{ width: `${(min / catTotal) * 100}%`, minWidth: 3, background: CATEGORY_META[cat].color, transitionDuration: '300ms' }}
                title={`${CATEGORY_META[cat].emoji} ${CATEGORY_META[cat].label} · ${fmtMin(min)}（${Math.round((min / catTotal) * 100)}%）`}
              />
            ))}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-x-3.5 gap-y-1">
            {cats.map(({ cat, min }) => (
              <span key={cat} className="flex items-center gap-1 text-[10.5px] text-slate-400">
                <span className="inline-block h-2 w-2 rounded-full" style={{ background: CATEGORY_META[cat].color }} />
                {CATEGORY_META[cat].label}
                <span className="tabular-nums text-slate-500">{fmtMin(min)}</span>
              </span>
            ))}
          </div>
        </div>
      ) : (
        <div className="mt-3 border-t border-white/[0.05] pt-2.5 text-[10.5px] text-slate-600">当日暂无监控轨迹，分类占比将在采集到活动后展示。</div>
      )}
    </div>
  )
}

/** 月模式主体：AI 周回顾 hero 卡 + 计划标签月历；点日期进入日视图 */
function MonthBoard({ yearMonth }: { yearMonth: string }) {
  const today = todayKey()
  const [days, setDays] = useState<MonthDayStat[] | null>(null)
  /** 日视图：有值时替换月历，显示当日详情 */
  const [dayView, setDayView] = useState<string | null>(null)
  const [editor, setEditor] = useState<{ entry: TimeEntry; isNew: boolean } | null>(null)
  const [reloadTick, setReloadTick] = useState(0)
  /** 当月计划：date → plans（用于格内彩色标签 + 进度） */
  const [plansByDate, setPlansByDate] = useState<Map<string, PlanItem[]>>(new Map())
  const [categories, setCategories] = useState<CustomCategory[]>(BUILTIN_CATEGORIES)
  /** AI 周回顾：本周/上周专注聚合（由现有 getTrail 周数据推导，无新 IPC） */
  const [weekCtx, setWeekCtx] = useState<{ thisMin: number; lastMin: number; bestLabel: string; bestMin: number; aiMin: number } | null>(null)
  const [review, setReview] = useState<string | null>(null)
  const [generating, setGenerating] = useState(false)
  /** 月格待办悬停详情 */
  const [planHover, setPlanHover] = useState<{ plan: PlanItem; pos: { x: number; y: number } } | null>(null)
  const planHoverLeaveTimer = useRef<number | null>(null)

  const loadMonth = useCallback(async (ym: string) => {
    const [y, m] = ym.split('-').map(Number)
    const dayCount = new Date(y, m, 0).getDate()
    const out: MonthDayStat[] = []
    for (let d = 1; d <= dayCount; d++) {
      const date = `${ym}-${String(d).padStart(2, '0')}`
      try {
        const trail = await window.api?.getTrail?.(date)
        if (!trail || trail.totalMin <= 0) continue
        let topState: WorkState = 'idle'
        let topMin = 0
        ;(Object.entries(trail.stateMinutes) as [WorkState, number][]).forEach(([st, min]) => {
          if (min > topMin) { topState = st; topMin = min }
        })
        out.push({ date, workMin: Math.round(dayWorkMin(trail)), totalMin: Math.round(trail.totalMin), topState })
      } catch { /* ignore */ }
    }
    setDays(out)
  }, [])

  const loadMonthPlans = useCallback(async (ym: string) => {
    try {
      const [all, custom] = await Promise.all([
        window.api.listPlans() as Promise<PlanItem[]>,
        window.api.listCategories().catch(() => [] as CustomCategory[])
      ])
      const cats = ((custom as CustomCategory[]) ?? [])
      setCategories(cats.length ? cats : BUILTIN_CATEGORIES)
      const map = new Map<string, PlanItem[]>()
      for (const p of (all as PlanItem[]) ?? []) {
        if (p.archived) continue
        if (!p.date?.startsWith(ym)) continue
        const list = map.get(p.date) ?? []
        list.push(p)
        map.set(p.date, list)
      }
      for (const [d, list] of map) {
        list.sort((a, b) => (a.startMin ?? 9999) - (b.startMin ?? 9999) || a.ts - b.ts)
        map.set(d, list)
      }
      setPlansByDate(map)
    } catch {
      setPlansByDate(new Map())
    }
  }, [])

  useEffect(() => {
    setDayView(null)
    setPlanHover(null)
    setDays(null)
    void loadMonth(yearMonth)
    void loadMonthPlans(yearMonth)
  }, [yearMonth, loadMonth, loadMonthPlans])

  useEffect(() => {
    void loadMonthPlans(yearMonth)
  }, [reloadTick, yearMonth, loadMonthPlans])

  useEffect(() => {
    const off = window.api.onPlanUpdated?.(() => { void loadMonthPlans(yearMonth) })
    return () => { off?.() }
  }, [yearMonth, loadMonthPlans])

  // 本周/上周专注对比（挂载时聚合一次：各取 7 天 getTrail，专注口径 = WORK_LIKE_STATES）
  useEffect(() => {
    let alive = true
    const thisWeek = weekDays(todayKey())
    const lastWeek = weekDays(addDays(todayKey(), -7))
    Promise.all([...thisWeek, ...lastWeek].map((d) => window.api.getTrail(d).catch(() => null))).then((ts) => {
      if (!alive) return
      const week = (ts.slice(0, 7) ?? []) as (MergedTrail | null)[]
      const last = (ts.slice(7) ?? []) as (MergedTrail | null)[]
      const thisMin = Math.round(week.reduce((s, t) => s + dayWorkMin(t), 0))
      const lastMin = Math.round(last.reduce((s, t) => s + dayWorkMin(t), 0))
      let bestIdx = 0
      week.forEach((t, i) => { if (dayWorkMin(t) > dayWorkMin(week[bestIdx])) bestIdx = i })
      const aiMin = Math.round(
        week.reduce((s, t) => s + (t ? (t.stateMinutes.aidev ?? 0) + (t.stateMinutes.aiqa ?? 0) : 0), 0)
      )
      setWeekCtx({ thisMin, lastMin, bestLabel: `周${WEEK_LABELS[bestIdx]}`, bestMin: Math.round(dayWorkMin(week[bestIdx])), aiMin })
    })
    return () => { alive = false }
  }, [])

  const aiPct = weekCtx && weekCtx.thisMin > 0 ? Math.round((weekCtx.aiMin / weekCtx.thisMin) * 100) : 0
  const deltaPct = !weekCtx ? 0 : weekCtx.lastMin > 0 ? Math.round(((weekCtx.thisMin - weekCtx.lastMin) / weekCtx.lastMin) * 100) : weekCtx.thisMin > 0 ? 100 : 0

  // 生成回顾：纯本地推导（周对比 + 最佳日 + AI 协作占比 + 建议），不新增 IPC
  const generateReview = () => {
    if (!weekCtx) return
    setGenerating(true)
    window.setTimeout(() => {
      const { thisMin, lastMin, bestLabel, bestMin, aiMin } = weekCtx
      const up = deltaPct >= 0
      const tip = up
        ? '保持当前节奏：把最好的专注时段留给最难的任务，继续用双屏并行消化碎片事务。'
        : `专注有所回落，建议先恢复 ${bestLabel} 的黄金专注块（当天曾有 ${fmtMin(bestMin)}），并缩短长摸鱼片段。`
      setReview(
        `结论：本周专注 ${fmtMin(thisMin)}，较上周（${fmtMin(lastMin)}）${up ? '提升' : '下降'} ${Math.abs(deltaPct)}%。\n最佳专注日：${bestLabel}（${fmtMin(bestMin)}）· AI 协作 ${fmtMin(aiMin)}，约占专注 ${aiPct}%。\n${tip}`
      )
      setGenerating(false)
    }, 700)
  }

  // 月历几何：周一开头
  const [yy, mm] = yearMonth.split('-').map(Number)
  const firstDow = (new Date(yy, mm - 1, 1).getDay() + 6) % 7
  const dayCount = new Date(yy, mm, 0).getDate()
  const statMap = useMemo(() => new Map((days ?? []).map((d) => [d.date, d])), [days])
  const monthMax = Math.max(1, ...(days ?? []).map((d) => d.workMin))
  const monthWorkTotal = (days ?? []).reduce((s, d) => s + d.workMin, 0)
  const monthWallTotal = (days ?? []).reduce((s, d) => s + d.totalMin, 0)
  const tierOf = (min: number): number => {
    if (min <= 0) return 0
    const r = min / monthMax
    return r >= 0.75 ? 4 : r >= 0.5 ? 3 : r >= 0.25 ? 2 : 1
  }

  const openAdd = (date: string) =>
    setEditor({
      isNew: true,
      entry: { id: `new-${date}`, date, startMin: 9 * 60, endMin: 18 * 60, title: '', source: 'manual', ts: Date.now() }
    })

  const clearPlanHoverSoon = () => {
    if (planHoverLeaveTimer.current) window.clearTimeout(planHoverLeaveTimer.current)
    planHoverLeaveTimer.current = window.setTimeout(() => setPlanHover(null), 180)
  }
  const keepPlanHover = () => {
    if (planHoverLeaveTimer.current) {
      window.clearTimeout(planHoverLeaveTimer.current)
      planHoverLeaveTimer.current = null
    }
  }

  // 日视图：点开某天后替换月历
  if (dayView) {
    return (
      <div className="view-enter flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <button
            className="glass-btn !px-2.5 !py-1 text-[12px]"
            onClick={() => setDayView(null)}
            title="返回月视图"
          >
            <Icon name="chevronLeft" size={13} /> 返回月视图
          </button>
          <span className="text-[14px] font-semibold text-slate-200">{fmtDateLabel(dayView)}</span>
          {dayView === today ? <span className="chip text-[var(--teal)]">今天</span> : null}
        </div>
        <DayDetailCard
          date={dayView}
          reloadKey={reloadTick}
          dayPlans={plansByDate.get(dayView) ?? []}
          categories={categories}
          onEditEntry={(e) => setEditor({ entry: e, isNew: false })}
          onAdd={() => openAdd(dayView)}
        />
        {editor ? (
          <EntryEditor
            entry={editor.entry}
            isNew={editor.isNew}
            onClose={() => setEditor(null)}
            onSaved={() => {
              setEditor(null)
              setReloadTick((t) => t + 1)
              void loadMonth(yearMonth)
            }}
          />
        ) : null}
      </div>
    )
  }

  return (
    <div className="view-enter flex flex-col gap-4">
      {/* AI 周回顾 hero 卡（aura 渐变 = AI 专属，白字） */}
      <div className="anim-fade-up relative overflow-hidden rounded-2xl p-5 text-white" style={{ background: 'var(--aura)', boxShadow: 'var(--glow-i)' }}>
        <span className="pointer-events-none absolute -right-3 -top-7 select-none text-[96px] leading-none text-white/15">✦</span>
        <div className="relative flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <div className="text-[15px] font-bold tracking-wide">✦ AI 周回顾</div>
            {weekCtx ? (
              <>
                <div className="mt-1.5 text-[13.5px] font-semibold">
                  本周专注 {fmtMin(weekCtx.thisMin)}，较上周（{fmtMin(weekCtx.lastMin)}）{deltaPct >= 0 ? '提升' : '下降'} {Math.abs(deltaPct)}%
                  {deltaPct >= 0 ? ' ▲' : ' ▼'}
                </div>
                <div className="mt-1 text-[11.5px] text-white/85">
                  最佳专注日 {weekCtx.bestLabel}（{fmtMin(weekCtx.bestMin)}）· AI 协作约占专注 {aiPct}% · 由最近两周监控轨迹推算
                </div>
              </>
            ) : (
              <div className="mt-1.5 flex items-center gap-2 text-[12px] text-white/85">
                <span className="pulse-dot inline-block h-1.5 w-1.5 rounded-full bg-white" />
                正在聚合本周 / 上周专注数据…
              </div>
            )}
            {review ? (
              <div className="mt-2.5 whitespace-pre-wrap rounded-xl bg-white/15 p-3 text-[11.5px] leading-relaxed">{review}</div>
            ) : null}
          </div>
          <button
            className="glass-btn ai shrink-0"
            style={{ border: '1px solid rgba(255,255,255,0.35)' }}
            disabled={!weekCtx || generating}
            onClick={generateReview}
            title="基于本周/上周监控轨迹生成 AI 回顾（本地推导）"
          >
            <Icon name="sparkles" size={13} /> {generating ? '生成中…' : '生成回顾'}
          </button>
        </div>
      </div>

      {/* 计划标签月历：每格 = 日期 + 进度 + 彩色计划 pill（参考时间轴摘要） */}
      <div className="glass-card hoverable anim-fade-up" style={{ animationDelay: '80ms' }}>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-[15px] font-semibold text-slate-200">
            <span className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-[9px] bg-[var(--teal-soft)] text-[var(--teal)]">
              <Icon name="calendar" size={14} />
            </span>
            {monthLabelOf(yearMonth)} 计划月历
          </h2>
          <span className="text-[11px] text-slate-500">悬停标签看详情 · 点击日期进入日视图</span>
        </div>
        {/* 星期表头（周一开头） */}
        <div className="mb-1.5 grid grid-cols-7 gap-1.5 text-center text-[10px] text-slate-500">
          {WEEK_LABELS.map((l) => (
            <span key={l}>{l}</span>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-1.5">
          {Array.from({ length: firstDow }, (_, i) => (
            <div key={`blank-${i}`} />
          ))}
          {Array.from({ length: dayCount }, (_, i) => {
            const date = `${yearMonth}-${String(i + 1).padStart(2, '0')}`
            const stat = statMap.get(date)
            const tier = tierOf(stat?.workMin ?? 0)
            const isToday = date === today
            const dayPlans = plansByDate.get(date) ?? []
            const visible = dayPlans.slice(0, 4)
            const more = dayPlans.length - visible.length
            const prog = dayPlanProgress(dayPlans)
            return (
              <button
                key={date}
                type="button"
                onClick={() => setDayView(date)}
                title={`${date}${isToday ? ' · 今天' : ''} · 计划 ${prog.done}/${prog.total}（${prog.pct}%）· 专注 ${fmtMin(stat?.workMin ?? 0)} · 点击进入日视图`}
                className="flex flex-col overflow-hidden rounded-lg border p-1.5 text-left transition-colors hover:border-[var(--cyan)]"
                style={{
                  background: 'var(--surface-2)',
                  borderColor: isToday ? 'var(--teal)' : 'var(--line)',
                  boxShadow: isToday
                    ? '0 0 0 1px var(--teal), 0 0 14px var(--teal-glow)'
                    : undefined,
                  minHeight: 108
                }}
              >
                <div className="flex items-center justify-between gap-1">
                  <span
                    className={`flex h-5 w-5 items-center justify-center rounded-md text-[11px] font-semibold tabular-nums ${
                      isToday ? 'bg-[var(--teal)] text-white' : 'text-slate-300'
                    }`}
                  >
                    {i + 1}
                  </span>
                  {prog.total > 0 ? (
                    <span
                      className={`text-[9px] tabular-nums ${
                        prog.pct >= 100 ? 'text-neon-green' : prog.pct > 0 ? 'text-[var(--teal)]' : 'text-slate-500'
                      }`}
                    >
                      {prog.done}/{prog.total}
                    </span>
                  ) : null}
                </div>
                {prog.total > 0 ? (
                  <div className="mt-1 h-0.5 w-full overflow-hidden rounded-full bg-white/[0.06]">
                    <div
                      className="h-full rounded-full transition-all duration-500"
                      style={{
                        width: `${prog.pct}%`,
                        background: prog.pct >= 100 ? 'var(--teal)' : 'var(--teal)'
                      }}
                    />
                  </div>
                ) : null}
                <div className="mt-1 flex min-h-0 flex-1 flex-col gap-0.5 overflow-hidden">
                  {visible.length === 0 ? (
                    <span className="text-[9px] text-slate-600">{stat && stat.workMin > 0 ? `专注 ${fmtMin(stat.workMin)}` : '—'}</span>
                  ) : (
                    <>
                      {visible.map((p) => (
                        <MonthPlanPill
                          key={p.id}
                          plan={p}
                          color={catColorOf(p.category, categories)}
                          onHover={(pl, pos) => {
                            keepPlanHover()
                            setPlanHover({ plan: pl, pos })
                          }}
                          onLeave={clearPlanHoverSoon}
                        />
                      ))}
                      {more > 0 ? <span className="text-[8.5px] text-slate-500">+{more}</span> : null}
                    </>
                  )}
                </div>
                {/* 底边专注热力细条（保留原热力语义，不抢标签） */}
                <div
                  className="mt-1 h-1 w-full rounded-full"
                  style={{ background: HEAT_TIERS[tier] }}
                  title={stat ? `专注 ${fmtMin(stat.workMin)}` : '无专注数据'}
                />
              </button>
            )
          })}
        </div>
        {/* 底部色阶图例 + 本月累计 */}
        <div className="mt-3 flex flex-wrap items-center gap-2 text-[10.5px] text-slate-500">
          <span>专注热力</span>
          <span>少</span>
          <div className="flex items-center gap-1">
            {HEAT_TIERS.map((bg, i) => (
              <span key={i} className="h-3 w-3 rounded-[4px] border border-white/[0.06]" style={{ background: bg }} />
            ))}
          </div>
          <span>多</span>
          <span className="ml-auto">
            本月累计专注 <b className="text-[var(--teal)]">{fmtMin(monthWorkTotal)}</b> · 墙钟 {fmtMin(monthWallTotal)}
          </span>
        </div>
      </div>

      <div className="text-center text-[11px] text-slate-600">点击日期格进入日视图 · 悬停彩色标签查看待办详情</div>

      {planHover ? (
        <PlanHoverCard
          plan={planHover.plan}
          color={catColorOf(planHover.plan.category, categories)}
          pos={planHover.pos}
          onEnter={keepPlanHover}
          onLeave={clearPlanHoverSoon}
        />
      ) : null}

      {editor ? (
        <EntryEditor
          entry={editor.entry}
          isNew={editor.isNew}
          onClose={() => setEditor(null)}
          onSaved={() => {
            setEditor(null)
            setReloadTick((t) => t + 1)
            void loadMonth(yearMonth)
          }}
        />
      ) : null}
    </div>
  )
}

/* ── 周视图：七列状态色块概览 + 事儿层 ── */
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
    { key: 'month', label: '月' },
    { key: 'heat', label: '热度' }
  ]

  return (
    <div className="view-enter flex flex-col gap-5">
      {/* 页面标题区 */}
      <PageHeader icon="calendar" title="时间日历" desc="月度计划标签与进度 · 专注热力 · AI 周回顾 · 补录与编辑" />

      {/* 工具条 */}
      <div className="anim-fade-up flex flex-wrap items-center gap-2" style={{ animationDelay: '60ms' }}>
        {(
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

      {mode === 'heat' ? (
        <div className="glass-card hoverable anim-fade-up" style={{ animationDelay: '120ms' }}>
          <h2 className="mb-3 flex items-center gap-2 text-[15px] font-semibold text-slate-200">
            <Icon name="flame" size={15} className="text-neon-amber" />
            {monthLabel} 工作热度
          </h2>
          <HeatmapView range="month" yearMonth={currentMonth} />
        </div>
      ) : (
        <MonthBoard yearMonth={currentMonth} />
      )}
    </div>
  )
}
