#!/usr/bin/env node
// CDP 驱动器：连 Electron 渲染页跑 JS 表达式 / 截图（测试用，不改产品代码）
// 用法: node tools/cdp-eval.mjs "<expr>" [--shot out.png] [--ws <url>]
//        node tools/cdp-eval.mjs --shot out.png          只截图
const wsFile = process.argv.includes('--ws')
  ? null
  : null
const argList = process.argv.slice(2)
const shotIdx = argList.indexOf('--shot')
const shotPath = shotIdx >= 0 ? argList[shotIdx + 1] : null
const expr = argList.filter((a, i) => (shotIdx < 0 || (i !== shotIdx && i !== shotIdx + 1)) && !a.startsWith('--'))[0]

const list = await (await fetch('http://localhost:9222/json')).json()
const pane = argList.find((a) => a.startsWith('--pane='))?.slice(7)
const target = list.find((t) => {
  if (t.type !== 'page' || t.url.includes('widget')) return false
  if (pane) return t.url.includes(`pane=${pane}`)
  return t.title === 'WorkOn' && !t.url.includes('pane=')
}) ?? list.find((t) => t.type === 'page' && !t.url.includes('widget'))
if (!target) { console.error('NO_TARGET'); process.exit(1) }

const ws = new WebSocket(target.webSocketDebuggerUrl)
let id = 0
const pend = new Map()
const send = (method, params = {}) =>
  new Promise((res, rej) => {
    const i = ++id
    pend.set(i, { res, rej })
    ws.send(JSON.stringify({ id: i, method, params }))
  })
ws.onmessage = (e) => {
  const m = JSON.parse(e.data)
  if (m.id && pend.has(m.id)) { pend.get(m.id).res(m.result ?? m.error); pend.delete(m.id) }
}
await new Promise((r) => { ws.onopen = r })

await send('Page.enable')
await send('Runtime.enable')
await send('Page.bringToFront').catch(() => {})
setTimeout(() => { console.log('TIMEOUT'); process.exit(2) }, 15000).unref()

if (expr) {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })
  if (r.exceptionDetails) console.log('EXC:', JSON.stringify(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text))
  else console.log(JSON.stringify(r.result?.value))
}
if (shotPath) {
  const r = await send('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false })
  if (r?.data) { const fs = await import('fs'); fs.writeFileSync(shotPath, Buffer.from(r.data, 'base64')); console.log('SHOT:' + shotPath) }
}
ws.close()
process.exit(0)
