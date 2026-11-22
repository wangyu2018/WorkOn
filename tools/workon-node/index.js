#!/usr/bin/env node
/**
 * WorkOn 节点（P0 只读）
 *
 * 外部电脑作为执行端，出站连接主端 WorkOn，不监听任何端口。
 * 支持能力：sys.info / fs.list / fs.read（只读，文件操作限白名单根目录）。
 *
 * 用法：
 *   node tools/workon-node/index.js --server ws://192.168.1.10:18792 --code 123456
 *   node tools/workon-node/index.js --server ws://127.0.0.1:18792 --root D:\work --root D:\docs
 *
 * 首次用配对码，成功后 token 保存在 ~/.workon-node.json，之后只需 --server。
 * Node >= 22 自带 WebSocket；更早版本请在本目录 npm i ws。
 */
'use strict'

const fs = require('fs')
const os = require('os')
const path = require('path')

const TOKEN_FILE = path.join(os.homedir(), '.workon-node.json')
const HEARTBEAT_MS = 10_000
const MAX_READ_BYTES = 256 * 1024

function parseArgs(argv) {
  const out = { roots: [], server: '', code: '', token: '', label: '' }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--server') out.server = argv[++i] || ''
    else if (a === '--code') out.code = argv[++i] || ''
    else if (a === '--token') out.token = argv[++i] || ''
    else if (a === '--label') out.label = argv[++i] || ''
    else if (a === '--root') out.roots.push(argv[++i] || '')
    else if (a === '--help' || a === '-h') out.help = true
  }
  return out
}

function printHelp() {
  console.log(`WorkOn 节点（只读）

  node index.js --server ws://<主端地址>:18792 --code <6位配对码> [--root <目录>]... [--label <名字>]

  --server  主端节点地址（主端「设置 → 外部节点」里会显示）
  --code    一次性配对码（5 分钟有效；配对成功后写入 ~/.workon-node.json）
  --root    允许读取的根目录，可重复；缺省为用户主目录
  --label   节点显示名，缺省为主机名
  --token   手动指定 token（一般不用）
`)
}

function loadToken() {
  try {
    return JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf-8')).token || ''
  } catch {
    return ''
  }
}

function saveToken(token) {
  try {
    fs.writeFileSync(TOKEN_FILE, JSON.stringify({ token }), { mode: 0o600 })
  } catch (e) {
    console.warn('[node] token 保存失败：', e.message)
  }
}

function resolveWebSocket() {
  if (typeof globalThis.WebSocket === 'function') return globalThis.WebSocket
  try {
    return require('ws')
  } catch {
    console.error('[node] 当前 Node 没有内置 WebSocket，请先执行：npm i ws')
    process.exit(1)
  }
}

function insideRoots(p, roots) {
  return roots.some((root) => p === root || p.startsWith(root.endsWith(path.sep) ? root : root + path.sep))
}

function handleRequest(req, roots) {
  const started = Date.now()
  const action = String(req.action || '')
  const args = req.args || {}
  try {
    if (action === 'sys.info') {
      return {
        ok: true,
        result: {
          hostname: os.hostname(),
          platform: process.platform,
          arch: process.arch,
          node: process.version,
          home: os.homedir(),
          roots
        },
        ms: Date.now() - started
      }
    }
    if (action === 'fs.list') {
      const target = path.resolve(String(args.path || roots[0]))
      if (!insideRoots(target, roots)) throw new Error(`路径不在白名单内：${target}`)
      const entries = fs.readdirSync(target, { withFileTypes: true }).slice(0, 500).map((d) => {
        const full = path.join(target, d.name)
        let size = 0
        let mtime = 0
        try {
          const st = fs.statSync(full)
          size = st.size
          mtime = st.mtimeMs
        } catch {
          /* 权限不足的条目仍返回名称 */
        }
        return { name: d.name, dir: d.isDirectory(), size, mtime: Math.round(mtime) }
      })
      return { ok: true, result: { path: target, entries }, ms: Date.now() - started }
    }
    if (action === 'fs.read') {
      const target = path.resolve(String(args.path || ''))
      if (!insideRoots(target, roots)) throw new Error(`路径不在白名单内：${target}`)
      const st = fs.statSync(target)
      if (!st.isFile()) throw new Error('不是文件')
      if (st.size > MAX_READ_BYTES) throw new Error(`文件过大（>${MAX_READ_BYTES} 字节）`)
      return { ok: true, result: { path: target, text: fs.readFileSync(target, 'utf-8') }, ms: Date.now() - started }
    }
    throw new Error(`不支持的能力：${action}`)
  } catch (e) {
    return { ok: false, error: e.message, ms: Date.now() - started }
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help || !args.server) {
    printHelp()
    process.exit(args.help ? 0 : 1)
  }
  const roots = (args.roots.length ? args.roots : [os.homedir()]).map((r) => path.resolve(r))
  const label = args.label || os.hostname()
  const WebSocketImpl = resolveWebSocket()
  let token = args.token || loadToken()
  let heartbeat = null
  let backoff = 3000

  const connect = () => {
    const ws = new WebSocketImpl(args.server)
    ws.addEventListener('open', () => {
      console.log(`[node] 已连接 ${args.server}`)
      const fingerprint = { hostname: os.hostname(), platform: process.platform, arch: process.arch, label }
      if (token) ws.send(JSON.stringify({ type: 'auth', token, fingerprint }))
      else if (args.code) ws.send(JSON.stringify({ type: 'pair', code: args.code, fingerprint }))
      else {
        console.error('[node] 缺少配对码：首次接入请加 --code')
        ws.close()
      }
    })

    ws.addEventListener('message', (ev) => {
      let msg
      try {
        msg = JSON.parse(typeof ev.data === 'string' ? ev.data : String(ev.data))
      } catch {
        return
      }
      if (msg.type === 'paired' && msg.token) {
        token = msg.token
        saveToken(token)
        console.log(`[node] 配对成功，nodeId=${msg.nodeId}（token 已保存）`)
      } else if (msg.type === 'ready') {
        backoff = 3000
        console.log(`[node] 主端已确认，授权=${msg.authLevel}，白名单：${roots.join(' / ')}`)
        clearInterval(heartbeat)
        heartbeat = setInterval(() => {
          try {
            ws.send(JSON.stringify({ type: 'heartbeat', ts: Date.now() }))
          } catch {
            /* 断线由 close 处理 */
          }
        }, HEARTBEAT_MS)
      } else if (msg.type === 'request') {
        const res = handleRequest(msg, roots)
        ws.send(JSON.stringify({ type: 'response', id: msg.id, ...res }))
      } else if (msg.type === 'error') {
        console.warn(`[node] 主端拒绝：${msg.error}`)
        if (String(msg.error || '').includes('token')) {
          // token 失效：提示重新配对，避免无限重试
          console.warn('[node] token 已失效，请用新的配对码重新接入')
          try {
            fs.unlinkSync(TOKEN_FILE)
          } catch {
            /* ignore */
          }
        }
      }
    })

    ws.addEventListener('close', () => {
      clearInterval(heartbeat)
      heartbeat = null
      console.log(`[node] 连接断开，${Math.round(backoff / 1000)}s 后重连…`)
      setTimeout(connect, backoff)
      backoff = Math.min(backoff * 2, 30_000)
    })

    ws.addEventListener('error', () => {
      /* close 统一处理重连 */
    })
  }

  connect()
}

main()
