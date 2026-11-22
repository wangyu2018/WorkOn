/**
 * 行为探针（识别二期）：全局键鼠事件 → 滑动窗口聚合计数
 *
 * 结构：原生钩子（uiohook-napi）跑在独立 Worker 线程里（见 inputProbeWorker.ts），
 * 主进程只做剪贴板哈希比对与快照拼装。
 *
 * 为什么隔离：macOS 上 `uIOhook.start()` 偶发在原生层长时间阻塞，放在主进程会冻住整个应用；
 * 放到 worker 后最坏只是探针不可用。启动带超时看门狗，超时即终止 worker 并降级。
 *
 * 隐私口径（硬约束）：
 *   - 只保留「计数 / 事件类别 / 快捷键组合名」，绝不记录键入内容、键码序列、剪贴板文本
 *   - 剪贴板只比对内容哈希判断"是否变化"，不存储内容
 *   - 聚合窗口仅最近 10 秒，更早的数据即丢
 *
 * 特征消费方：featureBuilder.buildFeatures() 的 behavior 参数（action_type/has_shortcut 真实化）
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { Worker } from 'node:worker_threads'
import { clipboard } from 'electron'
import type { BehaviorSnapshot } from './types'

/** 滑动窗口时长 */
const WINDOW_SEC = 10
/** 剪贴板轮询间隔 */
const CLIPBOARD_POLL_MS = 500
/** 连续启动失败上限（超过后停用至下次 start 调用） */
const MAX_START_FAILURES = 3
/** worker 就绪超时：超过即视为原生钩子卡住，隔离并降级 */
const WORKER_READY_TIMEOUT_MS = 3000

type ShortcutName = 'copy' | 'paste' | 'cut' | 'save' | 'find' | 'undo'

interface WorkerSnapshot {
  windowSec: number
  typeKeys: number
  clicks: number
  wheels: number
  typeKeyTotal: number
  clickTotal: number
  wheelTotal: number
  lastShortcutName: ShortcutName | null
  lastShortcutAt: number | null
}

let started = false
let startFailures = 0
let worker: Worker | null = null
let readyTimer: NodeJS.Timeout | null = null
let clipboardTimer: NodeJS.Timeout | null = null
let clipHash = 0
let clipboardChangedAt = 0
let latest: WorkerSnapshot | null = null

function clearReadyTimer(): void {
  if (readyTimer) {
    clearTimeout(readyTimer)
    readyTimer = null
  }
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

function markFailed(reason: string): void {
  startFailures++
  started = false
  latest = null
  if (startFailures >= MAX_START_FAILURES) {
    console.warn('[probe] 连续失败达上限，探针停用（识别走占位特征）')
  } else {
    console.warn(`[probe] ${reason}（${startFailures}/${MAX_START_FAILURES}）`)
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
  const file = join(__dirname, 'inputProbeWorker.js').replace('app.asar', 'app.asar.unpacked')
  if (!existsSync(file)) {
    markFailed('未找到探针 worker 产物，跳过启动')
    return
  }
  try {
    const w = new Worker(file)
    worker = w
    w.on('message', (msg: { type?: string } & Partial<WorkerSnapshot>) => {
      if (msg?.type === 'ready') {
        clearReadyTimer()
        started = true
        startFailures = 0
        if (!clipboardTimer) {
          pollClipboard()
          clipboardTimer = setInterval(pollClipboard, CLIPBOARD_POLL_MS)
        }
        console.info('[probe] 行为探针已启动（仅聚合计数，不记录内容）')
        return
      }
      if (msg?.type === 'snapshot' && msg.windowSec) {
        latest = msg as WorkerSnapshot
      }
    })
    w.on('error', (e: Error) => {
      clearReadyTimer()
      if (worker === w) worker = null
      markFailed(`worker 异常: ${e.message}`)
    })
    w.on('exit', (code: number) => {
      clearReadyTimer()
      if (worker === w) worker = null
      if (started) {
        started = false
        latest = null
        console.warn(`[probe] worker 已退出 code=${code}，探针降级（识别走占位特征）`)
      }
    })
    // 看门狗：原生钩子若卡在初始化，主进程不受影响，3 秒后直接隔离该 worker
    readyTimer = setTimeout(() => {
      if (started) return
      if (worker === w) worker = null
      void w.terminate().catch(() => {})
      markFailed('worker 初始化超时，已隔离停用本次探针')
    }, WORKER_READY_TIMEOUT_MS)
  } catch (e) {
    markFailed(`启动失败: ${(e as Error).message}`)
  }
}

/** 停止探针（设置关闭/退出时调用） */
export function stopInputProbe(): void {
  clearReadyTimer()
  if (clipboardTimer) {
    clearInterval(clipboardTimer)
    clipboardTimer = null
  }
  if (worker) {
    try { worker.postMessage({ type: 'stop' }) } catch { /* ignore */ }
    void worker.terminate().catch(() => {})
    worker = null
  }
  if (started) console.info('[probe] 行为探针已停止')
  started = false
  latest = null
}

/** 最近 WINDOW_SEC 秒的行为聚合快照（探针未运行时返回 null → featureBuilder 走占位特征） */
export function getBehaviorWindow(): BehaviorSnapshot | null {
  if (!started) return null
  const now = Date.now()
  const snap = latest
  const shortAge = snap?.lastShortcutAt ? now - snap.lastShortcutAt : Infinity
  const clipAge = clipboardChangedAt ? now - clipboardChangedAt : Infinity
  const shortcutName = snap?.lastShortcutName ?? null
  const isPaste = shortcutName === 'paste' && shortAge < 2500 && clipAge < 3000
  const isCopy = shortcutName === 'copy' && shortAge < 2500 && clipAge < 3000
  return {
    windowSec: WINDOW_SEC,
    typeKeys: snap?.typeKeys ?? 0,
    clicks: snap?.clicks ?? 0,
    wheels: snap?.wheels ?? 0,
    typeKeyTotal: snap?.typeKeyTotal ?? 0,
    clickTotal: snap?.clickTotal ?? 0,
    wheelTotal: snap?.wheelTotal ?? 0,
    hasShortcut: shortAge < 5000,
    lastShortcutName: shortcutName,
    lastShortcutAgeMs: Number.isFinite(shortAge) ? Math.round(shortAge) : null,
    clipboardChangedAgeMs: clipboardChangedAt ? Math.round(clipAge) : null,
    pasteHint: isPaste,
    copyHint: isCopy
  }
}
