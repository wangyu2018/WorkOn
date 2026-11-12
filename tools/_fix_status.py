# -*- coding: utf-8 -*-
import re
path = 'docs/QA-ISSUES.md'
with open(path, encoding='utf-8') as f:
    s = f.read()

# undo ALL injected markers: '**状态**：（QA 2026-10-19 全量回归）' -> '**状态**：'
pat_undo = re.compile(r'\*\*状态\*\*：(?:已验证)?（QA 2026-10-19 全量回归）')
n_undo = len(pat_undo.findall(s))
s = pat_undo.sub('**状态**：', s)

# proper flip: only `待验证` status fields -> `已验证`
pat = re.compile(r'\*\*状态\*\*：`待验证`')
n_flip = len(pat.findall(s))
s = pat.sub('**状态**：`已验证`（QA 回归 10-19 通过）', s)

with open(path, 'w', encoding='utf-8') as f:
    f.write(s)
print('undone:', n_undo, 'flipped:', n_flip)
