import { useCallback, useEffect, useState } from 'react'
import type { AttentionScore, MergedTrail, PlanVsActual, WorkState } from '@shared/types'
import { GRADE_META, gradeOf } from '@shared/attention'
import { WORK_LIKE_STATES, WORK_STATES } from '@shared/stateMeta'
import { AttentionDailyCard, DIM_META, Delta, SectionTitle } from '../components/AttentionCard'
import type { DimKey } from '../components/AttentionCard'
import { ChainCard } from '../components/ChainCard'
import { Icon } from '../components/Icon'
import { EmptyState } from '../components/EmptyState'
import AnalysisView from './AnalysisView'
import SmartReportView from './SmartReportView'
import { useSettingsStore } from '../stores/settingsStore'
import { WEEK_LABELS, addDays, fmtMin, todayKey } from '../components/utils'

type Tab = 'daily' | 'weekly' | 'smart' | 'smartWeekly' | 'ai'

/** 状态分布甜甜圈（纯 SVG） */
function Donut({ data }: { data: { state: WorkState; value: number }[] }) {
  const total = data.reduce((s, d) => s + d.value, 0) || 1
  const R = 52
  const C = 2 * Math.PI * R
  let acc = 0
  return (
    <svg viewBox="0 0 140 140" className="h-36 w-36 -rotate-90 drop-shadow-[0_0_10px_rgba(34,211,238,0.12)]">
      <circle cx="70" cy="70" r={R} fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth="16" />
      {data.map((d) => {
        const frac = d.value / total
        const el = (
          <circle
            key={d.state}
            cx="70"
            cy="70"
            r={R}
            fill="none"
            stroke={WORK_STATES[d.state].color}
            strokeWidth="16"
            strokeDasharray={`${Math.max(0, frac * C - 1)} ${C}`}
            strokeDashoffset={-acc * C}
          />
        )
        acc += frac
        return el
      })}
    </svg>
  )
}

function sumWork(t: MergedTrail | null): number {
  if (!t) return 0
  return WORK_LIKE_STATES.reduce((s, st) => s + (t.stateMinutes[st] ?? 0), 0)
}

/** 加载占位 */
function Loading() {
  return (
    <div className="flex items-center justify-center gap-2 py-10 text-[12px] text-slate-500">
      <span className="pulse-dot inline-block h-1.5 w-1.5 rounded-full bg-neon-cyan" />
      加载中…
    </div>
  )
}

/* ── 注意力评分组件（Radar / AttentionDailyCard / SectionTitle / DIM_META / Delta）已抽至 ../components/AttentionCard ── */

/** 周报卡：本周注意力趋势（周均分 + 近 7 天折线 + 五维周均对比） */
function AttentionWeeklyCard({ scores }: { scores: AttentionScore[] }) {
  // scores：rangeAttention(14) 结果，日期升序；按日期映射到近 7 天柱（缺记录留空）
  const keys = Array.from({ length: 7 }, (_, i) => addDays(todayKey(), i - 6))
  const byDate = new Map(scores.map((s) => [s.date, s]))
  const week = keys.map((k) => byDate.get(k) ?? null)
  const lastWeek = scores.filter((s) => s.date < keys[0])
  const thisWeek = week.filter((s): s is AttentionScore => s !== null)
  if (thisWeek.length === 0) return null

  const mean = (ns: number[]) => ns.reduce((a, b) => a + b, 0) / ns.length
  const weekAvg = Math.round(mean(thisWeek.map((s) => s.finalScore)))
  const lastAvg = lastWeek.length ? Math.round(mean(lastWeek.map((s) => s.finalScore))) : null
  const gm = GRADE_META[gradeOf(weekAvg)]
  const dimMeanOf = (s: AttentionScore) => mean(DIM_META.map((d) => s.dimensions[d.key])) * 10 // 五维 0-100 → 对齐 0-1000
  const dimAvgOf = (list: AttentionScore[], key: DimKey) => (list.length ? Math.round(mean(list.map((s) => s.dimensions[key]))) : null)

  // 折线图几何：viewBox 自适应宽度，Y 轴 0-1000
  const W = 700
  const H = 120
  const PAD_T = 16
  const PAD_B = 18
  const PAD_X = 12
  const x = (i: number) => PAD_X + (i * (W - 2 * PAD_X)) / 6
  const y = (v: number) => PAD_T + (1 - Math.max(0, Math.min(1000, v)) / 1000) * (H - PAD_T - PAD_B)
  const lineOf = (vals: (number | null)[]) => {
    let d = ''
    vals.forEach((v, i) => {
      if (v === null) return
      d += `${d === '' || vals[i - 1] === null ? 'M' : 'L'}${x(i).toFixed(1)},${y(v).toFixed(1)}`
    })
    return d
  }
  const composite = week.map((s) => (s ? s.finalScore : null))
  const dimMean = week.map((s) => (s ? dimMeanOf(s) : null))
  // 只标最高 / 最低的数值标签
  let maxI = -1
  let minI = -1
  composite.forEach((v, i) => {
    if (v === null) return
    if (maxI < 0 || v > (composite[maxI] ?? -1)) maxI = i
    if (minI < 0 || v < (composite[minI] ?? 10000)) minI = i
  })

  return (
    <section className="glass-card hoverable anim-fade-up" style={{ animationDelay: '60ms' }}>
      <SectionTitle icon="activity" title="本周注意力趋势" hint="近 7 天" />
      {/* 顶部：周均分 + 等级 + 环比上周 */}
      <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="text-2xl font-bold leading-tight text-slate-100">{weekAvg}</span>
        <span className="rounded-full px-2 py-0.5 text-[10px] font-semibold" style={{ background: `${gm.color}22`, color: gm.color }}>
          {gradeOf(weekAvg)} · {gm.label}
        </span>
        <span className="text-[10px] text-slate-500">周均分（{thisWeek.length} 天有记录）</span>
        {lastAvg !== null && weekAvg - lastAvg !== 0 ? (
          <span className="flex items-center gap-1 text-[10px] text-slate-500">
            <Delta v={weekAvg - lastAvg} /> vs 上周均值
          </span>
        ) : null}
        <span className="ml-auto flex items-center gap-3 text-[10px] text-slate-500">
          <span className="flex items-center gap-1"><span className="inline-block h-0.5 w-4 rounded bg-neon-cyan" /> 综合分</span>
          <span className="flex items-center gap-1"><span className="inline-block h-0.5 w-4 rounded bg-slate-500" /> 五维均值</span>
        </span>
      </div>
      {/* 中部：近 7 天折线 */}
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full">
        {[0, 500, 1000].map((v) => (
          <line key={v} x1={PAD_X} y1={y(v)} x2={W - PAD_X} y2={y(v)} stroke="rgba(148,163,184,0.12)" strokeWidth="1" strokeDasharray={v === 0 ? '' : '3 4'} />
        ))}
        <path d={lineOf(dimMean)} fill="none" stroke="#64748B" strokeWidth="1.2" strokeDasharray="4 3" />
        <path d={lineOf(composite)} fill="none" stroke="#22D3EE" strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" />
        {composite.map((v, i) =>
          v === null ? null : (
            <g key={i}>
              <circle cx={x(i)} cy={y(v)} r="2.5" fill="#22D3EE" />
              {i === maxI || i === minI ? (
                <text x={x(i)} y={i === maxI ? y(v) - 5 : y(v) + 11} textAnchor="middle" fontSize="9" fill={i === maxI ? '#22D3EE' : '#94A3B8'}>
                  {v}
                </text>
              ) : null}
            </g>
          )
        )}
        {keys.map((k, i) => {
          const dt = new Date(`${k}T00:00:00`)
          return (
            <text key={k} x={x(i)} y={H - 4} textAnchor="middle" fontSize="9" fill={k === todayKey() ? '#22D3EE' : '#64748B'}>
              周{WEEK_LABELS[(dt.getDay() + 6) % 7]}
            </text>
          )
        })}
      </svg>
      {/* 底部：五维周均 vs 上周 */}
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-white/[0.05] pt-3">
        {DIM_META.map((d) => {
          const cur = dimAvgOf(thisWeek, d.key)
          const prev = dimAvgOf(lastWeek, d.key)
          const delta = cur !== null && prev !== null ? cur - prev : null
          return (
            <span key={d.key} className="flex items-center gap-1 text-[10px] text-slate-500">
              {d.label}
              <span className="font-medium text-slate-300">{cur ?? '—'}</span>
              {delta !== null && delta !== 0 ? <Delta v={delta} /> : null}
            </span>
          )
        })}
      </div>
    </section>
  )
}

/* ── 日报 ── */
function DailyReport() {
  const [trail, setTrail] = useState<MergedTrail | null>(null)
  const [pva, setPva] = useState<PlanVsActual | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [expandedState, setExpandedState] = useState<WorkState | null>(null)
  const excludeSlack = useSettingsStore((s) => s.settings.reportExcludeSlack)
  const template = useSettingsStore((s) => s.settings.reportTemplate)
  const patch = useSettingsStore((s) => s.patch)
  const [copied, setCopied] = useState(false)
  /** 注意力评分：todayAttention + rangeAttention(8)（昨日对比 / 周均小字用） */
  const [attention, setAttention] = useState<{ today: AttentionScore; history: AttentionScore[] } | null>(null)
  const [attentionLoaded, setAttentionLoaded] = useState(false)

  const load = useCallback(async () => {
    try {
      const [t, pv] = await Promise.all([window.api.getTrail(), window.api.planVsActual()])
      setTrail(t as MergedTrail)
      setPva(pv as PlanVsActual)
    } catch {
      /* ignore */
    } finally {
      setLoaded(true)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    Promise.all([window.api.todayAttention(), window.api.rangeAttention(8)])
      .then(([a, h]) => setAttention({ today: a as AttentionScore, history: h as AttentionScore[] }))
      .catch(() => setAttention(null))
      .finally(() => setAttentionLoaded(true))
  }, [])

  if (!loaded) return <Loading />
  if (!trail || trail.totalMin <= 0) {
    return <EmptyState emoji="📈" title="今天还没有足够数据" hint="先去工作一会儿，晚报会自动汇总在这里。" />
  }

  const workMin = sumWork(trail)
  const slackMin = trail.stateMinutes.slack ?? 0
  // 昨日评分：history 日期升序，取今日之前最后一条
  const yesterdayScore = attention ? (attention.history.filter((h) => h.date < attention.today.date).pop() ?? null) : null
  // 摸鱼过滤：勾选后 slack 不计入状态分布与 TOP 应用榜，仅底部小字标注
  const dist = (Object.entries(trail.stateMinutes) as [WorkState, number][])
    .filter(([st, v]) => v > 0.5 && (!excludeSlack || st !== 'slack'))
    .sort((a, b) => b[1] - a[1])

  // TOP 应用榜（按主屏应用聚合；排除摸鱼时段）
  const appMap = new Map<string, number>()
  for (const seg of trail.segments) {
    if (!seg.mainApp) continue
    if (excludeSlack && seg.mainState === 'slack') continue
    appMap.set(seg.mainApp, (appMap.get(seg.mainApp) ?? 0) + seg.durationMin)
  }
  const topApps = [...appMap.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6)
  const maxApp = topApps.length ? topApps[0][1] : 1

  // 状态→应用粒度明细
  const stateAppMap = expandedState
    ? (() => {
        const map = new Map<string, number>()
        for (const seg of trail.segments) {
          if (seg.mainState === expandedState && seg.mainApp) {
            map.set(seg.mainApp, (map.get(seg.mainApp) ?? 0) + seg.durationMin)
          }
        }
        return [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6)
      })()
    : []

  /** 复制日报：有模板按模板变量替换，否则默认格式 */
  const copyReport = () => {
    const best = (Object.entries(trail.stateMinutes) as [WorkState, number][])
      .filter(([st]) => WORK_LIKE_STATES.includes(st))
      .reduce((a, b) => a + b[1], 0)
    const vars: Record<string, string> = {
      date: trail.date,
      totalMin: fmtMin(trail.totalMin),
      workMin: fmtMin(workMin),
      slackMin: fmtMin(slackMin),
      focusMin: fmtMin(best),
      topApps: topApps.slice(0, 5).map(([a, m], i) => `${i + 1}. ${a}（${fmtMin(m)}）`).join('\n'),
      bestHours: '',
      achievement: pva && pva.plannedMin > 0 ? `${Math.round(pva.achievement)}%` : '—'
    }
    const text = template.trim()
      ? Object.entries(vars).reduce((t, [k, v]) => t.replaceAll(`{{${k}}}`, v), template)
      : `📊 WorkOn 日报（${vars.date}）\n总时长 ${vars.totalMin} · 工作 ${vars.workMin} · 摸鱼 ${vars.slackMin}${vars.achievement !== '—' ? ` · 计划达成 ${vars.achievement}` : ''}\n\nTOP 应用：\n${vars.topApps}`
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    })
  }

  return (
    <div className="flex flex-col gap-5">
      {/* 工具行：排除摸鱼 + 复制日报 */}
      <div className="flex items-center gap-3">
        <label className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-white/[0.06] bg-white/[0.03] px-2.5 py-1.5 text-[12px] text-slate-400 transition-colors hover:border-white/[0.12] hover:text-slate-300">
          <input
            type="checkbox"
            className="accent-cyan-400"
            checked={excludeSlack}
            onChange={(e) => void patch({ reportExcludeSlack: e.target.checked })}
          />
          排除摸鱼数据
        </label>
        {excludeSlack && slackMin > 0 ? (
          <span className="rounded-full border border-white/[0.08] bg-white/[0.03] px-2 py-0.5 text-[10px] text-slate-500">
            已排除摸鱼 {fmtMin(slackMin)}
          </span>
        ) : null}
        <div className="flex-1" />
        <button className={`glass-btn !px-2.5 !py-1 !text-[11px] ${copied ? 'primary' : ''}`} onClick={copyReport}>
          {copied ? '已复制 ✓' : '📋 复制日报'}
        </button>
      </div>
      {/* 总览 */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="glass-card anim-fade-up text-center">
          <div className="text-[26px] font-extrabold leading-tight tracking-tight text-slate-100">{fmtMin(trail.totalMin)}</div>
          <div className="mt-1 text-[11px] text-slate-500">总时长（墙钟）</div>
          {pva && pva.plannedMin > 0 ? (
            <div className="mt-1.5 inline-block rounded-full bg-neon-cyan/15 px-2 py-0.5 text-[10px] text-neon-cyan">
              计划 {fmtMin(pva.plannedMin)} · 达成 {Math.round(pva.achievement)}%
            </div>
          ) : null}
        </div>
        <div className="glass-card anim-fade-up text-center" style={{ animationDelay: '60ms' }}>
          <div className="text-[26px] font-extrabold leading-tight tracking-tight text-neon-green">{fmtMin(workMin)}</div>
          <div className="mt-1 text-[11px] text-slate-500">工作</div>
        </div>
        <div className="glass-card anim-fade-up text-center" style={{ animationDelay: '120ms' }}>
          <div className="text-[26px] font-extrabold leading-tight tracking-tight text-neon-pink">{fmtMin(slackMin)}</div>
          <div className="mt-1 text-[11px] text-slate-500">摸鱼</div>
        </div>
        <div className="glass-card anim-fade-up text-center" style={{ animationDelay: '180ms' }}>
          <div className="text-[26px] font-extrabold leading-tight tracking-tight text-neon-cyan">{fmtMin(trail.dualMin)}</div>
          <div className="mt-1 text-[11px] text-slate-500">双屏并行（{Math.round(trail.dualRatio * 100)}%）</div>
        </div>
      </div>

      {/* 今日注意力评分：loading 骨架 / 数据不足引导 / 评分卡 */}
      {!attentionLoaded ? (
        <section className="glass-card anim-fade-up" style={{ animationDelay: '60ms' }}>
          <SectionTitle icon="activity" title="今日注意力评分" />
          <div className="flex items-center gap-2 py-5 text-[12px] text-slate-500">
            <span className="pulse-dot inline-block h-1.5 w-1.5 rounded-full bg-neon-cyan" />
            评分计算中…
          </div>
        </section>
      ) : !attention || (attention.today.finalScore === 0 && trail.totalMin < 30) ? (
        <section className="glass-card anim-fade-up" style={{ animationDelay: '60ms' }}>
          <SectionTitle icon="activity" title="今日注意力评分" />
          <p className="py-4 text-center text-[12px] text-slate-500">今天还没有足够的活动数据，先去专注工作一会儿，评分稍后就会出现在这里。</p>
        </section>
      ) : (
        <AttentionDailyCard score={attention.today} yesterday={yesterdayScore} />
      )}

      {/* v2.6.1 作业链路卡片：注意力评分卡之后，随日报日期刷新 */}
      <ChainCard date={trail.date} />

      <div className="grid gap-4 lg:grid-cols-2">
        {/* 状态分布（可展开查看应用明细） */}
        <section className="glass-card hoverable anim-fade-up" style={{ animationDelay: '120ms' }}>
          <SectionTitle icon="chart" title="状态分布" hint="点击行查看应用明细" />
          <div className="flex items-start gap-4">
            <div className="shrink-0">
              <Donut data={dist.map(([state, value]) => ({ state, value }))} />
            </div>
            <div className="flex flex-1 flex-col gap-0.5">
              {dist.slice(0, 8).map(([state, min]) => {
                const m = WORK_STATES[state]
                const expanded = expandedState === state
                return (
                  <div key={state}>
                    <button
                      className={`flex w-full items-center gap-2 rounded-lg px-1.5 py-1 text-left transition-colors hover:bg-white/[0.04] ${
                        expanded ? 'bg-white/[0.05]' : ''
                      }`}
                      onClick={() => setExpandedState(expanded ? null : state)}
                    >
                      <span className={`text-[9px] transition-colors ${expanded ? 'text-neon-cyan' : 'text-slate-600'}`}>{expanded ? '▾' : '▸'}</span>
                      <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: m.color, boxShadow: `0 0 6px ${m.color}66` }} />
                      <span className="w-14 text-[11px] text-slate-300">
                        {m.emoji} {m.label}
                      </span>
                      <span className="flex-1 text-right text-[11px] font-medium text-slate-300">{fmtMin(min)}</span>
                      <span className="w-10 text-right text-[11px] text-slate-500">{Math.round((min / trail.totalMin) * 100)}%</span>
                    </button>
                    {expanded && stateAppMap.length > 0 ? (
                      <div className="anim-fade-in ml-6 mr-1 mt-1 flex flex-col gap-1.5 rounded-lg border border-white/[0.05] bg-white/[0.02] px-2.5 py-2">
                        {stateAppMap.map(([app, appMin]) => {
                          const pct = Math.round((appMin / Math.max(1, min)) * 100)
                          return (
                            <div key={app} className="flex items-center gap-1.5 text-[10px]">
                              <span className="w-24 truncate text-slate-400">{app}</span>
                              <div className="h-1 flex-1 overflow-hidden rounded-full bg-white/[0.06]">
                                <div className="h-full rounded-full" style={{ width: `${pct}%`, background: m.color, opacity: 0.6 }} />
                              </div>
                              <span className="w-10 text-right text-slate-500">{fmtMin(appMin)}</span>
                            </div>
                          )
                        })}
                      </div>
                    ) : null}
                  </div>
                )
              })}
            </div>
          </div>
        </section>

        {/* TOP 应用榜 */}
        <section className="glass-card hoverable anim-fade-up" style={{ animationDelay: '180ms' }}>
          <SectionTitle icon="flame" title="TOP 应用榜" />
          {topApps.length ? (
            <div className="flex flex-col gap-2.5">
              {topApps.map(([app, min], i) => (
                <div key={app} className="flex items-center gap-2 text-[12px]">
                  <span
                    className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-[10px] font-bold ${
                      i === 0 ? 'bg-neon-cyan/20 text-neon-cyan shadow-glow' : 'bg-white/[0.06] text-slate-400'
                    }`}
                  >
                    {i + 1}
                  </span>
                  <span className="w-28 truncate text-slate-300">{app}</span>
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/[0.06]">
                    <div
                      className={`h-full rounded-full ${i === 0 ? 'bg-gradient-to-r from-neon-cyan to-neon-blue' : 'bg-neon-blue/70'}`}
                      style={{ width: `${(min / maxApp) * 100}%` }}
                    />
                  </div>
                  <span className="w-14 shrink-0 text-right text-slate-400">{fmtMin(min)}</span>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState emoji="📱" title="暂无应用数据" />
          )}
        </section>
      </div>
    </div>
  )
}

/* ── 周报：近 7 天 stacked bar（纯 div） ── */
function WeeklyReport() {
  const [days, setDays] = useState<{ key: string; work: number; slack: number; other: number }[]>([])
  const [scores, setScores] = useState<AttentionScore[]>([])
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    const keys = Array.from({ length: 7 }, (_, i) => addDays(todayKey(), i - 6))
    Promise.all([
      Promise.all(keys.map((k) => window.api.getTrail(k).catch(() => null))),
      window.api.rangeAttention(14).catch(() => [] as AttentionScore[])
    ])
      .then(([trails, attn]) => {
        setDays(
          keys.map((key, i) => {
            const t = trails[i] as MergedTrail | null
            const work = sumWork(t)
            const slack = t?.stateMinutes.slack ?? 0
            const total = t?.totalMin ?? 0
            return { key, work, slack, other: Math.max(0, total - work - slack) }
          })
        )
        setScores(attn as AttentionScore[])
        setLoaded(true)
      })
      .catch(() => setLoaded(true))
  }, [])

  if (!loaded) return <Loading />

  const maxTotal = Math.max(1, ...days.map((d) => d.work + d.slack + d.other))
  const today = todayKey()
  const BAR_H = 160

  return (
    <div className="flex flex-col gap-5">
      <div className="glass-card hoverable anim-fade-up">
      <SectionTitle icon="calendar" title="近 7 天逐日概览" />
      <div className="flex items-end justify-around gap-3 px-1">
        {days.map((d) => {
          const dt = new Date(`${d.key}T00:00:00`)
          const total = d.work + d.slack + d.other
          const scale = (v: number) => (v / maxTotal) * BAR_H
          const isToday = d.key === today
          return (
            <div
              key={d.key}
              className="group flex flex-1 cursor-default flex-col items-center gap-1.5 transition-transform hover:-translate-y-0.5"
              title={`工作 ${fmtMin(d.work)} · 摸鱼 ${fmtMin(d.slack)} · 其他 ${fmtMin(d.other)}`}
            >
              <div className={`text-[10px] ${isToday ? 'font-medium text-neon-cyan' : 'text-slate-500'}`}>{total > 0 ? fmtMin(total) : ''}</div>
              <div
                className={`flex w-full max-w-[44px] flex-col-reverse overflow-hidden rounded-lg border border-white/[0.04] transition-shadow group-hover:shadow-[0_0_14px_rgba(34,211,238,0.15)] ${
                  isToday ? 'ring-1 ring-neon-cyan' : ''
                }`}
                style={{ height: BAR_H, background: 'rgba(255,255,255,0.03)' }}
              >
                <div className="w-full bg-neon-green/80 transition-all" style={{ height: scale(d.work), transitionDuration: '250ms' }} />
                <div className="w-full bg-neon-pink/80 transition-all" style={{ height: scale(d.slack), transitionDuration: '250ms' }} />
                <div className="w-full bg-slate-500/60 transition-all" style={{ height: scale(d.other), transitionDuration: '250ms' }} />
              </div>
              <div className={`text-[10px] ${isToday ? 'font-semibold text-neon-cyan' : 'text-slate-500'}`}>
                周{WEEK_LABELS[(dt.getDay() + 6) % 7]}
              </div>
              <div className="text-[9px] text-slate-600">
                {dt.getMonth() + 1}/{dt.getDate()}
              </div>
            </div>
          )
        })}
      </div>
      <div className="mt-4 flex items-center justify-center gap-4 border-t border-white/[0.05] pt-3 text-[10px] text-slate-500">
        <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-neon-green/80" /> 工作</span>
        <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-neon-pink/80" /> 摸鱼</span>
        <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-slate-500/60" /> 其他</span>
      </div>
      </div>
      {/* 本周注意力趋势：无评分记录时不渲染 */}
      {scores.length > 0 ? <AttentionWeeklyCard scores={scores} /> : null}
    </div>
  )
}

/* ── 报表 Hub ── */
export default function ReportHub() {
  const aiEnabled = useSettingsStore((s) => s.settings.aiEnabled)
  const settings = useSettingsStore((s) => s.settings)
  const patch = useSettingsStore((s) => s.patch)
  const [tab, setTab] = useState<Tab>('daily')
  const [showSettings, setShowSettings] = useState(false)
  const TABS: { key: Tab; label: string; icon: 'chart' | 'calendar' | 'sparkles' | 'brain' }[] = [
    { key: 'daily', label: '日报', icon: 'chart' },
    { key: 'weekly', label: '周报', icon: 'calendar' },
    { key: 'smart', label: '智能日报', icon: 'sparkles' },
    { key: 'smartWeekly', label: '智能周报', icon: 'sparkles' },
    ...(aiEnabled ? [{ key: 'ai' as Tab, label: 'AI 洞察', icon: 'brain' as const }] : [])
  ]
  return (
    <div className="view-enter flex flex-col gap-5">
      {/* 页面标题区 */}
      <header className="flex items-center gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-white/[0.08] bg-white/[0.04] text-neon-cyan shadow-glass">
          <Icon name="chart" size={18} />
        </div>
        <div>
          <h1 className="text-[17px] font-bold tracking-wide text-slate-100">报表中心</h1>
          <p className="mt-0.5 text-[11px] text-slate-500">日报、周报与 AI 洞察，一眼看懂你的时间去向</p>
        </div>
      </header>

      <div className="anim-fade-up flex flex-wrap items-center gap-2" style={{ animationDelay: '60ms' }}>
        {TABS.map((t) => (
          <button
            key={t.key}
            className={`glass-btn ${tab === t.key ? 'primary' : ''}`}
            onClick={() => setTab(t.key)}
          >
            <Icon name={t.icon} size={13} /> {t.label}
          </button>
        ))}
        <div className="flex-1" />
        {/* 报表设置（从设置中心迁入：排除摸鱼 / 导出模板） */}
        <button className={`glass-btn ${showSettings ? 'primary' : ''}`} title="报表设置" onClick={() => setShowSettings((v) => !v)}>
          <Icon name="settings" size={13} /> 报表设置
        </button>
      </div>
      {showSettings ? (
        <div className="glass-card anim-fade-in flex flex-col gap-3 !p-4">
          <label className="flex cursor-pointer items-center gap-2 text-[12px] text-slate-300">
            <input
              type="checkbox"
              className="accent-cyan-400"
              checked={settings.reportExcludeSlack}
              onChange={(e) => void patch({ reportExcludeSlack: e.target.checked })}
            />
            排除摸鱼数据（状态分布与 TOP 应用榜不计入，仅底部标注）
          </label>
          <div>
            <div className="mb-1 text-[12px] font-medium text-slate-300">日报导出模板</div>
            <div className="mb-1.5 text-[10px] leading-relaxed text-slate-500">
              变量：<code className="rounded bg-white/[0.05] px-1 py-0.5 text-neon-cyan/80">{'{{date}} {{totalMin}} {{workMin}} {{slackMin}} {{focusMin}} {{topApps}} {{achievement}}'}</code>
              ，留空用默认格式
            </div>
            <textarea
              className="glass-input h-24 w-full resize-y !text-[12px] leading-relaxed"
              placeholder={'📊 日报（{{date}}）\n工作 {{workMin}} · 摸鱼 {{slackMin}} · 达成 {{achievement}}\n\n{{topApps}}'}
              value={settings.reportTemplate}
              onChange={(e) => void patch({ reportTemplate: e.target.value })}
            />
          </div>
        </div>
      ) : null}
      <div key={tab} className="anim-fade-up" style={{ animationDelay: '60ms' }}>
        {tab === 'daily' ? (
          <DailyReport />
        ) : tab === 'weekly' ? (
          <WeeklyReport />
        ) : tab === 'smart' ? (
          <SmartReportView mode="day" />
        ) : tab === 'smartWeekly' ? (
          <SmartReportView mode="week" />
        ) : (
          <AnalysisView />
        )}
      </div>
    </div>
  )
}
