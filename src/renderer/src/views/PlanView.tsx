import { useCallback, useEffect, useMemo, useState, useRef } from 'react'
import type { CustomCategory, PlanForecast, PlanItem, PlanStatus, PlanType, PlanVsActual } from '@shared/types'
import { Icon } from '../components/Icon'
import { PageHeader } from '../components/PageHeader'
import { EmptyState } from '../components/EmptyState'
import { ProgressRing } from '../components/ProgressRing'
import { InsightCard } from '../components/ui/InsightCard'
import { AiThinking } from '../components/ui/AiThinking'
import { addDays, clockOf, fmtDateLabel, fmtMin, timeToMin, todayKey } from '../components/utils'
import { parsePlanText } from '../components/parsePlanText'
import { ProjectBoard } from '../components/ProjectBoard'
import { parseBreakdownSteps } from '@shared/parseBreakdown'

const STATUS_LABEL: Record<PlanStatus, string> = {
  planned: '待办',
  in_progress: '进行中',
  partial: '部分完成',
  done: '已完成',
  delayed: '已延期',
  cancelled: '已取消'
}

const PLAN_TYPE_LABEL: Record<PlanType, string> = {
  reminder: '提醒',
  phase: '持续工作',
  task: '待办',
  burst: '机动开发'
}

/** 状态徽章配色：进行中 teal / 已完成 mint / 部分 amber / 延期 red / 取消 灰 */
const STATUS_COLOR: Record<PlanStatus, string> = {
  planned: '#94A3B8',
  in_progress: '#0FB5A4',
  partial: '#F59E0B',
  done: '#10B981',
  delayed: '#EF4444',
  cancelled: '#64748B'
}

/** 计划卡左侧 3px 状态色条：进行中 teal / 风险(AI 预测<40%)·延期 red / 已完成 mint / 部分 amber / 取消 灰 */
function planStatusColor(p: PlanItem, risky: boolean): string {
  if (p.status === 'done') return STATUS_COLOR.done
  if (risky) return STATUS_COLOR.delayed
  return STATUS_COLOR[p.status]
}

/** 进度条渐变填色（与状态色条同源） */
function planBarGradient(p: PlanItem, risky: boolean): string {
  if (p.status === 'done') return 'linear-gradient(90deg, #10B981, #34D399)'
  if (risky) return 'linear-gradient(90deg, #EF4444, #F97316)'
  if (p.status === 'in_progress') return 'linear-gradient(90deg, var(--teal), #22D3EE)'
  if (p.status === 'partial') return 'linear-gradient(90deg, #F59E0B, #FBBF24)'
  if (p.status === 'delayed') return 'linear-gradient(90deg, #EF4444, #F59E0B)'
  if (p.status === 'cancelled') return 'linear-gradient(90deg, #64748B, #94A3B8)'
  return 'linear-gradient(90deg, var(--line-strong), var(--teal))'
}

/** 计划来源标记（轻量文案，不抢标题） */
function SourceMark({ plan }: { plan: PlanItem }) {
  if (plan.browserDerived) return <span title="浏览器行为确认">浏览器确认</span>
  if (plan.confirmedFromQA) return <span title="问答确认">问答确认</span>
  if (plan.source === 'manual') return <span title="手动创建">手动</span>
  return <span>{plan.source}</span>
}

/* ── 新建 / 编辑弹窗 ── */
interface PlanEditorProps {
  plan: Partial<PlanItem> & { date: string }
  isNew: boolean
  onClose: () => void
  onSaved: (savedDate: string) => void
}

function PlanEditor({ plan, isNew, onClose, onSaved }: PlanEditorProps) {
  const [title, setTitle] = useState(plan.title ?? '')
  const [planDate, setPlanDate] = useState(plan.date)
  const [start, setStart] = useState(plan.startMin !== undefined ? clockOf(plan.startMin) : '')
  const [end, setEnd] = useState(plan.endMin !== undefined ? clockOf(plan.endMin) : '')
  const [duration, setDuration] = useState(plan.durationMin !== undefined ? String(plan.durationMin) : '')
  const [note, setNote] = useState(plan.note ?? '')
  const [smartText, setSmartText] = useState('')
  const [smartHint, setSmartHint] = useState('')
  const [planType, setPlanType] = useState<PlanType>(plan.planType ?? 'phase')
  /** 归属项目（显式关联：计划 ↔ 项目） */
  const [projId, setProjId] = useState(plan.projectId ?? '')
  const [projOptions, setProjOptions] = useState<{ id: string; name: string }[]>([])
  const [taskOptions, setTaskOptions] = useState<{ id: string; title: string }[]>([])
  const [taskId, setTaskId] = useState(plan.projectTaskId ?? '')
  const [category, setCategory] = useState(plan.category || 'other')
  const [catOptions, setCatOptions] = useState<CustomCategory[]>([])
  useEffect(() => {
    void window.api?.listProjects?.().then((ps) => setProjOptions((ps as { id: string; name: string }[]) ?? [])).catch(() => undefined)
    void window.api?.listCategories?.().then((cs) => setCatOptions((cs as CustomCategory[]) ?? [])).catch(() => undefined)
  }, [])
  useEffect(() => {
    if (!projId) { setTaskOptions([]); return }
    void window.api?.listProjectTasks?.(projId).then((ts) => setTaskOptions(((ts as { id: string; title: string }[]) ?? []).slice(0, 30))).catch(() => undefined)
  }, [projId])

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
    // 识别到具体时刻 + 提醒类关键词 → 自动选 reminder（宁缺毋滥，其余留给手选）
    if (r.startMin !== undefined && r.endMin === undefined && /提醒|通知|叫我|喊我|记得/.test(text)) {
      setPlanType('reminder')
    }
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
      note: note.trim() || undefined,
      planType,
      category: category || 'other',
      projectId: projId || undefined,
      projectTaskId: taskId || undefined
    }
    if (planType === 'reminder') {
      payload.startMin = startMin
      payload.endMin = undefined
      payload.durationMin = undefined
    } else if (planType === 'task') {
      payload.startMin = undefined
      payload.endMin = undefined
      payload.durationMin = undefined
    } else {
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
    }
    await window.api.savePlan(payload)
    onSaved(savedDate)
    onClose()
  }

  return (
    <div className="anim-fade-in fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div
        className="glass-card anim-scale-in w-[400px]"
        style={{ borderRadius: 'var(--r-xl)', boxShadow: 'var(--shadow-lg)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="mb-4 flex items-center gap-2.5 text-[15px] font-semibold text-slate-100">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg border border-[var(--line)] bg-[var(--teal-soft)] text-[var(--teal-deep)]">
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
          {/* 计划类型选择器 */}
          <div className="grid grid-cols-3 gap-2">
            {([
              { v: 'reminder', label: '提醒', desc: '到点触发' },
              { v: 'phase', label: '持续工作', desc: '阶段验证' },
              { v: 'task', label: '待办', desc: '无时间绑定' },
            ] as const).map((t) => (
              <button
                key={t.v}
                type="button"
                onClick={() => setPlanType(t.v)}
                className={`glass-btn !px-2 !py-2 flex flex-col items-center gap-0.5 ${planType === t.v ? '!border-neon-cyan/60 !text-neon-cyan' : ''}`}
              >
                <span className="text-[13px] font-medium">{t.label}</span>
                <span className="text-[10px] text-slate-500">{t.desc}</span>
              </button>
            ))}
          </div>
          <label className="text-[11px] font-medium text-slate-500">
            日期
            <input type="date" className="glass-input mt-1" value={planDate} onChange={(e) => setPlanDate(e.target.value)} />
          </label>
          {planType === 'reminder' ? (
            <label className="text-[11px] font-medium text-slate-500">
              触发时间
              <input type="time" className="glass-input mt-1" value={start} onChange={(e) => setStart(e.target.value)} />
            </label>
          ) : planType === 'phase' ? (
            <>
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
            </>
          ) : null}
          <textarea
            className="glass-input resize-none"
            rows={2}
            placeholder="备注（可选）"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <div className="flex flex-col gap-1.5">
            <span className="text-[11px] text-slate-500">分类（工作 / 生活 / 兴趣…）</span>
            <div className="flex flex-wrap gap-1">
              {[
                { id: 'work-customer', label: '工作' },
                { id: 'personal', label: '生活' },
                { id: 'interest', label: '兴趣' },
                { id: 'ai-dev', label: 'AI 开发' },
                { id: 'other', label: '未分类' }
              ].map((b) => (
                <button
                  key={b.id}
                  type="button"
                  className={`chip !py-0 ${category === b.id ? '!border-neon-cyan/50 !text-neon-cyan' : ''}`}
                  onClick={() => setCategory(b.id)}
                >
                  {b.label}
                </button>
              ))}
            </div>
            <select className="glass-input !py-1.5 text-[12px]" value={category} onChange={(e) => setCategory(e.target.value)}>
              {(catOptions.length ? catOptions : [
                { id: 'work-customer', label: '工作', emoji: '💼' },
                { id: 'personal', label: '生活', emoji: '🏠' },
                { id: 'interest', label: '兴趣', emoji: '✨' },
                { id: 'other', label: '未分类', emoji: '📋' }
              ]).map((c) => (
                <option key={c.id} value={c.id}>{c.emoji ? `${c.emoji} ` : ''}{c.label}</option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <label className="shrink-0 text-[11px] text-slate-500">归属项目</label>
            <select className="glass-input !py-1 text-[12px]" value={projId} onChange={(e) => { setProjId(e.target.value); setTaskId('') }}>
              <option value="">不归属（纯计划）</option>
              {projOptions.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
            {projId && taskOptions.length ? (
              <select className="glass-input !py-1 text-[12px]" value={taskId} onChange={(e) => setTaskId(e.target.value)}>
                <option value="">不挂具体任务</option>
                {taskOptions.map((tk) => (
                  <option key={tk.id} value={tk.id}>{tk.title}</option>
                ))}
              </select>
            ) : null}
          </div>
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
  const [tab, setTab] = useState<'plan' | 'project'>('plan')
  /** 今日安排内：全部 / 仅项目相关 / 仅日常 */
  const [scopeFilter, setScopeFilter] = useState<'all' | 'project' | 'daily'>('all')
  const [plans, setPlans] = useState<PlanItem[]>([])
  const [projects, setProjects] = useState<{ id: string; name: string; color?: string }[]>([])
  const [categories, setCategories] = useState<CustomCategory[]>([])
  const [catCollapsed, setCatCollapsed] = useState<Record<string, boolean>>({})
  const [newCatOpen, setNewCatOpen] = useState(false)
  const [newCatLabel, setNewCatLabel] = useState('')
  const [pva, setPva] = useState<PlanVsActual | null>(null)
  const [trail, setTrail] = useState<{ segments: { mainApp: string; durationMin: number; mainState: string }[] } | null>(null)
  const [forecasts, setForecasts] = useState<Map<string, PlanForecast>>(new Map())
  const [statusFilter, setStatusFilter] = useState<'all' | PlanStatus>('all')
  const [editor, setEditor] = useState<{ plan: Partial<PlanItem> & { date: string }; isNew: boolean } | null>(null)
  /** 快速添加（v7.1）：回车即入库，自然语言时间解析，不开编辑器 */
  const [quickText, setQuickText] = useState('')
  const [quickProj, setQuickProj] = useState('')
  const quickRef = useRef<HTMLInputElement>(null)
  /** 关联任务名映射（行内 chip 显示） */
  const [taskNames, setTaskNames] = useState<Record<string, string>>({})
  useEffect(() => {
    const withTask = plans.filter((p) => p.projectId && p.projectTaskId)
    if (!withTask.length) return
    void (async () => {
      const names: Record<string, string> = {}
      for (const pid of [...new Set(withTask.map((p) => p.projectId as string))]) {
        const ts = ((await window.api?.listProjectTasks?.(pid)) as { id: string; title: string }[]) ?? []
        for (const tk of ts) names[tk.id] = tk.title
      }
      setTaskNames((m) => ({ ...m, ...names }))
    })()
  }, [plans])
  const [expanded, setExpanded] = useState<string | null>(null)
  const [delayOpen, setDelayOpen] = useState<string | null>(null)
  const [delayDate, setDelayDate] = useState('')
  const [delayReason, setDelayReason] = useState('')
  const [folderModal, setFolderModal] = useState(false)
  /** v7 粘贴文本导入：贴任意进展/纪要文本 → AI 解析成待办 */
  const [pasteOpen, setPasteOpen] = useState(false)
  const [pasteText, setPasteText] = useState('')
  const [pasteItems, setPasteItems] = useState<string[]>([])
  const [pasteBusy, setPasteBusy] = useState(false)
  const [folderDirs, setFolderDirs] = useState<string[]>([])
  const [ratioDraft, setRatioDraft] = useState<Record<string, number>>({})
  const ratioTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({})
  const [importMsg, setImportMsg] = useState('')
  const [scanProgress, setScanProgress] = useState(0)
  const [scanFile, setScanFile] = useState('')
  /** ✦ AI 拆解结果（按计划 id）：loading 中显示思考态；applied = 已写入子待办 */
  const [breakdowns, setBreakdowns] = useState<Record<string, { loading: boolean; text: string; applied?: boolean }>>({})
  /** 连续达成天数（截至所选日期前一天，逐日用现有 planVsActual 推导） */
  const [streak, setStreak] = useState<number | null>(null)

  const load = useCallback(async () => {
    try {
      const [ps, pv, fc, tr, prjs, cats] = await Promise.all([
        window.api.listPlans(date),
        window.api.planVsActual(date),
        window.api.getForecast(date).catch(() => []),
        window.api.getTrail(date).catch(() => null),
        window.api.listProjects().catch(() => []),
        window.api.listCategories().catch(() => [])
      ])
      setPlans(((ps as PlanItem[]) ?? []).filter((p) => !p.archived))
      setPva(pv as PlanVsActual)
      setTrail(tr as { segments: { mainApp: string; durationMin: number; mainState: string }[] } | null)
      setProjects((prjs as { id: string; name: string; color?: string }[]) ?? [])
      setCategories((cats as CustomCategory[]) ?? [])
      setForecasts(new Map(((fc as PlanForecast[]) ?? []).map((f) => [f.planId, f])))
    } catch {
      setPlans([])
      setPva(null)
    }
  }, [date])

  useEffect(() => {
    void load()
  }, [load])

  // 连续达成：截至所选日期前一天，日达成率 ≥50% 记为达成，逐日回看最多 7 天（复用现有 IPC，不新增）
  useEffect(() => {
    let alive = true
    void (async () => {
      let n = 0
      for (let i = 1; i <= 7; i++) {
        try {
          const pv = (await window.api.planVsActual(addDays(date, -i))) as PlanVsActual | null
          if (!pv || pv.achievement < 50) break
          n++
        } catch {
          break
        }
      }
      if (alive) setStreak(n)
    })()
    return () => {
      alive = false
    }
  }, [date])

  // 命令面板 / 项目推进「排入今日」→ 切回今日安排
  useEffect(() => {
    const onGotoProjects = () => setTab('project')
    const onGotoToday = () => setTab('plan')
    window.addEventListener('workon:goto-projects', onGotoProjects)
    window.addEventListener('workon:goto-today', onGotoToday)
    return () => {
      window.removeEventListener('workon:goto-projects', onGotoProjects)
      window.removeEventListener('workon:goto-today', onGotoToday)
    }
  }, [])

  // 项目推进点「关联的今日安排」→ 切回今日并打开编辑
  useEffect(() => {
    const onEdit = (ev: Event) => {
      const id = (ev as CustomEvent<{ id?: string }>).detail?.id
      if (!id) return
      setTab('plan')
      const hit = plans.find((p) => p.id === id)
      if (hit) setEditor({ plan: hit, isNew: false })
      else void load().then(() => {
        // load 后 plans 状态异步，再读一次 api
        void window.api.listPlans(date).then((ps) => {
          const list = ((ps as PlanItem[]) ?? []).filter((p) => !p.archived)
          const p = list.find((x) => x.id === id)
          if (p) setEditor({ plan: p, isNew: false })
        })
      })
    }
    window.addEventListener('workon:edit-plan', onEdit)
    return () => window.removeEventListener('workon:edit-plan', onEdit)
  }, [plans, date, load])

  // 问答确认创建计划后实时刷新
  useEffect(() => window.api.onPlanUpdated(() => void load()), [load])

  useEffect(() => {
    if (folderModal) {
      window.api?.getSettings?.().then(s => setFolderDirs(((s as any)?.folders) ?? []))
    }
  }, [folderModal])

  const toggleDone = async (p: PlanItem) => {
    await window.api.setPlanStatus(p.id, p.status === 'done' ? 'planned' : 'done')
    void load()
  }

  /** ✦ AI 拆解：拆完后自动同步子待办到今日计划（并刷新桌面待办窗） */
  const doBreakdown = async (p: PlanItem) => {
    if (breakdowns[p.id]?.loading) return
    setExpanded(p.id)
    setBreakdowns((b) => ({ ...b, [p.id]: { loading: true, text: '', applied: false } }))
    try {
      const ans = await window.api.askQAWithShots(
        `请把计划「${p.title}」整理成 2～4 条粗目标（不要细步骤）。\n要求：每行一条，格式「1. 今日目的/优化面（约X分钟）」；说清今天要达成什么或优化哪块，不要写文件级操作；不要前言后语。`
      )
      const payload = typeof ans === 'string' ? { content: ans } : ((ans ?? {}) as { content?: string | null })
      const text =
        typeof payload.content === 'string' && payload.content ? payload.content : '（未生成拆解结果，请确认 AI 已配置后重试）'
      setBreakdowns((b) => ({ ...b, [p.id]: { loading: false, text, applied: false } }))
      if (parseBreakdownSteps(text).length) {
        await syncBreakdownToPlans(p, text)
      } else {
        setImportMsg('拆解完成，但未解析到可写入的步骤')
      }
    } catch {
      setBreakdowns((b) => ({ ...b, [p.id]: { loading: false, text: '拆解失败，请稍后再试。', applied: false } }))
    }
  }

  /**
   * 把拆解步骤同步进计划待办：
   * - 新增缺失子待办
   * - 已完成的子项保留不改
   * - 旧的未完成子项若不在新清单里 → 取消（避免堆积过期步骤）
   * - 父计划标为进行中，并记一条拆解摘要
   */
  const syncBreakdownToPlans = async (p: PlanItem, text: string): Promise<void> => {
    const steps = parseBreakdownSteps(text)
    if (!steps.length) {
      setImportMsg('没有解析到可应用的步骤，请重试拆解')
      return
    }
    const children = plans.filter((x) => x.parentPlanId === p.id)
    const byTitle = new Map(children.map((c) => [c.title.trim().toLowerCase(), c]))
    const keep = new Set(steps.map((t) => t.toLowerCase()))
    let added = 0
    let cancelled = 0

    for (const title of steps) {
      const key = title.toLowerCase()
      const hit = byTitle.get(key)
      if (hit) {
        // 已取消的同名项 → 重新打开
        if (hit.status === 'cancelled') {
          await window.api.setPlanStatus(hit.id, 'planned')
        }
        continue
      }
      await window.api.savePlan({
        date: p.date,
        title,
        category: p.category || 'other',
        status: 'planned',
        source: 'import',
        planType: 'task',
        parentPlanId: p.id,
        projectId: p.projectId,
        note: `拆自「${p.title}」`
      })
      added++
    }

    for (const c of children) {
      if (c.status === 'done') continue
      if (keep.has(c.title.trim().toLowerCase())) continue
      if (c.status !== 'cancelled') {
        await window.api.setPlanStatus(c.id, 'cancelled')
        cancelled++
      }
    }

    // 父计划：进入进行中 + 摘要写入 note（保留原 note 前缀）
    const summary = `AI拆解 ${steps.length} 步 · ${new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`
    const prevNote = (p.note || '').replace(/\n?AI拆解 \d+ 步 · .+$/m, '').trim()
    await window.api.savePlan({
      id: p.id,
      date: p.date,
      title: p.title,
      note: prevNote ? `${prevNote}\n${summary}` : summary,
      ...(p.status === 'planned' || p.status === 'delayed' ? { status: 'in_progress' as const } : {})
    })

    setBreakdowns((b) => ({ ...b, [p.id]: { ...(b[p.id] ?? { loading: false, text }), text, applied: true } }))
    const parts = [
      added ? `新增 ${added}` : null,
      cancelled ? `取消过期 ${cancelled}` : null,
      !added && !cancelled ? '已与现有子待办对齐' : null
    ].filter(Boolean)
    setImportMsg(`拆解已自动同步：${parts.join(' · ')}（桌面待办窗可见）`)
    void load()
  }

  const applyBreakdown = async (p: PlanItem): Promise<void> => {
    const text = breakdowns[p.id]?.text ?? ''
    await syncBreakdownToPlans(p, text)
  }

  const [confirmDelId, setConfirmDelId] = useState<string | null>(null)
  const remove = async (p: PlanItem) => {
    await window.api.removePlan(p.id)
    void load()
  }

  const setPlanProject = async (planId: string, projectId: string | null) => {
    await window.api.savePlan({ id: planId, projectId })
    void load()
  }

  const setPlanCategory = async (planId: string, category: string) => {
    const p = plans.find((x) => x.id === planId)
    if (!p) return
    await window.api.savePlan({ id: planId, date: p.date, title: p.title, category })
    void load()
  }

  const createCategory = async (): Promise<CustomCategory | null> => {
    const label = newCatLabel.trim()
    if (!label) return null
    const created = (await window.api.createCategory({
      label,
      color: '#22D3EE',
      emoji: '📌'
    })) as CustomCategory
    setNewCatLabel('')
    setNewCatOpen(false)
    await load()
    return created
  }

  const QUICK_BUCKETS = [
    { id: 'work-customer', label: '工作' },
    { id: 'personal', label: '生活' },
    { id: 'interest', label: '兴趣' }
  ] as const

  const resolveCatId = (p: PlanItem): string => {
    const id = (p.category || 'other').trim() || 'other'
    if (id === 'other') return 'other'
    if (categories.some((c) => c.id === id)) return id
    return 'other'
  }

  const catMeta = (id: string): Pick<CustomCategory, 'id' | 'label' | 'color' | 'emoji'> => {
    const hit = categories.find((c) => c.id === id)
    if (hit) return hit
    if (id === 'interest') return { id, label: '兴趣', color: '#EC4899', emoji: '✨' }
    if (id === 'personal') return { id, label: '生活', color: '#10B981', emoji: '🏠' }
    if (id === 'work-customer') return { id, label: '工作', color: '#3B82F6', emoji: '💼' }
    return { id: 'other', label: '未分类', color: '#64748B', emoji: '📋' }
  }

  useEffect(() => {
    const off = window.api?.onScanProgress?.((p) => {
      const info = p as { pct: number; file: string }
      setScanProgress(info.pct); setScanFile(info.file)
    })
    return off
  }, [])

  const parsePaste = async (): Promise<void> => {
    const text = pasteText.trim()
    if (!text || pasteBusy) return
    setPasteBusy(true)
    try {
      const r = (await window.api?.askQA?.(
        `从下面的文本里提取"可执行的待办/需求项"，输出 JSON 数组（每项一个 title 字符串，不要解释）：

${text.slice(0, 3000)}`
      )) as { content?: string } | string | undefined
      const content = typeof r === 'string' ? r : r?.content ?? ''
      const m = content.match(/\[[\s\S]*?\]/)
      const items: string[] = m ? JSON.parse(m[0]) : []
      setPasteItems(items.filter((x) => typeof x === 'string').slice(0, 12))
    } catch {
      setPasteItems([])
    } finally {
      setPasteBusy(false)
    }
  }

  const savePasted = async (): Promise<void> => {
    for (const title of pasteItems) {
      await window.api.savePlan({
        date,
        title: title.slice(0, 100),
        category: 'other',
        status: 'planned' as const,
        source: 'import' as const,
        note: '来自文本导入'
      })
    }
    setPasteItems([])
    setPasteText('')
    setPasteOpen(false)
    void load()
  }

  const quickAdd = async (): Promise<void> => {
    const text = quickText.trim()
    if (!text) return
    const r = parsePlanText(text)
    const title = (r.matched.length ? r.title : text).slice(0, 100)
    const targetDate = r.date ?? date
    const hasTime = r.startMin !== undefined
    await window.api.savePlan({
      date: targetDate,
      title,
      category: 'other',
      status: 'planned',
      source: 'manual',
      planType: hasTime ? 'reminder' : 'task',
      startMin: r.startMin,
      endMin: r.endMin,
      durationMin: r.durationMin,
      projectId: quickProj || undefined
    })
    setQuickText('')
    void load()
  }

  const importFromMeeting = async () => {
    if (folderDirs.length === 0) { setFolderModal(true); return }
    setScanProgress(0); setScanFile('正在扫描...')
    const entries = await window.api?.scanFolders?.() as Array<{ source: string; type: string; content: string }> | undefined
    if (!entries?.length) { setScanProgress(0); setImportMsg('未扫描到会议纪要文件'); return }
    const actions = entries
      .filter((e) => e.type === 'action')
      .flatMap((e) => {
        // 提取 - [ ] / 下一步: / 待办: 开头的行动项
        const lines = e.content.split('\n').filter((l: string) => /^[\s]*(- \[[ x]\]\s*|(下一步|待办)[：:]\s*)/i.test(l.trim()))
        return lines.map((l: string) => l.replace(/^[\s]*(- \[[ x]\]\s*|(下一步|待办)[：:]\s*)/i, '').trim()).filter(Boolean)
      })
    if (actions.length === 0) { setImportMsg('纪要中未发现行动项'); return }
    // 逐个创建计划项
    setImportMsg(`正在导入 ${actions.length} 条行动项…`)
    setImportMsg(`正在导入 ${actions.length} 条行动项…`)
    for (const title of actions) {
      await window.api.savePlan({
        date,
        title: title.slice(0, 100),
        category: 'other',
        status: 'planned' as const,
        source: 'import' as const,
        note: `来自会议纪要导入`
      })
    }
    setScanProgress(0)
    void load()
  }

  const filtered = plans
    .filter((p) => !p.parentPlanId) // 子待办挂在父卡下展示，不单独占一行主卡
    .filter((p) => {
      if (statusFilter === 'all') return p.status !== 'done' && p.status !== 'cancelled'
      return p.status === statusFilter
    })
    .filter((p) => {
      if (scopeFilter === 'project') return !!p.projectId
      if (scopeFilter === 'daily') return !p.projectId
      return true
    })
    .sort((a, b) => (a.startMin ?? 9999) - (b.startMin ?? 9999))

  /** 未完成树：有所属项目 → 按具体项目头分组（默认收起）；无项目按分类，缺省「未分类」 */
  const useCatTree = statusFilter !== 'done' && statusFilter !== 'cancelled'
  const categoryGroups = useMemo(() => {
    if (!useCatTree) {
      return [{ key: 'flat', meta: null as ReturnType<typeof catMeta> | null, items: filtered, defaultCollapsed: false, kind: 'flat' as const }]
    }
    const byProject = new Map<string, PlanItem[]>()
    const byCat = new Map<string, PlanItem[]>()
    for (const p of filtered) {
      if (p.projectId) {
        if (!byProject.has(p.projectId)) byProject.set(p.projectId, [])
        byProject.get(p.projectId)!.push(p)
        continue
      }
      const id = resolveCatId(p)
      if (!byCat.has(id)) byCat.set(id, [])
      byCat.get(id)!.push(p)
    }
    const groups: {
      key: string
      meta: ReturnType<typeof catMeta> | null
      items: PlanItem[]
      defaultCollapsed: boolean
      kind: 'project' | 'category' | 'flat'
    }[] = []
    // 项目顺序：现有项目列表顺序，再补孤儿 projectId
    const projOrder = [
      ...projects.map((pj) => pj.id).filter((id) => byProject.has(id)),
      ...[...byProject.keys()].filter((id) => !projects.some((pj) => pj.id === id))
    ]
    for (const pid of projOrder) {
      const items = byProject.get(pid) ?? []
      if (!items.length) continue
      const pj = projects.find((x) => x.id === pid)
      groups.push({
        key: `proj:${pid}`,
        meta: {
          id: pid,
          label: pj?.name ?? '未知项目',
          color: pj?.color ?? '#22D3EE',
          emoji: '📁'
        },
        items,
        defaultCollapsed: true,
        kind: 'project'
      })
    }
    const order = [
      ...categories.map((c) => c.id).filter((id) => id !== 'other'),
      ...[...byCat.keys()].filter((k) => k !== 'other' && !categories.some((c) => c.id === k)),
      'other'
    ]
    const keys = order.filter((k, i) => order.indexOf(k) === i && (byCat.get(k)?.length ?? 0) > 0)
    for (const key of keys) {
      groups.push({
        key,
        meta: catMeta(key),
        items: byCat.get(key)!,
        defaultCollapsed: false,
        kind: 'category'
      })
    }
    return groups
  }, [filtered, categories, useCatTree, projects])

  const childPlansOf = (parentId: string): PlanItem[] =>
    plans
      .filter((c) => c.parentPlanId === parentId)
      .sort((a, b) => a.ts - b.ts)

  const achievement = pva ? Math.min(100, pva.achievement) : 0
  const ringColor = achievement >= 80 ? '#10B981' : achievement >= 50 ? '#F59E0B' : '#EF4444'
  const forecastList = [...forecasts.values()]
  const avgProb = forecastList.length ? Math.round(forecastList.reduce((a, f) => a + f.completionProb, 0) / forecastList.length) : null
  const riskCount = forecastList.filter((f) => f.completionProb < 40).length
  // 顶部统计行数据（由现有 plans / pva 推导）
  const activePlans = plans.filter((p) => p.status !== 'cancelled')
  const doneCount = activePlans.filter((p) => p.status === 'done').length
  const inProgressCount = activePlans.filter((p) => p.status === 'in_progress').length
  const partialCount = activePlans.filter((p) => p.status === 'partial').length
  const delayedCount = activePlans.filter((p) => p.status === 'delayed').length

  return (
    <div className="view-enter flex flex-col gap-4">
      <PageHeader
        icon="target"
        title="计划"
        desc={tab === 'plan' ? '今天要达成什么 · 按日执行与达成率' : '跨天任务池 · 挑今日要干的排进来'}
        actions={
          tab === 'plan' ? (
            <>
              <button className="glass-btn primary" onClick={() => setEditor({ plan: { date }, isNew: true })}>
                <Icon name="plus" size={14} /> 新建安排
              </button>
            </>
          ) : (
            <button className="glass-btn !text-[12px]" onClick={() => setTab('plan')}>
              回今日安排
            </button>
          )
        }
      />

      {importMsg ? (
        <div className="rounded-lg border border-neon-cyan/25 bg-neon-cyan/10 px-3 py-2 text-[11px] text-neon-cyan">{importMsg}</div>
      ) : null}

      <div className="anim-fade-up grid grid-cols-2 gap-2">
        {([
          ['plan', '今日安排', '按日执行、达成率、归档'],
          ['project', '项目推进', '跨天任务、反哺、排入今日']
        ] as const).map(([k, label, hint]) => (
          <button
            key={k}
            type="button"
            className={`rounded-xl border px-3.5 py-2.5 text-left transition-colors ${
              tab === k
                ? 'border-[var(--teal)]/35 bg-[var(--teal-soft)]'
                : 'border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.04]'
            }`}
            onClick={() => setTab(k)}
          >
            <div className={`text-[13px] font-semibold ${tab === k ? 'text-slate-100' : 'text-slate-300'}`}>{label}</div>
            <div className={`mt-0.5 text-[11px] leading-snug ${tab === k ? 'text-slate-400' : 'text-slate-600'}`}>{hint}</div>
          </button>
        ))}
      </div>

      {tab === 'project' ? (
        <ProjectBoard trail={trail} />
      ) : (
      <>

      {scanProgress > 0 && (
        <div className="anim-fade-in">
          <div className="flex items-center justify-between text-[11px] text-slate-400 mb-1">
            <span>扫描中...</span><span>{scanProgress}%</span>
          </div>
          <div className="h-1 rounded-full bg-white/10"><div className="h-1 rounded-full bg-neon-cyan transition-all" style={{ width: `${scanProgress}%` }} /></div>
          <p className="text-[10px] text-slate-500 mt-1 truncate">{scanFile}</p>
        </div>
      )}

      {/* 日期 + 筛选控制条 */}
      <div
        className="anim-fade-up flex flex-col gap-3 rounded-2xl border border-white/[0.06] bg-white/[0.025] p-3"
        style={{ animationDelay: '60ms' }}
      >
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center rounded-lg border border-white/[0.06] bg-black/20 p-0.5">
            <button className="glass-btn !border-transparent !bg-transparent !px-2 !py-1" onClick={() => setDate((d) => addDays(d, -1))}>
              <Icon name="chevronLeft" size={14} />
            </button>
            <button className="glass-btn !border-transparent !bg-transparent !px-2.5 !py-1 !text-[12px]" onClick={() => setDate(todayKey())}>
              今天
            </button>
            <button className="glass-btn !border-transparent !bg-transparent !px-2 !py-1" onClick={() => setDate((d) => addDays(d, 1))}>
              <Icon name="chevronRight" size={14} />
            </button>
          </div>
          <div className="flex min-w-0 items-center gap-2">
            <Icon name="calendar" size={14} className="shrink-0 text-[var(--teal-deep)]" />
            <span className="truncate text-[14px] font-semibold tracking-wide text-slate-100">{fmtDateLabel(date)}</span>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1.5 border-t border-white/[0.05] pt-2.5">
          <span className="mr-1 text-[10px] font-medium uppercase tracking-wider text-slate-600">状态</span>
          {(['all', 'planned', 'in_progress', 'done', 'delayed', 'cancelled'] as const).map((s) => (
            <button
              key={s}
              type="button"
              className={`rounded-md px-2 py-1 text-[11px] transition-colors ${
                statusFilter === s
                  ? 'bg-white/[0.1] font-medium text-neon-cyan'
                  : 'text-slate-500 hover:bg-white/[0.04] hover:text-slate-300'
              }`}
              onClick={() => setStatusFilter(s)}
            >
              {s === 'all' ? '未完成' : STATUS_LABEL[s]}
            </button>
          ))}
          <span className="mx-1.5 h-3 w-px bg-white/10" />
          <span className="mr-1 text-[10px] font-medium uppercase tracking-wider text-slate-600">范围</span>
          {([
            ['all', '全部'],
            ['project', '项目'],
            ['daily', '日常']
          ] as const).map(([k, label]) => (
            <button
              key={k}
              type="button"
              className={`rounded-md px-2 py-1 text-[11px] transition-colors ${
                scopeFilter === k
                  ? 'bg-white/[0.1] font-medium text-neon-cyan'
                  : 'text-slate-500 hover:bg-white/[0.04] hover:text-slate-300'
              }`}
              onClick={() => setScopeFilter(k)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <section className="anim-fade-up grid grid-cols-2 gap-2.5 lg:grid-cols-4" style={{ animationDelay: '100ms' }}>
        <InsightCard
          icon={<Icon name="target" size={14} />}
          tone="teal"
          label="今日达成率"
          big={
            <span className="flex items-center gap-2">
              <ProgressRing value={achievement} size={30} stroke={3.5} color={ringColor} />
              {Math.round(achievement)}%
            </span>
          }
          base={pva ? <>计划 {fmtMin(pva.plannedMin)} · 实际 {fmtMin(pva.actualWorkMin)}</> : '暂无对照'}
        />
        <InsightCard
          icon={<Icon name="calendar" size={14} />}
          tone="ai"
          label="今日计划"
          big={
            <>
              {doneCount}
              <span className="text-[15px] font-bold text-slate-500">/{activePlans.length}</span>
            </>
          }
          base={<>覆盖 {pva ? pva.matchedCount : 0} · 延期 {delayedCount}</>}
        />
        <InsightCard
          icon={<Icon name="activity" size={14} />}
          tone="cyan"
          label="进行中"
          big={inProgressCount}
          base={partialCount > 0 ? `另有 ${partialCount} 项部分完成` : inProgressCount > 0 ? '保持节奏' : '暂无进行中'}
        />
        <InsightCard
          icon={<Icon name="flame" size={14} />}
          tone="amber"
          label="连续达成"
          big={streak === null ? '…' : `${streak}天`}
          base={
            avgProb !== null
              ? `AI 均值 ${avgProb}%${riskCount > 0 ? ` · ${riskCount} 项有风险` : ''}`
              : '按日达成率 ≥50% 连续计'
          }
        />
      </section>

      {/* 快速添加：回车即入库 */}
      <div className="anim-fade-up flex items-center gap-2 rounded-2xl border border-[var(--line)] bg-[var(--surface-2)] px-3 py-2" style={{ animationDelay: '120ms' }}>
        <span className="text-[13px]" style={{ color: 'var(--teal)' }}>＋</span>
        <input
          ref={quickRef}
          className="min-w-0 flex-1 bg-transparent text-[13px] text-slate-200 outline-none placeholder:text-slate-600"
          placeholder="今天要做什么？回车添加 · 支持「明天下午3点开会」"
          value={quickText}
          onChange={(e) => setQuickText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void quickAdd()}
        />
        <select
          className="glass-input !w-28 !py-1 !text-[11px]"
          value={quickProj}
          onChange={(e) => setQuickProj(e.target.value)}
          title="归属项目（可选）"
        >
          <option value="">不归属</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
        <button className="glass-btn ai !px-3 !py-1 text-[11px]" disabled={!quickText.trim()} onClick={() => void quickAdd()}>
          添加
        </button>
      </div>

      {/* 计划列表 */}
      {filtered.length === 0 ? (
        <div className="glass-card hoverable anim-fade-up" style={{ animationDelay: '240ms' }}>
          <EmptyState
            emoji="🎯"
            title={plans.length === 0 ? '这一天还没有计划' : '没有符合筛选的计划'}
            hint={plans.length === 0 ? '点击右上角「新建安排」，或在命令面板（Ctrl+K）里快速录入。' : '换个筛选条件试试。'}
          />
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {categoryGroups.map((group) => {
            const collapsed =
              group.key !== 'flat' &&
              (catCollapsed[group.key] !== undefined ? !!catCollapsed[group.key] : !!group.defaultCollapsed)
            const isProjectGroup = group.kind === 'project'
            return (
              <section
                key={group.key}
                className="anim-fade-up overflow-hidden rounded-2xl border border-white/[0.06] bg-white/[0.02]"
              >
                {group.meta ? (
                  <div
                    className={`flex flex-wrap items-center gap-2 px-3 py-2.5 ${collapsed ? '' : 'border-b border-white/[0.05]'}`}
                    style={{ borderLeft: `3px solid ${group.meta.color}` }}
                  >
                    <button
                      type="button"
                      className="flex min-w-0 flex-1 items-center gap-2 text-left"
                      onClick={() => setCatCollapsed((m) => ({ ...m, [group.key]: !collapsed }))}
                    >
                      <span className="text-[11px] text-slate-500">{collapsed ? '▸' : '▾'}</span>
                      {isProjectGroup ? (
                        <span
                          className="inline-flex h-2 w-2 shrink-0 rounded-full"
                          style={{ background: group.meta.color }}
                        />
                      ) : (
                        <span className="text-[14px] leading-none">{group.meta.emoji}</span>
                      )}
                      {isProjectGroup ? (
                        <span className="shrink-0 text-[10px] font-medium uppercase tracking-wider text-slate-500">项目</span>
                      ) : null}
                      <span className="min-w-0 truncate text-[13px] font-semibold tracking-wide" style={{ color: group.meta.color }}>
                        {group.meta.label}
                      </span>
                      <span className="rounded-md bg-white/[0.06] px-1.5 py-0.5 text-[10px] tabular-nums text-slate-400">
                        {group.items.length}
                      </span>
                      {isProjectGroup && collapsed ? (
                        <span className="text-[10px] text-slate-600">点击展开</span>
                      ) : null}
                    </button>
                    {group.key === 'other' ? (
                      <div className="flex flex-wrap items-center gap-1.5">
                        {newCatOpen ? (
                          <>
                            <input
                              className="glass-input !w-28 !py-0.5 !text-[11px]"
                              placeholder="新分类名"
                              value={newCatLabel}
                              autoFocus
                              onChange={(e) => setNewCatLabel(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') void createCategory()
                                if (e.key === 'Escape') setNewCatOpen(false)
                              }}
                            />
                            <button className="glass-btn primary !px-2 !py-0.5 !text-[10px]" onClick={() => void createCategory()}>创建</button>
                            <button className="glass-btn !px-2 !py-0.5 !text-[10px]" onClick={() => setNewCatOpen(false)}>取消</button>
                          </>
                        ) : (
                          <button className="glass-btn !px-2 !py-0.5 !text-[10px]" onClick={() => setNewCatOpen(true)}>+ 分类</button>
                        )}
                      </div>
                    ) : null}
                  </div>
                ) : null}
                {collapsed ? null : (
                  <div className="flex flex-col gap-0 divide-y divide-white/[0.04] p-1.5">
                    {group.items.map((p, idx) => {
            const done = p.status === 'done'
            const cancelled = p.status === 'cancelled'
            const fc = forecasts.get(p.id)
            const risky = !done && !cancelled && !!fc && fc.completionProb < 40
            const ratio = done ? 100 : Math.round((p.completionRatio ?? 0) * 100)
            const isExpanded = expanded === p.id
            if (done || cancelled) {
              return (
                <div
                  key={p.id}
                  className="anim-fade-up flex items-center gap-2.5 rounded-xl px-3 py-2"
                  style={{ animationDelay: `${240 + Math.min(idx * 30, 180)}ms` }}
                >
                  <button
                    className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                      done ? 'border-neon-green/60 bg-neon-green/15 text-neon-green' : 'border-white/15 text-slate-500'
                    }`}
                    title={done ? '标记为待办' : '标记完成'}
                    onClick={() => void toggleDone(p)}
                  >
                    <Icon name="check" size={10} />
                  </button>
                  <div className={`min-w-0 flex-1 truncate text-[12px] ${done ? 'text-slate-400' : 'text-slate-500 line-through'}`}>{p.title}</div>
                  <span className="shrink-0 text-[10px] text-slate-600">{done ? '已完成' : '已取消'}</span>
                  <button className="glass-btn !px-1.5 !py-0.5" title="编辑" onClick={() => setEditor({ plan: p, isNew: false })}>
                    <Icon name="edit" size={12} />
                  </button>
                  <button
                    className="glass-btn danger !px-1.5 !py-0.5"
                    title={confirmDelId === p.id ? '再点一次确认删除' : '删除'}
                    onClick={() => {
                      if (confirmDelId === p.id) {
                        void remove(p)
                        setConfirmDelId(null)
                      } else setConfirmDelId(p.id)
                    }}
                  >
                    <Icon name="trash" size={12} />
                  </button>
                </div>
              )
            }
            const proj = !isProjectGroup && p.projectId ? projects.find((x) => x.id === p.projectId) : null
            const taskName = p.projectTaskId ? taskNames[p.projectTaskId] : undefined
            const metaBits: string[] = []
            if ((p.planType ?? 'phase') === 'reminder' && p.startMin !== undefined) metaBits.push(`${clockOf(p.startMin)} 提醒`)
            else if ((p.planType ?? 'phase') === 'phase') {
              if (p.startMin !== undefined && p.endMin !== undefined) metaBits.push(`${clockOf(p.startMin)}–${clockOf(p.endMin)}`)
              if (p.durationMin !== undefined) metaBits.push(fmtMin(p.durationMin))
            }
            metaBits.push(PLAN_TYPE_LABEL[p.planType ?? 'phase'])
            if (taskName) metaBits.push(taskName)
            if (fc && !done && (p.planType ?? 'phase') === 'phase') {
              metaBits.push(
                fc.completionProb > 70 ? `大概率 ${fc.completionProb}%` : fc.completionProb >= 40 ? `有风险 ${fc.completionProb}%` : `可能延期 ${fc.completionProb}%`
              )
            }
            if (p.fired && !done) metaBits.push('已提醒')
            return (
              <div
                key={p.id}
                className={`anim-fade-up rounded-xl px-3 py-2.5 transition-colors ${
                  isExpanded ? 'bg-white/[0.04]' : 'hover:bg-white/[0.03]'
                }`}
                style={{
                  animationDelay: `${240 + Math.min(idx * 40, 240)}ms`,
                  borderLeft: `3px solid ${planStatusColor(p, risky)}`
                }}
              >
                <div className="flex items-start gap-2.5">
                  <button
                    className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border transition-all ${
                      done ? 'border-neon-green bg-neon-green/20 text-neon-green' : 'border-white/20 text-transparent hover:scale-110 hover:border-neon-green/60'
                    }`}
                    style={{ transitionDuration: '150ms' }}
                    title={done ? '标记为待办' : '标记完成'}
                    onClick={() => void toggleDone(p)}
                  >
                    <Icon name="check" size={12} />
                  </button>
                  <button className="min-w-0 flex-1 text-left" onClick={() => setExpanded(isExpanded ? null : p.id)}>
                    <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                      {proj ? (
                        <span
                          className="inline-flex max-w-[6.5rem] shrink-0 items-center truncate rounded px-1.5 py-px text-[10px] font-semibold"
                          style={{
                            color: proj.color ?? '#22D3EE',
                            background: `${proj.color ?? '#22D3EE'}18`
                          }}
                          title={`所属项目：${proj.name}`}
                        >
                          {proj.name}
                        </span>
                      ) : null}
                      <span className="min-w-0 truncate text-[13px] font-medium text-slate-100">{p.title}</span>
                      <span
                        className="inline-flex shrink-0 items-center rounded px-1.5 py-px text-[10px] font-medium"
                        style={{
                          color: STATUS_COLOR[p.status],
                          background: `${STATUS_COLOR[p.status]}18`
                        }}
                      >
                        {STATUS_LABEL[p.status]}
                      </span>
                    </div>
                    <div className="mt-1 text-[11px] leading-relaxed text-slate-500">
                      {metaBits.length ? <span>{metaBits.join(' · ')}</span> : null}
                      {metaBits.length ? <span className="text-slate-700"> · </span> : null}
                      <SourceMark plan={p} />
                    </div>
                    {p.note ? <div className="mt-1 truncate text-[11px] text-slate-600">{p.note}</div> : null}
                    {ratio > 0 ? (
                      <div className="mt-2 h-1 overflow-hidden rounded-full bg-white/[0.06]">
                        <div
                          className="h-full rounded-full transition-all duration-500"
                          style={{ width: `${ratio}%`, background: planBarGradient(p, risky) }}
                        />
                      </div>
                    ) : null}
                  </button>
                  <div className="flex shrink-0 items-center gap-1">
                    {!done && !cancelled ? (
                      <button
                        className="glass-btn ai !px-2 !py-1 !text-[11px]"
                        title="AI 整理今日目的"
                        onClick={() => void doBreakdown(p)}
                      >
                        ✦
                      </button>
                    ) : null}
                    <button className="glass-btn !px-2 !py-1" title="编辑" onClick={() => setEditor({ plan: p, isNew: false })}>
                      <Icon name="edit" size={13} />
                    </button>
                    <button
                      className="glass-btn danger !px-2 !py-1"
                      title={confirmDelId === p.id ? '再点一次确认删除' : '删除'}
                      onClick={() => {
                        if (confirmDelId === p.id) {
                          void remove(p)
                          setConfirmDelId(null)
                        } else setConfirmDelId(p.id)
                      }}
                    >
                      <Icon name="trash" size={13} />
                    </button>
                  </div>
                </div>
                {(() => {
                  const kids = childPlansOf(p.id).filter((c) => c.status !== 'cancelled')
                  if (!kids.length) return null
                  return (
                    <div className="mt-2 space-y-1 border-t border-white/[0.04] pt-2 pl-7">
                      <div className="text-[10px] text-slate-500">
                        子目标 · {kids.filter((k) => k.status === 'done').length}/{kids.length}
                      </div>
                      {kids.map((c) => (
                        <div key={c.id} className="flex items-center gap-2">
                          <button
                            className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border text-[9px] ${
                              c.status === 'done' ? 'border-neon-green/50 bg-neon-green/15 text-neon-green' : 'border-white/20 text-transparent hover:border-neon-green/50'
                            }`}
                            onClick={() => void toggleDone(c)}
                          >
                            <Icon name="check" size={9} />
                          </button>
                          <span className={`min-w-0 flex-1 truncate text-[11px] ${c.status === 'done' ? 'text-slate-500 line-through' : 'text-slate-300'}`}>{c.title}</span>
                          <button className="text-[10px] text-slate-600 hover:text-red-400" title="删除子待办" onClick={() => void remove(c)}>
                            ✕
                          </button>
                        </div>
                      ))}
                    </div>
                  )
                })()}
                {isExpanded ? (
                  <div className="anim-fade-in mt-2.5 space-y-2.5 border-t border-white/[0.05] pt-2.5 pl-7">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-[10px] font-medium uppercase tracking-wider text-slate-600">
                        {group.key === 'other' || (!p.projectId && resolveCatId(p) === 'other') ? '归档到' : '归到'}
                      </span>
                      {QUICK_BUCKETS.map((b) => (
                        <button
                          key={b.id}
                          type="button"
                          className={`rounded-md px-2 py-1 text-[11px] transition-colors ${
                            resolveCatId(p) === b.id
                              ? 'bg-neon-cyan/15 font-medium text-neon-cyan'
                              : 'bg-white/[0.04] text-slate-400 hover:text-slate-200'
                          }`}
                          onClick={() => void setPlanCategory(p.id, b.id)}
                        >
                          {b.label}
                        </button>
                      ))}
                      <select
                        className="glass-input !w-28 !py-0.5 !px-1 !text-[10px]"
                        value={categories.some((c) => c.id === p.category) ? p.category : 'other'}
                        title="选择分类"
                        onChange={(e) => void setPlanCategory(p.id, e.target.value)}
                      >
                        {categories.map((c) => (
                          <option key={c.id} value={c.id}>{c.emoji} {c.label}</option>
                        ))}
                        {!categories.some((c) => c.id === 'other') ? <option value="other">📋 未分类</option> : null}
                      </select>
                      {projects.length > 0 ? (
                        <select
                          className="glass-input !w-28 !py-0.5 !px-1 !text-[10px]"
                          value={p.projectId ?? ''}
                          title="归属项目"
                          onChange={(e) => void setPlanProject(p.id, e.target.value || null)}
                        >
                          <option value="">无项目</option>
                          {projects.map((pj) => (
                            <option key={pj.id} value={pj.id}>{pj.name}</option>
                          ))}
                        </select>
                      ) : null}
                    </div>
                    {breakdowns[p.id] ? (
                      breakdowns[p.id].loading ? (
                        <div className="mb-2.5 rounded-xl border border-white/[0.06] p-2.5" style={{ background: 'var(--aura-soft)' }}>
                          <AiThinking hints={['正在整理今日目的…', '正在归纳优化面…', '生成粗目标清单…']} />
                        </div>
                      ) : (
                        <div className="mb-2.5 rounded-xl border border-[rgba(139,92,246,0.28)] p-2.5" style={{ background: 'var(--aura-soft)' }}>
                          <div className="mb-1 flex items-center justify-between gap-2">
                            <div className="flex items-center gap-1.5 text-[11px] font-bold text-[var(--violet)]">
                              <span
                                className="flex h-4 w-4 shrink-0 items-center justify-center rounded-[5px] text-[9px] leading-none text-white"
                                style={{ background: 'var(--aura)', boxShadow: 'var(--glow-i)' }}
                              >
                                ✦
                              </span>
                              AI 粗目标
                              {breakdowns[p.id].applied ? (
                                <span className="ml-1.5 text-[10px] font-normal text-[var(--teal-deep)]">已同步</span>
                              ) : null}
                            </div>
                            <button
                              className="glass-btn !px-2 !py-0.5 !text-[10px]"
                              disabled={!parseBreakdownSteps(breakdowns[p.id].text).length}
                              onClick={() => void applyBreakdown(p)}
                              title="按当前结果再同步一次"
                            >
                              {breakdowns[p.id].applied ? '重新同步' : `同步（${parseBreakdownSteps(breakdowns[p.id].text).length}）`}
                            </button>
                          </div>
                          <div className="whitespace-pre-wrap text-[11.5px] leading-relaxed text-slate-300">{breakdowns[p.id].text}</div>
                          {parseBreakdownSteps(breakdowns[p.id].text).length ? (
                            <div className="mt-2 space-y-0.5 border-t border-white/[0.06] pt-2">
                              <div className="mb-0.5 text-[10px] text-slate-500">
                                {breakdowns[p.id].applied ? '已同步' : '将同步'}
                              </div>
                              {parseBreakdownSteps(breakdowns[p.id].text).map((s, i) => (
                                <div key={i} className="text-[11px] text-slate-400">· {s}</div>
                              ))}
                            </div>
                          ) : null}
                        </div>
                      )
                    ) : null}
                    {fc && (p.planType ?? 'phase') === 'phase' ? (
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
                    {/* 完成比例拖动（半完成管理，仅 phase） */}
                    {(p.planType ?? 'phase') === 'phase' ? (
                      <div className="mt-2 flex items-center gap-2 border-t border-white/[0.05] pt-2.5">
                        <span className="w-16 shrink-0 text-[11px] text-slate-500">完成比例</span>
                        <input
                          type="range"
                          min={0}
                          max={100}
                          step={5}
                          value={Math.round(ratioDraft[p.id] ?? (p.completionRatio ?? (done ? 1 : 0)) * 100)}
                          className="flex-1"
                          onChange={(e) => {
                            // 防抖：拖动只更新本地草稿，停手 400ms 或松手才提交
                            const v = Number(e.target.value)
                            setRatioDraft((d) => ({ ...d, [p.id]: v }))
                            if (ratioTimers.current[p.id]) clearTimeout(ratioTimers.current[p.id])
                            ratioTimers.current[p.id] = setTimeout(() => {
                              delete ratioTimers.current[p.id]
                              void window.api.updatePlanProgress(p.id, v / 100).then(() => void load())
                            }, 400)
                          }}
                          onPointerUp={() => {
                            const v = ratioDraft[p.id]
                            if (v === undefined) return
                            if (ratioTimers.current[p.id]) clearTimeout(ratioTimers.current[p.id])
                            delete ratioTimers.current[p.id]
                            void window.api.updatePlanProgress(p.id, v / 100).then(() => void load())
                          }}
                        />
                        <span className="w-10 text-right text-[11px] font-semibold text-neon-cyan">
                          {Math.round((p.completionRatio ?? (done ? 1 : 0)) * 100)}%
                        </span>
                      </div>
                    ) : null}
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
              </section>
            )
          })}
        </div>
      )}

      {editor ? (
        <PlanEditor
          plan={editor.plan}
          isNew={editor.isNew}
          onClose={() => setEditor(null)}
          onSaved={(savedDate) => {
            // 保存到其他日期时把视图切过去（setDate 会触发 load）
            if (savedDate !== date) setDate(savedDate)
            else void load()
          }}
        />
      ) : null}
        {pasteOpen ? (
          <div className="anim-fade-in fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={() => setPasteOpen(false)}>
            <div className="glass-card anim-scale-in w-[440px] !p-5" style={{ borderRadius: 'var(--r-xl)', boxShadow: 'var(--shadow-lg)' }} onClick={(e) => e.stopPropagation()}>
              <div className="mb-2 flex items-center gap-2 text-[14px] font-semibold text-slate-100">
                <span
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border"
                  style={{ background: 'var(--accent-softer)', borderColor: 'var(--border-active)', color: 'var(--accent)' }}
                >
                  <Icon name="scan" size={14} />
                </span>
                粘贴文本导入
              </div>
              <textarea
                className="glass-input min-h-[140px] w-full resize-y !py-2.5 text-[12px] leading-relaxed"
                placeholder="把会议纪要、聊天记录、需求描述粘进来，AI 会提取可执行的待办…"
                value={pasteText}
                onChange={(e) => { setPasteText(e.target.value); setPasteItems([]) }}
              />
              {pasteItems.length ? (
                <div className="sub-card mt-2 !p-2.5">
                  <div className="mb-1 text-[10px] uppercase tracking-wider text-slate-600">解析出 {pasteItems.length} 项</div>
                  {pasteItems.map((it, i) => (
                    <div key={i} className="py-0.5 text-[12px] text-slate-300">· {it}</div>
                  ))}
                </div>
              ) : null}
              <div className="mt-3 flex justify-end gap-2">
                <button className="glass-btn text-[12px]" onClick={() => setPasteOpen(false)}>取消</button>
                {pasteItems.length ? (
                  <button className="glass-btn primary text-[12px]" onClick={() => void savePasted()}>导入 {pasteItems.length} 项</button>
                ) : (
                  <button className="glass-btn ai text-[12px]" disabled={pasteBusy || !pasteText.trim()} onClick={() => void parsePaste()}>
                    ✦ {pasteBusy ? '解析中…' : 'AI 解析'}
                  </button>
                )}
              </div>
            </div>
          </div>
        ) : null}
      {folderModal && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={() => setFolderModal(false)}>
          <div className="glass-card anim-scale-in w-[400px] max-h-[60vh] overflow-auto" onClick={e => e.stopPropagation()}>
            <h3 className="text-[15px] font-semibold text-slate-200 mb-3">📁 工作文件夹</h3>
            {folderDirs.length === 0 ? (<p className="text-[12px] text-slate-500 mb-3">未配置工作目录。添加后会议纪要解析将自动生效。</p>) : (
              folderDirs.map(d => <div key={d} className="flex items-center justify-between text-[12px] bg-white/5 rounded-lg px-3 py-2 mb-1"><span className="text-slate-300 truncate">{d}</span><button onClick={async () => { const next = folderDirs.filter(x => x !== d); setFolderDirs(next); await window.api?.setSettings?.({ folders: next }); await window.api?.setFolders?.(next) }} className="text-slate-500 hover:text-red-400">✕</button></div>)
            )}
            <div className="flex gap-2 mt-3">
              <button className="glass-btn primary text-[12px]" onClick={async () => {
                await window.api?.getSettings?.().then(s => setFolderDirs(((s as any).folders) ?? []))
              }}>刷新</button>
              <button className="glass-btn primary text-[12px]" onClick={async () => {
                const paths = await window.api?.selectFolders?.() as string[] | undefined
                if (paths?.length) { const next = [...new Set([...folderDirs, ...paths])]; setFolderDirs(next); await window.api?.setSettings?.({ folders: next }); await window.api?.setFolders?.(next) }
              }}>+ 添加目录</button>
              <button className="glass-btn text-[12px]" onClick={() => setFolderModal(false)}>关闭</button>
            </div>
          </div>
        </div>
      )}
      </>
      )}

      {/* ── 确认归档（仅每日计划 Tab）：已确认项分类展示 / 编辑 / 归档 ── */}
      {tab === 'plan' ? (() => {
        const confirmed = plans.filter(
          (p) =>
            (p.confirmedFromQA || p.source === 'qa-confirm') &&
            p.source !== 'session' &&
            !p.sessionDerived
        )
        const daily = confirmed.filter((p) => !p.projectId)
        const projRel = confirmed.filter((p) => p.projectId)
        if (!confirmed.length) return null
        const group = (label: string, list: PlanItem[]) =>
          list.length ? (
            <div key={label} className="min-w-0 flex-1 rounded-xl border border-[var(--line)] bg-[var(--surface-2)] p-3">
              <div className="mb-1.5 text-[10px] uppercase tracking-wider text-slate-600">{label} · {list.length}</div>
              {list.map((p) => (
                <div key={p.id} className="flex items-center gap-2 py-1">
                  <span className="min-w-0 flex-1 truncate text-[12px] text-slate-300">{p.title}</span>
                  <button className="glass-btn !px-2 !py-0.5 !text-[10px]" onClick={() => setEditor({ plan: p, isNew: false })}>编辑</button>
                  <button
                    className="glass-btn !px-2 !py-0.5 !text-[10px]"
                    title="归档后从计划列表消失，可在此区查看"
                    onClick={() => { void window.api.savePlan({ id: p.id, archived: true }); void load() }}
                  >归档</button>
                </div>
              ))}
            </div>
          ) : null
        return (
          <div className="anim-fade-up mt-5">
            <div className="mb-2 text-[10px] uppercase tracking-[0.14em] text-slate-600">确认归档 · 已确认内容（可编辑 / 归档）</div>
            <div className="flex flex-wrap items-stretch gap-3">
              {group('每日计划', daily)}
              {group('项目开发', projRel)}
              {group('问答确认', confirmed.filter((p) => p.source === 'qa-confirm' || p.confirmedFromQA))}
            </div>
          </div>
        )
      })() : null}
    </div>
  )
}
