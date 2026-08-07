// 生成托盘/窗口图标：32x32 青绿圆点 + 深色圆角底（无依赖，直接写 PNG）
const zlib = require('zlib')
const fs = require('fs')
const path = require('path')

const W = 32
const H = 32

function crc32(buf) {
  let table = crc32.table
  if (!table) {
    table = crc32.table = new Int32Array(256)
    for (let n = 0; n < 256; n++) {
      let c = n
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
      table[n] = c
    }
  }
  let c = -1
  for (let i = 0; i < buf.length; i++) c = table[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ -1) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}

const raw = Buffer.alloc((W * 4 + 1) * H)
for (let y = 0; y < H; y++) {
  const rowStart = y * (W * 4 + 1)
  raw[rowStart] = 0 // filter none
  for (let x = 0; x < W; x++) {
    const o = rowStart + 1 + x * 4
    // 圆角方形底
    const r = 7
    const inRect =
      x >= 2 && x < W - 2 && y >= 2 && y < H - 2 &&
      (x >= 2 + r || y >= 2 + r) && (x < W - 2 - r || y >= 2 + r) &&
      (x >= 2 + r || y < H - 2 - r) && (x < W - 2 - r || y < H - 2 - r)
    const cornerOk = (cx, cy) => (x - cx) ** 2 + (y - cy) ** 2 <= r * r
    const rounded =
      inRect ||
      cornerOk(2 + r, 2 + r) || cornerOk(W - 3 - r, 2 + r) ||
      cornerOk(2 + r, H - 3 - r) || cornerOk(W - 3 - r, H - 3 - r)
    // 中心青绿圆
    const dc = Math.hypot(x - 15.5, y - 15.5)
    if (dc <= 8) {
      raw[o] = 0x50; raw[o + 1] = 0xc8; raw[o + 2] = 0x78; raw[o + 3] = 255 // #50C878
    } else if (rounded) {
      raw[o] = 0x0b; raw[o + 1] = 0x12; raw[o + 2] = 0x20; raw[o + 3] = 255 // #0B1220
    } else {
      raw[o + 3] = 0
    }
  }
}

const ihdr = Buffer.alloc(13)
ihdr.writeUInt32BE(W, 0)
ihdr.writeUInt32BE(H, 4)
ihdr[8] = 8 // bit depth
ihdr[9] = 6 // color type RGBA
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', zlib.deflateSync(raw)),
  chunk('IEND', Buffer.alloc(0))
])

const out = path.join(__dirname, '..', 'assets', 'icon.png')
fs.mkdirSync(path.dirname(out), { recursive: true })
fs.writeFileSync(out, png)
console.log('icon written:', out)
