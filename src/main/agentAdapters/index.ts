/**
 * 默认适配器装配：CLI / ACP / HTTP / MCP / 进程 / 手动
 */
import { app } from 'electron'
import type { AgentAdapterContext, AgentAdapterRegistry } from '@shared/agentAdapter'
import { createCliAdapter } from './cliAdapter'
import { createHttpAdapter } from './httpAdapter'
import { createMcpAdapter } from './mcpAdapter'
import { createManualAdapter, createProcessAdapter } from './observerAdapters'
import { createAgentAdapterRegistry } from './registry'
import { HOME } from './runtime'

export function createDefaultAgentAdapters(getSecret: (agentId: string) => string): AgentAdapterRegistry {
  const ctx: AgentAdapterContext = {
    homeDir: HOME,
    userDataDir: app.getPath('userData'),
    getSecret,
    log: (level, message, meta) => {
      if (level === 'error') console.warn(`[agents] ${message}`, meta ?? '')
    }
  }

  const registry = createAgentAdapterRegistry(ctx)
  registry.register((c) => createCliAdapter(c, 'cli'))
  registry.register((c) => createCliAdapter(c, 'acp'))
  registry.register((c) => createHttpAdapter(c))
  registry.register((c) => createMcpAdapter(c))
  registry.register((c) => createProcessAdapter())
  registry.register((c) => createManualAdapter())
  return registry
}
