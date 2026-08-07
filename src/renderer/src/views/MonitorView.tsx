import { useCallback, useEffect, useState } from 'react'
import type { AttentionScore, CorrectionRule, MergedTrail, PlanForecast, PlanVsActual, WorkState } from '@shared/types'
import { ALL_STATES, SLACK_STATES, WORK_LIKE_STATES, WORK_STATES } from '@shared/stateMeta'
import { genId } from '@shared/types'
import { describeChain, extractChains } from '@shared/chain'
import { usePresenceStore } from '../stores/presenceStore'
import { useAppStore } from '../stores/appStore'
import { useSettingsStore } from '../stores/settingsStore'
import { ProgressRing } from '../components/ProgressRing'
import { StateBadge } from '../components/StateBadge'
import { EmptyState } from '../components/EmptyState'
import { AttentionDailyCard } from '../components/AttentionCard'
import { Icon } from '../components/Icon'
import { Toggle } from '../components/Toggle'
import { clockOf, fmtMin, minutesOfDay } from '../components/utils'
import { attentionGrade, focusAdvice, focusScoreLine } from '@shared/focusMeta'

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
        className="relative h-8 w-full cursor-pointer overflow-hidden rounded-lg border border-white/[0.06] bg-ink-900/60 transition-colors hover:border-neon-cyan/30"
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
                    ? '#10B981'
                    : prob >= 30
                      ? '#F59E0B'
                      : '#EF4444'
                  : it.matched
                    ? '#10B981'
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
          className="pointer-events-none absolute bottom-0 top-0 w-px bg-neon-cyan"
          style={{ left: `${(nowMin / 1440) * 100}%`, boxShadow: '0 0 8px rgba(34,211,238,0.8)' }}
        />
      </div>
      <div className="mt-1.5 flex items-center gap-1">
        <span className="text-[10px] text-slate-600">图例</span>
        {legendStates.map(([st, min]) => {
          const m = WORK_STATES[st]
          return (
            <span key={st} className="flex items-center gap-0.5 text-[10px] text-slate-400">
              <span className="inline-block h-1.5 w-1.5 rounded-sm" style={{ background: m.color }} />
              {m.emoji} {m.label}
            </span>
          )
        })}
        {(plans?.items ?? []).filter((it) => it.plan.startMin !== undefined && it.plan.endMin !== undefined && it.plan.endMin > it.plan.startMin).length > 0 ? (
          <span className="flex items-center gap-0.5 text-[10px] text-slate-400">
            <span className="inline-block h-1.5 w-1.5 rounded-sm border border-dashed border-neon-cyan/60" />
            计划
          </span>
        ) : null}
      </div>
      <button className="mt-0.5 text-[11px] text-slate-500 transition-colors hover:text-neon-cyan" onClick={goCalendar}>
        {summary ? `${summary} ` : ''}→ 查看详情
      </button>
    </div>
  )
}

/** 分类管理：今日应用清单 → 一键生成纠偏规则（工作/个人等状态重分类） */
function ClassifyCard({ trail }: { trail: MergedTrail }) {
  interface Draft {
    screen: number
    state: WorkState | ''
    keyword: string
  }
  const [drafts, setDrafts] = useState<Record<string, Draft>>({})
  const [saved, setSaved] = useState<string | null>(null)
  const [rules, setRules] = useState<CorrectionRule[]>([])

  useEffect(() => {
    window.api
      .listRules()
      .then((r) => setRules((r as CorrectionRule[]) ?? []))
      .catch(() => setRules([]))
  }, [])

  // 按应用聚合：总时长 + 子状态分布（内容覆盖率）
  const apps = new Map<string, { min: number; states: Map<WorkState, number> }>()
  for (const seg of trail.segments) {
    if (!seg.mainApp) continue
    const cur = apps.get(seg.mainApp) ?? { min: 0, states: new Map<WorkState, number>() }
    cur.min += seg.durationMin
    cur.states.set(seg.mainState, (cur.states.get(seg.mainState) ?? 0) + seg.durationMin)
    apps.set(seg.mainApp, cur)
  }
  const rows = [...apps.entries()].sort((a, b) => b[1].min - a[1].min).slice(0, 8)

  const save = async (app: string) => {
    const d = drafts[app] ?? { screen: 0, state: '', keyword: '' }
    if (!d.state) return
    // 去重覆盖：同屏+同应用+同关键词的已有规则直接覆盖，避免重复规则堆叠
    const kw = d.keyword.trim()
    const dup = rules.find(
      (r) =>
        r.screen === d.screen &&
        r.matchApp.toLowerCase() === app.toLowerCase() &&
        r.matchTitleContains.toLowerCase() === kw.toLowerCase()
    )
    if (dup) {
      await window.api.saveRule({ ...dup, setState: d.state as WorkState, enabled: true })
      setSaved(app + '!')
    } else {
      const rule: Partial<CorrectionRule> & { screen: number; matchApp: string; matchTitleContains: string } = {
        screen: d.screen,
        matchApp: app,
        matchTitleContains: kw,
        setState: d.state as WorkState
      }
      await window.api.saveRule(rule)
      setSaved(app)
    }
    window.setTimeout(() => setSaved(null), 1600)
    // 刷新本地规则缓存
    window.api
      .listRules()
      .then((r) => setRules((r as CorrectionRule[]) ?? []))
      .catch(() => undefined)
  }

  if (rows.length === 0) return <EmptyState emoji="🏷️" title="暂无应用数据" hint="采集到活动后，可在这里把应用/标题重分类为工作或个人需求。" />

  return (
    <div className="flex flex-col gap-2">
      <div className="text-[11px] leading-relaxed text-slate-500">
        把应用重新归类（如 Vibecoding → 个人、项目开发 → 编程、刷抖音 → 放松）。规则对之后的记录即时生效，历史不改写；可在「设置 → 纠错规则」管理。
      </div>
      {rows.map(([app, info]) => {
        const d = drafts[app] ?? { screen: 0, state: '', keyword: '' }
        const set = (p: Partial<Draft>) => setDrafts((m) => ({ ...m, [app]: { ...d, ...p } }))
        const stateEntries = [...info.states.entries()].sort((a, b) => b[1] - a[1])
        const topState = stateEntries[0]?.[0]
        const cur = WORK_STATES[topState ?? 'focus']
        return (
          <div key={app} className="rounded-lg border border-white/[0.05] bg-white/[0.03] px-2.5 py-2 text-[12px] transition-colors hover:border-white/[0.1] hover:bg-white/[0.05]">
            <div className="flex flex-wrap items-center gap-2">
              <span className="w-28 truncate font-medium text-slate-200" title={app}>
                {app}
              </span>
              <span className="chip shrink-0" title="当前识别">
                {cur.emoji} {cur.label}
              </span>
              <span className="w-14 shrink-0 text-right text-slate-500">{fmtMin(info.min)}</span>
              <input
                className="glass-input !w-32 !py-1 !text-[11px]"
                placeholder="标题包含（可空）"
                value={d.keyword}
                onChange={(e) => set({ keyword: e.target.value })}
              />
              <select
                className="glass-input !w-28 !py-1 !text-[11px]"
                value={d.state}
                onChange={(e) => set({ state: e.target.value as WorkState | '' })}
              >
                <option value="">改为状态…</option>
                {ALL_STATES.map((s) => (
                  <option key={s} value={s}>
                    {WORK_STATES[s].emoji} {WORK_STATES[s].label}
                  </option>
                ))}
              </select>
              <select
                className="glass-input !w-16 !py-1 !text-[11px]"
                value={d.screen}
                onChange={(e) => set({ screen: Number(e.target.value) })}
              >
                {[0, 1, 2, 3].map((s) => (
                  <option key={s} value={s}>
                    屏{s + 1}
                  </option>
                ))}
              </select>
              <button className="glass-btn primary !px-2 !py-1 !text-[11px]" disabled={!d.state} onClick={() => void save(app)}>
                {saved === app + '!' ? '已覆盖 ✓' : saved === app ? '已生效 ✓' : '设为规则'}
              </button>
            </div>
            {/* 内容覆盖率：子状态分布（IDE/浏览器等混合内容应用） */}
            {stateEntries.length > 1 ? (
              <div className="mt-1.5 flex flex-col gap-1 pl-1">
                {stateEntries.map(([st, min]) => {
                  const m = WORK_STATES[st]
                  const pct = Math.round((min / info.min) * 100)
                  return (
                    <div key={st} className="flex items-center gap-2 text-[10px] text-slate-500">
                      <span className="w-16 shrink-0">
                        {m.emoji} {m.label}
                      </span>
                      <div className="h-1 w-40 overflow-hidden rounded-full bg-white/[0.06]">
                        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: m.color }} />
                      </div>
                      <span>
                        {fmtMin(min)} · {pct}%
                      </span>
                    </div>
                  )
                })}
              </div>
            ) : null}
          </div>
        )
      })}
    </div>
  )
}

/** 计划进度行：今日计划 vs 监控实际（融合进今日时间轴卡片，与虚线计划标记对应） */
function PlanProgressRows({ pva }: { pva: PlanVsActual }) {
  const setView = useAppStore((s) => s.setView)

  const statusIcon = (st: string, matched: boolean) =>
    st === 'done' ? '✅' : st === 'doing' || matched ? '🔄' : st === 'cancelled' ? '🚫' : '⬜'

  return (
    <>
      <div className="mb-2 flex items-center gap-2 text-[11px] text-slate-500">
        <span>📋 今日计划 {pva.items.length} 项 · 达成 {Math.round(pva.achievement)}%</span>
        <span className="text-slate-600">计划 {fmtMin(pva.plannedMin)} / 实际 {fmtMin(pva.actualWorkMin)}</span>
      </div>
      <div className="flex flex-col gap-1.5">
        {pva.items.map(({ plan, coveredMin, matched }) => {
          const plannedMin = plan.durationMin ?? (plan.endMin !== undefined && plan.startMin !== undefined ? plan.endMin - plan.startMin : 0)
          const pct = plannedMin > 0 ? Math.min(100, Math.round((coveredMin / plannedMin) * 100)) : matched ? 100 : 0
          return (
            <button
              key={plan.id}
              className="flex items-center gap-2.5 rounded-lg border border-white/[0.05] bg-white/[0.03] px-2.5 py-2 text-left text-[12px] transition-colors hover:border-white/[0.1] hover:bg-white/[0.06]"
              onClick={() => setView('plan')}
              title="跳到计划视图"
            >
              <span>{statusIcon(plan.status, matched)}</span>
              <span className="min-w-0 flex-1 truncate text-slate-200">{plan.title}</span>
              <div className="h-1.5 w-28 overflow-hidden rounded-full bg-white/[0.06]">
                <div
                  className={`h-full rounded-full ${pct >= 80 ? 'bg-neon-green' : pct >= 40 ? 'bg-neon-amber' : 'bg-neon-pink'}`}
                  style={{ width: `${pct}%` }}
                />
              </div>
              <span className="w-28 shrink-0 text-right text-slate-400">
                {fmtMin(coveredMin)} / {plannedMin > 0 ? fmtMin(plannedMin) : '—'}
              </span>
            </button>
          )
        })}
      </div>
    </>
  )
}

/** 纠偏规则管理（从设置页迁移到监控页，含冲突覆盖检测） */
function RulesCard() {
  const [rules, setRules] = useState<CorrectionRule[]>([])
  const [draft, setDraft] = useState({ screen: 0, matchApp: '', matchTitleContains: '', setApp: '', setState: '' })
  const [note, setNote] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      setRules(((await window.api.listRules()) as CorrectionRule[]) ?? [])
    } catch {
      setRules([])
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const flash = (text: string) => {
    setNote(text)
    window.setTimeout(() => setNote(null), 2000)
  }

  const add = async () => {
    if (!draft.matchApp.trim() || !draft.matchTitleContains.trim()) return
    // 冲突检测：同屏 + 同应用 + 同关键词 → 覆盖已有规则
    const dup = rules.find(
      (r) =>
        r.screen === draft.screen &&
        r.matchApp.toLowerCase() === draft.matchApp.trim().toLowerCase() &&
        r.matchTitleContains.toLowerCase() === draft.matchTitleContains.trim().toLowerCase()
    )
    if (dup) {
      await window.api.saveRule({
        ...dup,
        setApp: draft.setApp.trim() || undefined,
        setState: (draft.setState || undefined) as WorkState | undefined,
        enabled: true
      })
      flash('已覆盖同条件规则 ✓')
    } else {
      await window.api.saveRule({
        id: genId('rule'),
        screen: draft.screen,
        matchApp: draft.matchApp.trim(),
        matchTitleContains: draft.matchTitleContains.trim(),
        setApp: draft.setApp.trim() || undefined,
        setState: (draft.setState || undefined) as WorkState | undefined,
        enabled: true,
        ts: Date.now()
      })
      flash('规则已创建 ✓')
    }
    setDraft({ screen: 0, matchApp: '', matchTitleContains: '', setApp: '', setState: '' })
    void load()
  }

  return (
    <div className="flex flex-col gap-2 pt-1">
      {note ? <div className="anim-fade-in text-[11px] text-neon-green">{note}</div> : null}
      {rules.length > 0 ? (
        <div className="text-[11px] text-slate-500">
          累计命中 <span className="text-neon-cyan">{rules.reduce((a, r) => a + (r.hitCount ?? 0), 0)}</span> 次
          {rules.some((r) => r.lastHitAt)
            ? ` · 最近命中 ${new Date(Math.max(...rules.map((r) => r.lastHitAt ?? 0)) ).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`
            : ' · 今日暂无命中（规则可能未生效，检查条件是否过严）'}
        </div>
      ) : null}
      {rules.length > 0 ? (
        <div className="overflow-hidden rounded-xl border border-white/[0.06]">
          <table className="w-full text-[12px]">
            <thead>
              <tr className="bg-white/[0.03] text-left text-[11px] text-slate-500">
                <th className="px-2.5 py-2 font-medium">屏</th>
                <th className="px-2.5 py-2 font-medium">匹配应用</th>
                <th className="px-2.5 py-2 font-medium">标题包含</th>
                <th className="px-2.5 py-2 font-medium">改为应用</th>
                <th className="px-2.5 py-2 font-medium">改为状态</th>
                <th className="px-2.5 py-2 font-medium">命中</th>
                <th className="px-2.5 py-2 font-medium">启用</th>
                <th className="px-2.5 py-2" />
              </tr>
            </thead>
            <tbody>
              {rules.map((r) => (
                <tr key={r.id} className="border-t border-white/[0.05] text-slate-300 transition-colors hover:bg-white/[0.03]">
                  <td className="px-2.5 py-1.5">{r.screen + 1}</td>
                  <td className="px-2.5 py-1.5">{r.matchApp}</td>
                  <td className="max-w-[140px] truncate px-2.5 py-1.5">{r.matchTitleContains}</td>
                  <td className="px-2.5 py-1.5">{r.setApp ?? '—'}</td>
                  <td className="px-2.5 py-1.5">{r.setState ? `${WORK_STATES[r.setState].emoji} ${WORK_STATES[r.setState].label}` : '—'}</td>
                  <td className="px-2.5 py-1.5">
                    <span className={r.hitCount ? 'text-neon-cyan' : 'text-slate-600'}>{r.hitCount ?? 0}次</span>
                  </td>
                  <td className="px-2.5 py-1.5">
                    <Toggle checked={r.enabled} onChange={(v) => void window.api.saveRule({ ...r, enabled: v }).then(load)} />
                  </td>
                  <td className="px-2.5 py-1.5 text-right">
                    <button className="glass-btn danger !px-2 !py-0.5" onClick={() => void window.api.removeRule(r.id).then(load)}>
                      <Icon name="trash" size={12} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="py-2 text-[12px] text-slate-600">暂无规则。命中条件（屏 + 应用 + 标题关键词）全部满足才会改写，宁漏勿误。</div>
      )}
      {/* 新增行 */}
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-dashed border-white/10 p-2.5">
        <select
          className="glass-input !w-16"
          value={draft.screen}
          onChange={(e) => setDraft((d) => ({ ...d, screen: Number(e.target.value) }))}
        >
          {[0, 1, 2, 3].map((s) => (
            <option key={s} value={s}>
              屏{s + 1}
            </option>
          ))}
        </select>
        <input
          className="glass-input !w-32"
          placeholder="应用（如 chrome.exe）"
          value={draft.matchApp}
          onChange={(e) => setDraft((d) => ({ ...d, matchApp: e.target.value }))}
        />
        <input
          className="glass-input !w-36"
          placeholder="标题包含"
          value={draft.matchTitleContains}
          onChange={(e) => setDraft((d) => ({ ...d, matchTitleContains: e.target.value }))}
        />
        <input
          className="glass-input !w-28"
          placeholder="改为应用（可空）"
          value={draft.setApp}
          onChange={(e) => setDraft((d) => ({ ...d, setApp: e.target.value }))}
        />
        <select
          className="glass-input !w-28"
          value={draft.setState}
          onChange={(e) => setDraft((d) => ({ ...d, setState: e.target.value }))}
        >
          <option value="">状态（可空）</option>
          {ALL_STATES.map((s) => (
            <option key={s} value={s}>
              {WORK_STATES[s].emoji} {WORK_STATES[s].label}
            </option>
          ))}
        </select>
        <button className="glass-btn primary" disabled={!draft.matchApp.trim() || !draft.matchTitleContains.trim()} onClick={() => void add()}>
          <Icon name="plus" size={13} /> 添加
        </button>
      </div>
    </div>
  )
}

export default function MonitorView() {
  const [trail, setTrail] = useState<MergedTrail | null>(null)
  const [pva, setPva] = useState<PlanVsActual | null>(null)
  const [forecasts, setForecasts] = useState<Map<string, PlanForecast>>(new Map())
  const [loaded, setLoaded] = useState(false)
  const [expandedState, setExpandedState] = useState<WorkState | null>(null)
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
    if (!forecastEnabled) return
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

  const stateRows = trail
    ? (Object.entries(trail.stateMinutes) as [WorkState, number][])
        .filter(([, v]) => v > 0.5)
        .sort((a, b) => b[1] - a[1])
    : []
  const maxState = stateRows.length ? stateRows[0][1] : 1
  // 状态→应用粒度：每个状态下各应用的时长分布
  const stateApps = trail && expandedState
    ? (() => {
        const map = new Map<string, number>()
        for (const seg of trail.segments) {
          if (seg.mainState === expandedState && seg.mainApp) {
            map.set(seg.mainApp, (map.get(seg.mainApp) ?? 0) + seg.durationMin)
          }
        }
        return [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)
      })()
    : []
  const maxApp = stateApps.length ? stateApps[0][1] : 1
  const focusColor =
    (presence?.focusLevel ?? 0) >= 70 ? '#10B981' : (presence?.focusLevel ?? 0) >= 40 ? '#F59E0B' : '#EF4444'
  const grade = presence ? attentionGrade(presence.focusLevel) : null
  const scoreLine = presence ? focusScoreLine(presence) : null
  const advice = presence ? focusAdvice(presence) : null
  // 今日概览：工作/摸鱼时长按 shared/stateMeta 口径从 trail.stateMinutes 聚合
  const overviewWorkMin = trail ? WORK_LIKE_STATES.reduce((s, st) => s + (trail.stateMinutes[st] ?? 0), 0) : 0
  const overviewSlackMin = trail ? SLACK_STATES.reduce((s, st) => s + (trail.stateMinutes[st] ?? 0), 0) : 0
  // 昨日评分：history 日期升序，取今日之前最后一条
  const yesterdayScore = attention ? (attention.history.filter((h) => h.date < attention.today.date).pop() ?? null) : null

  return (
    <div className="view-enter flex flex-col gap-5">
      {/* 页面标题区 */}
      <header className="anim-fade-up flex items-center gap-3 px-1">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-white/[0.08] bg-white/[0.04] shadow-glow">
          <Icon name="activity" size={18} className="text-neon-cyan" />
        </span>
        <div className="min-w-0">
          <h1 className="text-[18px] font-bold leading-tight text-slate-100">实时监控</h1>
          <p className="mt-0.5 text-[12px] text-slate-500">活动状态 · 今日时间轴 · 应用分类与纠偏</p>
        </div>
      </header>

      {/* 当前实时状态卡（订阅 onPresence） */}
      <section className="glass-card anim-fade-up flex items-center gap-5" style={{ animationDelay: '60ms' }}>
        {presence ? (
          <>
            <ProgressRing value={presence.focusLevel} size={76} stroke={6} color={focusColor}>
              <div className="text-center">
                <div className="text-lg font-bold leading-none text-slate-100">{presence.focusLevel}</div>
                <div className="mt-0.5 text-[9px] text-slate-500">专注</div>
              </div>
            </ProgressRing>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <StateBadge state={presence.state} size="lg" pulse />
                {grade ? (
                  <span
                    className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold"
                    style={{ borderColor: `${grade.color}55`, background: `${grade.color}18`, color: grade.color }}
                    title={`注意力评级（按专注度分档：S≥90 / A≥75 / B≥55 / C≥35 / D<35）\n${scoreLine ?? ''}`}
                  >
                    {grade.grade} · {grade.label}
                  </span>
                ) : null}
              </div>
              <div className="mt-1 text-[11px] text-slate-500">
                情境 {presence.context || '—'}
                {presence.continuousFocusSec > 60 ? ` · 已连续专注 ${fmtMin(presence.continuousFocusSec / 60)}` : ''}
                {presence.continuousSlackSec > 60 ? ` · 已摸鱼 ${fmtMin(presence.continuousSlackSec / 60)}` : ''}
              </div>
              {scoreLine ? (
                <div className="mt-1 text-[11px] text-slate-600" title="专注度怎么算的：状态基础分 + 连续工作奖励（每分钟 +0.5，30 分钟拿满 +15）；无键鼠输入超 1 分钟封顶 40">
                  打分 {scoreLine}
                </div>
              ) : null}
              {advice ? <div className="anim-fade-in mt-1 text-[11px] text-neon-amber/90">💡 {advice}</div> : null}
              <div className="mt-2 grid gap-1.5 sm:grid-cols-2">
                {presence.screens.map((sc) => {
                  const m = WORK_STATES[sc.state]
                  return (
                    <div
                      key={sc.screen}
                      className="flex items-center gap-2 rounded-lg border border-white/[0.05] bg-white/[0.03] px-2.5 py-1.5 transition-colors hover:border-white/[0.1] hover:bg-white/[0.05]"
                    >
                      <span className="text-sm">{m.emoji}</span>
                      <div className="min-w-0 flex-1">
                        <div className="text-[12px] text-slate-200">
                          屏 {sc.screen + 1} · {sc.appName || sc.app}
                        </div>
                        <div className="truncate text-[11px] text-slate-500">{sc.title}</div>
                      </div>
                      {sc.stickyRelax ? <span className="chip shrink-0 text-neon-green">粘性</span> : null}
                    </div>
                  )
                })}
              </div>
            </div>
          </>
        ) : (
          <div className="flex items-center gap-2 py-4 text-slate-500">
            <span className="pulse-dot inline-block h-2 w-2 rounded-full bg-neon-cyan" />
            正在连接监控引擎…
          </div>
        )}
      </section>

      {/* 今日概览：总时长 / 工作时间 / 摸鱼时间 / 计划达成率（数据来自 trail + pva，无新 IPC） */}
      <section className="glass-card hoverable anim-fade-up" style={{ animationDelay: '90ms' }}>
        <h2 className="mb-3 flex items-center gap-2 text-[15px] font-semibold text-slate-200">
          <Icon name="chart" size={15} className="text-neon-cyan" /> 今日概览
        </h2>
        <div className="grid grid-cols-2 gap-3 text-center sm:grid-cols-4">
          <div className="rounded-xl border border-white/[0.06] bg-white/[0.03] p-3 transition-colors hover:border-neon-cyan/25">
            <div className="text-xl font-bold text-slate-100">{trail ? fmtMin(trail.totalMin) : '—'}</div>
            <div className="mt-0.5 text-[11px] text-slate-500">总时长（墙钟）</div>
          </div>
          <div className="rounded-xl border border-white/[0.06] bg-white/[0.03] p-3 transition-colors hover:border-neon-cyan/25">
            <div className="text-xl font-bold text-neon-green">{trail ? fmtMin(overviewWorkMin) : '—'}</div>
            <div className="mt-0.5 text-[11px] text-slate-500">工作时间</div>
          </div>
          <div className="rounded-xl border border-white/[0.06] bg-white/[0.03] p-3 transition-colors hover:border-neon-cyan/25">
            <div className="text-xl font-bold text-neon-pink">{trail ? fmtMin(overviewSlackMin) : '—'}</div>
            <div className="mt-0.5 text-[11px] text-slate-500">摸鱼时间</div>
          </div>
          <div className="rounded-xl border border-white/[0.06] bg-white/[0.03] p-3 transition-colors hover:border-neon-cyan/25">
            <div className="text-xl font-bold text-neon-cyan">{pva && pva.plannedMin > 0 ? `${Math.round(pva.achievement)}%` : '—'}</div>
            <div className="mt-0.5 text-[11px] text-slate-500">计划达成率</div>
          </div>
        </div>
      </section>

      {/* 今日评分图谱：复用报表日报的注意力评分卡（todayAttention 数据，组件内部自渲染） */}
      {!attentionLoaded ? (
        <section className="glass-card anim-fade-up" style={{ animationDelay: '120ms' }}>
          <h2 className="mb-3 flex items-center gap-2 text-[15px] font-semibold text-slate-200">
            <Icon name="activity" size={15} className="text-neon-cyan" /> 今日评分图谱
          </h2>
          <div className="flex items-center gap-2 py-5 text-[12px] text-slate-500">
            <span className="pulse-dot inline-block h-1.5 w-1.5 rounded-full bg-neon-cyan" />
            评分计算中…
          </div>
        </section>
      ) : !attention || (attention.today.finalScore === 0 && (trail?.totalMin ?? 0) < 30) ? (
        <section className="glass-card anim-fade-up" style={{ animationDelay: '120ms' }}>
          <h2 className="mb-3 flex items-center gap-2 text-[15px] font-semibold text-slate-200">
            <Icon name="activity" size={15} className="text-neon-cyan" /> 今日评分图谱
          </h2>
          <p className="py-4 text-center text-[12px] text-slate-500">今天还没有足够的活动数据，先去专注工作一会儿，评分稍后就会出现在这里。</p>
        </section>
      ) : (
        <AttentionDailyCard score={attention.today} yesterday={yesterdayScore} />
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        {/* 监控能力：单屏/双屏 状态分布（单屏时占满整行，避免右侧留白） */}
        <section
          className={`glass-card hoverable anim-fade-up ${trail && Object.keys(trail.screenMinutes).length > 1 ? '' : 'lg:col-span-2'}`}
          style={{ animationDelay: '120ms' }}
        >
          <h2 className="mb-1 flex items-center gap-2 text-[15px] font-semibold text-slate-200">
            <Icon name="chart" size={15} className="text-neon-cyan" /> 状态分布
          </h2>
          {trail ? (
            <div className="mb-3 flex items-center gap-3 text-[11px] text-slate-500">
              <span>🖥️ {Object.keys(trail.screenMinutes).length} 屏监控</span>
              {(Object.entries(trail.screenMinutes) as [string, number][]).map(([scr, min]) => (
                <span key={scr}>
                  屏{Number(scr)+1} {fmtMin(min)}
                </span>
              ))}
              {trail.dualMin > 0 ? (
                <span className="text-neon-cyan">· 并行 {fmtMin(trail.dualMin)} ({Math.round(trail.dualRatio * 100)}%)</span>
              ) : null}
              {trail.dualWorkSlackMin > 0 ? (
                <span className="text-neon-pink">· 工作+摸鱼并行 {fmtMin(trail.dualWorkSlackMin)}</span>
              ) : null}
            </div>
          ) : null}
          {stateRows.length > 0 ? (
            <div className="flex flex-col gap-1">
              {stateRows.map(([state, min]) => {
                const m = WORK_STATES[state]
                const expanded = expandedState === state
                return (
                  <div key={state}>
                    <button
                      className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-white/[0.04]"
                      onClick={() => setExpandedState(expanded ? null : state)}
                    >
                      <span className="text-[10px] text-slate-600">{expanded ? '▾' : '▸'}</span>
                      <span className="w-14 shrink-0 text-[12px] text-slate-300">
                        {m.emoji} {m.label}
                      </span>
                      <div className="h-2 flex-1 overflow-hidden rounded-full bg-white/[0.06]">
                        <div
                          className="h-full rounded-full transition-all"
                          style={{ width: `${(min / maxState) * 100}%`, background: m.color, transitionDuration: '250ms' }}
                        />
                      </div>
                      <span className="w-14 shrink-0 text-right text-[12px] text-slate-400">{fmtMin(min)}</span>
                    </button>
                    {expanded && stateApps.length > 0 ? (
                      <div className="anim-fade-in ml-8 mr-2 mt-1 flex flex-col gap-1 rounded-lg border border-white/[0.05] bg-white/[0.02] px-3 py-2">
                        <div className="mb-1 text-[10px] text-slate-500">应用明细</div>
                        {stateApps.map(([app, appMin]) => {
                          const pct = Math.round((appMin / Math.max(1, min)) * 100)
                          return (
                            <div key={app} className="flex items-center gap-2 text-[11px]">
                              <span className="w-32 truncate text-slate-400" title={app}>{app}</span>
                              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/[0.06]">
                                <div
                                  className="h-full rounded-full"
                                  style={{ width: `${(appMin / maxApp) * 100}%`, background: m.color, opacity: 0.7 }}
                                />
                              </div>
                              <span className="w-12 shrink-0 text-right text-slate-500">{fmtMin(appMin)}</span>
                              <span className="w-8 shrink-0 text-right text-slate-600">{pct}%</span>
                            </div>
                          )
                        })}
                      </div>
                    ) : expanded ? (
                      <div className="ml-8 text-[11px] text-slate-600 py-1">暂无应用数据</div>
                    ) : null}
                  </div>
                )
              })}
            </div>
          ) : (
            <EmptyState emoji="📊" title="暂无状态数据" hint="采集到活动后，这里会展示各工作状态的时长分布。" />
          )}
        </section>

        {/* 双屏并行（仅多屏时展示） */}
        {trail && Object.keys(trail.screenMinutes).length > 1 ? (
          <section className="glass-card hoverable anim-fade-up" style={{ animationDelay: '180ms' }}>
            <h2 className="mb-3 flex items-center gap-2 text-[15px] font-semibold text-slate-200">
              <Icon name="monitor" size={15} className="text-neon-cyan" /> 双屏并行
            </h2>
            <div className="flex flex-col gap-3">
              <div className="grid grid-cols-3 gap-3 text-center">
                <div className="rounded-xl border border-white/[0.06] bg-white/[0.03] p-3 transition-colors hover:border-neon-cyan/25">
                  <div className="text-xl font-bold text-neon-cyan">{Math.round(trail.dualRatio * 100)}%</div>
                  <div className="mt-0.5 text-[11px] text-slate-500">并行占比</div>
                </div>
                <div className="rounded-xl border border-white/[0.06] bg-white/[0.03] p-3 transition-colors hover:border-neon-cyan/25">
                  <div className="text-xl font-bold text-slate-100">{fmtMin(trail.dualMin)}</div>
                  <div className="mt-0.5 text-[11px] text-slate-500">并行时长</div>
                </div>
                <div className="rounded-xl border border-white/[0.06] bg-white/[0.03] p-3 transition-colors hover:border-neon-cyan/25">
                  <div className="text-xl font-bold text-neon-pink">{fmtMin(trail.dualWorkSlackMin)}</div>
                  <div className="mt-0.5 text-[11px] text-slate-500">工作+摸鱼并行</div>
                </div>
              </div>
              <div className="flex flex-col gap-1.5">
                {(Object.entries(trail.screenMinutes) as [string, number][]).map(([scr, min]) => (
                  <div key={scr} className="flex items-center gap-2 text-[12px]">
                    <span className="w-14 shrink-0 text-slate-400">屏 {Number(scr) + 1}</span>
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/[0.06]">
                      <div
                        className="h-full rounded-full bg-neon-blue"
                        style={{ width: `${Math.min(100, (min / Math.max(1, trail.totalMin)) * 100)}%` }}
                      />
                    </div>
                    <span className="w-16 shrink-0 text-right text-slate-400">{fmtMin(min)}</span>
                  </div>
                ))}
              </div>
              {trail.auxTopState ? (
                <div className="text-[11px] text-slate-500">
                  主屏 {WORK_STATES[trail.mainState].emoji} {WORK_STATES[trail.mainState].label} · 副屏{' '}
                  {WORK_STATES[trail.auxTopState].emoji} {WORK_STATES[trail.auxTopState].label}
                </div>
              ) : null}
            </div>
          </section>
        ) : null}
      </div>

      {/* 今日 24h 时间轴（一行摘要，完整交互在日历页） */}
      <section className="glass-card hoverable anim-fade-up" style={{ animationDelay: '240ms' }}>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-[15px] font-semibold text-slate-200">
            <Icon name="clock" size={15} className="text-neon-cyan" /> 今日时间轴
          </h2>
          <div className="flex items-center gap-3 text-[11px] text-slate-500">
            {trail ? <span className="chip">墙钟 {fmtMin(trail.totalMin)}</span> : null}
            <button className="glass-btn !px-2 !py-1" onClick={() => void load()} title="刷新">
              <Icon name="refresh" size={13} />
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
        {/* 今日作业链：应用流转路径 + 每环节时长 + 自然语言描述（短切换已过滤 {trail && trail.glanceMin > 0 ? `· 已过滤短切换 ${fmtMin(trail.glanceMin)}` : ''}） */}
        {trail && trail.segments.some((s) => !s.glance) ? (
          <div className="mt-3 border-t border-white/[0.05] pt-3">
            <div className="mb-2 flex items-center gap-2 text-[11px] text-slate-500">
              <span>🔗 今日作业链（自动生成）</span>
              {trail.glanceMin > 0 ? <span className="text-slate-600">已过滤短切换 {fmtMin(trail.glanceMin)}</span> : null}
            </div>
            <div className="flex flex-col gap-1.5">
              {extractChains(trail.segments, 3).map((chain, i) => (
                <div
                  key={i}
                  className="rounded-lg border border-white/[0.05] bg-white/[0.03] px-3 py-2 text-[12px] leading-relaxed text-slate-300 transition-colors hover:border-white/[0.1] hover:bg-white/[0.05]"
                >
                  {describeChain(chain)}
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* 分类管理：应用 → 状态 纠偏规则入口 */}
        <section className="glass-card hoverable anim-fade-up" style={{ animationDelay: '300ms' }}>
          <h2 className="mb-3 flex items-center gap-2 text-[15px] font-semibold text-slate-200">
            <Icon name="edit" size={15} className="text-neon-cyan" /> 分类管理
          </h2>
          {trail ? <ClassifyCard trail={trail} /> : <div className="py-4 text-slate-500">加载中…</div>}
        </section>

        {/* 纠偏规则管理 */}
        <section className="glass-card hoverable anim-fade-up" style={{ animationDelay: '420ms' }}>
          <h2 className="mb-3 flex items-center gap-2 text-[15px] font-semibold text-slate-200">
            <Icon name="sliders" size={15} className="text-neon-cyan" /> 纠偏规则管理
          </h2>
          <RulesCard />
        </section>
      </div>
    </div>
  )
}
