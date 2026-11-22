/**
 * 动态 Agent 连接器：共享类型
 * 说明：注册表是唯一事实来源；WorkBuddy / Trae / ZCode 等只是“检测到的预设”，
 * 用户可以随时在窗口里说“增加一个 Agent”，按问答补齐信息后写入注册表。
 */
import type { ProviderStatus } from './intel'

export type AgentProtocol = 'mcp' | 'acp' | 'http' | 'cli' | 'process' | 'manual'
export type AgentAuth = 'none' | 'token' | 'oauth' | 'login'
export type AgentQuotaMode = 'observed' | 'manual' | 'vendor'
export type AgentProbeStatus = 'unknown' | 'online' | 'offline' | 'error' | 'unavailable'

export interface AgentConnector {
  id: string
  name: string
  protocol: AgentProtocol
  /** 指定适配器；为空时按 protocol 回退（如 cli-claude / cli-codex） */
  adapterId?: string
  /** http/mcp 填 URL；cli/acp/process 填可执行路径或进程名 */
  endpoint: string
  args: string[]
  cwd: string
  auth: AgentAuth
  /** 只回传是否存在，明文/密文留在主进程 */
  hasToken: boolean
  capabilities: string[]
  quotaMode: AgentQuotaMode
  quotaValue: number
  /** http/mcp 健康检查路径；为空则直接请求 endpoint */
  probePath: string
  /** cli/acp 派发参数模板，支持 {prompt} / {cwd} */
  dispatchArgs: string[]
  /** MCP 白名单：只有列出的工具才允许派发调用 */
  allowTools?: string[]
  env: Record<string, string>
  enabled: boolean
  createdAt: number
  updatedAt: number
  lastProbeAt?: number
  lastStatus: AgentProbeStatus
  lastError?: string
  lastActive?: number
  calls: number
  tokens: number
}

export interface AgentView extends AgentConnector {
  /** 本机内置 Agent（情报 / 本地模型 / 知识库） */
  builtin?: boolean
  status: AgentProbeStatus
  detail: string
  version?: string
  dispatchable: boolean
}

export interface AgentSuggestion {
  id: string
  name: string
  protocol: AgentProtocol
  endpoint: string
  args: string[]
  auth: AgentAuth
  capabilities: string[]
  detail: string
  preset?: Partial<AgentConnector>
}

export interface AgentListResult {
  homeDir: string
  agents: AgentView[]
  suggestions: AgentSuggestion[]
  providers: ProviderStatus[]
}

export interface AgentInput {
  id?: string
  name: string
  protocol: AgentProtocol
  adapterId?: string
  endpoint: string
  args?: string[]
  cwd?: string
  auth?: AgentAuth
  token?: string
  capabilities?: string[]
  quotaMode?: AgentQuotaMode
  quotaValue?: number
  probePath?: string
  dispatchArgs?: string[]
  allowTools?: string[]
  env?: Record<string, string>
  enabled?: boolean
}

export interface AgentProbeResult {
  ok: boolean
  status: AgentProbeStatus
  detail: string
  version?: string
  latencyMs?: number
}

export interface AgentRunResult {
  ok: boolean
  agentId: string
  output: string
  error?: string
  durationMs: number
}

/** 一次外部 Agent 派发的输入 / 输出留痕（用于「它到底收到了什么、回了什么」） */
export interface AgentRunRecord {
  id: string
  agentId: string
  agentName: string
  protocol: AgentProtocol
  input: string
  output: string
  ok: boolean
  error?: string
  durationMs: number
  startedAt: number
  endedAt: number
  /** 标记为工作流编排的参考样本（只借鉴结构，不直接执行） */
  reference?: boolean
}
