const fs = require('fs');
const sharp = require('../node_modules/sharp');
const path = require('path');

const A = 'D:/AI/WorkOn/workonv0.2-6/workon/assets';
const splashPath = path.join(A, 'splash.html');

(async () => {
  let html = fs.readFileSync(splashPath, 'utf-8');

  // 1) 替换内嵌图标为暖色版
  const png = await sharp(path.join(A, 'icon-512.png')).png().toBuffer();
  const b64 = png.toString('base64');
  const before = html.length;
  html = html.replace(/icon\.src\s*=\s*"data:image\/png;base64,[^"]*"/, `icon.src = "data:image/png;base64,${b64}"`);
  console.log('base64 replaced:', html.length - before, 'bytes delta');

  // 2) 颜色映射（绿青 -> 暖橙/奶油）
  const map = [
    ['--bg: #000713;', '--bg: #160c06;'],
    ['--green: #51f7ae;', '--green: #ffb36b;'],
    ['--cyan: #22d3ee;', '--cyan: #ffd98c;'],
    ['rgba(120, 240, 200, 0.05)', 'rgba(255, 200, 140, 0.05)'],
    ['rgba(0, 3, 10, 0.75)', 'rgba(20, 10, 5, 0.75)'],
    ['rgba(81, 247, 174, 0.045)', 'rgba(255, 179, 107, 0.045)'],
    ['rgba(160, 250, 215, 0.72)', 'rgba(255, 210, 160, 0.72)'],
    ['rgba(81, 247, 174, 0.35)', 'rgba(255, 179, 107, 0.35)'],
    ['rgba(120, 190, 175, 0.4)', 'rgba(200, 150, 120, 0.4)'],
    ['rgba(160, 240, 210, 0.1)', 'rgba(255, 210, 160, 0.1)'],
    ['rgba(81, 247, 174, 0.8), 0 0 26px rgba(34, 211, 238, 0.45)', 'rgba(255, 179, 107, 0.8), 0 0 26px rgba(255, 217, 140, 0.45)'],
    ['#eafff6', '#fff3e6'],
    ['rgba(120, 255, 210, 0.9)', 'rgba(255, 200, 140, 0.9)'],
    ['rgba(190, 255, 230, 0.85)', 'rgba(255, 225, 185, 0.85)'],
    ['rgba(81, 247, 174, 0.4)', 'rgba(255, 179, 107, 0.4)'],
    ['rgba(140, 220, 195, 0.4)', 'rgba(210, 175, 130, 0.4)'],
    ['rgba(140, 220, 195, 0.28)', 'rgba(210, 175, 130, 0.28)'],
    ['rgba(170, 250, 220, 0.6)', 'rgba(255, 220, 170, 0.6)'],
    ['rgba(0, 7, 19, 0.34)', 'rgba(22, 12, 6, 0.34)'],
    ['rgba(34, 211, 238, 0.20)', 'rgba(255, 217, 140, 0.20)'],
    ['rgba(30, 120, 150, 0.07)', 'rgba(120, 80, 45, 0.07)'],
    ['rgba(81, 247, 174, 0.13)', 'rgba(255, 179, 107, 0.13)'],
    ['"34, 211, 238"', '"255, 179, 107"'],
    ['"81, 247, 174"', '"255, 217, 140"'],
    ['rgba(180,255,225,0.9)', 'rgba(255,220,180,0.9)'],
    ['rgba(160,240,255,0.9)', 'rgba(255,220,150,0.9)'],
    ['rgba(150, 245, 255, ${rand(0.25, 0.6)})', 'rgba(255, 215, 170, ${rand(0.25, 0.6)})'],
    ['rgba(220, 255, 240, ${0.5 * f})', 'rgba(255, 235, 200, ${0.5 * f})'],
    ['rgba(120, 240, 210, ${0.18 * f})', 'rgba(255, 200, 140, ${0.18 * f})'],
    ['#aeffdd', '#ffe2b0'],
    ['rgba(81,247,174,.7)', 'rgba(255,179,107,.7)'],
    ['ctx.fillStyle = "#000713";', 'ctx.fillStyle = "#160c06";'],
  ];
  for (const [from, to] of map) {
    if (!html.includes(from)) console.log('MISS:', from.slice(0, 40));
    html = html.split(from).join(to);
  }

  // 3) 粒子采样条件：绿色(g>150) -> 暖橙(r>150)
  html = html.replace('lum > 85 && g > 150', 'lum > 60 && r > 150');

  fs.writeFileSync(splashPath, html);
  console.log('splash.html updated, length', html.length);
})();
