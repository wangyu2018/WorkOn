import { useCallback, useEffect, useMemo, useState } from 'react'
import type { MergedTrail } from '@shared/types'
import { displayApp } from '@shared/appDisplayName'
import { Icon } from './Icon'

interface ReviewSummary {
  pending: number
  pendingMin: number
  reviewed: number
  totalMin: number
}

interface TodayBriefProps {
  /** 打开一分钟校对 */
  onReview: () => void
  /** 外部触发的刷新序号（确认完一条后 +1） */
  refreshKey?: number
}

const fmtMin = (min: number): string => {
  const m = Math.round(min)
  if (m < 60) return `${m} 分钟`
  const h = Math.floor(m / 60)
  const rest = m % 60
  return rest > 0 ? `${h} 小时 ${rest} 分` : `${h} 小时`
}

/**
 * 首屏结论条：先给一句人话结论，再给唯一的行动点（校对）。
 * 这里刻意不放任何图表——数字放多了就不叫结论了。
 */
export function TodayBrief({ onReview, refreshKey = 0 }: TodayBriefProps) {
  const [trail, setTrail] = useState<MergedTrail | null>(null)
  const [summary, setSummary] = useState<ReviewSummary | null>(null)
  const [links, setLinks] = useState<{ app: string; projectId: string }[]>([])
  const [projectNames, setProjectNames] = useState<Record<string, string>>({})

  const load = useCallback(async () => {
    const [t, s, l, projects] = await Promise.all([
      window.api.getTrail() as Promise<MergedTrail | null>,
      window.api.reviewSummary() as Promise<ReviewSummary>,
      window.api.getDayProjectLinks() as Promise<{ app: string; projectId: string }[]>,
      window.api.listProjects() as Promise<{ id: string; name: string }[]>
    ])
    setTrail(t)
    setSummary(s)
    setLinks(l ?? [])
    setProjectNames(Object.fromEntries((projects ?? []).map((p) => [p.id, p.name])))
  }, [])

  useEffect(() => {
    void load()
  }, [load, refreshKey])

  /** 结论：时长 + 主要在做什么（优先说项目，没归类时说应用） */
  const sentence = useMemo(() => {
    const totalMin = trail?.totalMin ?? 0
    if (totalMin < 1) return { main: '今天还没有记录到工作', sub: '保持 WorkOn 在后台运行就会自动记录' }
    const appMin = new Map<string, number>()
    for (const seg of trail?.segments ?? []) {
      if (seg.glance) continue
      const k = (seg.mainApp ?? '').trim().toLowerCase().replace(/\.exe$/i, '')
      if (!k) continue
      appMin.set(k, (appMin.get(k) ?? 0) + seg.durationMin)
    }
    // 已归类的时长按项目汇总，取最大的那个作为「主要在做什么」
    const linkMap = new Map(links.map((x) => [x.app, x.projectId]))
    const projMin = new Map<string, number>()
    let topApp = { name: '', min: 0 }
    for (const [app, min] of appMin) {
      const pid = linkMap.get(app)
      if (pid) projMin.set(pid, (projMin.get(pid) ?? 0) + min)
      if (min > topApp.min) topApp = { name: app, min }
    }
    const topProj = [...projMin.entries()].sort((a, b) => b[1] - a[1])[0]
    const focus = topProj
      ? `主要在「${projectNames[topProj[0]] ?? '项目'}」`
      : topApp.name
        ? `主要在 ${displayApp(topApp.name)}`
        : ''
    return {
      main: `今天 ${fmtMin(totalMin)}${focus ? `，${focus}` : ''}`,
      sub:
        summary && summary.reviewed > 0
          ? `已归类 ${summary.reviewed} 个应用`
          : '还没有做归类，校对一次以后每天自动沿用'
    }
  }, [trail, links, projectNames, summary])

  const pending = summary?.pending ?? 0
  /** 问候随当地时间变化（Today 式：先打招呼，再说今天） */
  const greeting = useMemo(() => {
    const h = new Date().getHours()
    if (h < 6) return '夜深了'
    if (h < 11) return '早上好'
    if (h < 14) return '中午好'
    if (h < 18) return '下午好'
    return '晚上好'
  }, [])

  return (
    <section className="flex flex-col gap-5">
      <div>
        <div className="text-xl text-slate-500">{greeting}</div>
        <h1 className="mt-1 text-3xl font-semibold leading-[1.2] tracking-[-0.02em] text-slate-100">
          {sentence.main}
        </h1>
        <div className="mt-2 text-sm text-slate-500">{sentence.sub}</div>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        {pending > 0 ? (
          <>
            <button className="glass-btn primary" onClick={onReview}>
              校对 {pending} 条记录
            </button>
            <span className="text-xs text-slate-500">共 {fmtMin(summary?.pendingMin ?? 0)}，一分钟能处理完</span>
          </>
        ) : (
          <span className="flex items-center gap-1.5 text-xs text-slate-500">
            <Icon name="check" size={14} />
            今天的时间都已归好类
          </span>
        )}
      </div>
    </section>
  )
}
