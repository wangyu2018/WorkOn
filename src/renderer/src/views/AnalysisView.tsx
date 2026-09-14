import { useCallback, useEffect, useState } from 'react'
import type { UsageStat, UserAnalysis } from '@shared/types'
import { WORK_LIKE_STATES } from '@shared/stateMeta'
import { Icon } from '../components/Icon'
import { EmptyState } from '../components/EmptyState'
import { ProgressRing } from '../components/ProgressRing'
import { useSettingsStore } from '../stores/settingsStore'

function scoreColor(v: number): string {
  return v >= 75 ? 'var(--teal)' : v >= 50 ? '#F59E0B' : '#EF4444'
}

/** 近 7 天趋势 / Top3 / 时段对比数据（v6 深度分析） */
interface TrendData {
  days: { key: string; label: string; focusMin: number }[]
  topApps: { app: string; min: number }[]
  morningMin: number
  afternoonMin: number
}

let trendCache: TrendData | null = null

function useTrend(): TrendData | null {
  // 跨挂载缓存：再次进页先给旧趋势，后台照常重算
  const [data, setData] = useState<TrendData | null>(() => trendCache ?? null)
  useEffect(() => {
    const days: { key: string; label: string; focusMin: number }[] = []
    const appMin = new Map<string, number>()
    let morning = 0
    let afternoon = 0
    void (async () => {
      for (let i = 6; i >= 0; i--) {
        const d = new Date()
        d.setDate(d.getDate() - i)
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
        days.push({ key, label: `${d.getMonth() + 1}/${d.getDate()}`, focusMin: 0 })
        try {
          const trail = (await window.api.getTrail(key)) as { segments?: { mainState: string; mainApp: string; durationMin: number; startTs: number; glance?: boolean }[] } | null
          for (const seg of trail?.segments ?? []) {
            if (seg.glance || !WORK_LIKE_STATES.includes(seg.mainState as never)) continue
            days[days.length - 1].focusMin += seg.durationMin
            appMin.set(seg.mainApp, (appMin.get(seg.mainApp) ?? 0) + seg.durationMin)
            const h = new Date(seg.startTs).getHours()
            if (h >= 6 && h < 12) morning += seg.durationMin
            else if (h >= 12 && h < 19) afternoon += seg.durationMin
          }
        } catch { /* 跳过无数据日 */ }
      }
      const topApps = [...appMin.entries()].map(([app, min]) => ({ app, min })).sort((a, b) => b.min - a.min).slice(0, 3)
      const result = { days, topApps, morningMin: Math.round(morning), afternoonMin: Math.round(afternoon) }
      trendCache = result
      setData(result)
    })()
    return
  }, [])
  return data
}

/** 近 7 天专注趋势 + Top3 应用 + ✦时段洞察（v6 深度分析区） */
function TrendSection() {
  const t = useTrend()
  if (!t) return null
  const max = Math.max(1, ...t.days.map((d) => d.focusMin))
  const W = 300
  const H = 64
  const step = t.days.length > 1 ? W / (t.days.length - 1) : W
  const pts = t.days.map((d, i) => `${(i * step).toFixed(1)},${(H - 6 - (d.focusMin / max) * (H - 14)).toFixed(1)}`)
  const peakIdx = t.days.reduce((bi, d, i) => (d.focusMin > t.days[bi].focusMin ? i : bi), 0)
  const total = t.morningMin + t.afternoonMin
  const diffPct = total > 0 ? Math.round((Math.abs(t.morningMin - t.afternoonMin) / (total / 2)) * 100) : 0
  const morningBetter = t.morningMin >= t.afternoonMin
  const barColors = ['var(--teal)', 'var(--violet)', 'var(--cyan)']
  return (
    <section className="glass-card hoverable">
      <div className="mb-2 flex items-center gap-2">
        <h3 className="text-[13px] font-semibold text-slate-300">近 7 天专注趋势</h3>
        <span className="ml-auto text-[10px] text-slate-500">日均 {Math.round(t.days.reduce((a, d) => a + d.focusMin, 0) / 7)}m</span>
      </div>
      <div className="flex items-start gap-4">
        <svg viewBox={`0 0 ${W} ${H}`} className="h-16 flex-1">
          <defs>
            <linearGradient id="anag" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" style={{ stopColor: 'var(--teal)', stopOpacity: 0.28 }} />
              <stop offset="1" style={{ stopColor: 'var(--teal)', stopOpacity: 0 }} />
            </linearGradient>
          </defs>
          <polygon points={`0,${H} ${pts.join(' ')} ${W},${H}`} fill="url(#anag)" />
          <polyline points={pts.join(' ')} fill="none" style={{ stroke: 'var(--teal)', strokeWidth: 2.2, strokeLinecap: 'round', strokeLinejoin: 'round' }} />
          <circle cx={(peakIdx * step).toFixed(1)} cy={(H - 6 - (t.days[peakIdx].focusMin / max) * (H - 14)).toFixed(1)} r="3.4" style={{ fill: 'var(--teal)' }} stroke="#fff" strokeWidth="1.6" />
        </svg>
        <div className="w-[42%] shrink-0">
          <div className="mb-1.5 text-[10px] font-bold text-slate-500">时间去哪了 · Top 3</div>
          <div className="flex flex-col gap-1.5">
            {t.topApps.map((a, i) => (
              <div key={a.app} className="flex items-center gap-1.5">
                <span className="w-20 truncate text-[10.5px] text-slate-300" title={a.app}>{a.app}</span>
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/5">
                  <div className="h-full rounded-full" style={{ width: `${Math.round((a.min / (t.topApps[0]?.min || 1)) * 100)}%`, background: barColors[i] }} />
                </div>
                <span className="w-10 shrink-0 text-right text-[10px] tabular-nums text-slate-500">{a.min >= 60 ? `${Math.floor(a.min / 60)}h` : `${Math.round(a.min)}m`}</span>
              </div>
            ))}
            {!t.topApps.length ? <span className="text-[10px] text-slate-600">—</span> : null}
          </div>
        </div>
      </div>
      <div className="mt-2 flex items-center gap-1.5 text-[10px] text-slate-500">
        <span>{t.days[0]?.label}</span>
        <div className="flex flex-1 justify-between px-6">
          {t.days.slice(1, -1).map((d) => (
            <span key={d.key}>{d.label}</span>
          ))}
        </div>
        <span>今天</span>
      </div>
      {total > 0 ? (
        <div
          className="mt-2.5 flex items-center gap-2 rounded-xl px-3 py-2 text-[11px] text-slate-300"
          style={{ background: 'var(--aura-soft)', border: '1px solid rgba(139,92,246,0.25)' }}
        >
          <span className="shrink-0" style={{ color: 'var(--violet)' }}>✦</span>
          <span>
            {morningBetter ? '上午' : '午后'}的专注比{morningBetter ? '午后' : '上午'}高 <b className="text-[var(--teal-deep)]">{diffPct}%</b>
            （上午 {Math.floor(t.morningMin / 60)}h{t.morningMin % 60}m / 午后 {Math.floor(t.afternoonMin / 60)}h{t.afternoonMin % 60}m），
            建议把硬任务放在{morningBetter ? '上午' : '午后'}黄金段。
          </span>
        </div>
      ) : null}
    </section>
  )
}

/** AI 画像 / 用量 / 派生待办 */
export default function AnalysisView() {
  const aiEnabled = useSettingsStore((s) => s.settings.aiEnabled)
  const [analysis, setAnalysis] = useState<UserAnalysis | null>(null)
  const [usage, setUsage] = useState<UsageStat[]>([])
  const [todos, setTodos] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [loaded, setLoaded] = useState(false)

  const load = useCallback(async () => {
    try {
      const [a, u, t] = await Promise.all([window.api.getAnalysis(), window.api.usageToday(), window.api.getTodos()])
      setAnalysis((a as UserAnalysis | null) ?? null)
      setUsage((u as UsageStat[]) ?? [])
      setTodos(((t as string[]) ?? []).filter((x) => typeof x === 'string'))
    } catch {
      /* 保持旧数据 */
    } finally {
      setLoaded(true)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const refresh = async () => {
    setLoading(true)
    try {
      await window.api.refreshAnalysis()
      await load()
    } finally {
      setLoading(false)
    }
  }

  const totalTokens = usage.reduce((s, u) => s + (u.tokens ?? 0), 0)
  const totalQa = usage.reduce((s, u) => s + (u.qaCount ?? 0), 0)
  const totalCost = usage.reduce((s, u) => s + (u.costUsd ?? 0), 0)
  const p = analysis?.profile

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="text-[15px] font-semibold text-slate-200">AI 工作画像</h2>
        <button className="glass-btn primary" disabled={loading} onClick={() => void refresh()}>
          <Icon name="refresh" size={13} className={loading ? 'animate-spin' : ''} />
          {loading ? '分析中…' : '刷新画像'}
        </button>
      </div>

      {!analysis ? (
        <div className="glass-card hoverable">
          <EmptyState
            emoji="🧠"
            title={loaded ? '今天还没有画像' : '加载中…'}
            hint="点击「刷新画像」生成今日分析；在设置中配置 AI Key 后可获得 LLM 深度画像，否则使用本地规则分析。"
          />
        </div>
      ) : (
        <>
          {/* 评分大数字 + 当日小结 */}
          <div className="grid gap-4 lg:grid-cols-3">
            <section className="glass-card flex items-center justify-around">
              <div className="text-center">
                <ProgressRing value={p?.focusScore ?? 0} size={92} stroke={8} color={scoreColor(p?.focusScore ?? 0)}>
                  <div className="text-2xl font-bold text-slate-100">{p?.focusScore ?? 0}</div>
                </ProgressRing>
                <div className="mt-2 text-[12px] text-slate-400">专注力</div>
              </div>
              <div className="text-center">
                <ProgressRing value={p?.efficiencyScore ?? 0} size={92} stroke={8} color={scoreColor(p?.efficiencyScore ?? 0)}>
                  <div className="text-2xl font-bold text-slate-100">{p?.efficiencyScore ?? 0}</div>
                </ProgressRing>
                <div className="mt-2 text-[12px] text-slate-400">效率</div>
              </div>
            </section>
            <section className="glass-card lg:col-span-2">
              <div className="mb-2 flex items-center gap-2 text-[12px] text-slate-500">
                <Icon name="sparkles" size={13} className="text-neon-violet" />
                当日小结
                <span className="chip !py-0">{analysis.source === 'llm' ? 'LLM' : '本地规则'}</span>
              </div>
              <p className="text-[13px] leading-relaxed text-slate-300">{analysis.daily || '—'}</p>
              {analysis.patterns.length > 0 ? (
                <div className="mt-3 flex flex-col gap-1">
                  {analysis.patterns.map((pt, i) => (
                    <div key={i} className="flex items-start gap-1.5 text-[12px] text-slate-400">
                      <span className="text-neon-cyan">·</span> {pt}
                    </div>
                  ))}
                </div>
              ) : null}
            </section>
          </div>

          {/* 近 7 天趋势 + Top3 + 时段洞察 */}
          <TrendSection />

          {/* 画像细节 */}
          <div className="grid gap-4 lg:grid-cols-2">
            <section className="glass-card hoverable">
              <h3 className="mb-3 text-[13px] font-semibold text-slate-300">行为特征</h3>
              <div className="flex flex-col gap-3 text-[12px]">
                <div>
                  <div className="mb-1 text-slate-500">高频类别</div>
                  <div className="flex flex-wrap gap-1.5">
                    {p?.topCategories.length ? (
                      p.topCategories.map((c) => (
                        <span key={c} className="chip !border-neon-blue/40 !text-neon-blue">
                          {c}
                        </span>
                      ))
                    ) : (
                      <span className="text-slate-600">—</span>
                    )}
                  </div>
                </div>
                <div>
                  <div className="mb-1 text-slate-500">高效时段</div>
                  <div className="flex flex-wrap gap-1.5">
                    {p?.bestHours.length ? (
                      p.bestHours.map((h) => (
                        <span key={h} className="chip !border-neon-green/40 !text-neon-green">
                          {h}:00
                        </span>
                      ))
                    ) : (
                      <span className="text-slate-600">—</span>
                    )}
                  </div>
                </div>
                <div>
                  <div className="mb-1 text-slate-500">易分心应用</div>
                  <div className="flex flex-wrap gap-1.5">
                    {p?.distractingApps.length ? (
                      p.distractingApps.map((a) => (
                        <span key={a} className="chip !border-neon-pink/40 !text-neon-pink">
                          {a}
                        </span>
                      ))
                    ) : (
                      <span className="text-slate-600">—</span>
                    )}
                  </div>
                </div>
              </div>
            </section>

            <section className="glass-card hoverable">
              <h3 className="mb-3 text-[13px] font-semibold text-slate-300">双屏画像</h3>
              {p?.dualScreen ? (
                <div className="flex flex-col gap-2 text-[12px] text-slate-400">
                  <div className="flex justify-between">
                    <span>常态双屏</span>
                    <span className={p.dualScreen.isRegularDual ? 'text-neon-green' : 'text-slate-500'}>
                      {p.dualScreen.isRegularDual ? '是' : '否'}
                    </span>
                  </div>
                  <div className="flex justify-between gap-4">
                    <span className="shrink-0">主屏工作</span>
                    <span className="truncate text-slate-300">{p.dualScreen.mainWork || '—'}</span>
                  </div>
                  <div className="flex justify-between gap-4">
                    <span className="shrink-0">副屏活动</span>
                    <span className="truncate text-slate-300">{p.dualScreen.auxActivity || '—'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>主工作+副摸鱼占比</span>
                    <span className="text-neon-amber">{Math.round(p.dualScreen.workSlackRatio * 100)}%</span>
                  </div>
                  <div className="flex justify-between">
                    <span>摸鱼时做 AI 开发</span>
                    <span className={p.dualScreen.slackWithAiDev ? 'text-neon-violet' : 'text-slate-500'}>
                      {p.dualScreen.slackWithAiDev ? '有该特征' : '无'}
                    </span>
                  </div>
                </div>
              ) : (
                <div className="text-[12px] text-slate-600">—</div>
              )}
            </section>
          </div>

          {/* 优势 / 风险 / 建议 */}
          <div className="grid gap-4 lg:grid-cols-3">
            <section className="glass-card hoverable">
              <h3 className="mb-2 text-[13px] font-semibold text-neon-green">优势</h3>
              {p?.strengths.length ? (
                <ul className="flex flex-col gap-1.5">
                  {p.strengths.map((s, i) => (
                    <li key={i} className="flex items-start gap-1.5 text-[12px] text-slate-300">
                      <Icon name="check" size={13} className="mt-0.5 shrink-0 text-neon-green" /> {s}
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="text-[12px] text-slate-600">—</div>
              )}
            </section>
            <section className="glass-card hoverable">
              <h3 className="mb-2 text-[13px] font-semibold text-neon-amber">风险</h3>
              {p?.risks.length ? (
                <ul className="flex flex-col gap-1.5">
                  {p.risks.map((s, i) => (
                    <li key={i} className="flex items-start gap-1.5 text-[12px] text-slate-300">
                      <Icon name="alert" size={13} className="mt-0.5 shrink-0 text-neon-amber" /> {s}
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="text-[12px] text-slate-600">—</div>
              )}
            </section>
            <section className="glass-card hoverable">
              <h3 className="mb-2 text-[13px] font-semibold text-neon-violet">建议</h3>
              {analysis.suggestions.length ? (
                <ul className="flex flex-col gap-1.5">
                  {analysis.suggestions.map((s, i) => (
                    <li key={i} className="flex items-start gap-1.5 text-[12px] text-slate-300">
                      <Icon name="sparkles" size={13} className="mt-0.5 shrink-0 text-neon-violet" /> {s}
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="text-[12px] text-slate-600">—</div>
              )}
            </section>
          </div>
        </>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        {/* AI 用量卡（仅启用时显示） */}
        {aiEnabled ? (
        <section className="glass-card hoverable">
          <h3 className="mb-3 text-[13px] font-semibold text-slate-300">今日 AI 用量</h3>
          <div className="grid grid-cols-3 gap-3 text-center">
            <div className="rounded-xl bg-white/[0.03] p-3">
              <div className="text-lg font-bold text-neon-cyan">{totalTokens.toLocaleString()}</div>
              <div className="mt-0.5 text-[11px] text-slate-500">tokens</div>
            </div>
            <div className="rounded-xl bg-white/[0.03] p-3">
              <div className="text-lg font-bold text-slate-100">{totalQa}</div>
              <div className="mt-0.5 text-[11px] text-slate-500">问答次数</div>
            </div>
            <div className="rounded-xl bg-white/[0.03] p-3">
              <div className="text-lg font-bold text-neon-amber">${totalCost.toFixed(4)}</div>
              <div className="mt-0.5 text-[11px] text-slate-500">估算花费</div>
            </div>
          </div>
          {usage.length > 0 ? (
            <div className="mt-2 text-right text-[10px] text-slate-600">模型：{usage.map((u) => u.model).join(' / ')}</div>
          ) : null}
        </section>
        ) : null}

        {/* 派生待办 */}
        <section className="glass-card hoverable">
          <h3 className="mb-3 text-[13px] font-semibold text-slate-300">派生待办</h3>
          {todos.length ? (
            <ul className="flex flex-col gap-2">
              {todos.map((t, i) => (
                <li key={i} className="flex items-start gap-2 rounded-lg bg-white/[0.03] px-3 py-2 text-[12px] text-slate-300">
                  <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border border-neon-cyan/40 text-[10px] text-neon-cyan">
                    {i + 1}
                  </span>
                  {t}
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState emoji="✅" title="暂无派生待办" hint="生成画像后会自动给出可执行的下一步建议。" />
          )}
        </section>
      </div>
    </div>
  )
}
