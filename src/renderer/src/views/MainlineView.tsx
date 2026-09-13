/**
 * 主线页（v7.1）：长命层——每条线的属性袋/任务/距上线/今日活跃
 * 项目 → 计划 → 实时工作 循环的"项目"端；实时数据由归属引擎自动归因
 */
import { useEffect, useState } from 'react'
import { PageHeader } from '../components/PageHeader'
import { ProjectModal } from '../components/ProjectModal'
import type { MergedTrail, Project, ProjectTask } from '@shared/types'

interface RailNode {
  id: string
  title: string
  done: boolean
  kind: 'ms' | 'task' | 'plan'
}

interface TodayRow {
  project: Project
  todayMin: number
  progress: number | null
  tasksLeft: number
  /** 单轴多节点：里程碑◆ / 任务● / 关联计划○ 混排在同一根轴上 */
  nodes: RailNode[]
  /** 最近一次处理的时刻（今天有活动则=今天最后一次，否则=上次） */
  lastTouch: number | null
  /** 目录活动（今日改动文件数/热点，dirWatcher 信号） */
  dirInfo: { changedFiles: number; hotspot: string } | null
}

const fmtDur = (min: number): string =>
  min >= 60 ? `${Math.floor(min / 60)}h${Math.round(min % 60) ? `${Math.round(min % 60)}m` : ''}` : `${Math.round(min)}m`

export default function MainlineView() {
  const [trail, setTrail] = useState<MergedTrail | null>(null)
  const [attrProjectId, setAttrProjectId] = useState<string | null>(null)
  const [attrTask, setAttrTask] = useState('')
  const [reloadTick, setReloadTick] = useState(0)
  /** 里程碑编辑器 + 项目弹窗 */
  const [msEdit, setMsEdit] = useState<{ pid: string; items: string[]; msIds: string[] } | null>(null)
  const [modalProj, setModalProj] = useState<Project | null>(null)

  useEffect(() => {
    void window.api?.getTrail?.().then((t) => setTrail((t as MergedTrail) ?? null)).catch(() => undefined)
    const t = window.setInterval(() => setReloadTick((n) => n + 1), 60_000)
    return () => window.clearInterval(t)
  }, [])
  useEffect(() => {
    void window.api?.getAttribution?.().then((a) => {
      const r = a as { projectId?: string | null; taskTitle?: string }
      setAttrProjectId(r?.projectId ?? null)
      setAttrTask(r?.taskTitle ?? '')
    }).catch(() => undefined)
  }, [reloadTick])

  // 主线列表直接由 ProjectBoard 渲染（卡片/属性袋/任务/AI 按钮），
  // 这里只算「今日活跃」概览：归属时长 + 正在干
  const [rows, setRows] = useState<TodayRow[]>([])
  useEffect(() => {
    if (!trail) return
    void (async () => {
      const projects = ((await window.api?.listProjects?.()) as Project[]) ?? []
      const rows: TodayRow[] = []
      for (const p of projects.filter((x) => x.status === 'active')) {
        const tasks = ((await window.api?.listProjectTasks?.(p.id)) as ProjectTask[]) ?? []
        const done = tasks.filter((x) => x.status === 'done').length
        // 今日分钟 + 最近处理时刻：与 ProjectBoard 同口径（trail 段 app ∈ 该项目链接应用）
        let min = 0
        let lastTouch: number | null = null
        try {
          const links = (await window.api?.getProjectLinks?.(p.id)) as { app: string }[] | undefined
          const apps = new Set((links ?? []).map((l) => (l.app ?? '').toLowerCase().replace(/\.exe$/i, '')))
          if (apps.size) {
            for (const seg of (trail as MergedTrail).segments ?? []) {
              if (seg.glance) continue
              const k = (seg.mainApp ?? '').trim().toLowerCase().replace(/\.exe$/i, '')
              if (!apps.has(k)) continue
              min += seg.durationMin
              lastTouch = Math.max(lastTouch ?? 0, seg.startTs + seg.durationMin * 60_000)
            }
          }
        } catch { /* ignore */ }
        const plans = ((await window.api?.listPlans?.()) as { id: string; title: string; status: string; projectId?: string }[]) ?? []
        const linkedPlans = plans.filter((x) => x.projectId === p.id)
        const nodes: RailNode[] = [
          ...tasks.map((x) => ({ id: x.id, title: x.title, done: x.status === 'done', ms: !!x.isMilestone, kind: (x.isMilestone ? 'ms' : 'task') as RailNode['kind'] })),
          ...linkedPlans.map((x) => ({ id: x.id, title: x.title, done: x.status === 'done', ms: false, kind: 'plan' as RailNode['kind'] }))
        ]
        let dirInfo: { changedFiles: number; hotspot: string } | null = null
        try {
          const act = (await window.api?.getTodayActivity?.(p.id)) as { changedFiles: number; hotspot: string } | undefined
          if (act && act.changedFiles > 0) dirInfo = act
        } catch { /* ignore */ }
        rows.push({
          project: p,
          todayMin: min,
          progress: tasks.length ? Math.round((done / tasks.length) * 100) : null,
          tasksLeft: tasks.filter((x) => x.status !== 'done').length,
          nodes,
          lastTouch,
          dirInfo
        })
      }
      setRows(rows.sort((a, b) => b.todayMin - a.todayMin))
    })()
  }, [trail])

  return (
    <div className="view-enter flex flex-col gap-4">
      <PageHeader
        icon="folder"
        title="主线"
        desc="长命的事各长各的样 · 实时工作由归属引擎自动归因"
      />

      {/* ── 今日活跃概览：每条主线一条，正在干的排最前 ── */}
      {rows.length ? (
        <div className="flex flex-col gap-2.5">
          {rows.map((r) => {
            const active = attrProjectId === r.project.id
            const dirInfo = r.dirInfo
            const goal = (r.project.goal ?? '').split('\n')[0]
            const nodes = r.nodes.slice(0, 14)
            const lastTouchStr = r.lastTouch
              ? new Date(r.lastTouch).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
              : null
            return (
              <div
                key={r.project.id}
                className={`rounded-xl border px-3.5 py-3 ${active ? 'border-[rgba(15,181,164,0.45)]' : 'border-[var(--line)]'}`}
                style={{ background: active ? 'var(--teal-soft)' : 'var(--surface-2)' }}
              >
                {/* 行1：名称 + 正在干 + 上线刻度 */}
                <div className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-slate-100">{r.project.name}</span>
                  {r.project.status !== 'active' ? (
                    <span className="shrink-0 rounded-full bg-white/5 px-1.5 py-0.5 text-[9px] font-bold text-slate-500">
                      {r.project.status === 'paused' ? '⏸ 暂停' : r.project.status === 'done' ? '✓ 已完成' : '已归档'}
                    </span>
                  ) : null}
                  {r.project.deadline ? (
                    (() => {
                      const days = Math.ceil((new Date(`${r.project.deadline}T23:59:59`).getTime() - Date.now()) / 86400000)
                      return (
                        <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-bold ${days < 0 ? 'bg-[rgba(239,68,68,0.12)] text-[#f87171]' : days <= 7 ? 'bg-[rgba(245,158,11,0.12)] text-[#fbbf24]' : 'bg-[var(--teal-soft)] text-[var(--teal-deep)]'}`}>
                          {days < 0 ? `超期${-days}天` : `↦${days}天上线`}
                        </span>
                      )
                    })()
                  ) : null}
                  {active ? (
                    <span className="shrink-0 text-[10px] font-bold text-[var(--teal-deep)]">● 正在干{attrTask ? `：${attrTask}` : ''}</span>
                  ) : null}
                </div>
                {/* 偏差推演：剩余任务 vs 剩余天数 */}
                {r.progress !== null && r.project.deadline && r.tasksLeft > 0 ? (() => {
                  const days = Math.ceil((new Date(`${r.project.deadline}T23:59:59`).getTime() - Date.now()) / 86400000)
                  if (days < 0) return null
                  const tight = days < r.tasksLeft
                  return (
                    <div className={`mt-1 flex items-center gap-1.5 text-[10.5px] ${tight ? 'text-[#fbbf24]' : 'text-slate-500'}`}>
                      {tight ? '⚠' : '·'} 剩 {r.tasksLeft} 项任务 / {days} 天{tight ? ' —— 节奏偏紧，考虑砍范围或加时段' : ''}
                    </div>
                  )
                })() : null}
                {/* 行2：整行进度轨 + 任务节点 */}
                {nodes.length ? (
                  <div className="mt-2 flex items-center gap-2">
                    <div className="relative h-2 min-w-0 flex-1 rounded-full bg-[var(--surface-3)]">
                      <div
                        className="h-full rounded-full bg-[var(--teal)]"
                        style={{ width: `${r.progress ?? 0}%`, boxShadow: '0 0 8px rgba(15,181,164,0.4)' }}
                      />
                      {nodes.map((nt, i) => (
                        <div key={nt.id} className="group/node absolute top-1/2 -translate-x-1/2 -translate-y-1/2" style={{ left: `${((i + 1) / nodes.length) * 100}%` }}>
                          {/* hover 里程碑卡 */}
                          <div
                            className="pointer-events-none absolute bottom-full left-1/2 z-30 mb-2 hidden w-44 -translate-x-1/2 rounded-xl border border-[var(--line)] p-2.5 text-left group-hover/node:block"
                            style={{ background: 'var(--bg-surface)', boxShadow: 'var(--shadow-lg)' }}
                          >
                            <div className="flex items-center gap-1.5">
                              {nt.kind === 'ms' ? <span className="text-[10px] text-[var(--violet)]">◆</span> : null}
                              <b className="min-w-0 flex-1 truncate text-[11.5px] text-slate-100">{nt.title}</b>
                            </div>
                            <div className="mt-1 flex items-center gap-2 text-[10px] text-slate-500">
                              <span className={nt.done ? 'text-[var(--teal-deep)]' : 'text-slate-400'}>
                                {nt.done ? '✓ 已完成' : nt.kind === 'plan' ? '○ 计划 · 待办' : nt.kind === 'ms' ? '◇ 里程碑 · 待达成' : '○ 任务'}
                              </span>
                              {nt.kind === 'plan' ? <span className="rounded bg-[rgba(245,158,11,0.12)] px-1 text-[9px] font-bold text-[#fbbf24]">计划</span> : null}
                              {nt.kind === 'ms' ? <span className="rounded bg-[var(--teal-soft)] px-1 text-[9px] font-bold text-[var(--teal-deep)]">里程碑</span> : null}
                            </div>
                          </div>
                          <span
                            title={`${nt.title}${nt.done ? ' · 已完成' : ''}`}
                            className={`block cursor-default transition-transform group-hover/node:scale-125 ${
                              nt.kind === 'ms'
                                ? `h-2.5 w-2.5 rotate-45 rounded-[2px] border ${nt.done ? 'border-[var(--violet)] bg-[var(--violet)]' : 'border-[var(--violet)] bg-[var(--bg-surface)]'}`
                                : nt.kind === 'plan'
                                  ? `h-2.5 w-3.5 rounded-full border ${nt.done ? 'border-[#fbbf24] bg-[#fbbf24]' : 'border-[#fbbf24] bg-[var(--bg-surface)]'}`
                                  : `h-2.5 w-2.5 rounded-full border-2 ${nt.done ? 'border-[var(--teal-deep)] bg-[var(--teal)]' : 'border-[var(--line-strong)] bg-[var(--bg-surface)]'}`
                            }`}
                          />
                        </div>
                      ))}
                    </div>
                    <span className="shrink-0 text-[11px] font-bold tabular-nums text-slate-400">{r.progress ?? 0}%</span>
                  </div>
                ) : null}
                {/* 行3：期待结果 + 目录活动 + 上次处理 */}
                <div className="mt-1.5 flex items-center gap-2 text-[10.5px] text-slate-500">
                  {goal ? <span className="min-w-0 flex-1 truncate" title={r.project.goal}>◇ {goal}</span> : <span className="flex-1" />}
                  <span className="shrink-0">
                    {dirInfo
                      ? `📁 今日改动 ${dirInfo.changedFiles} 个文件${dirInfo.hotspot ? ` · 热点 ${dirInfo.hotspot}/` : ''}`
                      : r.todayMin > 0
                        ? `今日 ${fmtDur(r.todayMin)}${lastTouchStr ? ` · 上次处理 ${lastTouchStr}` : ''}`
                        : r.lastTouch
                          ? `上次处理 ${new Date(r.lastTouch).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })}`
                          : '今日未动'}
                  </span>
                </div>
                {/* 里程碑 chips + 编辑入口 */}
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  <span className="text-[10px] uppercase tracking-wider text-slate-600">◆ 里程碑</span>
                  {r.nodes.filter((x) => x.kind === 'ms').map((x) => (
                    <span key={x.id} className={`rounded px-1.5 py-0.5 text-[9.5px] font-bold ${x.done ? 'bg-[var(--teal-soft)] text-[var(--teal-deep)]' : 'bg-[rgba(139,92,246,0.12)] text-[var(--violet)]'}`}>{x.title}</span>
                  ))}
                  <button
                    className="ml-auto rounded-full border border-dashed px-2 py-0.5 text-[10px] text-slate-500 hover:text-slate-200"
                    onClick={() => setMsEdit({ pid: r.project.id, items: r.nodes.filter((x) => x.kind === 'ms').map((x) => x.title), msIds: r.nodes.filter((x) => x.kind === 'ms').map((x) => x.id) })}
                  >
                    编辑 / ✦ AI
                  </button>
                </div>
                {/* 查看/管理 */}
                <div className="mt-1.5 flex gap-1.5">
                  <button
                    className="glass-btn !px-2 !py-0.5 !text-[10px]"
                    onClick={() => setModalProj(r.project)}
                  >👁 查看详情</button>
                  <button
                    className="glass-btn !px-2 !py-0.5 !text-[10px]"
                    onClick={() => setModalProj(r.project)}
                  >⚙ 管理</button>
                </div>
                {msEdit?.pid === r.project.id ? (
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
                    </div>
                    <div className="mt-1.5 flex justify-end gap-1.5">
                      <button className="glass-btn !px-2 !py-0.5 !text-[10px]" onClick={() => setMsEdit(null)}>取消</button>
                      <button
                        className="glass-btn primary !px-2 !py-0.5 !text-[10px]"
                        onClick={() => {
                          void (async () => {
                            for (const id of msEdit.msIds) await window.api.removeProjectTask?.(id)
                            for (const title of msEdit.items.filter((x) => x.trim())) {
                              await window.api.saveProjectTask({ projectId: r.project.id, title: title.slice(0, 80), status: 'todo', priority: 'high', isMilestone: true })
                            }
                            setMsEdit(null)
                            setReloadTick((n) => n + 1)
                          })()
                        }}
                      >确认保存</button>
                    </div>
                  </div>
                ) : null}
              </div>
            )
          })}
        </div>
      ) : (
        <div className="rounded-xl border border-dashed border-[var(--line)] px-4 py-3 text-[12px] text-slate-500">
          还没有活跃主线 · 去计划页创建，或等归属引擎问你在干啥时现场建一条
        </div>
      )}

      {modalProj ? (
        <ProjectModal project={modalProj} onClose={() => setModalProj(null)} onSaved={() => setReloadTick((n) => n + 1)} />
      ) : null}
    </div>
  )
}
