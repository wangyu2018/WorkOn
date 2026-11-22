/**
 * 可视化工作流编排（Workflow Studio）共享类型
 * - 节点即 Agent：角色 / 工作定义 / 输出物 → 生成提示词
 * - 边即上游：下游节点显式读取上游输出
 * - 图像节点：优先视觉模型，不支持视觉时自动回退 OCR
 */

export type WorkflowNodeKind =
  | 'input' // 需求输入
  | 'collect' // 系统采集（本机实时状态 / 今日轨迹 / 项目）
  | 'agent' // 模型 Agent
  | 'image' // 图像处理（视觉 or OCR）
  | 'tool' // 浏览器 / 电脑操作能力
  | 'group' // 工作群组：聚合上游，挂载子节点
  | 'output' // 输出 / 入库

/** 节点目录：主进程生成提示词、编排页节点面板、对话里「有哪些节点」共用一份 */
export const WORKFLOW_NODE_CATALOG: Array<{
  kind: WorkflowNodeKind
  label: string
  hint: string
  color: string
}> = [
  { kind: 'input', label: '需求输入', hint: '本次任务的目标与原始材料', color: '#60a5fa' },
  { kind: 'collect', label: '系统采集', hint: '本机实时状态 / 今日轨迹 / 进行中项目', color: '#22d3ee' },
  { kind: 'agent', label: 'Agent', hint: '角色 + 工作定义 + 输出物', color: '#a78bfa' },
  { kind: 'image', label: '图像处理', hint: '视觉模型优先，不支持则 OCR', color: '#f472b6' },
  { kind: 'tool', label: '浏览器 / 工具', hint: '打开网页 → 读取正文 / 提炼要点 / 截图', color: '#fbbf24' },
  { kind: 'group', label: '工作群组', hint: '聚合上游，挂载子节点（动态层级）', color: '#34d399' },
  { kind: 'output', label: '输出 / 入库', hint: '最终结果与入库目标', color: '#94a3b8' }
]

export type WorkflowImageMode = 'auto' | 'vision' | 'ocr'
export type WorkflowToolKind = 'browser' | 'computer' | 'video' | 'rss'
/** 浏览器节点执行动作：读取正文 / 提炼要点 / 截图 / 网页问答 */
export type WorkflowBrowserAction = 'read' | 'extract' | 'screenshot' | 'ask'
/** 网页问答站点预设（custom 时用节点里的目标网址） */
export type WorkflowBrowserSite = 'deepseek' | 'doubao' | 'qwen' | 'chatglm' | 'wenxin' | 'yuanbao' | 'kimi' | 'custom'

export interface WorkflowNode {
  id: string
  kind: WorkflowNodeKind
  title: string
  x: number
  y: number
  /** 角色：这个节点是谁 */
  role?: string
  /** 工作定义：具体要做什么 */
  duty?: string
  /** 输出物定义：应该产出什么 */
  outputSpec?: string
  /** 模型 id；空 = 使用设置里的默认模型 */
  model?: string
  /** 外部 Agent 连接器 id；设置后节点走该 Agent 派发，而不是内置模型 */
  agentId?: string
  /** 会话模式：none=不关联（默认）；new=每次运行新建会话；existing=接续已有会话 */
  sessionMode?: 'none' | 'new' | 'existing'
  /** sessionMode=existing 时选择的会话 id */
  sessionId?: string
  /** 提示词模板；{{input}} 本次输入，{{upstream}} 上游输出 */
  promptTemplate?: string
  /** 图像节点处理方式 */
  imageMode?: WorkflowImageMode
  /** 图像节点图片（data URL，仅保存在本机 workflow 文件） */
  imageDataUrl?: string
  /** 工具节点能力类型 */
  toolKind?: WorkflowToolKind
  /** 浏览器节点：目标网址；留空则取上游里的第一个链接或当前页面 */
  browserUrl?: string
  /** 浏览器节点执行动作 */
  browserAction?: WorkflowBrowserAction
  /** 网页问答站点预设 */
  browserSite?: WorkflowBrowserSite
  /** 网页问答的问题（支持 {{input}} / {{upstream}}） */
  browserQuestion?: string
  /** 网页问答：回答区域选择器（留空用站点默认/通用规则） */
  browserAnswerSelector?: string
  /** 浏览器节点：提炼要求（extract 模式交给模型） */
  browserTask?: string
  /** 视频节点：视频链接（YouTube / B站等）；留空则取上游里的第一个链接 */
  videoUrl?: string
  /** 视频节点：字幕语言优先级，逗号分隔 */
  videoLang?: string
  /** RSS 节点：订阅源地址；留空则取上游里的第一个链接 */
  rssUrl?: string
  /** RSS 节点：最多读取的条目数 */
  rssLimit?: number
  /** 所属项目 */
  projectId?: string
  /** 所属群组节点（动态层级） */
  parentId?: string
  /** 额外上游（连线之外，用于跨层级引用） */
  upstreamIds?: string[]
  /** 备注 */
  note?: string
}

export interface WorkflowEdge {
  id: string
  from: string
  to: string
}

/** 定时 / 夜间执行（FEAT-4）：每天到点自动跑一次；夜间模式只是语义标签 */
export interface WorkflowSchedule {
  enabled: boolean
  mode: 'daily' | 'night'
  atHHMM: string // "09:30"
  /** 定时运行时的固定输入（留空=「定时运行」） */
  input?: string
  lastRunDate?: string // 去重：本日已跑
  lastRunAt?: number
}

export interface WorkflowRunRecord {
  id: string
  workflowId: string
  name: string
  trigger: 'manual' | 'schedule'
  startedAt: number
  endedAt: number
  ok: boolean
  error?: string
  nodes: number
  output?: string
}

export interface WorkflowDef {
  id: string
  name: string
  /** 整体目标：用于辅助拆分边界 */
  goal?: string
  projectId?: string
  nodes: WorkflowNode[]
  edges: WorkflowEdge[]
  schedule?: WorkflowSchedule
  createdAt: number
  updatedAt: number
}

export interface WorkflowListResult {
  workflows: WorkflowDef[]
}

export interface WorkflowModelInfo {
  id: string
  name: string
  vision: boolean
  tools: boolean
  source: 'ollama' | 'openai'
  detail?: string
}

export interface WorkflowModelsResult {
  models: WorkflowModelInfo[]
  baseUrl: string
  ollama: boolean
  error?: string
}

export interface WorkflowRunRequest {
  model?: string
  system?: string
  prompt: string
  images?: string[]
  temperature?: number
  timeoutMs?: number
  /** Ollama 思考开关：结构化拆解/图像处理时关掉更快 */
  think?: boolean
}

export interface WorkflowRunResult {
  ok: boolean
  text: string
  model: string
  ms: number
  error?: string
  /** 视觉失败时提示可回退的处理方式 */
  fallback?: 'ocr' | 'text-only'
}

export interface WorkflowOcrResult {
  ok: boolean
  text: string
  error?: string
}

/** 视频字幕 / RSS 抓取结果（由本机上游工具完成，不经过第三方 API） */
export interface WorkflowMediaResult {
  ok: boolean
  text: string
  title?: string
  error?: string
}

export interface WorkflowCollectResult {
  ok: boolean
  text: string
  at: number
  error?: string
}

export interface WorkflowAutomationCapabilities {
  platform: string
  browserUse: boolean
  playwright: boolean
  computerUse: boolean
  detail: string
}

/** 一句话生成编排：成功时返回待确认的工作流草稿（确认后保存） */
export interface WorkflowGenerateResult {
  ok: boolean
  workflow?: WorkflowDef
  error?: string
  /** 本次编排参考了多少条其他产品的真实输出 */
  referenceCount?: number
}

export interface WorkflowNodeRun {
  nodeId: string
  status: 'idle' | 'running' | 'done' | 'error'
  input?: string
  output?: string
  error?: string
  ms?: number
  /** 本次节点执行的真实开始 / 结束时间（用于作战板泳道） */
  startedAt?: number
  endedAt?: number
  fallback?: 'ocr' | 'text-only'
}
