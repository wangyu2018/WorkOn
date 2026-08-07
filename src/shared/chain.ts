/**
 * 作业链路工具：从合并轨迹中提炼"应用流转链"并生成自然语言描述
 * 例：在 VSCode 编程 45 分钟 → 在 Chrome 查资料 12 分钟 → 回到 VSCode 编程 30 分钟
 */
import type { TrailSegment, UserType, WorkState } from './types'
import { WORK_STATES } from './stateMeta'

export interface ChainHop {
  app: string
  state: WorkState
  minutes: number
}

const HOP_GAP_MS = 30 * 60 * 1000 // 超过 30 分钟间隔断开为新链

/** 把相邻同应用的有效段（非 glance）合并为 hop 序列 */
export function condenseHops(segments: TrailSegment[]): ChainHop[] {
  const hops: ChainHop[] = []
  for (const seg of segments) {
    if (seg.glance || !seg.mainApp) continue
    const last = hops[hops.length - 1]
    if (last && last.app === seg.mainApp && last.state === seg.mainState) {
      last.minutes += seg.durationMin
    } else {
      hops.push({ app: seg.mainApp, state: seg.mainState, minutes: seg.durationMin })
    }
  }
  return hops
}

/** 提取当日主要作业链（按总时长排序取前 maxChains 条，每条 ≥2 hops） */
export function extractChains(segments: TrailSegment[], maxChains = 3): ChainHop[][] {
  const hops = condenseHops(segments)
  const chains: ChainHop[][] = []
  let cur: ChainHop[] = []
  for (let i = 0; i < hops.length; i++) {
    if (cur.length >= 8) {
      chains.push(cur)
      cur = []
    }
    cur.push(hops[i])
  }
  if (cur.length) chains.push(cur)
  const chainMin = (c: ChainHop[]) => c.reduce((a, h) => a + h.minutes, 0)
  return chains
    .filter((c) => c.length >= 2 && chainMin(c) >= 5)
    .sort((a, b) => chainMin(b) - chainMin(a))
    .slice(0, maxChains)
}

/** 生成链路自然语言描述：在 VSCode 编程 45 分钟 → 在 Chrome 查资料 12 分钟 → 回到 VSCode 编程 30 分钟 */
export function describeChain(hops: ChainHop[]): string {
  if (!hops.length) return ''
  const fmt = (min: number): string => {
    const m = Math.round(min)
    return m >= 60 ? `${Math.floor(m / 60)}h${m % 60 > 0 ? `${m % 60}m` : ''}` : `${m}分钟`
  }
  return hops
    .map((h, i) => {
      const meta = WORK_STATES[h.state]
      const verb = i === 0 ? `在 ${h.app} ${meta?.label ?? h.state}` : i === hops.length - 1 && i > 0 ? `回到 ${h.app} ${meta?.label ?? h.state}` : `转到 ${h.app} ${meta?.label ?? h.state}`
      return `${verb} ${fmt(h.minutes)}`
    })
    .join(' → ')
}

// ───────────────────────── 作业链路识别引擎（v2.6.1） ─────────────────────────
// 依据：workon-design-spec-v2.6.1 §2 概念定义 / §6 数据模型
// 字段名对齐项目现有风格（durationMin / startTs / endTs），与 spec 伪代码的 duration/startTime 对应

/** 五种链路类型（v2.6.1 §2.2） */
export type ChainType = 'task_assigned' | 'self_driven' | 'learning' | 'creative' | 'meeting'

/** 链路角色：接单 / 处理 / 交付 / 检查 / 沟通 */
export type ChainRole = 'intake' | 'process' | 'output' | 'review' | 'communication'

/** 产出类型（产出闭环检测） */
export type ChainOutputType = 'document' | 'code' | 'message' | 'email' | 'file_upload' | 'none'

/** 链路中的单步（关联一个 TrailSegment） */
export interface ChainStep {
  segmentId: string // 关联的 TrailSegment id
  app: string // 应用名（友好名，如 VSCode / WeChat）
  role: ChainRole
  durationMin: number
  title: string // 窗口标题
  startTs: number
  endTs: number
}

/** 识别出的一条作业链路 */
export interface WorkChain {
  id: string
  userType: UserType
  date: string // YYYY-MM-DD
  type: ChainType
  templateId: string // 命中的模板 id
  templateName: string // 模板中文名（如「领导任务执行链」）
  /** >0.6 确认（有产出 completed / 无产出 active）；0.3-0.6 tentative 待确认 */
  status: 'completed' | 'active' | 'tentative'
  steps: ChainStep[]
  startTs: number
  endTs: number
  totalMin: number // 链路总时长（含切换间隔）
  productiveMin: number // 有效工作时长（不含切换间隔）
  switchCount: number // 应用切换次数
  hasOutput: boolean
  outputType: ChainOutputType
  switchEfficiency: number // productiveMin / totalMin，越高越高效
  confidence: number // 识别置信度 0-1
}

/** 每个 TrailSegment 的链路归属标签（spec §1.3 输出） */
export interface SegmentChainLabel {
  segmentId: string
  chainId: string | null // null = 不属于任何链路
  chainRole?: ChainRole
  label: 'productive' | 'distracted' | 'neutral'
}

/** 链路模板单步（spec §4.2 ChainStepTemplate） */
export interface ChainStepTemplate {
  appPattern: string // 应用名匹配模式（正则，对友好名匹配）
  role: ChainRole
  titleKeywords?: string[] // 窗口标题关键词（可选，提高匹配精度）
  titleExclude?: string[] // 窗口标题排除词（如水群关键词）
  minDurationMin?: number // 最小持续时长（分钟）
}

/** 链路模板（spec §4.2 ChainTemplate；maxGap 固定 30min 断簇，不逐模板配置） */
export interface ChainTemplate {
  id: string
  name: string // 模板中文名
  type: ChainType
  userType: UserType
  steps: ChainStepTemplate[]
  requireOutput: boolean // 是否要求产出闭环
}

/**
 * 条件分心判定（spec §6.3 ConditionalDistraction 简化版）
 * TODO：spec 的 has_active_project / time_range 条件 P0 不实现，仅保留 title_contains / in_chain 两种
 */
export interface ConditionalDistraction {
  appPattern: string // 应用名正则
  condition: 'title_contains' | 'in_chain'
  /** title_contains：标题命中这些词 → 判摸鱼候选；未命中 → neutral */
  slackingKeywords?: string[]
}

/** 某用户类型的链路配置：模板库 + 分心应用集 */
export interface UserChainConfig {
  userType: UserType
  templates: ChainTemplate[]
  /** 明确摸鱼应用（正则，不在链路中即分心候选） */
  primaryDistractions: string[]
  conditionalDistractions: ConditionalDistraction[]
}

/** 链路维度指标（spec §5.3 CHAIN_METRICS） */
export interface ChainMetrics {
  chainCount: number // 当日识别出的链路数
  chainOutputRate: number // 有产出闭环的链路占比 0-1
  avgChainMin: number // 链路平均时长（分钟）
  switchEfficiency: number // 链路内有效时长 / 链路总时长（按总时长加权）0-1
  chainDiversity: number // 链路类型多样性（当日出现的不同类型数）
  distractedMin: number // 链路外分心分钟
  neutralMin: number // 链路外中性分钟（微切换/短暂休息）
}

/** 单日链路分析报告（落库 db chains 集合，按 date 唯一） */
export interface ChainDayReport {
  date: string // YYYY-MM-DD
  userType: UserType
  chains: WorkChain[]
  labels: SegmentChainLabel[]
  metrics: ChainMetrics
  ts: number
}
