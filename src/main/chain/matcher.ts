/**
 * v2.6.1 应用序列模板匹配器（spec §4.2 matchChain 移植，适配 TrailSegment）
 * 贪心顺序匹配：段不匹配当前步骤时跳过（容忍簇内噪声切换），匹配率 <0.6 出局
 * 置信度 = 模板匹配度×0.4 + 标题命中步骤数/总步骤×0.3 + 产出闭环×0.3
 */
import type { ChainStep, ChainStepTemplate, ChainTemplate } from '@shared/chain'
import type { TrailSegment } from '@shared/types'
import { detectOutput, type OutputSignal } from './output'

export interface ChainMatch {
  template: ChainTemplate
  steps: ChainStep[]
  segments: TrailSegment[] // 与 steps 一一对应的命中段
  matchRatio: number // 模板匹配度（命中步骤数 / 模板总步骤数）
  confidence: number // 综合置信度 0-1
  hasOutput: boolean
  outputSignal: OutputSignal
}

/** 单步匹配：应用名正则 + 标题关键词 + 排除词 + 最小持续时长（分钟口径） */
function stepMatches(step: ChainStepTemplate, seg: TrailSegment): boolean {
  const app = seg.mainApp ?? ''
  const title = (seg.mainTitle ?? '').toLowerCase()
  if (!new RegExp(step.appPattern, 'i').test(app)) return false
  if (step.titleKeywords && !step.titleKeywords.some((kw) => title.includes(kw.toLowerCase()))) return false
  if (step.titleExclude && step.titleExclude.some((ex) => title.includes(ex.toLowerCase()))) return false
  if (step.minDurationMin && seg.durationMin < step.minDurationMin) return false
  return true
}

/**
 * 对一个时间簇跑单个模板（spec §4.2）
 * 匹配率 <0.6 或命中不足 2 个不同应用（链路定义：跨应用）→ null
 * requireOutput 且无产出闭环 → 置信度 ×0.6（降权不拒绝）
 */
export function matchChain(segments: TrailSegment[], template: ChainTemplate): ChainMatch | null {
  let stepIndex = 0
  const matchedSegs: TrailSegment[] = []
  const matchedStepTpls: ChainStepTemplate[] = []

  for (const seg of segments) {
    const step = template.steps[stepIndex]
    if (!step) break
    if (stepMatches(step, seg)) {
      matchedSegs.push(seg)
      matchedStepTpls.push(step)
      stepIndex++
    }
  }

  const matchRatio = matchedSegs.length / template.steps.length
  if (matchRatio < 0.6) return null
  // 链路特征：至少涉及 2 个不同应用
  if (new Set(matchedSegs.map((s) => s.mainApp)).size < 2) return null

  const outputSignal = detectOutput(matchedSegs)
  const hasOutput = outputSignal.type !== 'none'
  // 标题命中步骤数：模板步定义了 titleKeywords 的命中步（命中即代表标题通过）
  const titleHits = matchedStepTpls.filter((s) => s.titleKeywords && s.titleKeywords.length > 0).length

  let confidence = matchRatio * 0.4 + (titleHits / template.steps.length) * 0.3 + (hasOutput ? 0.3 : 0)
  if (template.requireOutput && !hasOutput) confidence *= 0.6

  const steps: ChainStep[] = matchedSegs.map((seg, i) => ({
    segmentId: seg.id ?? `s${seg.startTs}`,
    app: seg.mainApp ?? '',
    role: matchedStepTpls[i].role,
    durationMin: seg.durationMin,
    title: seg.mainTitle ?? '',
    startTs: seg.startTs,
    endTs: seg.endTs
  }))

  return { template, steps, segments: matchedSegs, matchRatio, confidence, hasOutput, outputSignal }
}
