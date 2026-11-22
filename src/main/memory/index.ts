/**
 * 统一记忆层（P0）：屏幕 / 文件 / 应用 / 笔记 → MemoryEvent → 检索
 * 说明：P0 用数组扫描 + 关键词打分，避免引入原生 SQLite；数据量大时再换 FTS。
 */
import { col, insertInto, listActivities } from '../db'
import { genId } from '@shared/types'
import type { ActivityRecord, KnowledgeItem, MemoryEvent, OcrShot, OcrSnapshot } from '@shared/types'

export interface MemoryHit {
  ts: number
  source: MemoryEvent['source'] | 'ocr'
  text: string
  ref: string
  score: number
}

export interface MemorySearchOptions {
  start?: number
  end?: number
  limit?: number
  sources?: MemoryHit['source'][]
}

export interface IngestInput {
  source: MemoryEvent['source']
  text: string
  ref?: string
  ts?: number
}

/** 写入一条记忆事件（幂等：同 source+ref+text 不重复写） */
export function ingest(input: IngestInput): MemoryEvent | null {
  const text = String(input.text ?? '').trim()
  if (text.length < 2) return null
  const ts = input.ts ?? Date.now()
  const ref = input.ref ?? ''
  const exists = col<MemoryEvent>('memoryEvents').some(
    (e) => e.source === input.source && e.ref === ref && e.text === text
  )
  if (exists) return null
  const evt: MemoryEvent = { id: genId('mem'), ts, source: input.source, text: text.slice(0, 2000), ref }
  insertInto<MemoryEvent>('memoryEvents', evt)
  return evt
}

function score(text: string, q: string): number {
  const lower = text.toLowerCase()
  if (!lower.includes(q)) return 0
  let n = 0
  let idx = lower.indexOf(q)
  while (idx >= 0) {
    n += 1
    idx = lower.indexOf(q, idx + q.length)
  }
  return 1 + Math.min(20, n)
}

function dayKeysBetween(start: number, end: number): string[] {
  const out: string[] = []
  const d = new Date(start)
  d.setHours(0, 0, 0, 0)
  const guard = 90
  let i = 0
  while (d.getTime() <= end && i < guard) {
    const p = (n: number): string => String(n).padStart(2, '0')
    out.push(`${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`)
    d.setDate(d.getDate() + 1)
    i += 1
  }
  return out
}

/** 检索：屏幕快照 / OCR 索引 / 知识库 / 活动 / 记忆事件 */
export function search(q: string, opts: MemorySearchOptions = {}): MemoryHit[] {
  const query = String(q ?? '').trim().toLowerCase()
  if (!query) return []
  const end = opts.end ?? Date.now()
  const start = opts.start ?? end - 7 * 86400000
  const limit = Math.max(1, Math.min(100, opts.limit ?? 30))
  const allow = new Set(opts.sources ?? [])
  const hits: MemoryHit[] = []
  const want = (s: MemoryHit['source']): boolean => !allow.size || allow.has(s)

  if (want('screen') || want('ocr')) {
    for (const snap of col<OcrSnapshot>('ocrSnapshots')) {
      if (snap.ts < start || snap.ts > end) continue
      const text = [...snap.documentNames, ...snap.personNames, ...snap.keywords, ...snap.urls, ...snap.codeSnippets].join(' ')
      const s = score(text, query)
      if (s) hits.push({ ts: snap.ts, source: 'ocr', text: `${snap.app} · ${text.slice(0, 220)}`, ref: snap.id, score: s })
    }
    for (const shot of col<OcrShot>('ocrShots')) {
      if (shot.ts < start || shot.ts > end) continue
      const text = `${shot.app} ${shot.state} ${(shot.keywords ?? []).join(' ')} ${shot.classify ?? ''}`
      const s = score(text, query)
      if (s) hits.push({ ts: shot.ts, source: 'screen', text: text.slice(0, 220), ref: shot.file || shot.id, score: s })
    }
  }

  if (want('file')) {
    for (const k of col<KnowledgeItem>('knowledge')) {
      const ts = (k as unknown as { ts?: number; updatedAt?: number }).ts ?? (k as unknown as { updatedAt?: number }).updatedAt ?? 0
      if (ts && (ts < start || ts > end)) continue
      const text = `${k.title} ${k.body} ${(k.tags ?? []).join(' ')}`
      const s = score(text, query)
      if (s) hits.push({ ts, source: 'file', text: text.slice(0, 260), ref: k.id, score: s })
    }
  }

  if (want('app') || want('note')) {
    for (const day of dayKeysBetween(start, end)) {
      for (const a of listActivities(day) as ActivityRecord[]) {
        const raw = a as unknown as Record<string, unknown>
        const text = [raw.app, raw.title, raw.contentSummary, raw.contentTag].filter(Boolean).join(' ')
        const s = score(String(text), query)
        if (s) {
          hits.push({
            ts: Number(raw.startTs ?? 0),
            source: 'app',
            text: String(text).slice(0, 220),
            ref: String(raw.id ?? ''),
            score: s
          })
        }
      }
    }
  }

  for (const e of col<MemoryEvent>('memoryEvents')) {
    if (e.ts < start || e.ts > end) continue
    if (!want(e.source)) continue
    const s = score(e.text, query)
    if (s) hits.push({ ts: e.ts, source: e.source, text: e.text.slice(0, 260), ref: e.ref, score: s })
  }

  return hits.sort((a, b) => b.score - a.score || b.ts - a.ts).slice(0, limit)
}

export function stats(): { events: number; shots: number; snaps: number; knowledge: number } {
  return {
    events: col<MemoryEvent>('memoryEvents').length,
    shots: col<OcrShot>('ocrShots').length,
    snaps: col<OcrSnapshot>('ocrSnapshots').length,
    knowledge: col<KnowledgeItem>('knowledge').length
  }
}
