/**
 * Super Agent 共享协议与路由（主进程 / 渲染端共用）
 * 第一版只开放「主 Agent → 一级只读 Subagent」，固定流程仍走原有工作流。
 */

export type SuperAgentKind = 'data' | 'knowledge' | 'web'

export interface SuperAgentTask {
  agent: SuperAgentKind
  query: string
}

export interface SuperAgentCitation {
  source: string
  ref: string
  title?: string
  url?: string
}

export interface SuperAgentTaskResult extends SuperAgentTask {
  ok: boolean
  ms: number
  summary: string
  error?: string
  citations: SuperAgentCitation[]
}

export interface OrchestrationRecommendation {
  id: string
  kind: 'skill' | 'model' | 'workflow' | 'optimization'
  title: string
  status: 'missing' | 'available' | 'applied'
  reason: string
  benefit: string
  cost: string
  privacy: string
  action?: 'configure-ai' | 'save-workflow' | 'catalog'
}

export interface SuperAgentRunResult {
  content: string
  traceId: string
  tasks: SuperAgentTaskResult[]
  recommendations: OrchestrationRecommendation[]
}

export const SUPER_AGENT_LIMITS = {
  maxTasks: 3,
  maxConcurrency: 3,
  maxModelRounds: 2,
  totalMs: 65_000,
  plannerMs: 15_000,
  subagentMs: 10_000,
  synthesisMs: 25_000,
  maxQueryChars: 500,
  maxContextChars: 4_000
} as const

const DATA_DOMAIN = /目标|计划|项目|轨迹|今日|今天|专注|效率|工作统计|时间安排/
const KNOWLEDGE_DOMAIN = /知识库|记忆|资料|文档|笔记|引用|沉淀/
const WEB_DOMAIN = /网页|网址|链接|收藏|书签|情报|抓取|https?:\/\//i
const EXPLICIT_URL = /https?:\/\/[^\s<>"'）】]+/i
const EXPLICIT_ROUTE = /super\s*agent|超级\s*agent|主\s*agent|多\s*agent|多智能体|协同分析|联合分析|综合分析|综合研判/i
const WRITE_INTENT = /创建|新建|添加|删除|修改|完成计划|标记完成|提醒我|生成日报|导出|保存|写入|派发|执行工作流|入库/
const READ_ONLY_GUARD = /只读|不要|不能|不得|禁止|无需|不用|不需|别(?:再|擅自|自动)?/

/** 去掉「不要创建/修改/写入」等约束分句，保留真正的动作请求。 */
function actionableText(q: string): string {
  return q
    .split(/[，。；;！!？?\n]/)
    .filter((clause) => !(WRITE_INTENT.test(clause) && READ_ONLY_GUARD.test(clause)))
    .join('，')
}

/** 只给网址、且未点名本地数据/知识库的问题，应只走抓取 Agent，避免无关记忆污染页面总结。 */
export function webOnlyUrlQuestion(text: string): boolean {
  const q = actionableText(String(text ?? '').trim())
  return EXPLICIT_URL.test(q) && !DATA_DOMAIN.test(q) && !KNOWLEDGE_DOMAIN.test(q)
}

export function shouldUseSuperAgent(text: string): boolean {
  const q = actionableText(String(text ?? '').trim())
  if (!q || WRITE_INTENT.test(q)) return false
  if (EXPLICIT_ROUTE.test(q)) return true
  // 明确给网址的只读请求走抓取 Agent，避免主模型凭训练知识补造页面事实。
  if (EXPLICIT_URL.test(q)) return true
  const domains = [DATA_DOMAIN.test(q), KNOWLEDGE_DOMAIN.test(q), WEB_DOMAIN.test(q)].filter(Boolean).length
  const dataFacets = [
    /目标|人生预期/,
    /计划|待办|提醒|时间安排/,
    /项目/,
    /轨迹|专注|效率|工作统计/
  ].filter((pattern) => pattern.test(q)).length
  return domains >= 2 || dataFacets >= 2
}

export function superAgentLabel(kind: SuperAgentKind): string {
  return kind === 'data' ? '数据 Agent' : kind === 'knowledge' ? '知识库 Agent' : '抓取 Agent'
}
