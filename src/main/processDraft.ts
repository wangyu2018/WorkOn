/**
 * 过程草稿：监控操作 + 旁记 + AI 细节 → 确认后合并成知识库「过程案卷」
 */
import { col, insertInto, updateIn } from './db'
import { genId } from '@shared/types'
import type {
  KnowledgeItem,
  KnowledgeLink,
  ProcessDraft,
  ProcessDraftAiSnippet,
  ProcessDraftNote,
  ProcessNoteCategory,
  Project
} from '@shared/types'
import { getAttribution } from './attributions'
import { extractPathHint } from './pathHint'

export { extractPathHint, isIdeApp } from './pathHint'

function drafts(): ProcessDraft[] {
  return col<ProcessDraft>('processDrafts')
}

function todayKey(ts = Date.now()): string {
  return new Date(ts).toISOString().slice(0, 10)
}

/** 取今日未关闭草稿；没有则建一条 */
export function getOrCreateOpenDraft(ts = Date.now()): ProcessDraft {
  const date = todayKey(ts)
  const open = drafts().find((d) => d.date === date && !d.closedAt && !d.sedimentedKnowledgeId)
  if (open) return open
  const attr = getAttribution()
  const created: ProcessDraft = {
    id: genId('pd'),
    date,
    startedAt: ts,
    updatedAt: ts,
    apps: [],
    windowTitles: [],
    pathHints: [],
    projectId: attr.projectId,
    projectName: attr.projectName || undefined,
    notes: [],
    aiSnippets: []
  }
  return insertInto('processDrafts', created)
}

export function getOpenProcessDraft(): ProcessDraft | null {
  const date = todayKey()
  return drafts().find((d) => d.date === date && !d.closedAt && !d.sedimentedKnowledgeId) ?? null
}

function pushUnique(list: string[], value: string, max = 12): string[] {
  const v = value.trim()
  if (!v) return list
  const next = [v, ...list.filter((x) => x !== v)]
  return next.slice(0, max)
}

/** 监控 tick 喂操作输入（静默） */
export function touchProcessDraft(app: string, title: string, ts = Date.now()): void {
  if (!app && !title) return
  const d = getOrCreateOpenDraft(ts)
  const attr = getAttribution()
  const pathHint = extractPathHint(title)
  const patch: Partial<ProcessDraft> = {
    apps: pushUnique(d.apps, (app || '').replace(/\.exe$/i, '')),
    windowTitles: title?.trim() ? pushUnique(d.windowTitles, title.trim().slice(0, 100), 8) : d.windowTitles,
    pathHints: pathHint ? pushUnique(d.pathHints, pathHint, 8) : d.pathHints,
    updatedAt: ts
  }
  if (attr.projectId) {
    patch.projectId = attr.projectId
    patch.projectName = attr.projectName
  }
  updateIn<ProcessDraft>('processDrafts', d.id, patch)
}

export function appendProcessNote(input: {
  text: string
  categoryId?: string
  categoryName?: string
  source?: ProcessDraftNote['source']
  projectId?: string
  projectName?: string
}): ProcessDraft {
  const text = String(input.text ?? '').trim()
  if (!text) throw new Error('内容为空')
  const d = getOrCreateOpenDraft()
  const note: ProcessDraftNote = {
    id: genId('pdn'),
    text,
    categoryId: input.categoryId,
    categoryName: input.categoryName,
    source: input.source ?? 'manual',
    ts: Date.now()
  }
  const patch: Partial<ProcessDraft> = {
    notes: [...(d.notes ?? []), note],
    updatedAt: Date.now()
  }
  if (input.projectId) {
    patch.projectId = input.projectId
    patch.projectName = input.projectName
  }
  return updateIn<ProcessDraft>('processDrafts', d.id, patch) as ProcessDraft
}

export function appendProcessAi(question: string, answer: string): void {
  const q = String(question ?? '').trim()
  const a = String(answer ?? '').trim()
  if (!q || !a) return
  const d = getOrCreateOpenDraft()
  const snip: ProcessDraftAiSnippet = {
    id: genId('pai'),
    question: q.slice(0, 500),
    answer: a.slice(0, 4000),
    ts: Date.now()
  }
  updateIn<ProcessDraft>('processDrafts', d.id, {
    aiSnippets: [...(d.aiSnippets ?? []), snip].slice(-40),
    updatedAt: Date.now()
  })
}

/** 根据正文启发式建议新分类名（不自动创建） */
export function suggestNoteCategory(
  text: string,
  existing: ProcessNoteCategory[] = []
): { name: string; reason: string } | null {
  const t = text.trim()
  if (t.length < 4) return null
  const rules: [RegExp, string, string][] = [
    [/踩坑|报错|bug|失败|error|exception|崩了|不通/i, '踩坑', '内容像在记问题/报错'],
    [/需求|脑暴|想法|方案|调研|todo|待办|用户说/i, '需求脑暴', '内容像需求/脑暴'],
    [/决策|决定|定为|确认采用|拍板|选型/i, '决策', '内容像决策记录'],
    [/实现|改了|提交|commit|修复|重构|加上了/i, '实现细节', '内容像实现过程'],
    [/截图|图片|素材|ui|视觉/i, '素材', '内容像素材/截图']
  ]
  const names = new Set(existing.map((c) => c.name))
  for (const [re, name, reason] of rules) {
    if (re.test(t) && !names.has(name)) return { name, reason }
  }
  return null
}

export function ensureProjectCategory(projectId: string, name: string): ProcessNoteCategory | null {
  const n = name.trim()
  if (!n || !projectId) return null
  const p = col<Project>('projects').find((x) => x.id === projectId)
  if (!p) return null
  const hit = (p.noteCategories ?? []).find((c) => c.name === n)
  if (hit) return hit
  const cat: ProcessNoteCategory = { id: genId('pnc'), name: n, createdAt: Date.now() }
  updateIn<Project>('projects', projectId, {
    noteCategories: [...(p.noteCategories ?? []), cat],
    updatedAt: Date.now()
  })
  return cat
}

/** 预览合并正文（不入库） */
export function buildProcessMergePreview(draftId?: string): {
  draft: ProcessDraft
  title: string
  body: string
  links: KnowledgeLink[]
} | { error: string } {
  const d = draftId
    ? drafts().find((x) => x.id === draftId)
    : getOpenProcessDraft()
  if (!d) return { error: '没有可沉淀的过程草稿' }
  const apps = (d.apps ?? []).filter(Boolean)
  const titles = (d.windowTitles ?? []).slice(0, 5)
  const paths = (d.pathHints ?? []).slice(0, 5)
  const notes = d.notes ?? []
  const ais = d.aiSnippets ?? []

  const byCat = new Map<string, ProcessDraftNote[]>()
  for (const n of notes) {
    const key = n.categoryName?.trim() || '未分类'
    if (!byCat.has(key)) byCat.set(key, [])
    byCat.get(key)!.push(n)
  }

  const lines: string[] = []
  lines.push('## 现场摘要')
  lines.push(`- 软件：${apps.length ? apps.join('、') : '（未记录）'}`)
  if (paths.length) lines.push(`- 工作区/路径：${paths.join('；')}`)
  if (titles.length) lines.push(`- 窗口：${titles.map((t) => `「${t}」`).join(' ')}`)
  lines.push(`- 项目：${d.projectName || '未挂项目'}`)
  lines.push(`- 时段：${new Date(d.startedAt).toLocaleString()} → ${new Date(d.updatedAt).toLocaleString()}`)

  if (notes.length) {
    lines.push('')
    lines.push('## 过程笔记')
    for (const [cat, list] of byCat) {
      lines.push(`### ${cat}`)
      for (const n of list) {
        lines.push(`- ${n.text}`)
      }
    }
  }

  if (ais.length) {
    lines.push('')
    lines.push('## AI 细节（折叠保留）')
    for (const s of ais.slice(-12)) {
      lines.push(`<details><summary>Q: ${s.question.slice(0, 80)}</summary>`)
      lines.push('')
      lines.push(s.answer)
      lines.push('')
      lines.push('</details>')
    }
  }

  if (!notes.length && !ais.length && !apps.length) {
    return { error: '草稿几乎是空的，先干活或记一条旁记再沉淀' }
  }

  const title = `${d.projectName || '未挂项目'} · ${d.date} 过程记录`
  const links: KnowledgeLink[] = []
  if (d.projectId) links.push({ type: 'project', id: d.projectId, title: d.projectName })
  if (d.planId) links.push({ type: 'plan', id: d.planId })

  return { draft: d, title, body: lines.join('\n'), links }
}

/** 确认沉淀为知识库过程案卷 */
export function confirmProcessSediment(input?: {
  draftId?: string
  title?: string
  body?: string
  projectId?: string
  projectName?: string
}): { ok: true; item: KnowledgeItem } | { ok: false; error: string } {
  const preview = buildProcessMergePreview(input?.draftId)
  if ('error' in preview) return { ok: false, error: preview.error }
  const { draft, title: defTitle, body: defBody, links: baseLinks } = preview
  const projectId = input?.projectId ?? draft.projectId ?? null
  const projectName = input?.projectName ?? draft.projectName
  const links: KnowledgeLink[] = [...baseLinks]
  if (projectId && !links.some((l) => l.type === 'project' && l.id === projectId)) {
    links.push({ type: 'project', id: projectId, title: projectName })
  }
  const now = Date.now()
  const cats = [...new Set((draft.notes ?? []).map((n) => n.categoryName).filter(Boolean))] as string[]
  const item = insertInto<KnowledgeItem>('knowledge', {
    id: genId('kb'),
    title: (input?.title ?? defTitle).trim() || defTitle,
    body: (input?.body ?? defBody).trim() || defBody,
    kind: 'unstructured',
    source: 'process',
    links,
    tags: ['过程案卷', ...cats],
    dossierKind: 'process',
    sedimentedAt: now,
    ts: now,
    syncedAt: null
  })
  updateIn<ProcessDraft>('processDrafts', draft.id, {
    sedimentedKnowledgeId: item.id,
    closedAt: now,
    projectId,
    projectName,
    updatedAt: now
  })
  return { ok: true, item }
}

export function listProcessDossiers(projectId?: string): KnowledgeItem[] {
  const all = col<KnowledgeItem>('knowledge').filter((k) => k.dossierKind === 'process' || k.source === 'process')
  if (!projectId) return all.sort((a, b) => (b.ts ?? 0) - (a.ts ?? 0))
  return all
    .filter((k) => (k.links ?? []).some((l) => l.type === 'project' && l.id === projectId))
    .sort((a, b) => (b.ts ?? 0) - (a.ts ?? 0))
}
