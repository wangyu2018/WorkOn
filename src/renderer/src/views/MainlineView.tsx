/**
 * 主线页（v7.1）：长命层——每条线的属性袋/任务/距上线/今日活跃
 * 项目 → 计划 → 实时工作 循环的"项目"端；实时数据由归属引擎自动归因
 */
import { useEffect, useState } from 'react'
import { PageHeader } from '../components/PageHeader'
import { ProjectBoard } from '../components/ProjectBoard'
import type { MergedTrail, Project, ProjectTask } from '@shared/types'

interface TodayRow {
  project: Project
  todayMin: number
  progress: number | null
  tasksLeft: number
}

const fmtDur = (min: number): string =>
  min >= 60 ? `${Math.floor(min / 60)}h${Math.round(min % 60) ? `${Math.round(min % 60)}m` : ''}` : `${Math.round(min)}m`

export default function MainlineView() {
  const [trail, setTrail] = useState<MergedTrail | null>(null)
  const [attrProjectId, setAttrProjectId] = useState<string | null>(null)
  const [attrTask, setAttrTask] = useState('')
  const [reloadTick, setReloadTick] = useState(0)

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
        // 今日分钟：与 ProjectBoard 同口径（trail 段 app ∈ 该项目链接应用）
        let min = 0
        try {
          const links = (await window.api?.getProjectLinks?.(p.id)) as { app: string }[] | undefined
          const apps = new Set((links ?? []).map((l) => (l.app ?? '').toLowerCase().replace(/\.exe$/i, '')))
          if (apps.size) {
            for (const seg of (trail as MergedTrail).segments ?? []) {
              if (seg.glance) continue
              const k = (seg.mainApp ?? '').trim().toLowerCase().replace(/\.exe$/i, '')
              if (apps.has(k)) min += seg.durationMin
            }
          }
        } catch { /* ignore */ }
        rows.push({
          project: p,
          todayMin: min,
          progress: tasks.length ? Math.round((done / tasks.length) * 100) : null,
          tasksLeft: tasks.filter((x) => x.status !== 'done').length
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
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
          {rows.map((r) => {
            const active = attrProjectId === r.project.id
            return (
              <div
                key={r.project.id}
                className={`rounded-xl border px-3 py-2.5 ${active ? 'border-[rgba(15,181,164,0.45)]' : 'border-[var(--line)]'}`}
                style={{ background: active ? 'var(--teal-soft)' : 'var(--surface-2)' }}
              >
                <div className="flex items-center gap-1.5">
                  <span className="min-w-0 flex-1 truncate text-[12.5px] font-semibold text-slate-100">{r.project.name}</span>
                  {active ? (
                    <span className="shrink-0 text-[10px] font-bold text-[var(--teal-deep)]">● 正在干{attrTask ? `：${attrTask}` : ''}</span>
                  ) : null}
                </div>
                <div className="mt-1 flex items-center gap-2 text-[11px] text-slate-400">
                  <span className="tabular-nums font-semibold text-[var(--teal-deep)]">今日 {fmtDur(r.todayMin)}</span>
                  {r.progress !== null ? <span className="tabular-nums">{r.progress}%</span> : null}
                  {r.tasksLeft > 0 ? <span className="tabular-nums">剩 {r.tasksLeft} 项</span> : null}
                </div>
              </div>
            )
          })}
        </div>
      ) : (
        <div className="rounded-xl border border-dashed border-[var(--line)] px-4 py-3 text-[12px] text-slate-500">
          还没有活跃主线 · 去计划页创建，或等归属引擎问你在干啥时现场建一条
        </div>
      )}

      {/* ── 主线看板（属性袋/任务树/距上线/AI 按钮，全套） ── */}
      <ProjectBoard trail={trail} />
    </div>
  )
}
