/**
 * 行为探针 Worker 入口：在独立线程运行 uiohook-napi。
 *
 * 为什么要另起线程：macOS 上原生输入钩子初始化偶尔会在 `uIOhook.start()` 内长时间阻塞，
 * 放在主进程会直接冻住整个应用。隔离到 worker 后，最坏只是探针不可用，界面与 IPC 不受影响。
 *
 * 隐私口径与主进程一致：只回传计数与快捷键组合名，不回传键码序列或任何文本。
 */
import { parentPort } from 'node:worker_threads'
import { uIOhook, UiohookKey, type UiohookKeyboardEvent } from 'uiohook-napi'

/** 滑动窗口时长 */
const WINDOW_SEC = 10
/** 快照回传间隔 */
const FLUSH_MS = 500

interface Bucket {
  t: number
  typeKeys: number
  clicks: number
  wheels: number
}

type ShortcutName = 'copy' | 'paste' | 'cut' | 'save' | 'find' | 'undo'

/** Ctrl+字母 组合（linux 键码，来自 UiohookKey） */
const CTRL_COMBOS: Record<number, ShortcutName> = {
  [UiohookKey.C]: 'copy',
  [UiohookKey.V]: 'paste',
  [UiohookKey.X]: 'cut',
  [UiohookKey.S]: 'save',
  [UiohookKey.F]: 'find',
  [UiohookKey.Z]: 'undo'
}

let lastShortcut: { name: ShortcutName; ts: number } | null = null
let lastShortcutCtrl = false
let typeKeyTotal = 0
let clickTotal = 0
let wheelTotal = 0
const buckets: Bucket[] = []

function nowBucket(t: number): Bucket {
  const sec = Math.floor(t / 1000)
  let b = buckets[buckets.length - 1]
  if (!b || b.t !== sec) {
    b = { t: sec, typeKeys: 0, clicks: 0, wheels: 0 }
    buckets.push(b)
    while (buckets.length > WINDOW_SEC + 2) buckets.shift()
  }
  return b
}

function sumWindow(): { typeKeys: number; clicks: number; wheels: number } {
  const cutoff = Math.floor(Date.now() / 1000) - WINDOW_SEC
  while (buckets.length && buckets[0].t < cutoff) buckets.shift()
  const agg = { typeKeys: 0, clicks: 0, wheels: 0 }
  for (const b of buckets) {
    agg.typeKeys += b.typeKeys
    agg.clicks += b.clicks
    agg.wheels += b.wheels
  }
  return agg
}

uIOhook.on('keydown', (e: UiohookKeyboardEvent) => {
  if (e.type !== 4) return // 只统计 KEY_PRESSED
  const b = nowBucket(Date.now())
  // 修饰键/功能键不算"打字"
  const isModifier =
    e.keycode === UiohookKey.Ctrl || e.keycode === UiohookKey.CtrlRight ||
    e.keycode === UiohookKey.Alt || e.keycode === UiohookKey.AltRight ||
    e.keycode === UiohookKey.Shift || e.keycode === UiohookKey.ShiftRight ||
    e.keycode === UiohookKey.Meta || e.keycode === UiohookKey.MetaRight
  if (!isModifier) b.typeKeys++
  typeKeyTotal++
  if (e.ctrlKey && !lastShortcutCtrl) {
    const name = CTRL_COMBOS[e.keycode]
    if (name) lastShortcut = { name, ts: Date.now() }
  }
  lastShortcutCtrl = e.ctrlKey
})
uIOhook.on('mousedown', () => {
  nowBucket(Date.now()).clicks++
  clickTotal++
})
uIOhook.on('wheel', () => {
  nowBucket(Date.now()).wheels++
  wheelTotal++
})

uIOhook.start()
parentPort?.postMessage({ type: 'ready' })

setInterval(() => {
  const agg = sumWindow()
  parentPort?.postMessage({
    type: 'snapshot',
    windowSec: WINDOW_SEC,
    ...agg,
    typeKeyTotal,
    clickTotal,
    wheelTotal,
    lastShortcutName: lastShortcut?.name ?? null,
    lastShortcutAt: lastShortcut?.ts ?? null
  })
}, FLUSH_MS)

parentPort?.on('message', (msg: { type?: string }) => {
  if (msg?.type === 'stop') {
    try { uIOhook.stop() } catch { /* ignore */ }
    process.exit(0)
  }
})
