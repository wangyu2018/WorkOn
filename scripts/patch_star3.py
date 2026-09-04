# -*- coding: utf-8 -*-
"""星图 v2 修复：常显标签/树形连线/布局微调（全部用 chr() 构造特殊字符）"""
import io

NL = chr(10)
EOL_CRLF = chr(13) + chr(10)
BS = chr(92)
NL_LIT = "'" + BS + "n'"  # TS 源码里的换行字面量 '\n'
EXE_RE = "replace(/" + BS + ".exe$/i, '')"

def load(pp):
    return io.open(pp, encoding='utf-8', newline='').read()

def save(pp, tt):
    io.open(pp, 'w', encoding='utf-8', newline='').write(tt)

def repl(pp, old, new, count=1):
    tt = load(pp)
    eol = EOL_CRLF if EOL_CRLF in tt else NL
    o = old.replace(NL, eol)
    n = new.replace(NL, eol)
    c = tt.count(o)
    assert c == count, pp + ': x' + str(c) + ': ' + old[:70]
    save(pp, tt.replace(o, n))
    print('OK |', old.strip().splitlines()[0][:44])

p = 'src/renderer/src/views/HomeView.tsx'

# ── 1) 分类节点：名称常显（时长药丸上方） ──
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

# ── 2) 应用节点：圆下方常显名称（包装层重构） ──
repl(p,
    """        {visual ? (
          <img src={visual.iconDataUrl} alt="" className="h-full w-full object-contain" draggable={false} style={{ padding: 3 }} />
        ) : (
          <span style={{ fontSize: Math.max(9, node.size * 0.38), fontWeight: 600, color: '#e2e8f0', pointerEvents: 'none' }}>
            {displayApp(node.key).""" + "replace(/" + BS + ".exe$/i, '').slice(0, 1)}" + """
          </span>
        )}
      </div>
    )
  }""",
    """        {visual ? (
          <img src={visual.iconDataUrl} alt="" className="h-full w-full object-contain" draggable={false} style={{ padding: 3 }} />
        ) : (
          <span style={{ fontSize: Math.max(9, node.size * 0.38), fontWeight: 600, color: '#e2e8f0', pointerEvents: 'none' }}>
            {displayApp(node.key).""" + "replace(/" + BS + ".exe$/i, '').slice(0, 1)}" + """
          </span>
        )}
      </div>
      <span
        className="mt-1 max-w-[110px] truncate text-center text-[10px] leading-tight transition-colors"
        style={{ color: starHover === node.key ? '#e2e8f0' : 'var(--tl-ruler-label)', pointerEvents: 'none' }}
      >
        {displayApp(node.key)}
      </span>
    )
  }""")

# ── 3) 应用节点外层 div 改包装布局（圆 + 标签纵向排列） ──
repl(p,
    """        className="absolute rounded-full transition-all duration-300 cursor-grab active:cursor-grabbing group"
        style={{
          left: `${node.x}%`, top: `${node.y}%`,
          width: node.size, height: node.size,
          transform: 'translate(-50%, -50%)',""",
    """        className="absolute flex flex-col items-center transition-all duration-300 cursor-grab active:cursor-grabbing group"
        style={{
          left: `${node.x}%`, top: `${node.y}%`,
          transform: 'translate(-50%, -50%)',""")
repl(p,
    """          overflow: 'hidden',
        }}
      >
        {visual ? (
          <img src={visual.iconDataUrl} alt="" className="h-full w-full object-contain" draggable={false} style={{ padding: 3 }} />""",
    """        }}
      >
        <div
          className="flex items-center justify-center overflow-hidden rounded-full transition-all duration-300"
          style={{
            width: node.size, height: node.size,
            background: visual ? '#ffffff' : `radial-gradient(circle at 35% 35%, rgb(${chroma}/0.85), rgb(${chroma}/0.35))`,
            boxShadow: `0 0 6px ${nodeColor}/0.5, 0 0 16px ${nodeColor}/0.22`,
            border: `1px solid ${nodeColor}/0.5`,
          }}
        >
          {visual ? (
            <img src={visual.iconDataUrl} alt="" className="h-full w-full object-contain" draggable={false} style={{ padding: 3 }} />""")
# 删掉原外层残留的 overflow hidden 与多余闭合
t = load(p)
old_tail = """            opacity: isDragging ? 0.25 : isGlance ? 0.3 : 1,
          zIndex: 5,
          scale: starHover === node.key ? '1.2' : '1',
          border: `1px solid ${nodeColor}/0.45`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          opacity: isDragging ? 0.25 : isGlance ? 0.3 : 1,
        }}
      >"""
new_tail = """            opacity: isDragging ? 0.25 : isGlance ? 0.3 : 1,
          zIndex: 5,
          scale: starHover === node.key ? '1.2' : '1',
        }}
      >"""
assert t.count(old_tail.replace('\n', eol)) == 1
t = t.replace(old_tail.replace('\n', eol), new_tail.replace('\n', eol))
save(p, t)
print('OK wrapper cleaned')

# ── 4) 分类节点容器改纵向包装（与分类名对齐） ──
repl(p,
    """          className="absolute flex flex-col items-center"
          style={{ left: `${node.x}%`, top: `${node.y}%`, transform: 'translate(-50%, -50%)', zIndex: 6 }}""",
    """          className="absolute flex flex-col items-center"
          style={{ left: `${node.x}%`, top: `${node.y}%`, transform: 'translate(-50%, -50%)', zIndex: 6 }}""")

print('star v2 fixes done')
