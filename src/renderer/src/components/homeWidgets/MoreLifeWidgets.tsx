/**
 * 首页生活组件第二批：节日倒数 / 习惯打卡 / 计划倒数（接 plans）/ 目标进度（接 projectTasks）。
 * 节日规则在 shared/cnFestivals（农历表 + 预设，月历未来可共用）；
 * 习惯打卡=本地存储；计划倒数/目标进度=P2 接 WorkOn 现有数据，不建独立存储。
 */
import { useEffect, useMemo, useState } from 'react'
import type { PlanItem, Project } from '@shared/types'
import { FESTIVAL_PRESETS, resolveFestDate, lunarLabel, type FestRule } from '@shared/cnFestivals'

const pad = (n: number): string => String(n).padStart(2, '0')
const todayStr = (): string => {
  const d = new Date()
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
const daysTo = (date: string): number => {
  const target = new Date(date + 'T00:00:00')
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return Math.round((target.getTime() - today.getTime()) / 86400000)
}
const daysLabel = (diff: number): { text: string; tone: string } =>
  diff === 0
    ? { text: '就是今天', tone: 'var(--teal)' }
    : diff > 0
      ? { text: `${diff} 天后`, tone: '#fbbf24' }
      : { text: `已过 ${-diff} 天`, tone: '#94a3b8' }

/* ── 节日倒数：预设（公历+农历+节气滚动）+ 自定义事件 ── */
interface Fest { id: string; name: string; date: string; lunarMd?: string; custom?: boolean }
const FEST_KEY = 'workonFestivals'

function loadFests(): Fest[] {
  const today = todayStr()
  try {
    const inited = !!localStorage.getItem(FEST_KEY + '_init')
    let list: Fest[] = []
    try { list = JSON.parse(localStorage.getItem(FEST_KEY) ?? '[]') as Fest[] } catch { list = [] }
    if (!inited) {
      if (!Array.isArray(list) || !list.length) {
        list = FESTIVAL_PRESETS.map((p: FestRule, i: number) => ({
          id: 'fest-' + i,
          name: p.name,
          date: resolveFestDate(p, today),
          lunarMd: p.kind === 'lunar' ? p.md : undefined
        }))
      }
      localStorage.setItem(FEST_KEY, JSON.stringify(list))
      localStorage.setItem(FEST_KEY + '_init', '1')
      return list
    }
    return Array.isArray(list) ? list : []
  } catch { return [] }
}

export function FestivalCard() {
  const [list, setList] = useState<Fest[]>(() => loadFests())
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const [date, setDate] = useState('')
  const [showAll, setShowAll] = useState(false)

  const save = (next: Fest[]): void => {
    setList(next)
    try { localStorage.setItem(FEST_KEY, JSON.stringify(next)) } catch { /* ignore */ }
  }
  const add = (): void => {
    const n = name.trim()
    if (!n || !date) return
    save([...list, { id: 'fest-c' + Date.now(), name: n, date, custom: true }])
    setName('')
    setDate('')
    setAdding(false)
  }

  const rows = list
    .map((f) => ({ ...f, diff: daysTo(f.date) }))
    .sort((a, b) => Math.abs(a.diff) - Math.abs(b.diff))
  const visible = showAll ? rows : rows.slice(0, 5)

  return (
    <section className="glass-card hoverable">
      <div className="mb-2 flex items-center gap-2">
        <span className="text-[13px]">🎆</span>
        <h3 className="text-[13px] font-semibold text-slate-200">节日倒数</h3>
        <button
          className="ml-auto rounded-full border border-dashed border-[var(--line)] px-2 py-0.5 text-[10px] text-slate-500 transition-colors hover:text-slate-200"
          onClick={() => setAdding((v) => !v)}
        >
          {adding ? '收起' : '＋ 事件'}
        </button>
      </div>
      {adding ? (
        <div className="mb-2 flex flex-wrap items-center gap-1.5">
          <input
            className="min-w-0 flex-1 rounded-md border border-[var(--line)] bg-[var(--surface-2)] px-2 py-1 text-[11px] text-slate-200 outline-none placeholder:text-slate-600"
            placeholder="事件名"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') add() }}
          />
          <input
            type="date"
            className="rounded-md border border-[var(--line)] bg-[var(--surface-2)] px-2 py-1 text-[11px] text-slate-200 outline-none"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
          <button className="glass-btn primary !px-2 !py-1 !text-[10px]" onClick={add}>加</button>
        </div>
      ) : null}
      <div className="flex flex-col gap-1">
        {visible.map((f) => {
          const tone = daysLabel(f.diff)
          return (
            <div key={f.id} className="group flex items-center gap-2 text-[12px]">
              <span className="min-w-0 flex-1 truncate text-slate-300">
                {f.name}
                {f.lunarMd ? <span className="ml-1 text-[10px] text-slate-600">农历{lunarLabel(f.lunarMd)}</span> : null}
              </span>
              <span className="shrink-0 text-[10px] tabular-nums text-slate-600">{f.date.slice(5)}</span>
              <span className="w-[62px] shrink-0 text-right text-[11px] font-bold tabular-nums" style={{ color: tone.tone }}>
                {tone.text}
              </span>
              {f.custom ? (
                <button
                  className="shrink-0 text-slate-700 opacity-0 transition-opacity hover:text-red-400 group-hover:opacity-100"
                  title="删除自定义事件"
                  onClick={() => save(list.filter((x) => x.id !== f.id))}
                >✕</button>
              ) : <span className="w-[10px] shrink-0" />}
            </div>
          )
        })}
      </div>
      {rows.length > 5 ? (
        <button
          className="mt-1.5 w-full text-center text-[10px] text-slate-600 transition-colors hover:text-slate-400"
          onClick={() => setShowAll((v) => !v)}
        >
          {showAll ? '收起' : `展开全部（${rows.length}）`}
        </button>
      ) : null}
    </section>
  )
}

/* ── 习惯打卡：连续天数 + 🔥，本地存储 ── */
interface Habit { id: string; name: string; streak: number; last: string }
const HABIT_KEY = 'workonHabits'

function loadHabits(): Habit[] {
  try {
    const raw = JSON.parse(localStorage.getItem(HABIT_KEY) ?? '[]') as Habit[]
    return Array.isArray(raw) ? raw : []
  } catch { return [] }
}

export function HabitCard() {
  const [list, setList] = useState<Habit[]>(() => loadHabits())
  const [name, setName] = useState('')
  const today = todayStr()

  const save = (next: Habit[]): void => {
    setList(next)
    try { localStorage.setItem(HABIT_KEY, JSON.stringify(next)) } catch { /* ignore */ }
  }
  const add = (): void => {
    const n = name.trim()
    if (!n) return
    save([...list, { id: 'hb-' + Date.now(), name: n, streak: 0, last: '' }])
    setName('')
  }
  const checkin = (h: Habit): void => {
    if (h.last === today) return
    const yesterday = todayStrOf(-1)
    // 昨天打过 → 连击续上；断了 → 从 1 重新数
    const streak = h.last === yesterday ? h.streak + 1 : 1
    save(list.map((x) => (x.id === h.id ? { ...x, streak, last: today } : x)))
  }
  function todayStrOf(offset: number): string {
    const d = new Date()
    d.setDate(d.getDate() + offset)
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  }

  return (
    <section className="glass-card hoverable">
      <div className="mb-2 flex items-center gap-2">
        <span className="text-[13px]">🔥</span>
        <h3 className="text-[13px] font-semibold text-slate-200">习惯打卡</h3>
        <span className="ml-auto text-[10px] text-slate-500">今天不打，连击就断</span>
      </div>
      <div className="mb-2 flex items-center gap-1.5">
        <input
          className="min-w-0 flex-1 rounded-md border border-[var(--line)] bg-[var(--surface-2)] px-2 py-1 text-[11px] text-slate-200 outline-none placeholder:text-slate-600"
          placeholder="加一个习惯，如：睡前读书"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') add() }}
        />
        <button className="glass-btn primary !px-2 !py-1 !text-[10px]" onClick={add}>加</button>
      </div>
      <div className="flex flex-col gap-1">
        {list.map((h) => {
          const done = h.last === today
          return (
            <div key={h.id} className="group flex items-center gap-2 text-[12px]">
              <span className="min-w-0 flex-1 truncate text-slate-300">{h.name}</span>
              <span
                className="shrink-0 text-[10px] font-bold tabular-nums"
                style={{ color: h.streak >= 3 ? '#fbbf24' : '#94a3b8' }}
                title={`连续 ${h.streak} 天`}
              >
                🔥 {h.streak}
              </span>
              <button
                type="button"
                disabled={done}
                className={`shrink-0 rounded-md px-2 py-0.5 text-[10px] font-medium transition-colors ${
                  done
                    ? 'bg-[var(--teal-soft)] text-[var(--teal-deep)]'
                    : 'border border-[var(--line)] text-slate-400 hover:border-[var(--teal-border)] hover:text-slate-200'
                }`}
                onClick={() => checkin(h)}
              >
                {done ? '✓ 今日已打' : '打卡'}
              </button>
              <button
                className="shrink-0 text-slate-700 opacity-0 transition-opacity hover:text-red-400 group-hover:opacity-100"
                title="删除习惯"
                onClick={() => save(list.filter((x) => x.id !== h.id))}
              >✕</button>
            </div>
          )
        })}
        {!list.length ? <div className="py-1 text-center text-[11px] text-slate-600">还没有习惯，加一个开始连击</div> : null}
      </div>
    </section>
  )
}

/* ── 计划倒数（P2 接 plans）：未来 7 天要交的事 ── */
export function PlanAheadCard() {
  const [plans, setPlans] = useState<PlanItem[]>([])
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    let alive = true
    void window.api
      ?.listPlans?.()
      .then((ps) => { if (alive) setPlans(((ps as PlanItem[]) ?? []).filter((p) => !p.archived)) })
      .catch(() => undefined)
      .finally(() => { if (alive) setLoaded(true) })
    return () => { alive = false }
  }, [])

  const today = todayStr()
  const horizon = todayStrOf(7)
  function todayStrOf(offset: number): string {
    const d = new Date()
    d.setDate(d.getDate() + offset)
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  }

  const rows = useMemo(
    () =>
      plans
        .filter((p) => p.date >= today && p.date <= horizon && p.status !== 'done' && p.status !== 'cancelled')
        .sort((a, b) => a.date.localeCompare(b.date) || (a.startMin ?? 9999) - (b.startMin ?? 9999))
        .slice(0, 6),
    [plans, today, horizon]
  )

  return (
    <section className="glass-card hoverable">
      <div className="mb-2 flex items-center gap-2">
        <span className="text-[13px]">🗓️</span>
        <h3 className="text-[13px] font-semibold text-slate-200">计划倒数</h3>
        <span className="ml-auto text-[10px] text-slate-500">未来 7 天 · 来自计划页</span>
      </div>
      <div className="flex flex-col gap-1">
        {rows.map((p) => {
          const diff = daysTo(p.date)
          const when = diff === 0 ? '今天' : diff === 1 ? '明天' : `${diff} 天后`
          return (
            <div key={p.id} className="flex items-center gap-2 text-[12px]">
              <span
                className="w-[34px] shrink-0 text-right text-[10px] font-bold tabular-nums"
                style={{ color: diff === 0 ? 'var(--teal)' : '#94a3b8' }}
              >
                {when}
              </span>
              <span className="min-w-0 flex-1 truncate text-slate-300">{p.title}</span>
              {p.startMin !== undefined ? (
                <span className="shrink-0 text-[10px] tabular-nums text-slate-600">
                  {Math.floor(p.startMin / 60)}:{pad(p.startMin % 60)}
                </span>
              ) : null}
            </div>
          )
        })}
        {loaded && !rows.length ? <div className="py-1 text-center text-[11px] text-slate-600">未来 7 天没有排期，去计划页安排</div> : null}
        {!loaded ? <div className="py-1 text-center text-[11px] text-slate-600">加载中…</div> : null}
      </div>
    </section>
  )
}

/* ── 目标进度（P2 接 projectTasks）：选一条主线，看任务完成率与下一步 ── */
const GOAL_PID_KEY = 'workonGoalProject'

export function GoalProgressCard() {
  const [projects, setProjects] = useState<Project[]>([])
  const [pid, setPid] = useState<string>(() => localStorage.getItem(GOAL_PID_KEY) ?? '')
  const [pct, setPct] = useState<number | null>(null)
  const [left, setLeft] = useState<{ title: string }[]>([])
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        const ps = ((await window.api?.listProjects?.()) as Project[]) ?? []
        if (!alive) return
        const actives = ps.filter((p) => p.status === 'active')
        setProjects(actives)
        const cur = actives.some((p) => p.id === pid) ? pid : actives[0]?.id ?? ''
        if (cur !== pid) setPid(cur)
      } catch { /* ignore */ }
    })()
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!pid) { setLoaded(true); return }
    localStorage.setItem(GOAL_PID_KEY, pid)
    let alive = true
    void (async () => {
      try {
        const tasks = ((await window.api?.listProjectTasks?.(pid)) as { status: string; title: string; isMilestone?: boolean }[]) ?? []
        if (!alive) return
        const total = tasks.length
        const done = tasks.filter((x) => x.status === 'done').length
        setPct(total ? Math.round((done / total) * 100) : null)
        setLeft(tasks.filter((x) => x.status !== 'done').slice(0, 3).map((x) => ({ title: x.title })))
      } catch { /* ignore */ }
      if (alive) setLoaded(true)
    })()
    return () => { alive = false }
  }, [pid])

  const proj = projects.find((p) => p.id === pid)

  return (
    <section className="glass-card hoverable">
      <div className="mb-2 flex items-center gap-2">
        <span className="text-[13px]">🎯</span>
        <h3 className="text-[13px] font-semibold text-slate-200">目标进度</h3>
        <select
          className="ml-auto max-w-[130px] rounded-md border border-[var(--line)] bg-[var(--surface-2)] px-1.5 py-0.5 text-[10.5px] text-slate-300 outline-none"
          value={pid}
          onChange={(e) => setPid(e.target.value)}
          title="选择要盯着的主线"
        >
          {!projects.length ? <option value="">还没有进行中的主线</option> : null}
          {projects.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
      </div>
      {!loaded ? <div className="py-1 text-center text-[11px] text-slate-600">加载中…</div> : null}
      {loaded && !proj ? (
        <div className="py-1 text-center text-[11px] text-slate-600">去「主线」页建一条主线，这里盯它的进度</div>
      ) : null}
      {loaded && proj ? (
        <>
          <div className="mb-2 flex items-center gap-3">
            <div className="min-w-0 flex-1">
              <div className="mb-1 flex items-baseline gap-2">
                <span className="truncate text-[13px] font-semibold" style={{ color: proj.color ?? '#22D3EE' }}>{proj.name}</span>
                {pct !== null ? <span className="text-[18px] font-extrabold tabular-nums text-neon-green">{pct}%</span> : <span className="text-[10px] text-slate-500">还没有任务</span>}
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--surface-3)]">
                <div
                  className="h-full rounded-full transition-all duration-700"
                  style={{ width: `${pct ?? 0}%`, background: 'var(--teal)' }}
                />
              </div>
            </div>
          </div>
          {left.length ? (
            <div className="flex flex-col gap-0.5">
              <span className="text-[10px] text-slate-500">下一步</span>
              {left.map((x, i) => (
                <div key={i} className="flex items-center gap-1.5 text-[11.5px] text-slate-400">
                  <span className="text-[var(--teal)]">○</span>
                  <span className="min-w-0 truncate">{x.title}</span>
                </div>
              ))}
            </div>
          ) : null}
        </>
      ) : null}
    </section>
  )
}
