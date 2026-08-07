// win-eval.js <index|widget> <expr...>：在指定窗口页面里执行 JS 表达式并打印结果（CDP）
const http = require('http')

const which = process.argv[2] || 'index'
const expr = process.argv.slice(3).join(' ')

function getJson(url) {
  return new Promise((resolve, reject) => {
    http
      .get(url, (res) => {
        let d = ''
        res.on('data', (c) => (d += c))
        res.on('end', () => resolve(JSON.parse(d)))
      })
      .on('error', reject)
  })
}

async function main() {
  const targets = await getJson('http://127.0.0.1:9222/json')
  const t = targets.find((x) => x.url.includes(`${which}.html`))
  if (!t) throw new Error(`${which}.html not found`)
  const WebSocket = require('ws')
  const ws = new WebSocket(t.webSocketDebuggerUrl, { perMessageDeflate: false })
  let id = 0
  const pending = new Map()
  const send = (method, params = {}) =>
    new Promise((resolve) => {
      const mid = ++id
      pending.set(mid, resolve)
      ws.send(JSON.stringify({ id: mid, method, params }))
    })
  ws.on('message', (raw) => {
    const msg = JSON.parse(raw)
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg.result)
      pending.delete(msg.id)
    }
  })
  await new Promise((r) => ws.on('open', r))
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })
  console.log(JSON.stringify(r.result?.value ?? r, null, 1))
  ws.close()
}
main().catch((e) => {
  console.error(e.message || e)
  process.exit(1)
})
