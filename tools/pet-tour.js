// pet-tour.js：在桌宠页面内逐个应用 POSES 姿态并截图（替代浏览器巡览，无标签竞态）
const http = require('http')
const fs = require('fs')

const POSES = [
  'stand_idle',
  'stand_greet',
  'stand_serious',
  'stand_sleepy',
  'stand_tired',
  'stand_relaxed'
]

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
  const evalJs = (expression) =>
    send('Runtime.evaluate', { expression, returnByValue: true }).then((r) => r?.result?.value)
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

  // 阻断 bridge 状态重断言 + 固定机位（居中、放大 1.6）+ 强制面向镜头 + 冻结游荡
  await evalJs(`(() => {
    __pet.spatial.transitionTo = () => {}
    __pet.spatial.setScreenSize(1440, 852)
    __pet.spatial.roam.update = () => ({ moving: false, speed: 0, mode: null })
    const orig = __pet.spatial.applyTransform
    __pet.spatial.applyTransform = function (dt) {
      orig.call(this, dt)
      this.char.root.rotation.y = 0
    }
    return 'ok'
  })()`)

  for (const name of POSES) {
    await evalJs(`(() => {
      __pet.anim.setPose('${name}', 0.35)
      __pet.spatial.setPosition({ x: 720, y: 760 })
      __pet.spatial.setScale(1.6)
      return 'ok'
    })()`)
    await sleep(1100)
    const shot = await send('Page.captureScreenshot', { format: 'png' })
    const out = `C:\\Users\\zhhch\\wangyu\\workon\\vrm-preview-pose-${name}-front.png`
    fs.writeFileSync(out, Buffer.from(shot.data, 'base64'))
    console.log('saved', name)
  }
  ws.close()
}
main().catch((e) => {
  console.error(e.message || e)
  process.exit(1)
})
