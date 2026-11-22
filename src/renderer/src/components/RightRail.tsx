/**
 * 主窗右侧多态栏：同一块区域切换「AI 处理流程 / 计划与安排 / 项目研发流程」
 *
 * - 只读消费现有 IPC 与 PipelineTrace，不新增数据源
 * - 收起首页/计划内容后，本栏自动占满剩余宽度（多态成为主视图）
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { PipelineTrace, TraceEvent, TraceToolCall } from '@shared/trace'
import type { PlanItem, Project, ProjectTask } from '@shared/types'
import { dateKey } from '@shared/trail'
import { toolMeta } from '../lib/toolUi'
import { useCoach } from '../lib/useCoach'
import { COACH_KIND_META, COACH_STATUS_META } from '../lib/coachMeta'
import { Icon, type IconName } from './Icon'
import { useBookmarks } from '../lib/bookmarks'

export type RailMode = 'flow' | 'plan' | 'project' | 'nudge'

const MODES: Array<{ key: RailMode; label: string; icon: IconName }> = [
  { key: 'flow', label: '流程', icon: 'zap' },
  { key: 'nudge', label: '提示', icon: 'bell' },
  { key: 'plan', label: '计划安排', icon: 'target' },
  { key: 'project', label: '项目流程', icon: 'folder' }
]

const RAIL_MODE_KEY = 'workon:rail-mode'

function hhmm(min?: number): string {
  if (min == null) return '—'
  return `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`
}

function fmtDay(ts: number): string {
  const d = new Date(ts)
  return `${d.getMonth() + 1}/${d.getDate()}`
}

/** ── AI 处理流程：订阅 ai:trace，保留最近 8 条 ── */
function FlowPanel() {
  const [traces, setTraces] = useState<PipelineTrace[]>([])
  const [openId, setOpenId] = useState<string | null>(null)

  useEffect(() => {
    // 先拉回看，再订阅增量：面板重开也能看到最近的链路
    void Promise.resolve(window.api?.listAITraces?.(8))
      .then((list) => {
        const arr = (list as PipelineTrace[]) ?? []
        if (arr.length) setTraces(arr)
      })
      .catch(() => undefined)
    const off = window.api?.onAITrace?.((raw) => {
      const ev = raw as TraceEvent
      setTraces((prev) => [ev.trace, ...prev.filter((t) => t.id !== ev.trace.id)].slice(0, 8))
    })
    return () => off?.()
  }, [])

  const expandedId = openId ?? traces[0]?.id ?? null

  if (traces.length === 0) {
    return <div className="py-10 text-center text-xs text-slate-600">还没有处理记录——去「问答」或对话框问一句，这里会实时显示链路。</div>
  }

  return (
    <div className="flex flex-col gap-2">
      {traces.map((t) => {
        const open = t.id === expandedId
        const tools = t.rounds.flatMap((r) => r.toolCalls)
        return (
          <section key={t.id} className="glass-card !p-3">
            <button
              type="button"
              className="flex w-full items-start gap-2 text-left"
              onClick={() => setOpenId(open ? '__none__' : t.id)}
            >
              <span className="mt-1 inline-block h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: t.route.decided === 'local' ? 'var(--neon-amber, #f59e0b)' : 'var(--accent)' }} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs text-slate-300">{t.input.text || '（空输入）'}</span>
                <span className="mt-0.5 block text-2xs text-slate-600">
                  {new Date(t.ts).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })} · {t.route.decided === 'local' ? '本地直答' : '模型调用'}
                  {tools.length ? ` · ${tools.length} 个插件` : ''}
                  {t.output.fallback ? ' · 兜底' : ''}
                </span>
              </span>
              <span className="shrink-0 text-xs text-slate-600">{open ? '▾' : '▸'}</span>
            </button>

            {open ? (
              <div className="mt-2.5 flex flex-col gap-2 border-t border-white/[0.06] pt-2.5">
                <FlowStep label="输入" text={t.input.text} />
                <FlowStep label="路由" text={`${t.route.decided === 'local' ? '本地直答' : '模型调用'}${t.route.reason ? ` · ${t.route.reason}` : ''}`} />
                <FlowTools tools={tools} />
                <FlowStep label="模型" text={t.rounds.map((r) => r.model).filter(Boolean).join(' / ') || '—'} />
                <FlowStep label="输出" text={t.output.text || '—'} />
              </div>
            ) : null}
          </section>
        )
      })}
    </div>
  )
}

function FlowStep({ label, text }: { label: string; text: string }) {
  return (
    <div className="flex gap-2 text-xs">
      <span className="w-9 shrink-0 text-slate-600">{label}</span>
      <span className="min-w-0 flex-1 break-words text-slate-400">{text}</span>
    </div>
  )
}

function FlowTools({ tools }: { tools: TraceToolCall[] }) {
  if (tools.length === 0) return <FlowStep label="工具" text="未调用插件" />
  return (
    <div className="flex gap-2 text-xs">
      <span className="w-9 shrink-0 text-slate-600">工具</span>
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        {tools.slice(0, 8).map((call, i) => (
          <span key={`${call.name}-${i}`} className="flex items-center gap-1.5">
            <span className="inline-block h-1 w-1 shrink-0 rounded-full" style={{ background: call.ok ? 'var(--neon-cyan, #22d3ee)' : '#ef4444' }} />
            <span className="truncate text-slate-300">{toolMeta(call.name).label}</span>
            {call.target?.kind === 'node' ? <span className="truncate text-2xs text-violet-400">⇄ {call.target.label}</span> : null}
            <span className="ml-auto shrink-0 text-2xs text-slate-600">{call.ms}ms</span>
          </span>
        ))}
        {tools.length > 8 ? <span className="text-2xs text-slate-600">+{tools.length - 8} 个</span> : null}
      </span>
    </div>
  )
}

/** ── 提示：监控命中记录 + 采纳/跟进闭环 ── */
function NudgePanel() {
  const { state, act, evaluate, snooze, clear } = useCoach()
  const now = Date.now()
  const snoozed = state.snoozeUntil > now
  const stats = state.stats

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2 px-1 text-2xs text-slate-600">
        <span>
          今日 {stats.shown} 次 · 采纳 {stats.accepted} · 跟进 {stats.followed}
          {stats.accepted > 0 ? ` · ${Math.round(stats.followRate * 100)}%` : ''}
        </span>
        <button className="ml-auto rounded px-1.5 py-0.5 text-slate-500 hover:text-slate-200" onClick={() => void evaluate()}>
          现在评估
        </button>
        <button
          className="rounded px-1.5 py-0.5 text-slate-500 hover:text-slate-200"
          onClick={() => void snooze(snoozed ? 0 : 30)}
          title={snoozed ? '取消静默' : '静默期间不再主动提示（手动评估仍可用）'}
        >
          {snoozed ? `取消静默（至 ${new Date(state.snoozeUntil).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}）` : '静默 30 分钟'}
        </button>
      </div>

      {state.items.length === 0 ? (
        <div className="py-10 text-center text-xs leading-relaxed text-slate-600">
          还没有提示记录。
          <br />
          监控会在计划到点、连续摸鱼、项目停摆或专注过久时给出可执行提示。
        </div>
      ) : (
        state.items.map((c) => {
          const kind = COACH_KIND_META[c.kind]
          const status = COACH_STATUS_META[c.status]
          return (
            <section key={c.id} className="glass-card !p-3">
              <div className="flex items-center gap-1.5">
                <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: kind.color }} />
                <span className="text-2xs" style={{ color: kind.color }}>
                  {kind.label}
                </span>
                <span className="text-2xs text-slate-600">
                  {new Date(c.ts).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
                </span>
                <span className="ml-auto rounded-full px-1.5 py-0.5 text-2xs" style={{ color: status.color, background: 'var(--surface-2)' }}>
                  {status.label}
                </span>
              </div>
              <div className="mt-1 text-xs leading-snug text-slate-300">{c.title}</div>
              <div className="mt-1 text-2xs leading-relaxed text-slate-600">依据：{c.reason}</div>
              {c.status === 'shown' ? (
                <div className="mt-2 flex flex-wrap gap-1">
                  {c.actions.map((a) => (
                    <button
                      key={a.key}
                      className={`rounded-md px-2 py-0.5 text-2xs ${a.primary ? 'glass-btn primary' : 'glass-btn'}`}
                      onClick={() => void act(c.id, a.key)}
                    >
                      {a.label}
                    </button>
                  ))}
                </div>
              ) : c.status === 'followed' ? (
                <div className="mt-1.5 text-2xs" style={{ color: COACH_STATUS_META.followed.color }}>
                  ✓ 监控验证：采纳后已进入工作
                </div>
              ) : c.status === 'missed' ? (
                <div className="mt-1.5 text-2xs text-slate-500">监控验证：10 分钟内未进入工作</div>
              ) : c.status === 'accepted' ? (
                <div className="mt-1.5 text-2xs text-slate-500">已采纳 · 等待监控验证</div>
              ) : null}
            </section>
          )
        })
      )}

      {state.items.length > 0 ? (
        <button className="self-end px-1 text-2xs text-slate-600 hover:text-slate-400" onClick={() => void clear()}>
          清空今日记录
        </button>
      ) : null}
    </div>
  )
}

/** ── 计划与安排：今天（含顺延）+ 未来 6 天 ── */
function PlanPanel() {
  const [days, setDays] = useState<Array<{ date: string; label: string; items: PlanItem[] }>>([])
  const { has, toggle } = useBookmarks()

  const load = useCallback(() => {
    const now = Date.now()
    const reqs = Array.from({ length: 7 }, (_, i) => {
      const ts = now + i * 86400000
      const d = dateKey(ts)
      const label = i === 0 ? '今天' : i === 1 ? '明天' : fmtDay(ts)
      return Promise.resolve(window.api?.listPlans?.(d))
        .then((items) => ({ date: d, label, items: ((items as PlanItem[]) ?? []).filter((p) => !p.archived) }))
        .catch(() => ({ date: d, label, items: [] }))
    })
    void Promise.all(reqs).then(setDays)
  }, [])

  useEffect(() => {
    load()
    const off = window.api?.onPlanUpdated?.(() => load())
    return () => off?.()
  }, [load])

  const total = days.reduce((n, d) => n + d.items.length, 0)
  if (days.length === 0) return <div className="py-10 text-center text-xs text-slate-600">读取计划中…</div>

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2 px-1 text-2xs text-slate-600">
        <span>未来 7 天 · {total} 项</span>
        <button className="ml-auto rounded px-1.5 py-0.5 text-slate-500 hover:text-slate-200" onClick={() => load()}>⟳ 刷新</button>
      </div>
      {days.map((d) => (
        <section key={d.date} className="glass-card !p-3">
          <div className="mb-1.5 flex items-baseline gap-2">
            <span className="text-xs font-medium text-slate-300">{d.label}</span>
            <span className="text-2xs text-slate-600">{d.date}</span>
            <span className="ml-auto text-2xs text-slate-600">
              {d.items.filter((p) => p.status === 'done').length}/{d.items.length}
            </span>
          </div>
          {d.items.length === 0 ? (
            <div className="py-1 text-2xs text-slate-600">没有安排</div>
          ) : (
            <div className="flex flex-col gap-1">
              {[...d.items]
                .sort((a, b) => (a.startMin ?? 1e9) - (b.startMin ?? 1e9))
                .slice(0, 8)
                .map((p) => (
                  <div key={p.id} className="group flex items-center gap-2 text-xs">
                    <span
                      className="inline-block h-1.5 w-1.5 shrink-0 rounded-full"
                      style={{ background: p.status === 'done' ? 'var(--neon-green, #34d399)' : p.status === 'in_progress' ? 'var(--accent)' : 'var(--line-strong, #475569)' }}
                    />
                    <span className="w-9 shrink-0 text-2xs tabular-nums text-slate-600">{p.startMin != null ? hhmm(p.startMin) : '—'}</span>
                    <span className={`min-w-0 flex-1 truncate ${p.status === 'done' ? 'text-slate-600 line-through' : 'text-slate-300'}`}>{p.title}</span>
                    {p.carried ? <span className="shrink-0 text-2xs text-amber-400/80">顺延</span> : null}
                    <button
                      type="button"
                      className={`hidden shrink-0 rounded p-0.5 text-[var(--text-3)] hover:text-[var(--accent)] group-hover:block ${
                        has(`plan:${p.id}`) ? '!block text-[var(--accent)]' : ''
                      }`}
                      title={has(`plan:${p.id}`) ? '取消固定到顶部书签' : '固定到顶部书签'}
                      draggable
                      onDragStart={(e) => {
                        e.dataTransfer.setData(
                          'application/x-workon-bookmark',
                          JSON.stringify({
                            id: `plan:${p.id}`,
                            page: 'plan',
                            refId: p.id,
                            title: p.title,
                            meta: [d.date.slice(5), p.startMin != null ? hhmm(p.startMin) : ''].filter(Boolean).join(' '),
                            icon: 'target',
                            locator: d.date,
                            group: p.projectId ? `proj:${p.projectId}` : p.category,
                            createdAt: Date.now()
                          })
                        )
                        e.dataTransfer.effectAllowed = 'copy'
                      }}
                      onClick={() =>
                        toggle({
                          id: `plan:${p.id}`,
                          page: 'plan',
                          refId: p.id,
                          title: p.title,
                          meta: [d.date.slice(5), p.startMin != null ? hhmm(p.startMin) : ''].filter(Boolean).join(' '),
                          icon: 'target',
                          locator: d.date,
                          group: p.projectId ? `proj:${p.projectId}` : p.category,
                          createdAt: Date.now()
                        })
                      }
                    >
                      <Icon name="pin" size={11} />
                    </button>
                  </div>
                ))}
              {d.items.length > 8 ? <div className="text-2xs text-slate-600">+{d.items.length - 8} 项</div> : null}
            </div>
          )}
        </section>
      ))}
    </div>
  )
}

/** ── 项目研发流程：项目列表 → 任务/里程碑 ── */
function ProjectPanel() {
  const [projects, setProjects] = useState<Project[]>([])
  const [openId, setOpenId] = useState<string | null>(null)
  const [tasks, setTasks] = useState<ProjectTask[]>([])
  const [loaded, setLoaded] = useState(false)

  const load = useCallback(() => {
    void Promise.resolve(window.api?.listProjects?.())
      .then((list) => {
        setProjects(((list as Project[]) ?? []).filter((p) => p.status !== 'archived'))
        setLoaded(true)
      })
      .catch(() => setLoaded(true))
  }, [])

  useEffect(() => load(), [load])

  useEffect(() => {
    if (!openId) return
    void Promise.resolve(window.api?.listProjectTasks?.(openId))
      .then((list) => setTasks((list as ProjectTask[]) ?? []))
      .catch(() => setTasks([]))
  }, [openId])

  if (!loaded) return <div className="py-10 text-center text-xs text-slate-600">读取项目…</div>
  if (projects.length === 0) {
    return <div className="py-10 text-center text-xs text-slate-600">还没有项目——在「主线」里建一个，这里会显示研发流程。</div>
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2 px-1 text-2xs text-slate-600">
        <span>{projects.length} 个项目</span>
        <button className="ml-auto rounded px-1.5 py-0.5 text-slate-500 hover:text-slate-200" onClick={() => load()}>⟳ 刷新</button>
      </div>
      {projects.map((p) => {
        const open = p.id === openId
        return (
          <section key={p.id} className="glass-card !p-3">
            <button type="button" className="flex w-full items-start gap-2 text-left" onClick={() => setOpenId(open ? null : p.id)}>
              <span className="mt-1 inline-block h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: p.status === 'active' ? 'var(--accent)' : p.status === 'paused' ? 'var(--neon-amber, #f59e0b)' : 'var(--neon-green, #34d399)' }} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs text-slate-200">{p.name}</span>
                <span className="mt-0.5 block text-2xs text-slate-600">
                  {p.status === 'active' ? '进行中' : p.status === 'paused' ? '暂停' : p.status === 'done' ? '已完成' : p.status}
                  {p.deadline ? ` · 截止 ${p.deadline}` : ''}
                </span>
              </span>
              <span className="shrink-0 text-xs text-slate-600">{open ? '▾' : '▸'}</span>
            </button>
            {open ? <ProjectTasks tasks={tasks} /> : null}
          </section>
        )
      })}
    </div>
  )
}

function ProjectTasks({ tasks }: { tasks: ProjectTask[] }) {
  const list = useMemo(
    () =>
      [...tasks].sort((a, b) => {
        if (!!b.isMilestone !== !!a.isMilestone) return b.isMilestone ? 1 : -1
        return a.sort - b.sort
      }),
    [tasks]
  )
  const done = list.filter((t) => t.status === 'done').length
  if (list.length === 0) return <div className="mt-2 border-t border-white/[0.06] pt-2 text-2xs text-slate-600">这个项目还没有任务</div>
  return (
    <div className="mt-2 border-t border-white/[0.06] pt-2">
      <div className="mb-1.5 flex items-center gap-2">
        <div className="h-1 min-w-0 flex-1 overflow-hidden rounded-full" style={{ background: 'var(--surface-3)' }}>
          <div className="h-full rounded-full" style={{ width: `${list.length ? (done / list.length) * 100 : 0}%`, background: 'var(--accent)' }} />
        </div>
        <span className="shrink-0 text-2xs text-slate-600">{done}/{list.length}</span>
      </div>
      <div className="flex flex-col gap-1">
        {list.slice(0, 10).map((t) => (
          <div key={t.id} className="flex items-center gap-2 text-xs">
            <span className="w-3 shrink-0 text-center text-2xs" style={{ color: t.isMilestone ? 'var(--accent)' : 'var(--text-3)' }}>
              {t.isMilestone ? '◆' : t.status === 'done' ? '✓' : '○'}
            </span>
            <span className={`min-w-0 flex-1 truncate ${t.status === 'done' ? 'text-slate-600 line-through' : 'text-slate-300'}`}>{t.title}</span>
            <span className="shrink-0 text-2xs text-slate-600">{t.status === 'in_progress' ? '进行中' : t.status === 'blocked' ? '受阻' : ''}</span>
          </div>
        ))}
        {list.length > 10 ? <div className="text-2xs text-slate-600">+{list.length - 10} 项</div> : null}
      </div>
    </div>
  )
}

export function RightRail({ collapsed, onExpandContent }: { collapsed: boolean; onExpandContent?: () => void }) {
  const [mode, setMode] = useState<RailMode>(() => {
    const saved = window.localStorage.getItem(RAIL_MODE_KEY)
    return saved === 'plan' || saved === 'project' || saved === 'nudge' ? saved : 'flow'
  })
  const pick = (m: RailMode): void => {
    setMode(m)
    try {
      window.localStorage.setItem(RAIL_MODE_KEY, m)
    } catch { /* ignore */ }
  }

  return (
    <aside
      className="flex min-h-0 shrink-0 flex-col"
      style={{
        width: collapsed ? undefined : 360,
        flex: collapsed ? '1 1 0' : '0 0 auto',
        borderLeft: '1px solid var(--line-strong)',
        background: 'var(--bg-surface)'
      }}
    >
      <div
        className="flex shrink-0 items-center gap-1 px-3 py-2"
        style={{ borderBottom: '1px solid var(--line)', background: 'var(--surface-2)' }}
      >
        {MODES.map((m) => (
          <button
            key={m.key}
            type="button"
            onClick={() => pick(m.key)}
            aria-pressed={mode === m.key}
            className={`flex items-center gap-1 rounded-full px-2.5 py-1 text-xs transition-colors ${
              mode === m.key ? 'font-medium' : 'hover:bg-[var(--surface-3)] hover:text-[var(--text-1)]'
            }`}
            style={
              mode === m.key
                ? { background: 'var(--accent-soft)', color: 'var(--accent)' }
                : { color: 'var(--text-2)' }
            }
          >
            <Icon name={m.icon} size={12} />
            {m.label}
          </button>
        ))}
        {collapsed && onExpandContent ? (
          <button type="button" className="ml-auto rounded-full px-2.5 py-1 text-xs text-slate-500 hover:text-slate-200" onClick={onExpandContent}>
            ⇥ 展开内容
          </button>
        ) : null}
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-3">
        <div className="mx-auto flex w-full max-w-[760px] flex-col gap-2.5">
          {mode === 'flow' ? <FlowPanel /> : mode === 'nudge' ? <NudgePanel /> : mode === 'plan' ? <PlanPanel /> : <ProjectPanel />}
        </div>
      </div>
    </aside>
  )
}
