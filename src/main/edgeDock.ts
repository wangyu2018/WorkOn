/**
 * EdgeDock（边缘 Dock 分组系统，用户 2026-11-02 需求）：
 * 屏幕三边（顶/左/右）各一个 Dock 分组——应用图标 + 运行状态点 + 可排序；
 * 点击图标启动/切到应用；点击组标题按序批量启动（工作分解）。
 * 数据：settings.edgeDocks；窗口：透明置顶条形 BrowserWindow。
 *
 * 触发（2026-11-02 用户要求对齐 Win11 自动隐藏任务栏，别跟默认边缘习惯冲突）：
 * 平时窗口完全隐藏（不遮挡最大化窗口的标签栏/标题栏）；
 * 鼠标顶死屏幕边缘 3px 内驻留 200ms 才滑出；离开 350ms 自动缩回；
 * 前台是全屏应用时不弹；Dock 窗不抢焦点。
 */
import { app } from 'electron'
import { BrowserWindow, screen } from 'electron'
import koffi from 'koffi'
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

/** 创建某边的 Dock 窗（透明条形贴边；创建后保持隐藏，由边缘触发显出） */
export function createDockWindow(edge: 'top' | 'left' | 'right'): BrowserWindow {
  const existing = dockWindows.get(edge)
  if (existing && !existing.isDestroyed()) {
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
    focusable: false, // 悬停触发不抢焦点：正在用的最大化窗口保持前台（对齐 Win11 任务栏）
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
  // Win11 式触发：创建后保持隐藏，等鼠标顶边+驻留（startRevealWatcher）
  win.once('ready-to-show', () => {
    console.info(`[edgeDock] ${edge} 已就绪（隐藏待触发）`)
  })
  win.on('closed', () => {
    dockWindows.delete(edge)
    // 三窗全关 → 停状态轮询 + 停边缘监听
    if (dockWindows.size === 0) {
      if (statusTimer) {
        clearInterval(statusTimer)
        statusTimer = null
      }
      stopRevealWatcher()
    }
  })
  dockWindows.set(edge, win)
  startStatusPush()
  startRevealWatcher()
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

/** 状态轮询 → 推到 Dock 窗（running=进程在跑，aiBusy=AI agent 正在跑任务）；只推可见窗，隐藏时不烧 */
function startStatusPush(): void {
  if (statusTimer) return
  statusTimer = setInterval(() => { void pushStatusNow() }, 5_000)
}

async function pushStatusNow(): Promise<void> {
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
    if (!win.isDestroyed() && win.isVisible()) {
      win.webContents.send('edgedock:status', { edge, running, aiBusy })
    }
  }
}

// ─────────────── Win11 任务栏式边缘触发 ───────────────
// ① 平时完全隐藏（不遮挡/不抢最大化窗口顶部区域的点击）
// ② 鼠标「顶死」边缘 3px 内 + 驻留 200ms 才滑出（快速划过/路过角落不触发）
// ③ 鼠标离开 Dock 范围 350ms 后自动缩回
// ④ 前台是全屏应用时不弹（对齐 Win11 全屏时任务栏不出现）

const EDGE_TRIGGER_PX = 3
const REVEAL_DWELL_MS = 200
const AUTO_HIDE_MS = 350
const REVEAL_POLL_MS = 120

let revealTimer: NodeJS.Timeout | null = null
let hideTimer: NodeJS.Timeout | null = null
let dwellEdge: 'top' | 'left' | 'right' | null = null
let dwellSince = 0

type User32Fns = {
  GetForegroundWindow: () => unknown
  GetWindowRect: (hwnd: unknown, rect: Buffer) => boolean
}
let user32Fns: User32Fns | null = null
let user32Tried = false

function loadUser32(): User32Fns | null {
  if (user32Tried) return user32Fns
  user32Tried = true
  try {
    const u32 = koffi.load('user32.dll')
    user32Fns = {
      GetForegroundWindow: u32.func('GetForegroundWindow', 'void *', []),
      GetWindowRect: u32.func('GetWindowRect', 'bool', ['void *', 'void *'])
    } as unknown as User32Fns
  } catch (e) {
    console.warn('[edgeDock] user32 加载失败，全屏抑制不可用', e)
    user32Fns = null
  }
  return user32Fns
}

/** 前台窗口是否全屏（覆盖 ≥90% 显示器物理面积）——全屏时 Dock 不弹 */
function isForegroundFullscreen(primary: Electron.Display): boolean {
  const u = loadUser32()
  if (!u) return false
  try {
    const hwnd = u.GetForegroundWindow()
    if (!hwnd) return false
    const rect = Buffer.alloc(16) // RECT = 4 × int32（物理像素，需与 DIP 换算）
    if (!u.GetWindowRect(hwnd, rect)) return false
    const w = rect.readInt32LE(8) - rect.readInt32LE(0)
    const h = rect.readInt32LE(12) - rect.readInt32LE(4)
    if (w <= 0 || h <= 0) return false
    const s = primary.scaleFactor
    const b = primary.bounds
    const mw = b.width * s
    const mh = b.height * s
    if (mw <= 0 || mh <= 0) return false
    return (w * h) / (mw * mh) >= 0.9
  } catch {
    return false
  }
}

/** 光标当前顶在哪条边（仅主屏 workArea 内；左右边让出上 60px / 下 40px 角，与 Dock 竖向范围一致） */
function edgeAt(p: Electron.Point, wa: Electron.Rectangle): 'top' | 'left' | 'right' | null {
  if (p.x < wa.x - 2 || p.x > wa.x + wa.width + 2) return null
  if (p.y >= wa.y && p.y <= wa.y + EDGE_TRIGGER_PX) return 'top'
  if (p.y >= wa.y + 60 && p.y <= wa.y + wa.height - 40) {
    if (p.x >= wa.x && p.x <= wa.x + EDGE_TRIGGER_PX) return 'left'
    if (p.x >= wa.x + wa.width - EDGE_TRIGGER_PX && p.x <= wa.x + wa.width) return 'right'
  }
  return null
}

function cursorInDock(c: Electron.Point, w: BrowserWindow): boolean {
  if (w.isDestroyed() || !w.isVisible()) return false
  const b = w.getBounds()
  return c.x >= b.x - 6 && c.x <= b.x + b.width + 6 && c.y >= b.y - 6 && c.y <= b.y + b.height + 6
}

function hideAwayDocks(): void {
  hideTimer = null
  try {
    const c = screen.getCursorScreenPoint()
    for (const w of dockWindows.values()) {
      if (w.isDestroyed() || !w.isVisible()) continue
      if (!cursorInDock(c, w)) w.hide()
    }
  } catch { /* ignore */ }
}

function revealDock(edge: 'top' | 'left' | 'right'): void {
  const w = dockWindows.get(edge)
  if (!w || w.isDestroyed()) return
  if (!w.isVisible()) {
    w.show()
    void pushStatusNow() // 滑出瞬间先刷一轮状态，别让状态点陈旧 5s
  }
}

function tickReveal(): void {
  let c: Electron.Point
  try {
    c = screen.getCursorScreenPoint()
  } catch {
    return
  }
  const primary = screen.getPrimaryDisplay()
  const onPrimary = screen.getDisplayNearestPoint(c).id === primary.id
  const edge = onPrimary ? edgeAt(c, primary.workArea) : null
  if (edge && !isForegroundFullscreen(primary)) {
    if (hideTimer) {
      clearTimeout(hideTimer)
      hideTimer = null
    }
    if (dwellEdge !== edge) {
      dwellEdge = edge
      dwellSince = Date.now()
    } else if (Date.now() - dwellSince >= REVEAL_DWELL_MS) {
      revealDock(edge)
    }
    return
  }
  // 不在触发边（或全屏中）：光标停在 Dock 上→悬停续留；否则宽限期后缩回
  dwellEdge = null
  const inDock = [...dockWindows.values()].some((w) => cursorInDock(c, w))
  if (hideTimer) {
    if (inDock) {
      clearTimeout(hideTimer)
      hideTimer = null
    }
    return
  }
  const anyVisible = [...dockWindows.values()].some((w) => !w.isDestroyed() && w.isVisible())
  if (anyVisible && !inDock) {
    hideTimer = setTimeout(hideAwayDocks, AUTO_HIDE_MS)
  }
}

function startRevealWatcher(): void {
  if (revealTimer) return
  revealTimer = setInterval(tickReveal, REVEAL_POLL_MS)
}

function stopRevealWatcher(): void {
  if (revealTimer) {
    clearInterval(revealTimer)
    revealTimer = null
  }
  if (hideTimer) {
    clearTimeout(hideTimer)
    hideTimer = null
  }
  dwellEdge = null
}
