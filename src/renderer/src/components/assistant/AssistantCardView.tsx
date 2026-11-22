/**
 * 本地助手卡片：待办梳理 / 列表全览 / 天气 / 应用接管。
 * 数据由主进程 assistant:intent 计算好，这里只负责呈现与动作回写。
 */
import { useMemo, useState } from 'react'
import type { AssistantCard, AssistantListRow, AssistantTodoSuggestion } from '@shared/assistant'
import { Icon } from '../Icon'

function fmtMin(min: number): string {
  const total = Math.round(min)
  if (total < 60) return `${total}m`
  const h = Math.floor(total / 60)
  const m = total % 60
  return m > 0 ? `${h}h${m}m` : `${h}h`
}

const PLAN_STATUS_LABEL: Record<string, string> = {
  planned: '待办',
  in_progress: '进行中',
  partial: '部分完成',
  done: '已完成',
  delayed: '已延期',
  cancelled: '已取消'
}

export function AssistantCardView({ card }: { card: AssistantCard }): JSX.Element {
  if (card.kind === 'todo_cleanup') return <TodoCleanupCard card={card} />
  if (card.kind === 'list') return <ListCard card={card} />
  if (card.kind === 'weather') return <WeatherCard card={card} />
  return <AppCard card={card} />
}

/* ── 待办梳理 ── */
function TodoCleanupCard({ card }: { card: Extract<AssistantCard, { kind: 'todo_cleanup' }> }): JSX.Element {
  const [items, setItems] = useState<AssistantTodoSuggestion[]>(card.items)
  const [note, setNote] = useState('')
  const [showAll, setShowAll] = useState(false)

  const apply = async (item: AssistantTodoSuggestion, status: 'done' | 'cancelled' | 'planned'): Promise<void> => {
    try {
      await window.api.setPlanStatus(item.id, status)
      setItems((prev) => prev.filter((x) => x.id !== item.id))
      setNote(`已${status === 'done' ? '标记完成' : status === 'cancelled' ? '取消' : '保留'}：${item.title}`)
      window.setTimeout(() => setNote(''), 2400)
    } catch {
      setNote('操作失败，请重试')
    }
  }

  const visible = showAll ? items : items.slice(0, 6)
  return (
    <div className="mt-2 overflow-hidden rounded-xl" style={{ background: 'var(--surface-2)', border: '1px solid var(--line)' }}>
      <div className="flex flex-wrap items-center gap-2 px-3 pt-2.5">
        <span className="flex items-center gap-1.5 text-sm font-semibold text-slate-200">
          <Icon name="target" size={13} /> 待办梳理
        </span>
        <span className="text-2xs text-slate-500">
          {card.stats.total} 项 · 可完成 {card.stats.autoDone} · 可取消 {card.stats.cancel} · 保留 {card.stats.keep}
        </span>
      </div>
      <div className="mt-2 flex flex-col divide-y" style={{ borderColor: 'var(--line)' }}>
        {visible.map((item) => (
          <div key={item.id} className="px-3 py-2">
            <div className="flex items-start gap-2">
              <span
                className="mt-0.5 shrink-0 rounded px-1 py-px text-2xs"
                style={{
                  color: item.suggestion === 'auto_done' ? 'var(--teal)' : item.suggestion === 'cancel' ? '#f59e0b' : 'var(--text-3)',
                  background: item.suggestion === 'auto_done' ? 'var(--teal-soft)' : item.suggestion === 'cancel' ? 'rgba(245,158,11,.12)' : 'var(--surface-3)'
                }}
              >
                {item.suggestion === 'auto_done' ? '建议完成' : item.suggestion === 'cancel' ? '建议取消' : '建议保留'}
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm text-slate-200" title={item.title}>{item.title}</div>
                <div className="mt-0.5 text-2xs leading-relaxed text-slate-500">
                  {item.date ?? ''} · {item.evidence}
                </div>
              </div>
            </div>
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5 pl-1">
              <button className="glass-btn !px-2 !py-0.5 text-2xs" onClick={() => void apply(item, 'done')}>完成</button>
              <button className="glass-btn !px-2 !py-0.5 text-2xs" onClick={() => void apply(item, 'cancelled')}>取消</button>
              <button className="glass-btn !px-2 !py-0.5 text-2xs" onClick={() => void apply(item, 'planned')}>留着</button>
              <span className="ml-auto text-2xs tabular-nums text-slate-600">{Math.round(item.confidence * 100)}%</span>
            </div>
          </div>
        ))}
      </div>
      <div className="flex items-center gap-2 px-3 py-2">
        {items.length > 6 ? (
          <button className="glass-btn !px-2 !py-0.5 text-2xs" onClick={() => setShowAll((v) => !v)}>
            {showAll ? '收起' : `展开剩余 ${items.length - 6} 项`}
          </button>
        ) : null}
        {note ? <span className="text-2xs" style={{ color: 'var(--teal)' }}>{note}</span> : null}
      </div>
    </div>
  )
}

/* ── 列表全览 ── */
function ListCard({ card }: { card: Extract<AssistantCard, { kind: 'list' }> }): JSX.Element {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState('全部')

  const statuses = useMemo(() => {
    if (card.source === 'reminders') return ['全部', '开启', '暂停']
    return ['全部', '待办', '进行中', '部分完成', '已延期', '已完成', '已取消']
  }, [card.source])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return card.rows.filter((r) => {
      if (status !== '全部' && PLAN_STATUS_LABEL[r.status ?? ''] !== status && r.status !== status) return false
      if (!q) return true
      return r.title.toLowerCase().includes(q) || r.meta.toLowerCase().includes(q)
    })
  }, [card.rows, query, status])

  return (
    <div className="mt-2 overflow-hidden rounded-xl" style={{ background: 'var(--surface-2)', border: '1px solid var(--line)' }}>
      <div className="flex flex-wrap items-center gap-2 px-3 pt-2.5">
        <span className="flex items-center gap-1.5 text-sm font-semibold text-slate-200">
          <Icon name="book" size={13} /> {card.title}
        </span>
        <span className="text-2xs text-slate-500">{card.rows.length} 条</span>
        <button className="glass-btn ml-auto !px-2 !py-0.5 text-2xs" onClick={() => setOpen(true)}>展开全览</button>
      </div>
      <div className="mt-1.5 flex flex-col divide-y" style={{ borderColor: 'var(--line)' }}>
        {card.rows.slice(0, 5).map((r) => (
          <div key={r.id} className="flex items-center gap-2 px-3 py-1.5">
            <span className="min-w-0 flex-1 truncate text-sm text-slate-300">{r.title}</span>
            <span className="shrink-0 text-2xs text-slate-500">{r.meta}</span>
          </div>
        ))}
        {card.rows.length === 0 ? <div className="px-3 py-3 text-sm text-slate-500">还没有记录</div> : null}
      </div>
      {card.rows.length > 5 ? (
        <button className="w-full px-3 py-1.5 text-left text-2xs text-slate-500 hover:text-slate-300" onClick={() => setOpen(true)}>
          还有 {card.rows.length - 5} 条 · 展开全览
        </button>
      ) : null}

      {open ? (
        <div className="fixed inset-0 z-[80] flex items-center justify-center p-6" style={{ background: 'rgba(0,0,0,.45)' }} onClick={() => setOpen(false)}>
          <div
            className="flex max-h-[78vh] w-full max-w-[720px] flex-col overflow-hidden rounded-2xl"
            style={{ background: 'var(--bg-surface)', border: '1px solid var(--line)', boxShadow: 'var(--shadow-lg)' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2 border-b px-4 py-3" style={{ borderColor: 'var(--line)' }}>
              <span className="text-base font-semibold text-slate-100">{card.title} · 全览</span>
              <span className="text-xs text-slate-500">{filtered.length} / {card.rows.length}</span>
              <button className="ui-icon-btn ml-auto h-7 w-7" title="关闭" onClick={() => setOpen(false)}>
                <Icon name="x" size={13} />
              </button>
            </div>
            <div className="flex flex-wrap items-center gap-2 px-4 py-2.5" style={{ borderBottom: '1px solid var(--line)' }}>
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="搜索标题 / 日期 / 状态…"
                className="h-8 min-w-[180px] flex-1 rounded-lg border bg-transparent px-2.5 text-sm text-slate-200 outline-none"
                style={{ borderColor: 'var(--line)' }}
              />
              <div className="flex flex-wrap gap-1">
                {statuses.map((s) => (
                  <button
                    key={s}
                    onClick={() => setStatus(s)}
                    className="rounded-full px-2 py-0.5 text-2xs"
                    style={{
                      background: status === s ? 'var(--teal-soft)' : 'var(--surface-2)',
                      color: status === s ? 'var(--teal)' : 'var(--text-3)',
                      border: `1px solid ${status === s ? 'var(--teal-border)' : 'var(--line)'}`
                    }}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">
              {filtered.map((r) => (
                <div key={r.id} className="flex items-center gap-2 border-b px-4 py-2" style={{ borderColor: 'var(--line)' }}>
                  <span className="min-w-0 flex-1 truncate text-sm text-slate-200">{r.title}</span>
                  <span className="shrink-0 text-2xs text-slate-500">{r.meta}</span>
                </div>
              ))}
              {filtered.length === 0 ? <div className="px-4 py-6 text-center text-sm text-slate-500">没有匹配项</div> : null}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}

/* ── 天气卡 ── */
function WeatherCard({ card }: { card: Extract<AssistantCard, { kind: 'weather' }> }): JSX.Element {
  return (
    <div className="mt-2 overflow-hidden rounded-xl" style={{ background: 'var(--surface-2)', border: '1px solid var(--line)' }}>
      <div className="flex items-end gap-3 px-3 pt-3">
        <div>
          <div className="text-2xs text-slate-500">{card.city}</div>
          <div className="flex items-end gap-2">
            <span className="text-2xl leading-none text-slate-100">{Math.round(card.now.tempC)}°</span>
            <span className="pb-0.5 text-sm text-slate-300">{card.now.text}</span>
          </div>
        </div>
        <div className="ml-auto text-right text-2xs leading-relaxed text-slate-500">
          <div>体感 {Math.round(card.now.feelsC)}° · 湿度 {card.now.humidity}%</div>
          <div>今日 {Math.round(card.now.minC)}~{Math.round(card.now.maxC)}° · 风 {Math.round(card.now.windKph)}km/h</div>
        </div>
      </div>
      <div className="mt-3 flex gap-2 overflow-x-auto px-3 pb-2">
        {card.hours.map((h) => (
          <div key={h.hour} className="flex min-w-[52px] flex-col items-center gap-0.5 rounded-lg px-1.5 py-1.5" style={{ background: 'var(--surface-3)' }}>
            <span className="text-2xs text-slate-500">{String(h.hour).padStart(2, '0')}:00</span>
            <span className="text-sm text-slate-200">{Math.round(h.tempC)}°</span>
            <span className="text-2xs text-slate-500">{h.text}</span>
            {h.chanceOfRain > 0 ? <span className="text-2xs" style={{ color: 'var(--teal)' }}>{h.chanceOfRain}%</span> : null}
          </div>
        ))}
      </div>
      <div className="border-t px-3 py-2 text-2xs text-slate-500" style={{ borderColor: 'var(--line)' }}>
        明天 {card.tomorrow.text} · {Math.round(card.tomorrow.minC)}~{Math.round(card.tomorrow.maxC)}°
      </div>
    </div>
  )
}

/* ── 应用接管卡 ── */
function AppCard({ card }: { card: Extract<AssistantCard, { kind: 'app' }> }): JSX.Element {
  const [note, setNote] = useState('')
  const act = async (action: string): Promise<void> => {
    if (action === '开启消息监控') {
      try {
        await window.api.setSettings({ messageWatchEnabled: true })
        setNote('消息监控已开启：新来件会进对话流')
      } catch {
        setNote('开启失败，请到设置里手动打开')
      }
      return
    }
    try {
      const r = await window.api.openApp(card.app)
      setNote(r?.ok ? '已打开' : r?.error ?? '打开失败')
    } catch (e) {
      setNote((e as Error).message)
    }
  }
  return (
    <div className="mt-2 overflow-hidden rounded-xl" style={{ background: 'var(--surface-2)', border: '1px solid var(--line)' }}>
      <div className="flex items-center gap-2 px-3 pt-2.5">
        <span className="flex items-center gap-1.5 text-sm font-semibold text-slate-200">
          <Icon name="folder" size={13} /> {card.display}
        </span>
        <span className="rounded-full px-1.5 py-px text-2xs" style={{ background: 'var(--surface-3)', color: 'var(--text-3)' }}>{card.category}</span>
        {card.im ? <span className="rounded-full px-1.5 py-px text-2xs" style={{ background: 'var(--teal-soft)', color: 'var(--teal)' }}>可接管</span> : null}
      </div>
      <div className="mt-2 grid grid-cols-3 gap-2 px-3">
        <div className="rounded-lg px-2 py-1.5" style={{ background: 'var(--surface-3)' }}>
          <div className="text-2xs text-slate-500">今日</div>
          <div className="text-sm text-slate-200">{fmtMin(card.minutes)}</div>
        </div>
        <div className="rounded-lg px-2 py-1.5" style={{ background: 'var(--surface-3)' }}>
          <div className="text-2xs text-slate-500">段数</div>
          <div className="text-sm text-slate-200">{card.segments}</div>
        </div>
        <div className="rounded-lg px-2 py-1.5" style={{ background: 'var(--surface-3)' }}>
          <div className="text-2xs text-slate-500">最近</div>
          <div className="text-sm text-slate-200">{card.lastHM}</div>
        </div>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1.5 px-3 pb-2.5">
        {card.actions.map((a) => (
          <button key={a} className={`text-2xs ${a === '开启消息监控' ? 'glass-btn primary !px-2 !py-1' : 'glass-btn !px-2 !py-1'}`} onClick={() => void act(a)}>
            {a}
          </button>
        ))}
        <span className="text-2xs text-slate-500">主导状态：{card.stateLabel}</span>
        {note ? <span className="text-2xs" style={{ color: 'var(--teal)' }}>{note}</span> : null}
      </div>
    </div>
  )
}
