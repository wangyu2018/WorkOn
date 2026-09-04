import { useCallback, useEffect, useState, useRef } from 'react'
import type { PlanForecast, PlanItem, PlanStatus, PlanType, PlanVsActual } from '@shared/types'
import { Icon } from '../components/Icon'
import { PageHeader } from '../components/PageHeader'
import { EmptyState } from '../components/EmptyState'
import { ProgressRing } from '../components/ProgressRing'
import { InsightCard } from '../components/ui/InsightCard'
import { AiThinking } from '../components/ui/AiThinking'
import { addDays, clockOf, fmtDateLabel, fmtMin, timeToMin, todayKey } from '../components/utils'
import { parsePlanText } from '../components/parsePlanText'
import { ProjectBoard } from '../components/ProjectBoard'

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

/** 计划类型图标：reminder ◆紫 / phase ▬绿 / task ☐琥珀 */
function planTypeIcon(t: PlanType): string {
  if (t === 'reminder') return '◆'
  if (t === 'phase') return '▬'
  return '☐'
}
function planTypeColor(t: PlanType): string {
  if (t === 'reminder') return '#A78BFA'
  if (t === 'phase') return '#10B981'
  return '#F59E0B'
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

/** 计划来源标记（浏览器确认 🌐 / 手动确认 💬 / 手动创建 ✏️ / 其他同步源） */
function SourceMark({ plan }: { plan: PlanItem }) {
  if (plan.browserDerived) return <span className="chip !py-0" title="浏览器行为确认">🌐 浏览器确认</span>
  if (plan.confirmedFromQA) return <span className="chip !py-0" title="问答确认">💬 确认记录</span>
  if (plan.source === 'manual') return <span className="chip !py-0" title="手动创建">✏️ 手动</span>
  return <span className="chip !py-0">{plan.source}</span>
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
  useEffect(() => {
    void window.api?.listProjects?.().then((ps) => setProjOptions((ps as { id: string; name: string }[]) ?? [])).catch(() => undefined)
  }, [])

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
      projectId: projId || undefined
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
          <div className="flex items-center gap-2">
            <label className="shrink-0 text-[11px] text-slate-500">归属项目</label>
            <select className="glass-input !py-1 text-[12px]" value={projId} onChange={(e) => setProjId(e.target.value)}>
              <option value="">不归属</option>
              {projOptions.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
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
  const [plans, setPlans] = useState<PlanItem[]>([])
  const [projects, setProjects] = useState<{ id: string; name: string; color?: string }[]>([])
  const [pva, setPva] = useState<PlanVsActual | null>(null)
  const [trail, setTrail] = useState<{ segments: { mainApp: string; durationMin: number; mainState: string }[] } | null>(null)
  const [forecasts, setForecasts] = useState<Map<string, PlanForecast>>(new Map())
  const [statusFilter, setStatusFilter] = useState<'all' | PlanStatus>('all')
  const [editor, setEditor] = useState<{ plan: Partial<PlanItem> & { date: string }; isNew: boolean } | null>(null)
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
  /** ✦ AI 拆解结果（按计划 id）：loading 中显示思考态 */
  const [breakdowns, setBreakdowns] = useState<Record<string, { loading: boolean; text: string }>>({})
  /** 连续达成天数（截至所选日期前一天，逐日用现有 planVsActual 推导） */
  const [streak, setStreak] = useState<number | null>(null)

  const load = useCallback(async () => {
    try {
      const [ps, pv, fc, tr, prjs] = await Promise.all([
        window.api.listPlans(date),
        window.api.planVsActual(date),
        window.api.getForecast(date).catch(() => []),
        window.api.getTrail(date).catch(() => null),
        window.api.listProjects().catch(() => [])
      ])
      setPlans(((ps as PlanItem[]) ?? []).filter((p) => !p.archived))
      setPva(pv as PlanVsActual)
      setTrail(tr as { segments: { mainApp: string; durationMin: number; mainState: string }[] } | null)
      setProjects((prjs as { id: string; name: string; color?: string }[]) ?? [])
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

  // 命令面板「打开项目开发」→ 切到项目 Tab
  useEffect(() => {
    const onGoto = () => setTab('project')
    window.addEventListener('workon:goto-projects', onGoto)
    return () => window.removeEventListener('workon:goto-projects', onGoto)
  }, [])

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

  /** ✦ AI 拆解：把计划拆成可执行步骤（复用问答 IPC，本地模式走规则引擎） */
  const doBreakdown = async (p: PlanItem) => {
    if (breakdowns[p.id]?.loading) return
    setExpanded(p.id)
    setBreakdowns((b) => ({ ...b, [p.id]: { loading: true, text: '' } }))
    try {
      const ans = await window.api.askQAWithShots(
        `请把计划「${p.title}」拆解成 3-5 个具体可执行的步骤，每行一条、尽量简短，并在行尾标注预估耗时。`
      )
      const payload = typeof ans === 'string' ? { content: ans } : ((ans ?? {}) as { content?: string | null })
      const text =
        typeof payload.content === 'string' && payload.content ? payload.content : '（未生成拆解结果，请确认 AI 已配置后重试）'
      setBreakdowns((b) => ({ ...b, [p.id]: { loading: false, text } }))
    } catch {
      setBreakdowns((b) => ({ ...b, [p.id]: { loading: false, text: '拆解失败，请稍后再试。' } }))
    }
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
    .filter((p) => (statusFilter === 'all' ? true : p.status === statusFilter))
    .sort((a, b) => (a.startMin ?? 9999) - (b.startMin ?? 9999))

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
    <div className="view-enter flex flex-col gap-5">
      {/* 页面标题区 */}
      <PageHeader
        icon="target"
        title="每日计划"
        desc="安排目标 · 跟踪达成率与完成预测"
        actions={
          <>
            <button className="glass-btn text-[12px]" onClick={() => setPasteOpen(true)}>
              📋 粘贴文本导入
            </button>
            {importMsg ? <div className="mt-1.5 rounded-lg bg-neon-cyan/10 px-3 py-1.5 text-[11px] text-neon-cyan">{importMsg}</div> : null}
            <button
              className="glass-btn text-[12px]"
              title="在桌面常驻显示项目/待办/生活三区小组件（Ctrl+Alt+T 也可开关）"
              onClick={() => void window.api?.toggleTodoWidget?.()}
            >
              🖥 桌面待办组件
            </button>
            <button className="glass-btn primary" onClick={() => setEditor({ plan: { date }, isNew: true })}>
              <Icon name="plus" size={14} /> 新建计划
            </button>
          </>
        }
      />

      {/* 计划 / 项目 Tab 切换 */}
      <div className="anim-fade-up flex items-center gap-1 rounded-xl border border-white/[0.06] bg-white/[0.03] p-1" style={{ width: 'fit-content' }}>
        {([['plan', '每日计划'], ['project', '项目开发']] as const).map(([k, label]) => (
          <button
            key={k}
            className={`rounded-lg px-3 py-1 text-[12px] transition-colors ${tab === k ? 'bg-white/[0.08] text-slate-100' : 'text-slate-400 hover:text-slate-200'}`}
            onClick={() => setTab(k)}
          >
            {label}
          </button>
        ))}
      </div>
      {(
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

      {/* 顶部统计行：InsightCard 横排（达成率 / 今日计划 / 进行中 / 连续达成） */}
      <section className="anim-fade-up grid grid-cols-2 gap-3 lg:grid-cols-4" style={{ animationDelay: '120ms' }}>
        <InsightCard
          icon={<Icon name="target" size={14} />}
          tone="teal"
          label="今日达成率"
          big={
            <span className="flex items-center gap-2">
              <ProgressRing value={achievement} size={34} stroke={4} color={ringColor} />
              {Math.round(achievement)}%
            </span>
          }
          base={pva ? <>计划 {fmtMin(pva.plannedMin)} · 实际工作 {fmtMin(pva.actualWorkMin)}</> : '今日暂无对照数据'}
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
          base={
            <>
              被实际覆盖 {pva ? pva.matchedCount : 0} 项 · 已延期 {delayedCount} 项
            </>
          }
        />
        <InsightCard
          icon={<Icon name="activity" size={14} />}
          tone="cyan"
          label="进行中"
          big={inProgressCount}
          base={partialCount > 0 ? <>另有 {partialCount} 项部分完成</> : inProgressCount > 0 ? '正在推进，保持节奏' : '暂无进行中的计划'}
        />
        <InsightCard
          icon={<Icon name="flame" size={14} />}
          tone="amber"
          label="连续达成"
          big={streak === null ? '…' : `${streak} 天`}
          base={
            <span className="block">
              按日达成率 ≥50% 连续统计（截至前一天）
              {avgProb !== null ? (
                <span className="block">
                  AI 预测：均值 {avgProb}%{riskCount > 0 ? ` · ${riskCount} 项有风险` : ' · 暂无风险项'}
                </span>
              ) : null}
            </span>
          }
        />
      </section>

      {/* 筛选 */}
      <div className="anim-fade-up flex flex-wrap items-center gap-2" style={{ animationDelay: '180ms' }}>
        <span className="mr-0.5 flex items-center gap-1 text-[11px] font-medium text-slate-500">
          <Icon name="sliders" size={12} /> 筛选
        </span>
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
            const done = p.status === 'done'
            const cancelled = p.status === 'cancelled'
            const fc = forecasts.get(p.id)
            const risky = !done && !cancelled && !!fc && fc.completionProb < 40
            const ratio = done ? 100 : Math.round((p.completionRatio ?? 0) * 100)
            const isExpanded = expanded === p.id
            return (
              <div
                key={p.id}
                className="glass-card hoverable anim-fade-up !p-3.5"
                style={{ animationDelay: `${240 + Math.min(idx * 40, 240)}ms`, borderLeftWidth: 3, borderLeftColor: planStatusColor(p, risky) }}
              >
                <div className="flex items-center gap-3">
                  <span
                    title={PLAN_TYPE_LABEL[p.planType ?? 'phase']}
                    style={{ color: planTypeColor(p.planType ?? 'phase'), fontSize: 13, width: 14, textAlign: 'center', flexShrink: 0 }}
                  >
                    {planTypeIcon(p.planType ?? 'phase')}
                  </span>
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
                  <button className={`min-w-0 flex-1 text-left ${done || cancelled ? 'opacity-60' : ''}`} onClick={() => setExpanded(isExpanded ? null : p.id)}>
                    <div className={`flex min-w-0 items-center gap-1.5 text-[13px] font-medium ${done || cancelled ? 'text-slate-500 line-through' : 'text-slate-200'}`}>
                      <span className="min-w-0 truncate">{p.title}</span>
                      <span
                        className="inline-flex shrink-0 items-center rounded-full px-1.5 py-px text-[9px] font-bold leading-[1.6]"
                        style={{
                          color: STATUS_COLOR[p.status],
                          background: `${STATUS_COLOR[p.status]}1f`,
                          border: `1px solid ${STATUS_COLOR[p.status]}55`
                        }}
                      >
                        {STATUS_LABEL[p.status]}
                      </span>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
                      {(p.planType ?? 'phase') === 'reminder' ? (
                        p.startMin !== undefined ? (
                          <span className="flex items-center gap-1" style={{ color: '#A78BFA' }}>
                            <Icon name="bell" size={11} />
                            {clockOf(p.startMin)} 提醒
                          </span>
                        ) : null
                      ) : (p.planType ?? 'phase') === 'phase' ? (
                        <>
                          {p.startMin !== undefined && p.endMin !== undefined ? (
                            <span className="flex items-center gap-1">
                              <Icon name="clock" size={11} />
                              {clockOf(p.startMin)}–{clockOf(p.endMin)}
                            </span>
                          ) : null}
                          {p.durationMin !== undefined ? <span>{fmtMin(p.durationMin)}</span> : null}
                        </>
                      ) : null}
                      <SourceMark plan={p} />
                      {projects.length > 0 ? (
                        <select
                          className="glass-input !w-28 !py-0.5 !px-1 !text-[10px]"
                          value={p.projectId ?? ''}
                          title="归入项目"
                          onChange={(e) => void setPlanProject(p.id, e.target.value || null)}
                        >
                          <option value="">无项目</option>
                          {projects.map((pj) => (
                            <option key={pj.id} value={pj.id}>{pj.name}</option>
                          ))}
                        </select>
                      ) : null}
                      {(() => {
                        const proj = projects.find((x) => x.id === p.projectId)
                        return proj ? (
                          <span className="chip !py-0" style={{ color: proj.color ?? '#22D3EE', borderColor: `${proj.color ?? '#22D3EE'}44` }}>
                            <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: proj.color ?? '#22D3EE' }} />
                            {proj.name}
                            <button className="ml-0.5 text-slate-500 hover:text-red-400" title="移出项目" onClick={() => void setPlanProject(p.id, null)}>✕</button>
                          </span>
                        ) : null
                      })()}
                      {fc && !done && (p.planType ?? 'phase') === 'phase' ? (
                        <span
                          className={`chip !py-0 ${
                            fc.completionProb > 70 ? '!border-neon-green/50 !text-neon-green' : fc.completionProb >= 40 ? '!border-neon-amber/50 !text-neon-amber' : '!border-neon-red/50 !text-neon-red'
                          }`}
                        >
                          {fc.completionProb > 70 ? '大概率完成' : fc.completionProb >= 40 ? '有风险' : '可能延期'} {fc.completionProb}%
                        </span>
                      ) : null}
                      {p.fired && !done ? <span className="text-slate-600">已提醒</span> : null}
                      {cancelled ? <span className="text-slate-600">已取消</span> : null}
                    </div>
                    {p.note ? <div className="mt-0.5 truncate text-[11px] text-slate-600">{p.note}</div> : null}
                  </button>
                  <div className="flex shrink-0 items-center gap-1.5">
                    {!done && !cancelled ? (
                      <button
                        className="glass-btn ai !px-2 !py-1 !text-[11px]"
                        title="AI 拆解为可执行步骤"
                        onClick={() => void doBreakdown(p)}
                      >
                        ✦ AI 拆解
                      </button>
                    ) : null}
                    <button className="glass-btn !px-2 !py-1" title="编辑" onClick={() => setEditor({ plan: p, isNew: false })}>
                      <Icon name="edit" size={13} />
                    </button>
                    <button className="glass-btn danger !px-2 !py-1" title={confirmDelId === p.id ? "再点一次确认删除" : "删除"} onClick={() => { if (confirmDelId === p.id) { void remove(p); setConfirmDelId(null) } else setConfirmDelId(p.id) }}>
                      <Icon name="trash" size={13} />
                    </button>
                  </div>
                </div>
                {/* 进度条：渐变填色 + 圆角（完成比例，已完成满格） */}
                {ratio > 0 ? (
                  <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
                    <div
                      className="h-full rounded-full transition-all duration-500"
                      style={{ width: `${ratio}%`, background: planBarGradient(p, risky) }}
                    />
                  </div>
                ) : null}
                {/* 展开面板：AI 拆解 + 预测详情 + 完成比例拖动 + 延期 */}
                {isExpanded ? (
                  <div className="anim-fade-in mt-3 border-t border-white/[0.06] pt-3">
                    {/* ✦ AI 拆解结果（AI 场景：aura 底 + 思考态） */}
                    {breakdowns[p.id] ? (
                      breakdowns[p.id].loading ? (
                        <div className="mb-2.5 rounded-xl border border-white/[0.06] p-2.5" style={{ background: 'var(--aura-soft)' }}>
                          <AiThinking hints={['正在拆解计划为执行步骤…', '正在估算各步耗时…', '整理执行清单中…']} />
                        </div>
                      ) : (
                        <div className="mb-2.5 rounded-xl border border-[rgba(139,92,246,0.28)] p-2.5" style={{ background: 'var(--aura-soft)' }}>
                          <div className="mb-1 flex items-center gap-1.5 text-[11px] font-bold text-[var(--violet)]">
                            <span
                              className="flex h-4 w-4 shrink-0 items-center justify-center rounded-[5px] text-[9px] leading-none text-white"
                              style={{ background: 'var(--aura)', boxShadow: 'var(--glow-i)' }}
                            >
                              ✦
                            </span>
                            AI 拆解步骤
                          </div>
                          <div className="whitespace-pre-wrap text-[11.5px] leading-relaxed text-slate-300">{breakdowns[p.id].text}</div>
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
          <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={() => setPasteOpen(false)}>
            <div className="glass-card anim-scale-in w-[440px] !p-5" style={{ borderRadius: 'var(--r-xl)', boxShadow: 'var(--shadow-lg)' }} onClick={(e) => e.stopPropagation()}>
              <div className="mb-2 text-[14px] font-semibold text-slate-100">粘贴文本导入</div>
              <textarea
                className="min-h-[140px] w-full rounded-xl border border-[var(--line)] bg-[var(--surface-2)] p-2.5 text-[12px] leading-relaxed text-slate-200 outline-none focus:border-[var(--border-active)]"
                placeholder="把会议纪要、聊天记录、需求描述粘进来，AI 会提取可执行的待办…"
                value={pasteText}
                onChange={(e) => { setPasteText(e.target.value); setPasteItems([]) }}
              />
              {pasteItems.length ? (
                <div className="mt-2 rounded-xl border border-[var(--line)] bg-[var(--surface-2)] p-2.5">
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
      {/* ── 项目开发（与每日计划同页平铺，经归属引擎与任务双向关联） ── */}
      <ProjectBoard trail={trail} />
      </>
      )}

      {/* ── 确认归档（第三分区）：已确认项分类展示 / 编辑 / 归档 ── */}
      {(() => {
        const confirmed = plans.filter((p) => p.confirmedFromQA || p.source === 'qa-confirm' || p.source === 'session')
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
      })()}
    </div>
  )
}
