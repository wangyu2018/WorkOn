/** 只读编排推荐：基于本轮结果说明能力缺口与取舍，不自动安装或改配置。 */
import type { OrchestrationRecommendation, SuperAgentTaskResult } from '@shared/superAgent'
import { getSettings } from './settings'

export function buildOrchestrationRecommendations(
  question: string,
  results: SuperAgentTaskResult[]
): OrchestrationRecommendation[] {
  const out: OrchestrationRecommendation[] = []
  const web = results.find((r) => r.agent === 'web')
  const knowledge = results.find((r) => r.agent === 'knowledge')
  const settings = getSettings()
  const localModel = /localhost|127\.0\.0\.1|ollama|lmstudio/i.test(`${settings.aiBaseUrl} ${settings.aiModel}`)

  if (results.length > 1) {
    out.push({
      id: 'parallel-subagents', kind: 'optimization', title: `并行调度 ${results.length} 个只读任务`, status: 'applied',
      reason: '本轮任务之间没有依赖，已由 Supervisor 一次性派发。',
      benefit: '减少串行等待；单个任务失败不会阻断其他结果。',
      cost: '最多 3 个并发，受本轮总预算约束。', privacy: '各任务仅获得自己的最小任务参数。'
    })
  }
  if (web && !web.ok) {
    out.push({
      id: 'skill-page-reader', kind: 'skill', title: '网页正文增强 Skill', status: 'missing',
      reason: `抓取 Agent 本轮失败：${web.error ?? '未知错误'}。`,
      benefit: '为复杂页面增加更稳的正文提取与失败回退。',
      cost: '添加前需审阅权限、依赖和远程内容风险。', privacy: '默认不抓取，只有用户给出网址后才联网。',
      action: 'catalog'
    })
  } else if (web && web.citations.length === 0 && !/https?:\/\//i.test(question)) {
    out.push({
      id: 'skill-web-search', kind: 'skill', title: '网页搜索 Skill', status: 'missing',
      reason: '本轮只有既有收藏 / 情报，没有可匹配的在线搜索结果。',
      benefit: '补充发现新资料的能力，减少手工找网址。',
      cost: '可能产生搜索 API 额度或限流。', privacy: '搜索词需先脱敏，并由用户确认联网。',
      action: 'catalog'
    })
  }
  if (knowledge && knowledge.ok && knowledge.citations.length === 0) {
    out.push({
      id: 'skill-semantic-search', kind: 'skill', title: '知识库语义检索 Skill', status: 'missing',
      reason: '精确关键词检索没有找到可引用内容。',
      benefit: '降低措辞不同造成的空结果，仍保留引用来源。',
      cost: '本地向量索引需要额外存储与构建时间。', privacy: '优先本地索引；外部向量化必须单独授权。',
      action: 'catalog'
    })
  }
  out.push({
    id: 'model-local-free', kind: 'model', title: 'Ollama / LM Studio 本地免费模型',
    status: localModel ? 'available' : 'missing',
    reason: localModel ? '当前已配置本地模型，可继续承接分类、提取等轻任务。' : '可把分类、提取等轻任务从付费接口拆到本地。',
    benefit: '减少 API 调用费用；复杂汇总仍可选择更强模型。',
    cost: '无 API 费用，但占用本机 CPU、内存与磁盘。', privacy: '数据不出本机。',
    action: localModel ? undefined : 'configure-ai'
  })
  if (!localModel) {
    out.push({
      id: 'model-free-quota', kind: 'model', title: 'OpenAI 兼容免费额度资源（待实时核验）', status: 'missing',
      reason: '可作为本地模型之外的备用执行器，不承诺永久免费。',
      benefit: '在本机资源不足时提供备用选择。',
      cost: '额度、限流、模型名与有效期以提供商实时目录为准。', privacy: '默认不发送个人目标、轨迹或知识库，需单独授权。',
      action: 'configure-ai'
    })
  }
  if (results.length >= 2 || /每天|每周|定期|重复/.test(question)) {
    out.push({
      id: 'workflow-reuse', kind: 'workflow', title: '将本轮编排保存为固定工作流', status: 'available',
      reason: '本轮包含多个可复用只读步骤。',
      benefit: '下次复用固定流程，减少重复拆解与调度。',
      cost: '固定流程不适合每次都在变化的临时需求。', privacy: '只有用户确认后才保存，不会自动创建。',
      action: 'save-workflow'
    })
  }
  return out.slice(0, 4)
}
