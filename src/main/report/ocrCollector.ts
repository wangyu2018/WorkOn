/**
 * v2.9 模块 D：OCR 内容采集 —— 订阅 ocrWorker 的文本产出，正则提取结构化信息落库（无模型）
 * 依据：design-spec-v2.9 §3.D（提取正则照抄；轻量落库版：复用 deepMode 的 OCR 周期任务，不单独截图）
 * 隐私：只存提取后的结构化信息（不存原文）；隐私排除应用 / 银行支付密码类关键词 / slack 状态不采
 */
import type { EnrichmentResult, OcrSnapshot, ReportEntry, WorkState } from '@shared/types'
import { genId } from '@shared/types'
import { dateKey } from '@shared/trail'
import { INDUSTRY_VOCABS } from '@shared/industryVocab'
import { col, insertInto } from '../db'
import { getSettings } from '../settings'
import { onOcrLines } from '../ocrWorker'

// 银行/支付/密码类关键词：命中应用名即不采（隐私）
const PRIVACY_KEYWORDS = ['银行', '支付宝', '网银', '密码']
// 同日快照上限 / 保留天数
const DAY_CAP = 500
const RETAIN_DAYS = 7

let started = false

/** 全库行业关键词（INDUSTRY_VOCABS 所有词库的 subject/project/output 词合并去重） */
const ALL_VOCAB_KEYWORDS: string[] = (() => {
  const set = new Set<string>()
  for (const vocab of Object.values(INDUSTRY_VOCABS)) {
    for (const p of vocab.keywords.subjectPatterns) set.add(p)
    for (const p of vocab.keywords.projectPatterns) set.add(p)
    for (const p of vocab.keywords.outputPatterns) set.add(p)
  }
  return [...set]
})()

/** 启动 OCR 采集（幂等）：订阅 ocrWorker 的 OCR 文本产出 */
export function startOcrCollector(): void {
  if (started) return
  started = true
  onOcrLines((lines, app, state) => {
    try {
      collect(lines, app, state)
    } catch (e) {
      console.warn('[report/ocr] 采集失败', e)
    }
  })
  console.log('[report/ocr] OCR 内容采集已启动（结构化落库，不存原文）')
}

/** 隐私判定：命中排除应用 / 敏感关键词 / slack 状态 → 不采 */
function shouldSkip(app: string, state: WorkState): boolean {
  if (state === 'slack') return true
  const excluded = getSettings().privacyExcludedApps ?? []
  const low = app.toLowerCase()
  if (excluded.some((e) => e && low.includes(e.toLowerCase()))) return true
  if (PRIVACY_KEYWORDS.some((k) => app.includes(k))) return true
  return false
}

function collect(lines: string[], app: string, state: WorkState): void {
  if (!lines.length || shouldSkip(app, state)) return
  const info = extractFromOcrText(lines, app)
  // 一个字段都没提取到就不落库（减少噪音）
  if (
    !info.documentNames.length &&
    !info.personNames.length &&
    !info.keywords.length &&
    !info.urls.length &&
    !info.codeSnippets.length
  ) {
    return
  }
  insertInto<OcrSnapshot>('ocrSnapshots', {
    id: genId('ocr'),
    ts: Date.now(),
    app,
    state,
    ...info
  })
  trimSnapshots()
}

/** 裁剪：7 天前的删除；同日超 500 条删最旧 */
function trimSnapshots(): void {
  const arr = col<OcrSnapshot>('ocrSnapshots')
  const cutoff = Date.now() - RETAIN_DAYS * 86400000
  for (let i = arr.length - 1; i >= 0; i--) {
    if (arr[i].ts < cutoff) arr.splice(i, 1)
  }
  const today = dateKey(Date.now())
  const todayIdx = arr.map((s, i) => (dateKey(s.ts) === today ? i : -1)).filter((i) => i >= 0)
  if (todayIdx.length > DAY_CAP) {
    const remove = new Set(todayIdx.slice(0, todayIdx.length - DAY_CAP))
    for (let i = arr.length - 1; i >= 0; i--) {
      if (remove.has(i)) arr.splice(i, 1)
    }
  }
}

/**
 * 从 OCR 文本行提取结构化信息（正则照抄 v2.9 §3.D）
 * keywords：INDUSTRY_VOCABS 全库关键词 includes 匹配，去重取 top5
 */
export function extractFromOcrText(
  lines: string[],
  app: string
): Pick<OcrSnapshot, 'documentNames' | 'personNames' | 'keywords' | 'urls' | 'codeSnippets'> {
  const text = lines.join('\n')

  // 文档名提取
  const docPattern = /([\w一-龥]+[\w一-龥\s]*?)\.(docx?|pdf|xlsx?|pptx?|md)/gi
  const documentNames = [...text.matchAll(docPattern)].map((m) => m[0])

  // 人名/客户名提取（中文2-4字 + 常见称呼）
  const personPattern = /([一-龥]{2,4})\s*(总|经理|老师|先生|女士|客户|甲方|乙方)/g
  const personNames = [...text.matchAll(personPattern)].map((m) => m[1])

  // URL 提取
  const urlPattern = /https?:\/\/([\w\-.]+)/gi
  const urls = [...text.matchAll(urlPattern)].map((m) => m[1])

  // 关键词提取（全库行业词库 includes 匹配，去重 top5）
  const keywords = ALL_VOCAB_KEYWORDS.filter((k) => text.includes(k)).slice(0, 5)

  // 代码标识提取（IDE 场景；本项目 IDE 友好名为 VSCode/Cursor）
  let codeSnippets: string[] = []
  if (/^(VSCode|Code|Cursor)/i.test(app)) {
    const codePattern = /(function|class|interface|const|export)\s+(\w+)/g
    codeSnippets = [...text.matchAll(codePattern)].map((m) => m[2]).slice(0, 5)
  }

  return {
    documentNames: [...new Set(documentNames)],
    personNames: [...new Set(personNames)],
    keywords,
    urls: [...new Set(urls)],
    codeSnippets
  }
}

/**
 * OCR 快照 → 富化补丁（时间窗内快照合并）
 * 文档名首个 → output 0.75 (document)；人名首个 → subject 0.7 (person)；关键词前3 '/' 拼 → contentTag 0.6
 */
export function ocrEnrichmentForWindow(startTs: number, endTs: number, date: string): Partial<EnrichmentResult> | null {
  const relevant = col<OcrSnapshot>('ocrSnapshots').filter(
    (s) => dateKey(s.ts) === date && s.ts >= startTs && s.ts <= endTs
  )
  if (!relevant.length) return null

  const allDocs = relevant.flatMap((s) => s.documentNames)
  const allPersons = relevant.flatMap((s) => s.personNames)
  const allKeywords = relevant.flatMap((s) => s.keywords)

  const result: Partial<EnrichmentResult> = {}
  if (allDocs.length > 0) {
    result.output = { type: 'document', name: allDocs[0], confidence: 0.75 }
  }
  if (allPersons.length > 0) {
    result.subject = { name: allPersons[0], type: 'person', confidence: 0.7 }
  }
  if (allKeywords.length > 0) {
    result.contentTag = { category: allKeywords.slice(0, 3).join('/'), confidence: 0.6 }
  }
  return result
}

/**
 * 报表条目 OCR 回填（engine 编排时后处理，不动 aggregator）：
 * 对每条 entry 按时间窗快照回填缺失字段（subject/contentTag/output），命中则 dataSource 加 'ocr'
 */
export function attachOcrToEntries(entries: ReportEntry[], date: string): void {
  for (const entry of entries) {
    const patch = ocrEnrichmentForWindow(entry.startTs, entry.endTs, date)
    if (!patch) continue
    let hit = false
    if (!entry.output && patch.output) {
      entry.output = patch.output.name
      entry.outputType = patch.output.type
      hit = true
    }
    if (!entry.subject && patch.subject) {
      entry.subject = patch.subject.name
      entry.subjectType = patch.subject.type
      hit = true
    }
    if (!entry.contentTag && patch.contentTag) {
      entry.contentTag = patch.contentTag.category
      hit = true
    }
    if (hit && !entry.dataSource.includes('ocr')) entry.dataSource.push('ocr')
  }
}
