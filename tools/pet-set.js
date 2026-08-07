// pet-set.js <state> [out]：通过 CDP 让桌宠切到指定空间态并截图（验证状态行为）
const http = require('http')
const fs = require('fs')
const path = require('path')

const state = process.argv[2] || 'working'
const out = process.argv[3] || `C:\\Users\\zhhch\\wangyu\\pet-${state}.png`

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
  const pet = targets.find((t) => t.url.includes('pet.html'))
  if (!pet) throw new Error('pet.html not found')
  const WebSocket = require('ws')
  const ws = new WebSocket(pet.webSocketDebuggerUrl, { perMessageDeflate: false })
  let id = 0
  const pending = new Map()
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const mid = ++id
      pending.set(mid, { resolve, reject })
      ws.send(JSON.stringify({ id: mid, method, params }))
    })
  ws.on('message', (raw) => {
    const msg = JSON.parse(raw)
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id).resolve(msg.result)
      pending.delete(msg.id)
    }
  })
  await new Promise((r) => ws.on('open', r))

  await send('Runtime.evaluate', {
    expression: `__pet.spatial.transitionTo('${state}')`,
    awaitPromise: false
  })
  await new Promise((r) => setTimeout(r, 3500)) // 等过渡+姿态混合完成
  const shot = await send('Page.captureScreenshot', { format: 'png' })
  fs.writeFileSync(out, Buffer.from(shot.data, 'base64'))
  const st = await send('Runtime.evaluate', {
    expression: `JSON.stringify({state: __pet.spatial.current, scale: __pet.spatial.currentScale, pos: __pet.spatial.position, pose: __pet.anim.currentPoseName})`,
    returnByValue: true
  })
  console.log('state:', st.result.value)
  console.log('saved', out)
  ws.close()
}

main().catch((e) => {
  console.error(e.message || e)
  process.exit(1)
})
