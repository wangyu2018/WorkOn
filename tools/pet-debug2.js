// CDP 深度诊断：列出所有 targets + pet 页面 canvas 详情
const http = require('http')
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

async function evalOn(ws, expression, id) {
  return new Promise((resolve) => {
    ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, returnByValue: true } }))
    const h = (m) => {
      const msg = JSON.parse(m)
      if (msg.id === id) { ws.off('message', h); resolve(msg.result?.result?.value ?? msg.result) }
    }
    ws.on('message', h)
  })
}

async function main() {
  const targets = await getJson('http://127.0.0.1:9222/json/list')
  console.log('TARGETS:')
  for (const t of targets) console.log(' -', t.type, t.url || t.title)

  const pets = targets.filter((t) => t.url && t.url.includes('pet.html'))
  for (const pet of pets) {
    const ws = new WebSocket(pet.webSocketDebuggerUrl, { perMessageDeflate: false })
    await new Promise((r) => ws.once('open', r))
    const info = await evalOn(ws, `(() => {
      const cs = [...document.querySelectorAll('canvas')].map(c => ({
        w: c.width, h: c.height,
        cssW: c.style.width, cssH: c.style.height,
        rect: c.getBoundingClientRect().toJSON()
      }))
      return { canvasCount: cs.length, canvases: cs, bodyChildren: document.body.children.length, scripts: document.scripts.length }
    })()`, 1)
    console.log('PET PAGE:', JSON.stringify(info, null, 2))
    ws.close()
  }
  process.exit(0)
}
main().catch((e) => { console.error(e); process.exit(1) })
