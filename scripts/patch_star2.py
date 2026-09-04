# -*- coding: utf-8 -*-
"""星图 v2：知识图谱风格重写（常显标签/有机布局/光晕节点/深蓝底）"""
import io, re

def load(pp):
    return io.open(pp, encoding='utf-8', newline='').read()

def save(pp, tt):
    io.open(pp, 'w', encoding='utf-8', newline='').write(tt)

def repl(pp, old, new, count=1):
    tt = load(pp)
    eol = chr(13) + chr(10) if chr(13) + chr(10) in tt else chr(10)
    o = old.replace(chr(10), eol)
    n = new.replace(chr(10), eol)
    o = old.replace('
', eol)
    n = new.replace('
', eol)
    c = tt.count(o)
    assert c == count, pp + ': x' + str(c) + ': ' + old[:60]
    tt = tt.replace(o, n)
    save(pp, tt)
    print('OK |', old.strip().splitlines()[0][:44])

p = 'src/renderer/src/views/HomeView.tsx'
raw = io.open(p, encoding='utf-8', newline='').read()
t = raw.replace('\r\n', '\n')

def block_replace(start_marker, new_block, tag):
    global t
    i = t.find(start_marker)
    assert i >= 0, tag + ': start not found'
    # 括号深度扫描：从 start_marker 行的第一个 { 起到深度归零
    j = t.find('{', i)
    depth = 0
    k = j
    while k < len(t):
        ch = t[k]
        if ch == '{': depth += 1
        elif ch == '}':
            depth -= 1
            if depth == 0: break
        k += 1
    end = k + 1
    t = t[:i] + new_block + t[end:]
    print('OK', tag)

# ── 1) computeStarHierarchy：有机布局 + 常显标签字段 ──
old_hierarchy_start = 'function computeStarHierarchy(filtered: GraphItem[], isWork: boolean, override: Record<string, string> | undefined): { nodes: StarNode[]; connections: StarConnection[] } {'
new_hierarchy = '''/** 稳定伪随机（按 key 哈希，重渲染不跳动） */
function nodeJitter(seed: string, amp: number): number {
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (h * 33 + seed.charCodeAt(i)) | 0
  return (((h >>> 0) % 1000) / 1000 - 0.5) * 2 * amp
}

function computeStarHierarchy(filtered: GraphItem[], isWork: boolean, override: Record<string, string> | undefined): { nodes: StarNode[]; connections: StarConnection[] } {
  if (filtered.length === 0) return { nodes: [], connections: [] }
  const nodes: StarNode[] = []
  const connections: StarConnection[] = []
  const totalMin = sumDur(filtered)
  // 双星系：工作居右 / 摸鱼居左（保留语义分栏），中心即主星
  const cx0 = isWork ? 66 : 34
  const cy0 = 50 + nodeJitter(isWork ? 'core-w' : 'core-l', 4)
  nodes.push({ kind: 'core', key: isWork ? 'work-core' : 'life-core', x: cx0, y: cy0, size: 50, label: isWork ? '工作' : '摸鱼', min: totalMin })

  // 按分类聚合
  const byCat = new Map<AppCategory, GraphItem[]>()
  for (const i of filtered) {
    const c = categoryOfWithOverride(i.seg.mainApp, override)
    if (!byCat.has(c)) byCat.set(c, [])
    byCat.get(c)!.push(i)
  }
  const cats = [...byCat.entries()].sort((a, b) => sumDur(b[1]) - sumDur(a[1]))
  const maxCatMin = sumDur(cats[0][1]) || 1

  cats.forEach(([cat, items], ci) => {
    const catMeta = CATEGORY_META[cat]
    // 分类环：角度均分 + 有机抖动，半径 24-34 有机浮动
    const baseAngle = (ci / cats.length) * 2 * Math.PI - Math.PI / 2 + nodeJitter(`ang-${cat}-${isWork}`, 0.35)
    const catR = 26 + nodeJitter(`r-${cat}`, 5)
    const catMin = sumDur(items)
    const cx = cx0 + catR * Math.cos(baseAngle)
    const cy = cy0 + catR * Math.sin(baseAngle)
    nodes.push({ kind: 'cat', key: `cat-${cat}`, x: cx, y: cy, size: Math.max(20, Math.round(22 + (catMin / maxCatMin) * 10)), cat, apps: items.length, min: catMin, label: catMeta.label })
    connections.push({ x1: cx0, y1: cy0, x2: cx, y2: cy, level: 1 })

    // 应用环绕分类：角度扇形展开 + 距离双环交错 + 抖动
    const apps = [...items].sort((a, b) => b.seg.durationMin - a.seg.durationMin)
    const n = apps.length
    const spread = Math.min(1.1, 0.3 * Math.max(1, n - 1))
    apps.forEach((item, ai) => {
      const appR = 40 + nodeJitter(`rr-${item.seg.mainApp}`, 8) + (ai % 2) * 5
      const aAngle = baseAngle + (n === 1 ? 0 : ((ai - (n - 1) / 2) / Math.max(1, n - 1)) * spread) + nodeJitter(`aa-${item.seg.mainApp}`, 0.18)
      const ax = cx + appR * Math.cos(aAngle)
      const ay = cy + appR * Math.sin(aAngle)
      nodes.push({
        kind: 'app',
        key: item.seg.mainApp,
        x: ax,
        y: ay,
        size: Math.max(15, Math.round(16 + (item.seg.durationMin / (apps[0].seg.durationMin || 1)) * 8)),
        item,
        min: item.seg.durationMin,
        label: displayApp(item.seg.mainApp)
      })
      connections.push({ x1: cx, y1: cy, x2: ax, y2: ay, level: 2 })
    })
  })
  return { nodes, connections }
}'''

# 替换整个 computeStarHierarchy 函数（括号深度扫描）
i = t.find(old_hierarchy_start)
assert i >= 0, 'hierarchy fn not found'
j = t.find('{', i)
depth = 0
k = j
while k < len(t):
    ch = t[k]
    if ch == '{': depth += 1
    elif ch == '}':
        depth -= 1
        if depth == 0: break
    k += 1
t = t[:i] + new_hierarchy + t[k + 1:]
print('OK hierarchy replaced')

# ── 2) renderStarNode：分类/应用节点加常显名称标签 ──
# 分类节点：时长药丸 → 名称（上行）+ 时长（下行）
repl(p,
    """          <span
            className="mt-0.5 rounded-full px-1.5 py-px text-[9px] tabular-nums"
            style={{ background: 'var(--pop-bg)', color: catMeta.color, border: `1px solid ${catMeta.color}44` }}
          >
            {fmtDur(node.min)}
          </span>""",
    """          <span className="mt-0.5 whitespace-nowrap text-[10px] font-medium" style={{ color: catMeta.color, textShadow: '0 1px 4px rgba(0,0,0,0.6)' }}>
            {catMeta.label}
          </span>
          <span className="-mt-0.5 whitespace-nowrap text-[9px] tabular-nums text-slate-400">{fmtDur(node.min)}</span>""")

# 应用节点：圆下方常显名称
repl(p,
    """        {visual ? (
          <img src={visual.iconDataUrl} alt="" className="h-full w-full object-contain" draggable={false} style={{ padding: 3 }} />
        ) : (
          <span style={{ fontSize: Math.max(9, node.size * 0.38), fontWeight: 600, color: '#e2e8f0', pointerEvents: 'none' }}>
            {displayApp(node.key).replace(/\\.exe$/i, '').slice(0, 1)}
          </span>
        )}
      </div>
    )
  }""",
    """        {visual ? (
          <img src={visual.iconDataUrl} alt="" className="h-full w-full object-contain" draggable={false} style={{ padding: 3 }} />
        ) : (
          <span style={{ fontSize: Math.max(9, node.size * 0.38), fontWeight: 600, color: '#e2e8f0', pointerEvents: 'none' }}>
            {displayApp(node.key).replace(/\\.exe$/i, '').slice(0, 1)}
          </span>
        )}
      </div>
      )
    }
    // 应用节点包装：圆 + 下方常显名称（知识图谱风格）
    return (
      <div
        key={node.key}
        draggable
        onDragStart={() => setDragFrom({ app: node.key, col: node.item!.column })}
        onDragEnd={() => { setDragFrom(null); setHoverCol(null) }}
        onMouseEnter={(e) => { setStarHover(node.key); setStarHoverRect(e.currentTarget.getBoundingClientRect()) }}
        onMouseLeave={() => { setStarHover(null); setStarHoverRect(null) }}
        className="absolute flex flex-col items-center transition-all duration-300 cursor-grab active:cursor-grabbing group"
        style={{
          left: `${node.x}%`, top: `${node.y}%`,
          transform: 'translate(-50%, -50%)',
          opacity: isDragging ? 0.25 : isGlance ? 0.3 : 1,
          zIndex: 5,
        }}
      >
        <div
          className="flex items-center justify-center overflow-hidden rounded-full transition-all duration-300"
          style={{
            width: node.size, height: node.size,
            background: visual ? '#ffffff' : `radial-gradient(circle at 35% 35%, rgb(${chroma}/0.85), rgb(${chroma}/0.35))`,
            boxShadow: `0 0 6px ${nodeColor}/0.5, 0 0 16px ${nodeColor}/0.22`,
            scale: starHover === node.key ? '1.2' : '1',
            border: `1px solid ${nodeColor}/0.5`,
          }}
        >
          {visual ? (
            <img src={visual.iconDataUrl} alt="" className="h-full w-full object-contain" draggable={false} style={{ padding: 3 }} />
          ) : (
            <span style={{ fontSize: Math.max(9, node.size * 0.38), fontWeight: 600, color: '#e2e8f0', pointerEvents: 'none' }}>
              {displayApp(node.key).replace(/\\.exe$/i, '').slice(0, 1)}
            </span>
          )}
        </div>
        <span
          className="mt-1 max-w-[110px] truncate text-center text-[10px] leading-tight transition-colors"
          style={{ color: starHover === node.key ? '#e2e8f0' : 'var(--tl-ruler-label)', pointerEvents: 'none' }}
        >
          {displayApp(node.key)}
        </span>
      </div>
    )
  }""")

io.open(p, 'w', encoding='utf-8', newline='').write(t)
print('star v2 render done')
