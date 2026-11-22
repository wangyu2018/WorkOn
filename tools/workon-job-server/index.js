#!/usr/bin/env node
/**
 * WorkOn 云作业服务器（P1）
 *
 * 部署在一台常驻 Ubuntu VPS 上，主动出站连接主端 WorkOn（不监听公网端口）。
 * 负责长任务的完整 Harness：模型循环、工具执行、断点恢复、事件回传。
 *
 * 用法：
 *   node index.js --server ws://<主端地址>:18792 --code 123456 \
 *     --model-base http://127.0.0.1:11434/v1 --model qwen3.5:4b \
 *     --workspace ~/workon-jobs
 *
 * 首次用配对码；token 保存在 ~/.workon-job-server.json。
 * 之后只需 --server（模型配置也会从同文件读）。
 */
'use strict'

const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawn } = require('child_process')

const TOKEN_FILE = path.join(os.homedir(), '.workon-job-server.json')
const STATE_DIR = path.join(os.homedir(), '.workon-jobs')
const STATE_FILE = path.join(STATE_DIR, 'state.json')
const EVENTS_FILE = path.join(STATE_DIR, 'events.jsonl')
const HEARTBEAT_MS = 10_000
const MAX_OUTPUT = 20_000
const DEFAULT_MAX_TURNS = 8

function parseArgs(argv) {
  const out = {
    server: '', code: '', token: '', label: '',
    workspace: path.join(os.homedir(), 'workon-jobs'),
    modelBase: process.env.WORKON_MODEL_BASE || '',
    model: process.env.WORKON_MODEL || '',
    modelKey: process.env.WORKON_MODEL_KEY || '',
    maxConcurrent: 1,
    docker: false,
    dockerImage: '',
    dockerNetwork: 'bridge',
    noShell: false,
    help: false
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--server') out.server = argv[++i] || ''
    else if (a === '--code') out.code = argv[++i] || ''
    else if (a === '--token') out.token = argv[++i] || ''
    else if (a === '--label') out.label = argv[++i] || ''
    else if (a === '--workspace') out.workspace = argv[++i] || out.workspace
    else if (a === '--model-base') out.modelBase = argv[++i] || ''
    else if (a === '--model') out.model = argv[++i] || ''
    else if (a === '--model-key') out.modelKey = argv[++i] || ''
    else if (a === '--max-concurrent') out.maxConcurrent = Math.max(1, Number(argv[++i]) || 1)
    else if (a === '--docker') out.docker = true
    else if (a === '--docker-image') out.dockerImage = argv[++i] || ''
    else if (a === '--docker-network') out.dockerNetwork = argv[++i] || 'bridge'
    else if (a === '--no-shell') out.noShell = true
    else if (a === '--help' || a === '-h') out.help = true
  }
  return out
}

function printHelp() {
  console.log(`WorkOn 云作业服务器

  node index.js --server ws://<主端地址>:18792 --code <6位配对码> [选项]

  --server           主端节点地址（设置 → 外部节点 里显示）
  --code             一次性配对码（5 分钟有效）
  --label            节点显示名，缺省主机名
  --workspace        作业工作区根目录，缺省 ~/workon-jobs
  --model-base       OpenAI 兼容地址，如 http://127.0.0.1:11434/v1
  --model            模型名，如 qwen3.5:4b
  --model-key        模型 Key（本机 Ollama 可留空）
  --max-concurrent   同时执行的作业数，缺省 1（低资源）
  --docker           用 Docker 跑 shell（推荐，需本机安装 docker）
  --docker-image     例如 node:22-bookworm-slim
  --docker-network   Docker 网络，缺省 bridge；隔离用 none
  --no-shell         禁用 shell 工具（只跑模型/HTTP/等待）
`)
}

function loadConfig() {
  try {
    return JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8')) || {}
  } catch {
    return {}
  }
}

function saveConfig(patch) {
  try {
    const cur = loadConfig()
    fs.writeFileSync(TOKEN_FILE, JSON.stringify({ ...cur, ...patch }, null, 2), { mode: 0o600 })
  } catch (e) {
    console.warn('[job-server] 配置保存失败：', e.message)
  }
}

function resolveWebSocket() {
  if (typeof globalThis.WebSocket === 'function') return globalThis.WebSocket
  try {
    return require('ws')
  } catch {
    console.error('[job-server] 当前 Node 没有内置 WebSocket，请先执行：npm i ws')
    process.exit(1)
  }
}

function wsOn(ws, name, cb) {
  if (typeof ws.addEventListener === 'function') ws.addEventListener(name, cb)
  else ws.on(name, cb)
}

function wsSend(ws, obj) {
  try {
    if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj))
  } catch {
    /* 断线由 close 处理 */
  }
}

const args0 = parseArgs(process.argv.slice(2))
if (args0.help || !args0.server) {
  printHelp()
  process.exit(args0.help ? 0 : 1)
}

const cfg = loadConfig()
const CONFIG = {
  ...args0,
  token: args0.token || cfg.token || '',
  modelBase: args0.modelBase || cfg.modelBase || '',
  model: args0.model || cfg.model || '',
  modelKey: args0.modelKey || cfg.modelKey || '',
  maxConcurrent: args0.maxConcurrent || cfg.maxConcurrent || 1,
  docker: args0.docker || !!cfg.docker,
  dockerImage: args0.dockerImage || cfg.dockerImage || '',
  dockerNetwork: args0.dockerNetwork || cfg.dockerNetwork || 'bridge',
  noShell: args0.noShell || !!cfg.noShell
}
const WORKSPACE = path.resolve(CONFIG.workspace)
fs.mkdirSync(WORKSPACE, { recursive: true })
fs.mkdirSync(STATE_DIR, { recursive: true })

const state = loadState()
const queue = []
const active = new Set()
const controllers = new Map()
const children = new Map()
let ws = null
let heartbeat = null
let backoff = 3000
let persistTimer = null

function loadState() {
  try {
    const raw = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'))
    return { jobs: raw.jobs && typeof raw.jobs === 'object' ? raw.jobs : {} }
  } catch {
    return { jobs: {} }
  }
}

function persistNow() {
  if (persistTimer) {
    clearTimeout(persistTimer)
    persistTimer = null
  }
  try {
    const tmp = `${STATE_FILE}.tmp`
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf8')
    fs.renameSync(tmp, STATE_FILE)
  } catch (e) {
    console.warn('[job-server] 状态写入失败：', e.message)
  }
}

function persistSoon() {
  if (persistTimer) return
  persistTimer = setTimeout(persistNow, 200)
}

function appendEvent(ev) {
  try {
    fs.appendFileSync(EVENTS_FILE, `${JSON.stringify(ev)}\n`, 'utf8')
  } catch {
    /* 审计日志失败不阻断执行 */
  }
}

function cap(text) {
  const s = String(text ?? '')
  return s.length > MAX_OUTPUT ? `${s.slice(0, MAX_OUTPUT)}\n…（已截断）` : s
}

function nowIso() {
  return new Date().toISOString()
}

function send(obj) {
  wsSend(ws, obj)
}

function emit(job, type, data) {
  job.seq = (job.seq || 0) + 1
  job.updatedAt = Date.now()
  const event = { type, ts: job.updatedAt, data: data || {} }
  appendEvent({ seq: job.seq, jobId: job.id, ...event })
  send({ type: 'job.event', jobId: job.id, seq: job.seq, event })
  persistSoon()
}

function snapshot() {
  const jobs = Object.values(state.jobs)
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
    .slice(0, 50)
    .map((j) => ({
      id: j.id,
      state: j.state,
      seq: j.seq || 0,
      result: j.result || '',
      error: j.error || '',
      stepStates: j.stepStates || {},
      updatedAt: j.updatedAt || 0
    }))
  return { type: 'job.snapshot', jobs }
}

function safePath(p) {
  const abs = path.resolve(WORKSPACE, String(p || '.'))
  if (abs !== WORKSPACE && !abs.startsWith(WORKSPACE + path.sep)) {
    throw new Error(`路径越界：${p}`)
  }
  return abs
}

function jobWorkspace(jobId) {
  const dir = path.join(WORKSPACE, 'jobs', jobId)
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

function orderSteps(job) {
  const steps = Array.isArray(job.plan?.steps) ? job.plan.steps : []
  const byId = new Map(steps.map((s) => [s.id, s]))
  const done = new Set()
  const out = []
  let guard = 0
  while (out.length < steps.length && guard++ < steps.length * 4) {
    for (const step of steps) {
      if (done.has(step.id)) continue
      const deps = Array.isArray(step.dependsOn) ? step.dependsOn : []
      if (deps.every((d) => done.has(d) || !byId.has(d))) {
        out.push(step)
        done.add(step.id)
      }
    }
  }
  for (const step of steps) if (!done.has(step.id)) out.push(step)
  return out
}

function depsFailed(job, step) {
  for (const dep of step.dependsOn || []) {
    const st = job.stepStates?.[dep]
    if (st?.status === 'failed') return `依赖步骤失败：${dep}`
    if (st?.status === 'skipped') return `依赖步骤跳过：${dep}`
  }
  return null
}

/* ---------------- 模型 ---------------- */

function modelBase() {
  return String(CONFIG.modelBase || '').replace(/\/$/, '')
}

async function callModel(messages, tools, signal) {
  const base = modelBase()
  const model = String(CONFIG.model || '')
  if (!base || !model) throw new Error('云作业服务器未配置模型：--model-base / --model')
  const body = {
    model,
    messages,
    temperature: 0.2,
    stream: false
  }
  if (tools && tools.length) {
    body.tools = tools
    body.tool_choice = 'auto'
  }
  const headers = { 'Content-Type': 'application/json' }
  if (CONFIG.modelKey) headers.Authorization = `Bearer ${CONFIG.modelKey}`
  const res = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`模型 HTTP ${res.status}：${text.slice(0, 600)}`)
  const data = JSON.parse(text)
  const msg = data?.choices?.[0]?.message || {}
  const usage = Number(data?.usage?.total_tokens) || 0
  return {
    content: typeof msg.content === 'string' ? msg.content : '',
    toolCalls: Array.isArray(msg.tool_calls) ? msg.tool_calls : [],
    message: msg,
    usage
  }
}

const TOOL_DEFS = [
  {
    type: 'function',
    function: {
      name: 'shell',
      description: '在工作目录内执行一条 shell 命令，返回 stdout/stderr。',
      parameters: {
        type: 'object',
        properties: { command: { type: 'string', description: '要执行的命令' } },
        required: ['command']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'fs.read',
      description: '读取工作目录内的文本文件。',
      parameters: {
        type: 'object',
        properties: { path: { type: 'string' } },
        required: ['path']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'fs.write',
      description: '写入工作目录内的文件（会覆盖）。',
      parameters: {
        type: 'object',
        properties: { path: { type: 'string' }, content: { type: 'string' } },
        required: ['path', 'content']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'http.fetch',
      description: '发起一次 HTTP 请求，返回状态码与响应文本。',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string' },
          method: { type: 'string', enum: ['GET', 'POST', 'PUT', 'DELETE'] },
          body: { type: 'string' }
        },
        required: ['url']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'finish',
      description: '任务完成时调用，交付最终结果。',
      parameters: {
        type: 'object',
        properties: { result: { type: 'string', description: '可核验的结果摘要' } },
        required: ['result']
      }
    }
  }
]

/* ---------------- 工具执行 ---------------- */

async function runShell(job, command, cwd, signal, timeoutMs) {
  if (CONFIG.noShell) throw new Error('该作业服务器已禁用 shell（--no-shell）')
  const cmd = String(command || '').trim()
  if (!cmd) throw new Error('命令为空')
  const useDocker = CONFIG.docker && CONFIG.dockerImage
  const child = useDocker
    ? spawn('docker', [
        'run', '--rm',
        '--cpus', '1',
        '--memory', '512m',
        '--network', CONFIG.dockerNetwork,
        '-v', `${cwd}:/work`,
        '-w', '/work',
        CONFIG.dockerImage,
        'bash', '-lc', cmd
      ], { stdio: ['ignore', 'pipe', 'pipe'] })
    : spawn('/bin/bash', ['-lc', cmd], {
        cwd,
        env: {
          PATH: process.env.PATH || '/usr/local/bin:/usr/bin:/bin',
          HOME: cwd,
          LANG: process.env.LANG || 'en_US.UTF-8'
        }
      })
  children.set(job.id, child)
  const limit = Math.max(1000, Number(timeoutMs) || 120_000)
  return await new Promise((resolve, reject) => {
    let out = ''
    let err = ''
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      try { child.kill('SIGKILL') } catch { /* ignore */ }
      reject(new Error(`命令超时（${limit}ms）`))
    }, limit)
    const onAbort = () => {
      try { child.kill('SIGKILL') } catch { /* ignore */ }
      if (!settled) {
        settled = true
        clearTimeout(timer)
        reject(new Error('作业已取消'))
      }
    }
    if (signal) signal.addEventListener('abort', onAbort)
    child.stdout?.on('data', (b) => { out = cap(out + b.toString('utf8')) })
    child.stderr?.on('data', (b) => { err = cap(err + b.toString('utf8')) })
    child.on('error', (e) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      children.delete(job.id)
      reject(e)
    })
    child.on('close', (code) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      children.delete(job.id)
      if (signal) signal.removeEventListener('abort', onAbort)
      if (code === 0) resolve(out.trim() || '（命令无输出）')
      else reject(new Error(`命令退出码 ${code}${err ? `：${err.slice(0, 800)}` : ''}`))
    })
  })
}

async function runHttp(args, signal) {
  const controller = new AbortController()
  const onAbort = () => controller.abort()
  if (signal) signal.addEventListener('abort', onAbort)
  const timer = setTimeout(() => controller.abort(), 60_000)
  try {
    const res = await fetch(String(args.url || ''), {
      method: args.method || 'GET',
      body: args.body,
      signal: controller.signal
    })
    const text = cap(await res.text())
    return `HTTP ${res.status}\n${text}`
  } finally {
    clearTimeout(timer)
    if (signal) signal.removeEventListener('abort', onAbort)
  }
}

async function execTool(job, name, rawArgs, cwd, signal) {
  let args = {}
  try {
    args = typeof rawArgs === 'string' ? JSON.parse(rawArgs || '{}') : (rawArgs || {})
  } catch {
    return `参数不是合法 JSON：${String(rawArgs).slice(0, 300)}`
  }
  if (name === 'shell') return await runShell(job, args.command, cwd, signal, 180_000)
  if (name === 'fs.read') {
    const p = safePath(args.path)
    const st = fs.statSync(p)
    if (!st.isFile()) throw new Error('不是文件')
    if (st.size > 512 * 1024) throw new Error('文件过大（>512KB）')
    return cap(fs.readFileSync(p, 'utf8'))
  }
  if (name === 'fs.write') {
    const p = safePath(args.path)
    fs.mkdirSync(path.dirname(p), { recursive: true })
    fs.writeFileSync(p, String(args.content ?? ''), 'utf8')
    return `已写入 ${path.relative(WORKSPACE, p)}（${String(args.content ?? '').length} 字符）`
  }
  if (name === 'http.fetch') return await runHttp(args, signal)
  if (name === 'finish') return String(args.result ?? '')
  throw new Error(`未知工具：${name}`)
}

/* ---------------- Agent Harness ---------------- */

async function runAgentStep(job, step, cwd, signal) {
  const st = job.stepStates[step.id] || { status: 'running' }
  const maxTurns = Math.max(1, Math.min(24, Number(step.maxTurns) || DEFAULT_MAX_TURNS))
  let turns = Number(st.turns) || 0
  let tokens = Number(st.tokens) || 0
  const messages = Array.isArray(st.messages) && st.messages.length
    ? st.messages
    : [
        {
          role: 'system',
          content:
            `你是 WorkOn 云作业服务器上的执行 Agent。\n` +
            `目标：${step.goal || job.goal}\n` +
            `工作目录：${cwd}\n` +
            `规则：只在该目录读写；先观察再行动；命令输出可能被截断；完成后必须调用 finish 交付可核验结果。`
        },
        {
          role: 'user',
          content: String(step.goal || job.goal || '完成这个任务，并给出结果。')
        }
      ]
  const enabled = new Set(Array.isArray(step.tools) && step.tools.length ? step.tools : ['shell', 'fs.read', 'fs.write', 'http.fetch', 'finish'])
  const tools = TOOL_DEFS.filter((t) => enabled.has(t.function.name))
  while (turns < maxTurns) {
    if (signal?.aborted) throw new Error('作业已取消')
    const r = await callModel(messages, tools, signal)
    turns++
    tokens += r.usage
    messages.push(r.message)
    st.messages = messages
    st.turns = turns
    st.tokens = tokens
    job.stepStates[step.id] = { ...st, status: 'running' }
    persistSoon()
    emit(job, 'log', { stepId: step.id, turn: turns, text: cap(r.content || `调用工具 ${r.toolCalls.map((t) => t.function?.name).join(', ')}`) })
    if (job.policy?.budgetTokens > 0 && tokens > job.policy.budgetTokens) {
      throw new Error(`Token 预算用尽（${tokens}/${job.policy.budgetTokens}）`)
    }
    if (!r.toolCalls.length) {
      return r.content || '（Agent 未给出最终结果）'
    }
    for (const call of r.toolCalls) {
      const name = call.function?.name || ''
      const result = await execTool(job, name, call.function?.arguments, cwd, signal)
      messages.push({ role: 'tool', tool_call_id: call.id, content: cap(result) })
      emit(job, 'log', { stepId: step.id, turn: turns, tool: name, output: cap(result).slice(0, 800) })
      if (name === 'finish') return result
    }
  }
  throw new Error(`Agent 达到最大轮次（${maxTurns}）`)
}

/* ---------------- 作业执行 ---------------- */

class WaitSignal extends Error {
  constructor(wakeAt) {
    super('wait')
    this.wakeAt = wakeAt
  }
}

async function runStep(job, step, cwd, signal) {
  if (step.kind === 'agent') return await runAgentStep(job, step, cwd, signal)
  if (step.kind === 'model') {
    const messages = [
      ...(step.system ? [{ role: 'system', content: String(step.system) }] : []),
      { role: 'user', content: String(step.prompt || job.goal) }
    ]
    const r = await callModel(messages, [], signal)
    return r.content || '（模型无输出）'
  }
  if (step.kind === 'shell') return await runShell(job, step.command, step.cwd ? safePath(path.join('jobs', job.id, step.cwd)) : cwd, signal, step.timeoutMs)
  if (step.kind === 'http') {
    const r = await runHttp({ url: step.url, method: step.method, body: step.body }, signal)
    return r
  }
  if (step.kind === 'notify') {
    emit(job, 'notify', { text: String(step.text || '') })
    return String(step.text || '')
  }
  if (step.kind === 'wait') {
    const saved = job.stepStates?.[step.id]?.wakeAt
    const wakeAt = Number(saved) || Number(step.until) || Date.now() + Math.max(1000, Number(step.delayMs) || 60_000)
    if (wakeAt > Date.now()) throw new WaitSignal(wakeAt)
    return '已到时间'
  }
  throw new Error(`不支持的步骤：${step.kind}`)
}

function scheduleWake(job) {
  const delay = Math.max(1000, (job.wakeAt || Date.now()) - Date.now())
  setTimeout(() => {
    if (job.state !== 'waiting') return
    job.state = 'queued'
    job.wakeAt = undefined
    emit(job, 'state', { state: 'queued' })
    enqueue(job.id)
  }, Math.min(delay, 24 * 60 * 60 * 1000))
}

async function runJob(job) {
  if (!job || job.state === 'canceled' || job.state === 'succeeded') return
  if (active.has(job.id)) return
  active.add(job.id)
  controllers.set(job.id, new AbortController())
  const signal = controllers.get(job.id).signal
  job.attempts = (job.attempts || 0) + 1
  job.state = 'running'
  job.startedAt = job.startedAt || Date.now()
  job.error = ''
  emit(job, 'state', { state: 'running', attempt: job.attempts })
  try {
    const cwd = jobWorkspace(job.id)
    const steps = orderSteps(job)
    let last = ''
    for (const step of steps) {
      if (signal.aborted) throw new Error('作业已取消')
      const st = job.stepStates[step.id] || { status: 'pending' }
      if (st.status === 'succeeded') {
        last = st.output || last
        continue
      }
      const failedDep = depsFailed(job, step)
      if (failedDep) {
        job.stepStates[step.id] = { status: 'skipped', error: failedDep }
        emit(job, 'step', { stepId: step.id, status: 'skipped', error: failedDep })
        continue
      }
      job.stepStates[step.id] = { ...st, status: 'running', startedAt: Date.now() }
      emit(job, 'step', { stepId: step.id, status: 'running', title: step.title, kind: step.kind })
      try {
        const out = await runStep(job, step, cwd, signal)
        last = out
        job.stepStates[step.id] = { ...job.stepStates[step.id], status: 'succeeded', output: cap(out).slice(0, 8000), endedAt: Date.now(), wakeAt: undefined }
        emit(job, 'step', { stepId: step.id, status: 'succeeded', output: cap(out).slice(0, 1500) })
      } catch (e) {
        if (e instanceof WaitSignal) {
          job.stepStates[step.id] = { ...job.stepStates[step.id], status: 'running', wakeAt: e.wakeAt }
          job.state = 'waiting'
          job.wakeAt = e.wakeAt
          emit(job, 'state', { state: 'waiting', wakeAt: e.wakeAt })
          persistNow()
          scheduleWake(job)
          return
        }
        throw e
      }
    }
    job.state = 'succeeded'
    job.endedAt = Date.now()
    job.result = cap(last).slice(0, 8000)
    emit(job, 'state', { state: 'succeeded' })
    emit(job, 'done', { state: 'succeeded', result: cap(last).slice(0, 2000) })
    persistNow()
  } catch (e) {
    const msg = (e && e.message) || '执行失败'
    if (job.state === 'canceled') return
    const maxAttempts = Math.max(1, Number(job.policy?.maxAttempts) || 3)
    const willRetry = (job.attempts || 0) < maxAttempts
    job.error = msg
    job.state = willRetry ? 'queued' : 'failed'
    job.endedAt = willRetry ? undefined : Date.now()
    emit(job, 'error', { error: msg, willRetry })
    if (!willRetry) emit(job, 'state', { state: 'failed' })
    if (willRetry) {
      const delay = Math.min(300_000, 15_000 * (job.attempts || 1))
      setTimeout(() => {
        if (job.state === 'queued') enqueue(job.id)
      }, delay)
    }
    persistNow()
  } finally {
    active.delete(job.id)
    controllers.delete(job.id)
    pump()
  }
}

function enqueue(jobId) {
  if (!jobId || queue.includes(jobId)) return
  const job = state.jobs[jobId]
  if (!job || job.state === 'canceled' || job.state === 'succeeded' || job.state === 'failed') return
  if (job.state === 'waiting') {
    if ((job.wakeAt || 0) > Date.now()) {
      scheduleWake(job)
      return
    }
    job.state = 'queued'
  }
  queue.push(jobId)
  pump()
}

function pump() {
  while (active.size < CONFIG.maxConcurrent && queue.length) {
    const id = queue.shift()
    const job = state.jobs[id]
    if (!job || job.state === 'canceled' || job.state === 'succeeded') continue
    void runJob(job)
  }
}

/* ---------------- 连接与协议 ---------------- */

function handleOffer(msg) {
  const raw = msg.job || {}
  if (!raw.id || !Array.isArray(raw.plan?.steps)) {
    send({ type: 'job.result', jobId: raw.id || '', state: 'failed', error: '作业格式不合法' })
    return
  }
  const existing = state.jobs[raw.id]
  if (existing && (existing.state === 'running' || existing.state === 'queued' || existing.state === 'waiting' || existing.state === 'succeeded')) {
    send({ type: 'job.accepted', offerId: msg.offerId, jobId: raw.id, duplicate: true })
    send(snapshot())
    return
  }
  const job = {
    id: raw.id,
    commitmentId: raw.commitmentId || '',
    title: raw.title || '未命名作业',
    goal: raw.goal || '',
    plan: raw.plan,
    policy: raw.policy || {},
    state: 'queued',
    attempts: 0,
    stepStates: {},
    seq: existing?.seq || 0,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    result: '',
    error: ''
  }
  for (const step of raw.plan.steps) job.stepStates[step.id] = { status: 'pending' }
  state.jobs[job.id] = job
  persistNow()
  send({ type: 'job.accepted', offerId: msg.offerId, jobId: job.id })
  emit(job, 'state', { state: 'queued' })
  enqueue(job.id)
}

function handleCancel(msg) {
  const job = state.jobs[String(msg.jobId || '')]
  if (!job) return
  const ctrl = controllers.get(job.id)
  if (ctrl) ctrl.abort()
  const child = children.get(job.id)
  if (child) {
    try { child.kill('SIGKILL') } catch { /* ignore */ }
  }
  job.state = 'canceled'
  job.endedAt = Date.now()
  emit(job, 'state', { state: 'canceled' })
  emit(job, 'done', { state: 'canceled', result: job.result || '' })
  persistNow()
}

function connect() {
  const WS = resolveWebSocket()
  ws = new WS(CONFIG.server)
  wsOn(ws, 'open', () => {
    console.log(`[job-server] 已连接 ${CONFIG.server}`)
    const fingerprint = {
      hostname: os.hostname(),
      platform: process.platform,
      arch: process.arch,
      label: CONFIG.label || os.hostname(),
      capabilities: ['job.run', 'harness.v1']
    }
    if (CONFIG.token) send({ type: 'auth', token: CONFIG.token, fingerprint })
    else if (CONFIG.code) send({ type: 'pair', code: CONFIG.code, fingerprint })
    else {
      console.error('[job-server] 缺少配对码：首次接入请加 --code')
      ws.close()
    }
  })

  wsOn(ws, 'message', (ev) => {
    let msg
    try {
      const data = ev && ev.data !== undefined ? ev.data : ev
      msg = JSON.parse(typeof data === 'string' ? data : String(data))
    } catch {
      return
    }
    if (msg.type === 'paired' && msg.token) {
      CONFIG.token = msg.token
      saveConfig({ token: msg.token })
      console.log(`[job-server] 配对成功，nodeId=${msg.nodeId}`)
    } else if (msg.type === 'ready') {
      backoff = 3000
      console.log(`[job-server] 主端已确认，授权=${msg.authLevel}`)
      clearInterval(heartbeat)
      heartbeat = setInterval(() => send({ type: 'heartbeat', ts: Date.now() }), HEARTBEAT_MS)
      send({ type: 'capabilities', capabilities: ['job.run', 'harness.v1'] })
      send(snapshot())
      // 重连后把排队中的作业重新拉起
      for (const job of Object.values(state.jobs)) {
        if (job.state === 'queued') enqueue(job.id)
        else if (job.state === 'waiting') scheduleWake(job)
      }
    } else if (msg.type === 'job.offer') {
      handleOffer(msg)
    } else if (msg.type === 'job.cancel') {
      handleCancel(msg)
    } else if (msg.type === 'job.sync') {
      send(snapshot())
    } else if (msg.type === 'error') {
      console.warn(`[job-server] 主端拒绝：${msg.error}`)
      if (String(msg.error || '').includes('token')) {
        console.warn('[job-server] token 已失效，请用新的配对码重新接入')
        try { fs.unlinkSync(TOKEN_FILE) } catch { /* ignore */ }
        CONFIG.token = ''
      }
    }
  })

  wsOn(ws, 'close', () => {
    clearInterval(heartbeat)
    heartbeat = null
    console.log(`[job-server] 连接断开，${Math.round(backoff / 1000)}s 后重连…`)
    setTimeout(connect, backoff)
    backoff = Math.min(backoff * 2, 30_000)
  })

  wsOn(ws, 'error', () => {
    /* close 统一处理重连 */
  })
}

/** 启动时恢复：running/leased 视为中断，重新排队；waiting 重新定时 */
function recover() {
  for (const job of Object.values(state.jobs)) {
    if (job.state === 'running' || job.state === 'leased') {
      job.state = 'queued'
      job.error = job.error || '进程重启，已重新排队'
      emit(job, 'state', { state: 'queued', recovered: true })
    }
    if (job.state === 'queued') enqueue(job.id)
    if (job.state === 'waiting') {
      if ((job.wakeAt || 0) <= Date.now()) {
        job.state = 'queued'
        enqueue(job.id)
      } else {
        scheduleWake(job)
      }
    }
  }
}

process.on('SIGINT', () => {
  persistNow()
  process.exit(0)
})
process.on('SIGTERM', () => {
  persistNow()
  process.exit(0)
})

console.log(`[job-server] 工作区 ${WORKSPACE}`)
console.log(`[job-server] 模型 ${CONFIG.model || '(未配置)'} @ ${CONFIG.modelBase || '(未配置)'}`)
console.log(`[job-server] 并发 ${CONFIG.maxConcurrent} · Docker ${CONFIG.docker ? CONFIG.dockerImage : 'off'} · shell ${CONFIG.noShell ? 'off' : 'on'}`)
recover()
connect()
