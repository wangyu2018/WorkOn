// win-shot.js <index|widget> <out.png>：CDP 截指定窗口页面（不需要窗口在前台）
const http = require('http')
const fs = require('fs')

const which = process.argv[2] || 'index'
const out = process.argv[3] || `C:\\Users\\zhhch\\wangyu\\win-${which}.png`

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
  if (!t) throw new Error(`${which}.html not found: ` + targets.map((x) => x.url).join(', '))
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
  const shot = await send('Page.captureScreenshot', { format: 'png' })
  fs.writeFileSync(out, Buffer.from(shot.data, 'base64'))
  console.log('saved', out)
  ws.close()
}
main().catch((e) => {
  console.error(e.message || e)
  process.exit(1)
})
