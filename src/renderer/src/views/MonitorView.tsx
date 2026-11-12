import { memo, useCallback, useEffect, useMemo, useState } from 'react'
import type { ComponentProps, ReactNode } from 'react'
import type { AttentionScore, MergedTrail, PlanForecast, PlanVsActual, WorkState } from '@shared/types'
import { MOOD_SLACK_STATES, WORK_LIKE_STATES, WORK_STATES } from '@shared/stateMeta'
import { usePresenceStore } from '../stores/presenceStore'
import { useAppStore } from '../stores/appStore'
import { useSettingsStore } from '../stores/settingsStore'
import { EmptyState } from '../components/EmptyState'
import { AttentionDailyCard } from '../components/AttentionCard'
import { Icon } from '../components/Icon'
import { PageHeader } from '../components/PageHeader'
import { InsightCard } from '../components/ui/InsightCard'
import { clockOf, fmtMin, minutesOfDay } from '../components/utils'
import { attentionGrade, focusAdvice, focusScoreLine } from '@shared/focusMeta'
import { displayApp } from '@shared/appDisplayName'
import { CATEGORY_META, categoryOf } from '@shared/appCategory'

/** 状态分组（状态分布堆叠彩条口径）：工作 teal 渐变 / AI 协作 indigo→violet / 学习 cyan / 摸鱼 amber / 离开 surface */
const STATE_GROUPS: { key: string; label: string; fill: string; dot: string; states: WorkState[] }[] = [
  { key: 'work', label: '工作', fill: 'linear-gradient(90deg, var(--teal), var(--teal-border))', dot: 'var(--teal)', states: ['focus', 'coding', 'meeting', 'remote'] },
  { key: 'ai', label: 'AI 协作', fill: 'linear-gradient(90deg, #6366f1, #8b5cf6)', dot: '#8b5cf6', states: ['aidev', 'aiqa'] },
  { key: 'study', label: '学习', fill: 'linear-gradient(90deg, #06b6d4, #67e8f9)', dot: '#06b6d4', states: ['writing'] },
  { key: 'slack', label: '摸鱼', fill: 'linear-gradient(90deg, #f59e0b, #fbbf24)', dot: '#f59e0b', states: ['slack', 'relax', 'break', 'lunch'] },
  { key: 'away', label: '离开', fill: 'var(--surface-3)', dot: '#64748b', states: ['idle', 'away', 'other'] }
]

/** 应用 TOP 榜权重色：前三名 teal / violet / cyan 渐变 */
const RANK_BARS = [
  'linear-gradient(90deg, var(--teal), var(--teal-border))',
  'linear-gradient(90deg, #8b5cf6, #c4b5fd)',
  'linear-gradient(90deg, #06b6d4, #67e8f9)'
]

/** v6 当前状态大圆环：SVG linearGradient 渐变描边（teal→cyan / 按评级色），中心大数字 */
function GradientRing({
  value,
  size = 150,
  stroke = 12,
  stops,
  children
}: {
  value: number
  size?: number
  stroke?: number
  stops: [string, string]
  children?: ReactNode
}) {
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const pct = Math.max(0, Math.min(100, value))
  return (
    <div className="relative inline-flex shrink-0 items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <defs>
          <linearGradient id="monitorRingGrad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor={stops[0]} />
            <stop offset="100%" stopColor={stops[1]} />
          </linearGradient>
        </defs>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="url(#monitorRingGrad)"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - pct / 100)}
          style={{
            transition: 'stroke-dashoffset 600ms var(--ease-soft)',
            filter: `drop-shadow(0 0 7px ${stops[0]}66)`
          }}
        />
      </svg>
      {children ? <div className="absolute inset-0 flex flex-col items-center justify-center">{children}</div> : null}
    </div>
  )
}

/** 一行式时间轴摘要条：当日状态分布色条（不可缩放/平移）+ 计划预测三色叠加，点击跳转日历日视图 */
function MiniTrailBar({ trail, plans, forecasts }: { trail: MergedTrail; plans: PlanVsActual | null; forecasts?: Map<string, PlanForecast> }) {
  const setView = useAppStore((s) => s.setView)
  const nowMin = minutesOfDay(Date.now())
  const topStates = (Object.entries(trail.stateMinutes) as [WorkState, number][])
    .filter(([, v]) => v > 0.5)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
  const legendStates = (Object.entries(trail.stateMinutes) as [WorkState, number][])
    .filter(([, v]) => v > 0.5)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
  const summary = topStates.map(([st, min]) => `${WORK_STATES[st].label} ${fmtMin(min)}`).join(' · ')
  const goCalendar = () => setView('calendar')
  return (
    <div>
      <div
        className="relative h-8 w-full cursor-pointer overflow-hidden rounded-lg transition-colors"
        style={{ background: 'var(--surface-2)' }}
        onClick={goCalendar}
        title="点击到日历页查看完整时间轴（可缩放/编辑）"
      >
        {/* 整点参考线 6:00 / 12:00 / 18:00 */}
        {[360, 720, 1080].map((m) => (
          <div key={m} className="absolute bottom-0 top-0 border-l border-white/[0.05]" style={{ left: `${(m / 1440) * 100}%` }} />
        ))}
        {trail.segments.map((seg, i) => {
          const start = minutesOfDay(seg.startTs)
          const end = Math.max(start + 0.5, Math.min(1440, minutesOfDay(seg.endTs)))
          const meta = WORK_STATES[seg.mainState]
          return (
            <div
              key={`${seg.startTs}-${i}`}
              className="absolute bottom-0 top-0"
              style={{
                left: `${(start / 1440) * 100}%`,
                width: `${((end - start) / 1440) * 100}%`,
                minWidth: 2,
                background: meta.color,
                opacity: seg.glance ? 0.18 : 0.7
              }}
              title={`${meta.emoji} ${meta.label} · ${clockOf(start)}–${clockOf(end)}（${fmtMin(seg.durationMin)}）${seg.glance ? ' · 短切换' : ''}\n主屏：${seg.mainApp}${seg.auxApp ? `\n副屏：${seg.auxApp}` : ''}`}
            />
          )
        })}
        {/* 计划时段虚线标记（顶层；预测三色：绿=可完成 橙=可能延迟 红=高风险/已延期） */}
        {(plans?.items ?? [])
          .filter((it) => it.plan.startMin !== undefined && it.plan.endMin !== undefined && it.plan.endMin > it.plan.startMin)
          .slice(0, 6)
          .map((it) => {
            const fc = forecasts?.get(it.plan.id)
            const prob = fc?.completionProb
            const color =
              it.plan.status === 'delayed'
                ? '#EF4444'
                : prob !== undefined
                  ? prob >= 60
                    ? 'var(--teal)'
                    : prob >= 30
                      ? '#F59E0B'
                      : '#EF4444'
                  : it.matched
                    ? 'var(--teal)'
                    : '#F59E0B'
            return (
              <div
                key={`plan-${it.plan.id}`}
                className="absolute bottom-0.5 top-0.5 z-[5] rounded-sm border border-dashed"
                style={{
                  left: `${(it.plan.startMin! / 1440) * 100}%`,
                  width: `${((it.plan.endMin! - it.plan.startMin!) / 1440) * 100}%`,
                  minWidth: 4,
                  borderColor: color,
                  background: `${color}22`
                }}
                title={`📋 ${it.plan.title}${prob !== undefined ? `\n完成概率 ${prob}%${fc?.estimatedEndMin ? ` · 预计完成 ${clockOf(fc.estimatedEndMin)}` : ''}` : it.matched ? ' · ✓ 已覆盖' : ' · ⚠ 未覆盖'}`}
              />
            )
          })}
        {/* 当前时刻线 */}
        <div
          className="pointer-events-none absolute bottom-0 top-0 w-px"
          style={{ left: `${(nowMin / 1440) * 100}%`, background: 'var(--accent)' }}
        />
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-2.5 gap-y-1">
        <span className="text-2xs text-slate-500">图例</span>
        {legendStates.map(([st, min]) => {
          const m = WORK_STATES[st]
          return (
            <span key={st} className="flex items-center gap-1 text-2xs text-slate-500">
              <span className="inline-block h-1.5 w-1.5 rounded-sm" style={{ background: m.color }} />
              {m.label}
            </span>
          )
        })}
        {(plans?.items ?? []).filter((it) => it.plan.startMin !== undefined && it.plan.endMin !== undefined && it.plan.endMin > it.plan.startMin).length > 0 ? (
          <span className="flex items-center gap-1 text-2xs text-slate-500">
            <span className="inline-block h-1.5 w-1.5 rounded-sm border border-dashed" style={{ borderColor: 'var(--accent)' }} />
            计划
          </span>
        ) : null}
      </div>
      <button className="mt-1 text-xs text-slate-500 hover:text-slate-200" onClick={goCalendar}>
        {summary ? `${summary} ` : ''}→ 查看详情
      </button>
    </div>
  )
}

/** 计划进度行：今日计划 vs 监控实际（融合进今日时间轴卡片，与虚线计划标记对应） */
function PlanProgressRows({ pva }: { pva: PlanVsActual }) {
  const setView = useAppStore((s) => s.setView)

  /** 状态用小圆点表达（不再用 emoji 勾叉方块） */
  const statusDot = (st: string, matched: boolean): string =>
    st === 'done' ? '#10b981' : st === 'cancelled' ? '#9ca3af' : st === 'doing' || matched ? 'var(--accent)' : 'var(--text-3)'

  return (
    <>
      <div className="mb-2 flex items-center gap-2 text-xs text-slate-500">
        <span>今日计划 {pva.items.length} 项 · 达成 {Math.round(pva.achievement)}%</span>
        <span className="text-slate-400">计划 {fmtMin(pva.plannedMin)} / 实际 {fmtMin(pva.actualWorkMin)}</span>
      </div>
      <div className="flex flex-col gap-1">
        {pva.items.map(({ plan, coveredMin, matched }) => {
          const plannedMin = plan.durationMin ?? (plan.endMin !== undefined && plan.startMin !== undefined ? plan.endMin - plan.startMin : 0)
          const pct = plannedMin > 0 ? Math.min(100, Math.round((coveredMin / plannedMin) * 100)) : matched ? 100 : 0
          return (
            <button
              key={plan.id}
              className="flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-xs hover:bg-[var(--surface-3)]"
              onClick={() => setView('plan')}
              title="跳到计划视图"
            >
              <span
                className="h-1.5 w-1.5 shrink-0 rounded-full"
                style={{ background: statusDot(plan.status, matched) }}
              />
              <span className="min-w-0 flex-1 truncate text-slate-200">{plan.title}</span>
              <div className="h-1 w-24 shrink-0 overflow-hidden rounded-full" style={{ background: 'var(--surface-3)' }}>
                <div className="h-full rounded-full" style={{ width: `${pct}%`, background: 'var(--accent)' }} />
              </div>
              <span className="w-24 shrink-0 text-right tabular-nums text-slate-500">
                {fmtMin(coveredMin)} / {plannedMin > 0 ? fmtMin(plannedMin) : '—'}
              </span>
            </button>
          )
        })}
      </div>
    </>
  )
}

/** 区块标题（v6 视觉对齐）：teal 芯片图标 + 标题 */
function SectionTitle({ icon, children, className = 'mb-3' }: { icon: ComponentProps<typeof Icon>['name']; children: ReactNode; className?: string }) {
  return (
    <h2 className={`flex items-center gap-2 text-base font-semibold text-slate-100 ${className}`}>
      <Icon name={icon} size={15} className="shrink-0 text-slate-500" />
      {children}
    </h2>
  )
}

/** 监控可拆分的小组件（首页编辑可单独开关） */
export type MonitorSectionKey =
  | 'presence'
  | 'overview'
  | 'attention'
  | 'dist'
  | 'screens'
  | 'topApps'
  | 'trail'

export const MONITOR_SECTION_META: {
  key: MonitorSectionKey
  label: string
  desc: string
  size: '整行' | '半宽'
}[] = [
  { key: 'presence', label: '实时状态', desc: '专注度圆环 · 当前状态与各屏', size: '整行' },
  { key: 'overview', label: '今日概览', desc: '总时长 / 工作 / 摸鱼 / 计划达成', size: '整行' },
  { key: 'attention', label: '评分图谱', desc: '今日注意力评分与昨日对比', size: '整行' },
  { key: 'dist', label: '状态分布', desc: '工作/AI/学习/摸鱼堆叠占比', size: '半宽' },
  { key: 'screens', label: '双屏并行', desc: '多屏并行占比与焦点屏', size: '半宽' },
  { key: 'topApps', label: '应用 TOP', desc: '前台应用时长排行', size: '半宽' },
  { key: 'trail', label: '监控时间轴', desc: '今日状态色条摘要 · 计划进度', size: '整行' }
]

export const DEFAULT_MONITOR_SECTIONS: Record<MonitorSectionKey, boolean> = {
  presence: true,
  overview: true,
  attention: true,
  dist: true,
  screens: true,
  topApps: true,
  trail: true
}

function resolveSections(
  partial?: Partial<Record<MonitorSectionKey, boolean>>
): Record<MonitorSectionKey, boolean> {
  return { ...DEFAULT_MONITOR_SECTIONS, ...partial }
}

export default function MonitorView({
  embedded = false,
  sections: sectionsProp,
  sectionOrder
}: {
  embedded?: boolean
  /** 嵌入首页时传入；不传则全部显示（独立监控页） */
  sections?: Partial<Record<MonitorSectionKey, boolean>>
  /** 区块渲染顺序（首页拖拽排序） */
  sectionOrder?: MonitorSectionKey[]
} = {}) {
  const sections = resolveSections(embedded ? sectionsProp : undefined)
  const orderKeys: MonitorSectionKey[] = (sectionOrder?.length
    ? sectionOrder
    : MONITOR_SECTION_META.map((m) => m.key)
  ).filter((k) => sections[k])
  const [trail, setTrail] = useState<MergedTrail | null>(null)
  const [pva, setPva] = useState<PlanVsActual | null>(null)
  const [forecasts, setForecasts] = useState<Map<string, PlanForecast>>(new Map())
  const [loaded, setLoaded] = useState(false)
  /** 状态分布：展开的分组 key（点击图例行下钻） */
  const [expandedGroup, setExpandedGroup] = useState<string | null>(null)
  /** 注意力评分：todayAttention + rangeAttention(8)（昨日对比用），与报表日报同一口径 */
  const [attention, setAttention] = useState<{ today: AttentionScore; history: AttentionScore[] } | null>(null)
  const [attentionLoaded, setAttentionLoaded] = useState(false)
  const presence = usePresenceStore((s) => s.presence)
  const forecastEnabled = useSettingsStore((s) => s.settings.planForecastEnabled)

  const load = useCallback(async () => {
    try {
      const t = (await window.api.getTrail()) as MergedTrail
      setTrail(t)
    } catch {
      /* 忽略，保持旧数据 */
    } finally {
      setLoaded(true)
    }
  }, [])

  // 计划 vs 实际 + 完成预测（时间轴虚线标记/计划进度行用；设置可关预测）
  const loadPlanData = useCallback(async () => {
    try {
      const r = (await window.api.planVsActual()) as PlanVsActual
      setPva(r)
    } catch {
      /* 保持旧数据 */
    }
    if (!forecastEnabled) {
        setForecasts(new Map())
        return
      }
    try {
      const list = (await window.api.getForecast()) as PlanForecast[]
      const m = new Map<string, PlanForecast>()
      for (const f of list ?? []) m.set(f.planId, f)
      setForecasts(m)
    } catch {
      /* 保持旧数据 */
    }
  }, [forecastEnabled])

  useEffect(() => {
    void load()
    void loadPlanData()
    const timer = window.setInterval(() => {
      void load()
      void loadPlanData()
    }, 60000)
    return () => window.clearInterval(timer)
  }, [load, loadPlanData])

  // 计划页/问答确认改动计划后即时刷新（否则时间轴标记与进度行长期过期）
  useEffect(() => window.api.onPlanUpdated(() => void loadPlanData()), [loadPlanData])

  // 今日注意力评分（工作台「评分图谱」区块用；失败仅标记加载完成，不阻塞页面）
  useEffect(() => {
    Promise.all([window.api.todayAttention(), window.api.rangeAttention(8)])
      .then(([a, h]) => setAttention({ today: a as AttentionScore, history: h as AttentionScore[] }))
      .catch(() => setAttention(null))
      .finally(() => setAttentionLoaded(true))
  }, [])

  // ── 状态分布：堆叠彩条分组聚合（stateMinutes 按工作/AI 协作/学习/摸鱼/离开归组） ──
  const groupRows = useMemo(() => {
    if (!trail) return []
    return STATE_GROUPS.map((g) => ({
      ...g,
      min: g.states.reduce((s, st) => s + (trail.stateMinutes[st] ?? 0), 0)
    }))
      .filter((g) => g.min > 0.5)
      .sort((a, b) => b.min - a.min)
  }, [trail])
  const groupTotalMin = groupRows.reduce((s, g) => s + g.min, 0)
  const expandedGrp = groupRows.find((g) => g.key === expandedGroup) ?? null
  // 展开分组下钻：组内状态明细 + 组内应用 TOP
  const expandedGrpStates = useMemo(() => {
    if (!trail || !expandedGrp) return []
    return expandedGrp.states
      .map((st) => ({ st, min: trail.stateMinutes[st] ?? 0 }))
      .filter((x) => x.min > 0.5)
      .sort((a, b) => b.min - a.min)
  }, [trail, expandedGrp])
  const expandedGrpApps = useMemo(() => {
    if (!trail || !expandedGrp) return []
    const map = new Map<string, number>()
    for (const seg of trail.segments) {
      if (expandedGrp.states.includes(seg.mainState) && seg.mainApp) {
        map.set(seg.mainApp, (map.get(seg.mainApp) ?? 0) + seg.durationMin)
      }
    }
    return [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6)
  }, [trail, expandedGrp])

  // ── 应用 TOP 榜：按前台应用聚合时长，取前 8 ──
  const topApps = useMemo(() => {
    if (!trail) return []
    const map = new Map<string, number>()
    for (const seg of trail.segments) {
      if (!seg.mainApp) continue
      map.set(seg.mainApp, (map.get(seg.mainApp) ?? 0) + seg.durationMin)
    }
    const total = [...map.values()].reduce((s, v) => s + v, 0) || 1
    return [...map.entries()]
      .filter(([, v]) => v > 0.5)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([app, min]) => ({ app, min, pct: min / total }))
  }, [trail])

  const grade = presence ? attentionGrade(presence.focusLevel) : null
  const scoreLine = presence ? focusScoreLine(presence) : null
  const advice = presence ? focusAdvice(presence) : null
  // 大圆环渐变按评级分档：优 teal→cyan / 中 amber / 差 red
  const ringStops: [string, string] =
    grade && (grade.grade === 'B' || grade.grade === 'C')
      ? ['#f59e0b', '#fbbf24']
      : grade && grade.grade === 'D'
        ? ['#ef4444', '#fb7185']
        : ['var(--teal)', 'var(--teal-border)']
  const stateMeta = presence ? WORK_STATES[presence.state] : null
  // 今日概览：工作/摸鱼时长按 shared/stateMeta 口径从 trail.stateMinutes 聚合
  const overviewWorkMin = trail ? WORK_LIKE_STATES.reduce((s, st) => s + (trail.stateMinutes[st] ?? 0), 0) : 0
  const overviewSlackMin = trail ? MOOD_SLACK_STATES.reduce((s, st) => s + (trail.stateMinutes[st] ?? 0), 0) : 0
  // 昨日评分：history 日期升序，取今日之前最后一条
  const yesterdayScore = attention ? (attention.history.filter((h) => h.date < attention.today.date).pop() ?? null) : null

  const multiScreen = !!(trail && Object.keys(trail.screenMinutes).length > 1)
  const showDist = sections.dist
  const showScreens = sections.screens && multiScreen
  const showTop = sections.topApps
  const anySection = orderKeys.some((k) => {
    if (k === 'screens') return showScreens
    if (k === 'dist') return showDist
    if (k === 'topApps') return showTop
    return sections[k]
  })
  const rankOf = (k: MonitorSectionKey): number => {
    const i = orderKeys.indexOf(k)
    return i < 0 ? 999 : i
  }

  if (embedded && !anySection) return <></>

  return (
    <div className={`${embedded ? '' : 'view-enter '}flex flex-col gap-5`}>
      {/* 独立监控页才显示总标题；首页嵌入时各块自带标题 */}
      {!embedded ? (
        <PageHeader icon="activity" title="实时监控" desc="活动状态 · 今日时间轴 · 应用明细与状态" />
      ) : null}

      {/* 当前实时状态卡：大渐变圆环 + 状态徽章（订阅 onPresence） */}
      {sections.presence ? (
      <section className="glass-card anim-fade-up" style={{ animationDelay: '60ms', order: rankOf('presence') }}>
        {presence && stateMeta ? (
          <div className="flex flex-col gap-4">
            {/* 首行：一句结论（当前在干什么 + 专注度）+ 右侧状态徽章。不再用大圆环占掉半张卡 */}
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <span
                className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium"
                style={{ background: 'var(--surface-3)', color: stateMeta.color }}
                title={`当前状态：${stateMeta.label}（按前台应用/输入实时判定）`}
              >
                <span className="pulse-dot inline-block h-1.5 w-1.5 rounded-full" style={{ background: stateMeta.color }} />
                {stateMeta.label}
              </span>
              <span className="text-base font-semibold text-slate-100">
                {presence.focusLevel}
                <span className="ml-1 text-xs font-normal text-slate-500">/ 100 专注度</span>
              </span>
              {grade ? (
                <span className="text-xs text-slate-500" title={`评级按专注度分档：S≥90 / A≥75 / B≥55 / C≥35 / D<35\n${scoreLine ?? ''}`}>
                  {grade.grade} · {grade.label}
                </span>
              ) : null}
              <span className="text-xs text-slate-500">
                {presence.continuousFocusSec > 60
                  ? `已连续专注 ${fmtMin(presence.continuousFocusSec / 60)}`
                  : presence.continuousSlackSec > 60
                    ? `已休息 ${fmtMin(presence.continuousSlackSec / 60)}`
                    : '刚开始这一段落'}
              </span>
            </div>

            {/* 进度条：一条即可读出强度，替代渐变圆环 */}
            <div className="h-1.5 w-full overflow-hidden rounded-full" style={{ background: 'var(--surface-3)' }}>
              <div
                className="h-full rounded-full transition-[width] duration-500"
                style={{ width: `${Math.max(2, Math.min(100, presence.focusLevel))}%`, background: grade?.color ?? 'var(--accent)' }}
              />
            </div>

            {advice ? <div className="text-xs text-slate-400">{advice}</div> : null}

            {/* 屏幕明细：收起为紧凑行，仅焦点屏高亮 */}
            <div className="grid gap-1.5 sm:grid-cols-2">
              {presence.screens.map((sc) => {
                const m = WORK_STATES[sc.state]
                const isFocus = (sc.active ?? false) || sc.screen === presence.mainScreen
                return (
                  <div
                    key={sc.screen}
                    className="flex items-center gap-2 rounded-lg px-2.5 py-1.5"
                    style={{ background: isFocus ? 'var(--teal-soft)' : 'var(--surface-2)' }}
                  >
                    <span className="text-xs text-slate-500">屏{sc.screen + 1}</span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-xs text-slate-200">{sc.appName || sc.app}</div>
                      <div className="truncate text-2xs text-slate-500">{sc.title}</div>
                    </div>
                    <span className="shrink-0 text-2xs text-slate-500">{m.label}</span>
                    {isFocus ? <span className="chip shrink-0">焦点</span> : null}
                  </div>
                )
              })}
            </div>
          </div>
        ) : presence ? (
          <div className="flex items-center gap-2 py-4 text-slate-500">
            <span className="pulse-dot inline-block h-2 w-2 rounded-full bg-neon-cyan" />
            正在同步状态…
          </div>
        ) : (
          <div className="flex items-center gap-2 py-4 text-slate-500">
            <span className="pulse-dot inline-block h-2 w-2 rounded-full bg-neon-cyan" />
            正在连接监控引擎…
          </div>
        )}
      </section>
      ) : null}

      {/* 今日概览：v6 KPI 洞察卡（总时长 / 工作 / 摸鱼 / 计划达成，数据来自 trail + pva，无新 IPC） */}
      {sections.overview ? (
      <section className={`anim-fade-up flex flex-col gap-3 ${embedded ? 'glass-card !p-4' : ''}`} style={{ animationDelay: '90ms', order: rankOf('overview') }}>
        <SectionTitle icon="chart">今日概览</SectionTitle>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <InsightCard icon={<Icon name="clock" size={14} />} tone="cyan" label="总时长（墙钟）" big={trail ? fmtMin(trail.totalMin) : '—'} />
          <InsightCard
            icon={<Icon name="target" size={14} />}
            tone="teal"
            label="工作时间"
            big={trail ? fmtMin(overviewWorkMin) : '—'}
            spark={attention?.history.map((h) => h.rawSignals.effectiveWorkMin) ?? undefined}
            base="口径：专注/编程/写文档/会议/远程/AI"
          />
          <InsightCard
            icon={<Icon name="zap" size={14} />}
            tone="amber"
            label="摸鱼时间"
            big={trail ? fmtMin(overviewSlackMin) : '—'}
            base="口径：摸鱼 + 放松 + 休息 + 午休"
          />
          <InsightCard
            icon={<Icon name="check" size={14} />}
            tone="teal"
            label="计划达成率"
            big={pva && pva.plannedMin > 0 ? `${Math.round(pva.achievement)}%` : '—'}
            base={pva && pva.plannedMin > 0 ? `计划 ${fmtMin(pva.plannedMin)} / 实际 ${fmtMin(pva.actualWorkMin)}` : '今日暂无计划'}
          />
        </div>
      </section>
      ) : null}

      {/* 今日评分图谱：复用报表日报的注意力评分卡（todayAttention 数据，组件内部自渲染） */}
      {sections.attention ? (
        !attentionLoaded ? (
        <section className="glass-card anim-fade-up" style={{ animationDelay: '120ms', order: rankOf('attention') }}>
          <SectionTitle icon="activity">今日评分图谱</SectionTitle>
          <div className="flex items-center gap-2 py-5 text-xs text-slate-500">
            <span className="pulse-dot inline-block h-1.5 w-1.5 rounded-full bg-neon-cyan" />
            评分计算中…
          </div>
        </section>
      ) : !attention || (attention.today.finalScore === 0 && (trail?.totalMin ?? 0) < 30) ? (
        <section className="glass-card anim-fade-up" style={{ animationDelay: '120ms', order: rankOf('attention') }}>
          <SectionTitle icon="activity">今日评分图谱</SectionTitle>
          <EmptyState title="数据还不够" hint="保持 WorkOn 运行，活动满 30 分钟后会自动生成评分。" />
        </section>
      ) : (
        <div style={{ order: rankOf('attention') }}>
          <AttentionDailyCard score={attention.today} yesterday={yesterdayScore} />
        </div>
      )
      ) : null}

      {/* 状态分布 → 堆叠彩条（v6）：按分组时长占比分段填色，图例行可下钻 */}
        {showDist ? (
        <section
          className="glass-card hoverable anim-fade-up"
          style={{ animationDelay: '120ms', order: rankOf('dist') }}
        >
          <SectionTitle icon="chart">状态分布</SectionTitle>
          {trail ? (
            <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
              <span>{Object.keys(trail.screenMinutes).length} 块屏</span>
              {(Object.entries(trail.screenMinutes) as [string, number][]).map(([scr, min]) => (
                <span key={scr} className="tabular-nums">
                  屏{Number(scr) + 1} · {fmtMin(min)}
                </span>
              ))}
              {trail.dualMin > 0 ? (
                <span className="tabular-nums">并行 {fmtMin(trail.dualMin)}（{Math.round(trail.dualRatio * 100)}%）</span>
              ) : null}
              {trail.dualWorkSlackMin > 0 ? (
                <span className="tabular-nums">工作+摸鱼并行 {fmtMin(trail.dualWorkSlackMin)}</span>
              ) : null}
            </div>
          ) : null}
          {groupRows.length > 0 && groupTotalMin > 0 ? (
            <div>
              {/* 堆叠彩条：一条圆角横条按各分组时长占比分段填色，hover 显示 title */}
              <div className="flex h-2.5 w-full overflow-hidden rounded-full" style={{ background: 'var(--surface-3)' }}>
                {groupRows.map((g) => (
                  <div
                    key={g.key}
                    className="h-full"
                    style={{ width: `${(g.min / groupTotalMin) * 100}%`, minWidth: 3, background: g.fill }}
                    title={`${g.label} · ${fmtMin(g.min)}（${Math.round((g.min / groupTotalMin) * 100)}%）`}
                  />
                ))}
              </div>
              {/* 图例行：色点 + 分组名 + 时长（点击下钻组内状态/应用） */}
              <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5">
                {groupRows.map((g) => {
                  const active = expandedGroup === g.key
                  return (
                    <button
                      key={g.key}
                      className={`flex items-center gap-1.5 rounded-md px-1 py-0.5 text-xs ${active ? 'bg-[var(--surface-3)] text-slate-200' : 'text-slate-400 hover:text-slate-200'}`}
                      onClick={() => setExpandedGroup(active ? null : g.key)}
                      title={`${g.label} · ${fmtMin(g.min)}（点击${active ? '收起' : '查看'}明细）`}
                    >
                      <span className="inline-block h-2 w-2 shrink-0 rounded-full" style={{ background: g.dot }} />
                      {g.label}
                      <span className="tabular-nums text-slate-500">{fmtMin(g.min)}</span>
                    </button>
                  )
                })}
              </div>
              {/* 下钻面板：组内状态明细 + 应用 TOP */}
              {expandedGrp ? (
                <div className="anim-fade-in mt-2 rounded-lg px-3 py-2.5" style={{ background: 'var(--surface-2)' }}>
                  <div className="mb-1.5 text-2xs text-slate-500">{expandedGrp.label} · 状态明细</div>
                  {expandedGrpStates.length > 0 ? (
                    <div className="flex flex-col gap-1">
                      {expandedGrpStates.map(({ st, min }) => {
                        const m = WORK_STATES[st]
                        return (
                          <div key={st} className="flex items-center gap-2 text-xs">
                            <span className="w-20 shrink-0 truncate text-slate-300">{m.label}</span>
                            <div className="h-1.5 flex-1 overflow-hidden rounded-full" style={{ background: 'var(--surface-3)' }}>
                              <div
                                className="h-full rounded-full"
                                style={{ width: `${(min / Math.max(1, expandedGrpStates[0].min)) * 100}%`, background: expandedGrp.dot, opacity: 0.8 }}
                              />
                            </div>
                            <span className="w-12 shrink-0 text-right tabular-nums text-slate-500">{fmtMin(min)}</span>
                          </div>
                        )
                      })}
                    </div>
                  ) : (
                    <div className="text-xs text-slate-500">暂无状态数据</div>
                  )}
                  {expandedGrpApps.length > 0 ? (
                    <div className="mt-2 border-t pt-2" style={{ borderColor: 'var(--line)' }}>
                      <div className="mb-1 text-2xs text-slate-500">应用 TOP</div>
                      <div className="flex flex-wrap gap-1.5">
                        {expandedGrpApps.map(([app, appMin]) => (
                          <span key={app} className="rounded-md px-1.5 py-0.5 text-2xs text-slate-400" style={{ background: 'var(--surface-3)' }} title={app}>
                            {displayApp(app)} <span className="tabular-nums text-slate-500">{fmtMin(appMin)}</span>
                          </span>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : (
            <EmptyState emoji="📊" title="暂无状态数据" hint="采集到活动后，这里会按 工作/AI 协作/学习/摸鱼/离开 分组展示时长占比。" />
          )}
        </section>
        ) : null}

        {/* 双屏并行（仅多屏时展示）：结构保留，视觉对齐（图标徽标 + 当前焦点标识） */}
        {showScreens ? (
          <section className="glass-card hoverable anim-fade-up" style={{ animationDelay: '180ms', order: rankOf('screens') }}>
            <SectionTitle icon="monitor">双屏并行</SectionTitle>
            <div className="flex flex-col gap-3">
              <div className="grid grid-cols-3 gap-3 text-center">
                <div className="rounded-xl border border-white/[0.06] bg-white/[0.03] p-3 transition-colors hover:border-neon-cyan/25">
                  <div className="text-xl font-bold text-neon-cyan">{Math.round(trail!.dualRatio * 100)}%</div>
                  <div className="mt-0.5 text-xs text-slate-500">并行占比</div>
                </div>
                <div className="rounded-xl border border-white/[0.06] bg-white/[0.03] p-3 transition-colors hover:border-neon-cyan/25">
                  <div className="text-xl font-bold text-slate-100">{fmtMin(trail!.dualMin)}</div>
                  <div className="mt-0.5 text-xs text-slate-500">并行时长</div>
                </div>
                <div className="rounded-xl border border-white/[0.06] bg-white/[0.03] p-3 transition-colors hover:border-neon-cyan/25">
                  <div className="text-xl font-bold text-neon-pink">{fmtMin(trail!.dualWorkSlackMin)}</div>
                  <div className="mt-0.5 text-xs text-slate-500">工作+摸鱼并行</div>
                </div>
              </div>
              <div className="flex flex-col gap-1.5">
                {(Object.entries(trail!.screenMinutes) as [string, number][]).map(([scr, min]) => {
                  const idx = Number(scr)
                  const isFocus = presence?.mainScreen === idx
                  return (
                    <div key={scr} className="flex items-center gap-2 text-xs">
                      <span
                        className="flex h-6 w-11 shrink-0 items-center justify-center gap-1 rounded-md border text-2xs font-bold"
                        style={
                          isFocus
                            ? { borderColor: 'var(--teal-border)', background: 'var(--teal-soft)', color: 'var(--teal)' }
                            : { borderColor: 'rgba(255,255,255,0.07)', background: 'rgba(255,255,255,0.03)', color: '#94a3b8' }
                        }
                        title={`屏 ${idx + 1}${isFocus ? ' · 当前焦点屏' : ''}`}
                      >
                        <Icon name="monitor" size={10} /> {idx + 1}
                      </span>
                      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/[0.06]">
                        <div
                          className="h-full rounded-full transition-all"
                          style={{
                            width: `${Math.min(100, (min / Math.max(1, trail!.totalMin)) * 100)}%`,
                            background: isFocus ? 'linear-gradient(90deg, var(--teal), var(--teal-border))' : 'rgba(255,255,255,0.28)',
                            transitionDuration: '300ms'
                          }}
                        />
                      </div>
                      <span className="w-16 shrink-0 text-right tabular-nums text-slate-400">{fmtMin(min)}</span>
                      {isFocus ? (
                        <span className="chip shrink-0 text-2xs text-[var(--teal)]">焦点</span>
                      ) : (
                        <span className="w-[34px] shrink-0" />
                      )}
                    </div>
                  )
                })}
              </div>
              {trail!.auxTopState ? (
                <div className="text-xs text-slate-500">
                  主屏 {WORK_STATES[trail!.mainState].emoji} {WORK_STATES[trail!.mainState].label} · 副屏{' '}
                  {WORK_STATES[trail!.auxTopState].emoji} {WORK_STATES[trail!.auxTopState].label}
                </div>
              ) : null}
            </div>
          </section>
        ) : null}

        {/* 应用 TOP 榜（v6）：应用名 + 时长 + 占比横条（渐变填色，前三名权重色 teal/violet/cyan） */}
        {showTop ? (
        <section className="glass-card hoverable anim-fade-up" style={{ animationDelay: '150ms', order: rankOf('topApps') }}>
          <SectionTitle icon="folder">应用 TOP 榜</SectionTitle>
          <p className="mb-3 text-xs text-slate-500">今日前台应用按时长排名 · 占比横条为该应用占全部应用活动的比例</p>
          {topApps.length > 0 ? (
            <div className="flex flex-col gap-0.5">
              {topApps.map(({ app, min, pct }, i) => {
                const meta = CATEGORY_META[categoryOf(app)]
                const bar = i < 3 ? RANK_BARS[i] : 'linear-gradient(90deg, rgba(255,255,255,0.35), rgba(255,255,255,0.12))'
                return (
                  <div key={app} className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 transition-colors hover:bg-white/[0.04]">
                    <span
                      className={`w-5 shrink-0 text-center text-xs font-extrabold tabular-nums ${
                        i === 0 ? 'text-[var(--teal)]' : i === 1 ? 'text-[var(--violet)]' : i === 2 ? 'text-[var(--cyan)]' : 'text-slate-600'
                      }`}
                    >
                      {i + 1}
                    </span>
                    <span className="w-5 shrink-0 text-center text-xs" title={meta.label}>
                      {meta.emoji}
                    </span>
                    <span className="w-32 shrink-0 truncate text-xs text-slate-200" title={app}>
                      {displayApp(app)}
                    </span>
                    <div className="h-2 flex-1 overflow-hidden rounded-full bg-white/[0.06]">
                      <div
                        className="h-full rounded-full transition-all"
                        style={{ width: `${Math.max(2, pct * 100)}%`, background: bar, transitionDuration: '300ms' }}
                      />
                    </div>
                    <span className="w-14 shrink-0 text-right text-xs tabular-nums text-slate-300">{fmtMin(min)}</span>
                    <span className="w-10 shrink-0 text-right text-xs tabular-nums text-slate-500">{Math.round(pct * 100)}%</span>
                  </div>
                )
              })}
            </div>
          ) : (
            <EmptyState emoji="🏅" title="暂无应用数据" hint="采集到前台活动后，这里会展示应用时长 TOP 榜。" />
          )}
        </section>
        ) : null}

      {/* 今日 24h 时间轴（一行摘要，完整交互在日历页） */}
      {sections.trail ? (
      <section className="glass-card hoverable anim-fade-up" style={{ animationDelay: '240ms', order: rankOf('trail') }}>
        <div className="mb-3 flex items-center justify-between">
          <SectionTitle icon="clock" className="">今日时间轴</SectionTitle>
          <div className="flex items-center gap-3 text-xs text-slate-500">
            {trail ? <span className="chip">墙钟 {fmtMin(trail.totalMin)}</span> : null}
            <button className="ui-icon-btn" onClick={() => void load()} title="刷新" aria-label="刷新">
              <Icon name="refresh" size={14} />
            </button>
          </div>
        </div>
        {trail && trail.segments.length > 0 ? (
          <MiniTrailBar trail={trail} plans={pva} forecasts={forecasts} />
        ) : loaded ? (
          <EmptyState emoji="🕐" title="今天还没有采集到轨迹" hint="保持 WorkOn 运行，前台窗口活动会自动记录在这里。" />
        ) : (
          <div className="py-8 text-center text-slate-500">加载中…</div>
        )}
        {/* 计划进度：今日计划 vs 实际（与时间轴上的虚线计划标记一一对应） */}
        {pva && pva.items.length > 0 ? (
          <div className="mt-3 border-t border-white/[0.05] pt-3">
            <PlanProgressRows pva={pva} />
          </div>
        ) : null}
      </section>
      ) : null}
    </div>
  )
}
