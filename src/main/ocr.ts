/**
 * OCR 资源管理：截屏缓存目录统计 / 一键清理 / 按周期自动清理
 * 说明：深度模式（deepMode）的截屏缓存写入 userData/screenshots；
 * 当前版本无独立本地 OCR 模型文件，模型大小统计恒为 0（保留字段便于将来接入）。
 */
import { app } from 'electron'
import fs from 'fs'
import path from 'path'
import { getSettings } from './settings'

export interface OcrStorageStats {
  shotCount: number
  shotBytes: number
  modelBytes: number
  totalBytes: number
  active: boolean // OCR 深度模式是否正在运行
}

function shotsDir(): string {
  return path.join(app.getPath('userData'), 'screenshots')
}

function scan(dir: string): { count: number; bytes: number } {
  try {
    if (!fs.existsSync(dir)) return { count: 0, bytes: 0 }
    let count = 0
    let bytes = 0
    for (const f of fs.readdirSync(dir)) {
      try {
        const st = fs.statSync(path.join(dir, f))
        if (st.isFile()) {
          count++
          bytes += st.size
        }
      } catch {
        /* 单个文件读取失败跳过 */
      }
    }
    return { count, bytes }
  } catch {
    return { count: 0, bytes: 0 }
  }
}

export function getOcrStorageStats(): OcrStorageStats {
  const shots = scan(shotsDir())
  // OCR 语言包实际大小（随包离线分发的 traineddata）
  const langDir = path.join(app.getAppPath(), 'assets')
  let modelBytes = 0
  try {
    if (fs.existsSync(langDir)) {
      for (const f of fs.readdirSync(langDir)) {
        if (f.endsWith('.traineddata')) modelBytes += fs.statSync(path.join(langDir, f)).size
      }
    }
  } catch {
    /* ignore */
  }
  const active = getSettings().deepMode
  return { shotCount: shots.count, shotBytes: shots.bytes, modelBytes, totalBytes: shots.bytes + modelBytes, active }
}

/** 清理截屏缓存（保留最近 keepRecentDays 天），返回释放字节数与最新统计 */
export function clearOcrCache(keepRecentDays: number): OcrStorageStats & { freedBytes: number } {
  const dir = shotsDir()
  const cutoff = Date.now() - Math.max(0, keepRecentDays) * 86400000
  let freed = 0
  try {
    if (fs.existsSync(dir)) {
      for (const f of fs.readdirSync(dir)) {
        try {
          const fp = path.join(dir, f)
          const st = fs.statSync(fp)
          if (st.isFile() && st.mtimeMs < cutoff) {
            freed += st.size
            fs.unlinkSync(fp)
          }
        } catch {
          /* 单个文件删除失败跳过 */
        }
      }
    }
  } catch (e) {
    console.warn('[ocr] 清理截屏缓存失败', e)
  }
  return { freedBytes: freed, ...getOcrStorageStats() }
}

/** 启动时按设置周期自动清理（0 = 永不） */
export function autoCleanOcrCache(): void {
  const days = getSettings().ocrCleanupDays ?? 0
  if (days <= 0) return
  const r = clearOcrCache(days)
  if (r.freedBytes > 0) console.log(`[ocr] 按周期(${days}天)自动清理截屏缓存，释放 ${(r.freedBytes / 1048576).toFixed(1)} MB`)
}
