/**
 * 文件监控合并器（v10 §8.1 前半）：把 dirWatcher 的突发事件流
 * （npm install 一秒几千条）按每项目 60s 窗口聚合成「变更摘要」，
 * 追加写入 userData/file_windows.jsonl —— 这是 jev file_class/work_activity
 * 两题的训练对原料（标签后续用 git 历史对照生成，见 v10 §8.1）。
 * 只记元数据（路径/扩展名/计数），永不读文件内容——隐私红线。
 */
import { app } from 'electron'
import fs from 'fs'
import path from 'path'

interface FileWindow {
  ts: number
  projectId: string
  durationSec: number
  changed: number
  newFiles: number
  exts: Record<string, number>
  /** 路径样本（最多 8 条，一级目录相对路径） */
  pathSamples: string[]
}

const WINDOW_MS = 60_000
const FLUSH_IDLE_MS = 15_000 // 窗口内 15s 无新事件即结算

interface OpenWindow {
  startTs: number
  lastTs: number
  changed: number
  newFiles: number
  exts: Record<string, number>
  samples: string[]
}

const open = new Map<string, OpenWindow>()
let flushTimer: NodeJS.Timeout | null = null
let outFile = ''

function flush(projectId: string): void {
  const w = open.get(projectId)
  if (!w) return
  open.delete(projectId)
  if (w.changed === 0) return
  const row: FileWindow = {
    ts: w.startTs,
    projectId,
    durationSec: Math.round((w.lastTs - w.startTs) / 1000),
    changed: w.changed,
    newFiles: w.newFiles,
    exts: w.exts,
    pathSamples: w.samples.slice(0, 8)
  }
  try {
    fs.appendFileSync(outFile, JSON.stringify(row) + '\n', 'utf-8')
  } catch (e) {
    console.warn('[fileAgg] 写入失败', e)
  }
}

function sweep(): void {
  const now = Date.now()
  for (const [pid, w] of open) {
    if (now - w.lastTs > FLUSH_IDLE_MS) flush(pid)
  }
  if (open.size === 0 && flushTimer) {
    clearInterval(flushTimer)
    flushTimer = null
  }
}

/** dirWatcher 的 recordChange 调用；只喂 IGNORE 过滤后的有效路径 */
export function recordFileChange(projectId: string, absPath: string, isNew: boolean): void {
  if (!outFile) {
    try {
      outFile = path.join(app.getPath('userData'), 'file_windows.jsonl')
    } catch {
      return // app 未就绪时丢弃（启动竞态窗口极小）
    }
  }
  let w = open.get(projectId)
  if (!w) {
    w = { startTs: Date.now(), lastTs: Date.now(), changed: 0, newFiles: 0, exts: {}, samples: [] }
    open.set(projectId, w)
  }
  w.lastTs = Date.now()
  w.changed++
  if (isNew) w.newFiles++
  const ext = path.extname(absPath).toLowerCase() || '(none)'
  w.exts[ext] = (w.exts[ext] ?? 0) + 1
  if (w.samples.length < 16) {
    const root = absPath.split(/[\\/]/)
    w.samples.push(root.slice(-2).join('/'))
  }
  if (!flushTimer) flushTimer = setInterval(sweep, 5_000)
}

export function stopFileAggregator(): void {
  for (const pid of [...open.keys()]) flush(pid)
  if (flushTimer) {
    clearInterval(flushTimer)
    flushTimer = null
  }
}
