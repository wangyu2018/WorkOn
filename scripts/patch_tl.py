# -*- coding: utf-8 -*-
"""时间轴视觉改版：碎片聚合 + 段块增饱和 + 状态图例"""
import io, re

p = 'src/renderer/src/views/HomeView.tsx'
t = io.open(p, encoding='utf-8', newline='').read()

def rep(old, new, count=1):
    global t
    eol = '\r\n' if '\r\n' in t else '\n'
    o = old.replace('\n', eol)
    n = new.replace('\n', eol)
    c = t.count(o)
    assert c == count, 'x' + str(c) + ': ' + old[:70]
    t = t.replace(o, n)
    print('OK |', old.strip().splitlines()[0][:52])

# 1) 段块增饱和（0.36/0.12 → 0.5/0.22）+ 1px 描边
rep(
    "                 background: ghost ? 'rgba(136,135,128,0.12)' : `linear-gradient(180deg, rgb(${chroma}/0.36), rgb(${chroma}/0.12))`,\n"
    "                 border: ghost ? '1px dashed var(--tl-other-stroke)' : 'none',",
    "                 background: ghost ? 'rgba(136,135,128,0.12)' : `linear-gradient(180deg, rgb(${chroma}/0.5), rgb(${chroma}/0.2))`,\n"
    "                 border: ghost ? '1px dashed var(--tl-other-stroke)' : `1px solid rgb(${chroma}/0.35)`,")

# 2) 碎片聚合 helper（插在 todayByCategory.map 之前）+ 两处泳道改用
rep(
    "                {/* 时间轴按分类聚合：泳道 = 分类，段块按真实时间铺，hover 显示应用详情 */}\n"
    "                {todayByCategory.map(({ cat, apps, min }) => {",
    """                {/* 时间轴按分类聚合：泳道 = 分类；碎片聚合：渲染宽 <4px 的相邻碎片合并成块 */}
                {(() => {
                  (window as unknown as Record<string, unknown>).__densify = (arr: TrailSegment[]) => {
                    const sorted = [...arr].sort((a, b) => {
                      const a0 = new Date(a.startTs), b0 = new Date(b.startTs)
                      return (a0.getHours() * 60 + a0.getMinutes()) - (b0.getHours() * 60 + b0.getMinutes())
                    })
                    const out: TrailSegment[] = []
                    let run: TrailSegment[] = []
                    const flush = () => {
                      if (!run.length) return
                      if (run.length === 1) out.push(run[0])
                      else {
                        const first = run[0], last = run[run.length - 1]
                        out.push({ ...first, endTs: last.endTs, durationMin: Math.max(0.5, (last.endTs - first.startTs) / 60000) })
                      }
                      run = []
                    }
                    for (const s of sorted) {
                      if ((ruler.durToW(s.durationMin || 0.5)) < 4) { run.push(s); if ((ruler.durToW(run.reduce((a, x) => a + (x.durationMin || 0.5), 0))) >= 6) flush() }
                      else { flush(); out.push(s) }
                    }
                    flush()
                    return out
                  }
                  return null
                })()}
                {todayByCategory.map(({ cat, apps, min }) => {""")

# 3) 分类泳道 + 应用泳道段块铺放改用 densify
rep(
    "{apps.flatMap(([, segsArr]) => segsArr.map((s) => renderSegBlock(s.seg, ruler.minToX(startMinOf(s.seg)), ruler.durToW(s.seg.durationMin || 0.5), rgb)))}",
    "{apps.flatMap(([, segsArr]) => densify(segsArr).map((s) => renderSegBlock(s.seg, ruler.minToX(startMinOf(s.seg)), ruler.durToW(s.seg.durationMin || 0.5), rgb)))}")

# 4) header 加状态图例（工作/摸鱼/其他）
rep(
    """              <span className="text-[13px] font-semibold text-slate-200">今日操作</span>
              <span className="text-[11px] text-slate-500">按分类聚合 · 可展开应用泳道 · 拖拽归类</span>""",
    """              <span className="text-[13px] font-semibold text-slate-200">今日操作</span>
              <span className="text-[11px] text-slate-500">按分类聚合 · 可展开应用泳道 · 拖拽归类</span>
              <span className="ml-auto flex items-center gap-2.5 text-[10px] text-slate-500">
                <span className="flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-full" style={{ background: 'rgb(124 158 255)' }} />工作</span>
                <span className="flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-full" style={{ background: 'rgb(255 124 124)' }} />摸鱼</span>
                <span className="flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-full" style={{ background: 'rgb(148 163 184)' }} />其他</span>
              </span>""")

io.open(p, 'w', encoding='utf-8', newline='').write(t)
print('timeline visual done')
