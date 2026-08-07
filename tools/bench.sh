#!/bin/bash
# 四档性能实测：每档重载 pet 页（重置闲置降帧计时），测量 8s 窗口内的 FPS/CPU%/内存
cd /c/Users/zhhch/wangyu/workon
export PATH="/c/Users/zhhch/tools/node:$PATH"

cpu_sum() {
  powershell -NoProfile -Command "((Get-Process electron -ErrorAction SilentlyContinue | Measure-Object -Property CPU -Sum).Sum)" | tr -d '\r'
}
mem_sum() {
  powershell -NoProfile -Command "[math]::Round(((Get-Process electron -ErrorAction SilentlyContinue | Measure-Object -Property WorkingSet64 -Sum).Sum)/1MB)" | tr -d '\r'
}

echo "tier,fps,cpu_pct,mem_mb,drawCalls,triangles,degraded"
for tier in eco standard smooth ultra; do
  node tools/pet-eval.js "window.api.setSettings({petFpsTier:'$tier'}); 'set'" > /dev/null
  node tools/pet-eval.js "location.reload(); 'reload'" > /dev/null
  sleep 7
  c0=$(cpu_sum)
  sleep 8
  c1=$(cpu_sum)
  m=$(mem_sum)
  stats=$(node tools/pet-eval.js "(() => { const s = __pet.stage.getStats(); return s.fps + '|' + s.drawCalls + '|' + s.triangles + '|' + s.degraded })()" | tr -d '"')
  fps=$(echo "$stats" | cut -d'|' -f1)
  dc=$(echo "$stats" | cut -d'|' -f2)
  tri=$(echo "$stats" | cut -d'|' -f3)
  dg=$(echo "$stats" | cut -d'|' -f4)
  cpu=$(awk "BEGIN{printf \"%.1f\", ($c1-$c0)/8/16*100}")
  echo "$tier,$fps,$cpu,$m,$dc,$tri,$dg"
done
