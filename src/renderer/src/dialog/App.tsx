/**
 * 全局对话框（v7 项目循环入口 · Alt+Space 唤起）
 * 一框多能：项目意图（澄清→建项目+计划）/ 进度反喂（状态卡导入 diff）/ 问答 / 指令
 */
import { useEffect, useRef, useState } from 'react'
import type { Project } from '@shared/types'

interface Msg {
  role: 'user' | 'assistant'
  content: string
}

type Mode = 'chat' | 'cardOut' | 'cardIn'

export default function DialogApp() {
  const [msgs, setMsgs] = useState<Msg[]>([
    {
      role: 'assistant',
      content:
        '我是项目循环助手。可以：\n· 说「我要做一个 XX」→ 我会问几个问题然后建项目和计划\n· 粘贴进度/状态卡 → 我来对账更新\n· 直接问任何事'
    }
  ])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [projects, setProjects] = useState<Project[]>([])
  const [mode, setMode] = useState<Mode>('chat')
  const [cardMd, setCardMd] = useState('')
  const [cardDiff, setCardDiff] = useState<{ completed: string[]; added: string[]; untouched: string[] } | null>(null)
  const [tip, setTip] = useState('')
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    void window.api
      ?.listProjects?.()
      .then((ps) => setProjects((ps as Project[]) ?? []))
      .catch(() => undefined)
  }, [])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [msgs, cardDiff])

  const flash = (m: string): void => {
    setTip(m)
    window.setTimeout(() => setTip(''), 2600)
  }

  const send = async (): Promise<void> => {
    const q = input.trim()
    if (!q || busy) return
    setInput('')
    setMsgs((m) => [...m, { role: 'user', content: q }])
    setBusy(true)
    try {
      const r = (await window.api?.askQA?.(q)) as { content?: string } | string | undefined
      const content = typeof r === 'string' ? r : r?.content
      setMsgs((m) => [...m, { role: 'assistant', content: content || '（AI 未返回内容，可在设置检查 Key）' }])
    } catch {
      setMsgs((m) => [...m, { role: 'assistant', content: '出了点小问题，稍后再试。' }])
    } finally {
      setBusy(false)
    }
  }

  const genCard = async (projectId: string): Promise<void> => {
    try {
      const card = (await window.api?.buildStatusCard?.(projectId)) as { markdown: string; projectName: string } | undefined
      if (!card) return
      setCardMd(card.markdown)
      setMode('cardOut')
      await navigator.clipboard.writeText(card.markdown).catch(() => undefined)
      flash(`「${card.projectName}」状态卡已复制到剪贴板 ✓`)
    } catch {
      flash('生成失败')
    }
  }

  const parseCard = async (): Promise<void> => {
    if (!cardMd.trim()) {
      flash('先粘贴状态卡内容')
      return
    }
    const diff = (await window.api?.parseStatusCard?.(cardMd)) as { completed: string[]; added: string[]; untouched: string[] } | undefined
    setCardDiff(diff ?? { completed: [], added: [], untouched: [] })
  }

  const applyDiff = async (): Promise<void> => {
    if (!cardDiff) return
    const r = (await window.api?.applyCardDiff?.(cardDiff)) as { completed: number; added: number } | undefined
    flash(`已更新：完成 ${r?.completed ?? 0} 项 · 新增 ${r?.added ?? 0} 项`)
    setMode('chat')
    setCardMd('')
    setCardDiff(null)
  }

  return (
    <div className="flex h-screen w-screen flex-col p-2">
      <div
        className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--bg-surface)]/92 backdrop-blur-xl"
        style={{ boxShadow: 'var(--shadow-lg)' }}
      >
        {/* 顶部模式切换（无品牌） */}
        <div className="flex items-center gap-1 border-b border-[var(--line)] px-3 py-2">
          {(
            [
              ['chat', '对话'],
              ['cardOut', '状态卡'],
              ['cardIn', '导入进度']
            ] as [Mode, string][]
          ).map(([k, label]) => (
            <button
              key={k}
              className={`rounded-lg px-2.5 py-1 text-[11px] transition-colors ${
                mode === k ? 'bg-[var(--surface-3)] text-[var(--teal-deep)]' : 'text-slate-500 hover:text-slate-200'
              }`}
              onClick={() => setMode(k)}
            >
              {label}
            </button>
          ))}
          <span className="ml-auto text-[10px] text-slate-600">Alt+Space 显隐</span>
        </div>

        {mode === 'chat' ? (
          <>
            <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
              {msgs.map((m, i) => (
                <div key={i} className={`mb-2 flex ${m.role === 'user' ? 'justify-end' : 'gap-2'}`}>
                  {m.role === 'assistant' ? (
                    <span
                      className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-[10px] text-white"
                      style={{ background: 'var(--aura)' }}
                    >
                      ✦
                    </span>
                  ) : null}
                  <div
                    className={`max-w-[82%] whitespace-pre-wrap rounded-xl px-3 py-2 text-[12px] leading-relaxed ${
                      m.role === 'user' ? 'text-white' : 'border border-[var(--line)] bg-[var(--surface-2)] text-slate-200'
                    }`}
                    style={m.role === 'user' ? { background: 'var(--aura)', borderTopRightRadius: 4 } : undefined}
                  >
                    {m.content}
                  </div>
                </div>
              ))}
              {busy ? <div className="pl-7 text-[11px] text-slate-500">✦ 思考中…</div> : null}
              <div ref={bottomRef} />
            </div>
            <div className="flex items-center gap-2 border-t border-[var(--line)] p-2.5">
              <input
                autoFocus
                className="min-w-0 flex-1 rounded-xl border border-[var(--line)] bg-[var(--surface-2)] px-3 py-2 text-[12px] text-slate-200 outline-none focus:border-[var(--border-active)]"
                placeholder="说个想法、粘个进度、或直接问…"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && void send()}
              />
              <button className="glass-btn ai !px-3 !py-2 text-[11px]" disabled={busy} onClick={() => void send()}>
                ➤
              </button>
            </div>
          </>
        ) : null}

        {mode === 'cardOut' ? (
          <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-3">
            <div className="text-[11px] text-slate-500">选项目生成状态卡（已自动复制最新一张）：</div>
            {projects.map((p) => (
              <button
                key={p.id}
                className="flex items-center gap-2 rounded-xl border border-[var(--line)] bg-[var(--surface-2)] px-3 py-2 text-left transition-all hover:border-[rgba(15,181,164,0.4)]"
                onClick={() => void genCard(p.id)}
              >
                <span className="min-w-0 flex-1 truncate text-[12px] text-slate-200">{p.name}</span>
                <span className="shrink-0 text-[10px] text-[var(--teal-deep)]">生成 → 剪贴板</span>
              </button>
            ))}
            {!projects.length ? <div className="text-[11px] text-slate-600">还没有项目。回对话里说「我要做一个 XX」来创建。</div> : null}
            {cardMd ? (
              <pre className="whitespace-pre-wrap rounded-xl border border-[var(--line)] bg-[var(--surface-2)] p-2.5 text-[10.5px] leading-relaxed text-slate-300">
                {cardMd}
              </pre>
            ) : null}
          </div>
        ) : null}

        {mode === 'cardIn' ? (
          <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-3">
            <textarea
              className="min-h-[140px] w-full rounded-xl border border-[var(--line)] bg-[var(--surface-2)] p-2.5 text-[11.5px] leading-relaxed text-slate-200 outline-none focus:border-[var(--border-active)]"
              placeholder="把状态卡 / 任意格式的进展粘贴到这里，我来对账：勾选完成、发现新待办…"
              value={cardMd}
              onChange={(e) => {
                setCardMd(e.target.value)
                setCardDiff(null)
              }}
            />
            {cardDiff ? (
              <div className="rounded-xl border border-[var(--line)] bg-[var(--surface-2)] p-2.5 text-[11.5px]">
                <div className="mb-1 font-bold text-slate-300">对账预览</div>
                {cardDiff.completed.map((t, i) => (
                  <div key={`c${i}`} className="text-[var(--teal-deep)]">☑ 完成：{t}</div>
                ))}
                {cardDiff.added.map((t, i) => (
                  <div key={`a${i}`} className="text-[#fbbf24]">➕ 新增待办：{t}</div>
                ))}
                {cardDiff.untouched.map((t, i) => (
                  <div key={`u${i}`} className="text-slate-500">· 未提及（保持）：{t}</div>
                ))}
                {!cardDiff.completed.length && !cardDiff.added.length ? <div className="text-slate-500">没有识别到变更（用 - [x] / - [ ] 格式更容易识别）</div> : null}
              </div>
            ) : null}
            <div className="mt-auto flex justify-end gap-2">
              <button className="glass-btn !py-1.5 text-[11px]" onClick={() => void parseCard()}>
                解析对账
              </button>
              <button className="glass-btn primary !py-1.5 text-[11px]" disabled={!cardDiff} onClick={() => void applyDiff()}>
                应用更新
              </button>
            </div>
          </div>
        ) : null}

        {tip ? <div className="border-t border-[var(--line)] px-3 py-1.5 text-[11px] text-[var(--teal-deep)]">{tip}</div> : null}
      </div>
    </div>
  )
}
