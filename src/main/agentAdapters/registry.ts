/**
 * Agent 适配器注册表：adapterId 优先，为空时按 protocol 回退
 */
import type { AgentAdapter, AgentAdapterContext, AgentAdapterFactory, AgentAdapterRegistry } from '@shared/agentAdapter'
import type { AgentConnector } from '@shared/agents'

export function createAgentAdapterRegistry(ctx: AgentAdapterContext): AgentAdapterRegistry {
  const adapters = new Map<string, AgentAdapter>()
  return {
    register(factory: AgentAdapterFactory): void {
      const adapter = factory(ctx)
      adapters.set(adapter.descriptor.id, adapter)
    },

    get(adapterId: string): AgentAdapter | undefined {
      return adapters.get(adapterId)
    },

    resolve(connector: AgentConnector): AgentAdapter | undefined {
      if (connector.adapterId) {
        const byId = adapters.get(connector.adapterId)
        if (byId) return byId
      }
      for (const adapter of adapters.values()) {
        if (adapter.descriptor.protocol === connector.protocol) return adapter
      }
      return undefined
    },

    list() {
      return [...adapters.values()].map((adapter) => adapter.descriptor)
    }
  }
}
