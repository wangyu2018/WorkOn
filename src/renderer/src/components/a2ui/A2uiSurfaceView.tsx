/**
 * A2UI 渲染层（受控 catalog：metric / table / timeline / steps / link）
 * - 只渲染校验后的结构，不注入 HTML
 * - P2：卡片 action 直接调 window.api 执行，结果就地回写（agentFunctionResponse）
 */
import { useState } from 'react'
import type { A2uiAction, A2uiCard, A2uiSurface } from '@shared/a2ui'
import { isPlanStatusArg } from '@shared/a2ui'
import { renderChart } from '@shared/viz/svg'
import { renderFlow } from '@shared/viz/flow'

const STATE_COLOR: Record<string, string> = {
  coding: '#3B82F6',
  aidev: '#6366F1',
  aiqa: '#A78BFA',
  writing: '#22D3EE',
  meeting: '#F59E0B',
  focus: '#10B981',
  slack: '#EF4444',
  relax: '#94A3B8',
  break: '#FBBF24',
  lunch: '#FB923C',
  remote: '#38BDF8'
}

async function runAction(action: A2uiAction): Promise<string> {
  const args = action.args ?? {}
  try {
    if (action.fn === 'open_view') {
      const view = String(args.view ?? 'home')
      window.api.openMain(view)
      return `已打开 ${view}`
    }
    if (action.fn === 'open_app') {
      const r = (await window.api.openApp(String(args.query ?? ''))) as { ok?: boolean; name?: string; error?: string }
      return r?.ok ? `已打开「${r.name ?? args.query}」` : `没找到「${String(args.query ?? '')}」`
    }
    if (action.fn === 'plan_status') {
      const id = String(args.id ?? '')
      const status = args.status
      if (!id || !isPlanStatusArg(status)) return '缺少计划 id 或状态不合法'
      await window.api.setPlanStatus(id, status)
      return status === 'done' ? '已标记完成' : '已更新计划状态'
    }
    if (action.fn === 'snooze_reminder') {
      const id = String(args.id ?? '')
      if (!id) return '缺少提醒 id'
      await window.api.snoozeReminder(id, typeof args.minutes === 'number' ? args.minutes : 10)
      return '已延后提醒'
    }
    if (action.fn === 'run_workflow') {
      const id = String(args.id ?? '')
      if (!id) return '缺少工作流 id'
      const rec = (await window.api.workflowRunById(id)) as { ok?: boolean; error?: string }
      return rec?.ok ? '工作流运行完成' : `工作流失败：${rec?.error ?? '未知原因'}`
    }
    if (action.fn === 'open_url') {
      const url = String(args.url ?? '')
      if (!/^https?:\/\//i.test(url)) return 'URL 不合法'
      await window.api.browserOpenExternal(url)
      return '已用浏览器打开'
    }
    return '不支持的动作'
  } catch (e) {
    return `执行失败：${(e as Error).message}`
  }
}

function ActionButton({
  action,
  result,
  busy,
  onRun
}: {
  action?: A2uiAction
  result?: string
  busy: boolean
  onRun: () => void
}) {
  if (!action) return null
  return (
    <div className="mt-1.5 flex items-center gap-2">
      <button
        className="rounded-md border border-white/[0.1] px-2 py-0.5 text-2xs text-slate-300 transition-colors hover:border-[var(--aura)] hover:text-white disabled:opacity-50"
        disabled={busy}
        onClick={onRun}
      >
        {busy ? '执行中…' : action.label}
      </button>
      {result ? <span className="text-2xs text-slate-500">{result}</span> : null}
    </div>
  )
}

function CardBody({ card }: { card: A2uiCard }) {
  if (card.type === 'metric') {
    return (
      <div className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
        <span className="min-w-0 truncate text-2xs text-slate-500">{card.label}</span>
        <span className="text-sm font-medium tabular-nums text-slate-100">
          {card.value}
          {card.unit ? <span className="ml-0.5 text-2xs text-slate-500">{card.unit}</span> : null}
        </span>
        {card.delta ? <span className="text-2xs text-slate-500">{card.delta}</span> : null}
        {card.hint ? <span className="w-full truncate text-2xs text-slate-600">{card.hint}</span> : null}
      </div>
    )
  }
  if (card.type === 'table') {
    return (
      <div className="min-w-0">
        {card.title ? <div className="mb-1 text-2xs text-slate-500">{card.title}</div> : null}
        {card.rows.length ? (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-2xs">
              <thead>
                <tr>
                  {card.columns.map((c) => (
                    <th key={c} className="border-b border-white/[0.08] px-1.5 py-1 text-left font-normal text-slate-500">
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {card.rows.map((row, ri) => (
                  <tr key={ri}>
                    {card.columns.map((c, ci) => (
                      <td key={c} className="border-b border-white/[0.04] px-1.5 py-1 tabular-nums text-slate-300">
                        {row[ci] ?? ''}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="text-2xs text-slate-600">{card.emptyText ?? '暂无数据'}</div>
        )}
      </div>
    )
  }
  if (card.type === 'timeline') {
    return (
      <div className="min-w-0">
        {card.title ? <div className="mb-1 text-2xs text-slate-500">{card.title}</div> : null}
        <div className="flex flex-col gap-1">
          {card.items.map((it, i) => (
            <div key={`${it.time}-${i}`} className="flex items-start gap-2">
              <span className="w-9 shrink-0 tabular-nums text-2xs text-slate-500">{it.time}</span>
              <span
                className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full"
                style={{ background: STATE_COLOR[it.state ?? ''] ?? 'var(--aura)' }}
              />
              <span className="min-w-0">
                <span className="text-xs text-slate-200">{it.title}</span>
                {it.detail ? <span className="ml-1 text-2xs text-slate-500">{it.detail}</span> : null}
              </span>
            </div>
          ))}
        </div>
      </div>
    )
  }
  if (card.type === 'steps') {
    return (
      <div className="min-w-0">
        {card.title ? <div className="mb-1 text-2xs text-slate-500">{card.title}</div> : null}
        <div className="flex flex-col gap-1">
          {card.items.map((it, i) => {
            const current = i === card.current
            const done = i < card.current
            return (
              <div key={`${it.title}-${i}`} className="flex items-start gap-2">
                <span
                  className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-2xs"
                  style={{
                    background: done ? 'var(--aura)' : current ? 'rgba(15,181,164,0.18)' : 'var(--surface-3)',
                    color: done ? '#fff' : current ? 'var(--aura)' : 'var(--text-3)'
                  }}
                >
                  {done ? '✓' : i + 1}
                </span>
                <span className="min-w-0">
                  <span className={`text-xs ${current ? 'text-slate-100' : done ? 'text-slate-400' : 'text-slate-400'}`}>
                    {it.title}
                  </span>
                  {it.detail ? <span className="ml-1 text-2xs text-slate-600">{it.detail}</span> : null}
                </span>
              </div>
            )
          })}
        </div>
      </div>
    )
  }
  if (card.type === 'chart') {
    return (
      <div className="min-w-0">
        {card.title ? <div className="mb-1 text-2xs text-slate-500">{card.title}</div> : null}
        <div
          dangerouslySetInnerHTML={{
            __html: renderChart(
              {
                kind: card.kind,
                points: card.points,
                matrix: card.matrix,
                rowLabels: card.rowLabels,
                colLabels: card.colLabels
              },
              { caption: card.caption, fg: '#E2E8F0', muted: '#94A3B8' }
            )
          }}
        />
      </div>
    )
  }
  if (card.type === 'compare') {
    return (
      <div className="min-w-0">
        {card.title ? <div className="mb-1 text-2xs text-slate-500">{card.title}</div> : null}
        <div className="grid grid-cols-[1fr_1fr] gap-x-1.5 text-2xs">
          <div className="text-slate-500">{card.columns[0]}</div>
          <div className="text-slate-500">{card.columns[1]}</div>
          {card.rows.map((r, i) => (
            <div key={`${r.label}-${i}`} className="col-span-2 grid grid-cols-[1fr_1fr] gap-x-1.5 border-t border-white/[0.05] py-1">
              <div className={r.highlight === 'left' ? 'text-neon-cyan' : 'text-slate-300'}>{r.left}</div>
              <div className={r.highlight === 'right' ? 'text-neon-cyan' : 'text-slate-300'}>{r.right}</div>
              <div className="col-span-2 text-2xs text-slate-600">{r.label}</div>
            </div>
          ))}
        </div>
      </div>
    )
  }
  if (card.type === 'flow') {
    return (
      <div className="min-w-0">
        {card.title ? <div className="mb-1 text-2xs text-slate-500">{card.title}</div> : null}
        <div
          dangerouslySetInnerHTML={{
            __html: renderFlow({ nodes: card.nodes, edges: card.edges }, { fg: '#E2E8F0', muted: '#94A3B8' })
          }}
        />
      </div>
    )
  }
  if (card.type === 'progress') {
    const pct = Math.max(0, Math.min(100, (card.current / card.total) * 100))
    return (
      <div className="min-w-0">
        <div className="flex items-baseline justify-between text-2xs text-slate-500">
          <span className="truncate">{card.label}</span>
          <span className="tabular-nums">
            {card.current}/{card.total}
            {card.unit ?? ''}
          </span>
        </div>
        <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-white/[0.08]">
          <div className="h-full rounded-full" style={{ width: `${pct}%`, background: 'var(--aura)' }} />
        </div>
      </div>
    )
  }
  if (card.type === 'image') {
    return (
      <figure className="min-w-0">
        <img src={card.src} alt={card.alt ?? ''} className="w-full rounded-lg" />
        {card.caption ? <figcaption className="mt-1 text-2xs text-slate-500">{card.caption}</figcaption> : null}
      </figure>
    )
  }
  if (card.type === 'kanban') {
    return (
      <div className="min-w-0">
        {card.title ? <div className="mb-1 text-2xs text-slate-500">{card.title}</div> : null}
        <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${card.columns.length}, minmax(0, 1fr))` }}>
          {card.columns.map((col) => (
            <div key={col.title} className="rounded-md bg-white/[0.03] p-1.5">
              <div className="mb-1 text-2xs text-slate-500">{col.title}</div>
              {col.items.map((it, i) => (
                <div key={`${it.title}-${i}`} className="mb-1 rounded border border-white/[0.06] px-1.5 py-1 text-2xs text-slate-300">
                  {it.title}
                  {it.tag ? <span className="ml-1 text-slate-600">#{it.tag}</span> : null}
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    )
  }
  // link
  return (
    <div className="flex min-w-0 items-center gap-2">
      <span className="min-w-0 truncate text-xs text-slate-200">{card.label}</span>
      <button
        className="ml-auto shrink-0 rounded-md border border-white/[0.1] px-2 py-0.5 text-2xs text-slate-300 transition-colors hover:border-[var(--aura)] hover:text-white"
        onClick={() => {
          if (/^https?:\/\//i.test(card.target)) void window.api.browserOpenExternal(card.target)
          else window.api.openMain(card.target)
        }}
      >
        打开
      </button>
      {card.hint ? <span className="shrink-0 text-2xs text-slate-600">{card.hint}</span> : null}
    </div>
  )
}

export function A2uiSurfaceView({ surface }: { surface: A2uiSurface }) {
  const [busyId, setBusyId] = useState<string | null>(null)
  const [results, setResults] = useState<Record<string, string>>({})

  return (
    <div className="mt-2 rounded-xl border border-white/[0.07] p-2" style={{ background: 'rgba(255,255,255,0.02)' }}>
      {surface.title ? <div className="mb-1.5 px-0.5 text-2xs text-slate-500">{surface.title}</div> : null}
      <div className="grid gap-1.5" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
        {surface.children.map((card) => (
          <div
            key={card.id}
            className="min-w-0 rounded-lg border border-white/[0.06] px-2 py-1.5"
            style={{
              background: 'var(--surface-2)',
              gridColumn: ['chart', 'flow', 'compare', 'kanban'].includes(card.type) ? '1 / -1' : undefined
            }}
          >
            <CardBody card={card} />
            {card.action ? (
              <ActionButton
                action={card.action}
                result={results[card.id]}
                busy={busyId === card.id}
                onRun={() => {
                  const action = card.action
                  if (!action) return
                  setBusyId(card.id)
                  void runAction(action).then((msg) => {
                    setBusyId(null)
                    setResults((r) => ({ ...r, [card.id]: msg }))
                  })
                }}
              />
            ) : null}
          </div>
        ))}
      </div>
    </div>
  )
}
