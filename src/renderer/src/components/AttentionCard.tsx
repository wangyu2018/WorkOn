import { useState, type ReactNode } from 'react'
import type { AttentionScore } from '@shared/types'
import { GRADE_META, USER_TYPE_META } from '@shared/attention'
import { Icon } from './Icon'
import { fmtMin } from './utils'

/** 分区标题：图标 + 标题 + 可选说明 */
export function SectionTitle({ icon, title, hint }: { icon: 'chart' | 'flame' | 'calendar' | 'activity'; title: string; hint?: string }) {
  return (
    <h3 className="mb-3 flex items-center gap-2 text-[13px] font-semibold text-slate-200">
      <span className="flex h-5 w-5 items-center justify-center rounded-md bg-neon-cyan/15 text-neon-cyan">
        <Icon name={icon} size={12} />
      </span>
      {title}
      {hint ? <span className="ml-auto text-[10px] font-normal text-slate-500">{hint}</span> : null}
    </h3>
  )
}

/* ── 注意力评分（v2.6） ── */

/** 五维展示元信息（顺序 = 雷达图顶点顺序，从正上方顺时针） */
export const DIM_META = [
  { key: 'depth', label: '深度专注' },
  { key: 'sustain', label: '持续力' },
  { key: 'resist', label: '抗干扰' },
  { key: 'rhythm', label: '节奏感' },
  { key: 'recover', label: '恢复力' }
] as const
export type DimKey = (typeof DIM_META)[number]['key']

/** rawSignals 16 字段的中文案与格式化（五维详情表用） */
const SIGNAL_META: { key: keyof AttentionScore['rawSignals']; label: string; fmt: (v: number) => string }[] = [
  { key: 'deepFocusTotalMin', label: '深度专注总时长', fmt: (v) => fmtMin(v) },
  { key: 'deepFocusMaxStreak', label: '最长连续深度', fmt: (v) => fmtMin(v) },
  { key: 'deepFocusCount', label: '深度时段次数', fmt: (v) => `${v} 次` },
  { key: 'effectiveWorkMin', label: '有效工作时长', fmt: (v) => fmtMin(v) },
  { key: 'targetWorkMin', label: '目标工作时长', fmt: (v) => fmtMin(v) },
  { key: 'distractionCount', label: '分心次数', fmt: (v) => `${v} 次` },
  { key: 'distractionAvgMin', label: '单次分心均长', fmt: (v) => fmtMin(v) },
  { key: 'recoveryAvgMin', label: '分心后恢复时间', fmt: (v) => fmtMin(v) },
  { key: 'socialDistractionRatio', label: '社媒分心占比', fmt: (v) => `${Math.round(v * 100)}%` },
  { key: 'pomodoroCompleted', label: '番茄钟完成', fmt: (v) => `${v} 个` },
  { key: 'pomodoroTarget', label: '番茄钟目标', fmt: (v) => `${v} 个` },
  { key: 'rhythmStability', label: '周期稳定性', fmt: (v) => `${Math.round(v * 100)}%` },
  { key: 'restQuality', label: '休息合理性', fmt: (v) => `${Math.round(v * 100)}%` },
  { key: 'recoveryAfterBreak', label: '午休后提升', fmt: (v) => `${Math.round(v * 100)}%` },
  { key: 'fatigue3hDecay', label: '3h 衰减率', fmt: (v) => `${Math.round(v * 100)}%` },
  { key: 'weeklyVariance', label: '周波动', fmt: (v) => `${Math.round(v * 100)}%` }
]

/** 差值小字：>0 绿 ↑ / <0 红 ↓ / =0 灰（格式 '+23'） */
export function Delta({ v }: { v: number }) {
  const cls = v > 0 ? 'text-neon-green' : v < 0 ? 'text-neon-red' : 'text-slate-500'
  return (
    <span className={`text-[10px] font-medium ${cls}`}>
      {v > 0 ? '↑' : v < 0 ? '↓' : ''}
      {v > 0 ? `+${v}` : v}
    </span>
  )
}

/** 五维雷达图（纯 SVG，约 140×140）：今日实线填充，昨日虚线对比 */
export function Radar({ today, yesterday }: { today: AttentionScore['dimensions']; yesterday: AttentionScore['dimensions'] | null }) {
  const CX = 80
  const CY = 70
  const R = 40
  const LABEL_R = 52
  const angleOf = (i: number) => -Math.PI / 2 + (i * 2 * Math.PI) / 5
  const pt = (i: number, v: number, radius = R) => {
    const r = (Math.max(0, Math.min(100, v)) / 100) * radius
    return [CX + r * Math.cos(angleOf(i)), CY + r * Math.sin(angleOf(i))] as const
  }
  const polyOf = (dims: AttentionScore['dimensions']) => DIM_META.map((d, i) => pt(i, dims[d.key]).join(',')).join(' ')
  const ringOf = (frac: number) =>
    DIM_META.map((_, i) => {
      const a = angleOf(i)
      return [CX + R * frac * Math.cos(a), CY + R * frac * Math.sin(a)].join(',')
    }).join(' ')
  return (
    <svg viewBox="0 0 160 140" className="h-[140px] w-auto">
      {/* 网格：50 / 100 两圈 + 五条轴线 */}
      {[0.5, 1].map((f) => (
        <polygon key={f} points={ringOf(f)} fill="none" stroke="rgba(148,163,184,0.16)" strokeWidth="1" />
      ))}
      {DIM_META.map((_, i) => {
        const [x, y] = pt(i, 100)
        return <line key={i} x1={CX} y1={CY} x2={x} y2={y} stroke="rgba(148,163,184,0.14)" strokeWidth="1" />
      })}
      {/* 昨日虚线 + 今日实线填充 */}
      {yesterday ? <polygon points={polyOf(yesterday)} fill="none" stroke="#64748B" strokeWidth="1.2" strokeDasharray="4 3" /> : null}
      <polygon points={polyOf(today)} fill="rgba(34,211,238,0.3)" stroke="#22D3EE" strokeWidth="1.5" strokeLinejoin="round" />
      {/* 轴标签 */}
      {DIM_META.map((d, i) => {
        const a = angleOf(i)
        const x = CX + LABEL_R * Math.cos(a)
        const y = CY + LABEL_R * Math.sin(a)
        const anchor = Math.cos(a) > 0.3 ? 'start' : Math.cos(a) < -0.3 ? 'end' : 'middle'
        return (
          <text key={d.key} x={x} y={y} textAnchor={anchor} dominantBaseline="central" fontSize="9" fill="rgba(148,163,184,0.85)">
            {d.label}
          </text>
        )
      })}
    </svg>
  )
}

/** 规则版 AI 洞察：取最弱维度，从 rawSignals 挑支撑数据生成 1-2 句建议 */
function insightOf(s: AttentionScore): string {
  const r = s.rawSignals
  const weakest = DIM_META.reduce((a, b) => (s.dimensions[a.key] <= s.dimensions[b.key] ? a : b))
  switch (weakest.key) {
    case 'depth':
      return `${weakest.label}偏弱：今日最长连续深度仅 ${Math.round(r.deepFocusMaxStreak)} 分钟，试试 25 分钟番茄钟，先攒出一段完整深度。`
    case 'sustain':
      return `${weakest.label}偏弱：有效工作 ${fmtMin(r.effectiveWorkMin)} / 目标 ${fmtMin(r.targetWorkMin)}，先把目标时长补齐再求深度。`
    case 'resist':
      return `${weakest.label}偏弱：今日分心 ${r.distractionCount} 次、单次均 ${Math.round(r.distractionAvgMin)} 分钟，把娱乐应用收成一组会好得多。`
    case 'rhythm':
      return `${weakest.label}偏弱：番茄钟完成 ${r.pomodoroCompleted}/${r.pomodoroTarget}，按「25 分钟工作 + 5 分钟休息」的节奏走会更稳。`
    case 'recover':
      return `${weakest.label}偏弱：午休后回血 ${Math.round(r.recoveryAfterBreak * 100)}%、3h 衰减 ${Math.round(r.fatigue3hDecay * 100)}%，午后安排 10 分钟离屏休息试试。`
  }
}

/** 日报卡：今日注意力评分（总分 + 雷达 + 五维条 + 规则洞察） */
export function AttentionDailyCard({ score, yesterday, pin }: { score: AttentionScore; yesterday: AttentionScore | null; pin?: ReactNode }) {
  const [showSignals, setShowSignals] = useState(false)
  const gm = GRADE_META[score.grade]
  const typeMeta = USER_TYPE_META[score.userType]
  return (
    <section className="glass-card hoverable anim-fade-up" style={{ animationDelay: '60ms' }}>
      <SectionTitle icon="activity" title="今日注意力评分" hint={`${typeMeta.emoji} ${typeMeta.label}`} />
      {pin}
      <div className="flex flex-wrap items-center gap-5">
        {/* 左：总分 + 等级徽章 + 对比 */}
        <div className="flex w-32 shrink-0 flex-col items-center gap-1.5 text-center">
          <div className="text-3xl font-bold leading-tight text-slate-100">{score.finalScore}</div>
          <span className="rounded-full px-2 py-0.5 text-[10px] font-semibold" style={{ background: `${gm.color}22`, color: gm.color }}>
            {score.grade} · {gm.label}
          </span>
          <div className="flex items-center gap-1">
            <Delta v={score.vsYesterday} />
            <span className="text-[10px] text-slate-500">vs 昨日</span>
          </div>
          {score.vsLastWeekAvg !== 0 ? (
            <div className="flex items-center gap-1">
              <Delta v={score.vsLastWeekAvg} />
              <span className="text-[10px] text-slate-500">vs 上周均值</span>
            </div>
          ) : null}
        </div>
        {/* 中：五维雷达图 */}
        <div className="shrink-0">
          <Radar today={score.dimensions} yesterday={yesterday?.dimensions ?? null} />
        </div>
        {/* 右：五维分数条 */}
        <div className="flex min-w-52 flex-1 flex-col gap-1.5">
          {DIM_META.map((d) => {
            const v = score.dimensions[d.key]
            const yv = yesterday?.dimensions[d.key]
            return (
              <div key={d.key} className="flex items-center gap-2 text-[11px]">
                <span className="w-14 shrink-0 text-slate-400">{d.label}</span>
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/[0.06]">
                  <div className="h-full rounded-full bg-gradient-to-r from-neon-cyan to-neon-blue" style={{ width: `${v}%` }} />
                </div>
                <span className="w-7 shrink-0 text-right font-medium text-slate-300">{v}</span>
                <span className="w-10 shrink-0 text-right">{yv !== undefined ? <Delta v={v - yv} /> : <span className="text-[10px] text-slate-600">—</span>}</span>
              </div>
            )
          })}
        </div>
      </div>
      {/* 底部：规则洞察 + 可折叠五维详情 */}
      <div className="mt-3 border-t border-white/[0.05] pt-3">
        <p className="line-clamp-2 text-[11px] leading-relaxed text-slate-400">
          <span className="mr-1">💡</span>
          {insightOf(score)}
        </p>
        <button className="mt-1.5 text-[10px] text-slate-500 transition-colors hover:text-neon-cyan" onClick={() => setShowSignals((v) => !v)}>
          {showSignals ? '▾ 收起五维详情' : '▸ 五维详情'}
        </button>
        {showSignals ? (
          <div className="anim-fade-in mt-2 grid grid-cols-2 gap-x-6 gap-y-0.5 rounded-lg border border-white/[0.05] bg-white/[0.02] px-3 py-2">
            {SIGNAL_META.map((m) => (
              <div key={m.key} className="flex items-center justify-between gap-2 text-[10px]">
                <span className="text-slate-500">{m.label}</span>
                <span className="shrink-0 font-medium text-slate-400">{m.fmt(score.rawSignals[m.key])}</span>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </section>
  )
}
