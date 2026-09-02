# -*- coding: utf-8 -*-
"""B20 日期字段 + B18 校验提示（CalendarView 编辑器）"""
import io

BS = None

def load(p):
    return io.open(p, encoding='utf-8', newline='').read()

def save(p, t):
    io.open(p, 'w', encoding='utf-8', newline='').write(t)

p = 'src/renderer/src/views/CalendarView.tsx'
t = load(p)

# B18：校验提示逻辑 + 状态
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
assert t.count(old1) == 1, 'B18 logic anchor x' + str(t.count(old1))
t = t.replace(old1, new1)

old2 = "  const [draft, setDraft] = useState<TimeEntry>(entry)"
assert t.count(old2) == 1
t = t.replace(old2, old2 + "\n  const [timeHint, setTimeHint] = useState('')")

# B20：日期字段（插在标题输入框之后）
i = t.find('value={draft.title}')
assert i > 0
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

# 提示渲染：保存按钮前
m2 = re.search(r'( +)<button className="glass-btn primary" disabled=\{!draft\.title\.trim\(\)\}', t)
assert m2, 'save button anchor'
ind = m2.group(1)
btn_line_start = t.rfind('\n', 0, m2.start()) + 1
hint = ind + "{timeHint ? <div className=\"mb-1.5 text-[11px] text-amber-300\">⚠ {timeHint}</div> : null}" + '\n'
t = t[:btn_line_start] + hint + t[btn_line_start:]

save(p, t)
print('OK B18/B20 all in')
