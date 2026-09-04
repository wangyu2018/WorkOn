/**
 * 项目 AI 开发管理看板（并入计划页）
 * 项目 → 任务 → 状态切换 / AI 拆解 / 开发时间归类
 */
import { useCallback, useEffect, useState } from 'react'
import type { Project, ProjectTask } from '@shared/types'
import { fuzzyMatch } from '@shared/fuzzy'
import { Icon } from '../components/Icon'
import { displayApp } from '@shared/appDisplayName'
import { fmtMin } from '../components/utils'

const STATUS_LABEL: Record<ProjectTask['status'], string> = {
  todo: '待做', in_progress: '进行中', done: '完成', blocked: '阻塞'
}
const TASK_STATUS_ORDER: ProjectTask['status'][] = ['todo', 'in_progress', 'done', 'blocked']
const PRIORITY_META = { low: { label: '低', color: '#94a3b8' }, medium: { label: '中', color: '#F59E0B' }, high: { label: '高', color: '#EF4444' } }

export function ProjectBoard({ trail }: { trail: { segments: { mainApp: string; durationMin: number; mainState: string }[] } | null }) {
  const [projects, setProjects] = useState<Project[]>([])
  const [tasks, setTasks] = useState<Record<string, ProjectTask[]>>({})
  const [expanded, setExpanded] = useState<string | null>(null)
  const [newName, setNewName] = useState('')
  const [adding, setAdding] = useState(false)
  const [breakdown, setBreakdown] = useState<{ projectId: string; open: boolean; req: string; loading: boolean }>({ projectId: '', open: false, req: '', loading: false })
  const [linkedApps, setLinkedApps] = useState<Record<string, string[]>>({})
  const [activeProject, setActiveProject] = useState<string | null>(null)
  const [manualApp, setManualApp] = useState('')
  const [err, setErr] = useState<string | null>(null)
  /** AI 排期结果 + 加载态 */
  const [schedule, setSchedule] = useState<{ taskId: string; title: string; projectName: string; priority: string; estMin: number; reason: string }[] | null>(null)
  const [scheduleLoading, setScheduleLoading] = useState(false)
  const [scheduleOpen, setScheduleOpen] = useState(false)
  /** AI 复盘：projectId → { loading, text } */
  const [review, setReview] = useState<Record<string, { loading: boolean; text: string }>>({})

  const load = useCallback(async () => {
    const ps = (await window.api.listProjects()) as Project[]
    setProjects(ps)
    const la = (await window.api.getProjectLinkedApps()) as { projectId: string; apps: string[] }[]
    setLinkedApps(Object.fromEntries(la.map((x) => [x.projectId, x.apps])))
    const links = (await window.api.getDayProjectLinks()) as { app: string; projectId: string }[]
    // 今日活跃项目：归类链接最多的作为「当前」
    if (links.length) {
      const count = new Map<string, number>()
      links.forEach((l) => count.set(l.projectId, (count.get(l.projectId) ?? 0) + 1))
      setActiveProject([...count.entries()].sort((a, b) => b[1] - a[1])[0][0])
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const loadTasks = async (pid: string) => {
    const ts = (await window.api.listProjectTasks(pid)) as ProjectTask[]
    setTasks((prev) => ({ ...prev, [pid]: ts }))
  }
  /** 反显：挂到本项目的每日待办（PlanItem.projectId） */
  const [linkedPlans, setLinkedPlans] = useState<Record<string, { id: string; title: string; status: string }[]>>({})

  /** 属性袋（v7.1）：拖拽中的 key（项目内） */
  const [attrDrag, setAttrDrag] = useState<{ pid: string; key: string } | null>(null)
  const [attrAdding, setAttrAdding] = useState<string | null>(null)
  const [attrNew, setAttrNew] = useState({ key: '', value: '' })

  /** 写属性袋：增/改/删/排序统一入口 */
  const writeAttrs = async (p: Project, attrs: Record<string, string | number>, order?: string[]): Promise<void> => {
    await window.api.saveProject({ id: p.id, attrs, attrOrder: order ?? p.attrOrder })
    await load()
  }

  const setAttrValue = async (p: Project, key: string, value: string): Promise<void> => {
    const attrs = { ...(p.attrs ?? {}) }
    if (!value.trim()) delete attrs[key]
    else attrs[key] = value.trim()
    await writeAttrs(p, attrs)
  }

  const removeAttr = async (p: Project, key: string): Promise<void> => {
    const attrs = { ...(p.attrs ?? {}) }
    delete attrs[key]
    const order = (p.attrOrder ?? Object.keys(attrs)).filter((k) => k !== key)
    await writeAttrs(p, attrs, order)
  }

  const addAttr = async (p: Project): Promise<void> => {
    const k = attrNew.key.trim()
    if (!k) return
    const attrs = { ...(p.attrs ?? {}) }
    attrs[k] = attrNew.value.trim()
    const order = [...(p.attrOrder ?? Object.keys(p.attrs ?? {})), k]
    setAttrAdding(null)
    setAttrNew({ key: '', value: '' })
    await writeAttrs(p, attrs, order)
  }

  /** 拖拽排序：dragover 时重排 attrOrder */
  const reorderAttr = async (p: Project, overKey: string): Promise<void> => {
    if (!attrDrag || attrDrag.pid !== p.id || attrDrag.key === overKey) return
    const order = [...(p.attrOrder ?? Object.keys(p.attrs ?? {}))]
    const from = order.indexOf(attrDrag.key)
    const to = order.indexOf(overKey)
    if (from < 0 || to < 0) return
    order.splice(from, 1)
    order.splice(to, 0, attrDrag.key)
    setAttrDrag({ ...attrDrag, key: overKey })
    await writeAttrs(p, p.attrs ?? {}, order)
  }

  const loadLinked = async (): Promise<void> => {
    try {
      const all = ((await window.api?.listPlans?.()) as { id: string; title: string; status: string; projectId?: string }[]) ?? []
      const map: Record<string, { id: string; title: string; status: string }[]> = {}
      for (const pl of all) {
        if (!pl.projectId) continue
        ;(map[pl.projectId] ??= []).push({ id: pl.id, title: pl.title, status: pl.status })
      }
      setLinkedPlans(map)
    } catch { /* ignore */ }
  }

  useEffect(() => {
    if (expanded) void loadTasks(expanded)
  }, [expanded])

  useEffect(() => {
    void loadLinked()
  }, [])

  const toggleProject = (pid: string) => {
    setExpanded(expanded === pid ? null : pid)
    if (expanded !== pid) void loadTasks(pid)
  }

  const addProject = async () => {
    const name = newName.trim()
    if (!name) return
    // 模糊查重：大小写/相近名不重复建（workon / WorkOn开发 / wokon 视为同一项目）
    const dup = projects.find((p) => fuzzyMatch(name, p.name, 0.75))
    if (dup) {
      window.alert(`已有相似项目「${dup.name}」，不重复创建。如需绑定工具/目录，请在归属确认或项目设置里操作。`)
      return
    }
    await window.api.saveProject({ name })
    setNewName('')
    setAdding(false)
    await load()
  }

  const doRemoveProject = async (pid: string) => {
    if (!window.confirm('删除项目会同时删除其下任务与时间归类，确定？')) return
    await window.api.removeProject(pid)
    await load()
  }

  const setTaskStatus = async (t: ProjectTask, status: ProjectTask['status']) => {
    await window.api.saveProjectTask({ id: t.id, projectId: t.projectId, status })
    if (expanded) await loadTasks(expanded)
  }

  const addTask = async (pid: string, title: string) => {
    const v = title.trim()
    if (!v) return
    await window.api.saveProjectTask({ projectId: pid, title: v })
    await loadTasks(pid)
  }

  const doBreakdown = async () => {
    if (!breakdown.projectId || !breakdown.req.trim()) return
    setBreakdown((b) => ({ ...b, loading: true }))
    try {
      const created = (await window.api.aiBreakdown(breakdown.projectId, breakdown.req.trim())) as ProjectTask[]
      if (created.length) await loadTasks(breakdown.projectId)
      else setErr('AI 未能生成任务（可能未配置 AI 或返回为空），已用简单拆解兜底或未创建。')
    } catch (e) {
      setErr(`AI 拆解失败：${(e as Error).message || '未知错误'}`)
    } finally {
      setBreakdown({ projectId: '', open: false, req: '', loading: false })
    }
  }

  /** AI 任务排期：生成今日建议安排 */
  const doSchedule = async () => {
    setScheduleLoading(true)
    setErr(null)
    try {
      const r = (await window.api.aiSchedule()) as { taskId: string; title: string; projectName: string; priority: string; estMin: number; reason: string }[]
      setSchedule(r)
      setScheduleOpen(true)
    } catch (e) {
      setErr(`AI 排期失败：${(e as Error).message || '未知错误'}`)
    } finally {
      setScheduleLoading(false)
    }
  }

  /** AI 项目复盘 */
  const doReview = async (pid: string) => {
    setReview((prev) => ({ ...prev, [pid]: { loading: true, text: '' } }))
    try {
      const min = todayMinFor(pid)
      const r = (await window.api.aiProjectReview(pid, min)) as { text: string; ok: boolean }
      setReview((prev) => ({ ...prev, [pid]: { loading: false, text: r.text } }))
    } catch (e) {
      setReview((prev) => ({ ...prev, [pid]: { loading: false, text: `复盘失败：${(e as Error).message || ''}` } }))
    }
  }

  const linkApp = async (pid: string, app: string) => {
    await window.api.linkAppToProject(pid, app)
    setManualApp('')
    await load()
  }
  const unlinkApp = async (pid: string, app: string) => {
    await window.api.linkAppToProject(null, app)
    await load()
  }

  const todayMinFor = (pid: string) => {
    if (!trail) return 0
    const apps = linkedApps[pid] ?? []
    if (!apps.length) return 0
    let min = 0
    for (const seg of trail.segments) {
      const k = seg.mainApp.trim().toLowerCase().replace(/\.exe$/i, '')
      if (apps.includes(k)) min += seg.durationMin
    }
    return min
  }

  return (
    <section className="glass-card anim-fade-up" style={{ animationDelay: '300ms' }}>
      <div className="mb-3 flex items-center gap-2.5">
        <span
          className="flex h-6 w-6 items-center justify-center rounded-lg border"
          style={{ background: 'var(--accent-softer)', borderColor: 'var(--border-active)', color: 'var(--accent)' }}
        >
          <Icon name="target" size={13} />
        </span>
        <h3 className="text-[13px] font-semibold text-slate-200">项目 · AI 开发管理</h3>
        <span className="text-[11px] text-slate-500">{projects.length} 个项目</span>
        <div className="flex-1" />
        {adding ? (
          <div className="flex items-center gap-1.5">
            <input
              autoFocus
              className="glass-input !w-44 !py-1 !text-[12px]"
              placeholder="项目名称"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void addProject(); if (e.key === 'Escape') setAdding(false) }}
            />
            <button className="glass-btn primary !px-2 !py-1 !text-[11px]" onClick={() => void addProject()}>创建</button>
            <button className="glass-btn !px-2 !py-1 !text-[11px]" onClick={() => setAdding(false)}>取消</button>
          </div>
        ) : (
          <button className="glass-btn primary !px-2.5 !py-1 !text-[11px]" onClick={() => setAdding(true)}>
            <Icon name="plus" size={12} /> 新建项目
          </button>
        )}
        <button className="glass-btn !px-2.5 !py-1 !text-[11px]" onClick={() => void doSchedule()} disabled={scheduleLoading} title="AI 推荐今日优先做的开发任务">
          <Icon name="sparkles" size={12} className={scheduleLoading ? 'animate-pulse' : ''} /> {scheduleLoading ? '排期中…' : 'AI 排期'}
        </button>
      </div>

      {err ? (
        <div className="mb-2 rounded-lg border border-red-500/25 bg-red-500/10 px-3 py-1.5 text-[11px] text-red-300">{err}</div>
      ) : null}
      {projects.length === 0 ? (
        <div className="rounded-xl border border-dashed border-white/10 bg-white/[0.02] py-6 text-center">
          <p className="text-[12px] text-slate-400">还没有项目。创建一个项目来管理跨天的开发任务，或用 AI 把需求拆解成任务清单。</p>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {projects.map((p) => {
            const ts = tasks[p.id] ?? []
            const doneCount = ts.filter((t) => t.status === 'done').length
            const progress = ts.length ? Math.round((doneCount / ts.length) * 100) : 0
            const isExpanded = expanded === p.id
            const pri = PRIORITY_META[p.priority] ?? PRIORITY_META.medium
            const isActive = activeProject === p.id
            const apps = linkedApps[p.id] ?? []
            return (
              <div key={p.id} className="rounded-xl border border-white/[0.06] bg-white/[0.02] transition-colors hover:bg-white/[0.035]">
                <div className="flex items-center gap-2 px-3 py-2">
                  <button className="text-[10px] text-slate-600" onClick={() => toggleProject(p.id)}>{isExpanded ? '▾' : '▸'}</button>
                  <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: p.color ?? '#22D3EE' }} />
                  <button className="min-w-0 flex-1 text-left" onClick={() => toggleProject(p.id)}>
                    <span className="truncate text-[13px] font-medium text-slate-200">{p.name}</span>
                    {isActive ? <span className="chip ml-2 !text-[9px] !text-neon-cyan">今日开发中</span> : null}
                  </button>
                  <span className="text-[10px] text-slate-500">{ts.length ? `${doneCount}/${ts.length}` : ''}</span>
                            {p.deadline ? (
                    (() => {
                      const days = Math.ceil((new Date(`${p.deadline}T23:59:59`).getTime() - Date.now()) / 86400000)
                      return (
                        <span
                          className={`shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-bold ${
                            days < 0 ? 'bg-[rgba(239,68,68,0.12)] text-[#f87171]' : days <= 7 ? 'bg-[rgba(245,158,11,0.12)] text-[#fbbf24]' : 'bg-[var(--teal-soft)] text-[var(--teal-deep)]'
                          }`}
                          title={`上线目标日 ${p.deadline}`}
                        >
                          {days < 0 ? `超期 ${-days} 天` : `↦ ${days} 天上线`}
                        </span>
                      )
                    })()
                  ) : (
                    <input
                      type="date"
                      title="设置上线目标日（距上线刻度）"
                      className="shrink-0 rounded border border-[var(--line)] bg-transparent px-1 py-0 text-[9px] text-slate-500 outline-none hover:text-slate-300"
                      onChange={(e) => {
                        if (!e.target.value) return
                        void window.api.saveProject({ id: p.id, deadline: e.target.value })
                        void load()
                      }}
                    />
                  )}
                  {ts.length > 0 ? (
                    <div className="h-1.5 w-16 overflow-hidden rounded-full bg-white/[0.06]">
                      <div className="h-full rounded-full transition-all" style={{ width: `${progress}%`, background: p.color ?? '#22D3EE' }} />
                    </div>
                  ) : null}
                  <span className="rounded px-1.5 py-0.5 text-[9px]" style={{ color: pri.color, background: `${pri.color}18` }}>{pri.label}</span>
                  {todayMinFor(p.id) > 0 ? (
                    <span className="text-[10px] text-slate-400" title="今日开发时长">{fmtMin(todayMinFor(p.id))}</span>
                  ) : null}
                  <button className="text-slate-500 hover:text-red-400" title="删除项目" onClick={() => void doRemoveProject(p.id)}>✕</button>
                </div>

                {isExpanded ? (
                  <div className="anim-fade-in border-t border-white/[0.05] px-3 py-2">
                    {/* AI 拆解入口 */}
                    <div className="mb-2 flex items-center gap-1.5">
                      <button className="glass-btn !px-2 !py-1 !text-[11px]" onClick={() => setBreakdown({ projectId: p.id, open: true, req: '', loading: false })}>
                        <Icon name="sparkles" size={11} /> AI 拆解需求
                      </button>
                      <button className="glass-btn !px-2 !py-1 !text-[11px]" onClick={() => void doReview(p.id)} title="生成项目复盘">
                        <Icon name="chart" size={11} className={review[p.id]?.loading ? 'animate-pulse' : ''} /> {review[p.id]?.loading ? '复盘中…' : 'AI 复盘'}
                      </button>
                      <input
                        className="glass-input !w-40 !py-1 !text-[11px]"
                        placeholder="快速加任务（回车）"
                        onKeyDown={(e) => { if (e.key === 'Enter') { void addTask(p.id, (e.target as HTMLInputElement).value); (e.target as HTMLInputElement).value = '' } }}
                      />
                    </div>
                    {/* 属性袋（v7.1）：可拖动小卡，有数据才渲染 */}
                    {(p.attrOrder ?? Object.keys(p.attrs ?? {})).length ? (
                      <div className="mb-2 flex flex-wrap gap-1.5">
                        {(p.attrOrder ?? Object.keys(p.attrs ?? {})).filter((k) => p.attrs?.[k] !== undefined).map((k) => (
                          <div
                            key={k}
                            draggable
                            onDragStart={() => setAttrDrag({ pid: p.id, key: k })}
                            onDragOver={(e) => { e.preventDefault(); void reorderAttr(p, k) }}
                            onDragEnd={() => setAttrDrag(null)}
                            className="group flex cursor-grab items-center gap-1 rounded-lg border px-2 py-1 text-[11px] active:cursor-grabbing"
                            style={{ borderColor: 'var(--line)', background: 'var(--surface-2)' }}
                            title="拖动排序"
                          >
                            <span className="text-slate-500">⠿</span>
                            <span className="text-slate-500">{k}</span>
                            <input
                              className="w-16 border-none bg-transparent text-right font-semibold text-slate-200 outline-none"
                              value={String(p.attrs?.[k] ?? '')}
                              onChange={(e) => void setAttrValue(p, k, e.target.value)}
                            />
                            <button
                              className="hidden text-slate-600 hover:text-red-400 group-hover:inline"
                              title="删除属性"
                              onClick={() => void removeAttr(p, k)}
                            >✕</button>
                          </div>
                        ))}
                        {attrAdding === p.id ? (
                          <div className="flex items-center gap-1 rounded-lg border px-2 py-1" style={{ borderColor: 'var(--border-active)', background: 'var(--surface-2)' }}>
                            <input
                              autoFocus
                              className="w-16 border-none bg-transparent text-[11px] text-slate-300 outline-none"
                              placeholder="字段名"
                              value={attrNew.key}
                              onChange={(e) => setAttrNew((n) => ({ ...n, key: e.target.value }))}
                            />
                            <span className="text-slate-600">:</span>
                            <input
                              className="w-16 border-none bg-transparent text-[11px] font-semibold text-slate-200 outline-none"
                              placeholder="值"
                              value={attrNew.value}
                              onChange={(e) => setAttrNew((n) => ({ ...n, value: e.target.value }))}
                              onKeyDown={(e) => e.key === 'Enter' && void addAttr(p)}
                            />
                            <button className="text-slate-500 hover:text-slate-200" onClick={() => void addAttr(p)}>✓</button>
                          </div>
                        ) : (
                          <button
                            className="rounded-lg border border-dashed px-2 py-1 text-[10.5px] text-slate-500 hover:text-slate-200"
                            style={{ borderColor: 'var(--line)' }}
                            onClick={() => { setAttrAdding(p.id); setAttrNew({ key: '', value: '' }) }}
                          >＋ 属性</button>
                        )}
                      </div>
                    ) : (
                      <button
                        className="mb-2 rounded-lg border border-dashed px-2 py-1 text-[10.5px] text-slate-500 hover:text-slate-200"
                        style={{ borderColor: 'var(--line)' }}
                        onClick={() => { setAttrAdding(p.id); setAttrNew({ key: '', value: '' }) }}
                      >＋ 自定义属性（预算/客户/章节…按你的维度来）</button>
                    )}
                    {(linkedPlans[p.id]?.length ?? 0) > 0 ? (
                      <div className="mb-2 border-t border-dashed border-[var(--line)] pt-2">
                        <div className="mb-1 text-[10px] uppercase tracking-wider text-slate-600">✦ 关联的每日待办</div>
                        {linkedPlans[p.id]!.map((pl) => (
                          <button
                            key={pl.id}
                            className={`block w-full py-0.5 text-left text-[11.5px] ${pl.status === 'done' ? 'text-slate-500 line-through' : 'text-slate-300'} hover:text-[var(--teal-deep)]`}
                            title="点击编辑该待办"
                            onClick={() => window.dispatchEvent(new CustomEvent('workon:edit-plan', { detail: { id: pl.id } }))}
                          >
                            · {pl.title}
                          </button>
                        ))}
                      </div>
                    ) : null}
                                  {review[p.id]?.text ? (
                      <div className="mb-2 whitespace-pre-wrap rounded-lg border border-white/[0.07] bg-white/[0.02] p-2 text-[11px] leading-relaxed text-slate-300">
                        {review[p.id].text}
                      </div>
                    ) : null}
                    {breakdown.open && breakdown.projectId === p.id ? (
                      <div className="mb-2 rounded-lg border border-white/[0.07] bg-white/[0.02] p-2">
                        <textarea
                          className="glass-input !py-1 !text-[11px]"
                          rows={2}
                          placeholder="描述需求，AI 将拆解为任务列表…"
                          value={breakdown.req}
                          onChange={(e) => setBreakdown((b) => ({ ...b, req: e.target.value }))}
                        />
                        <div className="mt-1.5 flex justify-end gap-1.5">
                          <button className="glass-btn !px-2 !py-1 !text-[10px]" onClick={() => setBreakdown((b) => ({ ...b, open: false }))}>取消</button>
                          <button className="glass-btn primary !px-2 !py-1 !text-[10px]" disabled={breakdown.loading || !breakdown.req.trim()} onClick={() => void doBreakdown()}>
                            {breakdown.loading ? '拆解中…' : '生成任务'}
                          </button>
                        </div>
                      </div>
                    ) : null}
                    {/* 任务列表 */}
                    {ts.length === 0 ? (
                      <p className="text-[11px] text-slate-500">暂无任务，可用 AI 拆解需求生成。</p>
                    ) : (
                      <div className="flex flex-col gap-1">
                        {ts.map((t) => {
                          const tp = PRIORITY_META[t.priority] ?? PRIORITY_META.medium
                          return (
                            <div key={t.id} className="flex items-center gap-2 rounded-lg px-1.5 py-1 transition-colors hover:bg-white/[0.03]">
                              <button
                                className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-all ${
                                  t.status === 'done' ? 'border-neon-green bg-neon-green/20 text-neon-green' : 'border-white/20 text-transparent hover:border-neon-green/50'
                                }`}
                                onClick={() => void setTaskStatus(t, t.status === 'done' ? 'todo' : 'done')}
                              >
                                <Icon name="check" size={10} />
                              </button>
                              <span className={`min-w-0 flex-1 truncate text-[12px] ${t.status === 'done' ? 'text-slate-500 line-through' : 'text-slate-300'}`}>{t.title}</span>
                              <select
                                className="glass-input !w-16 !py-0.5 !px-1 !text-[10px]"
                                value={t.status}
                                onChange={(e) => void setTaskStatus(t, e.target.value as ProjectTask['status'])}
                              >
                                {TASK_STATUS_ORDER.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
                              </select>
                              <span className="text-[10px]" style={{ color: tp.color }}>{tp.label}</span>
                              <button className="text-slate-600 hover:text-red-400" title="删除任务" onClick={async () => { await window.api.removeProjectTask(t.id); await loadTasks(p.id) }}>✕</button>
                            </div>
                          )
                        })}
                      </div>
                    )}
                    {/* 开发时间归类 */}
                    <div className="mt-2 border-t border-white/[0.05] pt-2">
                      <div className="mb-1 text-[10px] text-slate-500">开发时间归类（手动指定应用 → 该应用今日时长计入本项目）</div>
                      <div className="flex flex-wrap items-center gap-1.5">
                        {apps.length === 0 ? (
                          <span className="text-[11px] text-slate-600">未关联应用</span>
                        ) : apps.map((a) => (
                          <span key={a} className="chip !py-0">
                            {displayApp(a)}
                            <button className="ml-1 text-slate-500 hover:text-red-400" onClick={() => void unlinkApp(p.id, a)}>✕</button>
                          </span>
                        ))}
                        <input
                          className="glass-input !w-32 !py-1 !text-[11px]"
                          placeholder="应用名"
                          value={manualApp}
                          onChange={(e) => setManualApp(e.target.value)}
                          onKeyDown={(e) => { if (e.key === 'Enter') { void linkApp(p.id, manualApp); (e.target as HTMLInputElement).value = '' } }}
                        />
                        <button className="glass-btn !px-2 !py-1 !text-[10px]" onClick={() => void linkApp(p.id, manualApp)}>归类</button>
                        {todayMinFor(p.id) > 0 ? <span className="text-[10px] text-neon-cyan">今日已计入 {fmtMin(todayMinFor(p.id))}</span> : <span className="text-[10px] text-slate-600">按应用自动累计</span>}
                      </div>
                    </div>
                  </div>
                ) : null}
              </div>
            )
          })}
        </div>
      )}

      {/* AI 排期结果弹窗 */}
      {scheduleOpen ? (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={() => setScheduleOpen(false)}>
          <div className="glass-card anim-scale-in w-[420px] max-h-[70vh] !p-5" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center gap-2">
              <Icon name="sparkles" size={15} className="text-neon-cyan" />
              <h3 className="text-[14px] font-semibold text-slate-100">AI 今日任务排期</h3>
            </div>
            {schedule && schedule.length > 0 ? (
              <div className="flex flex-col gap-2">
                {schedule.map((s, i) => {
                  const pc = { high: '#EF4444', medium: '#F59E0B', low: '#94a3b8' }[s.priority as 'high' | 'medium' | 'low'] ?? '#F59E0B'
                  return (
                    <div key={s.taskId} className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2">
                      <div className="flex items-center gap-2">
                        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-white/[0.06] text-[11px] font-semibold text-slate-300">{i + 1}</span>
                        <span className="min-w-0 flex-1 truncate text-[12px] text-slate-200">{s.title}</span>
                        <span className="chip !py-0 !text-[9px]" style={{ color: pc, borderColor: `${pc}44` }}>{s.priority}</span>
                        <span className="text-[10px] text-slate-500">{s.projectName}</span>
                      </div>
                      <div className="mt-1 pl-7 text-[11px] text-slate-500">{s.reason}</div>
                    </div>
                  )
                })}
              </div>
            ) : (
              <p className="py-4 text-center text-[12px] text-slate-400">没有待办任务可排期，先去创建或 AI 拆解任务吧。</p>
            )}
            <div className="mt-4 flex justify-end">
              <button className="glass-btn" onClick={() => setScheduleOpen(false)}>关闭</button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  )
}
