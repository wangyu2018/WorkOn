/**
 * 目录监控（v7）：项目产出物雷达
 * - 声明目录绑定到项目（attributions.bindProject 的 dirs）
 * - fs.watch 递归监听（Windows 原生支持），只记元数据：文件名/大小/mtime/增改删
 * - 四信号：活跃度（今日变更文件数）/ 产出物（新类型文件）/ 热点子目录 / 停滞检测
 */
import fs from 'fs'
import path from 'path'
import { insertInto, updateIn, col } from './db'
import { listBindings } from './attributions'
import { dateKey } from '@shared/trail'

export interface DirActivity {
  id: string // projectId:date
  projectId: string
  date: string
  changedFiles: number
  newFiles: number
  /** 扩展名 → 变更次数 */
  exts: Record<string, number>
  /** 热点子目录 → 变更次数（取一级子目录） */
  hotdirs: Record<string, number>
  lastChangeTs: number
}

const IGNORE = /[\\\/](node_modules|\.git|\.cache|dist|out|build|__pycache__)([\\\/]|$)|~\$|\.tmp$|\.log$/i

const watchers = new Map<string, fs.FSWatcher>()
const today = new Map<string, DirActivity>()

function key(projectId: string): string {
  return `${projectId}:${dateKey(Date.now())}`
}

function bucket(projectId: string): DirActivity {
  const k = key(projectId)
  let b = today.get(k)
  if (!b) {
    const saved = col<DirActivity>('dirActivity').find((a) => a.id === k)
    b = saved ?? { id: k, projectId, date: dateKey(Date.now()), changedFiles: 0, newFiles: 0, exts: {}, hotdirs: {}, lastChangeTs: 0 }
    today.set(k, b)
  }
  return b
}

function recordChange(projectId: string, absPath: string, isNew: boolean): void {
  if (IGNORE.test(absPath)) return
  const b = bucket(projectId)
  b.changedFiles++
  if (isNew) b.newFiles++
  const ext = path.extname(absPath).toLowerCase() || '(无扩展名)'
  b.exts[ext] = (b.exts[ext] ?? 0) + 1
  const rel = path.relative(watchRoots.get(projectId) ?? '', absPath)
  const sub = rel.split(/[\\/]/)[0]
  if (sub && sub !== rel) b.hotdirs[sub] = (b.hotdirs[sub] ?? 0) + 1
  b.lastChangeTs = Date.now()
}

const watchRoots = new Map<string, string>()

/** 启动一个项目的目录监控（绑定变化时由 startAllWatchers 重建） */
function watchProject(projectId: string, dirs: string[]): void {
  stopWatcher(projectId)
  for (const dir of dirs) {
    if (!dir || !fs.existsSync(dir)) continue
    try {
      const w = fs.watch(dir, { recursive: true }, (_event, filename) => {
        if (!filename) return
        const abs = path.join(dir, filename.toString())
        let isNew = false
        try {
          isNew = fs.existsSync(abs)
        } catch { /* ignore */ }
        recordChange(projectId, abs, isNew)
      })
      watchRoots.set(projectId, dir)
      watchers.set(projectId, w)
      break // 每个项目暂取第一个有效目录（多目录扩展留待需要）
    } catch { /* 目录不可监听则跳过 */ }
  }
}

function stopWatcher(projectId: string): void {
  const w = watchers.get(projectId)
  if (w) {
    w.close()
    watchers.delete(projectId)
  }
}

/** 应用启动 / 绑定变化后调用：对齐所有项目的监控器 */
export function startAllWatchers(): void {
  const bindingsWithDirs = listBindings().filter((b) => b.dirs.length)
  const wanted = new Set(bindingsWithDirs.map((b) => b.projectId))
  for (const pid of [...watchers.keys()]) {
    if (!wanted.has(pid)) stopWatcher(pid)
  }
  for (const b of bindingsWithDirs) watchProject(b.projectId, b.dirs)
}

/** 日期滚动：内存桶落库（monitor tick 低频调用） */
export function dirWatcherTick(): void {
  const today2 = dateKey(Date.now())
  for (const [k, b] of today) {
    if (!k.endsWith(`:${today2}`)) continue
    const exist = col<DirActivity>('dirActivity').find((a) => a.id === k)
    if (exist) {
      updateIn<DirActivity>('dirActivity', k, {
        changedFiles: b.changedFiles,
        newFiles: b.newFiles,
        exts: b.exts,
        hotdirs: b.hotdirs,
        lastChangeTs: b.lastChangeTs
      })
    } else {
      insertInto<DirActivity>('dirActivity', { ...b })
    }
  }
}

/** 项目今日目录活动（状态卡/小组件消费） */
export function getTodayActivity(projectId: string): { changedFiles: number; newFiles: number; hotspot: string; lastChangeTs: number } {
  const b = today.get(key(projectId))
  if (!b) return { changedFiles: 0, newFiles: 0, hotspot: '', lastChangeTs: 0 }
  const hotspot = Object.entries(b.hotdirs).sort((a, c) => c[1] - a[1])[0]?.[0] ?? ''
  return { changedFiles: b.changedFiles, newFiles: b.newFiles, hotspot, lastChangeTs: b.lastChangeTs }
}

/** 停滞检测：绑定目录的项目 N 天无任何变更 */
export function stalledProjects(days: number): string[] {
  const threshold = Date.now() - days * 86400_000
  return listBindings()
    .filter((b) => b.dirs.length)
    .filter((b) => {
      const acts = col<DirActivity>('dirActivity').filter((a) => a.projectId === b.projectId)
      const last = acts.reduce((m, a) => Math.max(m, a.lastChangeTs), 0)
      return last > 0 && last < threshold
    })
    .map((b) => b.projectId)
}
