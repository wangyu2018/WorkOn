/**
 * HTTP 适配器：POST JSON 派发任务，兼容 OpenAI 兼容服务或自建 Agent 网关
 */
import { genId } from '@shared/types'
import type { AgentConnector, AgentProbeResult } from '@shared/agents'
import type {
  AgentAdapter,
  AgentAdapterContext,
  AgentCapabilityFlags,
  AgentEvent,
  AgentRunHandle,
  AgentRunRequest
} from '@shared/agentAdapter'
import { AgentEventQueue } from './eventQueue'

function authHeaders(connector: AgentConnector, ctx: AgentAdapterContext): Record<string, string> {
  if (connector.auth !== 'token') return {}
  const token = ctx.getSecret(connector.id)
  return token ? { Authorization: `Bearer ${token}` } : {}
}

export function createHttpAdapter(ctx: AgentAdapterContext): AgentAdapter {
  return {
    descriptor: {
      id: 'http',
      protocol: 'http',
      label: 'HTTP Agent',
      description: '向 HTTP 端点 POST 任务并读取响应',
      capabilities: {
        dispatch: true,
        streaming: false,
        tools: false,
        files: false,
        vision: false,
        resume: false,
        cancel: true,
        approvals: false,
        usage: false,
        workspace: true,
        mcp: false
      },
      requirements: ['可访问的 HTTP 端点', '需要鉴权时配置 token']
    },

    async probe(connector: AgentConnector): Promise<AgentProbeResult> {
      const started = Date.now()
      const url = connector.probePath || connector.endpoint
      if (!/^https?:\/\//i.test(url)) {
        return { ok: false, status: 'error', detail: 'HTTP 地址无效' }
      }
      try {
        const resp = await fetch(url, {
          headers: authHeaders(connector, ctx),
          signal: AbortSignal.timeout(4000)
        })
        return {
          ok: resp.ok,
          status: resp.ok ? 'online' : 'error',
          detail: `HTTP ${resp.status} · ${url}`,
          latencyMs: Date.now() - started
        }
      } catch (e) {
        return { ok: false, status: 'offline', detail: `不可达：${(e as Error).message}`, latencyMs: Date.now() - started }
      }
    },

    capabilities(connector: AgentConnector): AgentCapabilityFlags {
      return {
        dispatch: /^https?:\/\//i.test(connector.endpoint),
        streaming: false,
        tools: false,
        files: false,
        vision: false,
        resume: false,
        cancel: true,
        approvals: false,
        usage: false,
        workspace: true,
        mcp: false
      }
    },

    async start(connector: AgentConnector, req: AgentRunRequest): Promise<AgentRunHandle> {
      if (!/^https?:\/\//i.test(connector.endpoint)) throw new Error('HTTP 地址无效')
      const prompt = req.prompt.trim()
      if (!prompt) throw new Error('任务内容为空')

      const runId = genId('run')
      const queue = new AgentEventQueue()
      const startedAt = Date.now()
      const timeoutMs = req.timeoutMs ?? 180_000
      const controller = new AbortController()
      let timer: NodeJS.Timeout
      let settled = false
      let cancelled = false
      let timedOut = false

      const finish = (event: AgentEvent): void => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        queue.push(event)
        queue.close()
      }

      timer = setTimeout(() => {
        timedOut = true
        controller.abort()
      }, timeoutMs)

      queue.push({ type: 'run_started', runId, at: startedAt })

      void fetch(connector.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders(connector, ctx) },
        body: JSON.stringify({
          prompt,
          cwd: req.cwd || connector.cwd,
          agent: { name: connector.name, capabilities: connector.capabilities }
        }),
        signal: controller.signal
      })
        .then(async (resp) => {
          const body = (await resp.text().catch(() => '')).slice(0, 20_000)
          if (settled) return
          if (body) queue.push({ type: 'text_delta', runId, text: body, at: Date.now() })
          if (resp.ok) {
            finish({ type: 'run_done', runId, output: body, at: Date.now() })
          } else {
            finish({
              type: 'run_error',
              runId,
              code: 'runtime_error',
              error: `HTTP ${resp.status}`,
              at: Date.now()
            })
          }
        })
        .catch((e: Error) => {
          if (cancelled) {
            finish({ type: 'run_cancelled', runId, at: Date.now() })
          } else if (timedOut) {
            finish({
              type: 'run_error',
              runId,
              code: 'timeout',
              error: `执行超时（${Math.round(timeoutMs / 1000)}s）`,
              at: Date.now()
            })
          } else {
            finish({ type: 'run_error', runId, code: 'runtime_error', error: e.message, at: Date.now() })
          }
        })

      return {
        runId,
        events: queue,
        cancel: async () => {
          if (settled) return
          cancelled = true
          controller.abort()
        }
      }
    }
  }
}
