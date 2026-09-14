# -*- coding: utf-8 -*-
"""整函数替换 renderStarNode：圆 + 常显名称标签 纵向包装"""
import io

p = 'src/renderer/src/views/HomeView.tsx'
t = io.open(p, encoding='utf-8', newline='').read().replace(chr(13) + chr(10), chr(10))

START = '  const renderStarNode = (node: StarNode, isWork: boolean) => {'
i = t.find(START)
assert i >= 0, 'renderStarNode not found'

# 括号深度扫描找函数结束（从第一个 { 起）
j = t.find('{', i)
depth = 0
k = j
in_str = None
while k < len(t):
    ch = t[k]
    if in_str:
        if ch == chr(92): k += 1
        elif ch == in_str: in_str = None
    else:
        if ch in ('"', "'", '`'): in_str = ch
        elif ch == '{': depth += 1
        elif ch == '}':
            depth -= 1
            if depth == 0: break
    k += 1
end = k + 1  # 指向闭 } 之后

new_fn = '''  const renderStarNode = (node: StarNode, isWork: boolean) => {
    // 主星：工作 / 摸鱼（不可拖）
    if (node.kind === 'core') {
      const colChroma = isWork ? 'var(--star-work)' : 'var(--star-life)'
      return (
        <div
          key={node.key}
          onMouseEnter={() => setStarHover(node.key)}
          onMouseLeave={() => setStarHover(null)}
          className="absolute flex items-center justify-center rounded-full"
          title={`${node.label} · 共 ${fmtDur(node.min)}`}
          style={{
            left: `${node.x}%`, top: `${node.y}%`,
            width: node.size, height: node.size,
            transform: 'translate(-50%, -50%)',
            background: `radial-gradient(circle at 35% 35%, ${isWork ? 'rgb(124 158 255 / 0.95)' : 'rgb(255 124 124 / 0.95)'}, ${isWork ? 'rgb(124 158 255 / 0.45)' : 'rgb(255 124 124 / 0.45)'})`,
            boxShadow: `0 0 14px ${isWork ? 'rgb(124 158 255 / 0.55)' : 'rgb(255 124 124 / 0.5)'}`,
            zIndex: 10,
            scale: starHover === node.key ? '1.08' : '1',
            border: `1px solid ${isWork ? 'rgb(124 158 255 / 0.4)' : 'rgb(255 124 124 / 0.4)'}`,
            color: '#fff',
            fontSize: 11.5,
            fontWeight: 600,
          }}
        >
          <div className="text-center leading-tight" style={{ background: 'rgba(8, 12, 24, 0.55)', borderRadius: 8, padding: '3px 8px' }}>
            <div>{node.label}</div>
            <div style={{ fontSize: 8.5, fontWeight: 400, opacity: 0.85 }}>{fmtDur(node.min)}</div>
          </div>
        </div>
      )
    }
    // 子星：分类（图标圆 + 下方常显分类名 + 时长）
    if (node.kind === 'cat') {
      const catMeta = CATEGORY_META[node.cat!]
      return (
        <div
          key={node.key}
          className="absolute flex flex-col items-center"
          style={{ left: `${node.x}%`, top: `${node.y}%`, transform: 'translate(-50%, -50%)', zIndex: 6 }}
        >
          <div
            onMouseEnter={() => setStarHover(node.key)}
            onMouseLeave={() => setStarHover(null)}
            className="flex items-center justify-center rounded-full"
            title={`${catMeta.label} · ${node.apps ?? 0} 个应用 · ${fmtDur(node.min)}`}
            style={{
              width: node.size, height: node.size,
              background: hexBg(catMeta.color, 0.28),
              boxShadow: `0 0 10px ${catMeta.color}55`,
              scale: starHover === node.key ? '1.1' : '1',
              border: `1px solid ${catMeta.color}66`,
              cursor: 'default',
            }}
          >
            <svg width={node.size * 0.5} height={node.size * 0.5} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" style={{ color: catMeta.color }}>
              <use href={`#cat-${node.cat}`} />
            </svg>
          </div>
          <span className="mt-0.5 whitespace-nowrap text-[10px] font-medium" style={{ color: catMeta.color, textShadow: '0 1px 4px rgba(0,0,0,0.6)' }}>
            {catMeta.label}
          </span>
          <span className="-mt-0.5 whitespace-nowrap text-[9px] tabular-nums text-slate-400">{fmtDur(node.min)}</span>
        </div>
      )
    }
    // 最末级：应用（可拖改工作/摸鱼；圆 + 下方常显应用名）
    const isDragging = dragFrom?.app === node.key
    const isGlance = !!node.item?.seg.glance
    const visualKey = node.item!.seg.mainApp.trim().toLowerCase().replace(/\\.exe$/i, '')
    const visual = appVisuals[visualKey]
    const chroma = (() => {
      const s = senseOf(node.item!.seg.mainState)
      if (s === 'work') return '124 158 255'
      if (s === 'slack') return '255 124 124'
      return isWork ? 'var(--star-work)' : 'var(--star-life)'
    })()
    const nodeColor = visual?.themeColor ?? chroma
    return (
      <div
        key={node.key}
        draggable
        onDragStart={() => setDragFrom({ app: node.key, col: node.item!.column })}
        onDragEnd={() => { setDragFrom(null); setHoverCol(null) }}
        onMouseEnter={(e) => { setStarHover(node.key); setStarHoverRect(e.currentTarget.getBoundingClientRect()) }}
        onMouseLeave={() => { setStarHover(null); setStarHoverRect(null) }}
        className="absolute flex flex-col items-center transition-all duration-300 cursor-grab active:cursor-grabbing group"
        style={{ left: `${node.x}%`, top: `${node.y}%`, transform: 'translate(-50%, -50%)', opacity: isDragging ? 0.25 : isGlance ? 0.3 : 1, zIndex: 5 }}
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
  }'''

t = t[:i] + new_fn + t[end:]
io.open(p, 'w', encoding='utf-8', newline='').write(t)
print('OK renderStarNode rewritten cleanly')
