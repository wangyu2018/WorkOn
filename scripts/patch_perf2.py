# -*- coding: utf-8 -*-
"""性能补丁收尾：listRecent/flushNow/退出钩子/虚拟显卡过滤"""
import io

BS = chr(92)

def repl(path, old, new, count=1):
    t = io.open(path, encoding='utf-8', newline='').read()
    eol = '\r\n' if '\r\n' in t else '\n'
    o = old.replace('\n', eol)
    n = new.replace('\n', eol)
    c = t.count(o)
    assert c == count, path + ': x' + str(c) + ': ' + old[:70]
    io.open(path, 'w', encoding='utf-8', newline='').write(t.replace(o, n))
    print('OK', path, '|', old.strip().splitlines()[0][:48])

# listRecent 合并未落盘缓冲
repl('src/main/db.ts',
     """export function listRecentRecognitionLogs(n = 20): RecognitionLogRecord[] {
  try {
    if (!fs.existsSync(recogFile)) return []
    const lines = fs.readFileSync(recogFile, 'utf-8').split('""" + BS + """n').filter(Boolean)
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
      const lines = fs.readFileSync(recogFile, 'utf-8').split('""" + BS + """n').filter(Boolean)
      for (const line of lines.slice(-n)) {
        try { fromFile.push(JSON.parse(line) as RecognitionLogRecord) } catch { /* 跳过坏行 */ }
      }
    }
    return [...fromFile, ...pending].slice(-n)
  } catch {
    return []
  }
}""")

# flushNow 兜底两个缓冲
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

# index.ts：退出关常驻采集进程
repl('src/main/index.ts',
     "import { detectHardware } from './hardwareDetect'",
     "import { detectHardware } from './hardwareDetect'\nimport { stopWinInfoServer } from './winInfo'")
repl('src/main/index.ts',
     "  unregisterShortcuts()\n  disposeModelClient()\n  flushNow()",
     "  unregisterShortcuts()\n  disposeModelClient()\n  stopWinInfoServer()\n  flushNow()")

# hardwareDetect：过滤虚拟显示适配
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

print('perf finalize done')
