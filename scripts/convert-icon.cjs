const sharp = require('../node_modules/sharp');
const path = require('path');
const fs = require('fs');

const A = 'D:/AI/WorkOn/workonv0.2-6/workon/assets';

function rgb2hsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  let h = 0, s = 0;
  const l = (mx + mn) / 2;
  const d = mx - mn;
  if (d > 0) {
    s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
    switch (mx) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      default: h = (r - g) / d + 4;
    }
    h /= 6;
  }
  return [h, s, l];
}

function hsl2rgb(h, s, l) {
  let r, g, b;
  if (s === 0) { r = g = b = l; }
  else {
    const hue2rgb = (p, q, t) => {
      if (t < 0) t += 1; if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1 / 3); g = hue2rgb(p, q, h); b = hue2rgb(p, q, h - 1 / 3);
  }
  return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
}

// 绿青(86°-216°) -> 暖橙/奶油(14°-58°)；深蓝黑背景 -> 深暖棕
function warmMap(r, g, b) {
  const [h, s, l] = rgb2hsl(r, g, b);
  if (s > 0.2 && h >= 0.24 && h <= 0.60 && l > 0.2 && l < 0.97) {
    const nh = 0.04 + ((h - 0.24) / 0.36) * 0.12;
    return hsl2rgb(nh, s, l);
  }
  if (l < 0.32 && h > 0.52) {
    return hsl2rgb(0.07, Math.min(s, 0.7), l);
  }
  return [r, g, b];
}

async function warmPng(src, dst, size, radiusRatio) {
  const { data, info } = await sharp(src).raw().toBuffer({ resolveWithObject: true });
  const w = info.width, h = info.height, ch = info.channels;
  const out = Buffer.alloc(data.length);
  for (let i = 0; i < data.length; i += ch) {
    const [nr, ng, nb] = warmMap(data[i], data[i + 1], data[i + 2]);
    out[i] = nr; out[i + 1] = ng; out[i + 2] = nb; out[i + 3] = data[i + 3];
  }
  let img = sharp(out, { raw: { width: w, height: h, channels: ch } }).resize(size, size, { kernel: 'lanczos3' });
  if (radiusRatio > 0) {
    const radius = Math.round(size * radiusRatio);
    const maskSvg = `<svg width="${size}" height="${size}"><rect x="0" y="0" width="${size}" height="${size}" rx="${radius}" ry="${radius}" fill="white"/></svg>`;
    const mask = await sharp(Buffer.from(maskSvg)).png().toBuffer();
    img = img.composite([{ input: mask, blend: 'dest-in' }]);
  }
  await img.png().toFile(dst);
  console.log('wrote', path.basename(dst), size + 'x' + size);
}

function pngToIco(pngBuf, size) {
  const w = size >= 256 ? 0 : size;
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(1, 4);
  const entry = Buffer.alloc(16);
  entry.writeUInt8(w, 0);
  entry.writeUInt8(w, 1);
  entry.writeUInt8(0, 2);
  entry.writeUInt8(0, 3);
  entry.writeUInt16LE(1, 4);
  entry.writeUInt16LE(32, 6);
  entry.writeUInt32LE(pngBuf.length, 8);
  entry.writeUInt32LE(22, 12);
  return Buffer.concat([header, entry, pngBuf]);
}

(async () => {
  const SRC = path.join(A, 'icon-512.png');
  // 主图标：圆角 22%
  const iconSizes = [16, 24, 32, 48, 128, 256, 512];
  for (const s of iconSizes) {
    await warmPng(SRC, path.join(A, `icon-${s}.png`), s, 0.22);
  }
  await warmPng(SRC, path.join(A, 'icon.png'), 32, 0.22);
  await warmPng(SRC, path.join(A, 'logo.png'), 128, 0.22);

  // 托盘 dark：轻微圆角
  for (const s of [16, 24, 32]) {
    await warmPng(SRC, path.join(A, `tray-dark-${s}.png`), s, 0.18);
  }
  // 托盘 light：源是浅色版，转暖后圆角
  const LIGHT_SRC = path.join(A, 'tray-light-32.png');
  for (const s of [16, 24, 32]) {
    await warmPng(LIGHT_SRC, path.join(A, `tray-light-${s}.png`), s, 0.18);
  }
  // 托盘 dot：绿点 -> 暖橙点
  await warmPng(path.join(A, 'tray-dot-dark-16.png'), path.join(A, 'tray-dot-dark-16.png'), 16, 0);
  await warmPng(path.join(A, 'tray-dot-light-16.png'), path.join(A, 'tray-dot-light-16.png'), 16, 0);

  // ico
  const png256 = await sharp(path.join(A, 'icon-256.png')).png().toBuffer();
  fs.writeFileSync(path.join(A, 'icon.ico'), pngToIco(png256, 256));
  fs.writeFileSync(path.join(A, 'favicon.ico'), pngToIco(png256, 256));
  console.log('wrote icon.ico, favicon.ico');
})();
