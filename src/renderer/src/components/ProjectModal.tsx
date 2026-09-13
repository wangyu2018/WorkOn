/**
 * 项目详情/管理弹窗（v7.1）：查看 | 管理 两页签
 * 查看=进度+目标+里程碑+属性+任务只读；管理=字段/属性袋/任务增删改
 */
import { useEffect, useState } from 'react'
import type { Project, ProjectTask } from '@shared/types'

type Tab = 'view' | 'manage'

export function ProjectModal({ project, onClose, onSaved }: {
  project: Project
  onClose: () => void
  onSaved: () => void
}) {
  const [tab, setTab] = useState<Tab>('view')
  const [tasks, setTasks] = useState<ProjectTask[]>([])
  const [draft, setDraft] = useState<Project>({ ...project })
  const [newTask, setNewTask] = useState('')

  useEffect(() => {
    void window.api?.listProjectTasks?.(project.id).then((ts) => setTasks((ts as ProjectTask[]) ?? [])).catch(() => undefined)
  }, [project.id])

  const reloadTasks = async (): Promise<void> => {
    const ts = ((await window.api?.listProjectTasks?.(project.id)) as ProjectTask[]) ?? []
    setTasks(ts)
    onSaved()
  }

  const done = tasks.filter((x) => x.status === 'done').length
  const pct = tasks.length ? Math.round((done / tasks.length) * 100) : null
  const days = project.deadline ? Math.ceil((new Date(`${project.deadline}T23:59:59`).getTime() - Date.now()) / 86400000) : null
  const ms = tasks.filter((x) => x.isMilestone)

  const setTaskStatus = async (t: ProjectTask, status: ProjectTask['status']): Promise<void> => {
    await window.api.saveProjectTask({ ...t, status })
    await reloadTasks()
  }
  const removeTask = async (t: ProjectTask): Promise<void> => {
    await window.api.removeProjectTask?.(t.id)
    await reloadTasks()
  }
  const addTask = async (): Promise<void> => {
    if (!newTask.trim()) return
    await window.api.saveProjectTask({ projectId: project.id, title: newTask.trim().slice(0, 80), status: 'todo', priority: 'medium' })
    setNewTask('')
    await reloadTasks()
  }
  const saveHeader = async (): Promise<void> => {
    await window.api.saveProject({ ...draft })
    onSaved()
  }

  const inputCls = 'w-full rounded-lg border border-[var(--line)] bg-[var(--surface-2)] px-2.5 py-1.5 text-[12px] text-slate-200 outline-none focus:border-[var(--border-active)]'

  return (
    <div className="anim-fade-in fixed inset-0 z-[80] flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div
        className="glass-card anim-scale-in flex max-h-[76vh] w-[480px] flex-col overflow-hidden"
        style={{ borderRadius: 'var(--r-xl)', boxShadow: 'var(--shadow-lg)' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* 头 */}
        <div className="flex items-center gap-2 border-b border-[var(--line)] px-4 py-3">
          <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: project.color ?? 'var(--teal)' }} />
          <b className="min-w-0 flex-1 truncate text-[14px] text-slate-100">{draft.name || project.name}</b>
          {days !== null ? (
            <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-bold ${days < 0 ? 'bg-[rgba(239,68,68,0.12)] text-[#f87171]' : days <= 7 ? 'bg-[rgba(245,158,11,0.12)] text-[#fbbf24]' : 'bg-[var(--teal-soft)] text-[var(--teal-deep)]'}`}>
              {days < 0 ? `超期${-days}天` : `↦${days}天上线`}
            </span>
          ) : null}
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
          {/* ── 查看 ── */}
          {tab === 'view' && (
            <div className="flex flex-col gap-3">
              {pct !== null ? (
                <div>
                  <div className="mb-1 flex justify-between text-[10.5px] text-slate-500">
                    <span>任务进度</span><span className="tabular-nums">{done}/{tasks.length} · {pct}%</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-[var(--surface-3)]">
                    <div className="h-full rounded-full bg-[var(--teal)]" style={{ width: `${pct}%`, boxShadow: '0 0 8px rgba(15,181,164,0.4)' }} />
                  </div>
                </div>
              ) : null}
              {project.goal ? (
                <div>
                  <div className="mb-1 text-[10px] uppercase tracking-wider text-slate-500">◇ 期待结果</div>
                  <p className="whitespace-pre-wrap text-[12px] leading-relaxed text-slate-300">{project.goal}</p>
                </div>
              ) : null}
              {ms.length ? (
                <div>
                  <div className="mb-1 text-[10px] uppercase tracking-wider text-slate-500">◆ 里程碑</div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {ms.map((x) => (
                      <span key={x.id} className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${x.status === 'done' ? 'bg-[var(--teal-soft)] text-[var(--teal-deep)]' : 'bg-[rgba(139,92,246,0.12)] text-[var(--violet)]'}`}>◆ {x.title}</span>
                    ))}
                  </div>
                </div>
              ) : null}
              {Object.keys(project.attrs ?? {}).length ? (
                <div>
                  <div className="mb-1 text-[10px] uppercase tracking-wider text-slate-500">属性</div>
                  <div className="flex flex-wrap gap-1.5">
                    {Object.entries(project.attrs ?? {}).map(([k, v]) => (
                      <span key={k} className="rounded-lg border border-[var(--line)] px-2 py-0.5 text-[10.5px]">
                        <span className="text-slate-500">{k}</span> <b className="text-slate-200">{String(v)}</b>
                      </span>
                    ))}
                  </div>
                </div>
              ) : null}
              {tasks.length ? (
                <div>
                  <div className="mb-1 text-[10px] uppercase tracking-wider text-slate-500">任务 · {tasks.length}</div>
                  <div className="flex flex-col gap-0.5">
                    {tasks.map((t) => (
                      <div key={t.id} className="flex items-center gap-2 rounded px-1 py-0.5 text-[11.5px]">
                        <span className={t.status === 'done' ? 'text-[var(--teal-deep)]' : 'text-slate-600'}>{t.status === 'done' ? '☑' : t.isMilestone ? '◆' : '○'}</span>
                        <span className={`min-w-0 flex-1 truncate ${t.status === 'done' ? 'text-slate-500 line-through' : 'text-slate-300'}`}>{t.title}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
              {!project.goal && !tasks.length ? <p className="text-center text-[11.5px] text-slate-600">切到「管理」填写目标与任务</p> : null}
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
                <label className="flex flex-1 flex-col gap-1">
                  <span className="text-[10px] uppercase tracking-wider text-slate-500">优先级</span>
                  <select className={inputCls} value={draft.priority} onChange={(e) => setDraft((d) => ({ ...d, priority: e.target.value as Project['priority'] }))}>
                    <option value="high">高</option>
                    <option value="medium">中</option>
                    <option value="low">低</option>
                  </select>
                </label>
              </div>
              <button className="glass-btn primary self-end !py-1 text-[11px]" onClick={() => void saveHeader()}>保存信息</button>

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

              <div className="border-t border-[var(--line)] pt-2.5">
                <div className="mb-1.5 text-[10px] uppercase tracking-wider text-slate-500">任务管理</div>
                <div className="flex flex-col gap-1">
                  {tasks.map((t) => (
                    <div key={t.id} className="flex items-center gap-2">
                      <select
                        className="rounded border border-[var(--line)] bg-transparent px-1 py-0.5 text-[10px] text-slate-400"
                        value={t.status}
                        onChange={(e) => {
                          void window.api.saveProjectTask({ ...t, status: e.target.value as ProjectTask['status'] }).then(() =>
                            window.api.listProjectTasks?.(project.id).then((ts) => setTasks((ts as ProjectTask[]) ?? []))
                          )
                        }}
                      >
                        <option value="todo">待办</option>
                        <option value="in_progress">进行中</option>
                        <option value="done">完成</option>
                        <option value="blocked">阻塞</option>
                      </select>
                      {t.isMilestone ? <span className="text-[10px] text-[var(--violet)]">◆</span> : null}
                      <span className={`min-w-0 flex-1 truncate text-[11.5px] ${t.status === 'done' ? 'text-slate-500 line-through' : 'text-slate-300'}`}>{t.title}</span>
                      <button className="text-slate-600 hover:text-red-400" onClick={() => void removeTask(t)}>✕</button>
                    </div>
                  ))}
                </div>
                <div className="mt-1.5 flex items-center gap-1.5">
                  <input
                    className={inputCls}
                    placeholder="＋ 新任务标题，回车添加"
                    value={newTask}
                    onChange={(e) => setNewTask(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && void addTask()}
                  />
                </div>
              </div>
            </div>
          )}
        </div>
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
