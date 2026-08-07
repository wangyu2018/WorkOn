// pet-eval.js <expr...>：在桌宠页面里执行 JS 表达式并打印结果（CDP 诊断）
const http = require('http')

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
  const expr = process.argv.slice(2).join(' ')
  const targets = await getJson('http://127.0.0.1:9222/json')
  const pet = targets.find((t) => t.url.includes('pet.html'))
  if (!pet) throw new Error('pet.html not found')
  const WebSocket = require('ws')
  const ws = new WebSocket(pet.webSocketDebuggerUrl, { perMessageDeflate: false })
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
