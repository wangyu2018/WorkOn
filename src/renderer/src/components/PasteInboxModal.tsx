/**
 * 主窗口 Ctrl+V 粘贴分拣预览框：
 * 进展回传 → 选项目 AI 整理；待办清单/截图 OCR → 导入今日计划；否则默认沉淀进本地知识库
 */
import { useCallback, useEffect, useState } from 'react'
import type { Project } from '@shared/types'
import { classifyPaste, type PasteKind } from '@shared/pasteDetect'
import { Icon } from './Icon'
import { todayKey } from './utils'
import { useAppStore } from '../stores/appStore'

interface CardDiffView {
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

interface PasteInboxModalProps {
  open: boolean
  onClose: () => void
}

const KIND_META: Record<PasteKind, { label: string; hint: string }> = {
  progress: { label: '项目进展', hint: '写入最近进展与未实现；今日粗目标进待办' },
  todos: { label: '今日待办', hint: '双方话都采 · AI 润色短标题 · 确认后加入今日计划' },
  memo: { label: '知识库', hint: '文字或截图识别后，确认写成一条笔记' }
}

export function PasteInboxModal({ open, onClose }: PasteInboxModalProps) {
  const [kind, setKind] = useState<PasteKind>('memo')
  const [text, setText] = useState('')
  const [fromImage, setFromImage] = useState(false)
  const [imagePreview, setImagePreview] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  const [projects, setProjects] = useState<Project[]>([])
  const [projectId, setProjectId] = useState('')
  const [diff, setDiff] = useState<CardDiffView | null>(null)
  const [todos, setTodos] = useState<string[]>([])
  const [todoPick, setTodoPick] = useState<Record<number, boolean>>({})
  /** 原始 PNG base64（无 data: 前缀），供再次 OCR */
  const [imageB64, setImageB64] = useState<string | null>(null)

  const reset = useCallback(() => {
    setKind('memo')
    setText('')
    setFromImage(false)
    setImagePreview(null)
    setImageB64(null)
    setLoading(false)
    setStatus(null)
    setDiff(null)
    setTodos([])
    setTodoPick({})
  }, [])

  const bootstrap = useCallback(async () => {
    setLoading(true)
    setStatus('读取剪贴板…')
    setDiff(null)
    setTodos([])
    try {
      const peek = (await window.api.peekClipboard?.()) as {
        text?: string
        hasImage?: boolean
        imagePngBase64?: string | null
        kind?: PasteKind
      } | undefined
      const rawText = (peek?.text ?? '').trim()
      let nextText = rawText
      let imgB64 = peek?.imagePngBase64 ?? null
      let imaged = !!(peek?.hasImage && imgB64)

      if (imaged && imgB64) {
        setImagePreview(`data:image/png;base64,${imgB64}`)
        setImageB64(imgB64)
        setFromImage(true)
        if (rawText.length < 40) {
          setStatus('识别图片中的文字…')
          const ocr = (await window.api.ocrRecognizePng?.(imgB64)) as {
            text?: string
            kind?: PasteKind
            error?: string
          } | undefined
          if (ocr?.error && !ocr.text) {
            setStatus(`图片识别失败：${ocr.error}`)
          } else if (ocr?.text?.trim()) {
            nextText = ocr.text.trim()
            setStatus('已识别图片文字，请确认意图后导入')
          } else {
            setStatus('图片里没识别到文字，可改粘贴文本或仍写入知识库')
          }
        } else {
          setStatus('剪贴板同时有图和文字，已优先用文字')
        }
      } else {
        setImagePreview(null)
        setImageB64(null)
        setFromImage(false)
        setStatus(null)
      }

      setText(nextText)
      const guessed = peek?.kind && nextText
        ? peek.kind
        : classifyPaste(nextText, { fromImage: imaged })
      setKind(guessed)

      const ps = ((await window.api.listProjects?.()) as Project[]) ?? []
      const active = ps.filter((p) => p.status === 'active' || !p.status)
      const list = active.length ? active : ps
      setProjects(list)
      // 粘贴文里提到的项目名 → 自动预选（如 oner / WorkOn）
      const lower = nextText.toLowerCase()
      const hit = list.find((p) => {
        const n = (p.name || '').trim()
        if (n.length < 2) return false
        return lower.includes(n.toLowerCase()) || nextText.includes(n)
      })
      setProjectId((cur) => cur || hit?.id || list[0]?.id || '')

      if (guessed === 'todos' && nextText.trim()) {
        setStatus('AI 抽取并润色待办…')
        const items = ((await window.api.extractPasteTodos?.(nextText)) as string[]) ?? []
        setTodos(items)
        setTodoPick(Object.fromEntries(items.map((_, i) => [i, true])))
        setStatus(items.length ? `已润色 ${items.length} 项待办，请勾选确认` : '未抽出待办，可改文本后再解析')
      }
    } catch {
      setStatus('读取剪贴板失败')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!open) {
      reset()
      return
    }
    void bootstrap()
  }, [open, bootstrap, reset])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  /** 无文字但有截图时先 OCR；始终给出状态反馈，避免点了像没反应 */
  const ensureTextForTodos = async (): Promise<string> => {
    let body = text.trim()
    if (body) return body
    const b64 = imageB64 || (imagePreview?.includes('base64,')
      ? imagePreview.split('base64,')[1]
      : null)
    if (!b64) {
      setStatus('没有可解析的文字或截图，请先 Ctrl+V 粘贴')
      return ''
    }
    setStatus('识别截图文字…')
    try {
      const ocr = (await window.api.ocrRecognizePng?.(b64)) as {
        text?: string
        error?: string
      } | undefined
      body = (ocr?.text ?? '').trim()
      if (body) {
        setText(body)
        setFromImage(true)
        return body
      }
      setStatus(ocr?.error ? `识别失败：${ocr.error}` : '截图里没识别到文字，可手动改文本后再解析')
      return ''
    } catch {
      setStatus('识别截图失败，请稍后重试')
      return ''
    }
  }

  const reparseTodos = async (): Promise<void> => {
    setLoading(true)
    try {
      const body = await ensureTextForTodos()
      if (!body) return
      setStatus('AI 抽取并润色待办…')
      const items = ((await window.api.extractPasteTodos?.(body)) as string[]) ?? []
      setTodos(items)
      setTodoPick(Object.fromEntries(items.map((_, i) => [i, true])))
      setStatus(items.length ? `已润色 ${items.length} 项，请勾选确认` : '未抽出待办，可改文本后再点解析')
    } catch {
      setStatus('解析失败，请稍后重试')
    } finally {
      setLoading(false)
    }
  }

  const summarizeProgress = async (): Promise<void> => {
    if (!text.trim()) {
      setStatus('先粘贴或编辑内容')
      return
    }
    if (!projectId) {
      setStatus('先选一个项目')
      return
    }
    setLoading(true)
    setStatus('AI 整理进展中…')
    try {
      const d = (await window.api.summarizeStatusCard?.(projectId, text)) as CardDiffView | undefined
      setDiff({
        projectId,
        completed: d?.completed ?? [],
        added: d?.added ?? [],
        untouched: d?.untouched ?? [],
        completedTasks: d?.completedTasks ?? [],
        addedTasks: d?.addedTasks ?? [],
        deferred: d?.deferred ?? [],
        progressNote: d?.progressNote ?? '',
        summary: d?.summary
      })
      setStatus('已生成预览，确认后写入项目')
    } catch {
      setStatus('整理失败，可检查 AI 设置或稍后重试')
    } finally {
      setLoading(false)
    }
  }

  const applyProgress = async (): Promise<void> => {
    if (!diff) return
    setLoading(true)
    try {
      await window.api.applyCardDiff?.({ ...diff, projectId: projectId || diff.projectId })
      setStatus('已写入项目进展')
      window.setTimeout(onClose, 600)
    } catch {
      setStatus('写入失败')
    } finally {
      setLoading(false)
    }
  }

  const applyTodos = async (): Promise<void> => {
    const picked = todos.filter((_, i) => todoPick[i] !== false)
    if (!picked.length) {
      setStatus('请至少勾选一项')
      return
    }
    setLoading(true)
    try {
      const date = todayKey()
      for (const title of picked) {
        await window.api.savePlan({
          date,
          title: title.slice(0, 100),
          category: 'other',
          status: 'planned',
          source: 'import',
          note: fromImage ? '来自粘贴截图识别' : '来自粘贴导入'
        })
      }
      setStatus(`已加入今日待办 ${picked.length} 项`)
      window.setTimeout(onClose, 600)
    } catch {
      setStatus('导入失败')
    } finally {
      setLoading(false)
    }
  }

  const applyMemo = async (sediment = true): Promise<void> => {
    const t = text.trim()
    if (!t) {
      setStatus('内容为空')
      return
    }
    setLoading(true)
    try {
      if (sediment) {
        const r = await (
          window.api as {
            sedimentMemoToKnowledge?: (p: {
              text: string
              title?: string
              source?: string
              fileName?: string
            }) => Promise<{ ok?: boolean }>
          }
        ).sedimentMemoToKnowledge?.({
          text: t,
          title: fromImage ? '截图识别' : t.slice(0, 40),
          source: 'paste',
          fileName: fromImage ? `截图-${Date.now()}.png` : undefined
        })
        if (!r?.ok) {
          setStatus('写入知识库失败')
          return
        }
        setStatus(fromImage ? '截图已识别并写入知识库' : '已写入本地知识库')
        window.setTimeout(() => {
          onClose()
          useAppStore.getState().setView('knowledge')
        }, 450)
        return
      }
      await window.api.addMemo?.(t)
      setStatus('已仅存备忘（未进知识库）')
      window.setTimeout(onClose, 700)
    } catch {
      setStatus(sediment ? '写入知识库失败' : '保存备忘失败')
    } finally {
      setLoading(false)
    }
  }

  const onConfirm = (): void => {
    if (kind === 'progress') {
      if (diff) void applyProgress()
      else void summarizeProgress()
      return
    }
    if (kind === 'todos') {
      if (!todos.length) void reparseTodos().then(() => undefined)
      else void applyTodos()
      return
    }
    // 备忘页签：主确认 = 直接进知识库
    void applyMemo(true)
  }

  if (!open) return null

  const confirmLabel =
    kind === 'progress'
      ? diff
        ? '确认写入进展'
        : 'AI 整理预览'
      : kind === 'todos'
        ? todos.length
          ? `确认加入 ${todos.filter((_, i) => todoPick[i] !== false).length} 项`
          : 'AI 解析润色'
        : '确认写入知识库'

  return (
    <div
      className="anim-fade-in fixed inset-0 z-[80] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="glass-card anim-scale-in flex max-h-[min(88vh,720px)] w-full max-w-xl flex-col overflow-hidden !p-0"
        style={{ borderRadius: 'var(--r-xl)', boxShadow: 'var(--shadow-lg)' }}
        data-paste-inbox="1"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-start justify-between gap-3 border-b border-[var(--line)] px-4 py-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-[14px] font-semibold text-slate-100">
              <span
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border"
                style={{
                  background: 'var(--accent-softer)',
                  borderColor: 'var(--border-active)',
                  color: 'var(--accent)'
                }}
              >
                <Icon name="scan" size={14} />
              </span>
              粘贴识别
            </div>
            <p className="mt-1 pl-9 text-[11px] text-slate-500">
              Ctrl+V 唤起 · 预览确认后再写入 · {KIND_META[kind].hint}
            </p>
          </div>
          <button className="glass-btn !px-2 !py-1" onClick={onClose} title="关闭">
            <Icon name="x" size={13} />
          </button>
        </header>

        <div className="flex flex-wrap gap-1.5 border-b border-[var(--line)] px-4 py-2.5">
          {(Object.keys(KIND_META) as PasteKind[]).map((k) => (
            <button
              key={k}
              className={`pill-btn${kind === k ? ' active' : ''}`}
              onClick={() => {
                setKind(k)
                setDiff(null)
                if (k === 'todos' && text.trim() && !todos.length) void (async () => {
                  setLoading(true)
                  setStatus('AI 抽取并润色待办…')
                  try {
                    const items = ((await window.api.extractPasteTodos?.(text)) as string[]) ?? []
                    setTodos(items)
                    setTodoPick(Object.fromEntries(items.map((_, i) => [i, true])))
                    setStatus(items.length ? `已润色 ${items.length} 项，请勾选确认` : '未抽出待办')
                  } finally {
                    setLoading(false)
                  }
                })()
              }}
            >
              {KIND_META[k].label}
            </button>
          ))}
        </div>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3">
          {imagePreview ? (
            <div className="sub-card overflow-hidden !p-0">
              <img src={imagePreview} alt="clipboard" className="max-h-36 w-full object-contain" />
              {fromImage ? (
                <div className="border-t border-[var(--line)] px-2.5 py-1.5 text-[10px] text-slate-500">
                  来自剪贴板图片 · OCR 结果可编辑
                </div>
              ) : null}
            </div>
          ) : null}

          <textarea
            className="glass-input min-h-[120px] w-full resize-y !py-2.5 text-[12px] leading-relaxed"
            placeholder="粘贴的文本会出现在这里，可先改再确认…"
            value={text}
            onChange={(e) => {
              setText(e.target.value)
              setDiff(null)
            }}
          />

          {kind === 'progress' ? (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <span className="shrink-0 text-[11px] text-slate-500">写入项目</span>
                <select
                  className="glass-input min-w-0 flex-1 !py-1.5 text-[12px]"
                  value={projectId}
                  onChange={(e) => {
                    setProjectId(e.target.value)
                    setDiff(null)
                  }}
                >
                  <option value="">选择项目…</option>
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>
              {diff ? (
                <div className="sub-card max-h-56 space-y-2.5 overflow-y-auto !p-2.5 text-[11px] text-slate-400">
                  {diff.summary ? (
                    <div className="font-medium leading-snug text-slate-200">
                      <span className="text-slate-500">一句话 · </span>
                      {diff.summary}
                    </div>
                  ) : null}
                  {diff.progressNote ? (
                    <div>
                      <div className="mb-0.5 text-[10px] uppercase tracking-wider text-slate-500">最近进展</div>
                      <div className="whitespace-pre-wrap leading-relaxed text-slate-300">{diff.progressNote}</div>
                    </div>
                  ) : null}
                  {diff.completed.length ? (
                    <div>
                      <div className="mb-0.5 text-[10px] text-slate-500">完成待办 · {diff.completed.length}</div>
                      {diff.completed.map((t, i) => (
                        <div key={`c${i}`} className="text-[var(--teal-deep)]">☑ {t}</div>
                      ))}
                    </div>
                  ) : null}
                  {diff.added.length ? (
                    <div>
                      <div className="mb-0.5 text-[10px] text-slate-500">今日粗目标 · {diff.added.length}</div>
                      {diff.added.map((t, i) => (
                        <div key={`a${i}`} style={{ color: 'var(--accent)' }}>➕ {t}</div>
                      ))}
                    </div>
                  ) : null}
                  {diff.deferred.length ? (
                    <div>
                      <div className="mb-0.5 text-[10px] text-slate-500">未实现（会保留）· {diff.deferred.length}</div>
                      {diff.deferred.map((t, i) => (
                        <div key={`d${i}`} className="text-neon-amber/90">⏳ {t}</div>
                      ))}
                    </div>
                  ) : null}
                  {diff.completedTasks.length ? (
                    <div>
                      <div className="mb-0.5 text-[10px] text-slate-500">完成任务 · {diff.completedTasks.length}</div>
                      {diff.completedTasks.map((t, i) => (
                        <div key={`ct${i}`} className="text-[var(--teal-deep)]">☑ {t}</div>
                      ))}
                    </div>
                  ) : null}
                  {diff.addedTasks.length ? (
                    <div>
                      <div className="mb-0.5 text-[10px] text-slate-500">新增任务 · {diff.addedTasks.length}</div>
                      {diff.addedTasks.map((t, i) => (
                        <div key={`at${i}`} style={{ color: 'var(--accent)' }}>➕ {t}</div>
                      ))}
                    </div>
                  ) : null}
                  {!diff.completed.length && !diff.added.length && !diff.deferred.length && !diff.progressNote ? (
                    <div className="text-slate-600">（预览为空，仍可写入或改文本重试）</div>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}

          {kind === 'todos' ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[11px] text-slate-500">将导入今日计划</span>
                <button className="glass-btn !px-2 !py-0.5 !text-[10px]" disabled={loading || !text.trim()} onClick={() => void reparseTodos()}>
                  重新解析
                </button>
              </div>
              {todos.length ? (
                <div className="sub-card flex max-h-40 flex-col gap-1 overflow-y-auto !p-2">
                  {todos.map((t, i) => (
                    <label
                      key={`${i}-${t}`}
                      className="flex cursor-pointer items-start gap-2 rounded-lg px-1.5 py-1 text-[12px] hover:bg-[var(--surface-3)]"
                    >
                      <input
                        type="checkbox"
                        className="mt-0.5"
                        checked={todoPick[i] !== false}
                        onChange={(e) => setTodoPick((m) => ({ ...m, [i]: e.target.checked }))}
                      />
                      <span className="min-w-0 flex-1 text-slate-300">{t}</span>
                    </label>
                  ))}
                </div>
              ) : (
                <div className="text-[11px] text-slate-600">点「AI 解析润色」：双方话都采，并润色成短待办</div>
              )}
            </div>
          ) : null}

          {kind === 'memo' ? (
            <div
              className="rounded-xl px-3 py-2 text-[11px] leading-relaxed"
              style={{
                background: 'var(--accent-softer)',
                border: '1px solid var(--border-active)',
                color: 'var(--text-2)'
              }}
            >
              这段内容会写成知识库里的一条笔记。若是截图，上面已做文字识别，可再改一改再确认。不想进知识库可点「仅存备忘」。若其实是进展/待办，请切换上方页签。
            </div>
          ) : null}

          {status ? <div className="text-[11px] text-slate-500">{status}</div> : null}
        </div>

        <footer className="flex items-center justify-end gap-2 border-t border-[var(--line)] px-4 py-3">
          <button className="glass-btn" onClick={onClose} disabled={loading}>
            取消
          </button>
          {kind === 'memo' ? (
            <button
              className="glass-btn"
              disabled={loading || !text.trim()}
              onClick={() => void applyMemo(false)}
              title="只写入备忘列表，不进知识库"
            >
              {loading ? '处理中…' : '仅存备忘'}
            </button>
          ) : null}
          <button
            className="glass-btn primary"
            disabled={loading || (!text.trim() && !imageB64 && !imagePreview && kind !== 'todos')}
            onClick={onConfirm}
          >
            {loading ? '处理中…' : confirmLabel}
          </button>
        </footer>
      </div>
    </div>
  )
}
