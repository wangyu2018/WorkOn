/**
 * 小模型推理客户端 —— Python 常驻子进程（NDJSON over stdio）
 *
 * 协议：
 *   服务端加载完模型后输出  {"event":"ready"}
 *   请求：{"id":1,"features":{...9字段}}\n
 *   响应：{"id":1,"label":"code","prob":0.87}\n 或 {"id":1,"error":"..."}\n
 *
 * 可靠性：任何失败（未启动/超时/崩溃/坏行）一律 resolve(null)，
 * 由 decision 层无感降级到规则；崩溃自动重启，连续失败达上限后停用直到下次成功。
 */
import { spawn } from 'child_process'
import type { ChildProcessWithoutNullStreams } from 'child_process'
import { app } from 'electron'
import fs from 'fs'
import path from 'path'
import type { ActionFeatures, ModelPrediction } from './types'

const REQUEST_TIMEOUT_MS = 500 // 单条推理 ~10ms，留足 pandas 预处理余量
const READY_TIMEOUT_MS = 15_000 // 冷启动含 python+xgboost+pandas 导入
const RESTART_COOLDOWN_MS = 5_000
const MAX_CONSECUTIVE_FAILURES = 3

interface Pending {
  resolve: (p: ModelPrediction | null) => void
  timer: ReturnType<typeof setTimeout>
}

class PythonSidecarClient {
  private proc: ChildProcessWithoutNullStreams | null = null
  private pending = new Map<number, Pending>()
  private reqSeq = 0
  private ready = false
  private starting = false
  private consecutiveFailures = 0
  private lastExitAt = 0
  private buffer = ''

  /** 推理脚本与模型目录：dev 取项目根 ml/，打包环境取 resources */
  private resolveServerScript(): string | null {
    const candidates: string[] = []
    if (process.env.WORKON_PREDICT_SERVER) candidates.push(process.env.WORKON_PREDICT_SERVER)
    candidates.push(path.join(app.getAppPath(), 'ml', 'predict_server.py'))
    if (process.resourcesPath) candidates.push(path.join(process.resourcesPath, 'ml', 'predict_server.py'))
    for (const c of candidates) {
      try { if (fs.existsSync(c)) return c } catch { /* ignore */ }
    }
    return null
  }

  private resolveModelDir(): string | null {
    const candidates: string[] = []
    if (process.env.WORKON_MODEL_DIR) candidates.push(process.env.WORKON_MODEL_DIR)
    candidates.push(path.join(app.getAppPath(), 'ml', 'models'))
    if (process.resourcesPath) candidates.push(path.join(process.resourcesPath, 'ml', 'models'))
    for (const c of candidates) {
      try {
        if (fs.existsSync(path.join(c, 'action_model_v2.json'))) return c
      } catch { /* ignore */ }
    }
    return null
  }

  getStatus(): string {
    if (!this.proc) return this.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES ? 'disabled' : 'idle'
    return this.ready ? 'ready' : 'starting'
  }

  private failPending(reason: string): void {
    for (const [, p] of this.pending) {
      clearTimeout(p.timer)
      p.resolve(null)
    }
    this.pending.clear()
    if (reason) console.warn('[model]', reason)
  }

  private handleLine(line: string): void {
    const trimmed = line.trim()
    if (!trimmed) return
    let msg: Record<string, unknown>
    try {
      msg = JSON.parse(trimmed)
    } catch {
      console.warn('[model] 非 JSON 行已忽略:', trimmed.slice(0, 80))
      return
    }
    if (msg.event === 'ready') {
      this.ready = true
      this.consecutiveFailures = 0
      console.log('[model] python 推理服务就绪')
      return
    }
    const id = typeof msg.id === 'number' ? msg.id : -1
    const pending = this.pending.get(id)
    if (!pending) return
    this.pending.delete(id)
    clearTimeout(pending.timer)
    if (typeof msg.error === 'string') {
      console.warn('[model] 推理错误:', msg.error as string)
      pending.resolve(null)
      return
    }
    if (typeof msg.label === 'string' && typeof msg.prob === 'number') {
      pending.resolve({ label: msg.label, prob: msg.prob })
      return
    }
    pending.resolve(null)
  }

  private start(): void {
    const script = this.resolveServerScript()
    const modelDir = this.resolveModelDir()
    if (!script || !modelDir) {
      console.warn('[model] 找不到 predict_server.py 或模型目录，模型管道停用')
      this.consecutiveFailures = MAX_CONSECUTIVE_FAILURES
      return
    }
    const exe = process.env.WORKON_PYTHON || 'python'
    try {
      this.starting = true
      this.ready = false
      this.buffer = ''
      const proc = spawn(exe, [script, '--model-dir', modelDir], {
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true
      })
      try {
        const os = require('os') as typeof import('os')
        os.setPriority(proc.pid as number, os.constants.priority.PRIORITY_BELOW_NORMAL)
      } catch { /* ignore */ }
      this.proc = proc

      // 启动失败兜底：READY 超时视为本轮失败
      const readyTimer = setTimeout(() => {
        if (!this.ready) {
          this.failPending('python 推理服务 READY 超时')
          proc.kill()
        }
      }, READY_TIMEOUT_MS)

      proc.stdout.setEncoding('utf-8')
      proc.stdout.on('data', (chunk: string) => {
        this.buffer += chunk
        let idx: number
        while ((idx = this.buffer.indexOf('\n')) >= 0) {
          const line = this.buffer.slice(0, idx)
          this.buffer = this.buffer.slice(idx + 1)
          this.handleLine(line)
        }
      })
      proc.stderr.setEncoding('utf-8')
      proc.stderr.on('data', (d: string) => {
        const s = d.trim()
        if (s) console.warn('[model][py]', s.slice(0, 200))
      })
      proc.on('exit', (code) => {
        clearTimeout(readyTimer)
        this.lastExitAt = Date.now()
        this.ready = false
        this.proc = null
        this.starting = false
        this.consecutiveFailures++
        this.failPending(`python 推理服务退出 code=${code}`)
        if (this.consecutiveFailures < MAX_CONSECUTIVE_FAILURES) {
          setTimeout(() => { if (!this.proc && !this.starting) this.start() }, RESTART_COOLDOWN_MS)
        } else {
          console.warn('[model] 连续失败达上限，模型管道停用（本轮运行不再重试）')
        }
      })
    } catch (e) {
      this.starting = false
      this.proc = null
      this.consecutiveFailures++
      console.warn('[model] python 子进程启动失败:', e)
    }
  }

  async predict(features: ActionFeatures): Promise<ModelPrediction | null> {
    if (this.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES && !this.proc) return null
    if (!this.proc && !this.starting) {
      // 刚崩别立刻重启，等冷却
      if (Date.now() - this.lastExitAt < RESTART_COOLDOWN_MS) return null
      this.start()
    }
    const proc = this.proc
    if (!proc) return null

    const id = ++this.reqSeq
    return new Promise<ModelPrediction | null>((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        resolve(null) // 超时不杀进程：可能是冷启动仍载入中
      }, REQUEST_TIMEOUT_MS)
      this.pending.set(id, { resolve, timer })
      try {
        proc.stdin.write(JSON.stringify({ id, features }) + '\n')
      } catch (e) {
        this.pending.delete(id)
        clearTimeout(timer)
        resolve(null)
        console.warn('[model] 写入推理请求失败:', e)
      }
    })
  }

  dispose(): void {
    this.failPending('')
    if (this.proc) {
      try { this.proc.kill() } catch { /* ignore */ }
      this.proc = null
    }
  }
}

let client: PythonSidecarClient | null = null

export function getModelClient(): PythonSidecarClient {
  if (!client) client = new PythonSidecarClient()
  return client
}

export function disposeModelClient(): void {
  client?.dispose()
  client = null
}
