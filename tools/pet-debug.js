// CDP 诊断：连接 Electron 远程调试端口，读取 pet 页面的 __pet 状态
const http = require('http')
const WebSocket = require('ws')

function getJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let data = ''
      res.on('data', (c) => (data += c))
      res.on('end', () => {
        try { resolve(JSON.parse(data)) } catch (e) { reject(e) }
      })
    }).on('error', reject)
  })
}

async function main() {
  const targets = await getJson('http://127.0.0.1:9222/json/list')
  const pet = targets.find((t) => t.url.includes('pet.html'))
  if (!pet) {
    console.log('NO PET TARGET. targets:', targets.map((t) => t.url))
    process.exit(1)
  }
  const ws = new WebSocket(pet.webSocketDebuggerUrl, { perMessageDeflate: false })
  await new Promise((r) => ws.once('open', r))

  const expr = `(() => {
    const p = window.__pet
    if (!p) return { err: 'no __pet' }
    const THREE_Box = p.char.root.children[0]?.constructor
    // 用 three 的 Box3 计算角色包围盒
    const box = new (Object.getPrototypeOf(p.char.root).constructor === Object ? Object : Object)()
    return {
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
      dpr: window.devicePixelRatio,
      state: p.spatial.current,
      scale: p.spatial.currentScale,
      pos: p.spatial.position,
      rootScale: p.char.root.scale.x,
      rootPos: { x: p.char.root.position.x, y: p.char.root.position.y, z: p.char.root.position.z },
      camZ: p.stage.camera.position.z,
      camFov: p.stage.camera.fov,
      stageW: p.stage.width,
      stageH: p.stage.height
    }
  })()`

  const id = 1
  ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression: expr, returnByValue: true } }))
  ws.on('message', (m) => {
    const msg = JSON.parse(m)
    if (msg.id === id) {
      console.log(JSON.stringify(msg.result?.result?.value ?? msg.result, null, 2))
      ws.close()
      process.exit(0)
    }
  })
  setTimeout(() => { console.log('TIMEOUT'); process.exit(1) }, 8000)
}
main().catch((e) => { console.error(e); process.exit(1) })
