# -*- coding: utf-8 -*-
"""hover 卡定位回退：锚在段块上方，不跟随鼠标（修抖动/拖拽失效）"""
import io

p = 'src/renderer/src/views/HomeView.tsx'
t = io.open(p, encoding='utf-8', newline='').read()
eol = '\r\n' if '\r\n' in t else '\n'

old = (
    "            pos: { x: tlHover.mouse?.x ?? tlHover.rect.left + tlHover.rect.width / 2, "
    "y: (tlHover.mouse?.y ?? tlHover.rect.top) - 10 },"
)
new = (
    "            pos: { x: tlHover.rect.left + tlHover.rect.width / 2, y: tlHover.rect.top - 8 },"
)
o = old.replace('\n', eol)
c = t.count(o)
assert c == 1, 'x' + str(c)
t = t.replace(o, new.replace('\n', eol))
io.open(p, 'w', encoding='utf-8', newline='').write(t)
print('OK hover pos reverted')
