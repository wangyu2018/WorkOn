/**
 * 项目详情/管理弹窗（v8）：查看 | 管理 两页签
 * 查看=进度概览+对接情况(归属绑定/计时归类/实时归因)+里程碑+任务；管理=字段/属性袋/任务增删改
 */
import { useCallback, useEffect, useState } from 'react'
import type { MergedTrail, Project, ProjectTask } from '@shared/types'
import { DOMAIN_META, guessDomain, PRESET_DOMAINS, resolveTerm, defaultDomainOfUserType } from '@shared/dictionary'
import { displayApp } from '@shared/appDisplayName'
import { useSettingsStore } from '../stores/settingsStore'
import { fmtMin, todayKey } from '../components/utils'
import { Icon } from '../components/Icon'

type Tab = 'view' | 'manage'

/** 归属绑定（主进程 ProjectBinding 的镜像） */
interface BindShape {
  apps: string[]
  keywords: string[]
  dirs: string[]
}

const STATUS_LABEL: Record<ProjectTask['status'], string> = {
  todo: '待做', in_progress: '进行中', done: '完成', blocked: '阻塞'
}
const STATUS_COLOR: Record<ProjectTask['status'], string> = {
  todo: '#94a3b8', in_progress: '#22D3EE', done: 'var(--teal)', blocked: '#f87171'
}
const PROJ_STATUS: Record<Project['status'], string> = { active: '进行中', paused: '暂停', done: '已完成', archived: '已归档' }

export function ProjectModal({ project, onClose, onSaved, initialTab }: {
  project: Project
  onClose: () => void
  onSaved: () => void
  initialTab?: Tab
}) {
  const [tab, setTab] = useState<Tab>(initialTab ?? 'view')
  const [tasks, setTasks] = useState<ProjectTask[]>([])
  const [draft, setDraft] = useState<Project>({ ...project })
  const [newTask, setNewTask] = useState('')
  const [customDomain, setCustomDomain] = useState(
    project.domain && !PRESET_DOMAINS.includes(project.domain) ? project.domain : ''
  )
  const userType = useSettingsStore((s) => s.settings.userType)
  const domainGuess = !project.domain ? guessDomain({ text: `${project.name} ${project.goal ?? ''}` }) : null

  /* ── 对接情况数据 ── */
  const [bind, setBind] = useState<BindShape | null>(null)
  const [timedApps, setTimedApps] = useState<string[]>([])
  const [todayMin, setTodayMin] = useState(0)
  const [dirAct, setDirAct] = useState<{ changedFiles: number; hotspot: string } | null>(null)
  const [attr, setAttr] = useState<{ projectId?: string | null; app?: string; title?: string } | null>(null)
  const [addBind, setAddBind] = useState<{ kind: 'apps' | 'keywords' | 'dirs'; text: string } | null>(null)
  const [addTimed, setAddTimed] = useState<string | null>(null)
  const [seenApps, setSeenApps] = useState<string[]>([])
  const [tip, setTip] = useState('')
  const [err, setErr] = useState('')
  /* ── 行动区 ── */
  const [progressIn, setProgressIn] = useState<{ open: boolean; text: string; loading: boolean; diff: ProgressDiff | null }>({ open: false, text: '', loading: false, diff: null })
  const [breakdown, setBreakdown] = useState<{ open: boolean; req: string; loading: boolean }>({ open: false, req: '', loading: false })
  const [review, setReview] = useState<{ loading: boolean; text: string }>({ loading: false, text: '' })
  const [pushing, setPushing] = useState<string | null>(null)
  /** 今日计划里已挂的项目任务 id（已排入的行不再给按钮，留常驻标记） */
  const [pushedIds, setPushedIds] = useState<Set<string>>(new Set())

  const reloadTasks = useCallback(async (): Promise<void> => {
    const ts = ((await window.api?.listProjectTasks?.(project.id)) as ProjectTask[]) ?? []
    setTasks(ts)
  }, [project.id])

  const reloadLinks = useCallback(async (): Promise<void> => {
    const bs = ((await window.api?.listBindings?.()) as (BindShape & { projectId: string })[]) ?? []
    setBind(bs.find((b) => b.projectId === project.id) ?? null)
    const links = ((await window.api?.getProjectLinks?.(project.id)) as { app: string }[]) ?? []
    setTimedApps(links.map((l) => l.app))
    const todayPlans = ((await window.api?.listPlans?.(todayKey())) as { projectTaskId?: string; archived?: boolean }[]) ?? []
    setPushedIds(new Set(todayPlans.filter((p) => !p.archived && p.projectTaskId).map((p) => p.projectTaskId as string)))
  }, [project.id])

  useEffect(() => { void reloadTasks(); void reloadLinks() }, [reloadTasks, reloadLinks])

  const reloadActivity = useCallback(async (): Promise<void> => {
    try {
      const [tr, act, a] = await Promise.all([
        window.api?.getTrail?.(),
        window.api?.getTodayActivity?.(project.id),
        window.api?.getAttribution?.()
      ])
      const apps = new Set((((await window.api?.getProjectLinks?.(project.id)) as { app: string }[]) ?? []).map((l) => l.app.toLowerCase().replace(/\.exe$/i, '')))
      const seen = new Set<string>()
      let min = 0
      for (const seg of (tr as MergedTrail | null)?.segments ?? []) {
        const raw = (seg.mainApp ?? '').trim()
        if (raw) seen.add(raw)
        if (apps.has(raw.toLowerCase().replace(/\.exe$/i, ''))) min += seg.durationMin
      }
      setTodayMin(min)
      setSeenApps([...seen])
      const actR = act as { changedFiles: number; hotspot: string } | undefined
      setDirAct(actR && actR.changedFiles > 0 ? actR : null)
      setAttr(a as { projectId?: string | null; app?: string; title?: string } | null)
    } catch { /* ignore */ }
  }, [project.id])

  useEffect(() => { void reloadActivity() }, [reloadActivity])

  const done = tasks.filter((x) => x.status === 'done').length
  const left = tasks.filter((x) => x.status !== 'done').length
  const pct = tasks.length ? Math.round((done / tasks.length) * 100) : null
  const days = project.deadline ? Math.ceil((new Date(`${project.deadline}T23:59:59`).getTime() - Date.now()) / 86400000) : null
  const liveHere = attr?.projectId === project.id

  const flash = (t: string): void => { setTip(t); window.setTimeout(() => setTip(''), 3200) }

  /* ── 绑定编辑（读 → 改 → setBinding 覆盖） ── */
  const writeBind = async (kind: 'apps' | 'keywords' | 'dirs', list: string[]): Promise<void> => {
    await (window.api as { setBinding?: (pid: string, n: Record<string, string[]>) => Promise<void> }).setBinding?.(project.id, { [kind]: list })
    await reloadLinks()
  }
  const removeBindItem = async (kind: 'apps' | 'keywords' | 'dirs', item: string): Promise<void> => {
    await writeBind(kind, (bind?.[kind] ?? []).filter((x) => x !== item))
  }
  const addBindItem = async (): Promise<void> => {
    if (!addBind || !addBind.text.trim()) return
    await writeBind(addBind.kind, [...(bind?.[addBind.kind] ?? []), addBind.text.trim()])
    setAddBind(null)
  }

  const unlinkTimedApp = async (app: string): Promise<void> => {
    await window.api.linkAppToProject(null, app)
    await reloadLinks(); await reloadActivity()
  }
  const linkTimedApp = async (app: string): Promise<void> => {
    const v = app.trim()
    if (!v) return
    await window.api.linkAppToProject(project.id, v)
    setAddTimed(null)
    await reloadLinks(); await reloadActivity()
  }

  const setTaskStatus = async (t: ProjectTask, status: ProjectTask['status']): Promise<void> => {
    await window.api.saveProjectTask({ ...t, status })
    await reloadTasks(); onSaved()
  }
  const removeTask = async (t: ProjectTask): Promise<void> => {
    await window.api.removeProjectTask?.(t.id)
    await reloadTasks(); onSaved()
  }
  const addTask = async (): Promise<void> => {
    if (!newTask.trim()) return
    await window.api.saveProjectTask({ projectId: project.id, title: newTask.trim().slice(0, 80), status: 'todo', priority: 'medium' })
    setNewTask('')
    await reloadTasks(); onSaved()
  }
  const saveHeader = async (): Promise<void> => {
    await window.api.saveProject({ ...draft })
    onSaved()
  }

  const pushTaskToToday = async (t: ProjectTask): Promise<void> => {
    if (t.status === 'done') return
    setPushing(t.id)
    try {
      const day = todayKey()
      const existing = ((await window.api.listPlans?.(day)) as { id: string; title: string; projectTaskId?: string; archived?: boolean }[]) ?? []
      const hit = existing.find((p) => !p.archived && (p.projectTaskId === t.id || p.title === t.title))
      if (hit) {
        flash(`「${t.title}」已在今日安排中`)
        return
      }
      await window.api.savePlan({
        date: day, title: t.title, category: 'ai-dev', status: 'planned', source: 'import',
        planType: 'task', projectId: project.id, projectTaskId: t.id, note: `排自项目「${project.name}」`
      })
      setPushedIds((s) => new Set([...s, t.id]))
      flash(`已排入今日：${t.title} · 去「计划」页可见`)
    } catch (e) { setErr(`排入今日失败：${(e as Error).message || ''}`) } finally { setPushing(null) }
  }

  const exportProgressCard = async (): Promise<void> => {
    try {
      const card = (await window.api.buildStatusCard(project.id)) as { markdown: string; projectName: string }
      await window.api.writeClipboard(card.markdown)
      flash(`反哺提示词已复制 · 贴给开发 AI → 把回复贴回「粘贴回传」`)
    } catch (e) { setErr(`导出失败：${(e as Error).message || ''}`) }
  }

  const doBreakdown = async (): Promise<void> => {
    if (!breakdown.req.trim()) return
    setBreakdown((b) => ({ ...b, loading: true }))
    try {
      const created = (await window.api.aiBreakdown(project.id, breakdown.req.trim())) as ProjectTask[]
      if (created.length) { await reloadTasks(); onSaved(); setBreakdown({ open: false, req: '', loading: false }) }
      else { setErr('AI 未能生成任务'); setBreakdown((b) => ({ ...b, loading: false })) }
    } catch (e) { setErr(`AI 拆解失败：${(e as Error).message || ''}`); setBreakdown((b) => ({ ...b, loading: false })) }
  }

  const doReview = async (): Promise<void> => {
    setReview({ loading: true, text: '' })
    try {
      const r = (await window.api.aiProjectReview(project.id, todayMin)) as { text: string }
      setReview({ loading: false, text: r.text })
    } catch (e) { setReview({ loading: false, text: `复盘失败：${(e as Error).message || ''}` }) }
  }

  const inputCls = 'w-full rounded-lg border border-[var(--line)] bg-[var(--surface-2)] px-2.5 py-1.5 text-[12px] text-slate-200 outline-none focus:border-[var(--border-active)]'

  return (
    <div className="anim-fade-in fixed inset-0 z-[80] flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div
        className="glass-card anim-scale-in flex max-h-[80vh] w-[620px] flex-col overflow-hidden"
        style={{ borderRadius: 'var(--r-xl)', boxShadow: 'var(--shadow-lg)' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* 头 */}
        <div className="flex items-center gap-2 border-b border-[var(--line)] px-4 py-3">
          <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: project.color ?? 'var(--teal)' }} />
          <b className="min-w-0 flex-1 truncate text-[14px] text-slate-100">{draft.name || project.name}</b>
          <span className="shrink-0 rounded-full bg-white/5 px-2 py-0.5 text-[9.5px] font-bold text-slate-400">{PROJ_STATUS[project.status]}</span>
          {days !== null ? (
            <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-bold ${days < 0 ? 'bg-[rgba(239,68,68,0.12)] text-[#f87171]' : days <= 7 ? 'bg-[rgba(245,158,11,0.12)] text-[#fbbf24]' : 'bg-[var(--teal-soft)] text-[var(--teal-deep)]'}`}>
              {days < 0 ? `超期${-days}天` : `↦${days}天上线`}
            </span>
          ) : null}
          {liveHere ? <span className="shrink-0 text-[10px] font-bold text-[var(--teal-deep)]">● 正在干</span> : null}
          <button className="text-slate-500 transition-colors hover:text-slate-200" onClick={onClose}>✕</button>
        </div>

        {/* 页签 */}
        <div className="flex gap-1 border-b border-[var(--line)] px-4 py-2">
          {([['view', '查看'], ['manage', '管理']] as [Tab, string][]).map(([k, label]) => (
            <button
              key={k}
              className={`rounded-lg px-3 py-1 text-[11.5px] transition-colors ${tab === k ? 'bg-[var(--surface-3)] text-[var(--teal-deep)]' : 'text-slate-500 hover:text-slate-200'}`}
              onClick={() => setTab(k)}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {/* ── 查看：概览仪表盘，不堆编辑件 ── */}
          {tab === 'view' && (
            <div className="flex flex-col gap-3">
              {err ? <div className="rounded-lg border border-red-500/25 bg-red-500/10 px-3 py-1.5 text-[11px] text-red-300">{err}</div> : null}
              {tip ? <div className="rounded-lg border border-[var(--teal-border)] bg-[var(--teal-wash)] px-3 py-1.5 text-[11px] text-[var(--teal-deep)]">{tip}</div> : null}

              {/* 概览头：进度环 + 目标 + 关键数字一行 */}
              <div className="flex items-center gap-3.5 rounded-xl border border-[var(--line)] bg-[var(--surface-2)] px-4 py-3">
                {pct !== null ? (
                  <div className="relative h-12 w-12 shrink-0">
                    <svg viewBox="0 0 48 48" className="-rotate-90 h-12 w-12">
                      <circle cx="24" cy="24" r="20" fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="4" />
                      <circle cx="24" cy="24" r="20" fill="none" stroke={project.color ?? 'var(--teal)'} strokeWidth="4" strokeLinecap="round" strokeDasharray={2 * Math.PI * 20} strokeDashoffset={2 * Math.PI * 20 * (1 - pct / 100)} />
                    </svg>
                    <span className="absolute inset-0 flex items-center justify-center text-[11px] font-bold tabular-nums text-slate-100">{pct}%</span>
                  </div>
                ) : null}
                <div className="min-w-0 flex-1">
                  {project.goal ? <p className="line-clamp-2 text-[12px] leading-relaxed text-slate-300">{project.goal}</p> : <p className="text-[12px] text-slate-600">还没写期待结果 · 去管理页补一句</p>}
                </div>
              </div>
              <div className="flex items-center gap-4 px-1 text-[11px] text-slate-400">
                <span>今日投入 <b className="tabular-nums text-slate-200">{todayMin > 0 ? fmtMin(todayMin) : '未动'}</b></span>
                <span>剩余 <b className="tabular-nums text-slate-200">{left} 项</b></span>
                {dirAct ? <span>改动 <b className="tabular-nums text-slate-200">{dirAct.changedFiles} 文件{dirAct.hotspot ? ` · ${dirAct.hotspot}/` : ''}</b></span> : null}
                <span className="ml-auto text-slate-500">{done}/{tasks.length} 完成</span>
              </div>

              {/* 对接摘要：一行看全，编辑去管理页 */}
              <button
                className="flex items-center gap-2 rounded-lg border border-[var(--line)] bg-[var(--surface-2)] px-3 py-2 text-left transition-colors hover:border-[var(--border-active)]"
                onClick={() => setTab('manage')}
                title="去管理页编辑对接线索"
              >
                <span className="text-[10px] uppercase tracking-wider text-slate-500">🔌 对接</span>
                {liveHere ? <span className="text-[10px] font-bold text-[var(--teal-deep)]">● 正在归因{attr?.app ? `：${displayApp(attr.app)}` : ''}</span> : null}
                <span className="min-w-0 flex-1 truncate text-[11px] text-slate-400">
                  {bind && (bind.apps.length + bind.keywords.length + bind.dirs.length) > 0
                    ? `${bind.apps.length ? `应用${bind.apps.length}` : ''}${bind.apps.length && (bind.keywords.length || bind.dirs.length) ? ' · ' : ''}${bind.keywords.length ? `关键词${bind.keywords.length}` : ''}${bind.keywords.length && bind.dirs.length ? ' · ' : ''}${bind.dirs.length ? `目录${bind.dirs.length}` : ''}`
                    : '还没有绑定线索'}
                  {timedApps.length ? ` · 计时归类 ${timedApps.map(displayApp).join('、')}` : ''}
                </span>
                <span className="shrink-0 text-[10px] text-slate-500">编辑 ›</span>
              </button>

              {/* 任务（里程碑并进列表，◆ 前缀区分） */}
              <div>
                <div className="mb-1 flex items-center gap-2">
                  <span className="text-[10px] uppercase tracking-wider text-slate-500">任务 · {left} 待办</span>
                  <input
                    className="ml-auto w-44 rounded border border-[var(--line)] bg-transparent px-2 py-0.5 text-[10.5px] text-slate-300 outline-none placeholder:text-slate-600 focus:border-[var(--border-active)]"
                    placeholder="＋ 新任务，回车添加"
                    value={newTask}
                    onChange={(e) => setNewTask(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && void addTask()}
                  />
                </div>
                {tasks.length === 0 ? <p className="text-[11px] text-slate-600">暂无任务 · 回车加一条，或用下方 AI 拆解</p> : (
                  <div className="flex flex-col gap-0.5">
                    {tasks.map((t) => (
                      <div key={t.id} className="group flex items-center gap-2 rounded-lg px-1.5 py-1 transition-colors hover:bg-[var(--surface-3)]">
                        <button
                          className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-all ${t.status === 'done' ? 'border-neon-green bg-neon-green/20 text-neon-green' : 'border-white/20 text-transparent hover:border-neon-green/50'}`}
                          onClick={() => void setTaskStatus(t, t.status === 'done' ? 'todo' : 'done')}
                        >
                          <Icon name="check" size={10} />
                        </button>
                        {t.isMilestone ? <span className="shrink-0 text-[10px] text-[var(--violet)]" title="里程碑">◆</span> : null}
                        <span className={`min-w-0 flex-1 truncate text-[12px] ${t.status === 'done' ? 'text-slate-500 line-through' : 'text-slate-200'}`}>{t.title}</span>
                        <span className="text-[9.5px] font-bold" style={{ color: STATUS_COLOR[t.status] }}>{STATUS_LABEL[t.status]}</span>
                        {t.status !== 'done' ? (
                          pushedIds.has(t.id) ? (
                            <span className="shrink-0 text-[9.5px] font-bold text-[var(--teal-deep)]" title="已在今日安排中">✓ 已排今日</span>
                          ) : (
                            <button
                              className="hidden shrink-0 rounded-md bg-[var(--surface-3)] px-1.5 py-0.5 text-[9.5px] text-slate-300 group-hover:block"
                              disabled={pushing === t.id}
                              title="写入今日安排（去「计划」页可见）"
                              onClick={() => void pushTaskToToday(t)}
                            >{pushing === t.id ? '…' : '排入今日'}</button>
                          )
                        ) : null}
                        <button className="hidden shrink-0 text-slate-600 hover:text-red-400 group-hover:block" onClick={() => void removeTask(t)}>✕</button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {Object.keys(project.attrs ?? {}).length ? (
                <div className="flex flex-wrap items-center gap-1.5">
                  {(project.attrOrder ?? Object.keys(project.attrs ?? {})).map((k) => (
                    <span key={k} className="rounded-lg border border-[var(--line)] px-2 py-0.5 text-[10.5px]">
                      <span className="text-slate-500">{k}</span> <b className="text-slate-200">{String(project.attrs?.[k] ?? '')}</b>
                    </span>
                  ))}
                </div>
              ) : null}

              {/* 行动区：图标按钮，就地展开 */}
              <div className="flex flex-wrap items-center gap-1.5 border-t border-[var(--line)] pt-2.5">
                <button className="glass-btn !px-2.5 !py-1 !text-[11px]" onClick={() => void exportProgressCard()} title="复制反哺提示词：贴给 Cursor/开发 AI，要进展+下一步计划"><Icon name="send" size={11} /> 反哺提示词</button>
                <button className="glass-btn !px-2.5 !py-1 !text-[11px]" onClick={() => setProgressIn((s) => ({ ...s, open: !s.open, diff: null }))} title="把开发 AI 的回复贴回来：写入进展 + 导入下一步待办"><Icon name="refresh" size={11} /> 粘贴回传</button>
                <button className="glass-btn !px-2.5 !py-1 !text-[11px]" onClick={() => setBreakdown((b) => ({ ...b, open: !b.open }))}><Icon name="sparkles" size={11} /> AI 拆解</button>
                <button className="glass-btn !px-2.5 !py-1 !text-[11px]" onClick={() => void doReview()} disabled={review.loading}><Icon name="chart" size={11} /> {review.loading ? '复盘中…' : 'AI 复盘'}</button>
              </div>

              {progressIn.open ? <ProgressInBox projectId={project.id} state={progressIn} setState={setProgressIn} onApplied={async () => { await reloadTasks(); onSaved() }} onError={setErr} onTip={flash} /> : null}
              {breakdown.open ? (
                <div className="rounded-lg border border-[var(--line)] bg-[var(--surface-2)] p-2">
                  <textarea className="glass-input !py-1 !text-[11px]" rows={2} placeholder="描述今日目的或要优化的方面，AI 会整理成 2～5 条粗目标…" value={breakdown.req} onChange={(e) => setBreakdown((b) => ({ ...b, req: e.target.value }))} />
                  <div className="mt-1.5 flex justify-end gap-1.5">
                    <button className="glass-btn !px-2 !py-1 !text-[10px]" onClick={() => setBreakdown((b) => ({ ...b, open: false }))}>取消</button>
                    <button className="glass-btn primary !px-2 !py-1 !text-[10px]" disabled={breakdown.loading || !breakdown.req.trim()} onClick={() => void doBreakdown()}>{breakdown.loading ? '拆解中…' : '生成任务'}</button>
                  </div>
                </div>
              ) : null}
              {review.text ? <div className="whitespace-pre-wrap rounded-lg border border-[var(--line)] bg-[var(--surface-2)] p-2 text-[11px] leading-relaxed text-slate-300">{review.text}</div> : null}
            </div>
          )}

          {/* ── 管理 ── */}
          {tab === 'manage' && (
            <div className="flex flex-col gap-3">
              <label className="flex flex-col gap-1">
                <span className="text-[10px] uppercase tracking-wider text-slate-500">名称</span>
                <input className={inputCls} value={draft.name} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-[10px] uppercase tracking-wider text-slate-500">期待结果（目标）</span>
                <textarea rows={2} className={`${inputCls} resize-none leading-relaxed`} value={draft.goal ?? ''} onChange={(e) => setDraft((d) => ({ ...d, goal: e.target.value }))} />
              </label>
              <div className="flex gap-3">
                <label className="flex flex-1 flex-col gap-1">
                  <span className="text-[10px] uppercase tracking-wider text-slate-500">上线目标日</span>
                  <input type="date" className={inputCls} value={draft.deadline ?? ''} onChange={(e) => setDraft((d) => ({ ...d, deadline: e.target.value }))} />
                </label>
                <label className="flex w-24 flex-col gap-1">
                  <span className="text-[10px] uppercase tracking-wider text-slate-500">优先级</span>
                  <select className={inputCls} value={draft.priority} onChange={(e) => setDraft((d) => ({ ...d, priority: e.target.value as Project['priority'] }))}>
                    <option value="high">高</option>
                    <option value="medium">中</option>
                    <option value="low">低</option>
                  </select>
                </label>
                <label className="flex w-24 flex-col gap-1">
                  <span className="text-[10px] uppercase tracking-wider text-slate-500">状态</span>
                  <select className={inputCls} value={draft.status} onChange={(e) => setDraft((d) => ({ ...d, status: e.target.value as Project['status'] }))}>
                    <option value="active">进行中</option>
                    <option value="paused">暂停</option>
                    <option value="done">已完成</option>
                    <option value="archived">归档</option>
                  </select>
                </label>
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-[10px] uppercase tracking-wider text-slate-500">工作域（这个项目说什么行话）</span>
                <div className="flex flex-wrap items-center gap-1.5">
                  {PRESET_DOMAINS.map((d) => {
                    const on = draft.domain === d || (!draft.domain && d === defaultDomainOfUserType(userType))
                    const meta = DOMAIN_META[d]
                    return (
                      <button
                        key={d}
                        type="button"
                        title={meta?.desc}
                        className={`rounded-full border px-2 py-0.5 text-[10.5px] transition-colors ${
                          draft.domain === d
                            ? 'border-[var(--teal-border)] bg-[var(--teal-soft)] text-[var(--teal-deep)]'
                            : on && d === defaultDomainOfUserType(userType)
                              ? 'border-[var(--line)] bg-[var(--surface-2)] text-slate-400'
                              : 'border-[var(--line)] bg-[var(--surface-2)] text-slate-400 hover:text-slate-200'
                        }`}
                        onClick={() => setDraft((dd) => ({ ...dd, domain: dd.domain === d ? undefined : d }))}
                      >
                        {meta?.emoji} {meta?.label}
                        {d === defaultDomainOfUserType(userType) && !draft.domain ? '（默认）' : ''}
                      </button>
                    )
                  })}
                  {customDomain || draft.domain && !PRESET_DOMAINS.includes(draft.domain) ? (
                    <span className="rounded-full border border-[var(--line)] bg-[var(--surface-2)] px-2 py-0.5 text-[10.5px] text-slate-300">
                      ✳ {draft.domain && !PRESET_DOMAINS.includes(draft.domain) ? draft.domain : customDomain}
                    </span>
                  ) : null}
                  <input
                    className="w-24 rounded-md border border-[var(--line)] bg-[var(--surface-2)] px-1.5 py-0.5 text-[10.5px] text-slate-200 placeholder:text-slate-600"
                    placeholder="自定义域…"
                    value={customDomain}
                    onChange={(e) => {
                      const v = e.target.value.trim()
                      setCustomDomain(v)
                      setDraft((dd) => ({ ...dd, domain: v || undefined }))
                    }}
                  />
                </div>
                {domainGuess ? (
                  <button
                    type="button"
                    className="self-start text-[10.5px] text-[var(--teal)] hover:underline"
                    onClick={() => {
                      setDraft((dd) => ({ ...dd, domain: domainGuess }))
                      if (PRESET_DOMAINS.includes(domainGuess)) setCustomDomain('')
                    }}
                  >
                    看起来像「{DOMAIN_META[domainGuess]?.label ?? domainGuess}」的活？点一下标上
                  </button>
                ) : null}
                <span className="text-[10px] text-slate-600">
                  当前词汇：{resolveTerm(draft.domain, 'project')} · {resolveTerm(draft.domain, 'step')} · {resolveTerm(draft.domain, 'statusCard')}
                </span>
              </div>
              <button className="glass-btn primary self-end !py-1 text-[11px]" onClick={() => void saveHeader()}>保存信息</button>

              {/* 对接编辑：归属引擎线索（应用/关键词/目录）+ 计时归类 */}
              <div className="rounded-xl border border-[var(--line)] bg-[var(--surface-2)] px-3 py-2.5">
                <div className="mb-1.5 text-[10px] uppercase tracking-wider text-slate-500">🔌 对接（归属引擎按这些线索把干活归到本项目）</div>
                <BindGroup label="应用" kind="apps" items={bind?.apps ?? []} fmt={displayApp} onRemove={removeBindItem} addBind={addBind} setAddBind={setAddBind} onAdd={addBindItem} />
                <BindGroup label="关键词" kind="keywords" items={bind?.keywords ?? []} onRemove={removeBindItem} addBind={addBind} setAddBind={setAddBind} onAdd={addBindItem} />
                <BindGroup label="目录" kind="dirs" items={bind?.dirs ?? []} onRemove={removeBindItem} addBind={addBind} setAddBind={setAddBind} onAdd={addBindItem} mono />
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5 border-t border-dashed border-[var(--line)] pt-1.5">
                  <span className="w-12 shrink-0 text-[10px] text-slate-500">计时归类</span>
                  {timedApps.length === 0 && addTimed === null ? <span className="text-[10.5px] text-slate-600">无（该应用当日时长才计入本项目）</span> : null}
                  {timedApps.map((a) => (
                    <span key={a} className="chip !py-0">
                      {displayApp(a)}
                      <button className="ml-1 text-[var(--text-3)] hover:text-red-400" title="取消归类" onClick={() => void unlinkTimedApp(a)}>✕</button>
                    </span>
                  ))}
                  {addTimed !== null ? (
                    <span className="flex items-center gap-1">
                      <input
                        autoFocus
                        list={`tl-apps-${project.id}`}
                        className="w-32 rounded border border-[var(--border-active)] bg-transparent px-1.5 py-0.5 text-[10.5px] text-slate-200 outline-none"
                        placeholder="应用名，如 code / cursor"
                        value={addTimed}
                        onChange={(e) => setAddTimed(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') void linkTimedApp(addTimed); if (e.key === 'Escape') setAddTimed(null) }}
                      />
                      <datalist id={`tl-apps-${project.id}`}>
                        {seenApps.filter((a) => !timedApps.includes(a.toLowerCase().replace(/\.exe$/i, ''))).map((a) => <option key={a} value={a} />)}
                      </datalist>
                      <button className="text-[var(--teal-deep)]" onClick={() => void linkTimedApp(addTimed)}>✓</button>
                    </span>
                  ) : (
                    <button className="rounded border border-dashed border-[var(--line)] px-1.5 py-0 text-[9.5px] text-slate-500 hover:text-slate-200" title="把某应用的今日时长归入本项目" onClick={() => setAddTimed('')}>＋</button>
                  )}
                  {todayMin > 0 ? <span className="text-[10px] text-neon-cyan">今日已计 {fmtMin(todayMin)}</span> : null}
                </div>
              </div>

              <div className="border-t border-[var(--line)] pt-2.5">
                <div className="mb-1.5 text-[10px] uppercase tracking-wider text-slate-500">属性袋（自由维度）</div>
                <div className="flex flex-col gap-1.5">
                  {Object.entries(draft.attrs ?? {}).map(([k, v]) => (
                    <div key={k} className="flex items-center gap-1.5">
                      <span className="w-20 shrink-0 truncate text-[11px] text-slate-500">{k}</span>
                      <input
                        className={inputCls}
                        value={String(v)}
                        onChange={(e) => setDraft((d) => ({ ...d, attrs: { ...(d.attrs ?? {}), [k]: e.target.value } }))}
                      />
                      <button
                        className="shrink-0 text-slate-600 hover:text-red-400"
                        onClick={() => {
                          const attrs = { ...(draft.attrs ?? {}) }
                          delete attrs[k]
                          const order = (draft.attrOrder ?? Object.keys(attrs)).filter((x) => x !== k)
                          setDraft((d) => ({ ...d, attrs, attrOrder: order }))
                        }}
                      >✕</button>
                    </div>
                  ))}
                  <AttrAdd onAdd={(k, v) => setDraft((d) => ({ ...d, attrs: { ...(d.attrs ?? {}), [k]: v } }))} />
                </div>
                <button className="glass-btn primary mt-2 self-end !py-1 text-[11px]" onClick={() => void saveHeader()}>保存属性</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

/** 绑定组：chips + 删除 + 就地添加 */
function BindGroup({ label, kind, items, fmt, onRemove, addBind, setAddBind, onAdd, mono }: {
  label: string
  kind: 'apps' | 'keywords' | 'dirs'
  items: string[]
  fmt?: (s: string) => string
  onRemove: (kind: 'apps' | 'keywords' | 'dirs', item: string) => void
  addBind: { kind: 'apps' | 'keywords' | 'dirs'; text: string } | null
  setAddBind: (v: { kind: 'apps' | 'keywords' | 'dirs'; text: string } | null) => void
  onAdd: () => void
  mono?: boolean
}) {
  const adding = addBind?.kind === kind
  return (
    <div className="flex flex-wrap items-center gap-1.5 py-0.5">
      <span className="w-12 shrink-0 text-[10px] text-slate-500">{label}</span>
      {items.length === 0 && !adding ? <span className="text-[10.5px] text-slate-600">—</span> : null}
      {items.map((x) => (
        <span key={x} className={`chip !py-0 ${mono ? 'font-mono !text-[9.5px]' : ''}`} title={x}>
          {fmt ? fmt(x) : x}
          <button className="ml-1 text-[var(--text-3)] hover:text-red-400" title="移除线索" onClick={() => onRemove(kind, x)}>✕</button>
        </span>
      ))}
      {adding ? (
        <span className="flex items-center gap-1">
          <input
            autoFocus
            className={`w-32 rounded border border-[var(--border-active)] bg-transparent px-1.5 py-0.5 text-[10.5px] text-slate-200 outline-none ${mono ? 'font-mono' : ''}`}
            placeholder={kind === 'dirs' ? '路径片段，如 D:\\proj' : kind === 'apps' ? '应用名，如 cursor' : '标题关键词'}
            value={addBind.text}
            onChange={(e) => setAddBind({ kind, text: e.target.value })}
            onKeyDown={(e) => { if (e.key === 'Enter') onAdd(); if (e.key === 'Escape') setAddBind(null) }}
          />
          <button className="text-[var(--teal-deep)]" onClick={onAdd}>✓</button>
        </span>
      ) : (
        <button className="rounded border border-dashed border-[var(--line)] px-1.5 py-0 text-[9.5px] text-slate-500 hover:text-slate-200" onClick={() => setAddBind({ kind, text: '' })}>＋</button>
      )}
    </div>
  )
}

type ProgressDiff = {
  completed: string[]
  added: string[]
  completedTasks: string[]
  addedTasks: string[]
  deferred: string[]
  progressNote: string
  summary?: string
}

/** 粘贴回传：贴开发 AI 回复 → AI 整理 → 应用 diff */
function ProgressInBox({ projectId, state, setState, onApplied, onError, onTip }: {
  projectId: string
  state: { open: boolean; text: string; loading: boolean; diff: ProgressDiff | null }
  setState: (fn: (s: { open: boolean; text: string; loading: boolean; diff: ProgressDiff | null }) => { open: boolean; text: string; loading: boolean; diff: ProgressDiff | null }) => void
  onApplied: () => Promise<void>
  onError: (e: string) => void
  onTip: (t: string) => void
}) {
  const summarize = async (): Promise<void> => {
    if (!state.text.trim()) return
    setState((s) => ({ ...s, loading: true }))
    try {
      const api = window.api as { summarizeStatusCard?: (pid: string, text: string) => Promise<ProgressDiff> }
      const diff = await api.summarizeStatusCard?.(projectId, state.text)
      setState((s) => ({
        ...s, loading: false,
        diff: {
          completed: diff?.completed ?? [], added: diff?.added ?? [], completedTasks: diff?.completedTasks ?? [],
          addedTasks: diff?.addedTasks ?? [], deferred: diff?.deferred ?? [], progressNote: diff?.progressNote ?? '', summary: diff?.summary
        }
      }))
    } catch (e) { onError(`整理失败：${(e as Error).message || ''}`); setState((s) => ({ ...s, loading: false })) }
  }
  const apply = async (): Promise<void> => {
    if (!state.diff) return
    try {
      const r = (await window.api.applyCardDiff({ ...state.diff, projectId })) as { completed?: number; added?: number; completedTasks?: number; addedTasks?: number; deferred?: number; progressUpdated?: boolean }
      onTip(`已更新：待办完成 ${r.completed ?? 0} · 新增 ${r.added ?? 0} · 未实现 ${r.deferred ?? 0} · 任务完成 ${r.completedTasks ?? 0} · 新任务 ${r.addedTasks ?? 0}${r.progressUpdated ? ' · 进展已写入' : ''}`)
      setState(() => ({ open: false, text: '', loading: false, diff: null }))
      await onApplied()
    } catch (e) { onError(`应用失败：${(e as Error).message || ''}`) }
  }
  return (
    <div className="rounded-lg border border-[var(--line)] bg-[var(--surface-2)] p-2">
      <div className="mb-1 text-[10px] text-slate-500">贴回开发 AI 回复 → 写入进展与未实现，并把「今日粗目标」导入待办</div>
      <textarea
        className="glass-input !py-1 !text-[11px]"
        rows={4}
        placeholder="把开发工具补完后的内容贴在这里…"
        value={state.text}
        onChange={(e) => setState((s) => ({ ...s, text: e.target.value, diff: null }))}
      />
      {state.diff ? (
        <div className="mt-1.5 space-y-0.5 rounded-md border border-[var(--line)] p-2 text-[11px]">
          {state.diff.summary ? <div className="text-slate-300">摘要：{state.diff.summary}</div> : null}
          {state.diff.progressNote ? <div className="whitespace-pre-wrap text-slate-300">进展：{state.diff.progressNote}</div> : null}
          {state.diff.completed.map((t, i) => <div key={`c${i}`} className="text-[var(--teal-deep)]">☑ 待办完成：{t}</div>)}
          {state.diff.added.map((t, i) => <div key={`a${i}`} className="text-[#fbbf24]">➕ 今日目标：{t}</div>)}
          {state.diff.deferred.map((t, i) => <div key={`d${i}`} className="text-neon-amber/90">⏳ 未实现：{t}</div>)}
          {state.diff.completedTasks.map((t, i) => <div key={`ct${i}`} className="text-[var(--teal-deep)]">☑ 任务完成：{t}</div>)}
          {state.diff.addedTasks.map((t, i) => <div key={`at${i}`} className="text-[#fbbf24]">➕ 新任务：{t}</div>)}
        </div>
      ) : null}
      <div className="mt-1.5 flex justify-end gap-1.5">
        <button className="glass-btn !px-2 !py-1 !text-[10px]" onClick={() => setState(() => ({ open: false, text: '', loading: false, diff: null }))}>取消</button>
        <button className="glass-btn !px-2 !py-1 !text-[10px]" disabled={state.loading || !state.text.trim()} onClick={() => void summarize()}>{state.loading ? '整理中…' : 'AI 整理'}</button>
        <button className="glass-btn primary !px-2 !py-1 !text-[10px]" disabled={!state.diff} onClick={() => void apply()}>应用更新</button>
      </div>
    </div>
  )
}

/** 属性新增行（key/value 一对，＋确认） */
function AttrAdd({ onAdd }: { onAdd: (k: string, v: string) => void }) {
  const [k, setK] = useState('')
  const [v, setV] = useState('')
  const commit = (): void => {
    if (!k.trim()) return
    onAdd(k.trim(), v.trim())
    setK(''); setV('')
  }
  return (
    <div className="flex items-center gap-1.5">
      <input className="w-20 rounded border border-dashed border-[var(--line)] bg-transparent px-1.5 py-0.5 text-[11px] text-slate-300 outline-none" placeholder="字段名" value={k} onChange={(e) => setK(e.target.value)} />
      <span className="text-slate-600">:</span>
      <input className="min-w-0 flex-1 rounded border border-dashed border-[var(--line)] bg-transparent px-1.5 py-0.5 text-[11px] text-slate-300 outline-none" placeholder="值" value={v} onChange={(e) => setV(e.target.value)} />
      <button className="shrink-0 text-slate-500 hover:text-slate-200" onClick={commit}>＋</button>
    </div>
  )
}
