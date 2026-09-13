/**
 * 项目 AI 开发管理看板（并入计划页）
 * 项目 → 任务 → 状态切换 / AI 拆解 / 开发时间归类
 */
import { useCallback, useEffect, useState } from 'react'
import type { KnowledgeItem, Project, ProjectTask } from '@shared/types'
import { fuzzyMatch } from '@shared/fuzzy'
import { Icon } from '../components/Icon'
import { displayApp } from '@shared/appDisplayName'
import { fmtMin, todayKey } from '../components/utils'

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
  /** 进展回传：粘贴开发工具回复 → 整理待办/进度 */
  const [progressIn, setProgressIn] = useState<{
    projectId: string
    open: boolean
    text: string
    loading: boolean
    diff: {
      completed: string[]
      added: string[]
      completedTasks: string[]
      addedTasks: string[]
      deferred: string[]
      progressNote: string
      summary?: string
    } | null
  }>({ projectId: '', open: false, text: '', loading: false, diff: null })
  const [loopTip, setLoopTip] = useState('')
  const [linkedApps, setLinkedApps] = useState<Record<string, string[]>>({})
  const [activeProject, setActiveProject] = useState<string | null>(null)
  const [manualApp, setManualApp] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [dossiers, setDossiers] = useState<Record<string, KnowledgeItem[]>>({})
  /** AI 排期结果 + 加载态 */
  const [schedule, setSchedule] = useState<{ taskId: string; title: string; projectName: string; priority: string; estMin: number; reason: string }[] | null>(null)
  const [scheduleLoading, setScheduleLoading] = useState(false)
  const [scheduleOpen, setScheduleOpen] = useState(false)
  /** AI 复盘：projectId → { loading, text } */
  const [review, setReview] = useState<Record<string, { loading: boolean; text: string }>>({})
  const [pushing, setPushing] = useState<string | null>(null)

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
    try {
      const list = (await (
        window.api as { listProcessDossiers?: (id?: string) => Promise<KnowledgeItem[]> }
      ).listProcessDossiers?.(pid)) as KnowledgeItem[] | undefined
      setDossiers((prev) => ({ ...prev, [pid]: Array.isArray(list) ? list.slice(0, 8) : [] }))
    } catch {
      setDossiers((prev) => ({ ...prev, [pid]: [] }))
    }
  }
  /** 反显：挂到本项目的每日待办（PlanItem.projectId） */
  const [linkedPlans, setLinkedPlans] = useState<Record<string, { id: string; title: string; status: string }[]>>({})

  /** 里程碑模板：按项目类型给粗颗粒节点（不搞详细设计那套官僚货） */
  const MILESTONE_TEMPLATES: Record<string, { label: string; items: string[]; weekly?: string }> = {
    vibecoding: { label: 'VibeCoding', items: ['原型可玩', '核心功能齐', '自用打磨完', '发布上线'] },
    content: { label: '内容创作', items: ['首发上线', '连续 4 期', '稳定更新 3 个月'], weekly: '本周更新' },
    generic: { label: '通用三段', items: ['启动', '过半', '收尾完成'] }
  }

  const hasMilestone = (pid: string): boolean => (tasks[pid] ?? []).some((x) => x.isMilestone)

  const genMilestones = async (pid: string, typeName: string): Promise<void> => {
    const tpl = MILESTONE_TEMPLATES[typeName]
    if (!tpl) return
    for (const title of tpl.items) {
      await window.api.saveProjectTask({ projectId: pid, title, status: 'todo', priority: 'high', isMilestone: true })
    }
    if (tpl.weekly) {
      // 重复里程碑：挂到自动化引擎（每周一 09:00 自动建「本周更新」待办）
      try {
        await window.api.saveAutomation?.({
          name: `${tpl.weekly}（自动）`,
          enabled: true,
          trigger: { kind: 'weekly', weekday: 1 },
          actions: [{ kind: 'addTodo', text: tpl.weekly }]
        })
      } catch { /* 引擎不可用则跳过 */ }
    }
    await loadTasks(pid)
    await load()
  }

  /** 属性袋（v7.1）：拖拽中的 key（项目内） */
  const [attrDrag, setAttrDrag] = useState<{ pid: string; key: string } | null>(null)
  const [attrAdding, setAttrAdding] = useState<string | null>(null)
  /** 里程碑编辑器（确认后整组替换里程碑任务） */
  const [msEdit, setMsEdit] = useState<{ pid: string; items: string[]; ai?: boolean } | null>(null)
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

  const exportProgressCard = async (pid: string): Promise<void> => {
    try {
      const card = (await window.api.buildStatusCard(pid)) as { markdown: string; projectName: string }
      await navigator.clipboard.writeText(card.markdown)
      setLoopTip(`「${card.projectName}」反哺提示词已复制 · 贴给开发 AI → 把回复贴回「粘贴回传」`)
      window.setTimeout(() => setLoopTip(''), 3200)
    } catch (e) {
      setErr(`导出失败：${(e as Error).message || '未知错误'}`)
    }
  }

  const summarizeProgressIn = async (): Promise<void> => {
    if (!progressIn.projectId || !progressIn.text.trim()) return
    setProgressIn((s) => ({ ...s, loading: true }))
    try {
      const api = window.api as {
        summarizeStatusCard?: (projectId: string, text: string) => Promise<{
          completed: string[]
          added: string[]
          completedTasks: string[]
          addedTasks: string[]
          deferred?: string[]
          progressNote: string
          summary?: string
        }>
      }
      const diff = await api.summarizeStatusCard?.(progressIn.projectId, progressIn.text)
      setProgressIn((s) => ({
        ...s,
        loading: false,
        diff: {
          completed: diff?.completed ?? [],
          added: diff?.added ?? [],
          completedTasks: diff?.completedTasks ?? [],
          addedTasks: diff?.addedTasks ?? [],
          deferred: diff?.deferred ?? [],
          progressNote: diff?.progressNote ?? '',
          summary: diff?.summary
        }
      }))
    } catch (e) {
      setErr(`整理失败：${(e as Error).message || '未知错误'}`)
      setProgressIn((s) => ({ ...s, loading: false }))
    }
  }

  const applyProgressIn = async (): Promise<void> => {
    if (!progressIn.diff || !progressIn.projectId) return
    try {
      const r = (await window.api.applyCardDiff({ ...progressIn.diff, projectId: progressIn.projectId })) as {
        completed?: number
        added?: number
        completedTasks?: number
        addedTasks?: number
        deferred?: number
        progressUpdated?: boolean
      }
      setLoopTip(
        `已更新：待办完成 ${r.completed ?? 0} · 新增 ${r.added ?? 0} · 未实现 ${r.deferred ?? 0} · 任务完成 ${r.completedTasks ?? 0} · 新任务 ${r.addedTasks ?? 0}` +
          (r.progressUpdated ? ' · 进展已写入' : '')
      )
      window.setTimeout(() => setLoopTip(''), 3200)
      setProgressIn({ projectId: '', open: false, text: '', loading: false, diff: null })
      await load()
      await loadTasks(progressIn.projectId)
    } catch (e) {
      setErr(`应用失败：${(e as Error).message || '未知错误'}`)
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

  /** 把跨天项目任务排入「今日安排」成一条 PlanItem */
  const pushTaskToToday = async (opts: {
    projectId: string
    projectName: string
    taskId: string
    title: string
    status?: ProjectTask['status']
  }): Promise<void> => {
    if (opts.status === 'done') return
    setPushing(opts.taskId)
    try {
      const day = todayKey()
      const existing = ((await window.api.listPlans?.(day)) as { id: string; title: string; projectTaskId?: string; archived?: boolean }[]) ?? []
      const hit = existing.find((p) => !p.archived && (p.projectTaskId === opts.taskId || p.title === opts.title))
      if (hit) {
        setLoopTip(`「${opts.title}」已在今日安排中`)
        window.dispatchEvent(new CustomEvent('workon:goto-today'))
        return
      }
      await window.api.savePlan({
        date: day,
        title: opts.title,
        category: 'ai-dev',
        status: 'planned',
        source: 'import',
        planType: 'task',
        projectId: opts.projectId,
        projectTaskId: opts.taskId,
        note: `排自项目「${opts.projectName}」`
      })
      setLoopTip(`已排入今日：${opts.title}`)
      await loadTasks(opts.projectId)
      const pl = ((await window.api.listPlans?.(day)) as { id: string; title: string; status: string; projectId?: string; archived?: boolean }[]) ?? []
      const mine = pl.filter((x) => !x.archived && x.projectId === opts.projectId).map((x) => ({ id: x.id, title: x.title, status: x.status }))
      setLinkedPlans((m) => ({ ...m, [opts.projectId]: mine }))
      window.dispatchEvent(new CustomEvent('workon:goto-today'))
    } catch (e) {
      setErr(`排入今日失败：${(e as Error).message || '未知错误'}`)
    } finally {
      setPushing(null)
    }
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
    <section className="anim-fade-up flex flex-col gap-3">
      <div className="rounded-2xl border border-[var(--line)] bg-[var(--surface-2)] px-3.5 py-3">
        <div className="text-[13px] font-semibold text-[var(--text-1)]">跨天任务池</div>
        <div className="mt-0.5 text-[11px] leading-snug text-[var(--text-3)]">
          管目标、清单与进展反哺；排入今日后才会出现在「今日安排」。
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--surface-2)]">
      <div className="flex flex-wrap items-center gap-2 border-b border-[var(--line)] px-3 py-2.5">
        <span
          className="flex h-6 w-6 items-center justify-center rounded-lg border"
          style={{ background: 'var(--accent-softer)', borderColor: 'var(--border-active)', color: 'var(--accent)' }}
        >
          <Icon name="folder" size={13} />
        </span>
        <h3 className="text-[13px] font-semibold text-[var(--text-1)]">项目列表</h3>
        <span className="rounded-md bg-[var(--surface-3)] px-1.5 py-0.5 text-[10px] tabular-nums text-[var(--text-2)]">{projects.length}</span>
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
      <div className="p-2">

      {err ? (
        <div className="mb-2 rounded-lg border border-red-500/25 bg-red-500/10 px-3 py-1.5 text-[11px] text-red-300">{err}</div>
      ) : null}
      {loopTip ? (
        <div className="mb-2 rounded-lg border border-[rgba(15,181,164,0.25)] bg-[rgba(15,181,164,0.08)] px-3 py-1.5 text-[11px] text-[var(--teal-deep)]">{loopTip}</div>
      ) : null}
      {projects.length === 0 ? (
        <div className="rounded-xl border border-dashed border-[var(--line)] bg-[var(--surface-2)] py-6 text-center">
          <p className="text-[12px] text-[var(--text-2)]">还没有项目。创建一个项目来管理跨天的开发任务，或用 AI 把需求拆解成任务清单。</p>
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
              <div key={p.id} className="rounded-xl border border-[var(--line)] bg-[var(--surface-2)] transition-colors hover:bg-white/[0.035]">
                <div className="flex items-center gap-2 px-3 py-2">
                  <button className="text-[10px] text-[var(--text-3)]" onClick={() => toggleProject(p.id)}>{isExpanded ? '▾' : '▸'}</button>
                  <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: p.color ?? '#22D3EE' }} />
                  <button className="min-w-0 flex-1 text-left" onClick={() => toggleProject(p.id)}>
                    <span className="truncate text-[13px] font-medium text-[var(--text-1)]">{p.name}</span>
                    {isActive ? <span className="chip ml-2 !text-[9px] !text-neon-cyan">今日开发中</span> : null}
                  </button>
                  <span className="text-[10px] text-[var(--text-3)]">{ts.length ? `${doneCount}/${ts.length}` : ''}</span>
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
                      className="shrink-0 rounded border border-[var(--line)] bg-transparent px-1 py-0 text-[9px] text-[var(--text-3)] outline-none hover:text-[var(--text-2)]"
                      onChange={(e) => {
                        if (!e.target.value) return
                        void window.api.saveProject({ id: p.id, deadline: e.target.value })
                        void load()
                      }}
                    />
                  )}
                  {ts.length > 0 ? (
                    <div className="h-1.5 w-16 overflow-hidden rounded-full bg-[var(--surface-3)]">
                      <div className="h-full rounded-full transition-all" style={{ width: `${progress}%`, background: p.color ?? '#22D3EE' }} />
                    </div>
                  ) : null}
                  <span className="rounded px-1.5 py-0.5 text-[9px]" style={{ color: pri.color, background: `${pri.color}18` }}>{pri.label}</span>
                  {todayMinFor(p.id) > 0 ? (
                    <span className="text-[10px] text-[var(--text-2)]" title="今日开发时长">{fmtMin(todayMinFor(p.id))}</span>
                  ) : null}
                  <button className="text-[var(--text-3)] hover:text-red-400" title="删除项目" onClick={() => void doRemoveProject(p.id)}>✕</button>
                </div>

                {isExpanded ? (
                  <div className="anim-fade-in border-t border-[var(--line)] px-3 py-2">
                    <div className="mb-2 flex flex-wrap items-center gap-1.5">
                      <button className="glass-btn !px-2 !py-1 !text-[11px]" onClick={() => void exportProgressCard(p.id)} title="复制反哺提示词：贴给 Cursor/开发 AI，要进展+下一步计划">
                        复制反哺提示词
                      </button>
                      <button
                        className="glass-btn !px-2 !py-1 !text-[11px]"
                        onClick={() => setProgressIn({ projectId: p.id, open: true, text: '', loading: false, diff: null })}
                        title="把开发 AI 的回复贴回来：写入进展 + 导入下一步待办"
                      >
                        粘贴回传
                      </button>
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
                    {p.attrs?.['最近进展'] ? (
                      <div className="mb-2 whitespace-pre-wrap rounded-lg border border-[var(--line)] bg-[var(--surface-2)] px-2.5 py-1.5 text-[11px] leading-relaxed text-[var(--text-2)]">
                        <span className="text-[10px] uppercase tracking-wider text-[var(--text-3)]">最近进展 · </span>
                        {String(p.attrs['最近进展'])}
                      </div>
                    ) : null}
                    {(dossiers[p.id] ?? []).length ? (
                      <div className="mb-2 rounded-lg border border-[var(--line)] bg-[var(--surface-2)] px-2.5 py-1.5">
                        <div className="mb-1 text-[10px] uppercase tracking-wider text-[var(--text-3)]">相关过程案卷</div>
                        <div className="space-y-1">
                          {(dossiers[p.id] ?? []).map((d) => (
                            <div key={d.id} className="truncate text-[11px] text-[var(--text-2)]" title={d.title}>
                              {d.title}
                              {d.categoryName ? <span className="ml-1 text-[10px] text-[var(--text-3)]">· {d.categoryName}</span> : null}
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : null}
                    {progressIn.open && progressIn.projectId === p.id ? (
                      <div className="mb-2 rounded-lg border border-[var(--line)] bg-[var(--surface-2)] p-2">
                        <div className="mb-1 text-[10px] text-[var(--text-3)]">贴回开发 AI 回复 → 写入进展与未实现，并把「今日粗目标」导入待办</div>
                        <textarea
                          className="glass-input !py-1 !text-[11px]"
                          rows={4}
                          placeholder="把开发工具补完后的内容贴在这里…"
                          value={progressIn.text}
                          onChange={(e) => setProgressIn((s) => ({ ...s, text: e.target.value, diff: null }))}
                        />
                        {progressIn.diff ? (
                          <div className="mt-1.5 space-y-0.5 rounded-md border border-[var(--line)] p-2 text-[11px]">
                            {progressIn.diff.summary ? <div className="text-[var(--text-2)]">摘要：{progressIn.diff.summary}</div> : null}
                            {progressIn.diff.progressNote ? <div className="whitespace-pre-wrap text-[var(--text-2)]">进展：{progressIn.diff.progressNote}</div> : null}
                            {progressIn.diff.completed.map((t, i) => <div key={`c${i}`} className="text-[var(--teal-deep)]">☑ 待办完成：{t}</div>)}
                            {progressIn.diff.added.map((t, i) => <div key={`a${i}`} className="text-[#fbbf24]">➕ 今日目标：{t}</div>)}
                            {progressIn.diff.deferred.map((t, i) => <div key={`d${i}`} className="text-neon-amber/90">⏳ 未实现：{t}</div>)}
                            {progressIn.diff.completedTasks.map((t, i) => <div key={`ct${i}`} className="text-[var(--teal-deep)]">☑ 任务完成：{t}</div>)}
                            {progressIn.diff.addedTasks.map((t, i) => <div key={`at${i}`} className="text-[#fbbf24]">➕ 新任务：{t}</div>)}
                          </div>
                        ) : null}
                        <div className="mt-1.5 flex justify-end gap-1.5">
                          <button className="glass-btn !px-2 !py-1 !text-[10px]" onClick={() => setProgressIn({ projectId: '', open: false, text: '', loading: false, diff: null })}>取消</button>
                          <button className="glass-btn !px-2 !py-1 !text-[10px]" disabled={progressIn.loading || !progressIn.text.trim()} onClick={() => void summarizeProgressIn()}>
                            {progressIn.loading ? '整理中…' : 'AI 整理'}
                          </button>
                          <button className="glass-btn primary !px-2 !py-1 !text-[10px]" disabled={!progressIn.diff} onClick={() => void applyProgressIn()}>
                            应用更新
                          </button>
                        </div>
                      </div>
                    ) : null}
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
                            <span className="text-[var(--text-3)]">⠿</span>
                            <span className="text-[var(--text-3)]">{k}</span>
                            <input
                              className="w-16 border-none bg-transparent text-right font-semibold text-[var(--text-1)] outline-none"
                              value={String(p.attrs?.[k] ?? '')}
                              onChange={(e) => void setAttrValue(p, k, e.target.value)}
                            />
                            <button
                              className="hidden text-[var(--text-3)] hover:text-red-400 group-hover:inline"
                              title="删除属性"
                              onClick={() => void removeAttr(p, k)}
                            >✕</button>
                          </div>
                        ))}
                        {attrAdding === p.id ? (
                          <div className="flex items-center gap-1 rounded-lg border px-2 py-1" style={{ borderColor: 'var(--border-active)', background: 'var(--surface-2)' }}>
                            <input
                              autoFocus
                              className="w-16 border-none bg-transparent text-[11px] text-[var(--text-2)] outline-none"
                              placeholder="字段名"
                              value={attrNew.key}
                              onChange={(e) => setAttrNew((n) => ({ ...n, key: e.target.value }))}
                            />
                            <span className="text-[var(--text-3)]">:</span>
                            <input
                              className="w-16 border-none bg-transparent text-[11px] font-semibold text-[var(--text-1)] outline-none"
                              placeholder="值"
                              value={attrNew.value}
                              onChange={(e) => setAttrNew((n) => ({ ...n, value: e.target.value }))}
                              onKeyDown={(e) => e.key === 'Enter' && void addAttr(p)}
                            />
                            <button className="text-[var(--text-3)] hover:text-[var(--text-1)]" onClick={() => void addAttr(p)}>✓</button>
                          </div>
                        ) : (
                          <button
                            className="rounded-lg border border-dashed px-2 py-1 text-[10.5px] text-[var(--text-3)] hover:text-[var(--text-1)]"
                            style={{ borderColor: 'var(--line)' }}
                            onClick={() => { setAttrAdding(p.id); setAttrNew({ key: '', value: '' }) }}
                          >＋ 属性</button>
                        )}
                      </div>
                    ) : (
                      <button
                        className="mb-2 rounded-lg border border-dashed px-2 py-1 text-[10.5px] text-[var(--text-3)] hover:text-[var(--text-1)]"
                        style={{ borderColor: 'var(--line)' }}
                        onClick={() => { setAttrAdding(p.id); setAttrNew({ key: '', value: '' }) }}
                      >＋ 自定义属性（预算/客户/章节…按你的维度来）</button>
                    )}
                    {/* 里程碑：模板一键生成 + 编辑/AI 辅助入口 */}
                    {(() => {
                      const ms = (tasks[p.id] ?? []).filter((x) => x.isMilestone)
                      const editing = msEdit?.pid === p.id
                      return (
                        <div className="mb-2">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="text-[10px] uppercase tracking-wider text-slate-600">里程碑</span>
                            {ms.map((x) => (
                              <span key={x.id} className={`flex items-center gap-1 rounded px-1.5 py-0.5 text-[9px] font-bold ${x.status === 'done' ? 'bg-[var(--teal-soft)] text-[var(--teal-deep)]' : 'bg-[rgba(139,92,246,0.12)] text-[var(--violet)]'}`}>
                                ◆ {x.title}{x.status === 'done' ? ' ✓' : ''}
                              </span>
                            ))}
                            <button
                              className="ml-auto rounded-full border border-dashed px-2 py-0.5 text-[10px] text-slate-500 hover:text-slate-200"
                              onClick={() => setMsEdit({ pid: p.id, items: ms.map((x) => x.title), ai: false })}
                            >
                              编辑 / ✦ AI
                            </button>
                          </div>
                          {editing ? (
                            <div className="mt-1.5 rounded-lg border border-[var(--line)] bg-[var(--surface-2)] p-2">
                              {msEdit.items.map((it, i) => (
                                <div key={i} className="mb-1 flex items-center gap-1.5">
                                  <span className="text-[10px] text-[var(--violet)]">◆</span>
                                  <input
                                    className="min-w-0 flex-1 rounded border border-[var(--line)] bg-transparent px-1.5 py-0.5 text-[11px] text-slate-200 outline-none focus:border-[var(--border-active)]"
                                    value={it}
                                    onChange={(e) => setMsEdit((s) => (s ? { ...s, items: s.items.map((x, j) => (j === i ? e.target.value : x)) } : s))}
                                  />
                                  <button className="text-slate-600 hover:text-red-400" onClick={() => setMsEdit((s) => (s ? { ...s, items: s.items.filter((_, j) => j !== i) } : s))}>✕</button>
                                </div>
                              ))}
                              <div className="mt-1 flex flex-wrap items-center gap-1.5">
                                <button className="rounded-full border border-dashed px-2 py-0.5 text-[10px] text-slate-500 hover:text-slate-200" onClick={() => setMsEdit((s) => (s ? { ...s, items: [...s.items, ''] } : s))}>＋ 节点</button>
                                <span className="text-[10px] text-slate-600">模板：</span>
                                {Object.entries(MILESTONE_TEMPLATES).map(([k, tpl]) => (
                                  <button key={k} className="rounded-full border border-dashed px-1.5 py-0.5 text-[9.5px] text-slate-500 hover:text-[var(--teal-deep)]" onClick={() => setMsEdit((s) => (s ? { ...s, items: [...tpl.items] } : s))}>
                                    {tpl.label}
                                  </button>
                                ))}
                                <button
                                  className="rounded-full px-1.5 py-0.5 text-[9.5px] font-bold text-[var(--violet)] hover:bg-white/5"
                                  title="按项目目标 AI 生成里程碑"
                                  onClick={() => {
                                    void (async () => {
                                      const goal = projects.find((x) => x.id === p.id)?.goal ?? ''
                                      const r = (await window.api.askQA?.(
                                        '项目「' + p.name + '」目标：' + (goal || '（未填写）') + '。给出 4-6 个粗颗粒里程碑标题（不要详细设计类官样文字，要结果导向），只输出 JSON 字符串数组。'
                                      )) as { content?: string } | string | undefined
                                      const content = typeof r === 'string' ? r : r?.content ?? ''
                                      const m2 = content.match(/\[[\s\S]*?\]/)
                                      if (m2) {
                                        const arr: string[] = JSON.parse(m2[0])
                                        setMsEdit((s) => (s ? { ...s, items: arr.filter((x) => typeof x === 'string').slice(0, 8) } : s))
                                      }
                                    })()
                                  }}
                                >✦ AI 生成</button>
                              </div>
                              <div className="mt-1.5 flex justify-end gap-1.5">
                                <button className="glass-btn !px-2 !py-0.5 !text-[10px]" onClick={() => setMsEdit(null)}>取消</button>
                                <button
                                  className="glass-btn primary !px-2 !py-0.5 !text-[10px]"
                                  onClick={() => {
                                    void (async () => {
                                      for (const x of ms) await window.api.removeProjectTask?.(x.id)
                                      for (const title of msEdit.items.filter((x) => x.trim())) {
                                        await window.api.saveProjectTask({ projectId: p.id, title: title.slice(0, 80), status: 'todo', priority: 'high', isMilestone: true })
                                      }
                                      setMsEdit(null)
                                      await loadTasks(p.id)
                                      await load()
                                    })()
                                  }}
                                >确认保存</button>
                              </div>
                            </div>
                          ) : null}
                        </div>
                      )
                    })()}
                    {(linkedPlans[p.id]?.length ?? 0) > 0 ? (
                      <div className="mb-2 border-t border-dashed border-[var(--line)] pt-2">
                        <div className="mb-1 text-[10px] uppercase tracking-wider text-[var(--text-3)]">今日安排里已挂本项目</div>
                        {linkedPlans[p.id]!.map((pl) => (
                          <button
                            key={pl.id}
                            className={`block w-full py-0.5 text-left text-[11.5px] ${pl.status === 'done' ? 'text-[var(--text-3)] line-through' : 'text-[var(--text-2)]'} hover:text-[var(--teal-deep)]`}
                            title="点击编辑该待办"
                            onClick={() => window.dispatchEvent(new CustomEvent('workon:edit-plan', { detail: { id: pl.id } }))}
                          >
                            · {pl.title}
                          </button>
                        ))}
                      </div>
                    ) : null}
                                  {review[p.id]?.text ? (
                      <div className="mb-2 whitespace-pre-wrap rounded-lg border border-[var(--line)] bg-[var(--surface-2)] p-2 text-[11px] leading-relaxed text-[var(--text-2)]">
                        {review[p.id].text}
                      </div>
                    ) : null}
                    {breakdown.open && breakdown.projectId === p.id ? (
                      <div className="mb-2 rounded-lg border border-[var(--line)] bg-[var(--surface-2)] p-2">
                        <textarea
                          className="glass-input !py-1 !text-[11px]"
                          rows={2}
                          placeholder="描述今日目的或要优化的方面，AI 会整理成 2～5 条粗目标…"
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
                      <p className="text-[11px] text-[var(--text-3)]">暂无任务，可用 AI 拆解需求生成。</p>
                    ) : (
                      <div className="flex flex-col gap-1">
                        {ts.map((t) => {
                          const tp = PRIORITY_META[t.priority] ?? PRIORITY_META.medium
                          return (
                            <div key={t.id} className="flex items-center gap-2 rounded-lg px-1.5 py-1 transition-colors hover:bg-[var(--surface-3)]">
                              <button
                                className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-all ${
                                  t.status === 'done' ? 'border-neon-green bg-neon-green/20 text-neon-green' : 'border-white/20 text-transparent hover:border-neon-green/50'
                                }`}
                                onClick={() => void setTaskStatus(t, t.status === 'done' ? 'todo' : 'done')}
                              >
                                <Icon name="check" size={10} />
                              </button>
                              <span className={`min-w-0 flex-1 truncate text-[12px] ${t.status === 'done' ? 'text-[var(--text-3)] line-through' : 'text-[var(--text-2)]'}`}>{t.title}</span>
                              {t.status !== 'done' ? (
                                <button
                                  className="glass-btn !px-1.5 !py-0.5 !text-[10px]"
                                  disabled={pushing === t.id}
                                  title="写入今日安排，带上项目归属"
                                  onClick={() => void pushTaskToToday({
                                    projectId: p.id,
                                    projectName: p.name,
                                    taskId: t.id,
                                    title: t.title,
                                    status: t.status
                                  })}
                                >
                                  {pushing === t.id ? '…' : '排入今日'}
                                </button>
                              ) : null}
                              <select
                                className="glass-input !w-16 !py-0.5 !px-1 !text-[10px]"
                                value={t.status}
                                onChange={(e) => void setTaskStatus(t, e.target.value as ProjectTask['status'])}
                              >
                                {TASK_STATUS_ORDER.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
                              </select>
                              <span className="text-[10px]" style={{ color: tp.color }}>{tp.label}</span>
                              <button className="text-[var(--text-3)] hover:text-red-400" title="删除任务" onClick={async () => { await window.api.removeProjectTask(t.id); await loadTasks(p.id) }}>✕</button>
                            </div>
                          )
                        })}
                      </div>
                    )}
                    {/* 开发时间归类 */}
                    <div className="mt-2 border-t border-[var(--line)] pt-2">
                      <div className="mb-1 text-[10px] text-[var(--text-3)]">开发时间归类（手动指定应用 → 该应用今日时长计入本项目）</div>
                      <div className="flex flex-wrap items-center gap-1.5">
                        {apps.length === 0 ? (
                          <span className="text-[11px] text-[var(--text-3)]">未关联应用</span>
                        ) : apps.map((a) => (
                          <span key={a} className="chip !py-0">
                            {displayApp(a)}
                            <button className="ml-1 text-[var(--text-3)] hover:text-red-400" onClick={() => void unlinkApp(p.id, a)}>✕</button>
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
                        {todayMinFor(p.id) > 0 ? <span className="text-[10px] text-neon-cyan">今日已计入 {fmtMin(todayMinFor(p.id))}</span> : <span className="text-[10px] text-[var(--text-3)]">按应用自动累计</span>}
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
              <h3 className="text-[14px] font-semibold text-[var(--text-1)]">AI 今日任务排期</h3>
            </div>
            {schedule && schedule.length > 0 ? (
              <div className="flex flex-col gap-2">
                {schedule.map((s, i) => {
                  const pc = { high: '#EF4444', medium: '#F59E0B', low: '#94a3b8' }[s.priority as 'high' | 'medium' | 'low'] ?? '#F59E0B'
                  const proj = projects.find((x) => x.name === s.projectName)
                  return (
                    <div key={s.taskId} className="rounded-lg border border-[var(--line)] bg-[var(--surface-2)] px-3 py-2">
                      <div className="flex items-center gap-2">
                        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[var(--surface-3)] text-[11px] font-semibold text-[var(--text-2)]">{i + 1}</span>
                        <span className="min-w-0 flex-1 truncate text-[12px] text-[var(--text-1)]">{s.title}</span>
                        <span className="chip !py-0 !text-[9px]" style={{ color: pc, borderColor: `${pc}44` }}>{s.priority}</span>
                        <span className="text-[10px] text-[var(--text-3)]">{s.projectName}</span>
                        {proj ? (
                          <button
                            className="glass-btn primary !px-1.5 !py-0.5 !text-[10px]"
                            disabled={pushing === s.taskId}
                            onClick={() => void pushTaskToToday({
                              projectId: proj.id,
                              projectName: proj.name,
                              taskId: s.taskId,
                              title: s.title
                            })}
                          >
                            排入今日
                          </button>
                        ) : null}
                      </div>
                      <div className="mt-1 pl-7 text-[11px] text-[var(--text-3)]">{s.reason}</div>
                    </div>
                  )
                })}
              </div>
            ) : (
              <p className="py-4 text-center text-[12px] text-[var(--text-2)]">没有待办任务可排期，先去创建或 AI 拆解任务吧。</p>
            )}
            <div className="mt-4 flex justify-end gap-2">
              <button className="glass-btn text-[12px]" onClick={() => { setScheduleOpen(false); window.dispatchEvent(new CustomEvent('workon:goto-today')) }}>去今日安排</button>
              <button className="glass-btn" onClick={() => setScheduleOpen(false)}>关闭</button>
            </div>
          </div>
        </div>
      ) : null}
      </div>
      </div>
    </section>
  )
}
