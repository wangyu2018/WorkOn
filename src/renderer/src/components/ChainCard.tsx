/**
 * v2.6.1 日报作业链路卡片（spec §7.1 布局）
 * 链路列表（类型/时段/时长/产出/步骤序列/切换效率/置信度）+ 统计行 + 规则洞察
 * tentative（0.3-0.6 置信度）链路标黄底「待确认」；洞察为纯规则文案，不用 LLM
 */
import { useEffect, useState } from 'react'
import type { ChainDayReport, ChainRole, ChainType, WorkChain } from '@shared/chain'
import { SectionTitle } from './AttentionCard'
import { clockOf, fmtMin, minutesOfDay } from './utils'

const TYPE_LABEL: Record<ChainType, string> = {
  task_assigned: '任务派发',
  self_driven: '自驱',
  learning: '学习',
  creative: '创作',
  meeting: '会议'
}

const ROLE_LABEL: Record<ChainRole, string> = {
  intake: '接单',
  process: '处理',
  output: '交付',
  review: '检查',
  communication: '沟通'
}

const pct = (v: number) => `${Math.round(v * 100)}%`

/** 规则洞察：有未闭环链路 → 提醒；全部闭环 → 正向总结（spec §7.1 AI洞察位，纯规则实现） */
function insightOf(report: ChainDayReport): string {
  const { chains, metrics } = report
  const unclosed = chains.filter((c) => !c.hasOutput)
  if (unclosed.length > 0) {
    const first = unclosed[0]
    const range = `${clockOf(minutesOfDay(first.startTs))} 开始的「${first.templateName}」`
    return `${range}未形成产出闭环，可能被其他事务打断。建议明天优先完成这条未闭环的链路。`
  }
  if (chains.length > 0) {
    return `今日 ${chains.length} 条链路全部形成产出闭环，平均切换效率 ${pct(metrics.switchEfficiency)}，节奏保持得不错。`
  }
  return ''
}

function ChainRow({ chain, index }: { chain: WorkChain; index: number }) {
  const tentative = chain.status === 'tentative'
  const timeRange = `${clockOf(minutesOfDay(chain.startTs))}-${clockOf(minutesOfDay(chain.endTs))}`
  return (
    <div
      className={`flex flex-col gap-1.5 rounded-lg border px-3 py-2.5 ${
        tentative ? 'border-amber-400/25 bg-amber-400/[0.07]' : 'border-white/[0.06] bg-white/[0.02]'
      }`}
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px]">
        <span className="font-medium text-slate-500">链路{index + 1}</span>
        <span className="rounded-full bg-neon-cyan/15 px-2 py-0.5 text-[10px] font-medium text-neon-cyan">
          {TYPE_LABEL[chain.type]} · {chain.templateName}
        </span>
        <span className="text-slate-400">{timeRange}</span>
        <span className="text-slate-300">{fmtMin(chain.totalMin)}</span>
        {chain.hasOutput ? (
          <span className="text-neon-green">✅ 产出</span>
        ) : (
          <span className="text-amber-400">⚠️ 无产出</span>
        )}
        {tentative ? <span className="ml-auto rounded-full bg-amber-400/15 px-2 py-0.5 text-[10px] text-amber-300">待确认</span> : null}
      </div>
      <div className="text-[11px] leading-relaxed text-slate-400">
        {chain.steps.map((s, i) => (
          <span key={i}>
            {i > 0 ? <span className="mx-1 text-slate-600">→</span> : null}
            <span className="text-slate-300">{s.app}</span>
            <span className="text-slate-500">（{ROLE_LABEL[s.role]}）</span>
          </span>
        ))}
      </div>
      <div className="flex items-center gap-3 text-[10px] text-slate-500">
        <span>切换效率 {pct(chain.switchEfficiency)}</span>
        <span>置信度 {pct(chain.confidence)}</span>
        {!chain.hasOutput ? <span className="text-amber-400/80">⚠️ 未形成闭环</span> : null}
      </div>
    </div>
  )
}

export function ChainCard({ date }: { date: string }) {
  const [report, setReport] = useState<ChainDayReport | null>(null)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    let alive = true
    setLoaded(false)
    window.api
      .dayChains(date)
      .then((r) => {
        if (alive) setReport(r as ChainDayReport)
      })
      .catch(() => {
        if (alive) setReport(null)
      })
      .finally(() => {
        if (alive) setLoaded(true)
      })
    return () => {
      alive = false
    }
  }, [date])

  if (!loaded) {
    return (
      <section className="glass-card anim-fade-up" style={{ animationDelay: '90ms' }}>
        <SectionTitle icon="activity" title="今日作业链路" />
        <div className="flex items-center gap-2 py-4 text-[12px] text-slate-500">
          <span className="pulse-dot inline-block h-1.5 w-1.5 rounded-full bg-neon-cyan" />
          链路识别中…
        </div>
      </section>
    )
  }
  if (!report || report.chains.length === 0) {
    return (
      <section className="glass-card anim-fade-up" style={{ animationDelay: '90ms' }}>
        <SectionTitle icon="activity" title="今日作业链路" />
        <p className="py-3 text-center text-[12px] text-slate-500">暂未识别出完整的跨应用作业链路，再多工作一会儿试试。</p>
      </section>
    )
  }

  const m = report.metrics
  const withOutput = report.chains.filter((c) => c.hasOutput).length
  const insight = insightOf(report)

  return (
    <section className="glass-card hoverable anim-fade-up" style={{ animationDelay: '90ms' }}>
      <SectionTitle icon="activity" title="今日作业链路" hint={`${report.chains.length} 条已识别`} />
      <div className="flex flex-col gap-2">
        {report.chains.map((c, i) => (
          <ChainRow key={c.id} chain={c} index={i} />
        ))}
      </div>
      {/* 链路统计 */}
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-white/[0.05] pt-3 text-[11px] text-slate-400">
        <span>
          完成 <span className="font-medium text-slate-200">{withOutput}/{m.chainCount}</span>
        </span>
        <span>
          平均时长 <span className="font-medium text-slate-200">{fmtMin(m.avgChainMin)}</span>
        </span>
        <span>
          产出闭环率 <span className="font-medium text-slate-200">{pct(m.chainOutputRate)}</span>
        </span>
        <span>
          切换效率 <span className="font-medium text-slate-200">{pct(m.switchEfficiency)}</span>
        </span>
      </div>
      {insight ? <p className="mt-2.5 rounded-lg bg-neon-cyan/[0.06] px-3 py-2 text-[11px] leading-relaxed text-slate-400">💡 {insight}</p> : null}
    </section>
  )
}
