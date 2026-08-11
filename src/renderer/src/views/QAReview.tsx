import { useEffect, useRef, useState } from 'react'
import type { ProfileReference, QAMessage } from '@shared/types'
import { genId } from '@shared/types'
import { PRIVACY_LEVEL_META } from '@shared/personaMeta'
import { Icon } from '../components/Icon'
import { EmptyState } from '../components/EmptyState'
import { useSettingsStore } from '../stores/settingsStore'
import peierAvatar from '../assets/peier-avatar.png'

/** 姵儿圆形头像（加载失败时优雅降级为 emoji 圆标） */
function PeierAvatar() {
  const [broken, setBroken] = useState(false)
  if (broken) {
    return (
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border-2 border-neon-cyan/30 bg-neon-cyan/10 text-lg">
        🐱
      </div>
    )
  }
  return (
    <img
      src={peierAvatar}
      alt="姵儿"
      className="h-10 w-10 shrink-0 rounded-full border-2 border-neon-cyan/30 object-cover"
      onError={() => setBroken(true)}
    />
  )
}

/** 助手气泡底部的画像引用标记：去重层级 chip（L3/L4 防御过滤不显示），title 显示引用摘要 */
function ReferenceChips({ refs }: { refs?: ProfileReference[] }) {
  const visible = (refs ?? []).filter((r) => r.layer !== 'L3' && r.layer !== 'L4')
  if (visible.length === 0) return null
  const byLayer = [...new Map(visible.map((r) => [r.layer, r])).values()]
  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5 border-t border-white/[0.06] pt-1.5">
      <span className="text-[10px] text-slate-500">本次回复引用了你的画像数据</span>
      {byLayer.map((r) => {
        const pm = PRIVACY_LEVEL_META[r.layer] ?? PRIVACY_LEVEL_META.L0
        return (
          <span
            key={r.layer}
            title={r.summary}
            className="rounded border px-1 py-px text-[9px]"
            style={{ color: pm.color, borderColor: `${pm.color}44`, background: `${pm.color}14` }}
          >
            [{r.layer}]
          </span>
        )
      })}
    </div>
  )
}

/** 本地消息：在 QAMessage 基础上附带本次回复的画像引用标记（v2.7） */
type LocalQAMessage = QAMessage & { references?: ProfileReference[] }

/** 问答回顾：消息流（助手气泡带姵儿头像）+ 底部输入（AI 未配置时为本地统计模式） */
export default function QAReview() {
  const aiReady = useSettingsStore((s) => s.settings.aiEnabled && !!s.settings.aiApiKey)
  const [messages, setMessages] = useState<LocalQAMessage[]>([])
  const [input, setInput] = useState('')
  const [thinking, setThinking] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const [qaList, setQaList] = useState<Array<{id:string, date:string, question:string, answer:string, ts:number}>>([])
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [pruneMode, setPruneMode] = useState(false)

  const LOCAL_EXAMPLES = ['今天专注了多久？', '我什么时候效率最高？', '今天摸鱼多久了？', '我最常用的应用？', '双屏并行占比？']

  useEffect(() => {
    window.api
      .listQA()
      .then((list) => setMessages((list as QAMessage[]) ?? []))
      .catch(() => undefined)
  }, [])

  useEffect(() => { void window.api?.listQA?.().then(r => setQaList(r as any[] ?? [])) }, [])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, thinking])

  const ask = async (q: string) => {
    if (!q || thinking) return
    setInput('')
    setThinking(true)
    setMessages((prev) => [...prev, { id: genId('qa'), role: 'user', content: q, ts: Date.now() }])
    try {
      const ans = await window.api.askQA(q)
      // v2.7：askQA 返回 { content, references }；兼容旧的 string 形态
      const payload = typeof ans === 'string' ? { content: ans, references: [] } : ((ans ?? {}) as { content?: string | null; references?: ProfileReference[] })
      const content = typeof payload.content === 'string' && payload.content ? payload.content : '（本次未生成回复，换个问法试试？）'
      const references = Array.isArray(payload.references) ? payload.references : []
      setMessages((prev) => [...prev, { id: genId('qa'), role: 'assistant', content, references, ts: Date.now() }])
    } catch {
      setMessages((prev) => [...prev, { id: genId('qa'), role: 'assistant', content: '回答失败，请稍后再试。', ts: Date.now() }])
    } finally {
      setThinking(false)
    }
  }

  const send = () => void ask(input.trim())

  return (
    <div className="view-enter flex h-full flex-col gap-4">
      {/* 页面标题区：图标 + 标题 + 副标题 + 右侧模式状态 */}
      <header className="anim-fade-up flex shrink-0 items-center gap-3">
        <div className="shadow-glow flex h-9 w-9 items-center justify-center rounded-xl border border-neon-cyan/25 bg-neon-cyan/10 text-neon-cyan">
          <Icon name="message" size={17} />
        </div>
        <div className="min-w-0">
          <h2 className="text-[15px] font-semibold text-slate-200">问答回顾</h2>
          <p className="mt-0.5 text-[11px] text-slate-500">向姵儿提问今日工作状态，随时回顾历史问答</p>
        </div>
        <span className="chip ml-auto shrink-0">{aiReady ? '🤖 AI 模式' : '📊 本地模式'}</span>
        <button className="glass-btn text-[11px] ml-2 shrink-0" onClick={() => { setPruneMode(!pruneMode); if (pruneMode) setSelectedIds(new Set()) }}>🗑 管理回顾</button>
      </header>

      {!aiReady ? (
        <div className="anim-fade-up shrink-0 rounded-2xl border border-neon-amber/25 bg-gradient-to-r from-neon-amber/[0.09] via-neon-amber/[0.05] to-transparent px-4 py-3" style={{ animationDelay: '60ms' }}>
          <div className="text-[12px] leading-relaxed text-neon-amber">📊 本地模式：未配置 AI，可回答基础统计问题；配置后解锁深度问答</div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {LOCAL_EXAMPLES.map((q) => (
              <button
                key={q}
                className="rounded-lg border border-white/[0.08] bg-white/[0.03] px-2 py-1 text-[11px] text-slate-400 transition-all hover:-translate-y-px hover:border-neon-cyan/40 hover:bg-neon-cyan/10 hover:text-neon-cyan active:scale-95"
                onClick={() => void ask(q)}
              >
                {q}
              </button>
            ))}
          </div>
        </div>
      ) : null}
      <div className="anim-fade-up shrink-0 flex flex-wrap gap-2 mb-3" style={{ animationDelay: '80ms' }}>
        <button className="glass-btn text-[11px]" onClick={() => void ask('生成今天的注意力曲线报告')}>
          📈 注意力曲线
        </button>
        <button className="glass-btn text-[11px]" onClick={() => void ask('生成本周效率报表')}>
          📊 周效率报表
        </button>
      </div>
      {pruneMode && (
        <div className="glass-card hoverable mt-3 p-3 anim-fade-up">
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-[13px] font-semibold text-slate-200">选择保留的日期</h4>
            <div className="flex gap-2">
              <button className="glass-btn text-[11px]" onClick={() => setPruneMode(false)}>取消</button>
              <button className="glass-btn primary text-[11px]" onClick={async () => {
                const keep = [...selectedIds]
                await window.api?.pruneQA?.(keep)
                window.location.reload()
              }}>保留所选，删除其余</button>
            </div>
          </div>
          {Object.entries(qaList.reduce<Record<string, typeof qaList>>((acc, q) => { const d = q.date ?? new Date(q.ts).toISOString().slice(0, 10); if (!acc[d]) acc[d] = []; acc[d].push(q); return acc }, {})).map(([date, items]) => (
            <div key={date} className="mb-2">
              <label className="flex items-center gap-2 cursor-pointer text-[12px]">
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
                    {isFirstInGroup ? <PeierAvatar /> : <div className="w-10 shrink-0" />}
                    <div className="max-w-[75%] whitespace-pre-wrap rounded-2xl rounded-bl-sm border border-white/[0.07] bg-white/[0.04] px-3.5 py-2.5 text-[13px] leading-relaxed text-slate-200 shadow-[0_2px_10px_rgba(0,0,0,0.18)]">
                      {m.content}
                      <ReferenceChips refs={m.references} />
                    </div>
                  </div>
                )
              }
              return (
                <div key={m.id} className="anim-fade-up flex justify-end">
                  <div className="max-w-[75%] whitespace-pre-wrap rounded-2xl rounded-br-sm border border-neon-cyan/25 bg-neon-cyan/15 px-3.5 py-2.5 text-[13px] leading-relaxed text-neon-cyan">
                    {m.content}
                  </div>
                </div>
              )
            })}
            {thinking ? (
              <div className="anim-fade-up flex items-end justify-start gap-2">
                <PeierAvatar />
                <div className="flex items-center gap-1.5 rounded-2xl rounded-bl-sm border border-white/[0.07] bg-white/[0.04] px-3.5 py-2.5 text-[13px] text-slate-400">
                  <span className="pulse-dot h-1.5 w-1.5 rounded-full bg-neon-violet" />
                  <span className="pulse-dot h-1.5 w-1.5 rounded-full bg-neon-violet" style={{ animationDelay: '150ms' }} />
                  <span className="pulse-dot h-1.5 w-1.5 rounded-full bg-neon-violet" style={{ animationDelay: '300ms' }} />
                  <span className="ml-1">姵儿思考中…</span>
                </div>
              </div>
            ) : null}
            <div ref={bottomRef} />
          </div>
        )}
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
        <button className="glass-btn primary shrink-0 px-4" disabled={!input.trim() || thinking} onClick={send}>
          <Icon name="send" size={14} /> 发送
        </button>
      </div>
    </div>
  )
}
