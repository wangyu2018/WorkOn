/**
 * 本地 MCP Server（P1）：把记忆/计划/报告以 MCP 工具暴露给外部 Agent
 * 传输：JSON-RPC 2.0 over HTTP（127.0.0.1），支持 initialize / tools/list / tools/call
 * 默认不随应用启动，由 IPC 显式开启，避免端口常驻。
 */
import http from 'http'
import { col } from '../db'
import { search } from '../memory'
import type { PlanItem } from '@shared/types'

export const MCP_PORT = 18793

let server: http.Server | null = null

const TOOLS = [
  {
    name: 'memory.search',
    description: '检索本地记忆（屏幕 OCR/知识库/应用活动）',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        start: { type: 'number' },
        end: { type: 'number' },
        limit: { type: 'number' }
      },
      required: ['query']
    }
  },
  {
    name: 'plan.list',
    description: '列出某日计划',
    inputSchema: {
      type: 'object',
      properties: { date: { type: 'string', description: 'YYYY-MM-DD' } },
      required: []
    }
  },
  {
    name: 'report.export',
    description: '导出某日报告为文件（md/html/pdf/png）',
    inputSchema: {
      type: 'object',
      properties: {
        date: { type: 'string' },
        format: { type: 'string', enum: ['md', 'html', 'pdf', 'png'] },
        template: { type: 'string', enum: ['brief', 'report', 'deck', 'poster'] }
      },
      required: []
    }
  }
]

type Rpc = { jsonrpc?: string; id?: string | number | null; method?: string; params?: Record<string, unknown> }

async function callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  if (name === 'memory.search') {
    return { hits: search(String(args.query ?? ''), {
      start: typeof args.start === 'number' ? args.start : undefined,
      end: typeof args.end === 'number' ? args.end : undefined,
      limit: typeof args.limit === 'number' ? args.limit : 20
    }) }
  }
  if (name === 'plan.list') {
    const date = String(args.date ?? new Date().toISOString().slice(0, 10))
    const plans = col<PlanItem>('plans').filter((p) => p.date === date)
    return { date, plans: plans.map((p) => ({ id: p.id, title: p.title, status: p.status, startMin: p.startMin })) }
  }
  if (name === 'report.export') {
    const { exportReport } = await import('../report/engine')
    const date = String(args.date ?? new Date().toISOString().slice(0, 10))
    const formatRaw = String(args.format ?? 'html')
    const format = (['md', 'html', 'pdf', 'png'].includes(formatRaw) ? formatRaw : 'html') as 'md' | 'html' | 'pdf' | 'png'
    const templateRaw = String(args.template ?? 'report')
    const template = (['brief', 'report', 'deck', 'poster'].includes(templateRaw) ? templateRaw : 'report') as
      | 'brief'
      | 'report'
      | 'deck'
      | 'poster'
    return exportReport(date, format, template)
  }
  throw new Error(`未知工具：${name}`)
}

async function handleRpc(body: Rpc): Promise<Record<string, unknown> | null> {
  const id = body.id ?? null
  const method = String(body.method ?? '')
  if (!method) return { jsonrpc: '2.0', id, error: { code: -32600, message: 'Invalid Request' } }
  try {
    if (method === 'initialize') {
      return {
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: '2024-11-05',
          capabilities: { tools: {} },
          serverInfo: { name: 'workon-memory', version: '0.2.0' }
        }
      }
    }
    if (method === 'tools/list') {
      return { jsonrpc: '2.0', id, result: { tools: TOOLS } }
    }
    if (method === 'tools/call') {
      const params = body.params ?? {}
      const name = String(params.name ?? '')
      const args = (params.arguments ?? {}) as Record<string, unknown>
      const result = await callTool(name, args)
      return {
        jsonrpc: '2.0',
        id,
        result: { content: [{ type: 'text', text: JSON.stringify(result) }], isError: false }
      }
    }
    if (method === 'notifications/initialized') return null
    return { jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${method}` } }
  } catch (e) {
    return {
      jsonrpc: '2.0',
      id,
      result: { content: [{ type: 'text', text: `错误：${(e as Error).message}` }], isError: true }
    }
  }
}

export function mcpStatus(): { running: boolean; port: number; tools: string[] } {
  return { running: !!server, port: MCP_PORT, tools: TOOLS.map((t) => t.name) }
}

export function startMcpServer(port = MCP_PORT): Promise<{ port: number; tools: string[] }> {
  if (server) return Promise.resolve({ port, tools: TOOLS.map((t) => t.name) })
  return new Promise((resolve, reject) => {
    const s = http.createServer((req, res) => {
      if (req.method !== 'POST' || !req.url?.startsWith('/mcp')) {
        res.writeHead(405, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'use POST /mcp' }))
        return
      }
      const chunks: Buffer[] = []
      req.on('data', (c: Buffer) => chunks.push(c))
      req.on('end', () => {
        void (async () => {
          try {
            const raw = Buffer.concat(chunks).toString('utf-8')
            const parsed = JSON.parse(raw || '{}') as Rpc | Rpc[]
            const out = Array.isArray(parsed)
              ? (await Promise.all(parsed.map((r) => handleRpc(r)))).filter(Boolean)
              : await handleRpc(parsed)
            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify(out ?? null))
          } catch (e) {
            res.writeHead(400, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: (e as Error).message } }))
          }
        })()
      })
    })
    s.on('error', reject)
    s.listen(port, '127.0.0.1', () => {
      server = s
      console.log(`[mcp] 本地 MCP Server 已启动：http://127.0.0.1:${port}/mcp`)
      resolve({ port, tools: TOOLS.map((t) => t.name) })
    })
  })
}

export function stopMcpServer(): void {
  if (!server) return
  server.close()
  server = null
  console.log('[mcp] 本地 MCP Server 已停止')
}
