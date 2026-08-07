const http = require('http')
const fs = require('fs')
const WebSocket = require('ws')
function getJson(url) { return new Promise((resolve, reject) => { http.get(url, (res) => { let d = ''; res.on('data', (c) => (d += c)); res.on('end', () => resolve(JSON.parse(d))) }).on('error', reject) }) }
async function main() {
  const targets = await getJson('http://127.0.0.1:9222/json')
  const t = targets.find((x) => x.url.includes('splash.html'))
  if (!t) { console.log('splash not found'); process.exit(1) }
  const ws = new WebSocket(t.webSocketDebuggerUrl, { perMessageDeflate: false, maxPayload: 64 * 1024 * 1024 })
  await new Promise((r) => ws.once('open', r))
  const shot = await new Promise((resolve) => {
    ws.send(JSON.stringify({ id: 1, method: 'Page.captureScreenshot', params: { format: 'png' } }))
    ws.on('message', (m) => { const msg = JSON.parse(m); if (msg.id === 1) resolve(msg.result) })
  })
  fs.writeFileSync('C:/Users/zhhch/wangyu/splash-shot.png', Buffer.from(shot.data, 'base64'))
  console.log('saved')
  process.exit(0)
}
main().catch((e) => { console.error(e); process.exit(1) })
