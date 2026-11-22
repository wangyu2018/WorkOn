/**
 * Agent 接入适配器接口
 *
 * 目标：按 Ekko Studio 的适配器模式，把「内置模型 / 本机 CLI / HTTP / MCP / ACP / 进程观察」
 * 收敛成同一套 probe → start → events → cancel 接口。对话、群聊、工作流节点只依赖适配器，
 * 不再关心对方是模型 API 还是某个 CLI。
 *
 * 分层：
 *   AgentConnector（已有，持久化配置：地址、参数、凭证密文）
 *     → AgentAdapter（本文件，按协议/产品实现一次）
 *     → AgentRunHandle（一次运行：事件流 + 取消 + 审批）
 *     → AgentAdapterRegistry（adapterId → adapters，主进程持有）
 *
 * 实现位置：src/main/agentAdapters（registry / cli / http / mcp / observer）。
 * 兼容层：dispatchAgent 内部 start + 收集事件，返回旧的 AgentRunResult。
 */
import type { AgentConnector, AgentProbeResult, AgentProtocol } from './agents'

/** 适配器唯一标识（如 cli-claude、cli-codex、http-openai、builtin-model） */
export type AgentAdapterId = string

/** builtin 表示不依赖外部进程的内置能力（模型、知识库等） */
export type AgentAdapterProtocol = AgentProtocol | 'builtin'

/** 能力声明：UI 与工作流据此决定显示哪些控件、走哪条执行路径 */
export interface AgentCapabilityFlags {
  /** 能接收 prompt 并执行一次任务 */
  dispatch: boolean
  /** 能流式输出文本增量 */
  streaming: boolean
  /** 能上报工具调用与结果 */
  tools: boolean
  /** 能产生/修改文件 */
  files: boolean
  /** 能处理图片输入 */
  vision: boolean
  /** 支持续聊（sessionId / resume） */
  resume: boolean
  /** 支持中止在途运行 */
  cancel: boolean
  /** 会发起审批请求（approve / deny） */
  approvals: boolean
  /** 能上报 token / 费用 */
  usage: boolean
  /** 需要/支持工作目录 */
  workspace: boolean
  /** 能消费 MCP 工具 */
  mcp: boolean
}

/** 适配器自描述：暴露给 Agent Manager 与工作流节点选择器 */
export interface AgentAdapterDescriptor {
  id: AgentAdapterId
  protocol: AgentAdapterProtocol
  label: string
  description: string
  /** 适配器上限能力；具体连接器可用 capabilities() 再收窄 */
  capabilities: AgentCapabilityFlags
  /** 前置条件，如「安装 Claude Code CLI」「完成登录」 */
  requirements: string[]
}

/** 续聊所需的会话引用；由调用方持久化，适配器只负责恢复 */
export interface AgentSessionRef {
  id: string
  agentId: string
  cwd?: string
  createdAt: number
}

export type AgentPermissionMode = 'ask' | 'accept-edits' | 'full-auto'

/** 一次运行请求：所有协议共用 */
export interface AgentRunRequest {
  agentId: string
  prompt: string
  system?: string
  images?: string[]
  cwd?: string
  model?: string
  permission?: AgentPermissionMode
  /** 传 previous session id 表示续聊 */
  sessionId?: string
  timeoutMs?: number
  /** 调用方透传字段，适配器不解释 */
  metadata?: Record<string, string>
}

export interface AgentUsage {
  inputTokens?: number
  outputTokens?: number
  totalTokens?: number
  costUsd?: number
}

/** 统一错误码：把各家 CLI/API 的错误翻译成可操作提示 */
export type AgentErrorCode =
  | 'not_installed'
  | 'not_logged_in'
  | 'unauthorized'
  | 'rate_limited'
  | 'timeout'
  | 'cancelled'
  | 'unsupported'
  | 'bad_config'
  | 'runtime_error'

export type AgentApprovalDecision = 'allow' | 'deny'

/**
 * 统一事件流：适配器把 CLI stdout / HTTP SSE / MCP 消息都翻译成这些事件。
 * 渲染层只消费事件，不解析原始输出。
 */
export type AgentEvent =
  | { type: 'run_started'; runId: string; sessionId?: string; at: number }
  | { type: 'text_delta'; runId: string; text: string; at: number }
  | { type: 'thinking_delta'; runId: string; text: string; at: number }
  | {
      type: 'tool_start'
      runId: string
      callId: string
      name: string
      input?: unknown
      source?: 'builtin' | 'mcp' | 'cli'
      at: number
    }
  | {
      type: 'tool_end'
      runId: string
      callId: string
      ok: boolean
      output?: string
      durationMs?: number
      at: number
    }
  | {
      type: 'approval_required'
      runId: string
      requestId: string
      title: string
      detail?: string
      at: number
    }
  | { type: 'file'; runId: string; path: string; change: 'created' | 'modified' | 'deleted'; at: number }
  | { type: 'usage'; runId: string; usage: AgentUsage; at: number }
  | { type: 'run_done'; runId: string; output: string; sessionId?: string; usage?: AgentUsage; at: number }
  | { type: 'run_error'; runId: string; code?: AgentErrorCode; error: string; at: number }
  | { type: 'run_cancelled'; runId: string; at: number }

/** 运行句柄：调用方消费事件流，可随时取消；支持审批时再调用 approve */
export interface AgentRunHandle {
  runId: string
  sessionId?: string
  events: AsyncIterable<AgentEvent>
  cancel: (reason?: string) => Promise<void>
  approve?: (requestId: string, decision: AgentApprovalDecision, note?: string) => Promise<void>
}

/** 非流式调用方的最终结果（兼容现有 dispatchAgent） */
export interface AgentRunSummary {
  runId: string
  ok: boolean
  output: string
  sessionId?: string
  error?: string
  code?: AgentErrorCode
  usage?: AgentUsage
  durationMs: number
}

/** 单个适配器：每种协议 / 产品实现一次 */
export interface AgentAdapter {
  readonly descriptor: AgentAdapterDescriptor
  /** 健康探测：是否安装、是否登录、端点是否可用 */
  probe(connector: AgentConnector, signal?: AbortSignal): Promise<AgentProbeResult>
  /** 该连接器的实际能力（可被配置收窄，如未配置 dispatchArgs 时 dispatch=false） */
  capabilities(connector: AgentConnector): AgentCapabilityFlags
  /** 启动一次运行；适配器负责把原始输出翻译成 AgentEvent */
  start(connector: AgentConnector, req: AgentRunRequest): Promise<AgentRunHandle>
  /** 续聊；不支持时不要实现该方法 */
  resume?(
    connector: AgentConnector,
    session: AgentSessionRef,
    req: AgentRunRequest
  ): Promise<AgentRunHandle>
  /** 应用退出或适配器卸载时的清理 */
  dispose?(): Promise<void>
}

/** 适配器上下文：由主进程注入，适配器不直接读全局设置/密钥 */
export interface AgentAdapterContext {
  homeDir: string
  userDataDir: string
  /** 读取解密后的凭证；只在主进程内可用 */
  getSecret: (agentId: string) => string
  log: (level: 'debug' | 'info' | 'warn' | 'error', message: string, meta?: unknown) => void
  /** 统一模型代理（CLI 的 scoped 模式可注入 Studio 选择的模型） */
  model?: {
    baseUrl: string
    apiKey?: string
    model?: string
  }
}

export type AgentAdapterFactory = (ctx: AgentAdapterContext) => AgentAdapter

/** 主进程注册表：一个 adapterId 对应一个适配器实例 */
export interface AgentAdapterRegistry {
  register(factory: AgentAdapterFactory): void
  get(adapterId: AgentAdapterId): AgentAdapter | undefined
  /** 按连接器的 adapterId 解析；为空时回退到 protocol */
  resolve(connector: AgentConnector): AgentAdapter | undefined
  list(): AgentAdapterDescriptor[]
}
