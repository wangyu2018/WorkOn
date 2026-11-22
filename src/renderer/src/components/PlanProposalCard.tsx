/**
 * AI 建计划前的预览卡：先给用户看「时间 + 标题 + 类型」，确认后才写入计划。
 * 数据来自主进程 create_plan 工具广播的 plan:proposal 草稿（未落库）。
 */
import { useEffect, useState } from 'react'
import type { PlanProposal } from '@shared/assistant'
import { Icon } from './Icon'
import { addDays, clockOf, fmtDateLabel, todayKey } from './utils'

const TYPE_LABEL: Record<PlanProposal['planType'], string> = {
  reminder: '提醒',
  phase: '持续工作',
  task: '待办',
  burst: '机动开发'
}

const CAT_LABEL: Record<string, string> = {
  'work-customer': '工作',
  personal: '生活',
  interest: '兴趣'
}

function dateLabel(date: string): string {
  if (date === todayKey()) return '今天'
  if (date === addDays(todayKey(), 1)) return '明天'
  return fmtDateLabel(date)
}

export function PlanProposalCard(): JSX.Element | null {
  const [queue, setQueue] = useState<PlanProposal[]>([])
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const off = window.api?.onPlanProposal?.((d) => {
      if (!d?.token) return
      setQueue((q) => (q.some((x) => x.token === d.token) ? q : [...q, d]))
    })
    return () => off?.()
  }, [])

  const cur = queue[0]
  if (!cur) return null

  const close = (): void => setQueue((q) => q.slice(1))

  const confirm = async (): Promise<void> => {
    if (busy) return
    setBusy(true)
    try {
      await window.api.savePlan({
        date: cur.date,
        title: cur.title,
        category: cur.category,
        status: 'planned',
        source: 'qa-confirm',
        confirmedFromQA: true,
        planType: cur.planType,
        startMin: cur.startMin,
        endMin: cur.endMin,
        durationMin: cur.durationMin,
        note: cur.note
      })
      close()
    } finally {
      setBusy(false)
    }
  }

  const timeText =
    cur.startMin === undefined
      ? ''
      : cur.endMin === undefined
        ? clockOf(cur.startMin)
        : `${clockOf(cur.startMin)}–${clockOf(cur.endMin)}`

  return (
    <div className="anim-fade-up fixed bottom-[84px] left-1/2 z-[90] w-[340px] -translate-x-1/2">
      <div
        className="glass-card p-4"
        style={{
          background: 'var(--bg-deep)',
          border: '1px solid var(--line-strong)',
          borderRadius: 'var(--r-lg)',
          boxShadow: 'var(--shadow-lg)'
        }}
      >
        <div className="mb-2.5 flex items-center gap-1.5 text-2xs" style={{ color: 'var(--text-3)' }}>
          <Icon name="bell" size={12} className="text-[var(--teal)]" />
          <span>计划预览 · 确认后才加入</span>
          <span className="flex-1" />
          <button type="button" className="ui-icon-btn" aria-label="关闭预览" title="关闭" onClick={close}>
            <Icon name="x" size={12} />
          </button>
        </div>

        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          {timeText ? (
            <span className="text-lg font-semibold tabular-nums" style={{ color: 'var(--text-1)' }}>
              {timeText}
            </span>
          ) : null}
          <span className="text-sm font-medium" style={{ color: 'var(--text-1)' }}>
            {cur.title}
          </span>
        </div>
        <div className="mt-1 text-xs" style={{ color: 'var(--text-3)' }}>
          {dateLabel(cur.date)} · {TYPE_LABEL[cur.planType]}
          {cur.category && cur.category !== 'other' ? ` · ${CAT_LABEL[cur.category] ?? cur.category}` : ''}
        </div>

        <div className="mt-3 flex items-center gap-2">
          <span className="flex-1" />
          <button type="button" className="glass-btn !px-3 !py-1.5 text-xs" onClick={close}>
            取消
          </button>
          <button
            type="button"
            className="glass-btn primary !px-3 !py-1.5 text-xs"
            disabled={busy}
            onClick={() => void confirm()}
          >
            {busy ? '添加中…' : '加到计划'}
          </button>
        </div>
        {queue.length > 1 ? (
          <div className="mt-2 text-2xs" style={{ color: 'var(--text-3)' }}>
            还有 {queue.length - 1} 条待确认
          </div>
        ) : null}
      </div>
    </div>
  )
}
