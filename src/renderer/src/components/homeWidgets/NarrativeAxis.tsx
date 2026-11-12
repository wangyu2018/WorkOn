/**
 * 今天页 · 竖向叙事轴
 *
 * 替代原横向多泳道时间轴（分类泳道 + 应用子泳道 + 拖拽归类）。
 * 规则：把连续的同类活动合并成一段，按时间自上而下叙述；计划以空心节点插入同一根轴。
 */
import { useMemo } from 'react'
import type { MergedTrail, PlanItem } from '@shared/types'
import { CATEGORY_META, categoryOfWithOverride, type AppCategory } from '@shared/appCategory'
import { displayApp } from '@shared/appDisplayName'

interface AxisEntry {
  kind: 'seg' | 'plan'
  startTs: number
  endTs: number
  min: number
  cat?: AppCategory
  apps?: { name: string; min: number }[]
  plan?: PlanItem
}

const MERGE_GAP_MS = 8 * 60000
const MAX_ENTRIES = 30

function hm(ts: number): string {
  const d = new Date(ts)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function fmtMin(min: number): string {
  const total = Math.round(min)
  if (total < 60) return `${total}m`
  const h = Math.floor(total / 60)
  const m = total % 60
  return m > 0 ? `${h}h${m}m` : `${h}h`
}

const PLAN_STATUS_LABEL: Record<PlanItem['status'], string> = {
  planned: '待办',
  in_progress: '进行中',
  partial: '部分完成',
  done: '已完成',
  delayed: '已延期',
  cancelled: '已取消'
}

export function NarrativeAxis({
  trail,
  plans,
  override
}: {
  trail: MergedTrail | null
  plans: PlanItem[]
  override?: Record<string, string>
}) {
  const entries = useMemo<AxisEntry[]>(() => {
    const segs = [...(trail?.segments ?? [])]
      .filter((s) => !s.glance && s.durationMin >= 0.5)
      .sort((a, b) => a.startTs - b.startTs)

    // 连续同类活动合并成叙事段
    const merged: AxisEntry[] = []
    for (const s of segs) {
      const cat = categoryOfWithOverride(s.mainApp, override)
      const last = merged[merged.length - 1]
      const gap = last ? s.startTs - last.endTs : Number.POSITIVE_INFINITY
      if (last && last.kind === 'seg' && last.cat === cat && gap < MERGE_GAP_MS) {
        last.endTs = s.endTs
        last.min += s.durationMin
        const hit = last.apps?.find((a) => a.name === s.mainApp)
        if (hit) hit.min += s.durationMin
        else last.apps?.push({ name: s.mainApp, min: s.durationMin })
      } else {
        merged.push({
          kind: 'seg',
          startTs: s.startTs,
          endTs: s.endTs,
          min: s.durationMin,
          cat,
          apps: [{ name: s.mainApp, min: s.durationMin }]
        })
      }
    }

    // 计划按开始时刻插入同一根轴（无时刻的计划留在计划卡里）
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const planEntries: AxisEntry[] = plans
      .filter((p) => p.startMin != null && p.status !== 'cancelled')
      .map((p) => ({
        kind: 'plan' as const,
        startTs: today.getTime() + (p.startMin as number) * 60000,
        endTs: today.getTime() + ((p.endMin ?? (p.startMin as number) + 30) as number) * 60000,
        min: 0,
        plan: p
      }))

    return [...merged, ...planEntries].sort((a, b) => a.startTs - b.startTs).slice(-MAX_ENTRIES)
  }, [trail, plans, override])

  const totalMin = entries.filter((e) => e.kind === 'seg').reduce((n, e) => n + e.min, 0)
  const segCount = entries.filter((e) => e.kind === 'seg').length
  const hasData = entries.length > 0

  return (
    <section className="glass-card">
      <div className="mb-1 flex items-center gap-2.5">
        <span className="text-base font-semibold text-slate-100">今天</span>
        <span className="text-xs text-slate-500">
          {hasData ? `${segCount} 段 · ${fmtMin(totalMin)}` : '还没有记录'}
        </span>
      </div>

      {!hasData ? (
        <p className="py-3 text-sm text-slate-500">今天还没有可叙述的记录。正常用电脑就行，剩下的我来记。</p>
      ) : (
        <div className="relative mt-3">
          {/* 主轴 */}
          <span
            aria-hidden
            className="pointer-events-none absolute bottom-1 top-1 w-px"
            style={{ left: 56, background: 'var(--line)' }}
          />
          {entries.map((e, i) => {
            if (e.kind === 'plan') {
              const p = e.plan as PlanItem
              const done = p.status === 'done'
              return (
                <div key={`p-${p.id}`} className="relative flex items-start gap-2 py-1.5">
                  <span className="w-[44px] shrink-0 text-right text-[11px] leading-5 tabular-nums text-slate-500">
                    {p.startMin != null ? hm(e.startTs) : ''}
                  </span>
                  <span
                    className="relative z-10 mt-[7px] box-border h-2 w-2 shrink-0 rounded-full border-[1.5px]"
                    style={{ borderColor: done ? 'var(--teal)' : 'var(--line-strong)', background: 'var(--bg-deep)' }}
                  />
                  <div className="min-w-0 flex-1 pl-1">
                    <div className={`truncate text-[13px] ${done ? 'text-slate-500 line-through' : 'text-slate-300'}`}>
                      计划 · {p.title}
                    </div>
                    <div className="text-[11px] text-slate-500">
                      {p.endMin != null ? `${hm(e.startTs)}–${hm(e.endTs)} · ` : ''}
                      {PLAN_STATUS_LABEL[p.status]}
                    </div>
                  </div>
                </div>
              )
            }

            const meta = CATEGORY_META[e.cat ?? 'other']
            const topApps = [...(e.apps ?? [])].sort((a, b) => b.min - a.min).slice(0, 2)
            return (
              <div key={`s-${i}`} className="relative flex items-start gap-2 py-1.5">
                <span className="w-[44px] shrink-0 text-right text-[11px] leading-5 tabular-nums text-slate-500">
                  {hm(e.startTs)}
                </span>
                <span
                  className="relative z-10 mt-[7px] h-2 w-2 shrink-0 rounded-full"
                  style={{ background: meta.color, boxShadow: '0 0 0 3px var(--bg-deep)' }}
                />
                <div className="min-w-0 flex-1 pl-1">
                  <div className="truncate text-[13px] text-slate-200">
                    <span style={{ color: meta.color }}>{meta.label}</span>
                    <span className="text-slate-500"> · {fmtMin(e.min)}</span>
                    <span className="text-slate-500"> · {hm(e.endTs)}</span>
                  </div>
                  {topApps.length > 0 ? (
                    <div className="truncate text-[11px] text-slate-500">
                      {topApps.map((a) => displayApp(a.name)).join(' · ')}
                    </div>
                  ) : null}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}
