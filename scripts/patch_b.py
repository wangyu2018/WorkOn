# -*- coding: utf-8 -*-
"""B 工作流补丁：ocrShots 索引 + 按时间保留 + qa:askWithShots"""
import io

def repl(path, old, new, count=1):
    t = io.open(path, encoding='utf-8', newline='').read()
    eol = '\r\n' if '\r\n' in t else '\n'
    o = old.replace('\n', eol)
    n = new.replace('\n', eol)
    c = t.count(o)
    assert c == count, path + ': x' + str(c) + ': ' + old[:60]
    io.open(path, 'w', encoding='utf-8', newline='').write(t.replace(o, n))
    print('OK', path)

RX = chr(92)  # 反斜杠
DOTSLASH_PNG = '/.' + RX + '.(png|jpg)$/'
SHOT_RE = 'shot-(' + RX + 'd+)' + RX + '.'

# ── 1) shared/types.ts：OcrShot 类型 ──
repl('src/shared/types.ts',
     'export interface OcrSnapshot {',
     '''/** 截图↔OCR 索引（backlog P0）：截图文件与结构化快照的关联记录（按时间窗召回用） */
export interface OcrShot {
  id: string
  ts: number // 截图时刻（= 文件名时间戳，非 OCR 完成时刻）
  file: string // 截图绝对路径
  app: string
  state: WorkState
  keywords: string[] // 行业关键词（复用 ocrCollector 提取）
  classify?: string | null // 内容类别（classifyOcrText）
}

export interface OcrSnapshot {''')

# ── 2) db.ts：导入 + 集合 + EMPTY ──
repl('src/main/db.ts',
     '  Project, ProjectTask, ProjectTimeLink,\n  RecognitionLogRecord\n} from \'@shared/types\'',
     '  Project, ProjectTask, ProjectTimeLink,\n  RecognitionLogRecord, OcrShot\n} from \'@shared/types\'')
repl('src/main/db.ts',
     '  ocrSnapshots: OcrSnapshot[]',
     '  ocrSnapshots: OcrSnapshot[]\n  ocrShots: OcrShot[] // 截图↔OCR 索引（P0）')

import re
t = io.open('src/main/db.ts', encoding='utf-8', newline='').read()
m = re.search(r'const EMPTY[^=]*= \{[^}]*\}', t)
assert m, 'EMPTY not found'
if 'ocrShots' not in m.group(0):
    eol = '\r\n' if '\r\n' in t else '\n'
    old_e = m.group(0)
    # 在 EMPTY 对象的结尾 } 前插入一行
    idx = t.index(old_e)
    body_end = t.rindex('}', idx, idx + len(old_e))
    t = t[:body_end] + ',' + eol + '  ocrShots: []' + eol + '  ' + t[body_end:]
    io.open('src/main/db.ts', 'w', encoding='utf-8', newline='').write(t)
    print('OK db EMPTY')

# ── 3) ocrWorker.ts：广播带 file + 按时间清理 ──
repl('src/main/ocrWorker.ts',
     'export type OcrLinesListener = (lines: string[], app: string, state: WorkState) => void',
     'export type OcrLinesListener = (lines: string[], app: string, state: WorkState, shotFile: string) => void')
repl('src/main/ocrWorker.ts',
     "/** 截图落盘目录 */\nfunction shotsDir(): string {\n  return path.join(app.getPath('userData'), 'screenshots')\n}",
     "/** 截图落盘目录 */\nfunction shotsDir(): string {\n  return path.join(app.getPath('userData'), 'screenshots')\n}\n\n/** 最近一次截图落盘路径（runOcr 广播给 ocrShots 索引用） */\nlet lastShotFile: string | null = null")
repl('src/main/ocrWorker.ts',
     """      // 只保留最近 N 张（缓存上限可配）
      const limit = Math.max(50, getSettings().ocrCacheLimit || 200)
      const files = fs.readdirSync(dir).filter((f) => /\\.(png|jpg)$/.test(f)).sort()
      if (files.length > limit) {
        for (const f of files.slice(0, files.length - limit)) {
          try { fs.unlinkSync(path.join(dir, f)) } catch { /* ignore */ }
        }
      }""",
      """      lastShotFile = file
      // 保留策略（P0 按时间为主）：超过 ocrCleanupDays 天（0=永不）删除；
      // 张数上限仅作兜底（防极端高频轮写撑爆磁盘）
      const days = Math.max(0, getSettings().ocrCleanupDays ?? 14)
      const limit = Math.max(50, getSettings().ocrCacheLimit || 200)
      const files = fs.readdirSync(dir).filter((f) => new RegExp(DOTSLASH_PNG).test(f)).sort()
      const cutoff = days > 0 ? Date.now() - days * 86400000 : 0
      let removed = 0
      for (let i = 0; i < files.length - limit; i++, removed++) {
        try { fs.unlinkSync(path.join(dir, files[i])) } catch { /* ignore */ }
      }
      if (cutoff > 0) {
        for (const f of files) {
          try {
            const st = fs.statSync(path.join(dir, f))
            if (st.mtimeMs < cutoff) {
              fs.unlinkSync(path.join(dir, f))
              removed++
            }
          } catch { /* ignore */ }
        }
      }
      if (removed > 0 && !fs.existsSync(file)) lastShotFile = null""")
repl('src/main/ocrWorker.ts',
     """      for (const cb of ocrLinesListeners) {
        try {
          cb(lines, main?.app ?? '', snap.state)
        } catch { /* ignore */ }
      }""",
     """      for (const cb of ocrLinesListeners) {
        try {
          cb(lines, main?.app ?? '', snap.state, lastShotFile ?? '')
        } catch { /* ignore */ }
      }""")

# DOTSLASH_PNG 是 python 侧占位——上面的 new RegExp(DOTSLASH_PNG) 需要换成真实正则字面量
t = io.open('src/main/ocrWorker.ts', encoding='utf-8', newline='').read()
assert 'new RegExp(DOTSLASH_PNG)' in t
t = t.replace('new RegExp(DOTSLASH_PNG)', 'PNG_FILE_RE')
# 在 shotsDir 函数后补正则常量定义
anchor = "let lastShotFile: string | null = null"
t = t.replace(anchor, anchor + "\nconst PNG_FILE_RE = /" + RX + ".(png|jpg)$/", 1)
io.open('src/main/ocrWorker.ts', 'w', encoding='utf-8', newline='').write(t)
print('OK ocrWorker regex const')

# ── 4) ocrCollector.ts ──
repl('src/main/report/ocrCollector.ts',
     "import type { EnrichmentResult, OcrSnapshot, ReportEntry, WorkState } from '@shared/types'",
     "import type { EnrichmentResult, OcrSnapshot, OcrShot, ReportEntry, WorkState } from '@shared/types'")
repl('src/main/report/ocrCollector.ts',
     """  onOcrLines((lines, app, state) => {
    try {
      collect(lines, app, state)
    } catch (e) {
      console.warn('[report/ocr] 采集失败', e)
    }
  })""",
     """  onOcrLines((lines, app, state, shotFile) => {
    try {
      collect(lines, app, state, shotFile)
    } catch (e) {
      console.warn('[report/ocr] 采集失败', e)
    }
  })""")
repl('src/main/report/ocrCollector.ts',
     "function collect(lines: string[], app: string, state: WorkState): void {\n  if (!lines.length || shouldSkip(app, state)) return\n  const info = extractFromOcrText(lines, app)",
     "function collect(lines: string[], app: string, state: WorkState, shotFile: string): void {\n  if (!lines.length || shouldSkip(app, state)) return\n  const info = extractFromOcrText(lines, app)")
repl('src/main/report/ocrCollector.ts',
     """  insertInto<OcrSnapshot>('ocrSnapshots', {
    id: genId('ocr'),
    ts: Date.now(),
    app,
    state,
    ...info
  })
  trimSnapshots()
}""",
     """  const snapTs = Date.now()
  insertInto<OcrSnapshot>('ocrSnapshots', {
    id: genId('ocr'),
    ts: snapTs,
    app,
    state,
    ...info
  })
  // P0：截图↔OCR 索引（有落盘文件时记录；ts 取文件名里的截图时刻）
  if (shotFile) {
    const m = shotFile.match(/""" + SHOT_RE + """/)
    insertInto<OcrShot>('ocrShots', {
      id: genId('os'),
      ts: m ? Number(m[1]) : snapTs,
      file: shotFile,
      app,
      state,
      keywords: info.keywords
    })
    trimOcrShots()
  }
  trimSnapshots()
}

/** ocrShots 裁剪：7 天前的删除（对齐结构化快照；文件本体由 ocrWorker 按天数清理） */
function trimOcrShots(): void {
  const arr = col<OcrShot>('ocrShots')
  const cutoff = Date.now() - RETAIN_DAYS * 86400000
  for (let i = arr.length - 1; i >= 0; i--) {
    if (arr[i].ts < cutoff) arr.splice(i, 1)
  }
}

/** 时间窗召回：截图索引 + 结构化快照（qa:askWithShots 用） */
export function getOcrShotsForWindow(startTs: number, endTs: number): { shots: OcrShot[]; snaps: OcrSnapshot[] } {
  const shots = col<OcrShot>('ocrShots').filter((s) => s.ts >= startTs && s.ts <= endTs)
  const snaps = col<OcrSnapshot>('ocrSnapshots').filter((s) => s.ts >= startTs && s.ts <= endTs)
  return { shots, snaps }
}

/**
 * P0：时段屏幕上下文（脱敏摘要，不含 OCR 原文）——注入 AI 问答
 */
export function screenContextForWindow(startTs: number, endTs: number): string | null {
  const { shots, snaps } = getOcrShotsForWindow(startTs, endTs)
  if (!shots.length && !snaps.length) return null
  const apps = [...new Set([...shots.map((s) => s.app), ...snaps.map((s) => s.app)])].filter(Boolean).slice(0, 6)
  const keywords = [...new Set([...shots.flatMap((s) => s.keywords), ...snaps.flatMap((s) => s.keywords)])].slice(0, 8)
  const fmt = (ts: number): string => new Date(ts).toLocaleTimeString('zh-CN', { hour12: false })
  const parts = [
    apps.length ? '涉及应用: ' + apps.join('、') : '',
    keywords.length ? '出现关键词: ' + keywords.join('、') : '',
    '截图 ' + shots.length + ' 张 / 结构化快照 ' + snaps.length + ' 条',
    '时间窗 ' + fmt(startTs) + ' ~ ' + fmt(endTs)
  ].filter(Boolean)
  return '（时段屏幕内容）' + parts.join('；')
}""")
print('B1 collector done')

# ── 5) ai.ts：两个问答函数加 screenContext 参数 ──
repl('src/main/ai.ts',
     """export async function askWithContext(
  question: string,
  analysis: UserAnalysis | null,
  trail: MergedTrail | null,
  habits?: UserHabits | null
): Promise<{ content: string | null; references: ProfileReference[] }> {""",
     """export async function askWithContext(
  question: string,
  analysis: UserAnalysis | null,
  trail: MergedTrail | null,
  habits?: UserHabits | null,
  screenContext?: string
): Promise<{ content: string | null; references: ProfileReference[] }> {""")
repl('src/main/ai.ts',
     """  const llm = await chatWithToolLoop([
    { role: 'system', content: buildSystemPrompt(analysis, habits, bus.pet.intimacy) },
    ...(facts ? [{ role: 'user' as const, content: `（当日事实）${JSON.stringify(facts)}` }] : []),""",
     """  const llm = await chatWithToolLoop([
    { role: 'system', content: buildSystemPrompt(analysis, habits, bus.pet.intimacy) },
    ...(screenContext ? [{ role: 'user' as const, content: screenContext }] : []),
    ...(facts ? [{ role: 'user' as const, content: `（当日事实）${JSON.stringify(facts)}` }] : []),""")
repl('src/main/ai.ts',
     """export async function askWithContextStream(
  question: string,
  analysis: UserAnalysis | null,
  trail: MergedTrail | null,
  onChunk: StreamCallback,
  onToolCall?: (toolName: string) => void,
  habits?: UserHabits | null
): Promise<{ content: string; references: ProfileReference[] }> {""",
     """export async function askWithContextStream(
  question: string,
  analysis: UserAnalysis | null,
  trail: MergedTrail | null,
  onChunk: StreamCallback,
  onToolCall?: (toolName: string) => void,
  habits?: UserHabits | null,
  screenContext?: string
): Promise<{ content: string; references: ProfileReference[] }> {""")
repl('src/main/ai.ts',
     """    [
      { role: 'system', content: buildSystemPrompt(analysis, habits, bus.pet.intimacy) },
      ...(facts ? [{ role: 'user' as const, content: `（当日事实）${JSON.stringify(facts)}` }] : []),
      ...(confirmed.length""",
     """    [
      { role: 'system', content: buildSystemPrompt(analysis, habits, bus.pet.intimacy) },
      ...(screenContext ? [{ role: 'user' as const, content: screenContext }] : []),
      ...(facts ? [{ role: 'user' as const, content: `（当日事实）${JSON.stringify(facts)}` }] : []),
      ...(confirmed.length""")
print('B3 ai done')
print('ALL PATCHES APPLIED')
