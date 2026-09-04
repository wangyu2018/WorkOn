/**
 * 待办树小组件（v7）：三区（项目树/待办/生活）· 三级同构 · 极简无品牌
 * - 顶层/底层切换（穿透），勾选即完成，正在干高亮（归属引擎）
 */
import { useEffect, useState } from 'react'
import type { Project, ProjectTask, PlanItem } from '@shared/types'

interface AttributionState {
  projectId: string | null
  projectName: string
  taskId: string | null
  taskTitle: string
  sec: number
  source: 'binding' | 'keyword' | 'question' | 'none'
}

type NodeState = 'done' | 'doing' | 'todo' | 'blocked'

interface TaskNode {
  id: string
  title: string
  state: NodeState
}

function taskState(s: ProjectTask['status']): NodeState {
  return s === 'done' ? 'done' : s === 'in_progress' ? 'doing' : s === 'blocked' ? 'blocked' : 'todo'
}

const STATE_MARK: Record<NodeState, string> = { done: '☑', doing: '◐', blocked: '⊘', todo: '○' }

export default function TodoWidgetApp() {
  const [projects, setProjects] = useState<Project[]>([])
  const [tasks, setTasks] = useState<Record<string, ProjectTask[]>>({})
  const [plans, setPlans] = useState<PlanItem[]>([])
  const [attr, setAttr] = useState<AttributionState | null>(null)
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [onTop, setOnTop] = useState(true)
  const [collapsed, setCollapsed] = useState(false)
  /** 编辑模式：三分区显隐（⚙ 进入，localStorage 持久化） */
  const [editMode, setEditMode] = useState(false)
  const [zones, setZones] = useState<Record<string, boolean>>(() => {
    try { return JSON.parse(localStorage.getItem('woTodoZones') ?? '{}') } catch { return {} }
  })
  const zoneOn = (k: string, dflt = true): boolean => zones[k] ?? dflt
  const toggleZone = (k: string): void => {
    const next = { ...zones, [k]: !zoneOn(k) }
    setZones(next)
    localStorage.setItem('woTodoZones', JSON.stringify(next))
  }

  const refresh = async (): Promise<void> => {
    try {
      const ps = ((await window.api?.listProjects?.()) as Project[]) ?? []
      setProjects(ps.filter((p) => p.status === 'active'))
      const map: Record<string, ProjectTask[]> = {}
      for (const p of ps.filter((x) => x.status === 'active').slice(0, 6)) {
        map[p.id] = ((await window.api?.listProjectTasks?.(p.id)) as ProjectTask[]) ?? []
      }
      setTasks(map)
      const pl = ((await window.api?.listPlans?.()) as PlanItem[]) ?? []
      setPlans(pl)
    } catch { /* ignore */ }
  }

  useEffect(() => {
    void refresh()
    const pull = (): void => { void window.api?.getAttribution?.().then((a) => setAttr(a as AttributionState)).catch(() => undefined) }
    pull()
    const t = window.setInterval(pull, 8000)
    return () => window.clearInterval(t)
  }, [])

  const toggleTask = async (t: ProjectTask): Promise<void> => {
    const next = t.status === 'done' ? 'todo' : 'done'
    await window.api?.saveProjectTask?.({ ...t, status: next })
    await refresh()
  }

  const togglePlan = async (p: PlanItem): Promise<void> => {
    await window.api?.setPlanStatus?.(p.id, p.status === 'done' ? 'planned' : 'done')
    await refresh()
  }

  const toggleLayer = async (): Promise<void> => {
    const next = !onTop
    setOnTop(next)
    // 底层 = 穿透沉底：通过设置开关驱动（main 切 ignoreMouseEvents）
    try {
      await window.api?.setSettings?.({ todoWidgetOnTop: next } as never)
      // 简化：直接重建窗口状态由 main 监听设置变化；此处仅按钮反馈
    } catch { /* ignore */ }
  }

  const progressOf = (list: ProjectTask[]): { done: number; total: number; pct: number } => {
    const total = list.length
    const done = list.filter((t) => t.status === 'done').length
    return { done, total, pct: total ? Math.round((done / total) * 100) : 0 }
  }

  const todayPlans = plans.filter((p) => p.status !== 'done' || true)
  const todoZone = todayPlans.filter((p) => p.category !== 'personal').slice(0, 6)
  const lifeZone = todayPlans.filter((p) => p.category === 'personal').slice(0, 5)

  const renderNode = (t: ProjectTask, isLevel2: boolean): React.ReactNode => {
    const st = taskState(t.status)
    const isCurrent = attr?.taskTitle && t.title && (attr.taskTitle === t.title || attr.taskTitle.includes(t.title.slice(0, 6)))
    const open = expanded[t.id] ?? false
    return (
      <div key={t.id} style={{ paddingLeft: isLevel2 ? 14 : 26 }} className="py-[3px]">
        <div className="group flex items-center gap-2">
          <button
            className={`shrink-0 text-[12px] transition-colors ${st === 'done' ? 'text-[var(--teal-deep)]' : st === 'doing' ? 'text-[#fbbf24]' : 'text-slate-500 hover:text-slate-300'}`}
            onClick={() => void toggleTask(t)}
            title={st === 'done' ? '取消完成' : '完成'}
          >
            {STATE_MARK[st]}
          </button>
          <span
            className={`min-w-0 flex-1 cursor-pointer truncate text-left text-[12px] ${
              st === 'done' ? 'text-slate-500 line-through decoration-slate-600' : isCurrent ? 'font-medium text-[var(--teal-deep)]' : 'text-slate-300'
            }`}
            onClick={() => setExpanded((e) => ({ ...e, [t.id]: !open }))}
          >
            {t.title}
            {isCurrent ? <span className="ml-1.5 text-[10px] text-[var(--teal-deep)]">● 正在干{attr?.sec ? ` ${Math.max(1, Math.round(attr.sec / 60))}m` : ''}</span> : null}
          </span>
        </div>
        {open && isLevel2 ? (
          <div className="mt-0.5 rounded-lg bg-white/[0.03] px-2.5 py-1.5 text-[10.5px] leading-relaxed text-slate-500">
            {isCurrent
              ? `今天：归属自实时监控 · 已持续 ${Math.max(1, Math.round((attr?.sec ?? 0) / 60))} 分钟`
              : '今天暂无活动记录'}
          </div>
        ) : null}
      </div>
    )
  }

  if (collapsed) {
    return (
      <div className="flex h-screen w-screen items-start justify-end p-2">
        <button
          className="rounded-full border border-[var(--line)] bg-[var(--bg-surface)]/90 px-2 py-1 text-[10px] text-slate-400"
          onClick={() => setCollapsed(false)}
        >
          ☑
        </button>
      </div>
    )
  }

  return (
    <div className="flex h-screen w-screen flex-col p-2">
      <div
        className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--bg-surface)]/85 p-3 backdrop-blur-xl"
        style={{ boxShadow: 'var(--shadow-lg)' }}
      >
        {/* 操作条（无品牌，极简） */}
        <div className="mb-1 flex items-center gap-1.5">
          <button className="text-[11px] text-slate-500 transition-colors hover:text-slate-200" onClick={() => setCollapsed(true)} title="收起">−</button>
          <button className="ml-auto text-[11px] text-slate-500 transition-colors hover:text-slate-200" onClick={() => void toggleLayer()} title={onTop ? '切到底层（穿透）' : '切到顶层'}>
            {onTop ? '◉' : '○'}
          </button>
          <button className="text-[11px] text-slate-500 transition-colors hover:text-slate-200" onClick={() => setEditMode((m) => !m)} title="编辑分区显隐">
            ⚙
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto pr-0.5">
          {editMode ? (
            <div className="mb-2 flex flex-wrap items-center gap-1.5 rounded-lg border border-dashed border-[var(--line)] p-1.5">
              <span className="text-[10px] text-slate-500">显示分区：</span>
              {([['projects', '项目'], ['todos', '待办'], ['life', '生活']] as const).map(([k, label]) => (
                <button
                  key={k}
                  className={`rounded-full border px-2 py-0.5 text-[10px] font-bold transition-all ${zoneOn(k) ? 'border-[rgba(15,181,164,0.5)] bg-[var(--teal-soft)] text-[var(--teal-deep)]' : 'border-[var(--line)] text-slate-500'}`}
                  onClick={() => toggleZone(k)}
                >
                  {label}{zoneOn(k) ? ' ✓' : ''}
                </button>
              ))}
            </div>
          ) : null}
          {/* ── 项目区：一级项目 + 二级任务树 ── */}
          {zoneOn('projects') && projects.map((p) => {
            const list = tasks[p.id] ?? []
            const { done, total, pct } = progressOf(list)
            const open = expanded[p.id] ?? true
            return (
              <div key={p.id} className="mb-2">
                <div className="flex cursor-pointer items-center gap-1.5 py-[3px]" onClick={() => setExpanded((e) => ({ ...e, [p.id]: !open }))}>
                  <span className="text-[10px] text-slate-500">{open ? '▾' : '▸'}</span>
                  <span className="min-w-0 flex-1 truncate text-[12.5px] font-semibold text-slate-100">{p.name}</span>
                  {total > 0 ? (
                    <span className="flex shrink-0 items-center gap-1.5">
                      <span className="text-[10px] tabular-nums text-slate-500">{pct}%</span>
                      <span className="h-1 w-12 overflow-hidden rounded-full bg-white/10">
                        <span className="block h-full rounded-full bg-[var(--teal)]" style={{ width: `${pct}%` }} />
                      </span>
                    </span>
                  ) : null}
                  {p.deadline ? (
                    (() => {
                      const days = Math.ceil((new Date(`${p.deadline}T23:59:59`).getTime() - Date.now()) / 86400000)
                      return (
                        <span
                          className={`shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-bold ${
                            days < 0 ? 'bg-[rgba(239,68,68,0.12)] text-[#f87171]' : days <= 7 ? 'bg-[rgba(245,158,11,0.12)] text-[#fbbf24]' : 'bg-[var(--teal-soft)] text-[var(--teal-deep)]'
                          }`}
                        >
                          {days < 0 ? `超期${-days}天` : `↦${days}天`}
                        </span>
                      )
                    })()
                  ) : total - done > 0 ? (
                    <span className="shrink-0 text-[9px] text-slate-500">剩{total - done}项</span>
                  ) : null}
                </div>
                {open ? list.slice(0, 8).map((t) => renderNode(t, true)) : null}
                {open && !list.length ? <div className="pl-6 text-[10.5px] text-slate-600">暂无任务</div> : null}
              </div>
            )
          })}
          {!projects.length ? <div className="py-1 text-[11px] text-slate-600">还没有活跃项目 · Alt+Space 打开对话框创建</div> : null}

          {/* ── 待办区 ── */}
          {zoneOn('todos') && todoZone.length ? (
            <>
              <div className="mb-0.5 mt-3 border-t border-[var(--line)] pt-2 text-[10px] uppercase tracking-wider text-slate-600">待办</div>
              {todoZone.map((p) => (
                <div key={p.id} className="flex items-center gap-2 py-[3px]">
                  <button
                    className={`shrink-0 text-[12px] ${p.status === 'done' ? 'text-[var(--teal-deep)]' : 'text-slate-500 hover:text-slate-300'}`}
                    onClick={() => void togglePlan(p)}
                  >
                    {p.status === 'done' ? '☑' : '○'}
                  </button>
                  <span className={`min-w-0 flex-1 truncate text-[12px] ${p.status === 'done' ? 'text-slate-500 line-through' : 'text-slate-300'}`}>{p.title}</span>
                </div>
              ))}
            </>
          ) : null}

          {/* ── 生活区 ── */}
          {zoneOn('life') && lifeZone.length ? (
            <>
              <div className="mb-0.5 mt-3 border-t border-[var(--line)] pt-2 text-[10px] uppercase tracking-wider text-slate-600">生活</div>
              {lifeZone.map((p) => (
                <div key={p.id} className="flex items-center gap-2 py-[3px]">
                  <button
                    className={`shrink-0 text-[12px] ${p.status === 'done' ? 'text-[var(--teal-deep)]' : 'text-slate-500 hover:text-slate-300'}`}
                    onClick={() => void togglePlan(p)}
                  >
                    {p.status === 'done' ? '☑' : '○'}
                  </button>
                  <span className={`min-w-0 flex-1 truncate text-[12px] ${p.status === 'done' ? 'text-slate-500 line-through' : 'text-slate-300'}`}>{p.title}</span>
                </div>
              ))}
            </>
          ) : null}
        </div>
      </div>
    </div>
  )
}
