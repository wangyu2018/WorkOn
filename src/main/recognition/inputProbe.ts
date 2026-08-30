/**
 * 行为探针（识别二期）：uiohook-napi 全局键鼠事件 → 滑动窗口聚合计数
 *
 * 隐私口径（硬约束）：
 *   - 只保留「计数 / 事件类别 / 快捷键组合名」，绝不记录键入内容、键码序列、剪贴板文本
 *   - 剪贴板只比对内容哈希判断"是否变化"，不存储内容
 *   - 聚合窗口仅最近 10 秒，更早的数据即丢
 *
 * 特征消费方：featureBuilder.buildFeatures() 的 behavior 参数（action_type/has_shortcut 真实化）
 */
import { clipboard } from 'electron'
import { uIOhook, UiohookKey, type UiohookKeyboardEvent } from 'uiohook-napi'
import type { BehaviorSnapshot } from './types'

/** 滑动窗口时长 */
const WINDOW_SEC = 10
/** 剪贴板轮询间隔 */
const CLIPBOARD_POLL_MS = 500
/** 连续启动失败上限（超过后停用至下次 start 调用） */
const MAX_START_FAILURES = 3

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

let started = false
let startFailures = 0
let hookBound = false
let clipboardTimer: NodeJS.Timeout | null = null
let clipHash = 0
let clipboardChangedAt = 0
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

function pruneOld(now: number): void {
  const cutoff = Math.floor(now / 1000) - WINDOW_SEC
  while (buckets.length && buckets[0].t < cutoff) buckets.shift()
}

function sumWindow(): { typeKeys: number; clicks: number; wheels: number } {
  pruneOld(Date.now())
  const agg = { typeKeys: 0, clicks: 0, wheels: 0 }
  for (const b of buckets) {
    agg.typeKeys += b.typeKeys
    agg.clicks += b.clicks
    agg.wheels += b.wheels
  }
  return agg
}

function onKey(e: UiohookKeyboardEvent): void {
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
  // Ctrl+字母 组合识别（隐私口径：只记组合名，不记普通键码）
  if (e.ctrlKey && !lastShortcutCtrl) {
    const name = CTRL_COMBOS[e.keycode]
    if (name) {
      lastShortcut = { name, ts: Date.now() }
    }
  }
  lastShortcutCtrl = e.ctrlKey
}

function onMouse(): void {
  nowBucket(Date.now()).clicks++
  clickTotal++
}

function onWheel(): void {
  nowBucket(Date.now()).wheels++
  wheelTotal++
}

function pollClipboard(): void {
  try {
    // 无文本格式（纯文件/图片复制）直接跳过读取；availableFormats 极廉价
    const formats = clipboard.availableFormats()
    if (!formats.includes('text/plain')) return
    const text = clipboard.readText() ?? ''
    // 只用长度+简单哈希，不保留内容
    let h = 0
    for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) | 0
    if (text.length > 0 && h !== clipHash) {
      clipHash = h
      clipboardChangedAt = Date.now()
    }
  } catch {
    /* 剪贴板读取失败忽略 */
  }
}

/** 探针是否在运行 */
export function isProbeActive(): boolean {
  return started
}

/** 启动探针（幂等；设置 inputProbeEnabled 打开时调用） */
export function startInputProbe(): void {
  if (started) return
  if (startFailures >= MAX_START_FAILURES) return
  try {
    if (!hookBound) {
      uIOhook.on('keydown', onKey)
      uIOhook.on('mousedown', onMouse)
      uIOhook.on('wheel', onWheel)
      hookBound = true
    }
    uIOhook.start()
    if (!clipboardTimer) {
      pollClipboard()
      clipboardTimer = setInterval(pollClipboard, CLIPBOARD_POLL_MS)
    }
    started = true
    startFailures = 0
    console.info('[probe] 行为探针已启动（仅聚合计数，不记录内容）')
  } catch (e) {
    startFailures++
    console.warn(`[probe] 启动失败（${startFailures}/${MAX_START_FAILURES}）:`, (e as Error).message)
    if (startFailures >= MAX_START_FAILURES) console.warn('[probe] 连续失败达上限，探针停用（识别走占位特征）')
  }
}

/** 停止探针（设置关闭/退出时调用） */
export function stopInputProbe(): void {
  if (!started && !hookBound) return
  try { uIOhook.stop() } catch { /* ignore */ }
  if (clipboardTimer) {
    clearInterval(clipboardTimer)
    clipboardTimer = null
  }
  started = false
  console.info('[probe] 行为探针已停止')
}

/** 最近 WINDOW_SEC 秒的行为聚合快照（探针未运行时返回 null → featureBuilder 走占位特征） */
export function getBehaviorWindow(): BehaviorSnapshot | null {
  if (!started) return null
  const now = Date.now()
  const agg = sumWindow()
  const shortAge = lastShortcut ? now - lastShortcut.ts : Infinity
  const clipAge = clipboardChangedAt ? now - clipboardChangedAt : Infinity
  const isPaste = lastShortcut?.name === 'paste' && shortAge < 2500 && clipAge < 3000
  const isCopy = lastShortcut?.name === 'copy' && shortAge < 2500 && clipAge < 3000
  return {
    windowSec: WINDOW_SEC,
    typeKeys: agg.typeKeys,
    clicks: agg.clicks,
    wheels: agg.wheels,
    typeKeyTotal,
    clickTotal,
    wheelTotal,
    hasShortcut: shortAge < 5000,
    lastShortcutName: lastShortcut?.name ?? null,
    lastShortcutAgeMs: lastShortcut ? Math.round(shortAge) : null,
    clipboardChangedAgeMs: clipboardChangedAt ? Math.round(clipAge) : null,
    pasteHint: isPaste,
    copyHint: isCopy
  }
}
