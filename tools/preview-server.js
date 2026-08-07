// 静态服务器：预览 LING 建模（服务 out/renderer，默认入口 ling-preview.html）
const http = require('http')
const fs = require('fs')
const path = require('path')
const root = path.join(__dirname, '..', 'out', 'renderer')
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.png': 'image/png',
  '.svg': 'image/svg+xml'
}
http
  .createServer((req, res) => {
    // POST /save-shot?name=xxx —— 把页面 canvas 截图写到项目根目录
    if (req.method === 'POST' && req.url.startsWith('/save-shot')) {
      const name = (new URL(req.url, 'http://x').searchParams.get('name') || 'shot').replace(/[^\w-]/g, '')
      const out = path.join(root, '..', '..', `vrm-preview-${name}.png`)
      const ws = fs.createWriteStream(out)
      req.pipe(ws)
      ws.on('finish', () => {
        res.end('ok')
        console.log('saved', out)
      })
      ws.on('error', () => {
        res.statusCode = 500
        res.end()
      })
      return
    }
    let p = decodeURIComponent(req.url.split('?')[0])
    if (p === '/') p = '/ling-preview.html'
    const f = path.normalize(path.join(root, p))
    if (!f.startsWith(root)) {
      res.statusCode = 403
      return res.end()
    }
    fs.readFile(f, (e, d) => {
      if (e) {
        res.statusCode = 404
        return res.end('not found')
      }
      res.setHeader('Content-Type', MIME[path.extname(f)] || 'application/octet-stream')
      res.end(d)
    })
  })
  .listen(4173, () => console.log('preview: http://localhost:4173/ling-preview.html'))
