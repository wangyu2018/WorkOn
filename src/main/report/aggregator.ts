/**
 * v2.9 模块 G：聚合 & Trail 智能合并 —— 原始 TrailSegment → 可读 ReportEntry
 * 依据：design-spec-v2.9 §3.G（五步流水线 + Levenshtein 标题相似度，纯本地无模型）
 */
import type { EnrichmentResult, ReportEntry, TrailSegment, WorkState, ReportTimeSlot } from '@shared/types'
import { WORK_STATES } from '@shared/stateMeta'
import { dateKey } from '@shared/trail'
import { genId } from '@shared/types'

export interface AggregationConfig {
  minSegmentMin: number // 最小段时长，低于此值的合并到相邻段 (默认5分钟)
  mergeGapMin: number // 间隔小于此值的同状态段合并 (默认3分钟)
  mergeSameApp: boolean // 相同应用的同状态段是否合并
  mergeSimilarTitle: boolean // 标题相似的段是否合并
  titleSimilarityThreshold: number // 标题相似度阈值 (0-1)
}

export const defaultConfig: AggregationConfig = {
  minSegmentMin: 5,
  mergeGapMin: 3,
  mergeSameApp: true,
  mergeSimilarTitle: true,
  titleSimilarityThreshold: 0.7
}

/** 五步流水线：碎片过滤 → 相邻同态合并 → 同应用合并 → 相似标题合并 → 转 ReportEntry */
export function aggregateTrail(
  segments: TrailSegment[],
  enriched: Map<string, EnrichmentResult>,
  config: AggregationConfig = defaultConfig
): ReportEntry[] {
  // 输入过滤 glance（短切换只是瞄了一眼，不算有效作业段）
  let working = segments.filter((s) => !s.glance).map((s) => ({ ...s }))

  // Step 1: 过滤碎片（< minSegmentMin 的段合并到相邻段，时长并入）
  working = filterFragments(working, config.minSegmentMin)

  // Step 2: 合并相邻同状态段（间隔 < mergeGapMin）
  working = mergeAdjacentSameState(working, config.mergeGapMin)

  // Step 3: 合并相同应用的同状态段
  if (config.mergeSameApp) {
    working = mergeSameAppSegs(working)
  }

  // Step 4: 合并标题相似的段
  if (config.mergeSimilarTitle) {
    working = mergeSimilarTitles(working, config.titleSimilarityThreshold)
  }

  // Step 5: 转换为 ReportEntry（被并掉的段的富化结果随之丢弃，取幸存段的）
  return working.map((seg) => {
    const enrichment = (seg.id && enriched.get(seg.id)) || {}
    return segmentToReportEntry(seg, enrichment)
  })
}

/** Step 1：碎片段并入相邻段（并到前一段，无前段则并到后一段） */
function filterFragments(segs: TrailSegment[], minMin: number): TrailSegment[] {
  const out: TrailSegment[] = []
  for (const seg of segs) {
    if (seg.durationMin < minMin && (out.length > 0 || segs.length > 1)) {
      const prev = out[out.length - 1]
      if (prev) {
        // 时长并入相邻段（标题/应用保留代表段的）
        prev.endTs = Math.max(prev.endTs, seg.endTs)
        prev.durationMin += seg.durationMin
        continue
      }
      // 没有前段：暂存，待下一段进来时并入（若整列只有这一个碎片段则保留）
      out.push(seg)
      continue
    }
    // 前段是待并碎片：把碎片时长并进当前段
    const prev = out[out.length - 1]
    if (prev && prev.durationMin < minMin) {
      seg.startTs = Math.min(seg.startTs, prev.startTs)
      seg.durationMin += prev.durationMin
      out[out.length - 1] = seg
      continue
    }
    out.push(seg)
  }
  return out
}

/** 合并相邻段：保留时长更长者的标题/应用，时长累加、时间窗外扩 */
function mergeInto(prev: TrailSegment, cur: TrailSegment): void {
  const keepCur = (cur.mainTitle?.length ?? 0) > (prev.mainTitle?.length ?? 0)
  prev.endTs = Math.max(prev.endTs, cur.endTs)
  prev.startTs = Math.min(prev.startTs, cur.startTs)
  prev.durationMin += cur.durationMin
  if (keepCur) {
    prev.mainTitle = cur.mainTitle
    prev.mainApp = cur.mainApp
  }
}

/** Step 2：相邻同状态且间隔 < gapMin 合并 */
function mergeAdjacentSameState(segs: TrailSegment[], gapMin: number): TrailSegment[] {
  const out: TrailSegment[] = []
  for (const seg of segs) {
    const prev = out[out.length - 1]
    if (prev && prev.mainState === seg.mainState && seg.startTs - prev.endTs < gapMin * 60000) {
      mergeInto(prev, seg)
      continue
    }
    out.push(seg)
  }
  return out
}

/** Step 3：相邻同状态 + 同应用合并 */
function mergeSameAppSegs(segs: TrailSegment[]): TrailSegment[] {
  const out: TrailSegment[] = []
  for (const seg of segs) {
    const prev = out[out.length - 1]
    if (prev && prev.mainState === seg.mainState && prev.mainApp === seg.mainApp) {
      mergeInto(prev, seg)
      continue
    }
    out.push(seg)
  }
  return out
}

/** Step 4：相邻标题相似（编辑距离相似度 ≥ threshold）合并 */
function mergeSimilarTitles(segs: TrailSegment[], threshold: number): TrailSegment[] {
  const out: TrailSegment[] = []
  for (const seg of segs) {
    const prev = out[out.length - 1]
    if (
      prev &&
      prev.mainState === seg.mainState &&
      prev.mainTitle &&
      seg.mainTitle &&
      titleSimilarity(prev.mainTitle, seg.mainTitle) >= threshold
    ) {
      mergeInto(prev, seg)
      continue
    }
    out.push(seg)
  }
  return out
}

// === 标题相似度（编辑距离，无需AI，v2.9 §3.G 照抄）===

export function titleSimilarity(a: string, b: string): number {
  if (!a || !b) return 0
  const distance = levenshteinDistance(a.toLowerCase(), b.toLowerCase())
  const maxLength = Math.max(a.length, b.length)
  return 1 - distance / maxLength
}

export function levenshteinDistance(a: string, b: string): number {
  const matrix: number[][] = []
  for (let i = 0; i <= b.length; i++) matrix[i] = [i]
  for (let j = 0; j <= a.length; j++) matrix[0][j] = j
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      const cost = a[j - 1] === b[i - 1] ? 0 : 1
      matrix[i][j] = Math.min(matrix[i - 1][j] + 1, matrix[i][j - 1] + 1, matrix[i - 1][j - 1] + cost)
    }
  }
  return matrix[b.length][a.length]
}

function slotOfHour(hour: number): ReportTimeSlot {
  if (hour >= 6 && hour < 12) return 'morning'
  if (hour >= 12 && hour < 18) return 'afternoon'
  if (hour >= 18) return 'evening'
  return 'night'
}

/**
 * TrailSegment → ReportEntry
 * confidence = 五维字段置信度均值（无富化给 0.5）；needsReview = confidence < 0.6
 */
export function segmentToReportEntry(seg: TrailSegment, enrichment: EnrichmentResult): ReportEntry {
  const confs = [
    enrichment.subject?.confidence,
    enrichment.contentTag?.confidence,
    enrichment.project?.confidence,
    enrichment.location?.confidence,
    enrichment.output?.confidence
  ].filter((c): c is number => c != null)
  const confidence = confs.length > 0 ? confs.reduce((a, b) => a + b, 0) / confs.length : 0.5

  return {
    id: seg.id ?? genId('entry'),
    date: dateKey(seg.startTs),
    startTs: seg.startTs,
    endTs: seg.endTs,
    durationMin: Math.round(seg.durationMin),
    timeSlot: slotOfHour(new Date(seg.startTs).getHours()),
    state: seg.mainState,
    stateLabel: WORK_STATES[seg.mainState as WorkState]?.label ?? seg.mainState,
    app: seg.mainApp,
    subject: enrichment.subject?.name,
    subjectType: enrichment.subject?.type,
    contentTag: enrichment.contentTag?.category,
    project: enrichment.project?.name,
    location: enrichment.location?.target,
    output: enrichment.output?.name,
    outputType: enrichment.output?.type,
    dataSource: ['auto'],
    confidence: Math.round(confidence * 100) / 100,
    needsReview: confidence < 0.6,
    ts: Date.now()
  }
}
