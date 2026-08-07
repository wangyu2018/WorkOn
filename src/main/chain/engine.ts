/**
 * v2.6.1 作业链路识别引擎 —— 每日链路分析编排（纯本地，无 LLM）
 * 依据：design-spec-v2.6.1 §4.1 处理流程
 *   分段（>30min 断簇）→ 模板匹配（取置信度最优）→ 链路外摸鱼判定 → 指标聚合 → 落库
 * 落库：db chains 集合按 date 唯一（同日重算覆盖）；当日结果内存缓存 5min；
 *       历史日期（非今天）优先读库，库里没有才算
 */
import type { ChainDayReport, ChainMetrics, SegmentChainLabel, UserChainConfig, WorkChain } from '@shared/chain'
import { genId } from '@shared/types'
import type { TrailSegment, UserType } from '@shared/types'
import { buildMergedTrail, dateKey } from '@shared/trail'
import { col, insertInto, listActivities } from '../db'
import { effectiveUserType } from '../attention'
import { parseWindowTitle, USER_CHAIN_CONFIGS } from './templates'
import { matchChain, type ChainMatch } from './matcher'
import { detectOutput } from './output'

const CLUSTER_GAP_MS = 30 * 60 * 1000 // 相邻段间隔 >30min 断簇（spec §4.1 STEP 1）
const MICRO_SWITCH_MIN = 3 // 微切换容忍：<3min 不判摸鱼（spec §2.3）
const TODAY_CACHE_TTL_MS = 5 * 60 * 1000 // 当日结果缓存 5min

/** 当日分析结果缓存（仅今天；历史日期落库后直读） */
const todayCache = new Map<string, { ts: number; report: ChainDayReport }>()

/** 时间簇分段：相邻 segment 间隔 >30min 断开（spec §4.1 STEP 1） */
function splitClusters(segments: TrailSegment[]): TrailSegment[][] {
  const clusters: TrailSegment[][] = []
  let cur: TrailSegment[] = []
  for (const seg of segments) {
    const prev = cur[cur.length - 1]
    if (prev && seg.startTs - prev.endTs > CLUSTER_GAP_MS) {
      clusters.push(cur)
      cur = []
    }
    cur.push(seg)
  }
  if (cur.length) clusters.push(cur)
  return clusters
}

/** 时间簇 → 全部模板取置信度最优（<0.3 丢弃，spec §4.1 STEP 5） */
function bestMatch(cluster: TrailSegment[], config: UserChainConfig): ChainMatch | null {
  let best: ChainMatch | null = null
  for (const tpl of config.templates) {
    const m = matchChain(cluster, tpl)
    if (m && m.confidence >= 0.3 && (!best || m.confidence > best.confidence)) best = m
  }
  return best
}

/** ChainMatch → WorkChain（>0.6 确认：有产出 completed / 无产出 active；0.3-0.6 tentative） */
function toWorkChain(m: ChainMatch, date: string, userType: WorkChain['userType']): WorkChain {
  const startTs = m.steps[0].startTs
  const endTs = m.steps[m.steps.length - 1].endTs
  const totalMin = (endTs - startTs) / 60000
  const productiveMin = m.steps.reduce((a, s) => a + s.durationMin, 0)
  let switchCount = 0
  for (let i = 1; i < m.steps.length; i++) if (m.steps[i].app !== m.steps[i - 1].app) switchCount++
  return {
    id: genId('chain'),
    userType,
    date,
    type: m.template.type,
    templateId: m.template.id,
    templateName: m.template.name,
    status: m.confidence > 0.6 ? (m.hasOutput ? 'completed' : 'active') : 'tentative',
    steps: m.steps,
    startTs,
    endTs,
    totalMin,
    productiveMin,
    switchCount,
    hasOutput: m.hasOutput,
    outputType: m.outputSignal.type,
    switchEfficiency: totalMin > 0 ? productiveMin / totalMin : 1,
    confidence: m.confidence
  }
}

/**
 * 链路外分心候选判定（spec §2.3 / §4.1 STEP 4）：
 * 主分心应用集命中，或条件分心规则命中（title_contains 摸鱼词 / in_chain 不在链路），
 * 或窗口标题语义解析判为 slacking（覆盖规则表外的浏览器/沟通摸鱼标题）
 */
function isDistractionCandidate(seg: TrailSegment, config: UserChainConfig): boolean {
  const app = seg.mainApp ?? ''
  const title = seg.mainTitle ?? ''
  if (config.primaryDistractions.some((p) => new RegExp(p, 'i').test(app))) return true
  for (const cd of config.conditionalDistractions) {
    if (!new RegExp(cd.appPattern, 'i').test(app)) continue
    if (cd.condition === 'in_chain') return true // 本函数只作用于未入链的段
    if (cd.condition === 'title_contains') {
      const t = title.toLowerCase()
      if ((cd.slackingKeywords ?? []).some((kw) => t.includes(kw.toLowerCase()))) return true
    }
  }
  return parseWindowTitle(app, title).isSlacking
}

/** 未入链段摸鱼判定：分心候选 + 持续 >3min + 无产出 → distracted，否则 neutral */
function labelUnchained(seg: TrailSegment, config: UserChainConfig): SegmentChainLabel['label'] {
  if (!isDistractionCandidate(seg, config)) return 'neutral'
  if (seg.durationMin <= MICRO_SWITCH_MIN) return 'neutral'
  if (detectOutput([seg]).type !== 'none') return 'neutral'
  return 'distracted'
}

function aggregateMetrics(chains: WorkChain[], labels: SegmentChainLabel[], segMin: Map<string, number>): ChainMetrics {
  const withOutput = chains.filter((c) => c.hasOutput).length
  const totalMin = chains.reduce((a, c) => a + c.totalMin, 0)
  const productiveMin = chains.reduce((a, c) => a + c.productiveMin, 0)
  let distractedMin = 0
  let neutralMin = 0
  for (const l of labels) {
    if (l.label === 'productive') continue
    const m = segMin.get(l.segmentId) ?? 0
    if (l.label === 'distracted') distractedMin += m
    else neutralMin += m
  }
  return {
    chainCount: chains.length,
    chainOutputRate: chains.length > 0 ? withOutput / chains.length : 0,
    avgChainMin: chains.length > 0 ? totalMin / chains.length : 0,
    switchEfficiency: totalMin > 0 ? productiveMin / totalMin : 0,
    chainDiversity: new Set(chains.map((c) => c.type)).size,
    distractedMin,
    neutralMin
  }
}

/** 核心计算（纯函数，可注入合成段做端到端验证）：非 glance 段 → 链路报告（不落库） */
export function analyzeTrailSegments(date: string, userType: UserType, segments: TrailSegment[]): ChainDayReport {
  const config = USER_CHAIN_CONFIGS[userType]

  const chains: WorkChain[] = []
  const labels: SegmentChainLabel[] = []
  const segMin = new Map<string, number>()
  const chainedSegIds = new Set<string>()

  // STEP 1-2：分段 → 每簇跑当前用户类型全部模板取置信度最优
  for (const cluster of splitClusters(segments)) {
    const m = bestMatch(cluster, config)
    if (!m) continue
    const chain = toWorkChain(m, date, userType)
    chains.push(chain)
    for (const step of chain.steps) {
      chainedSegIds.add(step.segmentId)
      labels.push({ segmentId: step.segmentId, chainId: chain.id, chainRole: step.role, label: 'productive' })
    }
  }

  // STEP 4：未入链段摸鱼判定
  for (const seg of segments) {
    const segId = seg.id ?? `s${seg.startTs}`
    segMin.set(segId, seg.durationMin)
    if (chainedSegIds.has(segId)) continue
    labels.push({ segmentId: segId, chainId: null, label: labelUnchained(seg, config) })
  }

  chains.sort((a, b) => a.startTs - b.startTs)
  return { date, userType, chains, labels, metrics: aggregateMetrics(chains, labels, segMin), ts: Date.now() }
}

/** 某日轨迹取数 → 纯计算（不落库，由 analyzeDayChains 负责持久化与缓存） */
function computeDayChains(date: string): ChainDayReport {
  const trail = buildMergedTrail(listActivities(date), date)
  // 跳过 glance 短切换段与无应用段
  const segments = trail.segments.filter((s) => !s.glance && s.mainApp)
  return analyzeTrailSegments(date, effectiveUserType(), segments)
}

/**
 * 某日链路分析（IPC 入口）：
 * 当日 → 5min 内存缓存，过期重算并覆盖落库；历史日期 → 优先读库，库里没有才算
 * 无任何有效段的日子只返回临时报告，不落库（避免空报告污染）
 */
export function analyzeDayChains(date: string): ChainDayReport {
  const today = dateKey(Date.now())
  if (date === today) {
    const c = todayCache.get(date)
    if (c && Date.now() - c.ts < TODAY_CACHE_TTL_MS) return c.report
  } else {
    const stored = col<ChainDayReport>('chains').find((r) => r.date === date)
    if (stored) return stored
  }

  const report = computeDayChains(date)
  if (report.labels.length > 0) {
    // 同日重算覆盖（chains 集合按 date 唯一，与 attentionScores upsert 同模式）
    const arr = col<ChainDayReport>('chains')
    const idx = arr.findIndex((r) => r.date === date)
    if (idx >= 0) arr.splice(idx, 1)
    insertInto('chains', report)
  }
  if (date === today) todayCache.set(date, { ts: Date.now(), report })
  return report
}

/** 今日链路分析（预览性质：同 todayScore，按当前数据重算） */
export function todayChains(): ChainDayReport {
  return analyzeDayChains(dateKey(Date.now()))
}
