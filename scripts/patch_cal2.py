# -*- coding: utf-8 -*-
"""B18 校验逻辑/状态 + B20 日期字段（hint 渲染已在位）"""
import io, re

BS = chr(92)

p = 'src/renderer/src/views/CalendarView.tsx'
t = io.open(p, encoding='utf-8', newline='').read()

# 1) B18 校验逻辑
old1 = (
    "    if (!draft.title.trim()) return\n"
    "    const startMin = Math.max(0, Math.min(draft.startMin, draft.endMin - 5))"
)
new1 = (
    "    if (draft.endMin <= draft.startMin) {\n"
    "      setTimeHint('结束时间需晚于开始时间（至少 5 分钟），已自动修正')\n"
    "    } else {\n"
    "      setTimeHint('')\n"
    "    }\n"
    "    if (!draft.title.trim()) return\n"
    "    const startMin = Math.max(0, Math.min(draft.startMin, draft.endMin - 5))"
)
assert t.count(old1) == 1, 'B18 x' + str(t.count(old1))
t = t.replace(old1, new1)

# 2) timeHint 状态
old2 = "  const [draft, setDraft] = useState<TimeEntry>(entry)"
assert t.count(old2) == 1
t = t.replace(old2, old2 + "\n  const [timeHint, setTimeHint] = useState('')")

# 3) B20 日期字段（标题输入框后）
i = t.find('value={draft.title}')
assert i > 0, 'title anchor'
line_start = t.rfind('\n', 0, i) + 1
indent = t[line_start:i]
j = t.find('/>', i)
j = t.find('\n', j)
date_block = (
    indent + '<label className="flex items-center gap-1.5 text-[11px] text-slate-500">' + '\n'
    + indent + '  日期' + '\n'
    + indent + '  <input type="date" value={draft.date}' + '\n'
    + indent + '    onChange={(e) => setDraft((d) => ({ ...d, date: e.target.value }))}' + '\n'
    + indent + '    className="glass-input !px-2 !py-1 !text-[11px]"' + '\n'
    + indent + '  />' + '\n'
    + indent + '</label>' + '\n'
)
t = t[:j + 1] + date_block + t[j + 1:]

io.open(p, 'w', encoding='utf-8', newline='').write(t)
print('OK all in')
