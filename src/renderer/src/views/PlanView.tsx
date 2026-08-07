import { useCallback, useEffect, useState } from 'react'
import type { CustomCategory, PlanCategory, PlanForecast, PlanItem, PlanStatus, PlanVsActual, WorkState } from '@shared/types'
import { ALL_STATES, WORK_STATES } from '@shared/stateMeta'
import { Icon } from '../components/Icon'
import { EmptyState } from '../components/EmptyState'
import { ProgressRing } from '../components/ProgressRing'
import { addDays, clockOf, fmtDateLabel, fmtMin, timeToMin, todayKey } from '../components/utils'
import { parsePlanText } from '../components/parsePlanText'

const STATUS_LABEL: Record<PlanStatus, string> = {
  planned: '待办',
  in_progress: '进行中',
  partial: '部分完成',
  done: '已完成',
  delayed: '已延期',
  cancelled: '已取消'
}

const CAT_COLORS = ['#8B5CF6', '#3B82F6', '#F59E0B', '#10B981', '#EC4899', '#22D3EE', '#FBBF24', '#64748B']

/** 计划来源标记（浏览器确认 🌐 / 手动确认 💬 / 手动创建 ✏️ / 其他同步源） */
function SourceMark({ plan }: { plan: PlanItem }) {
  if (plan.browserDerived) return <span className="chip !py-0" title="浏览器行为确认">🌐 浏览器确认</span>
  if (plan.confirmedFromQA) return <span className="chip !py-0" title="问答确认">💬 确认记录</span>
  if (plan.source === 'manual') return <span className="chip !py-0" title="手动创建">✏️ 手动</span>
  return <span className="chip !py-0">{plan.source}</span>
}

/* ── 新建分类弹窗 ── */
function CategoryForm({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [label, setLabel] = useState('')
  const [color, setColor] = useState(CAT_COLORS[0])
  const [emoji, setEmoji] = useState('📌')
  const [hints, setHints] = useState<Set<string>>(new Set())

  const toggleHint = (s: string) => {
    setHints((prev) => {
      const next = new Set(prev)
      if (next.has(s)) next.delete(s)
      else next.add(s)
      return next
    })
  }

  const save = async () => {
    if (!label.trim()) return
    await window.api.createCategory({ label: label.trim(), color, emoji: emoji.trim() || '📌', stateHints: [...hints] })
    onSaved()
    onClose()
  }

  return (
    <div className="anim-fade-in fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div className="glass-card anim-scale-in w-[400px]" onClick={(e) => e.stopPropagation()}>
        <h3 className="mb-4 flex items-center gap-2.5 text-[15px] font-semibold text-slate-100">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg border border-white/[0.08] bg-neon-cyan/10 text-neon-cyan">
            <Icon name="plus" size={14} />
          </span>
          新建分类
        </h3>
        <div className="flex flex-col gap-3.5">
          <div className="grid grid-cols-[1fr_64px] gap-2">
            <input
              className="glass-input"
              placeholder="分类名称（如 学习提升）"
              autoFocus
              value={label}
              onChange={(e) => setLabel(e.target.value)}
            />
            <input
              className="glass-input text-center"
              placeholder="emoji"
              maxLength={4}
              value={emoji}
              onChange={(e) => setEmoji(e.target.value)}
            />
          </div>
          <div>
            <div className="mb-1.5 text-[11px] font-medium text-slate-500">颜色</div>
            <div className="flex gap-1.5">
              {CAT_COLORS.map((c) => (
                <button
                  key={c}
                  className={`h-6 w-6 rounded-full transition-transform ${color === c ? 'scale-125 ring-2 ring-white/40' : 'hover:scale-110'}`}
                  style={{ background: c, boxShadow: color === c ? `0 0 10px ${c}` : undefined }}
                  onClick={() => setColor(c)}
                />
              ))}
            </div>
          </div>
          <div>
            <div className="mb-1.5 text-[11px] font-medium text-slate-500">关联工作状态（计划 vs 实际匹配用，可多选）</div>
            <div className="grid grid-cols-4 gap-1.5">
              {ALL_STATES.map((s) => {
                const m = WORK_STATES[s]
                const active = hints.has(s)
                return (
                  <button
                    key={s}
                    className={`rounded-lg border px-1 py-1 text-[11px] transition-all ${
                      active ? 'border-neon-cyan/60 bg-neon-cyan/10 text-slate-100 shadow-glow' : 'border-white/[0.07] text-slate-400 hover:bg-white/[0.05]'
                    }`}
                    onClick={() => toggleHint(s)}
                  >
                    {m.emoji} {m.label}
                  </button>
                )
              })}
            </div>
          </div>
          <div className="mt-1 flex items-center justify-end gap-2 border-t border-white/[0.06] pt-3">
            <button className="glass-btn" onClick={onClose}>
              取消
            </button>
            <button className="glass-btn primary" disabled={!label.trim()} onClick={() => void save()}>
              <Icon name="check" size={13} /> 创建
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

/* ── 新建 / 编辑弹窗 ── */
interface PlanEditorProps {
  plan: Partial<PlanItem> & { date: string }
  isNew: boolean
  cats: CustomCategory[]
  onNewCategory: () => void
  onClose: () => void
  onSaved: (savedDate: string) => void
}

function PlanEditor({ plan, isNew, cats, onNewCategory, onClose, onSaved }: PlanEditorProps) {
  const [title, setTitle] = useState(plan.title ?? '')
  const [category, setCategory] = useState<PlanCategory>(plan.category ?? 'other')
  const [planDate, setPlanDate] = useState(plan.date)
  const [start, setStart] = useState(plan.startMin !== undefined ? clockOf(plan.startMin) : '')
  const [end, setEnd] = useState(plan.endMin !== undefined ? clockOf(plan.endMin) : '')
  const [duration, setDuration] = useState(plan.durationMin !== undefined ? String(plan.durationMin) : '')
  const [note, setNote] = useState(plan.note ?? '')
  const [smartText, setSmartText] = useState('')
  const [smartHint, setSmartHint] = useState('')

  /** 一句话智能解析：把识别到的字段填入表单（用户可再改） */
  const applySmartParse = () => {
    const text = smartText.trim()
    if (!text) return
    const r = parsePlanText(text)
    if (r.matched.length === 0) {
      setTitle(r.title)
      setSmartHint('没识别到日期/时间，已按原文填入标题')
      return
    }
    if (r.date) setPlanDate(r.date)
    if (r.startMin !== undefined) setStart(clockOf(r.startMin))
    if (r.endMin !== undefined) setEnd(clockOf(r.endMin))
    if (r.durationMin !== undefined && r.startMin === undefined) setDuration(String(r.durationMin))
    setTitle(r.title)
    setSmartHint(`已识别：${r.matched.join(' · ')}`)
  }

  const save = async () => {
    const t = title.trim()
    if (!t) return
    const startMin = timeToMin(start)
    const endMin = timeToMin(end)
    const savedDate = planDate || plan.date
    const payload: Record<string, unknown> = {
      ...plan,
      date: savedDate,
      title: t,
      category,
      note: note.trim() || undefined
    }
    if (startMin !== undefined && endMin !== undefined && endMin > startMin) {
      payload.startMin = startMin
      payload.endMin = endMin
      payload.durationMin = endMin - startMin
    } else {
      payload.startMin = undefined
      payload.endMin = undefined
      const dur = Number(duration)
      payload.durationMin = Number.isFinite(dur) && dur > 0 ? Math.round(dur) : undefined
    }
    await window.api.savePlan(payload)
    onSaved(savedDate)
    onClose()
  }

  return (
    <div className="anim-fade-in fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div className="glass-card anim-scale-in w-[400px]" onClick={(e) => e.stopPropagation()}>
        <h3 className="mb-4 flex items-center gap-2.5 text-[15px] font-semibold text-slate-100">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg border border-white/[0.08] bg-neon-cyan/10 text-neon-cyan">
            <Icon name={isNew ? 'plus' : 'edit'} size={14} />
          </span>
          {isNew ? '新建计划' : '编辑计划'}
        </h3>
        <div className="flex flex-col gap-3.5">
          {isNew ? (
            <div>
              <div className="flex gap-2">
                <input
                  className="glass-input flex-1"
                  placeholder="试试：明天下午3点提醒我开会 / 周五下班前完成作业"
                  autoFocus
                  value={smartText}
                  onChange={(e) => setSmartText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') applySmartParse()
                    if (e.key === 'Escape') onClose()
                  }}
                />
                <button className="glass-btn" disabled={!smartText.trim()} onClick={applySmartParse}>
                  <Icon name="brain" size={13} /> 解析
                </button>
              </div>
              {smartHint ? <div className="mt-1.5 text-[11px] text-neon-cyan">{smartHint}</div> : null}
            </div>
          ) : null}
          <input
            className="glass-input"
            placeholder="计划做什么？"
            autoFocus={!isNew}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void save()
              if (e.key === 'Escape') onClose()
            }}
          />
          <div>
            <div className="mb-1.5 flex items-center justify-between text-[11px] font-medium text-slate-500">
              <span>类别</span>
              <button className="glass-btn !px-1.5 !py-0.5 !text-[10px]" onClick={onNewCategory}>
                <Icon name="plus" size={11} /> 新建分类
              </button>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {cats.map((c) => {
                const active = category === c.id
                return (
                  <button
                    key={c.id}
                    className={`rounded-full border px-2.5 py-1 text-[11px] transition-all ${
                      active ? 'text-slate-100' : 'border-white/[0.08] text-slate-400 hover:bg-white/[0.05]'
                    }`}
                    style={active ? { borderColor: c.color, background: `${c.color}22`, boxShadow: `0 0 10px ${c.color}33` } : undefined}
                    onClick={() => setCategory(c.id)}
                  >
                    {c.emoji} {c.label}
                  </button>
                )
              })}
            </div>
          </div>
          <label className="text-[11px] font-medium text-slate-500">
            日期
            <input type="date" className="glass-input mt-1" value={planDate} onChange={(e) => setPlanDate(e.target.value)} />
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className="text-[11px] font-medium text-slate-500">
              开始（可选）
              <input type="time" className="glass-input mt-1" value={start} onChange={(e) => setStart(e.target.value)} />
            </label>
            <label className="text-[11px] font-medium text-slate-500">
              结束（可选）
              <input type="time" className="glass-input mt-1" value={end} onChange={(e) => setEnd(e.target.value)} />
            </label>
          </div>
          <label className="text-[11px] font-medium text-slate-500">
            或时长（分钟）
            <input
              type="number"
              min={0}
              className="glass-input mt-1"
              placeholder="如 120"
              value={duration}
              onChange={(e) => setDuration(e.target.value)}
            />
          </label>
          <textarea
            className="glass-input resize-none"
            rows={2}
            placeholder="备注（可选）"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <div className="mt-1 flex items-center justify-end gap-2 border-t border-white/[0.06] pt-3">
            <button className="glass-btn" onClick={onClose}>
              取消
            </button>
            <button className="glass-btn primary" disabled={!title.trim()} onClick={() => void save()}>
              <Icon name="check" size={13} /> 保存
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

/* ── 计划视图 ── */
export default function PlanView() {
  const [date, setDate] = useState(todayKey())
  const [plans, setPlans] = useState<PlanItem[]>([])
  const [pva, setPva] = useState<PlanVsActual | null>(null)
  const [cats, setCats] = useState<CustomCategory[]>([])
  const [forecasts, setForecasts] = useState<Map<string, PlanForecast>>(new Map())
  const [catFilter, setCatFilter] = useState<'all' | PlanCategory>('all')
  const [statusFilter, setStatusFilter] = useState<'all' | PlanStatus>('all')
  const [editor, setEditor] = useState<{ plan: Partial<PlanItem> & { date: string }; isNew: boolean } | null>(null)
  const [catForm, setCatForm] = useState(false)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [delayOpen, setDelayOpen] = useState<string | null>(null)
  const [delayDate, setDelayDate] = useState('')
  const [delayReason, setDelayReason] = useState('')

  const loadCats = useCallback(async () => {
    try {
      setCats(((await window.api.listCategories()) as CustomCategory[]) ?? [])
    } catch {
      setCats([])
    }
  }, [])

  const load = useCallback(async () => {
    try {
      const [ps, pv, fc] = await Promise.all([
        window.api.listPlans(date),
        window.api.planVsActual(date),
        window.api.getForecast(date).catch(() => [])
      ])
      setPlans((ps as PlanItem[]) ?? [])
      setPva(pv as PlanVsActual)
      setForecasts(new Map(((fc as PlanForecast[]) ?? []).map((f) => [f.planId, f])))
    } catch {
      setPlans([])
      setPva(null)
    }
  }, [date])

  useEffect(() => {
    void loadCats()
  }, [loadCats])

  useEffect(() => {
    void load()
  }, [load])

  // 问答确认创建计划后实时刷新
  useEffect(() => window.api.onPlanUpdated(() => void load()), [load])

  const toggleDone = async (p: PlanItem) => {
    await window.api.setPlanStatus(p.id, p.status === 'done' ? 'planned' : 'done')
    void load()
  }

  const remove = async (p: PlanItem) => {
    await window.api.removePlan(p.id)
    void load()
  }

  const removeCategory = async (c: CustomCategory) => {
    await window.api.deleteCategory(c.id)
    void loadCats()
    void load()
  }

  const catOf = (id: string): CustomCategory =>
    cats.find((c) => c.id === id) ?? { id, label: id, color: '#64748B', emoji: '📋', isBuiltIn: false, ts: 0 }

  const filtered = plans
    .filter((p) => (catFilter === 'all' ? true : p.category === catFilter))
    .filter((p) => (statusFilter === 'all' ? true : p.status === statusFilter))
    .sort((a, b) => (a.startMin ?? 9999) - (b.startMin ?? 9999))

  const achievement = pva ? Math.min(100, pva.achievement) : 0
  const ringColor = achievement >= 80 ? '#10B981' : achievement >= 50 ? '#F59E0B' : '#EF4444'
  const forecastList = [...forecasts.values()]
  const avgProb = forecastList.length ? Math.round(forecastList.reduce((a, f) => a + f.completionProb, 0) / forecastList.length) : null
  const riskCount = forecastList.filter((f) => f.completionProb < 40).length

  return (
    <div className="view-enter flex flex-col gap-5">
      {/* 页面标题区 */}
      <header className="flex items-center gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-white/[0.08] bg-white/[0.04] text-neon-cyan shadow-glow">
          <Icon name="target" size={20} />
        </div>
        <div className="min-w-0">
          <h1 className="text-[17px] font-bold tracking-wide text-slate-100">每日计划</h1>
          <p className="mt-0.5 text-[11px] text-slate-500">安排目标 · 跟踪达成率与完成预测</p>
        </div>
        <div className="flex-1" />
        <button className="glass-btn primary" onClick={() => setEditor({ plan: { date }, isNew: true })}>
          <Icon name="plus" size={14} /> 新建计划
        </button>
      </header>

      {/* 日期工具条 */}
      <div className="anim-fade-up flex items-center gap-2" style={{ animationDelay: '60ms' }}>
        <div className="flex items-center gap-1 rounded-xl border border-white/[0.06] bg-white/[0.03] p-1">
          <button className="glass-btn !border-transparent !bg-transparent !px-2" onClick={() => setDate((d) => addDays(d, -1))}>
            <Icon name="chevronLeft" size={14} />
          </button>
          <button className="glass-btn !border-transparent !bg-transparent" onClick={() => setDate(todayKey())}>
            今天
          </button>
          <button className="glass-btn !border-transparent !bg-transparent !px-2" onClick={() => setDate((d) => addDays(d, 1))}>
            <Icon name="chevronRight" size={14} />
          </button>
        </div>
        <span className="ml-1 flex items-center gap-2 text-[15px] font-semibold text-slate-200">
          <Icon name="calendar" size={14} className="text-neon-cyan" />
          {fmtDateLabel(date)}
        </span>
      </div>

      {/* 计划 vs 实际 + 预测汇总 */}
      <section className="glass-card anim-fade-up flex items-center gap-6 !p-5" style={{ animationDelay: '120ms' }}>
        <ProgressRing value={achievement} size={110} stroke={9} color={ringColor}>
          <div className="text-center">
            <div className="text-2xl font-bold leading-none text-slate-100">{Math.round(achievement)}%</div>
            <div className="mt-1 text-[10px] text-slate-500">达成率</div>
          </div>
        </ProgressRing>
        <div className="grid flex-1 grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded-xl border border-white/[0.05] bg-white/[0.03] px-3 py-2.5">
            <div className="text-lg font-bold leading-tight text-slate-100">{pva ? fmtMin(pva.plannedMin) : '—'}</div>
            <div className="mt-0.5 flex items-center gap-1 text-[11px] text-slate-500">
              <Icon name="calendar" size={11} /> 计划时长
            </div>
          </div>
          <div className="rounded-xl border border-white/[0.05] bg-white/[0.03] px-3 py-2.5">
            <div className="text-lg font-bold leading-tight text-neon-green">{pva ? fmtMin(pva.actualWorkMin) : '—'}</div>
            <div className="mt-0.5 flex items-center gap-1 text-[11px] text-slate-500">
              <Icon name="activity" size={11} /> 实际工作
            </div>
          </div>
          <div className="rounded-xl border border-white/[0.05] bg-white/[0.03] px-3 py-2.5">
            <div className="text-lg font-bold leading-tight text-neon-cyan">{pva ? `${pva.matchedCount} 项` : '—'}</div>
            <div className="mt-0.5 flex items-center gap-1 text-[11px] text-slate-500">
              <Icon name="check" size={11} /> 被实际覆盖
            </div>
          </div>
          <div className="rounded-xl border border-white/[0.05] bg-white/[0.03] px-3 py-2.5">
            <div className={`text-lg font-bold leading-tight ${riskCount > 0 ? 'text-neon-red' : 'text-neon-green'}`}>
              {avgProb !== null ? `${avgProb}%${riskCount > 0 ? ` · ${riskCount} 风险` : ''}` : '—'}
            </div>
            <div className="mt-0.5 flex items-center gap-1 text-[11px] text-slate-500">
              <Icon name="brain" size={11} /> 完成概率均值
            </div>
          </div>
        </div>
      </section>

      {/* 筛选 */}
      <div className="anim-fade-up flex flex-wrap items-center gap-2" style={{ animationDelay: '180ms' }}>
        <span className="mr-0.5 flex items-center gap-1 text-[11px] font-medium text-slate-500">
          <Icon name="sliders" size={12} /> 筛选
        </span>
        <button
          className={`chip ${catFilter === 'all' ? '!border-neon-cyan/50 !text-neon-cyan' : ''}`}
          onClick={() => setCatFilter('all')}
        >
          全部类别
        </button>
        {cats.map((c) => (
          <button
            key={c.id}
            className={`chip group ${catFilter === c.id ? '!text-slate-100' : ''}`}
            style={catFilter === c.id ? { borderColor: c.color, background: `${c.color}22` } : undefined}
            onClick={() => setCatFilter(catFilter === c.id ? 'all' : c.id)}
            title={c.isBuiltIn ? c.label : `${c.label}（自定义，双击删除）`}
            onDoubleClick={() => {
              if (!c.isBuiltIn) void removeCategory(c)
            }}
          >
            {c.emoji} {c.label}
          </button>
        ))}
        <button className="chip !border-dashed" title="新建分类" onClick={() => setCatForm(true)}>
          <Icon name="plus" size={11} />
        </button>
        <span className="mx-1 h-4 w-px bg-white/10" />
        {(['all', 'planned', 'in_progress', 'done', 'delayed', 'cancelled'] as const).map((s) => (
          <button
            key={s}
            className={`chip ${statusFilter === s ? '!border-neon-cyan/50 !text-neon-cyan' : ''}`}
            onClick={() => setStatusFilter(s)}
          >
            {s === 'all' ? '全部状态' : STATUS_LABEL[s]}
          </button>
        ))}
      </div>

      {/* 计划列表 */}
      {filtered.length === 0 ? (
        <div className="glass-card hoverable anim-fade-up" style={{ animationDelay: '240ms' }}>
          <EmptyState
            emoji="🎯"
            title={plans.length === 0 ? '这一天还没有计划' : '没有符合筛选的计划'}
            hint={plans.length === 0 ? '点击右上角「新建计划」，或在命令面板（Ctrl+K）里快速录入。' : '换个筛选条件试试。'}
          />
        </div>
      ) : (
        <div className="flex flex-col gap-2.5">
          {filtered.map((p, idx) => {
            const cat = catOf(p.category)
            const done = p.status === 'done'
            const cancelled = p.status === 'cancelled'
            const fc = forecasts.get(p.id)
            const isExpanded = expanded === p.id
            return (
              <div
                key={p.id}
                className="glass-card hoverable anim-fade-up !p-3.5"
                style={{ animationDelay: `${240 + Math.min(idx * 40, 240)}ms`, borderLeftWidth: 3, borderLeftColor: `${cat.color}88` }}
              >
                <div className="flex items-center gap-3">
                  <button
                    className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md border transition-all ${
                      done ? 'border-neon-green bg-neon-green/20 text-neon-green shadow-glow' : 'border-white/20 text-transparent hover:scale-110 hover:border-neon-green/60'
                    }`}
                    style={{ transitionDuration: '150ms' }}
                    title={done ? '标记为待办' : '标记完成'}
                    onClick={() => void toggleDone(p)}
                  >
                    <Icon name="check" size={12} />
                  </button>
                  <button className="min-w-0 flex-1 text-left" onClick={() => setExpanded(isExpanded ? null : p.id)}>
                    <div className={`text-[13px] font-medium ${done || cancelled ? 'text-slate-500 line-through' : 'text-slate-200'}`}>{p.title}</div>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
                      <span className="chip !py-0" style={{ borderColor: `${cat.color}55`, color: cat.color }}>
                        {cat.emoji} {cat.label}
                      </span>
                      {p.startMin !== undefined && p.endMin !== undefined ? (
                        <span className="flex items-center gap-1">
                          <Icon name="clock" size={11} />
                          {clockOf(p.startMin)}–{clockOf(p.endMin)}
                        </span>
                      ) : null}
                      {p.durationMin !== undefined ? <span>{fmtMin(p.durationMin)}</span> : null}
                      <SourceMark plan={p} />
                      {fc && !done ? (
                        <span
                          className={`chip !py-0 ${
                            fc.completionProb > 70 ? '!border-neon-green/50 !text-neon-green' : fc.completionProb >= 40 ? '!border-neon-amber/50 !text-neon-amber' : '!border-neon-red/50 !text-neon-red'
                          }`}
                        >
                          {fc.completionProb > 70 ? '大概率完成' : fc.completionProb >= 40 ? '有风险' : '可能延期'} {fc.completionProb}%
                        </span>
                      ) : null}
                      {cancelled ? <span className="text-slate-600">已取消</span> : null}
                    </div>
                    {p.note ? <div className="mt-0.5 truncate text-[11px] text-slate-600">{p.note}</div> : null}
                  </button>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <button className="glass-btn !px-2 !py-1" title="编辑" onClick={() => setEditor({ plan: p, isNew: false })}>
                      <Icon name="edit" size={13} />
                    </button>
                    <button className="glass-btn danger !px-2 !py-1" title="删除" onClick={() => void remove(p)}>
                      <Icon name="trash" size={13} />
                    </button>
                  </div>
                </div>
                {/* 展开面板：预测详情 + 完成比例拖动 + 延期 */}
                {isExpanded ? (
                  <div className="anim-fade-in mt-3 border-t border-white/[0.06] pt-3">
                    {fc ? (
                      <>
                        <div className="mb-2 flex items-center gap-3 text-[11px]">
                          <div className="flex-1">
                            <div className="mb-1 flex justify-between text-slate-500">
                              <span>完成概率</span>
                              <span className="font-semibold text-neon-green">{fc.completionProb}%</span>
                            </div>
                            <div className="h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
                              <div
                                className="h-full rounded-full bg-neon-green transition-all duration-300"
                                style={{ width: `${fc.completionProb}%`, boxShadow: '0 0 8px rgba(16, 185, 129, 0.5)' }}
                              />
                            </div>
                          </div>
                          <div className="flex-1">
                            <div className="mb-1 flex justify-between text-slate-500">
                              <span>延期概率</span>
                              <span className="font-semibold text-neon-red">{fc.delayProb}%</span>
                            </div>
                            <div className="h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
                              <div
                                className="h-full rounded-full bg-neon-red transition-all duration-300"
                                style={{ width: `${fc.delayProb}%`, boxShadow: '0 0 8px rgba(239, 68, 68, 0.5)' }}
                              />
                            </div>
                          </div>
                        </div>
                        <div className="flex flex-col gap-1 text-[11px]">
                          {fc.factors.map((f, i) => (
                            <div key={i} className="flex items-center gap-2 rounded-lg bg-white/[0.02] px-2 py-1">
                              <span>{f.impact === 'positive' ? '➕' : f.impact === 'negative' ? '➖' : '➗'}</span>
                              <span className="w-20 shrink-0 text-slate-400">{f.label}</span>
                              <span className="text-slate-500">{f.detail}</span>
                            </div>
                          ))}
                        </div>
                        <div className="mt-2 flex items-center justify-between text-[11px]">
                          <span className="text-neon-cyan">💡 {fc.recommendation}</span>
                          {fc.estimatedEndMin !== undefined ? (
                            <span className="text-slate-500">预计 {clockOf(Math.min(1439, fc.estimatedEndMin))} 完成</span>
                          ) : null}
                        </div>
                      </>
                    ) : null}
                    {/* 完成比例拖动（半完成管理） */}
                    <div className="mt-2 flex items-center gap-2 border-t border-white/[0.05] pt-2.5">
                      <span className="w-16 shrink-0 text-[11px] text-slate-500">完成比例</span>
                      <input
                        type="range"
                        min={0}
                        max={100}
                        step={5}
                        value={Math.round((p.completionRatio ?? (done ? 1 : 0)) * 100)}
                        className="flex-1"
                        onChange={(e) => {
                          void window.api.updatePlanProgress(p.id, Number(e.target.value) / 100).then(() => void load())
                        }}
                      />
                      <span className="w-10 text-right text-[11px] font-semibold text-neon-cyan">
                        {Math.round((p.completionRatio ?? (done ? 1 : 0)) * 100)}%
                      </span>
                    </div>
                    {/* 延期到指定日期 */}
                    {!done && !cancelled ? (
                      <div className="mt-1.5 flex items-center gap-2">
                        {delayOpen === p.id ? (
                          <>
                            <input
                              type="date"
                              className="glass-input !w-36 !py-1 !text-[11px]"
                              min={addDays(todayKey(), 1)}
                              value={delayDate}
                              onChange={(e) => setDelayDate(e.target.value)}
                            />
                            <input
                              className="glass-input flex-1 !py-1 !text-[11px]"
                              placeholder="延期原因（可选）"
                              value={delayReason}
                              onChange={(e) => setDelayReason(e.target.value)}
                            />
                            <button
                              className="glass-btn primary !px-2 !py-1 !text-[11px]"
                              disabled={!delayDate}
                              onClick={() => {
                                void window.api.delayPlan(p.id, delayDate, delayReason.trim() || undefined).then(() => {
                                  setDelayOpen(null)
                                  setDelayDate('')
                                  setDelayReason('')
                                  void load()
                                })
                              }}
                            >
                              确认延期
                            </button>
                            <button className="glass-btn !px-2 !py-1 !text-[11px]" onClick={() => setDelayOpen(null)}>
                              取消
                            </button>
                          </>
                        ) : (
                          <button
                            className="glass-btn !px-2 !py-1 !text-[11px]"
                            onClick={() => {
                              setDelayOpen(p.id)
                              setDelayDate(addDays(todayKey(), 1))
                              setDelayReason('')
                            }}
                          >
                            <Icon name="calendar" size={12} /> 延期到…
                          </button>
                        )}
                      </div>
                    ) : null}
                    {p.status === 'delayed' && p.delayToDate ? (
                      <div className="mt-1.5 flex items-center gap-1.5 rounded-lg border border-neon-amber/20 bg-neon-amber/[0.06] px-2.5 py-1.5 text-[11px] text-neon-amber">
                        ⏰ 已延期到 {p.delayToDate}
                        {p.delayReason ? `（${p.delayReason}）` : ''}
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            )
          })}
        </div>
      )}

      {editor ? (
        <PlanEditor
          plan={editor.plan}
          isNew={editor.isNew}
          cats={cats}
          onNewCategory={() => setCatForm(true)}
          onClose={() => setEditor(null)}
          onSaved={(savedDate) => {
            // 保存到其他日期时把视图切过去（setDate 会触发 load）
            if (savedDate !== date) setDate(savedDate)
            else void load()
          }}
        />
      ) : null}
      {catForm ? (
        <CategoryForm
          onClose={() => setCatForm(false)}
          onSaved={() => {
            void loadCats()
            void load()
          }}
        />
      ) : null}
    </div>
  )
}
