# -*- coding: utf-8 -*-
"""性能补丁 v2：JSONL 缓冲写入 + 退出钩子 + 虚拟显卡过滤（反斜杠安全版）"""
import io

BS = chr(92)          # 反斜杠
NL_LIT = "'" + BS + "n'"  # TS 源码里的 '\n' 字面量（两字符）

def repl(path, old, new, count=1):
    t = io.open(path, encoding='utf-8', newline='').read()
    eol = '\r\n' if '\r\n' in t else '\n'
    o = old.replace('\n', eol)
    n = new.replace('\n', eol)
    c = t.count(o)
    assert c == count, path + ': x' + str(c) + ': ' + old[:70]
    io.open(path, 'w', encoding='utf-8', newline='').write(t.replace(o, n))
    print('OK', path, '|', old.strip().splitlines()[0][:48])

# ── db.ts：activities 缓冲 ──
repl('src/main/db.ts',
     """export function insertActivity(r: Omit<ActivityRecord, 'id'>): ActivityRecord {
  const rec: ActivityRecord = { ...r, id: actIdSeq++ }
  activities.push(rec)
  try {
    fs.appendFileSync(actFile, JSON.stringify(rec) + """ + NL_LIT + """, 'utf-8')
  } catch (e) {
    // 写入失败不再静默：主窗口弹错误横幅（用户可感知数据丢失风险）
    console.warn('[db] 活动追加失败', e)
    sendTo('main', 'error-banner', `活动记录写入失败：${(e as Error).message}（请检查磁盘空间）`)
  }
  return rec
}""",
     """// 性能：JSONL 缓冲写入（每 8s 或满 50 条批量落盘），替代每 tick 同步 appendFileSync。
// 代价：崩溃可能丢最后 ≤8s 的活动尾巴（可接受；flushNow 在退出时兜底）
let pendingActLines: string[] = []
let actFlushTimer: ReturnType<typeof setTimeout> | null = null

function flushActivityBuffer(): void {
  if (!pendingActLines.length) return
  const lines = pendingActLines
  pendingActLines = []
  try {
    fs.appendFileSync(actFile, lines.join('""" + NL_LIT + """') + '""" + NL_LIT + """', 'utf-8')
  } catch (e) {
    // 写入失败不再静默：主窗口弹错误横幅（用户可感知数据丢失风险）
    console.warn('[db] 活动批量写入失败', e)
    sendTo('main', 'error-banner', `活动记录写入失败：${(e as Error).message}（请检查磁盘空间）`)
  }
}

function scheduleActFlush(): void {
  if (actFlushTimer) return
  actFlushTimer = setTimeout(() => {
    actFlushTimer = null
    flushActivityBuffer()
  }, 8000)
}

export function insertActivity(r: Omit<ActivityRecord, 'id'>): ActivityRecord {
  const rec: ActivityRecord = { ...r, id: actIdSeq++ }
  activities.push(rec)
  pendingActLines.push(JSON.stringify(rec))
  if (pendingActLines.length >= 50) flushActivityBuffer()
  else scheduleActFlush()
  return rec
}""")

# ── db.ts：识别日志缓冲 ──
repl('src/main/db.ts',
     """export function insertRecognitionLog(r: Omit<RecognitionLogRecord, 'id'>): void {
  const rec: RecognitionLogRecord = { ...r, id: recogIdSeq++ }
  try {
    fs.appendFileSync(recogFile, JSON.stringify(rec) + """ + NL_LIT + """, 'utf-8')
  } catch (e) {
    console.warn('[db] 识别日志追加失败', e)
  }
}""",
     """let pendingRecog: RecognitionLogRecord[] = []
let recogFlushTimer: ReturnType<typeof setTimeout> | null = null

function flushRecogBuffer(): void {
  if (!pendingRecog.length) return
  const recs = pendingRecog
  pendingRecog = []
  try {
    fs.appendFileSync(recogFile, recs.map((r) => JSON.stringify(r)).join('""" + NL_LIT + """') + '""" + NL_LIT + """', 'utf-8')
  } catch (e) {
    console.warn('[db] 识别日志批量写入失败', e)
  }
}

function scheduleRecogFlush(): void {
  if (recogFlushTimer) return
  recogFlushTimer = setTimeout(() => {
    recogFlushTimer = null
    flushRecogBuffer()
  }, 8000)
}

export function insertRecognitionLog(r: Omit<RecognitionLogRecord, 'id'>): void {
  const rec: RecognitionLogRecord = { ...r, id: recogIdSeq++ }
  pendingRecog.push(rec)
  if (pendingRecog.length >= 50) flushRecogBuffer()
  else scheduleRecogFlush()
}""")

# ── db.ts：listRecent 合并缓冲 + flushNow 兜底 ──
repl('src/main/db.ts',
     """export function listRecentRecognitionLogs(n = 20): RecognitionLogRecord[] {
  try {
    if (!fs.existsSync(recogFile)) return []
    const lines = fs.readFileSync(recogFile, 'utf-8').split('""" + NL_LIT + """').filter(Boolean)
    const out: RecognitionLogRecord[] = []
    for (const line of lines.slice(-n)) {
      try { out.push(JSON.parse(line) as RecognitionLogRecord) } catch { /* 跳过坏行 */ }
    }
    return out
  } catch {
    return []
  }
}""",
     """export function listRecentRecognitionLogs(n = 20): RecognitionLogRecord[] {
  try {
    const pending = pendingRecog.slice(-n)
    const fromFile: RecognitionLogRecord[] = []
    if (fs.existsSync(recogFile)) {
      const lines = fs.readFileSync(recogFile, 'utf-8').split('""" + NL_LIT + """').filter(Boolean)
      for (const line of lines.slice(-n)) {
        try { fromFile.push(JSON.parse(line) as RecognitionLogRecord) } catch { /* 跳过坏行 */ }
      }
    }
    return [...fromFile, ...pending].slice(-n)
  } catch {
    return []
  }
}""")
repl('src/main/db.ts',
     """export function flushNow(): void {
  try {
    fs.writeFileSync(jsonFile, JSON.stringify(data), 'utf-8')
  } catch (e) {
    console.warn('[db] db.json 落盘失败', e)
  }""",
     """export function flushNow(): void {
  flushActivityBuffer()
  flushRecogBuffer()
  try {
    fs.writeFileSync(jsonFile, JSON.stringify(data), 'utf-8')
  } catch (e) {
    console.warn('[db] db.json 落盘失败', e)
  }""")

# ── index.ts：退出关常驻采集进程 ──
repl('src/main/index.ts',
     "import { detectHardware } from './hardwareDetect'",
     "import { detectHardware } from './hardwareDetect'\nimport { stopWinInfoServer } from './winInfo'")
repl('src/main/index.ts',
     "  unregisterShortcuts()\n  disposeModelClient()\n  flushNow()",
     "  unregisterShortcuts()\n  disposeModelClient()\n  stopWinInfoServer()\n  flushNow()")

# ── hardwareDetect：过滤虚拟显示适配 ──
repl('src/main/hardwareDetect.ts',
     """  const gpus = await queryGPU()
  // 找独显（非核显的第一个）
  const discreteGPU = gpus.find((g) => !isIntegratedGPU(g.name))""",
     """  const gpus = await queryGPU()
  // 虚拟显示适配（向日葵 OrayIdd/远程串流等）不是真独显，排除掉避免污染等级判定
  const VIRTUAL_GPU_HINTS = ['idd', 'oray', 'virtual', 'indirect', 'basic render', 'hyper-v', 'vmware', 'vbox', 'parsec', 'mirror']
  const isVirtual = (name: string): boolean => {
    const low = name.toLowerCase()
    return VIRTUAL_GPU_HINTS.some((h) => low.includes(h))
  }
  // 找独显（非核显且非虚拟适配的第一个）
  const discreteGPU = gpus.find((g) => !isIntegratedGPU(g.name) && !isVirtual(g.name))""")

print('perf v2 done')
