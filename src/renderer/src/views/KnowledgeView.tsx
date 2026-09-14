/**
 * 本地知识库 — 用户侧就是「一条条笔记」
 * 支持：手写、上传文件、Ctrl+V 截图 OCR；不展示结构/非结构术语。
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { KnowledgeItem, KnowledgeLink, MemoRecord, PlanItem, ProcessDraft, Project } from '@shared/types'
import { Icon } from '../components/Icon'
import { PageHeader } from '../components/PageHeader'
import { EmptyState } from '../components/EmptyState'

function fmtTs(ts: number): string {
  const d = new Date(ts)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

function sourceLabel(it: KnowledgeItem): string {
  if (it.dossierKind === 'process' || it.source === 'process') return '过程案卷'
  if (it.source === 'upload') return it.fileName ? `上传 · ${it.fileName}` : '上传'
  if (it.source === 'paste') return it.fileName ? `截图 · ${it.fileName}` : '粘贴/截图'
  if (it.source === 'memo') return '备忘'
  if (it.source === 'import') return '导入'
  if (it.source === 'ai-tool') return 'AI'
  return it.categoryName ? `笔记 · ${it.categoryName}` : '手写'
}

function safeLinks(it: KnowledgeItem): KnowledgeLink[] {
  return Array.isArray(it.links) ? it.links : []
}

export default function KnowledgeView() {
  const [items, setItems] = useState<KnowledgeItem[]>([])
  const [memos, setMemos] = useState<MemoRecord[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [plans, setPlans] = useState<PlanItem[]>([])
  const [loaded, setLoaded] = useState(false)
  const [q, setQ] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [draftTitle, setDraftTitle] = useState('')
  const [draftBody, setDraftBody] = useState('')
  const [linkProjectId, setLinkProjectId] = useState('')
  const [linkPlanId, setLinkPlanId] = useState('')
  const [status, setStatus] = useState('')
  const [busy, setBusy] = useState(false)
  const [pasteHint, setPasteHint] = useState(false)
  /** 新建笔记时从文件带入的文件名（保存后记为上传来源） */
  const [draftFileName, setDraftFileName] = useState('')
  const [draftCategoryId, setDraftCategoryId] = useState('')
  const [draftCategoryName, setDraftCategoryName] = useState('')
  const [newCatName, setNewCatName] = useState('')
  const [catSuggest, setCatSuggest] = useState<{ name: string; reason: string } | null>(null)
  const [processDraft, setProcessDraft] = useState<ProcessDraft | null>(null)
  const [processPreview, setProcessPreview] = useState<{ title: string; body: string } | null>(null)
  const [sideNote, setSideNote] = useState('')
  const [listFilter, setListFilter] = useState<'all' | 'process'>('all')

  const api = window.api as {
    listKnowledge?: () => Promise<KnowledgeItem[]>
    addKnowledge?: (p: unknown) => Promise<KnowledgeItem>
    updateKnowledge?: (id: string, patch: unknown) => Promise<KnowledgeItem | null>
    removeKnowledge?: (id: string) => Promise<boolean>
    sedimentMemoToKnowledge?: (p: unknown) => Promise<{ ok: boolean; item?: KnowledgeItem; already?: boolean; reason?: string }>
    importKnowledgeFiles?: (p?: { links?: KnowledgeLink[] }) => Promise<{ ok: boolean; items?: KnowledgeItem[] }>
    pickKnowledgeFileContent?: () => Promise<{
      ok: boolean
      files?: { fileName: string; title: string; body: string }[]
    }>
    listMemos?: () => Promise<MemoRecord[]>
    listProjects?: () => Promise<Project[]>
    listPlans?: (date?: string) => Promise<PlanItem[]>
    peekClipboard?: () => Promise<{ text?: string; hasImage?: boolean; imagePngBase64?: string | null }>
    ocrRecognizePng?: (b64: string) => Promise<{ text?: string; error?: string }>
    getOpenProcessDraft?: () => Promise<ProcessDraft | null>
    appendProcessNote?: (p: unknown) => Promise<{ ok: boolean; draft?: ProcessDraft; error?: string }>
    suggestProcessCategory?: (text: string, projectId?: string) => Promise<{ name: string; reason: string } | null>
    ensureProcessCategory?: (projectId: string, name: string) => Promise<{ id: string; name: string } | null>
    previewProcessMerge?: (draftId?: string) => Promise<{ title?: string; body?: string; error?: string }>
    confirmProcessSediment?: (p?: unknown) => Promise<{ ok: boolean; item?: KnowledgeItem; error?: string }>
    saveProject?: (p: unknown) => Promise<Project>
  }

  const reload = useCallback(async () => {
    try {
      const today = new Date().toISOString().slice(0, 10)
      const [k, m, p, pl, pd] = await Promise.all([
        api.listKnowledge?.() ?? [],
        api.listMemos?.() ?? [],
        api.listProjects?.() ?? [],
        api.listPlans?.(today) ?? [],
        api.getOpenProcessDraft?.() ?? null
      ])
      setItems(Array.isArray(k) ? k.slice().sort((a, b) => (b.ts ?? 0) - (a.ts ?? 0)) : [])
      setMemos(Array.isArray(m) ? m.slice().sort((a, b) => (b.ts ?? 0) - (a.ts ?? 0)) : [])
      setProjects(Array.isArray(p) ? p : [])
      setPlans(Array.isArray(pl) ? pl.filter((x) => !x.parentPlanId).slice(0, 80) : [])
      setProcessDraft(pd && typeof pd === 'object' ? pd : null)
    } catch {
      setStatus('加载失败')
    } finally {
      setLoaded(true)
    }
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  const selected = useMemo(
    () => items.find((x) => x.id === selectedId) ?? null,
    [items, selectedId]
  )

  useEffect(() => {
    if (!selected) {
      setDraftFileName('')
      setDraftCategoryId('')
      setDraftCategoryName('')
      return
    }
    setDraftTitle(selected.title ?? '')
    setDraftBody(selected.body ?? '')
    setDraftFileName(selected.fileName ?? '')
    setDraftCategoryId(selected.categoryId ?? '')
    setDraftCategoryName(selected.categoryName ?? '')
    const links = safeLinks(selected)
    setLinkProjectId(links.find((l) => l.type === 'project')?.id ?? '')
    setLinkPlanId(links.find((l) => l.type === 'plan')?.id ?? '')
  }, [selected?.id])

  const clearDraft = (): void => {
    setSelectedId(null)
    setDraftTitle('')
    setDraftBody('')
    setDraftFileName('')
    setDraftCategoryId('')
    setDraftCategoryName('')
    setLinkProjectId('')
    setLinkPlanId('')
    setCatSuggest(null)
    setNewCatName('')
  }

  const linkedProject = useMemo(
    () => projects.find((p) => p.id === linkProjectId) ?? null,
    [projects, linkProjectId]
  )
  const projectCats = linkedProject?.noteCategories ?? []

  const filtered = useMemo(() => {
    let list = items
    if (listFilter === 'process') {
      list = list.filter((x) => x.dossierKind === 'process' || x.source === 'process')
    }
    const s = q.trim().toLowerCase()
    if (!s) return list
    return list.filter((x) => {
      const blob = `${x.title ?? ''} ${x.body ?? ''} ${x.fileName ?? ''} ${x.categoryName ?? ''}`.toLowerCase()
      return blob.includes(s)
    })
  }, [items, q, listFilter])

  const pendingMemos = useMemo(
    () => memos.filter((m) => !m.sedimentedAt && !m.knowledgeId).slice(0, 50),
    [memos]
  )

  const buildLinks = (): KnowledgeLink[] => {
    const links: KnowledgeLink[] = []
    if (linkProjectId) {
      const p = projects.find((x) => x.id === linkProjectId)
      links.push({ type: 'project', id: linkProjectId, title: p?.name ?? '项目' })
    }
    if (linkPlanId) {
      const pl = plans.find((x) => x.id === linkPlanId)
      links.push({ type: 'plan', id: linkPlanId, title: pl?.title ?? '计划' })
    }
    return links
  }

  const createNote = async (): Promise<void> => {
    const body = draftBody.trim()
    if (!body && !draftTitle.trim()) {
      setStatus('请先写一点内容，或上传 / 粘贴截图')
      return
    }
    setBusy(true)
    try {
      const fromFile = Boolean(draftFileName.trim())
      const item = await api.addKnowledge?.({
        title: draftTitle.trim() || body.slice(0, 40),
        body: body || draftTitle.trim(),
        links: buildLinks(),
        source: fromFile ? 'upload' : 'manual',
        fileName: fromFile ? draftFileName.trim() : undefined,
        categoryId: draftCategoryId || undefined,
        categoryName: draftCategoryName || undefined,
        dossierKind: 'note'
      })
      setStatus(fromFile ? '已保存（来自文件）' : '已保存')
      clearDraft()
      await reload()
      if (item?.id) setSelectedId(item.id)
    } catch {
      setStatus('保存失败')
    } finally {
      setBusy(false)
    }
  }

  /** 新建/编辑面板：选文件填入正文；多文件时除第一个外直接入库 */
  const uploadIntoDraft = async (): Promise<void> => {
    setBusy(true)
    setStatus('选择文件…')
    try {
      const r = await api.pickKnowledgeFileContent?.()
      if (!r?.ok || !r.files?.length) {
        setStatus(r?.ok === false ? '已取消' : '没有读到文件')
        return
      }
      const [first, ...rest] = r.files
      if (selected) {
        // 编辑中：把文件内容接到正文末尾
        setDraftBody((prev) => {
          const add = first.body.trim()
          if (!add) return prev
          return prev.trim() ? `${prev.trim()}\n\n—— ${first.fileName} ——\n${add}` : add
        })
        if (!draftTitle.trim()) setDraftTitle(first.title)
        setStatus(`已追加「${first.fileName}」`)
      } else {
        setSelectedId(null)
        setDraftTitle(first.title)
        setDraftBody(first.body)
        setDraftFileName(first.fileName)
        setStatus(`已填入「${first.fileName}」，可改后再保存`)
      }

      if (rest.length) {
        const links = buildLinks()
        for (const f of rest) {
          await api.addKnowledge?.({
            title: f.title,
            body: f.body,
            links,
            source: 'upload',
            fileName: f.fileName
          })
        }
        setStatus(
          selected
            ? `已追加「${first.fileName}」，另直接入库 ${rest.length} 条`
            : `已填入「${first.fileName}」，另直接入库 ${rest.length} 条`
        )
        await reload()
      }
    } catch {
      setStatus('读取文件失败')
    } finally {
      setBusy(false)
    }
  }

  const saveSelected = async (): Promise<void> => {
    if (!selected) return
    setBusy(true)
    try {
      const keepMemo = safeLinks(selected).filter((l) => l.type === 'memo')
      await api.updateKnowledge?.(selected.id, {
        title: draftTitle.trim() || selected.title,
        body: draftBody,
        links: [...keepMemo, ...buildLinks()],
        fileName: draftFileName.trim() || selected.fileName,
        categoryId: draftCategoryId || undefined,
        categoryName: draftCategoryName || undefined
      })
      setStatus('已更新')
      await reload()
    } catch {
      setStatus('更新失败')
    } finally {
      setBusy(false)
    }
  }

  const removeSelected = async (): Promise<void> => {
    if (!selected) return
    if (!window.confirm('删除这条笔记？')) return
    setBusy(true)
    try {
      await api.removeKnowledge?.(selected.id)
      clearDraft()
      setStatus('已删除')
      await reload()
    } catch {
      setStatus('删除失败')
    } finally {
      setBusy(false)
    }
  }

  const importFiles = async (): Promise<void> => {
    setBusy(true)
    setStatus('选择文件…')
    try {
      const r = await api.importKnowledgeFiles?.({ links: buildLinks() })
      if (!r?.ok || !r.items?.length) {
        setStatus(r?.ok === false ? '已取消' : '没有导入任何文件')
        return
      }
      setStatus(`已导入 ${r.items.length} 条`)
      await reload()
      if (r.items[0]?.id) setSelectedId(r.items[0].id)
    } catch {
      setStatus('导入失败')
    } finally {
      setBusy(false)
    }
  }

  /** 本页 Ctrl+V：截图 OCR / 文本 → 直接成一条知识 */
  const ingestClipboard = useCallback(async (): Promise<void> => {
    setBusy(true)
    setStatus('读取剪贴板…')
    try {
      const peek = await api.peekClipboard?.()
      const rawText = (peek?.text ?? '').trim()
      let body = rawText
      let fileName: string | undefined
      let titleHint = ''

      if (peek?.hasImage && peek.imagePngBase64) {
        setStatus('识别截图文字…')
        fileName = `截图-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.png`
        titleHint = '截图识别'
        const ocr = await api.ocrRecognizePng?.(peek.imagePngBase64)
        const ocrText = (ocr?.text ?? '').trim()
        if (ocrText) {
          body = rawText.length > ocrText.length + 40 ? rawText : ocrText
        } else if (!rawText) {
          body = `（截图未识别到文字）\n${fileName}`
        }
      }

      if (!body.trim()) {
        setStatus('剪贴板里没有可用文字或截图')
        return
      }

      const r = await api.sedimentMemoToKnowledge?.({
        text: body.trim(),
        title: titleHint || body.trim().slice(0, 40),
        source: peek?.hasImage ? 'paste' : 'paste',
        fileName,
        links: buildLinks()
      })
      if (!r?.ok) {
        setStatus('写入失败')
        return
      }
      setStatus(peek?.hasImage ? '截图已解析并写入一条笔记' : '粘贴内容已写入一条笔记')
      await reload()
      if (r.item?.id) setSelectedId(r.item.id)
    } catch {
      setStatus('粘贴入库失败')
    } finally {
      setBusy(false)
    }
  }, [linkPlanId, linkProjectId, projects, plans])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 'v') return
      const t = e.target as HTMLElement | null
      const tag = t?.tagName?.toLowerCase()
      // 输入框内保持正常粘贴；空白处 Ctrl+V → 入库
      if (tag === 'input' || tag === 'textarea' || t?.isContentEditable) return
      e.preventDefault()
      void ingestClipboard()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [ingestClipboard])

  const sedimentMemo = async (memo: MemoRecord): Promise<void> => {
    setBusy(true)
    try {
      const r = await api.sedimentMemoToKnowledge?.({
        memoId: memo.id,
        links: buildLinks(),
        categoryId: draftCategoryId || undefined,
        categoryName: draftCategoryName || undefined
      })
      if (!r?.ok) {
        setStatus('写入失败')
        return
      }
      setStatus(r.already ? '这条已经在知识库里了' : '已写入知识库')
      await reload()
      if (r.item?.id) setSelectedId(r.item.id)
    } catch {
      setStatus('写入失败')
    } finally {
      setBusy(false)
    }
  }

  const refreshCategorySuggest = async (text: string): Promise<void> => {
    if (!linkProjectId || text.trim().length < 4) {
      setCatSuggest(null)
      return
    }
    try {
      const s = await api.suggestProcessCategory?.(text, linkProjectId)
      setCatSuggest(s ?? null)
    } catch {
      setCatSuggest(null)
    }
  }

  const createCategory = async (name: string): Promise<void> => {
    const n = name.trim()
    if (!linkProjectId || !n) return
    setBusy(true)
    try {
      const cat = await api.ensureProcessCategory?.(linkProjectId, n)
      if (cat) {
        setDraftCategoryId(cat.id)
        setDraftCategoryName(cat.name)
        setNewCatName('')
        setCatSuggest(null)
        setStatus(`已创建分类「${cat.name}」`)
        await reload()
      }
    } catch {
      setStatus('创建分类失败')
    } finally {
      setBusy(false)
    }
  }

  const addSideNoteToProcess = async (): Promise<void> => {
    const t = sideNote.trim()
    if (!t) {
      setStatus('先写一点过程旁记')
      return
    }
    setBusy(true)
    try {
      if (catSuggest && linkProjectId) {
        // 有建议时不自动建，只提示；用户可点确认
      }
      const r = await api.appendProcessNote?.({
        text: t,
        categoryId: draftCategoryId || undefined,
        categoryName: draftCategoryName || undefined,
        source: 'manual',
        projectId: linkProjectId || undefined,
        projectName: linkedProject?.name
      })
      if (!r?.ok) {
        setStatus(r?.error || '写入过程草稿失败')
        return
      }
      setSideNote('')
      setProcessDraft(r.draft ?? null)
      setStatus('已写入今日过程草稿')
      await reload()
    } catch {
      setStatus('写入过程草稿失败')
    } finally {
      setBusy(false)
    }
  }

  const previewProcess = async (): Promise<void> => {
    setBusy(true)
    try {
      const r = await api.previewProcessMerge?.()
      if (r && 'error' in r && r.error) {
        setStatus(r.error)
        setProcessPreview(null)
        return
      }
      setProcessPreview({ title: r?.title ?? '', body: r?.body ?? '' })
      setStatus('已生成过程案卷预览，确认后入库')
    } catch {
      setStatus('预览失败')
    } finally {
      setBusy(false)
    }
  }

  const confirmProcess = async (): Promise<void> => {
    setBusy(true)
    try {
      let title = processPreview?.title
      let body = processPreview?.body
      if (!title || !body) {
        const r = await api.previewProcessMerge?.()
        if (r && 'error' in r && r.error) {
          setStatus(r.error)
          return
        }
        title = r?.title
        body = r?.body
        if (title && body) setProcessPreview({ title, body })
      }
      const r = await api.confirmProcessSediment?.({
        title,
        body,
        projectId: linkProjectId || processDraft?.projectId || undefined,
        projectName: linkedProject?.name || processDraft?.projectName
      })
      if (!r?.ok) {
        setStatus(r?.error || '沉淀失败')
        return
      }
      setProcessPreview(null)
      setStatus('过程案卷已写入知识库')
      await reload()
      if (r.item?.id) setSelectedId(r.item.id)
    } catch {
      setStatus('沉淀失败')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="view-enter flex flex-col gap-4">
      <PageHeader
        icon="book"
        title="知识库"
        desc="本地笔记 · 可上传文件、粘贴截图识别 · 之后再同步到知识库产品"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className="glass-btn !text-[11px]" disabled={busy} onClick={() => void importFiles()}>
              <Icon name="folder" size={12} /> 上传文件
            </button>
            <button
              type="button"
              className="glass-btn !text-[11px]"
              disabled={busy}
              onClick={() => void ingestClipboard()}
              title="读取剪贴板文字或截图，OCR 后写成一条笔记"
            >
              粘贴入库
            </button>
          </div>
        }
      />

      <div
        className={`rounded-xl border border-dashed px-3 py-2 text-[11px] leading-relaxed transition-colors ${
          pasteHint ? 'border-[var(--border-active)] bg-[var(--accent-softer)]' : 'border-[var(--line)] text-slate-500'
        }`}
        onDragOver={(e) => {
          e.preventDefault()
          setPasteHint(true)
        }}
        onDragLeave={() => setPasteHint(false)}
        onDrop={(e) => {
          e.preventDefault()
          setPasteHint(false)
          // 拖文件到页：走系统对话框更稳（浏览器 file path 在 Electron 可用）
          void importFiles()
        }}
      >
        在本页空白处按 Ctrl+V：剪贴板文字或截图会识别后写成一条笔记。也可点「上传文件」（txt/md/图片等，图片自动识字）。
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[260px_minmax(0,1fr)_280px]">
        <section className="glass-card flex max-h-[min(70vh,640px)] flex-col !p-3">
          <div className="mb-2 flex shrink-0 items-center gap-2">
            <span className="text-[12px] font-semibold text-slate-200">全部笔记</span>
            <span className="text-[10px] text-slate-500">{items.length}</span>
            <div className="ml-auto flex gap-1">
              <button
                type="button"
                className={`rounded-md px-1.5 py-0.5 text-[10px] ${listFilter === 'all' ? 'bg-[var(--accent-softer)] text-[var(--teal-deep)]' : 'text-slate-500'}`}
                onClick={() => setListFilter('all')}
              >
                全部
              </button>
              <button
                type="button"
                className={`rounded-md px-1.5 py-0.5 text-[10px] ${listFilter === 'process' ? 'bg-[var(--accent-softer)] text-[var(--teal-deep)]' : 'text-slate-500'}`}
                onClick={() => setListFilter('process')}
              >
                过程案卷
              </button>
            </div>
          </div>
          <input
            className="mb-2 w-full shrink-0 rounded-lg border border-[var(--line)] bg-[var(--surface-2)] px-2.5 py-1.5 text-[12px] text-slate-200 outline-none placeholder:text-slate-600 focus:border-[var(--border-active)]"
            placeholder="搜索标题或正文"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <div className="min-h-0 flex-1 space-y-1 overflow-y-auto pr-0.5">
            {!loaded ? (
              <div className="py-8 text-center text-[11px] text-slate-600">加载中…</div>
            ) : filtered.length === 0 ? (
              <EmptyState title="还没有笔记" hint="中间写一段、上传文件，或 Ctrl+V 贴截图" />
            ) : (
              filtered.map((it) => (
                <button
                  key={it.id}
                  type="button"
                  onClick={() => setSelectedId(it.id)}
                  className={`w-full rounded-lg border px-2.5 py-2 text-left transition-colors ${
                    selectedId === it.id
                      ? 'border-[var(--border-active)] bg-[var(--accent-softer)]'
                      : 'border-transparent hover:bg-[var(--surface-2)]'
                  }`}
                >
                  <div className="truncate text-[12px] font-medium text-slate-100">{it.title || '未命名'}</div>
                  <div className="mt-0.5 flex items-center gap-1.5 text-[10px] text-slate-500">
                    <span className="truncate">{sourceLabel(it)}</span>
                    <span>·</span>
                    <span className="shrink-0">{fmtTs(it.sedimentedAt || it.ts || Date.now())}</span>
                  </div>
                </button>
              ))
            )}
          </div>
        </section>

        <section className="glass-card flex flex-col gap-3 !p-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[12px] font-semibold text-slate-200">
              {selected ? '编辑笔记' : '新建笔记'}
            </span>
            {selected ? (
              <span className="text-[10px] text-slate-500">{sourceLabel(selected)}</span>
            ) : null}
            <button
              type="button"
              className="ml-auto glass-btn !text-[11px]"
              disabled={busy}
              onClick={() => void uploadIntoDraft()}
              title="选择 txt/md/图片等，图片会自动识字并填入正文"
            >
              <Icon name="folder" size={12} /> 上传文件
            </button>
          </div>
          {draftFileName && !selected ? (
            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-[var(--line)] bg-[var(--surface-2)] px-2.5 py-1.5 text-[11px] text-slate-400">
              <Icon name="folder" size={12} />
              <span className="truncate">来自文件：{draftFileName}</span>
              <button
                type="button"
                className="ml-auto text-[10px] text-slate-500 hover:text-slate-300"
                onClick={() => setDraftFileName('')}
              >
                清除标记
              </button>
            </div>
          ) : null}
          <input
            className="w-full rounded-lg border border-[var(--line)] bg-[var(--surface-2)] px-3 py-2 text-[13px] text-slate-100 outline-none focus:border-[var(--border-active)]"
            placeholder="标题（可空，上传文件会自动带上）"
            value={draftTitle}
            onChange={(e) => setDraftTitle(e.target.value)}
          />
          <textarea
            className="min-h-[160px] max-h-[360px] w-full resize-y rounded-lg border border-[var(--line)] bg-[var(--surface-2)] px-3 py-2 text-[13px] leading-relaxed text-slate-200 outline-none focus:border-[var(--border-active)]"
            placeholder="正文内容… 也可点右上角「上传文件」从文档/截图填入"
            value={draftBody}
            onChange={(e) => setDraftBody(e.target.value)}
          />

          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-[10px] text-slate-500">
              关联项目（可选）
              <select
                className="rounded-lg border border-[var(--line)] bg-[var(--surface-2)] px-2 py-1.5 text-[12px] text-slate-200"
                value={linkProjectId}
                onChange={(e) => setLinkProjectId(e.target.value)}
              >
                <option value="">不关联</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-[10px] text-slate-500">
              关联今日计划（可选）
              <select
                className="rounded-lg border border-[var(--line)] bg-[var(--surface-2)] px-2 py-1.5 text-[12px] text-slate-200"
                value={linkPlanId}
                onChange={(e) => setLinkPlanId(e.target.value)}
              >
                <option value="">不关联</option>
                {plans.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.title}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {linkProjectId ? (
            <div className="rounded-lg border border-[var(--line)] bg-[var(--surface-2)] px-2.5 py-2">
              <div className="mb-1.5 text-[10px] font-medium text-slate-400">过程笔记分类（本项目）</div>
              <div className="flex flex-wrap gap-1.5">
                <button
                  type="button"
                  className={`rounded-md border px-2 py-0.5 text-[10px] ${
                    !draftCategoryId ? 'border-[var(--border-active)] text-[var(--teal-deep)]' : 'border-[var(--line)] text-slate-400'
                  }`}
                  onClick={() => {
                    setDraftCategoryId('')
                    setDraftCategoryName('')
                  }}
                >
                  不分类
                </button>
                {projectCats.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    className={`rounded-md border px-2 py-0.5 text-[10px] ${
                      draftCategoryId === c.id
                        ? 'border-[var(--border-active)] text-[var(--teal-deep)]'
                        : 'border-[var(--line)] text-slate-400'
                    }`}
                    onClick={() => {
                      setDraftCategoryId(c.id)
                      setDraftCategoryName(c.name)
                    }}
                  >
                    {c.name}
                  </button>
                ))}
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <input
                  className="min-w-0 flex-1 rounded-md border border-[var(--line)] bg-[var(--surface)] px-2 py-1 text-[11px] text-slate-200 outline-none"
                  placeholder="新建分类名"
                  value={newCatName}
                  onChange={(e) => setNewCatName(e.target.value)}
                />
                <button
                  type="button"
                  className="glass-btn !text-[10px]"
                  disabled={busy || !newCatName.trim()}
                  onClick={() => void createCategory(newCatName)}
                >
                  创建
                </button>
                <button
                  type="button"
                  className="glass-btn !text-[10px]"
                  disabled={busy || !draftBody.trim()}
                  onClick={() => void refreshCategorySuggest(draftBody)}
                >
                  识别建议
                </button>
              </div>
              {catSuggest ? (
                <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[10px] text-slate-400">
                  <span>
                    建议新分类「{catSuggest.name}」· {catSuggest.reason}
                  </span>
                  <button
                    type="button"
                    className="rounded-md border border-[var(--teal-border)] px-1.5 py-0.5 text-[var(--teal-deep)]"
                    onClick={() => void createCategory(catSuggest.name)}
                  >
                    确认创建并选用
                  </button>
                  <button type="button" className="text-slate-500" onClick={() => setCatSuggest(null)}>
                    忽略
                  </button>
                </div>
              ) : null}
            </div>
          ) : (
            <div className="text-[10px] text-slate-600">关联项目后，可为过程笔记建分类 / 接受识别建议</div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            {selected ? (
              <>
                <button type="button" className="glass-btn primary" disabled={busy} onClick={() => void saveSelected()}>
                  保存
                </button>
                <button type="button" className="glass-btn" disabled={busy} onClick={clearDraft}>
                  新建
                </button>
                <button type="button" className="glass-btn" disabled={busy} onClick={() => void removeSelected()}>
                  <Icon name="trash" size={12} /> 删除
                </button>
              </>
            ) : (
              <button type="button" className="glass-btn primary" disabled={busy} onClick={() => void createNote()}>
                <Icon name="plus" size={12} /> 保存笔记
              </button>
            )}
            {status ? <span className="text-[11px] text-slate-500">{status}</span> : null}
          </div>
        </section>

        <div className="flex flex-col gap-3">
          <section className="glass-card flex flex-col gap-2 !p-3">
            <div className="flex items-center gap-2">
              <span className="text-[12px] font-semibold text-slate-200">今日过程草稿</span>
              <span className="text-[10px] text-slate-500">
                {(processDraft?.notes?.length ?? 0) + (processDraft?.aiSnippets?.length ?? 0)} 条痕迹
              </span>
            </div>
            <p className="text-[10px] leading-relaxed text-slate-500">
              监控在默默收软件/窗口；旁记与 AI 问答也会进来。末尾合并成一条「过程案卷」进知识库。
            </p>
            {processDraft ? (
              <div className="rounded-lg border border-[var(--line)] bg-[var(--surface-2)] px-2 py-1.5 text-[10px] text-slate-400">
                <div>软件：{(processDraft.apps ?? []).slice(0, 5).join('、') || '—'}</div>
                {processDraft.pathHints?.length ? (
                  <div className="truncate">路径：{processDraft.pathHints.slice(0, 2).join('；')}</div>
                ) : null}
                <div>项目：{processDraft.projectName || '未挂'}</div>
              </div>
            ) : (
              <div className="text-[11px] text-slate-600">还没有过程痕迹，干活或写旁记后会出现</div>
            )}
            <textarea
              className="min-h-[64px] w-full resize-y rounded-lg border border-[var(--line)] bg-[var(--surface-2)] px-2 py-1.5 text-[12px] text-slate-200 outline-none"
              placeholder="过程旁记（可带上面选的分类）…"
              value={sideNote}
              onChange={(e) => setSideNote(e.target.value)}
              onBlur={() => void refreshCategorySuggest(sideNote)}
            />
            <div className="flex flex-wrap gap-1.5">
              <button type="button" className="glass-btn !text-[10px]" disabled={busy} onClick={() => void addSideNoteToProcess()}>
                写入草稿
              </button>
              <button type="button" className="glass-btn !text-[10px]" disabled={busy} onClick={() => void previewProcess()}>
                预览合并
              </button>
              <button
                type="button"
                className="glass-btn primary !text-[10px]"
                disabled={busy}
                onClick={() => void confirmProcess()}
              >
                确认沉淀
              </button>
            </div>
            {processPreview ? (
              <div className="max-h-40 overflow-y-auto rounded-lg border border-[var(--line)] bg-[var(--surface)] px-2 py-1.5">
                <div className="mb-1 text-[11px] font-medium text-slate-200">{processPreview.title}</div>
                <pre className="whitespace-pre-wrap text-[10px] leading-relaxed text-slate-400">{processPreview.body.slice(0, 1200)}</pre>
              </div>
            ) : null}
          </section>

          <section className="glass-card flex max-h-[min(40vh,360px)] flex-col !p-3">
            <div className="mb-2 flex shrink-0 items-center gap-2">
              <span className="text-[12px] font-semibold text-slate-200">待转入</span>
              <span className="text-[10px] text-slate-500">{pendingMemos.length}</span>
            </div>
            <p className="mb-2 shrink-0 text-[10px] leading-relaxed text-slate-500">
              以前只存成「备忘」、还没进知识库的内容。点转入即可变成一条笔记。
            </p>
            <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto">
              {pendingMemos.length === 0 ? (
                <div className="py-6 text-center text-[11px] text-slate-600">暂无待转入内容</div>
              ) : (
                pendingMemos.map((m) => (
                  <div
                    key={m.id}
                    className="rounded-lg border border-[var(--line)] bg-[var(--surface-2)] px-2.5 py-2"
                  >
                    <div className="line-clamp-3 text-[11px] leading-relaxed text-slate-300">{m.text}</div>
                    <div className="mt-1.5 flex items-center gap-2">
                      <span className="text-[9px] text-slate-600">{fmtTs(m.ts)}</span>
                      <button
                        type="button"
                        className="ml-auto rounded-md border border-[var(--teal-border)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--teal-deep)] hover:bg-[var(--teal-soft)]"
                        disabled={busy}
                        onClick={() => void sedimentMemo(m)}
                      >
                        转入知识库
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </section>
          <div
            className="rounded-xl px-3 py-2.5 text-[10px] leading-relaxed"
            style={{
              background: 'var(--accent-softer)',
              border: '1px solid var(--border-active)',
              color: 'var(--text-2)'
            }}
          >
            计划/项目是过程夹具；未绑定操作也是输入；知识库是合并输出。归属确认会写明「哪个软件·哪扇窗 → 哪个项目」。
          </div>
        </div>
      </div>
    </div>
  )
}
