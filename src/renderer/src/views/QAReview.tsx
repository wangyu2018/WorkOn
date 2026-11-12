import { useEffect, useMemo, useRef, useState } from 'react'
import type { MergedTrail, PlanItem, ProfileReference, QAMessage } from '@shared/types'
import { genId } from '@shared/types'
import { dateKey } from '@shared/trail'
import { SLACK_STATES, WORK_LIKE_STATES } from '@shared/stateMeta'
import { PRIVACY_LEVEL_META } from '@shared/personaMeta'
import { PageHeader } from '../components/PageHeader'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { EmptyState } from '../components/EmptyState'
import { AiThinking } from '../components/ui/AiThinking'
import { useSettingsStore } from '../stores/settingsStore'
import { TraceTunnel } from '../components/TraceTunnel'

/** ✦ 渐变头像（AI 专属身份标识：aura 渐变圆角方块 + 白✦ + 辉光） */
function AuraAvatar({ size = 26 }: { size?: number }) {
  return (
    <span
      className="flex shrink-0 items-center justify-center rounded-[9px] text-sm leading-none text-white"
      style={{ width: size, height: size, background: 'var(--aura)', boxShadow: 'var(--glow-i)' }}
    >
      ✦
    </span>
  )
}

/** AI 思考态场景文案（AiThinking 轮换） */
const QA_THINK_HINTS = ['正在翻阅你的时段记录…', '正在比对历史问答…', '整理答案中…']

/** 输入框上方的追问快捷 chips（点击即填入并发送） */
const FOLLOW_UP_CHIPS = ['📊 生成今日小结', '🔥 哪段最专注？', '🐟 摸鱼都去哪了？', '🗓 帮我排下午计划']

/** 助手气泡底部的引用来源行：⛓ 来源摘要 + 去重层级 chip（L3/L4 防御过滤不显示） */
function ReferenceChips({ refs }: { refs?: ProfileReference[] }) {
  const visible = (refs ?? []).filter((r) => r.layer !== 'L3' && r.layer !== 'L4')
  if (visible.length === 0) return null
  const byLayer = [...new Map(visible.map((r) => [r.layer, r])).values()]
  const sources = [...new Set(visible.map((r) => (r.summary.length > 22 ? `${r.summary.slice(0, 22)}…` : r.summary)))].slice(0, 3)
  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5 border-t border-white/[0.06] pt-1.5">
      <span className="text-2xs text-slate-500" title={visible.map((r) => r.summary).join('\n')}>
        ⛓ 来源：{sources.length > 0 ? sources.join(' · ') : '你的画像数据'}
      </span>
      {byLayer.map((r) => {
        const pm = PRIVACY_LEVEL_META[r.layer] ?? PRIVACY_LEVEL_META.L0
        return (
          <span
            key={r.layer}
            title={r.summary}
            className="rounded border px-1 py-px text-2xs"
            style={{ color: pm.color, borderColor: `${pm.color}44`, background: `${pm.color}14` }}
          >
            [{r.layer}]
          </span>
        )
      })}
    </div>
  )
}

/** 本地消息：在 QAMessage 基础上附带本次回复的画像引用标记（v2.7）与处理轨迹 id */
type LocalQAMessage = QAMessage & { references?: ProfileReference[]; traceId?: string }

type BoardDay = 'today' | 'yesterday'

/** 分钟 → 1h20m / 36m */
function fmtDurMin(min: number): string {
  const total = Math.round(min)
  if (total < 60) return `${total}m`
  const h = Math.floor(total / 60)
  const m = total % 60
  return m > 0 ? `${h}h${m}m` : `${h}h`
}

/** 问答回顾：消息流（✦ AI 头像 + aura 用户气泡）+ 追问 chips + 底部输入（AI 未配置时为本地统计模式） */
export default function QAReview() {
  const aiReady = useSettingsStore((s) => s.settings.aiEnabled && !!s.settings.aiApiKey)
  const [messages, setMessages] = useState<LocalQAMessage[]>([])
  const [input, setInput] = useState('')
  const [thinking, setThinking] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const [qaList, setQaList] = useState<Array<{id:string, date:string, question:string, answer:string, ts:number}>>([])
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [pruneMode, setPruneMode] = useState(false)
  const [confirmPrune, setConfirmPrune] = useState(false)
  /** L2 隧道：当前下钻的 trace id（null = 关闭） */
  const [traceId, setTraceId] = useState<string | null>(null)
  /** 顶部吸附看板：今日/昨日切换 + 展开收起 */
  const [boardDay, setBoardDay] = useState<BoardDay>('today')
  const [boardOpen, setBoardOpen] = useState(true)
  const [dayTrail, setDayTrail] = useState<MergedTrail | null>(null)
  const [dayPlans, setDayPlans] = useState<PlanItem[]>([])

  useEffect(() => {
    const d = boardDay === 'today' ? Date.now() : Date.now() - 86400000
    const key = dateKey(d)
    void Promise.all([
      (window.api?.getTrail?.(key) as Promise<MergedTrail | null>).catch(() => null),
      (window.api?.listPlans?.(key) as Promise<PlanItem[]>).catch(() => [])
    ]).then(([t, p]) => {
      setDayTrail(t)
      setDayPlans(Array.isArray(p) ? p : [])
    })
  }, [boardDay])

  const summary = useMemo(() => {
    let work = 0
    let slack = 0
    for (const s of dayTrail?.segments ?? []) {
      if (s.glance) continue
      if (WORK_LIKE_STATES.includes(s.mainState)) work += s.durationMin
      else if (SLACK_STATES.includes(s.mainState)) slack += s.durationMin
    }
    const done = dayPlans.filter((p) => p.status === 'done').length
    return {
      work,
      slack,
      dual: Math.round((dayTrail?.dualRatio ?? 0) * 100),
      done,
      total: dayPlans.length
    }
  }, [dayTrail, dayPlans])

  const LOCAL_EXAMPLES = ['今天专注了多久？', '我什么时候效率最高？', '今天摸鱼多久了？', '我最常用的应用？', '双屏并行占比？']

  useEffect(() => {
    window.api
      .listQA()
      .then((list) => {
        const arr = (list as QAMessage[]) ?? []
        setMessages(arr)
        // 派生回顾列表（按天分组用）：取助手回答，date 由 ts 推导
        setQaList(
          arr
            .filter((m) => m.role === 'assistant')
            .map((m) => ({ id: m.id, date: new Date(m.ts).toISOString().slice(0, 10), question: '', answer: m.content, ts: m.ts }))
        )
      })
      .catch(() => undefined)
  }, [])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, thinking])

  const ask = async (q: string) => {
    if (!q || thinking) return
    setInput('')
    setThinking(true)
    // 开始对话即主动收起看板，把空间让给对话
    setBoardOpen(false)
    setMessages((prev) => [...prev, { id: genId('qa'), role: 'user', content: q, ts: Date.now() }])
    try {
      const ans = await window.api.askQAWithShots(q)
      // v2.7：askQA 返回 { content, references }；兼容旧的 string 形态
      const payload = typeof ans === 'string' ? { content: ans, references: [] } : ((ans ?? {}) as { content?: string | null; references?: ProfileReference[]; traceId?: string })
      const content = typeof payload.content === 'string' && payload.content ? payload.content : '（本次未生成回复，换个问法试试？）'
      const references = Array.isArray(payload.references) ? payload.references : []
      setMessages((prev) => [...prev, { id: genId('qa'), role: 'assistant', content, references, traceId: payload.traceId, ts: Date.now() }])
    } catch {
      setMessages((prev) => [...prev, { id: genId('qa'), role: 'assistant', content: '回答失败，请稍后再试。', ts: Date.now() }])
    } finally {
      setThinking(false)
    }
  }

  const send = () => void ask(input.trim())

  /** 追问 chip：填入输入框并直接发送 */
  const askChip = (q: string) => {
    if (thinking) return
    setInput(q)
    void ask(q)
  }

  return (
    <div className="view-enter flex h-full flex-col gap-4">
      {/* 页面标题区：图标 + 标题 + 副标题 + 右侧模式状态 */}
      <div className="shrink-0">
        <PageHeader
          icon="message"
          title="问答回顾"
          desc="向姵儿提问今日工作状态，随时回顾历史问答"
          actions={
            <>
              <span className="chip shrink-0">{aiReady ? '🤖 AI 模式' : '📊 本地模式'}</span>
              <button className="glass-btn text-xs shrink-0" onClick={() => { setPruneMode(!pruneMode); if (pruneMode) setSelectedIds(new Set()) }}>🗑 管理回顾</button>
            </>
          }
        />
      </div>

      {/* 顶部吸附看板：今日 / 昨日切换，开始对话后自动收起 */}
      <div className="shrink-0">
        <div className="glass-card !p-2">
          <div className="flex items-center gap-1.5">
            <div className="flex shrink-0 items-center gap-0.5 rounded-lg p-0.5" style={{ background: 'var(--surface-2)' }}>
              {(['today', 'yesterday'] as const).map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setBoardDay(k)}
                  className={`rounded-md px-2.5 py-1 text-xs transition-colors ${
                    boardDay === k ? 'text-white' : 'text-slate-500 hover:text-slate-300'
                  }`}
                  style={boardDay === k ? { background: 'var(--accent)' } : undefined}
                >
                  {k === 'today' ? '今日' : '昨日'}
                </button>
              ))}
            </div>
            <span className="min-w-0 truncate text-xs text-slate-500">
              专注 {fmtDurMin(summary.work)} · 摸鱼 {fmtDurMin(summary.slack)}
              {summary.total > 0 ? ` · 计划 ${summary.done}/${summary.total}` : ''}
            </span>
            <button
              type="button"
              onClick={() => setBoardOpen((v) => !v)}
              className="ml-auto shrink-0 rounded-md px-2 py-0.5 text-xs text-slate-500 transition-colors hover:bg-[var(--surface-2)] hover:text-slate-200"
              aria-expanded={boardOpen}
            >
              {boardOpen ? '收起' : '展开'}
            </button>
          </div>
          {boardOpen ? (
            <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
              {[
                { label: '专注', value: fmtDurMin(summary.work) },
                { label: '摸鱼', value: fmtDurMin(summary.slack) },
                { label: '双屏并行', value: `${summary.dual}%` },
                { label: '计划完成', value: summary.total > 0 ? `${summary.done}/${summary.total}` : '—' }
              ].map((m) => (
                <div
                  key={m.label}
                  className="rounded-lg border border-white/[0.06] px-2.5 py-2"
                  style={{ background: 'rgba(255,255,255,0.02)' }}
                >
                  <div className="text-2xs text-slate-500">{m.label}</div>
                  <div className="mt-0.5 text-sm tabular-nums text-slate-100">{m.value}</div>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      </div>

      {!aiReady ? (
        <div className="anim-fade-up shrink-0 rounded-2xl border border-neon-amber/25 bg-gradient-to-r from-neon-amber/[0.09] via-neon-amber/[0.05] to-transparent px-4 py-3" style={{ animationDelay: '60ms' }}>
          <div className="text-xs leading-relaxed text-neon-amber">📊 本地模式：未配置 AI，可回答基础统计问题；配置后解锁深度问答</div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {LOCAL_EXAMPLES.map((q) => (
              <button
                key={q}
                className="rounded-lg border border-white/[0.08] bg-white/[0.03] px-2 py-1 text-xs text-slate-400 transition-all hover:-translate-y-px hover:border-neon-cyan/40 hover:bg-neon-cyan/10 hover:text-neon-cyan active:scale-95"
                onClick={() => void ask(q)}
              >
                {q}
              </button>
            ))}
          </div>
        </div>
      ) : null}
      <div className="anim-fade-up shrink-0 flex flex-wrap gap-2 mb-3" style={{ animationDelay: '80ms' }}>
        <button className="glass-btn text-xs" onClick={() => void ask('生成今天的注意力曲线报告')}>
          📈 注意力曲线
        </button>
        <button className="glass-btn text-xs" onClick={() => void ask('分析今天的工作效率')}>
          📊 周效率报表
        </button>
      </div>
      {pruneMode && (
        <div className="glass-card hoverable mt-3 p-3 anim-fade-up">
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-sm font-semibold text-slate-200">选择保留的日期</h4>
            <div className="flex gap-2">
              <button className="glass-btn text-xs" onClick={() => setPruneMode(false)}>取消</button>
              <button className="glass-btn danger text-xs" onClick={() => setConfirmPrune(true)}>保留所选，删除其余</button>
            </div>
            {confirmPrune && (
              <ConfirmDialog
                open
                danger
                title="确认删除"
                message={`将删除未勾选的全部问答记录（保留 ${selectedIds.size} 个日期的数据）。此操作不可恢复。`}
                confirmLabel="确认删除"
                onConfirm={() => {
                  setConfirmPrune(false)
                  const keep = [...selectedIds]
                  void (async () => {
                    await window.api?.pruneQA?.(keep)
                    const list = ((await window.api?.listQA?.().catch(() => [])) ?? []) as QAMessage[]
                    setMessages(list)
                    setPruneMode(false)
                  })()
                }}
                onCancel={() => setConfirmPrune(false)}
              />
            )}
          </div>
          {Object.entries(qaList.reduce<Record<string, typeof qaList>>((acc, q) => { const d = q.date ?? new Date(q.ts).toISOString().slice(0, 10); if (!acc[d]) acc[d] = []; acc[d].push(q); return acc }, {})).map(([date, items]) => (
            <div key={date} className="mb-2">
              <label className="flex items-center gap-2 cursor-pointer text-xs">
                <input type="checkbox" checked={items.every(i => selectedIds.has(i.id))} onChange={e => {
                  const next = new Set(selectedIds)
                  if (e.target.checked) items.forEach(i => next.add(i.id))
                  else items.forEach(i => next.delete(i.id))
                  setSelectedIds(next)
                }} className="accent-neon-cyan" />
                <span className="text-slate-300">{date}</span>
                <span className="text-slate-500">({items.length}条)</span>
              </label>
            </div>
          ))}
        </div>
      )}
      <div className="glass-card anim-fade-up min-h-0 flex-1 overflow-y-auto" style={{ animationDelay: '120ms' }}>
        {messages.length === 0 && !thinking ? (
          <EmptyState
            emoji="💬"
            title="还没有问答记录"
            hint="问我任何关于今日工作状态的问题，例如「今天专注了多久？」「我什么时候效率最高？」"
          />
        ) : (
          <div className="flex flex-col gap-3.5 py-1">
            {messages.map((m, i) => {
              // 连续助手消息只在首条显示头像，后续留空白占位对齐
              const isFirstInGroup = m.role === 'assistant' && (i === 0 || messages[i - 1].role !== 'assistant')
              if (m.role === 'assistant') {
                return (
                  <div key={m.id} className="anim-fade-up flex items-end justify-start gap-2">
                    {isFirstInGroup ? <AuraAvatar /> : <div className="w-[26px] shrink-0" />}
                    <div className="max-w-[75%] whitespace-pre-wrap rounded-2xl rounded-bl-sm border border-white/[0.07] bg-[var(--surface-2)] px-3.5 py-2.5 text-sm leading-relaxed text-slate-200 shadow-[0_2px_10px_rgba(0,0,0,0.18)]">
                      {m.content}
                      <ReferenceChips refs={m.references} />
                      {m.traceId ? (
                        <button
                          onClick={() => setTraceId(m.traceId as string)}
                          title="查看本次处理用到的插件与耗时"
                          className="mt-1.5 block border-0 bg-transparent p-0 text-2xs text-slate-500 transition-colors hover:text-slate-300"
                        >
                          ◇ 过程
                        </button>
                      ) : null}
                    </div>
                  </div>
                )
              }
              return (
                <div key={m.id} className="anim-fade-up flex justify-end">
                  <div
                    className="max-w-[75%] whitespace-pre-wrap rounded-2xl rounded-tr-sm px-3.5 py-2.5 text-sm leading-relaxed text-white"
                    style={{ background: 'var(--aura)', boxShadow: 'var(--glow-i)' }}
                  >
                    {m.content}
                  </div>
                </div>
              )
            })}
            {thinking ? (
              <div className="anim-fade-up flex items-end gap-2 pl-0.5">
                <AiThinking hints={QA_THINK_HINTS} />
              </div>
            ) : null}
            <div ref={bottomRef} />
          </div>
        )}
      </div>
      {/* 追问 chips：快捷问题胶囊，点击填入并发送 */}
      <div className="anim-fade-up flex shrink-0 flex-wrap items-center gap-2" style={{ animationDelay: '150ms' }}>
        <span className="text-xs text-slate-500">✦ 追问</span>
        {FOLLOW_UP_CHIPS.map((q) => (
          <button
            key={q}
            disabled={thinking}
            title={q}
            className="rounded-full border border-white/[0.08] bg-white/[0.03] px-3 py-1 text-xs text-slate-300 transition-all hover:-translate-y-px hover:border-[var(--violet)] hover:bg-[rgba(139,92,246,0.08)] hover:text-white active:scale-95 disabled:cursor-not-allowed disabled:opacity-40"
            onClick={() => askChip(q)}
          >
            {q}
          </button>
        ))}
      </div>
      <div className="glass-card anim-fade-up flex shrink-0 items-center gap-2 !p-2" style={{ animationDelay: '180ms' }}>
        <input
          className="glass-input flex-1"
          placeholder={aiReady ? '问点什么…（Enter 发送）' : '本地模式：问点统计问题…（Enter 发送）'}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.nativeEvent.isComposing) send()
          }}
        />
        <button className="glass-btn ai shrink-0 px-4" disabled={!input.trim() || thinking} onClick={send}>
          ✦ 发送
        </button>
      </div>
      <TraceTunnel traceId={traceId} onClose={() => setTraceId(null)} />
    </div>
  )
}
