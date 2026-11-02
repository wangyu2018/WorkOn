/**
 * EdgeDock（边缘 Dock 分组系统，用户 2026-11-02 需求）：
 * 屏幕三边（顶/左/右）各一个 Dock 分组——应用图标 + 运行状态点 + 可排序；
 * 点击图标启动/切到应用；点击组标题按序批量启动（工作分解）。
 * 数据：settings.edgeDocks；窗口：透明置顶条形 BrowserWindow。
 */
import { app } from 'electron'
import { BrowserWindow, screen } from 'electron'
import { getSettings, setSettings } from './settings'
import { openAppSafe } from './appLauncher'

export interface DockItem {
  id: string
  appKey: string
  label: string
  icon: string // emoji fallback
  order: number
}
export interface DockGroup {
  title: string
  items: DockItem[]
}
export interface EdgeDocks {
  top: DockGroup
  left: DockGroup
  right: DockGroup
}

const DEFAULT_DOCKS: EdgeDocks = {
  top: { title: '监控', items: [] },
  left: { title: '项目工具', items: [] },
  right: { title: 'Agent·浏览器', items: [] }
}

function docks(): EdgeDocks {
  const s = getSettings() as { edgeDocks?: Partial<EdgeDocks> }
  const d = s.edgeDocks ?? {}
  return {
    top: d.top ?? DEFAULT_DOCKS.top,
    left: d.left ?? DEFAULT_DOCKS.left,
    right: d.right ?? DEFAULT_DOCKS.right
  }
}

function save(next: EdgeDocks): void {
  setSettings({ edgeDocks: next } as never)
}

export function getDocks(): EdgeDocks {
  return docks()
}

export function getDock(edge: 'top' | 'left' | 'right'): DockGroup {
  return docks()[edge]
}

/** 添加应用到某边（自动排序末尾） */
export function addDockItem(edge: 'top' | 'left' | 'right', appKey: string, label: string, icon: string): DockItem {
  const d = docks()
  const item: DockItem = {
    id: `dk${Date.now()}${Math.floor(Math.random() * 100)}`,
    appKey: appKey.toLowerCase().replace(/\.exe$/i, ''),
    label: label || appKey,
    icon: icon || '📦',
    order: d[edge].items.length
  }
  d[edge].items.push(item)
  save(d)
  return item
}

export function removeDockItem(edge: 'top' | 'left' | 'right', id: string): boolean {
  const d = docks()
  const before = d[edge].items.length
  d[edge].items = d[edge].items.filter((x) => x.id !== id).map((x, i) => ({ ...x, order: i }))
  save(d)
  return d[edge].items.length !== before
}

/** 排序（传排序后的 id 序列） */
export function reorderDock(edge: 'top' | 'left' | 'right', ids: string[]): void {
  const d = docks()
  d[edge].items = ids
    .map((id, i) => {
      const item = d[edge].items.find((x) => x.id === id)
      return item ? { ...item, order: i } : null
    })
    .filter((x): x is DockItem => !!x)
  save(d)
}

export function renameDock(edge: 'top' | 'left' | 'right', title: string): void {
  const d = docks()
  d[edge].title = title.slice(0, 12)
  save(d)
}

/** 点击单个 → 启动/切到该应用 */
export async function launchDockItem(edge: 'top' | 'left' | 'right', id: string): Promise<boolean> {
  const g = docks()[edge]
  const item = g.items.find((x) => x.id === id)
  if (!item) return false
  const r = await openAppSafe(item.appKey)
  return r.ok
}

/** 点击组标题 → 按排序批量启动/切到（工作分解） */
export async function launchDockGroup(edge: 'top' | 'left' | 'right'): Promise<number> {
  const g = docks()[edge]
  let count = 0
  for (const item of [...g.items].sort((a, b) => a.order - b.order)) {
    const r = await openAppSafe(item.appKey)
    if (r.ok) count++
  }
  return count
}

// ─────────────────────── 窗口 ───────────────────────

const dockWindows = new Map<'top' | 'left' | 'right', BrowserWindow>()
let statusTimer: NodeJS.Timeout | null = null
type StatusPush = (s: { edge: string; running: string[]; aiBusy: string[] }) => void
let statusPush: StatusPush | null = null

/** 创建某边的 Dock 窗（透明条形贴边） */
export function createDockWindow(edge: 'top' | 'left' | 'right'): BrowserWindow {
  const existing = dockWindows.get(edge)
  if (existing && !existing.isDestroyed()) {
    existing.show()
    return existing
  }
  const wa = screen.getPrimaryDisplay().workArea
  let bounds: Electron.Rectangle
  if (edge === 'top') {
    bounds = { x: wa.x, y: wa.y, width: wa.width, height: 52 }
  } else if (edge === 'left') {
    bounds = { x: wa.x, y: wa.y + 60, width: 56, height: wa.height - 100 }
  } else {
    bounds = { x: wa.x + wa.width - 56, y: wa.y + 60, width: 56, height: wa.height - 100 }
  }
  const win = new BrowserWindow({
    ...bounds,
    show: false,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    hasShadow: false,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })
  win.setAlwaysOnTop(true, 'screen-saver')
  const isDev = !!process.env.ELECTRON_RENDERER_URL
  if (isDev) {
    void win.loadURL(`${process.env.ELECTRON_RENDERER_URL}/index.html?edgedock=${edge}`)
  } else {
    void win.loadFile(path.join(__dirname, '../renderer/index.html'), { search: `?edgedock=${edge}` })
  }
  win.once('ready-to-show', () => {
    win.show()
    console.info(`[edgeDock] ${edge} 已显示`)
  })
  win.on('closed', () => {
    dockWindows.delete(edge)
    // 三窗全关 → 停状态轮询
    if (dockWindows.size === 0 && statusTimer) {
      clearInterval(statusTimer)
      statusTimer = null
    }
  })
  dockWindows.set(edge, win)
  startStatusPush()
  return win
}

import path from 'path'

/** 关闭某边 / 全部 */
export function closeDock(edge?: 'top' | 'left' | 'right'): void {
  if (edge) {
    dockWindows.get(edge)?.close()
  } else {
    for (const w of dockWindows.values()) w.close()
  }
}

export function dockVisible(edge: 'top' | 'left' | 'right'): boolean {
  const w = dockWindows.get(edge)
  return !!w && !w.isDestroyed() && w.isVisible()
}

/** 状态轮询 → 推到 Dock 窗（running=进程在跑，aiBusy=AI agent 正在跑任务） */
function startStatusPush(): void {
  if (statusTimer) return
  statusTimer = setInterval(async () => {
    if (dockWindows.size === 0) return
    const running: string[] = []
    const aiBusy: string[] = []
    try {
      const { presence } = await import('./presence')
      const snap = presence.getSnapshot()
      for (const sc of snap.screens ?? []) {
        if (sc.app) running.push(sc.app.toLowerCase().replace(/\.exe$/i, ''))
      }
    } catch { /* ignore */ }
    for (const [edge, win] of dockWindows) {
      if (!win.isDestroyed()) {
        win.webContents.send('edgedock:status', { edge, running, aiBusy })
      }
    }
  }, 5_000)
}
