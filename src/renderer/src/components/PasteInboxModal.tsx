/**
 * 主窗口 Ctrl+V 粘贴分拣：
 * 左：OCR / AI 解析出的标题标签（可拖）
 * 右：待办树 / 项目树 / 知识库树（拖入高亮并落库）
 */
import { useCallback, useEffect, useMemo, useState, type DragEvent } from 'react'
import type { KnowledgeItem, PlanItem, Project, ProjectTask } from '@shared/types'
import { PRIO_META, prioW } from '@shared/priority'
import { Icon } from './Icon'
import { todayKey } from './utils'
import { useAppStore } from '../stores/appStore'

interface PasteInboxModalProps {
  open: boolean
  onClose: () => void
}

type TagPlaced = 'todo' | 'project' | 'knowledge'

interface PasteTag {
  id: string
  title: string
  placed?: TagPlaced | null
}

type DropTarget =
  | { tree: 'todo'; id: 'root' | string }
  | { tree: 'project'; id: string }
  | { tree: 'knowledge'; id: 'root' | string }

const DND_MIME = 'application/x-workon-paste-tag'

function newTagId(): string {
  return `tag-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
}

function dropClass(active: boolean, over: boolean): string {
  if (over) {
    return 'ring-2 ring-[var(--accent)] bg-[var(--accent-softer)] border-[var(--border-active)]'
  }
  if (active) {
    return 'ring-1 ring-[var(--border-active)]/60 bg-[var(--surface-3)]/80 border-[var(--line)]'
  }
  return 'border-[var(--line)] hover:bg-[var(--surface-3)]/50'
}

export function PasteInboxModal({ open, onClose }: PasteInboxModalProps) {
  const [text, setText] = useState('')
  const [fromImage, setFromImage] = useState(false)
  const [imagePreview, setImagePreview] = useState<string | null>(null)
  const [imageB64, setImageB64] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  const [showRaw, setShowRaw] = useState(false)

  const [tags, setTags] = useState<PasteTag[]>([])
  const [dragTagId, setDragTagId] = useState<string | null>(null)
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null)

  const [plans, setPlans] = useState<PlanItem[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [projectTasks, setProjectTasks] = useState<Record<string, ProjectTask[]>>({})
  const [knowledge, setKnowledge] = useState<KnowledgeItem[]>([])
  const [expandedProjects, setExpandedProjects] = useState<Record<string, boolean>>({})

  const reset = useCallback(() => {
    setText('')
    setFromImage(false)
    setImagePreview(null)
    setImageB64(null)
    setLoading(false)
    setStatus(null)
    setShowRaw(false)
    setTags([])
    setDragTagId(null)
    setDropTarget(null)
    setPlans([])
    setProjects([])
    setProjectTasks({})
    setKnowledge([])
    setExpandedProjects({})
  }, [])

  const loadTrees = useCallback(async () => {
    const date = todayKey()
    const [ps, pr, kn] = await Promise.all([
      (window.api.listPlans?.(date) as Promise<PlanItem[]>) ?? [],
      (window.api.listProjects?.() as Promise<Project[]>) ?? [],
      (
        window.api as { listKnowledge?: () => Promise<KnowledgeItem[]> }
      ).listKnowledge?.() ?? []
    ])
    const planList = (Array.isArray(ps) ? ps : []).filter((p) => !p.archived)
    setPlans(planList)
    const active = (Array.isArray(pr) ? pr : []).filter((p) => p.status === 'active' || !p.status)
    setProjects((active.length ? active : Array.isArray(pr) ? pr : []).sort((a, b) => prioW(a.priority) - prioW(b.priority)))
    setKnowledge(
      (Array.isArray(kn) ? kn : [])
        .slice()
        .sort((a, b) => (b.ts ?? 0) - (a.ts ?? 0))
        .slice(0, 40)
    )
  }, [])

  const ensureOcrText = async (
    rawText: string,
    imgB64: string | null,
    imaged: boolean
  ): Promise<string> => {
    let next = rawText.trim()
    if (imaged && imgB64 && next.length < 40) {
      setStatus('识别图片中的文字…')
      const ocr = (await window.api.ocrRecognizePng?.(imgB64)) as {
        text?: string
        error?: string
      } | undefined
      if (ocr?.error && !ocr.text) {
        setStatus(`图片识别失败：${ocr.error}`)
      } else if (ocr?.text?.trim()) {
        next = ocr.text.trim()
        setStatus('已识别图片文字')
      } else {
        setStatus('图片里没识别到文字，可改原文后再解析')
      }
    }
    return next
  }

  const parseTags = async (body: string): Promise<PasteTag[]> => {
    const items = ((await window.api.extractPasteTodos?.(body)) as string[]) ?? []
    return items
      .map((t) => String(t ?? '').trim())
      .filter((t) => t.length >= 2)
      .map((title) => ({ id: newTagId(), title: title.slice(0, 80) }))
  }

  const bootstrap = useCallback(async () => {
    setLoading(true)
    setStatus('读取剪贴板…')
    try {
      const peek = (await window.api.peekClipboard?.()) as {
        text?: string
        hasImage?: boolean
        imagePngBase64?: string | null
      } | undefined
      const rawText = (peek?.text ?? '').trim()
      const imgB64 = peek?.imagePngBase64 ?? null
      const imaged = !!(peek?.hasImage && imgB64)

      if (imaged && imgB64) {
        setImagePreview(`data:image/png;base64,${imgB64}`)
        setImageB64(imgB64)
        setFromImage(true)
      } else {
        setImagePreview(null)
        setImageB64(null)
        setFromImage(false)
      }

      const nextText = await ensureOcrText(rawText, imgB64, imaged)
      setText(nextText)
      await loadTrees()

      if (nextText.trim()) {
        setStatus('AI 抽取标题标签…')
        const nextTags = await parseTags(nextText)
        setTags(nextTags)
        setStatus(
          nextTags.length
            ? `已抽出 ${nextTags.length} 个标签 · 拖到右侧树即可分拣`
            : '未抽出标签，可展开原文改写后再点「重新解析」'
        )
      } else {
        setTags([])
        setStatus('没有可解析的文字或截图')
      }
    } catch {
      setStatus('读取剪贴板失败')
    } finally {
      setLoading(false)
    }
  }, [loadTrees])

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

  const pendingTags = useMemo(() => tags.filter((t) => !t.placed), [tags])
  const placedCount = tags.length - pendingTags.length

  const reparse = async (): Promise<void> => {
    setLoading(true)
    try {
      let body = text.trim()
      if (!body && imageB64) {
        setStatus('识别截图文字…')
        const ocr = (await window.api.ocrRecognizePng?.(imageB64)) as { text?: string; error?: string } | undefined
        body = (ocr?.text ?? '').trim()
        if (body) {
          setText(body)
          setFromImage(true)
        } else {
          setStatus(ocr?.error ? `识别失败：${ocr.error}` : '截图里没识别到文字')
          return
        }
      }
      if (!body) {
        setStatus('先粘贴或编辑原文')
        return
      }
      setStatus('AI 抽取标题标签…')
      const nextTags = await parseTags(body)
      setTags(nextTags)
      setStatus(nextTags.length ? `已抽出 ${nextTags.length} 个标签` : '未抽出标签')
    } catch {
      setStatus('解析失败')
    } finally {
      setLoading(false)
    }
  }

  const markPlaced = (tagId: string, where: TagPlaced): void => {
    setTags((list) => list.map((t) => (t.id === tagId ? { ...t, placed: where } : t)))
  }

  const readDragTag = (e: DragEvent): PasteTag | null => {
    try {
      const raw = e.dataTransfer.getData(DND_MIME) || e.dataTransfer.getData('text/plain')
      if (!raw) return null
      const parsed = JSON.parse(raw) as { id?: string; title?: string }
      if (!parsed?.id || !parsed?.title) return null
      return { id: parsed.id, title: parsed.title }
    } catch {
      return null
    }
  }

  const onTagDragStart = (e: DragEvent, tag: PasteTag): void => {
    if (tag.placed) {
      e.preventDefault()
      return
    }
    const payload = JSON.stringify({ id: tag.id, title: tag.title })
    e.dataTransfer.setData(DND_MIME, payload)
    e.dataTransfer.setData('text/plain', payload)
    e.dataTransfer.effectAllowed = 'copyMove'
    setDragTagId(tag.id)
  }

  const onTagDragEnd = (): void => {
    setDragTagId(null)
    setDropTarget(null)
  }

  const allowDrop = (e: DragEvent, target: DropTarget): void => {
    e.preventDefault()
    e.stopPropagation()
    e.dataTransfer.dropEffect = 'copy'
    setDropTarget(target)
  }

  const clearDrop = (): void => setDropTarget(null)

  const dropOnTodo = async (tag: PasteTag, parentPlanId?: string): Promise<void> => {
    const date = todayKey()
    await window.api.savePlan({
      date,
      title: tag.title.slice(0, 100),
      category: 'other',
      status: 'planned',
      source: 'import',
      planType: 'task',
      parentPlanId: parentPlanId || undefined,
      note: fromImage ? '来自粘贴截图识别' : '来自粘贴分拣'
    })
    markPlaced(tag.id, 'todo')
    setStatus(parentPlanId ? `已挂到子待办：${tag.title}` : `已加入今日待办：${tag.title}`)
    await loadTrees()
  }

  const dropOnProject = async (tag: PasteTag, projectId: string): Promise<void> => {
    const existing = projectTasks[projectId]
    const sort = Array.isArray(existing) ? existing.length : 0
    await window.api.saveProjectTask?.({
      projectId,
      title: tag.title.slice(0, 100),
      status: 'todo',
      priority: 'medium',
      sort,
      note: fromImage ? '来自粘贴截图识别' : '来自粘贴分拣',
      aiGenerated: true
    })
    markPlaced(tag.id, 'project')
    const name = projects.find((p) => p.id === projectId)?.name ?? '项目'
    setStatus(`已加入「${name}」任务：${tag.title}`)
    setExpandedProjects((m) => ({ ...m, [projectId]: true }))
    const tasks = ((await window.api.listProjectTasks?.(projectId)) as ProjectTask[]) ?? []
    setProjectTasks((m) => ({ ...m, [projectId]: tasks }))
  }

  const dropOnKnowledge = async (tag: PasteTag): Promise<void> => {
    const bodyHint = text.trim().slice(0, 2000)
    const r = await (
      window.api as {
        addKnowledge?: (p: unknown) => Promise<KnowledgeItem>
      }
    ).addKnowledge?.({
      title: tag.title.slice(0, 80),
      body: bodyHint && bodyHint !== tag.title ? bodyHint : tag.title,
      source: 'paste',
      fileName: fromImage ? `截图-${Date.now()}.png` : undefined,
      tags: ['paste']
    })
    if (!r?.id) {
      setStatus('写入知识库失败')
      return
    }
    markPlaced(tag.id, 'knowledge')
    setStatus(`已写入知识库：${tag.title}`)
    await loadTrees()
  }

  const onDropTarget = async (e: DragEvent, target: DropTarget): Promise<void> => {
    e.preventDefault()
    e.stopPropagation()
    const tag = readDragTag(e)
    setDropTarget(null)
    setDragTagId(null)
    if (!tag?.title) return
    setLoading(true)
    try {
      if (target.tree === 'todo') {
        await dropOnTodo(tag, target.id === 'root' ? undefined : target.id)
      } else if (target.tree === 'project') {
        await dropOnProject(tag, target.id)
      } else {
        await dropOnKnowledge(tag)
      }
    } catch {
      setStatus('分拣失败，请重试')
    } finally {
      setLoading(false)
    }
  }

  const addAllToProject = async (projectId: string): Promise<void> => {
    const left = pendingTags
    if (!left.length) {
      setStatus('没有待分拣标签')
      return
    }
    setLoading(true)
    try {
      let sort = (projectTasks[projectId] ?? []).length
      const note = fromImage ? '来自粘贴截图识别' : '来自粘贴分拣'
      for (const tag of left) {
        await window.api.saveProjectTask?.({
          projectId,
          title: tag.title.slice(0, 100),
          status: 'todo',
          priority: 'medium',
          sort: sort++,
          note,
          aiGenerated: true
        })
        markPlaced(tag.id, 'project')
      }
      const name = projects.find((p) => p.id === projectId)?.name ?? '项目'
      setStatus(`已把 ${left.length} 项归入「${name}」`)
      setExpandedProjects((m) => ({ ...m, [projectId]: true }))
      const tasks = ((await window.api.listProjectTasks?.(projectId)) as ProjectTask[]) ?? []
      setProjectTasks((m) => ({ ...m, [projectId]: tasks }))
    } catch {
      setStatus('归入失败，请重试')
    } finally {
      setLoading(false)
    }
  }

  const toggleProject = async (pid: string): Promise<void> => {
    setExpandedProjects((m) => {
      const next = !m[pid]
      if (next && !projectTasks[pid]) {
        void window.api.listProjectTasks?.(pid).then((tasks) => {
          setProjectTasks((tm) => ({ ...tm, [pid]: (tasks as ProjectTask[]) ?? [] }))
        })
      }
      return { ...m, [pid]: next }
    })
  }

  const dumpRestToKnowledge = async (): Promise<void> => {
    const left = pendingTags
    if (!left.length && !text.trim()) {
      setStatus('没有剩余标签或原文')
      return
    }
    setLoading(true)
    try {
      if (left.length) {
        for (const tag of left) {
          await dropOnKnowledge(tag)
        }
        setStatus(`剩余 ${left.length} 项已写入知识库`)
        window.setTimeout(onClose, 500)
      } else {
        const r = await (
          window.api as {
            sedimentMemoToKnowledge?: (p: unknown) => Promise<{ ok?: boolean }>
          }
        ).sedimentMemoToKnowledge?.({
          text: text.trim(),
          title: fromImage ? '截图识别' : text.trim().slice(0, 40),
          source: 'paste',
          fileName: fromImage ? `截图-${Date.now()}.png` : undefined
        })
        if (!r?.ok) {
          setStatus('写入知识库失败')
          return
        }
        setStatus('原文已写入知识库')
        window.setTimeout(() => {
          onClose()
          useAppStore.getState().setView('knowledge')
        }, 450)
      }
    } catch {
      setStatus('写入失败')
    } finally {
      setLoading(false)
    }
  }

  const addAllTodos = async (): Promise<void> => {
    const left = pendingTags
    if (!left.length) {
      setStatus('没有待分拣标签')
      return
    }
    setLoading(true)
    try {
      for (const tag of left) {
        await dropOnTodo(tag)
      }
      setStatus(`已加入今日待办 ${left.length} 项`)
      window.setTimeout(onClose, 500)
    } catch {
      setStatus('导入失败')
    } finally {
      setLoading(false)
    }
  }

  const rootPlans = useMemo(() => plans.filter((p) => !p.parentPlanId), [plans])
  const childrenOf = useCallback(
    (pid: string) => plans.filter((p) => p.parentPlanId === pid),
    [plans]
  )

  const knowledgeGroups = useMemo(() => {
    const map = new Map<string, KnowledgeItem[]>()
    for (const it of knowledge) {
      const key = (it.categoryName || '未分类').trim() || '未分类'
      const arr = map.get(key) ?? []
      arr.push(it)
      map.set(key, arr)
    }
    return [...map.entries()]
  }, [knowledge])

  if (!open) return null

  const dragging = !!dragTagId

  return (
    <div
      className="anim-fade-in fixed inset-0 z-[80] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="glass-card anim-scale-in flex max-h-[min(90vh,760px)] w-full max-w-4xl flex-col overflow-hidden !p-0"
        style={{ borderRadius: 'var(--r-xl)', boxShadow: 'var(--shadow-lg)' }}
        data-paste-inbox="1"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-start justify-between gap-3 border-b border-[var(--line)] px-4 py-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-base font-semibold text-slate-100">
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
            <p className="mt-1 pl-9 text-xs text-slate-500">
              左侧标题标签可拖到右侧树 · 拖过目标会高亮 · 分拣后即时写入
            </p>
          </div>
          <button className="glass-btn !px-2 !py-1" onClick={onClose} title="关闭">
            <Icon name="x" size={13} />
          </button>
        </header>

        <div className="grid min-h-0 flex-1 grid-cols-1 gap-0 overflow-hidden md:grid-cols-2">
          {/* ── 左：标签 ── */}
          <section className="flex min-h-0 flex-col border-b border-[var(--line)] md:border-b-0 md:border-r">
            <div className="flex items-center justify-between gap-2 border-b border-[var(--line)] px-3 py-2">
              <span className="text-xs font-medium text-slate-400">
                解析标签
                <span className="ml-1.5 tabular-nums text-slate-600">
                  {pendingTags.length}/{tags.length}
                  {placedCount ? ` · 已分拣 ${placedCount}` : ''}
                </span>
              </span>
              <button
                className="glass-btn !px-2 !py-0.5 !text-2xs"
                disabled={loading}
                onClick={() => void reparse()}
              >
                重新解析
              </button>
            </div>

            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-3">
              {imagePreview ? (
                <div className="sub-card overflow-hidden !p-0">
                  <img src={imagePreview} alt="clipboard" className="max-h-28 w-full object-contain" />
                </div>
              ) : null}

              {pendingTags.length ? (
                <div className="flex flex-wrap gap-2">
                  {pendingTags.map((tag) => (
                    <button
                      key={tag.id}
                      type="button"
                      draggable
                      onDragStart={(e) => onTagDragStart(e, tag)}
                      onDragEnd={onTagDragEnd}
                      className={`max-w-full cursor-grab rounded-lg border px-2.5 py-1.5 text-left text-xs font-medium leading-snug text-slate-100 active:cursor-grabbing ${
                        dragTagId === tag.id
                          ? 'border-[var(--accent)] bg-[var(--accent-softer)] opacity-70'
                          : 'border-[var(--border-active)] bg-[var(--surface-3)] hover:border-[var(--accent)]'
                      }`}
                      title="拖到右侧树"
                    >
                      {tag.title}
                    </button>
                  ))}
                </div>
              ) : (
                <div className="rounded-xl border border-dashed border-[var(--line)] px-3 py-6 text-center text-xs text-slate-600">
                  {loading ? '解析中…' : '暂无待分拣标签'}
                </div>
              )}

              {tags.some((t) => t.placed) ? (
                <div className="space-y-1">
                  <div className="text-2xs uppercase tracking-wider text-slate-600">已分拣</div>
                  <div className="flex flex-wrap gap-1.5">
                    {tags
                      .filter((t) => t.placed)
                      .map((tag) => (
                        <span
                          key={tag.id}
                          className="rounded-md border border-[var(--line)] bg-transparent px-2 py-1 text-xs text-slate-500 line-through"
                        >
                          {tag.title}
                          <span className="ml-1 no-underline opacity-70">
                            · {tag.placed === 'todo' ? '待办' : tag.placed === 'project' ? '项目' : '知识'}
                          </span>
                        </span>
                      ))}
                  </div>
                </div>
              ) : null}

              <button
                type="button"
                className="text-2xs text-slate-500 underline-offset-2 hover:text-slate-300 hover:underline"
                onClick={() => setShowRaw((v) => !v)}
              >
                {showRaw ? '收起原文' : '展开原文 / 手动改'}
              </button>
              {showRaw ? (
                <textarea
                  className="glass-input min-h-[100px] w-full resize-y !py-2 text-xs leading-relaxed"
                  placeholder="OCR/粘贴原文…"
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                />
              ) : null}

              {status ? <div className="text-xs text-slate-500">{status}</div> : null}
            </div>
          </section>

          {/* ── 右：三树同时可见 ── */}
          <section className="flex min-h-0 flex-col">
            <div className="border-b border-[var(--line)] px-3 py-2 text-xs text-slate-500">
              拖到下方任一树 · 目标会高亮
            </div>

            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-2.5 py-2.5">
              {/* 待办树 */}
              <div
                className={`rounded-xl border px-2.5 py-2 transition-all ${dropClass(
                  dragging,
                  dropTarget?.tree === 'todo' && dropTarget.id === 'root'
                )}`}
                onDragOver={(e) => allowDrop(e, { tree: 'todo', id: 'root' })}
                onDragLeave={clearDrop}
                onDrop={(e) => void onDropTarget(e, { tree: 'todo', id: 'root' })}
              >
                <div className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-slate-300">
                  <Icon name="check" size={12} />
                  今日待办
                  <span className="font-normal text-slate-600">· 拖到空白处新建</span>
                </div>
                {rootPlans.length ? (
                  <ul className="space-y-1">
                    {rootPlans.map((p) => {
                      const kids = childrenOf(p.id)
                      const over = dropTarget?.tree === 'todo' && dropTarget.id === p.id
                      return (
                        <li key={p.id}>
                          <div
                            className={`rounded-lg border px-2 py-1.5 text-xs text-slate-300 transition-all ${dropClass(
                              dragging,
                              over
                            )}`}
                            onDragOver={(e) => allowDrop(e, { tree: 'todo', id: p.id })}
                            onDragLeave={clearDrop}
                            onDrop={(e) => void onDropTarget(e, { tree: 'todo', id: p.id })}
                            title="拖到此项：挂为子待办"
                          >
                            <div className="truncate">{p.title}</div>
                            {kids.length ? (
                              <ul className="mt-1 space-y-0.5 border-l border-[var(--line)] pl-2">
                                {kids.map((c) => (
                                  <li key={c.id} className="truncate text-xs text-slate-500">
                                    {c.title}
                                  </li>
                                ))}
                              </ul>
                            ) : dragging ? (
                              <div className="mt-0.5 text-2xs text-slate-600">松手 → 挂为子待办</div>
                            ) : null}
                          </div>
                        </li>
                      )
                    })}
                  </ul>
                ) : (
                  <div className="py-2 text-center text-xs text-slate-600">
                    {dragging ? '松手即可加入今日待办' : '今日还没有待办'}
                  </div>
                )}
              </div>

              {/* 项目树 */}
              <div className="space-y-1">
                <div className="px-0.5 text-xs font-semibold text-slate-300">
                  <span className="inline-flex items-center gap-1.5">
                    <Icon name="folder" size={12} />
                    项目树
                    <span className="font-normal text-slate-600">· 拖到项目上加任务</span>
                  </span>
                </div>
                {projects.length ? (
                  projects.map((p) => {
                    const openNode = !!expandedProjects[p.id]
                    const over = dropTarget?.tree === 'project' && dropTarget.id === p.id
                    const tasks = projectTasks[p.id] ?? []
                    return (
                      <div
                        key={p.id}
                        className={`rounded-xl border px-2 py-1.5 transition-all ${dropClass(
                          dragging,
                          over
                        )}`}
                        onDragOver={(e) => allowDrop(e, { tree: 'project', id: p.id })}
                        onDragLeave={clearDrop}
                        onDrop={(e) => void onDropTarget(e, { tree: 'project', id: p.id })}
                      >
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            className="flex min-w-0 flex-1 items-center gap-1.5 text-left text-xs font-medium text-slate-200"
                            onClick={() => void toggleProject(p.id)}
                          >
                            <span className="text-slate-500">{openNode ? '▾' : '▸'}</span>
                            <span
                              className="h-2 w-2 shrink-0 rounded-full"
                              style={{ background: p.color || 'var(--accent)' }}
                            />
                            <span className="min-w-0 flex-1 truncate">{p.name}</span>
                            <span className="shrink-0 text-2xs" style={{ color: PRIO_META[p.priority ?? 'medium'].color }} title={`优先级：${PRIO_META[p.priority ?? 'medium'].label}`}>{PRIO_META[p.priority ?? 'medium'].mark}</span>
                            <span className="text-2xs font-normal text-slate-600">
                              {dragging ? '松手 → 加任务' : tasks.length ? String(tasks.length) : ''}
                            </span>
                          </button>
                          {pendingTags.length && !dragging ? (
                            <button
                              type="button"
                              className="shrink-0 rounded border border-dashed border-[var(--line)] px-1.5 py-0 text-2xs text-slate-500 hover:border-[var(--accent)] hover:text-[var(--accent)]"
                              title={`把剩余 ${pendingTags.length} 个标签全部归为「${p.name}」任务`}
                              onClick={() => void addAllToProject(p.id)}
                            >
                              全归入
                            </button>
                          ) : null}
                        </div>
                        {openNode ? (
                          <ul className="mt-1 space-y-0.5 border-l border-[var(--line)] pl-3">
                            {tasks.length ? (
                              tasks.slice(0, 12).map((t) => (
                                <li key={t.id} className="truncate text-xs text-slate-500">
                                  {t.title}
                                </li>
                              ))
                            ) : (
                              <li className="text-2xs text-slate-600">暂无任务</li>
                            )}
                          </ul>
                        ) : null}
                      </div>
                    )
                  })
                ) : (
                  <div className="py-3 text-center text-xs text-slate-600">还没有项目</div>
                )}
              </div>

              {/* 知识库树 */}
              <div
                className={`rounded-xl border px-2.5 py-2 transition-all ${dropClass(
                  dragging,
                  dropTarget?.tree === 'knowledge' && dropTarget.id === 'root'
                )}`}
                onDragOver={(e) => allowDrop(e, { tree: 'knowledge', id: 'root' })}
                onDragLeave={clearDrop}
                onDrop={(e) => void onDropTarget(e, { tree: 'knowledge', id: 'root' })}
              >
                <div className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-slate-300">
                  <Icon name="book" size={12} />
                  知识库
                  <span className="font-normal text-slate-600">· 拖到此处新建笔记</span>
                </div>
                {knowledgeGroups.length ? (
                  <div className="space-y-2">
                    {knowledgeGroups.map(([cat, items]) => (
                      <div key={cat}>
                        <div className="mb-0.5 text-2xs uppercase tracking-wider text-slate-600">
                          {cat}
                        </div>
                        <ul className="space-y-0.5">
                          {items.slice(0, 6).map((it) => (
                            <li key={it.id} className="truncate text-xs text-slate-500">
                              {it.title}
                            </li>
                          ))}
                        </ul>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="py-2 text-center text-xs text-slate-600">
                    {dragging ? '松手即可写入笔记' : '知识库还是空的'}
                  </div>
                )}
              </div>
            </div>
          </section>
        </div>

        <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-[var(--line)] px-4 py-3">
          <button className="glass-btn" onClick={onClose} disabled={loading}>
            {pendingTags.length ? '稍后再说' : '完成'}
          </button>
          <button
            className="glass-btn"
            disabled={loading || (!pendingTags.length && !text.trim())}
            onClick={() => void dumpRestToKnowledge()}
          >
            剩余进知识库
          </button>
          <button
            className="glass-btn primary"
            disabled={loading || !pendingTags.length}
            onClick={() => void addAllTodos()}
          >
            {loading ? '处理中…' : `剩余全进今日待办${pendingTags.length ? ` (${pendingTags.length})` : ''}`}
          </button>
        </footer>
      </div>
    </div>
  )
}
