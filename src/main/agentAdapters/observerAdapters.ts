/**
 * 观察型适配器：进程与手动接入只提供状态，不参与派发
 */
import type { AgentConnector, AgentProbeResult } from '@shared/agents'
import type { AgentAdapter, AgentCapabilityFlags } from '@shared/agentAdapter'
import { unsupportedRun } from './eventQueue'
import { isRunning } from './runtime'

const OBSERVE_CAPS: AgentCapabilityFlags = {
  dispatch: false,
  streaming: false,
  tools: false,
  files: false,
  vision: false,
  resume: false,
  cancel: false,
  approvals: false,
  usage: false,
  workspace: false,
  mcp: false
}

const UNSUPPORTED = '该协议暂不支持派发（MCP 先做握手与状态，进程/手动仅观察）'

export function createProcessAdapter(): AgentAdapter {
  return {
    descriptor: {
      id: 'process',
      protocol: 'process',
      label: '进程观察',
      description: '按进程名判断是否在运行，不派发任务',
      capabilities: OBSERVE_CAPS,
      requirements: ['目标进程在本机运行']
    },

    async probe(connector: AgentConnector): Promise<AgentProbeResult> {
      const started = Date.now()
      const name = connector.endpoint || connector.name
      const running = isRunning(name)
      return {
        ok: running,
        status: running ? 'online' : 'offline',
        detail: running ? `进程运行中 · ${name}` : `进程未运行 · ${name}`,
        latencyMs: Date.now() - started
      }
    },

    capabilities() {
      return OBSERVE_CAPS
    },

    async start() {
      return unsupportedRun(UNSUPPORTED)
    }
  }
}

export function createManualAdapter(): AgentAdapter {
  return {
    descriptor: {
      id: 'manual',
      protocol: 'manual',
      label: '手动接入',
      description: '仅登记能力与说明，不自动探测、不派发',
      capabilities: OBSERVE_CAPS,
      requirements: ['人工执行']
    },

    async probe(): Promise<AgentProbeResult> {
      return { ok: true, status: 'unknown', detail: '手动接入 · 无自动探测' }
    },

    capabilities() {
      return OBSERVE_CAPS
    },

    async start() {
      return unsupportedRun(UNSUPPORTED)
    }
  }
}
