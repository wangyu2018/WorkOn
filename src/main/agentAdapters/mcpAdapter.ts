/**
 * MCP 适配器：HTTP / stdio 两种握手探测；HTTP 端点可按白名单派发工具调用
 */
import { genId } from '@shared/types'
import type { AgentConnector, AgentProbeResult } from '@shared/agents'
import type {
  AgentAdapter,
  AgentAdapterContext,
  AgentCapabilityFlags,
  AgentRunHandle,
  AgentRunRequest
} from '@shared/agentAdapter'
import { sendTo } from '../windows'
import { AgentEventQueue } from './eventQueue'
import { stdioHandshake } from './runtime'

function authHeaders(connector: AgentConnector, ctx: AgentAdapterContext): Record<string, string> {
  if (connector.auth !== 'token') return {}
  const token = ctx.getSecret(connector.id)
  return token ? { Authorization: `Bearer ${token}` } : {}
}

export function createMcpAdapter(ctx: AgentAdapterContext): AgentAdapter {
  return {
    descriptor: {
      id: 'mcp',
      protocol: 'mcp',
      label: 'MCP Server',
      description: '握手并读取 MCP 服务状态；HTTP 端点可按工具白名单派发',
      capabilities: {
        dispatch: true,
        streaming: false,
        tools: true,
        files: false,
        vision: false,
        resume: false,
        cancel: false,
        approvals: false,
        usage: false,
        workspace: false,
        mcp: true
      },
      requirements: ['可访问的 MCP 端点', 'stdio 模式需要本机命令']
    },

    async probe(connector: AgentConnector): Promise<AgentProbeResult> {
      const started = Date.now()
      if (!/^https?:\/\//i.test(connector.endpoint)) return stdioHandshake(connector)
      try {
        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream'
        }
        if (connector.auth === 'token') {
          const token = ctx.getSecret(connector.id)
          if (token) headers.Authorization = `Bearer ${token}`
        }
        const resp = await fetch(connector.endpoint, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'initialize',
            params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'WorkOn', version: '0.2.0' } }
          }),
          signal: AbortSignal.timeout(5000)
        })
        const text = await resp.text().catch(() => '')
        let version: string | undefined
        try {
          const json = JSON.parse(text) as { result?: { serverInfo?: { version?: string } } }
          version = json.result?.serverInfo?.version
        } catch { /* ignore */ }
        return {
          ok: resp.ok,
          status: resp.ok ? 'online' : 'error',
          detail: resp.ok ? `MCP 握手成功 · ${connector.endpoint}` : `MCP HTTP ${resp.status}`,
          version,
          latencyMs: Date.now() - started
        }
      } catch (e) {
        return { ok: false, status: 'offline', detail: `MCP 不可达：${(e as Error).message}`, latencyMs: Date.now() - started }
      }
    },

    capabilities(connector: AgentConnector): AgentCapabilityFlags {
      const allow = connector.allowTools ?? []
      return {
        dispatch: /^https?:\/\//i.test(connector.endpoint) && allow.length > 0,
        streaming: false,
        tools: true,
        files: false,
        vision: false,
        resume: false,
        cancel: false,
        approvals: false,
        usage: false,
        workspace: false,
        mcp: true
      }
    },

    async start(connector: AgentConnector, req: AgentRunRequest): Promise<AgentRunHandle> {
      const runId = genId('run')
      const queue = new AgentEventQueue()
      const startedAt = Date.now()
      queue.push({ type: 'run_started', runId, at: startedAt })
      const fail = (error: string): AgentRunHandle => {
        queue.push({ type: 'run_error', runId, code: 'bad_config', error, at: Date.now() })
        queue.close()
        return { runId, events: queue, cancel: async () => undefined }
      }
      if (!/^https?:\/\//i.test(connector.endpoint)) {
        return fail('MCP 派发只支持 HTTP 端点；stdio 端点暂只做握手探测')
      }
      const allow = (connector.allowTools ?? []).map((s) => s.trim()).filter(Boolean)
      if (allow.length === 0) return fail('该 MCP Agent 未配置工具白名单（allowTools）')
      let payload: { tool?: string; args?: Record<string, unknown> }
      try {
        payload = JSON.parse(req.prompt) as { tool?: string; args?: Record<string, unknown> }
      } catch {
        return fail('MCP 派发内容需为 JSON：{"tool":"memory.search","args":{...}}')
      }
      const tool = String(payload.tool ?? '').trim()
      if (!tool) return fail('缺少 tool 字段')
      if (!allow.includes(tool)) return fail(`工具「${tool}」不在白名单内`)

      // 每次调用都广播一次，渲染端可据此提示或审计
      try {
        sendTo('main', 'agent:mcp-call', {
          agentId: connector.id,
          name: connector.name,
          tool,
          args: payload.args ?? {},
          at: Date.now()
        })
      } catch {
        /* 广播失败不影响调用 */
      }
      const callId = genId('call')
      queue.push({
        type: 'tool_start',
        runId,
        callId,
        name: tool,
        input: payload.args ?? {},
        source: 'mcp',
        at: Date.now()
      })
      try {
        const resp = await fetch(connector.endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json, text/event-stream',
            ...authHeaders(connector, ctx)
          },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 2,
            method: 'tools/call',
            params: { name: tool, arguments: payload.args ?? {} }
          }),
          signal: AbortSignal.timeout(req.timeoutMs ?? 60_000)
        })
        const text = (await resp.text().catch(() => '')).slice(0, 40_000)
        if (!resp.ok) throw new Error(`MCP HTTP ${resp.status}`)
        let output = text
        try {
          const json = JSON.parse(text) as {
            result?: { content?: Array<{ type?: string; text?: string }> } | unknown
            error?: { message?: string }
          }
          if (json.error) throw new Error(json.error.message ?? 'MCP 调用失败')
          const content = (json.result as { content?: Array<{ type?: string; text?: string }> } | undefined)?.content
          if (Array.isArray(content)) {
            output = content.map((c) => (typeof c?.text === 'string' ? c.text : '')).filter(Boolean).join('\n') || text
          } else {
            output = typeof json.result === 'string' ? json.result : JSON.stringify(json.result ?? null)
          }
        } catch (e) {
          if (e instanceof SyntaxError) {
            // 非 JSON 响应（如 SSE），按原文返回
          } else {
            throw e
          }
        }
        queue.push({ type: 'tool_end', runId, callId, ok: true, output: output.slice(0, 4000), at: Date.now() })
        queue.push({ type: 'run_done', runId, output: output.trim().slice(0, 20_000), at: Date.now() })
      } catch (e) {
        const message = (e as Error).message
        queue.push({ type: 'tool_end', runId, callId, ok: false, output: message, at: Date.now() })
        queue.push({ type: 'run_error', runId, code: 'runtime_error', error: message, at: Date.now() })
      }
      queue.close()
      return { runId, events: queue, cancel: async () => undefined }
    }
  }
}
