/**
 * Agent Hook 本地端口（Layer4）：AI 编程工具生命周期直报
 * - Claude Code / Codex 等支持生命周期 Hook 的工具：配置一条 hook 命令即可精确上报
 * - 例（Claude Code settings）：Stop hook → curl "http://127.0.0.1:18790/hook?tool=zcode&event=done"
 * - 仅监听 127.0.0.1，无鉴权无风险（只接受状态上报，不下发任何东西）
 */
import http from 'http'
import { markToolBusy, markToolDone } from './aiAssistWatch'

const PORT = 18790

export function startAgentHookServer(): void {
  const server = http.createServer((req, res) => {
    res.writeHead(204)
    res.end()
    try {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1')
      if (url.pathname !== '/hook') return
      const tool = url.searchParams.get('tool') ?? 'agent'
      const event = url.searchParams.get('event') ?? 'busy'
      if (event === 'busy' || event === 'start') markToolBusy(tool, url.searchParams.get('title') ?? undefined)
      else if (event === 'done' || event === 'stop') markToolDone(tool)
    } catch { /* 单次上报失败忽略 */ }
  })
  try {
    server.listen(PORT, '127.0.0.1', () => {
      console.log(`[agent-hook] 本地钩子端口就绪 127.0.0.1:${PORT}`)
    })
    server.on('error', () => { /* 端口占用等：静默降级（Layer1/2 仍在） */ })
  } catch { /* ignore */ }
}
