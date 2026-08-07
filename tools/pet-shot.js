// CDP：抓取 pet 页面自身的渲染结果
const http = require('http')
const fs = require('fs')
const WebSocket = require('ws')

function getJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let data = ''
      res.on('data', (c) => (data += c))
      res.on('end', () => { try { resolve(JSON.parse(data)) } catch (e) { reject(e) } })
    }).on('error', reject)
  })
}

async function main() {
  const targets = await getJson('http://127.0.0.1:9222/json/list')
  const pet = targets.find((t) => t.url && t.url.includes('pet.html'))
  if (!pet) { console.log('no pet'); process.exit(1) }
  const ws = new WebSocket(pet.webSocketDebuggerUrl, { perMessageDeflate: false, maxPayload: 64 * 1024 * 1024 })
  await new Promise((r) => ws.once('open', r))

  const state = await new Promise((resolve) => {
    ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression: `JSON.stringify({state: __pet.spatial.current, scale: __pet.spatial.currentScale, pos: __pet.spatial.position})`, returnByValue: true } }))
    const h = (m) => { const msg = JSON.parse(m); if (msg.id === 1) { ws.off('message', h); resolve(msg.result?.result?.value) } }
    ws.on('message', h)
  })
  console.log('state:', state)

  ws.send(JSON.stringify({ id: 2, method: 'Page.captureScreenshot', params: { format: 'png' } }))
  ws.on('message', (m) => {
    const msg = JSON.parse(m)
    if (msg.id === 2) {
      const buf = Buffer.from(msg.result.data, 'base64')
      fs.writeFileSync('C:/Users/zhhch/wangyu/pet-page.png', buf)
      console.log('saved', buf.length)
      process.exit(0)
    }
  })
  setTimeout(() => { console.log('timeout'); process.exit(1) }, 15000)
}
main().catch((e) => { console.error(e); process.exit(1) })
