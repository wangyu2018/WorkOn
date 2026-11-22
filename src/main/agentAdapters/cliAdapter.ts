/**
 * CLI / ACP 适配器：以子进程运行本机 Agent，把 stdout 流式翻译成 AgentEvent
 */
import { spawn } from 'child_process'
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
import { HOME, capture, commandFor, executable, exists, fillTemplate, safeCwd, stdioHandshake } from './runtime'

const CLI_CAPS: AgentCapabilityFlags = {
  dispatch: true,
  streaming: true,
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

function createAdapter(protocol: 'cli' | 'acp'): AgentAdapter {
  const isAcp = protocol === 'acp'
  return {
    descriptor: {
      id: protocol,
      protocol,
      label: isAcp ? 'ACP' : '本机 CLI',
      description: isAcp
        ? '以子进程握手并派发任务；当前复用 CLI 参数模板'
        : '以子进程运行本机 CLI，按参数模板派发任务',
      capabilities: CLI_CAPS,
      requirements: isAcp
        ? ['目标程序支持 ACP 握手', '已配置派发参数（如 --prompt {prompt}）']
        : ['在本机安装对应 CLI', '需要登录时先完成登录']
    },

    async probe(connector: AgentConnector): Promise<AgentProbeResult> {
      if (isAcp) return stdioHandshake(connector)
      const started = Date.now()
      if (!exists(connector.endpoint)) {
        return { ok: false, status: 'unavailable', detail: `文件不存在：${connector.endpoint}` }
      }
      if (!executable(connector.endpoint) && !/\.(cjs|mjs|js)$/i.test(connector.endpoint)) {
        return { ok: false, status: 'error', detail: `不可执行：${connector.endpoint}` }
      }
      const args = connector.args.length ? connector.args : ['--version']
      const { cmd, args: fullArgs, env: extraEnv } = commandFor(connector, args)
      const text = await capture(cmd, fullArgs, connector.cwd || HOME, { ...connector.env, ...extraEnv }, 10_000)
      const version = text.ok ? text.output.split('\n')[0]?.slice(0, 60) : undefined
      return {
        ok: text.ok,
        status: text.ok ? 'online' : 'error',
        detail: text.ok ? `CLI 可用${version ? ` · ${version}` : ''}` : `CLI 探测失败：${text.error ?? '未知错误'}`,
        version,
        latencyMs: Date.now() - started
      }
    },

    capabilities(connector: AgentConnector): AgentCapabilityFlags {
      return { ...CLI_CAPS, dispatch: connector.dispatchArgs.length > 0 }
    },

    async start(connector: AgentConnector, req: AgentRunRequest): Promise<AgentRunHandle> {
      if (!connector.dispatchArgs.length) {
        throw new Error('未配置派发参数（如 --prompt {prompt}）')
      }
      const prompt = req.prompt.trim()
      if (!prompt) throw new Error('任务内容为空')
      const cwd = safeCwd(req.cwd || connector.cwd)
      const args = connector.dispatchArgs.map((a) => fillTemplate(a, prompt, cwd, connector.name))
      const { cmd, args: fullArgs, env: extraEnv } = commandFor(connector, args)

      const runId = genId('run')
      const queue = new AgentEventQueue()
      const startedAt = Date.now()
      const timeoutMs = req.timeoutMs ?? 180_000
      let timer: NodeJS.Timeout
      let settled = false
      let cancelled = false
      let output = ''
      let stderr = ''

      const child = spawn(cmd, fullArgs, {
        cwd,
        env: { ...process.env, ...connector.env, ...extraEnv },
        stdio: ['ignore', 'pipe', 'pipe']
      })

      const finish = (event: AgentEvent): void => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        queue.push(event)
        queue.close()
      }

      timer = setTimeout(() => {
        try { child.kill('SIGTERM') } catch { /* ignore */ }
        finish({
          type: 'run_error',
          runId,
          code: 'timeout',
          error: `执行超时（${Math.round(timeoutMs / 1000)}s）`,
          at: Date.now()
        })
      }, timeoutMs)

      queue.push({ type: 'run_started', runId, at: startedAt })

      child.stdout.on('data', (d) => {
        const text = String(d)
        if (output.length < 100_000) output += text
        if (!settled) queue.push({ type: 'text_delta', runId, text, at: Date.now() })
      })
      child.stderr.on('data', (d) => {
        if (stderr.length < 50_000) stderr += String(d)
      })
      child.on('error', (e) => {
        finish({ type: 'run_error', runId, code: 'runtime_error', error: e.message, at: Date.now() })
      })
      child.on('close', (code) => {
        if (settled) return
        if (cancelled) {
          finish({ type: 'run_cancelled', runId, at: Date.now() })
          return
        }
        const text = output.trim().slice(0, 20_000)
        if (code === 0) {
          finish({ type: 'run_done', runId, output: text, at: Date.now() })
        } else {
          finish({
            type: 'run_error',
            runId,
            code: 'runtime_error',
            error: stderr.trim() || `退出码 ${code}`,
            at: Date.now()
          })
        }
      })

      return {
        runId,
        events: queue,
        cancel: async () => {
          if (settled) return
          cancelled = true
          try { child.kill('SIGTERM') } catch { /* ignore */ }
        }
      }
    }
  }
}

export function createCliAdapter(_ctx: AgentAdapterContext, protocol: 'cli' | 'acp'): AgentAdapter {
  return createAdapter(protocol)
}
