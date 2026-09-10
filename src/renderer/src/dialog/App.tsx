/**
 * 全局对话框（v7 项目循环入口 · Alt+Space 唤起）
 * 复制反哺提示词给开发 AI → 粘贴回传 → 进展 + 下一步待办
 */
import { useEffect, useRef, useState } from 'react'
import type { Project } from '@shared/types'

interface Msg {
  role: 'user' | 'assistant'
  content: string
}

type Mode = 'chat' | 'cardOut' | 'cardIn'

type CardDiffView = {
  projectId?: string
  completed: string[]
  added: string[]
  untouched: string[]
  completedTasks: string[]
  addedTasks: string[]
  deferred: string[]
  progressNote: string
  summary?: string
}

export default function DialogApp() {
  const [msgs, setMsgs] = useState<Msg[]>([
    {
      role: 'assistant',
      content:
        '项目循环助手：\n· 「反哺提示词」→ 复制后贴给 Cursor/开发 AI，要进展+下一步细计划\n· 「回传整理」→ 把回复贴回来，写入进展并导入今日待办\n· 也可以直接对话'
    }
  ])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [projects, setProjects] = useState<Project[]>([])
  const [mode, setMode] = useState<Mode>('chat')
  const [cardMd, setCardMd] = useState('')
  const [cardProjectId, setCardProjectId] = useState('')
  const [cardDiff, setCardDiff] = useState<CardDiffView | null>(null)
  const [tip, setTip] = useState('')
  const bottomRef = useRef<HTMLDivElement>(null)

  const refreshProjects = async (): Promise<Project[]> => {
    const ps = ((await window.api?.listProjects?.()) as Project[]) ?? []
    const list = ps.filter((p) => p.status === 'active')
    setProjects(list)
    if (!cardProjectId && list[0]) setCardProjectId(list[0].id)
    return list
  }

  useEffect(() => {
    void refreshProjects().catch(() => undefined)
  }, [])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [msgs, cardDiff])

  const flash = (m: string): void => {
    setTip(m)
    window.setTimeout(() => setTip(''), 2800)
  }

  const tryCreateProject = async (raw: string): Promise<boolean> => {
    const m =
      raw.match(/^(?:我要(?:做|做一个|开发|搞)|新建项目|创建项目)[:：\s]*(.+)$/i) ||
      raw.match(/^做个项目[:：\s]*(.+)$/i)
    if (!m?.[1]) return false
    const name = m[1].trim().replace(/[。！？.!?]+$/u, '')
    if (name.length < 2) return false
    const saved = (await window.api?.saveProject?.({ name, status: 'active', priority: 'medium', goal: name })) as Project | undefined
    await refreshProjects()
    if (saved?.id) {
      setCardProjectId(saved.id)
      setMsgs((msgs) => [
        ...msgs,
        {
          role: 'assistant',
          content: `已创建项目「${saved.name}」。\n下一步：点「反哺提示词」复制 → 贴给开发 AI → 再「回传整理」导入进展与下一步计划。`
        }
      ])
      setMode('cardOut')
      return true
    }
    return false
  }

  const looksLikeProgressPaste = (q: string): boolean => {
    if (q.length < 80) return false
    const hits =
      (/-\s*\[[ xX]\]/.test(q) ? 1 : 0) +
      (/(进展|完成|待办|下一步|阻塞|风险|checklist)/i.test(q) ? 1 : 0) +
      (q.split(/\n/).length >= 4 ? 1 : 0)
    return hits >= 2
  }

  const send = async (): Promise<void> => {
    const q = input.trim()
    if (!q || busy) return
    setInput('')
    setMsgs((m) => [...m, { role: 'user', content: q }])
    setBusy(true)
    try {
      if (await tryCreateProject(q)) return

      if (looksLikeProgressPaste(q)) {
        setCardMd(q)
        setCardDiff(null)
        setMode('cardIn')
        setMsgs((m) => [
          ...m,
          {
            role: 'assistant',
            content: '这段更像进展回传。已帮你放到「回传整理」：选好项目后点「AI 整理待办/进度」。'
          }
        ])
        return
      }

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
      setCardProjectId(projectId)
      setMode('cardOut')
      await navigator.clipboard.writeText(card.markdown).catch(() => undefined)
      flash(`「${card.projectName}」反哺提示词已复制 · 贴给开发 AI 后再回传`)
    } catch {
      flash('生成失败')
    }
  }

  const summarize = async (): Promise<void> => {
    if (!cardMd.trim()) {
      flash('先粘贴开发工具的回复')
      return
    }
    if (!cardProjectId) {
      flash('先选一个项目')
      return
    }
    setBusy(true)
    try {
      const api = window.api as {
        summarizeStatusCard?: (projectId: string, text: string) => Promise<CardDiffView>
        parseStatusCard?: (md: string, projectId?: string) => Promise<CardDiffView>
      }
      const diff = api.summarizeStatusCard
        ? await api.summarizeStatusCard(cardProjectId, cardMd)
        : await api.parseStatusCard?.(cardMd, cardProjectId)
      setCardDiff({
        projectId: cardProjectId,
        completed: diff?.completed ?? [],
        added: diff?.added ?? [],
        untouched: diff?.untouched ?? [],
        completedTasks: diff?.completedTasks ?? [],
        addedTasks: diff?.addedTasks ?? [],
        deferred: diff?.deferred ?? [],
        progressNote: diff?.progressNote ?? '',
        summary: diff?.summary
      })
    } catch {
      flash('整理失败')
    } finally {
      setBusy(false)
    }
  }

  const applyDiff = async (): Promise<void> => {
    if (!cardDiff) return
    const r = (await window.api?.applyCardDiff?.({ ...cardDiff, projectId: cardProjectId || cardDiff.projectId })) as {
      completed?: number
      added?: number
      completedTasks?: number
      addedTasks?: number
      deferred?: number
      progressUpdated?: boolean
    } | undefined
    flash(
      `已整理：待办完成 ${r?.completed ?? 0} · 新增 ${r?.added ?? 0} · 未实现 ${r?.deferred ?? 0} · 任务完成 ${r?.completedTasks ?? 0} · 新任务 ${r?.addedTasks ?? 0}` +
        (r?.progressUpdated ? ' · 进展已更新' : '')
    )
    setMode('chat')
    setCardMd('')
    setCardDiff(null)
  }

  return (
    <div
      className="flex h-screen w-screen flex-col overflow-hidden bg-black"
      style={{ background: '#000000', boxShadow: 'none' }}
    >
        <div className="flex items-center gap-1 border-b border-[var(--line)] px-3 py-2">
          {(
            [
              ['chat', '对话'],
              ['cardOut', '反哺提示词'],
              ['cardIn', '回传整理']
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
          <span className="ml-auto text-[10px] text-slate-600">Alt+Space</span>
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
                placeholder="说个想法，或切到「回传整理」贴进度…"
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
            <div className="text-[11px] leading-relaxed text-slate-500">
              选项目复制「反哺提示词」→ 贴给 Cursor / 开发 AI（要进展 + 下一步细计划）→ 把回复贴回「回传整理」，WorkOn 会写入进展并导入今日待办。
            </div>
            {projects.map((p) => (
              <button
                key={p.id}
                className="flex items-center gap-2 rounded-xl border border-[var(--line)] bg-[var(--surface-2)] px-3 py-2 text-left transition-all hover:border-[rgba(15,181,164,0.4)]"
                onClick={() => void genCard(p.id)}
              >
                <span className="min-w-0 flex-1 truncate text-[12px] text-slate-200">{p.name}</span>
                <span className="shrink-0 text-[10px] text-[var(--teal-deep)]">生成并复制</span>
              </button>
            ))}
            {!projects.length ? <div className="text-[11px] text-slate-600">还没有活跃项目。</div> : null}
            {cardMd ? (
              <>
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-slate-500">预览（已在剪贴板）</span>
                  <button
                    className="text-[10px] text-[var(--teal-deep)] hover:underline"
                    onClick={() => void navigator.clipboard.writeText(cardMd).then(() => flash('已再次复制'))}
                  >
                    再复制一次
                  </button>
                </div>
                <pre className="whitespace-pre-wrap rounded-xl border border-[var(--line)] bg-[var(--surface-2)] p-2.5 text-[10.5px] leading-relaxed text-slate-300">
                  {cardMd}
                </pre>
              </>
            ) : null}
          </div>
        ) : null}

        {mode === 'cardIn' ? (
          <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-3">
            <div className="text-[11px] text-slate-500">把开发工具的回复贴回来，整理成今日待办、项目任务，并更新「最近进展」。</div>
            <select
              className="rounded-xl border border-[var(--line)] bg-[var(--surface-2)] px-2.5 py-1.5 text-[12px] text-slate-200 outline-none"
              value={cardProjectId}
              onChange={(e) => {
                setCardProjectId(e.target.value)
                setCardDiff(null)
              }}
            >
              {!projects.length ? <option value="">无项目</option> : null}
              {projects.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
            <textarea
              className="min-h-[140px] w-full rounded-xl border border-[var(--line)] bg-[var(--surface-2)] p-2.5 text-[11.5px] leading-relaxed text-slate-200 outline-none focus:border-[var(--border-active)]"
              placeholder="粘贴 Cursor / IDE / Chat 的回复（自由文本或带 - [x] / - [ ] 均可）…"
              value={cardMd}
              onChange={(e) => {
                setCardMd(e.target.value)
                setCardDiff(null)
              }}
            />
            {cardDiff ? (
              <div className="rounded-xl border border-[var(--line)] bg-[var(--surface-2)] p-2.5 text-[11.5px]">
                <div className="mb-1 font-bold text-slate-300">整理预览</div>
                {cardDiff.summary ? <div className="mb-1.5 text-slate-400">摘要：{cardDiff.summary}</div> : null}
                {cardDiff.progressNote ? (
                  <div className="mb-1.5 whitespace-pre-wrap rounded-lg bg-black/20 p-2 text-[11px] text-slate-300">
                    进展：{cardDiff.progressNote}
                  </div>
                ) : null}
                {cardDiff.completed.map((t, i) => (
                  <div key={`c${i}`} className="text-[var(--teal-deep)]">☑ 待办完成：{t}</div>
                ))}
                {cardDiff.added.map((t, i) => (
                  <div key={`a${i}`} className="text-[#fbbf24]">➕ 今日目标：{t}</div>
                ))}
                {cardDiff.deferred.map((t, i) => (
                  <div key={`d${i}`} className="text-neon-amber/90">⏳ 未实现：{t}</div>
                ))}
                {cardDiff.completedTasks.map((t, i) => (
                  <div key={`ct${i}`} className="text-[var(--teal-deep)]">☑ 任务完成：{t}</div>
                ))}
                {cardDiff.addedTasks.map((t, i) => (
                  <div key={`at${i}`} className="text-[#fbbf24]">➕ 新任务：{t}</div>
                ))}
                {cardDiff.untouched.map((t, i) => (
                  <div key={`u${i}`} className="text-slate-500">· 未提及（保持）：{t}</div>
                ))}
                {!cardDiff.completed.length && !cardDiff.added.length && !cardDiff.deferred.length && !cardDiff.completedTasks.length && !cardDiff.addedTasks.length && !cardDiff.progressNote ? (
                  <div className="text-slate-500">没有识别到变更，可再贴一段更完整的回复</div>
                ) : null}
              </div>
            ) : null}
            <div className="mt-auto flex justify-end gap-2">
              <button className="glass-btn !py-1.5 text-[11px]" disabled={busy} onClick={() => void summarize()}>
                {busy ? '整理中…' : 'AI 整理待办/进度'}
              </button>
              <button className="glass-btn primary !py-1.5 text-[11px]" disabled={!cardDiff} onClick={() => void applyDiff()}>
                应用更新
              </button>
            </div>
          </div>
        ) : null}

        {tip ? <div className="border-t border-[var(--line)] px-3 py-1.5 text-[11px] text-[var(--teal-deep)]">{tip}</div> : null}
    </div>
  )
}
