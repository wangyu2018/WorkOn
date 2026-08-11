/**
 * 文件夹实时监听（PRD v3.0 P0）
 * chokidar 监听配置的工作目录，文件变更即增量解析
 */
import fs from 'fs'
import path from 'path'
import { getSettings, setSettings } from './settings'
import type { AppSettings } from '@shared/types'

let watcher: import('chokidar').FSWatcher | null = null
let watchDirs: string[] = []

export interface ParsedEntry {
  source: string          // 来源文件路径
  type: 'note' | 'meeting' | 'data' | 'action'  // 随手记 / 会议纪要 / 数据表 / 行动项
  content: string         // 提取的文本
  line?: number
  ts: number
}

type EntryListener = (entries: ParsedEntry[]) => void
const listeners = new Set<EntryListener>()

export function onFolderEntries(cb: EntryListener): () => void {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

function parseFile(filePath: string): ParsedEntry[] {
  const ext = path.extname(filePath).toLowerCase()
  const name = path.basename(filePath)
  const entries: ParsedEntry[] = []
  const isMeeting = /会议纪要|纪要|meeting/i.test(name)

  try {
    if (ext === '.md' || ext === '.txt') {
      const text = fs.readFileSync(filePath, 'utf-8')
      if (isMeeting) {
        // 提取行动项：## 行动项 / - [ ] / 下一步 / 待办
        const actionPattern = /(?:##\s*行动项|##\s*Action)|(?:-\s*\[[ x]\]\s*.+)|(?:下一步[：:].+)|(?:待办[：:].+)/gi
        const matches = text.match(actionPattern)
        if (matches) {
          entries.push({
            source: filePath,
            type: 'action',
            content: matches.join('\n'),
            ts: Date.now()
          })
        }
        entries.push({
          source: filePath,
          type: 'meeting',
          content: text.slice(0, 2000),
          ts: Date.now()
        })
      } else {
        // 按空行分段，每段作为一个快照
        const paras = text.split(/\n\n+/).filter((p) => p.trim())
        for (const p of paras) {
          entries.push({
            source: filePath,
            type: 'note',
            content: p.trim().slice(0, 500),
            ts: Date.now()
          })
        }
      }
    } else if (ext === '.csv') {
      const text = fs.readFileSync(filePath, 'utf-8')
      const lines = text.split('\n').filter((l) => l.trim())
      if (lines.length > 1) {
        entries.push({
          source: filePath,
          type: 'data',
          content: `${lines[0]}（共 ${lines.length - 1} 行数据）`,
          ts: Date.now()
        })
      }
    } else if (ext === '.xlsx') {
      entries.push({
        source: filePath,
        type: 'data',
        content: `数据表：${name}`,
        ts: Date.now()
      })
    }
  } catch {
    // 文件可能被占用或删除，忽略
  }
  return entries
}

async function startWatcher(dirs: string[]): Promise<void> {
  if (watcher) {
    await watcher.close()
    watcher = null
  }
  if (dirs.length === 0) return

  try {
    const chokidar = await import('chokidar')
    const validDirs = dirs.filter((d) => { try { return fs.statSync(d).isDirectory() } catch { return false } })
    if (validDirs.length === 0) return

    watcher = chokidar.watch(validDirs, {
      ignored: /(^|[\/\\])\../, // 忽略隐藏文件
      persistent: true,
      ignoreInitial: true,      // 启动时不扫描已有文件
      awaitWriteFinish: { stabilityThreshold: 2000, pollInterval: 100 }
    })

    watcher.on('add', (filePath) => {
      const entries = parseFile(filePath)
      if (entries.length > 0) {
        for (const cb of listeners) cb(entries)
      }
    })

    watcher.on('change', (filePath) => {
      const entries = parseFile(filePath)
      if (entries.length > 0) {
        for (const cb of listeners) cb(entries)
      }
    })

    console.info(`[folder] 监听 ${validDirs.length} 个目录:`, validDirs.map((d) => path.basename(d)))
  } catch (err) {
    console.warn('[folder] chokidar 启动失败:', err)
  }
}

/** 手动全量扫描一次（兜底方案 B） */
export function scanFolders(dirs: string[], exts = ['.md', '.txt', '.csv', '.xlsx']): ParsedEntry[] {
  const all: ParsedEntry[] = []
  for (const dir of dirs) {
    try {
      const files = fs.readdirSync(dir, { recursive: true })
      for (const f of files) {
        const fullPath = path.join(dir, f as string)
        if (exts.includes(path.extname(fullPath).toLowerCase())) {
          all.push(...parseFile(fullPath))
        }
      }
    } catch { /* skip */ }
  }
  return all
}

export function startFolderWatch(): void {
  const s = getSettings()
  watchDirs = s.folders ?? []
  if (watchDirs.length > 0) {
    void startWatcher(watchDirs)
  }
}

export function updateFolders(dirs: string[]): void {
  watchDirs = dirs
  setSettings({ folders: dirs } as Partial<AppSettings>)
  void startWatcher(dirs)
}

export function getWatchDirs(): string[] {
  return watchDirs
}

export function stopFolderWatch(): void {
  if (watcher) {
    void watcher.close()
    watcher = null
  }
}
