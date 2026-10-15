/**
 * 窗口管理
 * 依据：PRD.md 架构「主窗口 + 悬浮窗 + 桌宠透明窗」；
 *       v4.0「方案B：alwaysOnTop + 点击穿透（人物区域外 setIgnoreMouseEvents forward）」
 */
import { BrowserWindow, screen, shell, app, nativeImage } from 'electron'
import path from 'path'
import fs from 'fs'
import { getSettings, setSettings } from './settings'
import type { WidgetMode } from '@shared/types'
import { attachWindowToDesktop, detachWindowFromDesktop } from './desktopPin'

let widgetPenetration = false
/** 挖洞：光标是否在实体 UI 上（false 时穿透到桌面） */
let widgetHitSolid = true

const WIDGET_DEFAULT_SIZE: Record<WidgetMode, { w: number; h: number }> = {
  mini: { w: 210, h: 52 },
  compact: { w: 300, h: 150 },
  full: { w: 340, h: 520 },
}

/** mini 贴边水滴尺寸（细长胶囊，装左右小环） */
const MINI_DOCK_SIZE: Record<'left' | 'right' | 'top' | 'bottom', { w: number; h: number }> = {
  left: { w: 120, h: 36 },
  right: { w: 120, h: 36 },
  top: { w: 120, h: 36 },
  bottom: { w: 120, h: 36 },
}

const SNAP_IN_PX = 34
const SNAP_OUT_PX = 64
type DockEdge = 'left' | 'right' | 'top' | 'bottom'

let snapping = false
let undockCooldownUntil = 0

function touchWidgetHabit(layout: 'mini' | 'dock' | 'full', edge?: DockEdge | null): void {
  const s = getSettings()
  const [x, y] = widgetWindow && !widgetWindow.isDestroyed()
    ? widgetWindow.getPosition()
    : [s.widgetPosX ?? -1, s.widgetPosY ?? -1]
  const pos = x >= 0 && y >= 0 ? { x, y } : undefined
  const prev = s.widgetHabit ?? { lastLayout: 'mini' as const, penetration: false, onTop: true }
  setSettings({
    widgetHabit: {
      ...prev,
      lastLayout: layout,
      penetration: !!s.widgetPenetration,
      onTop: s.widgetOnTop !== false,
      ...(layout === 'dock' && edge && pos ? { dock: { edge, ...pos } } : {}),
      ...(layout === 'mini' && pos ? { mini: pos } : {}),
      ...(layout === 'full' && pos ? { full: pos } : {})
    }
  })
}

/** 吸附/自由态顶层：吸附可用独立开关 */
function applyWidgetTopForMode(): void {
  if (!widgetWindow || widgetWindow.isDestroyed()) return
  if (getSettings().widgetDesktopPin) return
  const s = getSettings()
  const docked = s.widgetMode === 'mini' && !!s.widgetDockEdge
  const onTop = docked ? s.widgetDockOnTop !== false : s.widgetOnTop !== false
  widgetWindow.setAlwaysOnTop(onTop, onTop ? 'screen-saver' : 'floating')
}

/** 向浮窗广播会影响叠层的设置（穿透/显示项/紧凑等） */
export function broadcastWidgetSettings(): void {
  const s = getSettings()
  sendTo('widget', 'settings:update', {
    widgetPenetration: !!s.widgetPenetration,
    widgetCompact: !!s.widgetCompact,
    widgetOpacity: s.widgetOpacity ?? 1,
    widgetDockEdge: s.widgetDockEdge ?? null,
    widgetDockOnTop: s.widgetDockOnTop !== false,
    widgetDisplay: s.widgetDisplay ?? undefined,
    widgetAccent: s.widgetAccent,
    aiAssistWatchEnabled: !!s.aiAssistWatchEnabled,
    aiAssistWatchApps: s.aiAssistWatchApps ?? []
  })
  sendTo('todoWidget', 'settings:update', {
    aiAssistWatchEnabled: !!s.aiAssistWatchEnabled,
    aiAssistWatchApps: s.aiAssistWatchApps ?? []
  })
}

/** 悬浮窗有效透明度：吸附态恒不透明（贴边胶囊要一眼看清），其余按 widgetOpacity */
export function applyWidgetOpacity(): void {
  if (!widgetWindow || widgetWindow.isDestroyed()) return
  const s = getSettings()
  const docked = s.widgetMode === 'mini' && !!s.widgetDockEdge
  widgetWindow.setOpacity(docked ? 1 : Math.min(1, Math.max(0.3, s.widgetOpacity ?? 1)))
}

function notifyDock(edge: DockEdge | null): void {
  sendTo('widget', 'widget:dock', { edge })
  applyWidgetTopForMode()
}

function workAreaOfWidget(): Electron.Rectangle {
  if (!widgetWindow || widgetWindow.isDestroyed()) return screen.getPrimaryDisplay().workArea
  return screen.getDisplayMatching(widgetWindow.getBounds()).workArea
}

function miniFreeSize(): { w: number; h: number } {
  // mini 定死：不读不写自定义尺寸，杜绝越拖越大
  return { ...WIDGET_DEFAULT_SIZE.mini }
}

/** mini / dock 时锁死宽高，避免拖动或保存把窗撑大 */
function applyMiniSizeLock(dock: DockEdge | null): void {
  if (!widgetWindow || widgetWindow.isDestroyed()) return
  const sz = dock ? MINI_DOCK_SIZE[dock] : WIDGET_DEFAULT_SIZE.mini
  try {
    widgetWindow.setMinimumSize(sz.w, sz.h)
    widgetWindow.setMaximumSize(sz.w, sz.h)
  } catch { /* ignore */ }
  const [x, y] = widgetWindow.getPosition()
  widgetWindow.setBounds({ x, y, width: sz.w, height: sz.h }, false)
}

function clearMiniSizeLock(): void {
  if (!widgetWindow || widgetWindow.isDestroyed()) return
  try {
    widgetWindow.setMinimumSize(200, 80)
    widgetWindow.setMaximumSize(900, 1000)
  } catch { /* ignore */ }
}

function applyMiniDock(edge: DockEdge, preferY?: number, preferX?: number): void {
  if (!widgetWindow || widgetWindow.isDestroyed()) return
  if (Date.now() < undockCooldownUntil) return
  const wa = workAreaOfWidget()
  const sz = MINI_DOCK_SIZE[edge]
  let nx = preferX ?? widgetWindow.getPosition()[0]
  let ny = preferY ?? widgetWindow.getPosition()[1]
  if (edge === 'left') {
    nx = wa.x
    ny = Math.min(Math.max(ny, wa.y), wa.y + wa.height - sz.h)
  } else if (edge === 'right') {
    nx = wa.x + wa.width - sz.w
    ny = Math.min(Math.max(ny, wa.y), wa.y + wa.height - sz.h)
  } else if (edge === 'top') {
    ny = wa.y
    nx = Math.min(Math.max(nx, wa.x), wa.x + wa.width - sz.w)
  } else {
    ny = wa.y + wa.height - sz.h
    nx = Math.min(Math.max(nx, wa.x), wa.x + wa.width - sz.w)
  }
  snapping = true
  widgetWindow.setBounds({ x: Math.round(nx), y: Math.round(ny), width: sz.w, height: sz.h }, true)
  applyMiniSizeLock(edge)
  setSettings({ widgetMode: 'mini', widgetDockEdge: edge, widgetPosX: Math.round(nx), widgetPosY: Math.round(ny) })
  applyWidgetOpacity()
  touchWidgetHabit('dock', edge)
  notifyDock(edge)
  setTimeout(() => { snapping = false }, 120)
}

function applyMiniFree(keepPos: boolean, nudgeFromEdge?: DockEdge | null): void {
  if (!widgetWindow || widgetWindow.isDestroyed()) return
  const wa = workAreaOfWidget()
  const sz = miniFreeSize()
  const b = widgetWindow.getBounds()
  const prevEdge = nudgeFromEdge ?? getSettings().widgetDockEdge ?? null
  let nx = keepPos ? Math.round(b.x + b.width / 2 - sz.w / 2) : b.x
  let ny = keepPos ? Math.round(b.y + b.height / 2 - sz.h / 2) : b.y
  const nudge = SNAP_OUT_PX + 12
  if (prevEdge === 'left') nx = Math.max(nx, wa.x + nudge)
  if (prevEdge === 'right') nx = Math.min(nx, wa.x + wa.width - sz.w - nudge)
  if (prevEdge === 'top') ny = Math.max(ny, wa.y + nudge)
  if (prevEdge === 'bottom') ny = Math.min(ny, wa.y + wa.height - sz.h - nudge)
  nx = Math.min(Math.max(nx, wa.x), wa.x + wa.width - sz.w)
  ny = Math.min(Math.max(ny, wa.y), wa.y + wa.height - sz.h)
  snapping = true
  undockCooldownUntil = Date.now() + 1200
  applyMiniSizeLock(null)
  widgetWindow.setBounds({ x: nx, y: ny, width: sz.w, height: sz.h }, true)
  const sizes = { ...(getSettings().widgetSizes ?? {}) }
  delete sizes.mini // 清掉历史膨胀尺寸
  setSettings({
    widgetMode: 'mini',
    widgetDockEdge: null,
    widgetPosX: nx,
    widgetPosY: ny,
    widgetSizes: sizes
  })
  applyWidgetOpacity()
  touchWidgetHabit('mini')
  notifyDock(null)
  setTimeout(() => { snapping = false }, 120)
}

/**
 * 拖动脱离吸附：只变大、清 dock，按光标相对点锚定，绝不往外硬顶一段。
 * 返回新的 grab 偏移（光标相对窗左上角）。
 */
function undockMiniForDrag(cursor: { x: number; y: number }): { ox: number; oy: number } {
  if (!widgetWindow || widgetWindow.isDestroyed()) {
    return { ox: 0, oy: 0 }
  }
  const b = widgetWindow.getBounds()
  const relX = b.width > 0 ? (cursor.x - b.x) / b.width : 0.5
  const relY = b.height > 0 ? (cursor.y - b.y) / b.height : 0.5
  const sz = miniFreeSize()
  const wa = workAreaOfWidget()
  let nx = Math.round(cursor.x - relX * sz.w)
  let ny = Math.round(cursor.y - relY * sz.h)
  nx = Math.min(Math.max(nx, wa.x), wa.x + wa.width - sz.w)
  ny = Math.min(Math.max(ny, wa.y), wa.y + wa.height - sz.h)

  snapping = true
  // 短冷却防拖动中立刻被吸回去；不要用 1.2s 大 nudge
  undockCooldownUntil = Date.now() + 400
  applyMiniSizeLock(null)
  widgetWindow.setBounds({ x: nx, y: ny, width: sz.w, height: sz.h }, false)
  const sizes = { ...(getSettings().widgetSizes ?? {}) }
  delete sizes.mini
  setSettings({
    widgetMode: 'mini',
    widgetDockEdge: null,
    widgetPosX: nx,
    widgetPosY: ny,
    widgetSizes: sizes
  })
  applyWidgetOpacity()
  touchWidgetHabit('mini')
  notifyDock(null)
  setTimeout(() => { snapping = false }, 80)

  return { ox: cursor.x - nx, oy: cursor.y - ny }
}

/** mini 松手：靠近边缘 → 水滴吸附；拉离 → 恢复胶囊 */
function trySnapMiniWidget(): void {
  if (!widgetWindow || widgetWindow.isDestroyed()) return
  if (getSettings().widgetMode !== 'mini') return
  if (snapping) return
  if (Date.now() < undockCooldownUntil) return

  const wa = workAreaOfWidget()
  const [x, y] = widgetWindow.getPosition()
  const [w, h] = widgetWindow.getSize()
  const cur = getSettings().widgetDockEdge ?? null

  const distL = x - wa.x
  const distR = wa.x + wa.width - (x + w)
  const distT = y - wa.y
  const distB = wa.y + wa.height - (y + h)
  const nearest = ([
    { edge: 'left' as DockEdge, d: distL },
    { edge: 'right' as DockEdge, d: distR },
    { edge: 'top' as DockEdge, d: distT },
    { edge: 'bottom' as DockEdge, d: distB },
  ]).sort((a, b) => a.d - b.d)[0]

  if (nearest.d <= SNAP_IN_PX) {
    applyMiniDock(nearest.edge, y, x)
    return
  }
  if (cur && nearest.d >= SNAP_OUT_PX) applyMiniFree(true)
}

function resizeWidgetWindow(w: number, h: number, anchorBottom = true): void {
  if (!widgetWindow || widgetWindow.isDestroyed()) return
  const [x, y] = widgetWindow.getPosition()
  const [, curH] = widgetWindow.getSize()
  const wa = workAreaOfWidget()
  // 高度不超出工作区：向上撑高到顶后继续长会把底边顶出屏幕
  h = Math.min(h, wa.height)
  // anchorBottom：脚底不动向上长（模式切换/临时撑高）；手动拖角：顶左锚定让角跟手
  const ny = anchorBottom
    ? Math.min(Math.max(y + curH - h, wa.y), Math.max(wa.y, wa.y + wa.height - h))
    : Math.min(Math.max(y, wa.y), Math.max(wa.y, wa.y + wa.height - h))
  const nx = Math.min(Math.max(x, wa.x), Math.max(wa.x, wa.x + wa.width - w))
  // setBounds 原子改框，避免 setSize+setPosition 两步造成的窗口抽动
  widgetWindow.setBounds({ x: Math.round(nx), y: Math.round(ny), width: Math.round(w), height: Math.round(h) })
}

/** 最近一次手动拖角的尺寸（含发起时的模式）。临时撑高/纯位移不碰它——宽度由此记忆，高度不被自动撑高污染 */
let pendingSizeSave: { mode: WidgetMode; w: number; h: number } | null = null

let saveWidgetTimer: ReturnType<typeof setTimeout> | null = null
function scheduleWidgetBoundsSave(): void {
  if (saveWidgetTimer) clearTimeout(saveWidgetTimer)
  saveWidgetTimer = setTimeout(() => {
    if (!widgetWindow || widgetWindow.isDestroyed()) return
    const [x, y] = widgetWindow.getPosition()
    const [w] = widgetWindow.getSize()
    const s = getSettings()
    const sizes = { ...(s.widgetSizes ?? {}) }
    delete sizes.mini
    if (pendingSizeSave) {
      // 手动拖角的尺寸按发起时的模式落库（拖完立刻收起成 mini 也丢不掉）
      sizes[pendingSizeSave.mode] = { w: pendingSizeSave.w, h: pendingSizeSave.h }
      pendingSizeSave = null
    } else if (s.widgetMode !== 'mini') {
      // 位移保存：宽记当前（临时撑高不改宽），高保留已存值——自动撑高不写死
      const prev = sizes[s.widgetMode]
      sizes[s.widgetMode] = { w, h: prev?.h ?? WIDGET_DEFAULT_SIZE[s.widgetMode].h }
    }
    // mini（含吸附）只记位置；上面的手动尺寸已按所属模式落库
    setSettings({ widgetPosX: x, widgetPosY: y, widgetSizes: sizes })
  }, 400)
}

export let mainWindow: BrowserWindow | null = null
export let widgetWindow: BrowserWindow | null = null
export let splashWindow: BrowserWindow | null = null
export let petWindow: BrowserWindow | null = null

const isDev = !!process.env.ELECTRON_RENDERER_URL

function appIcon(): Electron.NativeImage | undefined {
  const file = path.join(app.getAppPath(), 'assets', 'icon-32.png')
  try {
    if (fs.existsSync(file)) return nativeImage.createFromPath(file)
  } catch { /* ignore */ }
  return undefined
}

function rendererUrl(page: string): string {
  // WORKON_V10=1 时主窗直接带 v10 参数启动（预览/截图用；日常入口在旧版侧栏「体验 v10 版面」）
  const v10 = process.env.WORKON_V10 === '1' && page === 'index' ? '?v10=1' : ''
  return `${process.env.ELECTRON_RENDERER_URL}/${page}.html${v10}`
}

function rendererFile(page: string): string {
  return path.join(__dirname, `../renderer/${page}.html`)
}

function load(win: BrowserWindow, page: string): void {
  if (isDev) void win.loadURL(rendererUrl(page))
  else void win.loadFile(rendererFile(page))
}

export function createMainWindow(opts?: { deferShow?: boolean }): BrowserWindow {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show()
    mainWindow.focus()
    return mainWindow
  }
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 720,
    minWidth: 900,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    frame: false,
    backgroundColor: '#0B1220',
    title: 'WorkOn',
    icon: appIcon(),
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })
  // 有开启动画时主窗口延迟展示（等 splash 播完再亮）
  if (!opts?.deferShow) {
    mainWindow.once('ready-to-show', () => mainWindow?.show())
  }
  mainWindow.on('close', (e) => {
    // 托盘常驻，阻止误关
    e.preventDefault()
    mainWindow?.hide()
  })
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })
  // 渲染层错误转发到主进程日志（定位白屏/黑屏问题）
  mainWindow.webContents.on('console-message', (_e, level, message, line, sourceId) => {
    if (level >= 2) console.error(`[renderer] ${message} (${sourceId}:${line})`)
  })
  mainWindow.webContents.on('render-process-gone', (_e, d) => {
    console.error(`[renderer-gone] ${d.reason} exitCode=${d.exitCode}`)
  })
  mainWindow.webContents.on('preload-error', (_e, p, err) => {
    console.error('[preload-error]', p, err)
  })
  load(mainWindow, 'index')
  return mainWindow
}

/** 开启动画窗：独立 BrowserWindow 播放 assets/splash.html（约 8s，播完自动关闭） */
export function createSplashWindow(): BrowserWindow {
  splashWindow = new BrowserWindow({
    width: 700,
    height: 460,
    resizable: false,
    frame: false,
    transparent: true,
    hasShadow: false,
    backgroundColor: '#00000000',
    alwaysOnTop: true,
    show: true,
    title: 'WorkOn',
    icon: appIcon(),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })
  void splashWindow.loadFile(path.join(app.getAppPath(), 'assets', 'splash.html'))
  return splashWindow
}

export function closeSplash(): void {
  if (splashWindow && !splashWindow.isDestroyed()) splashWindow.close()
  splashWindow = null
}

export function createWidgetWindow(): BrowserWindow {
  if (widgetWindow && !widgetWindow.isDestroyed()) return widgetWindow
  const s = getSettings()
  const display = screen.getPrimaryDisplay()
  const wa = display.workArea
  const rawMode: WidgetMode = s.widgetMode ?? 'mini'
  const mode: WidgetMode = rawMode === 'compact' ? 'full' : rawMode
  if (rawMode === 'compact') setSettings({ widgetMode: 'full' })
  const dockEdge = (mode === 'mini' ? s.widgetDockEdge : null) ?? null
  const size = dockEdge
    ? MINI_DOCK_SIZE[dockEdge]
    : mode === 'mini'
      ? WIDGET_DEFAULT_SIZE.mini
      : (s.widgetSizes?.[mode] ?? WIDGET_DEFAULT_SIZE[mode])
  const w = size.w
  const h = size.h
  // 启动时清掉历史 mini 膨胀尺寸
  if (s.widgetSizes?.mini) {
    const sizes = { ...s.widgetSizes }
    delete sizes.mini
    setSettings({ widgetSizes: sizes })
  }
  let x = wa.x + wa.width - w - 16
  let y = wa.y + wa.height - h - 16
  const sx = s.widgetPosX ?? -1
  const sy = s.widgetPosY ?? -1
  if (sx >= 0 && sy >= 0 && sx >= wa.x - w + 40 && sx <= wa.x + wa.width - 40 && sy >= wa.y && sy <= wa.y + wa.height - 40) {
    x = sx
    y = sy
  }
  widgetWindow = new BrowserWindow({
    width: w,
    height: h,
    x,
    y,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: true,
    maximizable: false,
    minimizable: false,
    hasShadow: false,
    // Win：系统圆角底会铺出灰矩；圆角交给 CSS 面板
    roundedCorners: false,
    backgroundColor: '#00000000',
    show: s.widgetVisible,
    opacity: s.widgetMode === 'mini' && s.widgetDockEdge ? 1 : Math.min(1, Math.max(0.3, s.widgetOpacity ?? 1)),
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false
    }
  })
  // 顶层：吸附用独立开关
  if (s.widgetDesktopPin) {
    /* pin 稍后 apply */
  } else {
    const onTop = dockEdge ? s.widgetDockOnTop !== false : s.widgetOnTop !== false
    widgetWindow.setAlwaysOnTop(onTop, onTop ? 'screen-saver' : 'floating')
  }
  load(widgetWindow, 'widget')
  widgetPenetration = !!s.widgetPenetration
  // 挖洞默认：穿透空区，实体 UI 由渲染层 widget:hit 收回
  if (widgetPenetration) widgetWindow.setIgnoreMouseEvents(true)
  else widgetWindow.setIgnoreMouseEvents(true, { forward: true })
  widgetHitSolid = false
  if (mode === 'mini') applyMiniSizeLock(dockEdge)
  widgetWindow.webContents.once('did-finish-load', () => {
    // 冷启动：有吸附边则强制贴边（不只靠记忆坐标）
    if (mode === 'mini' && dockEdge) {
      applyMiniDock(dockEdge, sy >= 0 ? sy : undefined, sx >= 0 ? sx : undefined)
    } else if (dockEdge) {
      notifyDock(dockEdge)
    }
    broadcastWidgetSettings()
  })
  return widgetWindow
}

/** 动作工坊窗口（动作录制/预览/入库） */
export function createMotionWindow(): BrowserWindow {
  const existing = BrowserWindow.getAllWindows().find((w) => w.title === 'WorkOn Motion')
  if (existing) {
    existing.show()
    existing.focus()
    return existing
  }
  const win = new BrowserWindow({
    width: 1020,
    height: 760,
    minWidth: 880,
    minHeight: 640,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#0B1220',
    title: 'WorkOn Motion',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })
  win.once('ready-to-show', () => win.show())
  load(win, 'motion')
  return win
}

/** 桌宠窗口：全屏透明 overlay（方案B：置顶 + 区域点击穿透） */
export function createPetWindow(): BrowserWindow {
  if (petWindow && !petWindow.isDestroyed()) return petWindow
  const display = screen.getPrimaryDisplay()
  petWindow = new BrowserWindow({
    x: display.bounds.x,
    y: display.bounds.y,
    width: display.bounds.width,
    height: display.bounds.height,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    movable: false,
    hasShadow: false,
    fullscreenable: false,
    backgroundColor: '#00000000',
    show: getSettings().petEnabled,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      // 全屏透明 overlay 会被系统判定为「被遮挡」而冻结 rAF → 角色消失/点击失效；
      // 桌宠必须始终渲染
      backgroundThrottling: false
    }
  })
  // 方案B 默认：整体点击穿透 + forward，由渲染层按命中结果逐帧切换
  petWindow.setIgnoreMouseEvents(true, { forward: true })
  // 置顶提到 screen-saver 档：普通 topmost 应用（聊天窗等）不再盖住桌宠
  petWindow.setAlwaysOnTop(true, 'screen-saver')
  // 渲染层错误转发（定位角色不显示/加载失败）
  petWindow.webContents.on('console-message', (_e, level, message, line, sourceId) => {
    if (level >= 2) console.error(`[pet-renderer] ${message} (${sourceId}:${line})`)
  })
  load(petWindow, 'pet')
  return petWindow
}

let petModalLock = false
/** 去重：避免每帧重复调 Win32 setIgnoreMouseEvents 卡鼠标 */
let lastPetIgnore: boolean | null = null

export function setPetIgnoreMouse(ignore: boolean): void {
  if (petModalLock) return
  if (!petWindow || petWindow.isDestroyed()) return
  if (lastPetIgnore === ignore) return
  lastPetIgnore = ignore
  petWindow.setIgnoreMouseEvents(ignore, ignore ? { forward: true } : undefined)
}

/** 弹窗态：菜单/面板可见时强制窗口接收鼠标事件（优先级高于 hitTest） */
export function setPetModal(active: boolean): void {
  petModalLock = active
  if (!petWindow || petWindow.isDestroyed()) return
  lastPetIgnore = null
  if (active) {
    lastPetIgnore = false
    petWindow.setIgnoreMouseEvents(false)
  } else {
    lastPetIgnore = true
    petWindow.setIgnoreMouseEvents(true, { forward: true })
  }
}

export function setWidgetPenetration(v: boolean): void {
  widgetPenetration = v
  if (widgetWindow && !widgetWindow.isDestroyed()) {
    // forward：穿透下仍转发鼠标移动，渲染层保住 hover 感知（与挖洞逻辑一致）
    if (v) widgetWindow.setIgnoreMouseEvents(true, { forward: true })
    else if (widgetHitSolid) widgetWindow.setIgnoreMouseEvents(false)
    else widgetWindow.setIgnoreMouseEvents(true, { forward: true })
  }
  // 任何入口（托盘/设置页/悬浮窗自身）改穿透，窗口渲染层都要跟上
  sendTo('widget', 'widget:penetration', v)
}

/** 挖洞命中：光标在实体 UI 上才收事件 */
export function setWidgetHit(over: boolean): void {
  if (widgetHitSolid === over) return
  widgetHitSolid = over
  if (!widgetWindow || widgetWindow.isDestroyed()) return
  if (widgetPenetration || widgetDragActive) return
  if (over) widgetWindow.setIgnoreMouseEvents(false)
  else widgetWindow.setIgnoreMouseEvents(true, { forward: true })
}

/** 切换悬浮窗模式：resize 到该模式的自定义尺寸（或默认）；mini 可恢复贴边 */
export function setWidgetMode(mode: WidgetMode): void {
  const next: WidgetMode = mode === 'compact' ? 'full' : mode
  if (next !== 'mini') {
    clearMiniSizeLock()
    setSettings({ widgetMode: next, widgetDockEdge: null })
    touchWidgetHabit('full')
    notifyDock(null)
    const size = getSettings().widgetSizes?.[next] ?? WIDGET_DEFAULT_SIZE[next]
    if (widgetWindow && !widgetWindow.isDestroyed()) resizeWidgetWindow(size.w, size.h)
    applyWidgetOpacity()
    applyWidgetTopForMode()
    return
  }
  setSettings({ widgetMode: 'mini' })
  const edge = getSettings().widgetDockEdge
  if (edge) {
    applyMiniDock(edge)
    return
  }
  const size = miniFreeSize()
  if (widgetWindow && !widgetWindow.isDestroyed()) {
    applyMiniSizeLock(null)
    resizeWidgetWindow(size.w, size.h)
  }
  touchWidgetHabit('mini')
  notifyDock(null)
  applyWidgetOpacity()
  applyWidgetTopForMode()
}

/** 手动缩放：应用尺寸并记忆到当前模式 + 位置（mini 忽略，保持定死） */
export function resizeWidget(w: number, h: number): void {
  const mode = getSettings().widgetMode
  if (mode === 'mini') {
    applyMiniSizeLock(getSettings().widgetDockEdge ?? null)
    return
  }
  pendingSizeSave = { mode, w: Math.round(w), h: Math.round(h) }
  resizeWidgetWindow(w, h, false)
  scheduleWidgetBoundsSave()
}

/** 临时缩放（动态高度，如告警弹出）：只调高不记忆；宽度忽略入参、恒用当前窗宽——
 *  展开瞬间渲染层可能读到吸附态的旧宽度回传，透传会污染已记忆的宽度 */
export function resizeWidgetTransient(_w: number, h: number): void {
  if (getSettings().widgetMode === 'mini') return
  if (!widgetWindow || widgetWindow.isDestroyed()) return
  const [w] = widgetWindow.getSize()
  resizeWidgetWindow(w, h)
}

/** 拖动：应用位移并记忆位置（多屏：按窗中心所在屏夹紧） */
export function moveWidgetBy(dx: number, dy: number): void {
  if (!widgetWindow || widgetWindow.isDestroyed()) return
  const [x, y] = widgetWindow.getPosition()
  const [w, h] = widgetWindow.getSize()
  const nx0 = x + dx
  const ny0 = y + dy
  const wa = screen.getDisplayNearestPoint({
    x: Math.round(nx0 + w / 2),
    y: Math.round(ny0 + h / 2)
  }).workArea
  const nx = Math.min(Math.max(nx0, wa.x), Math.max(wa.x, wa.x + wa.width - w))
  const ny = Math.min(Math.max(ny0, wa.y), Math.max(wa.y, wa.y + wa.height - h))
  widgetWindow.setPosition(Math.round(nx), Math.round(ny))
  scheduleWidgetBoundsSave()
}

/** 迷你胶囊跟光标拖：渲染层超过阈值后 begin，松手 end（不用 app-region，避免吞双击） */
let widgetDragActive = false
let widgetDragPoll: ReturnType<typeof setInterval> | null = null
let widgetDragGrab: { ox: number; oy: number } | null = null

export function beginWidgetDrag(): void {
  if (!widgetWindow || widgetWindow.isDestroyed()) return
  if (widgetDragActive) return
  widgetDragActive = true
  try {
    widgetWindow.setIgnoreMouseEvents(false)
    widgetWindow.setMovable(true)
  } catch { /* ignore */ }
  const cur = screen.getCursorScreenPoint()
  // 吸附态：按光标相对点扩成自由胶囊，不往外硬顶
  const dockEdge = getSettings().widgetDockEdge
  if (getSettings().widgetMode === 'mini' && dockEdge) {
    widgetDragGrab = undockMiniForDrag(cur)
  } else {
    if (getSettings().widgetMode === 'mini') applyMiniSizeLock(null)
    const [wx, wy] = widgetWindow.getPosition()
    widgetDragGrab = { ox: cur.x - wx, oy: cur.y - wy }
  }
  if (widgetDragPoll) clearInterval(widgetDragPoll)
  const startedAt = Date.now()
  widgetDragPoll = setInterval(() => {
    if (!widgetDragActive || !widgetWindow || widgetWindow.isDestroyed()) {
      endWidgetDrag()
      return
    }
    if (Date.now() - startedAt > 45000) {
      endWidgetDrag()
      return
    }
    const grab = widgetDragGrab
    if (!grab) return
    const p = screen.getCursorScreenPoint()
    const [w, h] = widgetWindow.getSize()
    const tx = p.x - grab.ox
    const ty = p.y - grab.oy
    const wa = screen.getDisplayNearestPoint({
      x: Math.round(tx + w / 2),
      y: Math.round(ty + h / 2)
    }).workArea
    const nx = Math.min(Math.max(Math.round(tx), wa.x), Math.max(wa.x, wa.x + wa.width - w))
    const ny = Math.min(Math.max(Math.round(ty), wa.y), Math.max(wa.y, wa.y + wa.height - h))
    try {
      widgetWindow.setPosition(nx, ny, false)
    } catch {
      widgetWindow.setPosition(nx, ny)
    }
  }, 16)
}

export function endWidgetDrag(): void {
  if (!widgetDragActive && !widgetDragPoll) return
  widgetDragActive = false
  if (widgetDragPoll) {
    clearInterval(widgetDragPoll)
    widgetDragPoll = null
  }
  widgetDragGrab = null
  scheduleWidgetBoundsSave()
  trySnapMiniWidget()
  // 松手后恢复挖洞（由渲染层下一次 hit 校正；先穿透空区）
  if (!widgetPenetration && widgetWindow && !widgetWindow.isDestroyed()) {
    if (widgetHitSolid) widgetWindow.setIgnoreMouseEvents(false)
    else widgetWindow.setIgnoreMouseEvents(true, { forward: true })
  }
}

export function toggleWidget(): void {
  if (!widgetWindow || widgetWindow.isDestroyed()) return
  if (widgetWindow.isVisible()) {
    widgetWindow.hide()
    setSettings({ widgetVisible: false })
  } else {
    widgetWindow.show()
    setSettings({ widgetVisible: true })
    // 显式唤出时解除穿透，方便交互
    setWidgetPenetration(false)
  }
  // 状态同步：托盘勾选与渲染层 penetration 跟随（修复 ✕ 关闭后不同步）
  try {
    const { refreshTray } = require('./tray') as { refreshTray: () => void }
    refreshTray()
  } catch { /* tray 不可用时跳过 */ }
}

export function togglePet(): void {
  if (!petWindow || petWindow.isDestroyed()) {
    if (getSettings().petEnabled) createPetWindow()
    return
  }
  if (petWindow.isVisible()) petWindow.hide()
  else petWindow.show()
}

export function closePetWindow(): void {
  if (petWindow && !petWindow.isDestroyed()) petWindow.close()
  petWindow = null
}

export function sendTo(page: 'main' | 'widget' | 'pet' | 'dialog' | 'todoWidget' | 'workbench', channel: string, ...args: unknown[]): void {
  const win =
    page === 'main'
      ? mainWindow
      : page === 'widget'
        ? widgetWindow
        : page === 'pet'
          ? petWindow
          : page === 'dialog'
            ? dialogWindow
            : page === 'workbench'
              ? workbenchWindow
              : todoWidgetWindow
  if (win && !win.isDestroyed()) win.webContents.send(channel, ...args)
}

// ── 全局对话框 + 待办树小组件（v7 项目循环） ──

export let dialogWindow: BrowserWindow | null = null
export let todoWidgetWindow: BrowserWindow | null = null

export function createDialogWindow(): BrowserWindow {
  if (dialogWindow && !dialogWindow.isDestroyed()) {
    if (!dialogWindow.isVisible()) dialogWindow.show()
    dialogWindow.focus()
    return dialogWindow
  }
  const display = screen.getPrimaryDisplay()
  const wa = display.workArea
  dialogWindow = new BrowserWindow({
    width: 380,
    height: 540,
    x: wa.x + wa.width - 404,
    y: wa.y + wa.height - 564,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    hasShadow: false,
    backgroundColor: '#00000000',
    show: true,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false
    }
  })
  load(dialogWindow, 'dialog')
  return dialogWindow
}

export function toggleDialogWindow(): void {
  if (!dialogWindow || dialogWindow.isDestroyed()) {
    createDialogWindow()
    return
  }
  if (dialogWindow.isVisible()) dialogWindow.hide()
  else {
    dialogWindow.show()
    dialogWindow.focus()
  }
}

export function createTodoWidgetWindow(): BrowserWindow {
  if (todoWidgetWindow && !todoWidgetWindow.isDestroyed()) return todoWidgetWindow
  const s = getSettings()
  const display = screen.getPrimaryDisplay()
  const wa = display.workArea
  const w = 300
  const h = 560
  // 位置记忆：上次的坐标还在屏内就用，否则回落右下角默认位
  const saved = s.todoWidgetPos
  const onScreen = (x: number, y: number): boolean =>
    screen.getAllDisplays().some(
      (d) => x >= d.bounds.x - 60 && y >= d.bounds.y - 20 && x <= d.bounds.x + d.bounds.width - 100 && y <= d.bounds.y + d.bounds.height - 60
    )
  const px = saved && onScreen(saved.x, saved.y) ? saved.x : wa.x + wa.width - w - 12
  const py = saved && onScreen(saved.x, saved.y) ? saved.y : wa.y + 48
  console.log(`[todoWin] create: saved=${JSON.stringify(saved)} -> (${px}, ${py})`)
  todoWidgetWindow = new BrowserWindow({
    width: w,
    height: h,
    x: px,
    y: py,
    frame: false,
    transparent: true,
    alwaysOnTop: s.todoWidgetOnTop !== false,
    skipTaskbar: true,
    resizable: false,
    hasShadow: false,
    backgroundColor: '#00000000',
    // Windows 11+ 原生磨砂玻璃（不支持的系统自动降级为普通透明）
    show: !!s.todoWidgetVisible,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false
    }
  })
  todoWidgetWindow.setOpacity(s.todoWidgetOpacity ?? 0.95)
  if (s.todoWidgetOnTop === false) {
    // 底层模式：点击穿透 + 沉底
    todoWidgetWindow.setIgnoreMouseEvents(true, { forward: true })
    todoWidgetWindow.setAlwaysOnTop(false)
  }
  load(todoWidgetWindow, 'todoWidget')
  // 拖动后记忆位置（moved 防抖 500ms，拖完一次性落盘）
  let moveSaveTimer: NodeJS.Timeout | null = null
  todoWidgetWindow.on('moved', () => {
    if (moveSaveTimer) clearTimeout(moveSaveTimer)
    moveSaveTimer = setTimeout(() => {
      if (!todoWidgetWindow || todoWidgetWindow.isDestroyed()) return
      const [cx, cy] = todoWidgetWindow.getPosition()
      console.log(`[todoWin] moved-save: (${cx}, ${cy})`)
      setSettings({ todoWidgetPos: { x: cx, y: cy } })
    }, 500)
  })
  todoWidgetWindow.once('ready-to-show', () => {
    applyTodoWidgetChrome()
    if (getSettings().todoWidgetCollapsed) {
      sendTo('todoWidget', 'todoWidget:collapsed', { collapsed: true })
    }
    if (getSettings().todoWidgetDesktopPin) {
      setTimeout(() => applyTodoDesktopPin(), 200)
    }
  })
  return todoWidgetWindow
}

export function toggleTodoWidget(): void {
  const s = getSettings()
  const next = !s.todoWidgetVisible
  setSettings({ todoWidgetVisible: next })
  if (!todoWidgetWindow || todoWidgetWindow.isDestroyed()) {
    if (next) createTodoWidgetWindow()
    return
  }
  if (next) todoWidgetWindow.show()
  else todoWidgetWindow.hide()
}

/** 顶层/底层切换（穿透 + 沉底） */
export function setTodoWidgetLayer(onTop: boolean): void {
  setSettings({ todoWidgetOnTop: onTop })
  if (!todoWidgetWindow || todoWidgetWindow.isDestroyed()) return
  if (onTop) {
    if (!getSettings().todoWidgetPenetration) todoWidgetWindow.setIgnoreMouseEvents(false)
    todoWidgetWindow.setAlwaysOnTop(true, 'screen-saver')
  } else {
    todoWidgetWindow.setIgnoreMouseEvents(true, { forward: true })
    todoWidgetWindow.setAlwaysOnTop(false)
  }
}

/** 待办小组件：鼠标穿透（设置驱动） */
export function setTodoWidgetPenetration(v: boolean): void {
  setSettings({ todoWidgetPenetration: v })
  if (!todoWidgetWindow || todoWidgetWindow.isDestroyed()) return
  setSettings({ todoWidgetPenetration: v })
  // 关穿透无条件恢复鼠标（旧逻辑沉底时不恢复 → 卡在穿透态直到重启）
  todoWidgetWindow.setIgnoreMouseEvents(!v, { forward: v })
  sendTo('todoWidget', 'todoWidget:penetration', v)
}

/** 监控悬浮窗：顶层开关 */
export function setWidgetOnTop(v: boolean): void {
  setSettings({ widgetOnTop: v })
  if (widgetWindow && !widgetWindow.isDestroyed()) widgetWindow.setAlwaysOnTop(v, v ? 'screen-saver' : 'floating')
}

/** 桌宠：不透明度（渲染层自身 hit-test 逻辑不受影响） */
export function setPetOpacity(v: number): void {
  setSettings({ petOpacity: v })
  if (petWindow && !petWindow.isDestroyed()) petWindow.setOpacity(v)
}

/** 待办组件收起/展开（设置 + 通知渲染层） */
export function setTodoWidgetCollapsed(v: boolean): void {
  setSettings({ todoWidgetCollapsed: !!v })
  // 收起 → 窗口缩成小胶囊；展开 → 恢复完整尺寸
  if (todoWidgetWindow && !todoWidgetWindow.isDestroyed()) {
    if (v) {
      const [x, y] = todoWidgetWindow.getPosition()
      todoWidgetWindow.setSize(80, 32)
      // 防止缩完后超出屏幕
      const display = screen.getPrimaryDisplay()
      const wa = display.workArea
      todoWidgetWindow.setPosition(
        Math.min(x, wa.x + wa.width - 88),
        Math.min(y, wa.y + wa.height - 40)
      )
    } else {
      todoWidgetWindow.setSize(300, 560)
    }
  }
  sendTo('todoWidget', 'todoWidget:collapsed', { collapsed: !!v })
}

/** 推送待办磨砂/透明度到渲染层（不改 HWND 几何） */
export function applyTodoWidgetGlass(glass?: boolean): void {
  const s = getSettings()
  const g = glass ?? !!s.overlayGlass
  sendTo('todoWidget', 'todoWidget:style', {
    glass: g,
    opacity: s.todoWidgetOpacity ?? 0.95
  })
}

export function applyTodoWidgetChrome(): void {
  applyTodoWidgetGlass()
  const s = getSettings()
  sendTo('todoWidget', 'todoWidget:content-opacity', s.todoWidgetOpacity ?? 0.95)
}

/** 待办钉桌面（与浮窗分开关） */
export function applyTodoDesktopPin(): boolean {
  if (!todoWidgetWindow || todoWidgetWindow.isDestroyed()) return false
  if (getSettings().todoWidgetDesktopPin) {
    todoWidgetWindow.setAlwaysOnTop(false)
    console.log(`[todoWin] desktop-pin attach, bounds before:`, JSON.stringify(todoWidgetWindow.getBounds()))
    const ok = attachWindowToDesktop(todoWidgetWindow)
    console.log(`[todoWin] desktop-pin attach ok=${ok}, bounds after:`, todoWidgetWindow && !todoWidgetWindow.isDestroyed() ? JSON.stringify(todoWidgetWindow.getBounds()) : 'destroyed')
    if (!ok) {
      setSettings({ todoWidgetDesktopPin: false })
      if (getSettings().todoWidgetOnTop !== false) {
        todoWidgetWindow.setAlwaysOnTop(true, 'screen-saver')
      }
      try { todoWidgetWindow.show() } catch { /* ignore */ }
      sendTo('todoWidget', 'todoWidget:desktop-pin-result', { ok: false, reason: 'attach-failed' })
      return false
    }
    applyTodoWidgetChrome()
    sendTo('todoWidget', 'todoWidget:desktop-pin-result', { ok: true, pinned: true })
    return true
  }
  detachWindowFromDesktop(todoWidgetWindow)
  if (getSettings().todoWidgetOnTop !== false) {
    todoWidgetWindow.setAlwaysOnTop(true, 'screen-saver')
  } else {
    todoWidgetWindow.setAlwaysOnTop(false)
  }
  try { todoWidgetWindow.show() } catch { /* ignore */ }
  applyTodoWidgetChrome()
  sendTo('todoWidget', 'todoWidget:desktop-pin-result', { ok: true, pinned: false })
  return true
}

/** 监控浮窗钉桌面（与待办分开关；不改拖动/吸附逻辑） */
export function applyWidgetDesktopPin(): boolean {
  if (!widgetWindow || widgetWindow.isDestroyed()) return false
  if (getSettings().widgetDesktopPin) {
    widgetWindow.setAlwaysOnTop(false)
    const ok = attachWindowToDesktop(widgetWindow)
    if (!ok) {
      setSettings({ widgetDesktopPin: false })
      if (getSettings().widgetOnTop !== false) {
        widgetWindow.setAlwaysOnTop(true, 'screen-saver')
      }
      try { widgetWindow.show() } catch { /* ignore */ }
      return false
    }
    return true
  }
  detachWindowFromDesktop(widgetWindow)
  if (getSettings().widgetOnTop !== false) {
    widgetWindow.setAlwaysOnTop(true, 'screen-saver')
  } else {
    widgetWindow.setAlwaysOnTop(false)
  }
  try { widgetWindow.show() } catch { /* ignore */ }
  return true
}

/** 外观变更推到各窗（不改浮窗尺寸/拖动） */
export function applyAppearanceToOverlays(): void {
  const s = getSettings()
  const payload = {
    appearanceMode: s.appearanceMode,
    darkTone: s.darkTone
  }
  sendTo('main', 'appearance:update', payload)
  sendTo('widget', 'appearance:update', payload)
  sendTo('todoWidget', 'appearance:update', payload)
  applyTodoWidgetChrome()
}

export function broadcast(channel: string, ...args: unknown[]): void {
  sendTo('main', channel, ...args)
  sendTo('widget', channel, ...args)
  sendTo('pet', channel, ...args)
  sendTo('todoWidget', channel, ...args)
}

// ───────────────────────── v10 工作台拆出窗（右页独立：吸附+位置记忆） ─────────────────────────

let workbenchWindow: BrowserWindow | null = null

const WB_DEFAULT_SIZE = { w: 900, h: 700 }
const WB_DOCK_SNAP = 26 // 距屏边 ≤26px 吸附

export function isWorkbenchDetached(): boolean {
  return !!workbenchWindow && !workbenchWindow.isDestroyed()
}

export function createWorkbenchWindow(): BrowserWindow {
  if (workbenchWindow && !workbenchWindow.isDestroyed()) {
    workbenchWindow.show()
    workbenchWindow.focus()
    return workbenchWindow
  }
  const s = getSettings()
  const display = screen.getPrimaryDisplay()
  const wa = display.workArea
  const saved = s.v10WorkbenchBounds
  const width = saved?.width ?? WB_DEFAULT_SIZE.w
  const height = saved?.height ?? WB_DEFAULT_SIZE.h
  let x = saved?.x ?? wa.x + wa.width - width - 24
  let y = saved?.y ?? wa.y + 40
  // 边界校验（多屏/分辨率变化回落主屏）
  if (x < wa.x - 100 || x > wa.x + wa.width - 80) x = wa.x + wa.width - width - 24
  if (y < wa.y - 20 || y > wa.y + wa.height - 60) y = wa.y + 40

  const win = new BrowserWindow({
    x,
    y,
    width,
    height,
    minWidth: 520,
    minHeight: 400,
    show: false,
    frame: false,
    backgroundColor: '#F7F4EE',
    title: 'WorkOn · 右页',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })
  if (isDev) void win.loadURL(`${process.env.ELECTRON_RENDERER_URL}/index.html?v10=1&pane=paper`)
  else void win.loadFile(path.join(__dirname, '../renderer/index.html'))
  win.once('ready-to-show', () => {
    win.show()
    console.info('[workbench] 右页已拆出')
  })

  // 位置记忆 + 边缘吸附（moved 节流）
  let snapTimer: NodeJS.Timeout | null = null
  const remember = (): void => {
    if (win.isDestroyed()) return
    const b = win.getBounds()
    setSettings({ v10WorkbenchBounds: { x: b.x, y: b.y, width: b.width, height: b.height } })
  }
  win.on('moved', () => {
    if (snapTimer) clearTimeout(snapTimer)
    snapTimer = setTimeout(() => {
      if (win.isDestroyed()) return
      const b = win.getBounds()
      // 边缘吸附：左/右/上/下 距 workArea 边 ≤26px
      const cur = screen.getDisplayMatching(b).workArea
      let nx = b.x
      let ny = b.y
      let snapped = false
      if (Math.abs(b.x - cur.x) <= WB_DOCK_SNAP) { nx = cur.x; snapped = true }
      else if (Math.abs(b.x + b.width - (cur.x + cur.width)) <= WB_DOCK_SNAP) { nx = cur.x + cur.width - b.width; snapped = true }
      if (Math.abs(b.y - cur.y) <= WB_DOCK_SNAP) { ny = cur.y; snapped = true }
      else if (Math.abs(b.y + b.height - (cur.y + cur.height)) <= WB_DOCK_SNAP) { ny = cur.y + cur.height - b.height; snapped = true }
      if (snapped) {
        win.setPosition(nx, ny)
        console.info('[workbench] 吸附', { nx, ny })
      }
      remember()
    }, 220)
  })
  win.on('resized', remember)
  win.on('closed', () => {
    workbenchWindow = null
    sendTo('main', 'workbench:state', { detached: false })
  })
  workbenchWindow = win
  sendTo('main', 'workbench:state', { detached: true })
  return win
}

export function attachWorkbench(): void {
  if (workbenchWindow && !workbenchWindow.isDestroyed()) {
    workbenchWindow.close()
    console.info('[workbench] 右页已合回主窗')
  }
}

export function getWorkbenchWindow(): BrowserWindow | null {
  return workbenchWindow && !workbenchWindow.isDestroyed() ? workbenchWindow : null
}


// ───────────────────────── v10 玻璃双窗（拆开=两块穿透玻璃片，磁性吸附合体） ─────────────────────────

let askPaneWindow: BrowserWindow | null = null
let paperPaneWindow: BrowserWindow | null = null

const PANE_DOCK_SNAP = 42 // 双窗间磁性吸附距离

function paneInteractiveGuard(win: BrowserWindow): void {
  // 玻璃片：整体穿透+forward，渲染层按命中切回可交互（pet 方案B 同源）
  win.setIgnoreMouseEvents(true, { forward: true })
}

function rememberPane(which: 'ask' | 'paper', win: BrowserWindow): void {
  const b = win.getBounds()
  setSettings(which === 'ask' ? { v10AskBounds: { x: b.x, y: b.y, width: b.width, height: b.height } } : { v10PaperBounds: { x: b.x, y: b.y, width: b.width, height: b.height } })
}

/** 磁性吸附：mover 靠近兄弟窗四向 ≤42px → 贴合 */
function paneMagneticSnap(moved: 'ask' | 'paper'): void {
  const a = moved === 'ask' ? askPaneWindow : paperPaneWindow
  const b = moved === 'ask' ? paperPaneWindow : askPaneWindow
  if (!a || a.isDestroyed() || !b || b.isDestroyed()) return
  const ra = a.getBounds()
  const rb = b.getBounds()
  let nx = ra.x
  let ny = ra.y
  let snapped = false
  // 左右贴合：a 右缘贴 b 左缘 / a 左缘贴 b 右缘（y 对齐上缘）
  if (Math.abs(ra.x + ra.width - rb.x) <= PANE_DOCK_SNAP) { nx = rb.x - ra.width; snapped = true }
  else if (Math.abs(rb.x + rb.width - ra.x) <= PANE_DOCK_SNAP) { nx = rb.x + rb.width; snapped = true }
  // 上下贴合（x 对齐左缘）
  if (Math.abs(ra.y + ra.height - rb.y) <= PANE_DOCK_SNAP) { ny = rb.y - ra.height; snapped = true }
  else if (Math.abs(rb.y + rb.height - ra.y) <= PANE_DOCK_SNAP) { ny = rb.y + rb.height; snapped = true }
  if (snapped) {
    a.setPosition(nx, ny)
    console.info(`[v10panes] ${moved} 磁性吸附`, { nx, ny })
  }
}

function createPaneWindow(which: 'ask' | 'paper'): BrowserWindow {
  const s = getSettings()
  const saved = which === 'ask' ? s.v10AskBounds : s.v10PaperBounds
  const wa = screen.getPrimaryDisplay().workArea
  const width = saved?.width ?? (which === 'ask' ? 400 : 880)
  const height = saved?.height ?? wa.height - 80
  let x = saved?.x ?? (which === 'ask' ? wa.x + 12 : wa.x + 428)
  let y = saved?.y ?? wa.y + 36
  if (x < wa.x - 80 || x > wa.x + wa.width - 60) x = which === 'ask' ? wa.x + 12 : wa.x + 428
  if (y < wa.y - 10 || y > wa.y + wa.height - 50) y = wa.y + 36

  const win = new BrowserWindow({
    x,
    y,
    width,
    height,
    minWidth: 300,
    minHeight: 320,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    skipTaskbar: false,
    title: which === 'ask' ? 'WorkOn · 问' : 'WorkOn · 右页',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })
  const pane = which
  if (isDev) void win.loadURL(`${process.env.ELECTRON_RENDERER_URL}/index.html?v10=1&pane=${pane}&glass=1`)
  else void win.loadFile(path.join(__dirname, '../renderer/index.html'))
  win.once('ready-to-show', () => {
    win.show()
    paneInteractiveGuard(win)
  })
  win.on('blur', () => paneInteractiveGuard(win))
  let snapTimer: NodeJS.Timeout | null = null
  win.on('moved', () => {
    if (snapTimer) clearTimeout(snapTimer)
    snapTimer = setTimeout(() => {
      if (win.isDestroyed()) return
      paneMagneticSnap(which)
      rememberPane(which, win)
    }, 200)
  })
  win.on('resized', () => rememberPane(which, win))
  win.on('closed', () => {
    if (which === 'ask') askPaneWindow = null
    else paperPaneWindow = null
    if (!askPaneWindow && !paperPaneWindow) {
      mainWindow?.show()
      sendTo('main', 'workbench:state', { detached: false })
    }
    sendTo('main', 'v10panes:state', {
      ask: !!askPaneWindow && !askPaneWindow.isDestroyed(),
      paper: !!paperPaneWindow && !paperPaneWindow.isDestroyed()
    })
  })
  return win
}

export function detachPanes(): void {
  // 玻璃拆开：主窗收起，两块穿透玻璃片上场
  const s = getSettings()
  const wa = screen.getPrimaryDisplay().workArea
  const askB = s.v10AskBounds
  const paperB = s.v10PaperBounds
  askPaneWindow = askPaneWindow && !askPaneWindow.isDestroyed() ? askPaneWindow : createPaneWindow('ask')
  askPaneWindow.setBounds(askB ? askB : { x: wa.x + 12, y: wa.y + 36, width: 400, height: wa.height - 80 })
  paperPaneWindow = paperPaneWindow && !paperPaneWindow.isDestroyed() ? paperPaneWindow : createPaneWindow('paper')
  paperPaneWindow.setBounds(paperB ? paperB : { x: wa.x + 428, y: wa.y + 36, width: 880, height: wa.height - 80 })
  mainWindow?.hide()
  sendTo('main', 'workbench:state', { detached: true })
  console.info('[v10panes] 玻璃拆开：问/右页 两块穿透玻璃片')
}

export function attachPanes(): void {
  askPaneWindow?.close()
  paperPaneWindow?.close()
  mainWindow?.show()
  mainWindow?.focus()
  // 状态机统一：玻璃合回也复位 detached（主窗占位卡依赖此事件）
  sendTo('main', 'workbench:state', { detached: false })
  console.info('[v10panes] 合体：恢复一面')
}

export function setPaneIgnore(ignore: boolean): void {
  // 渲染层命中切换：从主窗调（当前聚焦的玻璃片）
  for (const w of [askPaneWindow, paperPaneWindow]) {
    if (w && !w.isDestroyed()) w.setIgnoreMouseEvents(ignore, ignore ? { forward: true } : undefined)
  }
}

export function minimizeMain(): void {
  mainWindow?.minimize()
}

export function hideMainToTray(): void {
  // WorkOn 惯例：✕=收到托盘（不退出），托盘菜单/点图标唤回
  mainWindow?.hide()
}

export function hideWorkbench(): void {
  if (workbenchWindow && !workbenchWindow.isDestroyed()) workbenchWindow.hide()
}

export function panesState(): { ask: boolean; paper: boolean } {
  return {
    ask: !!askPaneWindow && !askPaneWindow.isDestroyed(),
    paper: !!paperPaneWindow && !paperPaneWindow.isDestroyed()
  }
}

/** 吸附固定（v10 拍板）：用户大概摆好位置，点一下「吸附」→ 精确贴合固定。
 *  按两窗当前相对方位选排布：paper 中心偏下=上下排（ask 上），偏右=左右排；默认上下。 */
export function snapPanes(): { layout: 'vertical' | 'horizontal' } {
  const a = askPaneWindow
  const p = paperPaneWindow
  if (!a || a.isDestroyed() || !p || p.isDestroyed()) return { layout: 'vertical' }
  const ra = a.getBounds()
  const rp = p.getBounds()
  const cur = screen.getDisplayMatching(
    { x: Math.min(ra.x, rp.x), y: Math.min(ra.y, rp.y), width: Math.max(ra.x + ra.width, rp.x + rp.width), height: Math.max(ra.y + ra.height, rp.y + rp.height) }
  ).workArea
  const aCenter = ra.y + ra.height / 2
  const pCenter = rp.y + rp.height / 2
  const aCenterX = ra.x + ra.width / 2
  const pCenterX = rp.x + rp.width / 2
  const verticalGap = Math.abs(aCenterY(ra, rp) - pCenter)
  const horizontalGap = Math.abs(aCenterX - pCenterX)
  function aCenterY(r1: Electron.Rectangle, r2: Electron.Rectangle): number {
    void r2
    return r1.y + r1.height / 2
  }
  let layout: 'vertical' | 'horizontal'
  let nx = ra.x
  let ny = ra.y
  let px = rp.x
  let py = rp.y
  if (verticalGap <= horizontalGap) {
    // 上下排：x 对齐，两窗高度均分工作区（总高超屏时自动收缩保证真贴合）
    layout = 'vertical'
    const halfH = Math.floor((cur.height - 8) / 2)
    const alignX = Math.round((ra.x + rp.x) / 2)
    nx = Math.max(cur.x + 4, Math.min(alignX, cur.x + cur.width - ra.width - 4))
    px = nx
    ny = cur.y + 4
    py = ny + halfH + 2
    a.setBounds({ x: nx, y: ny, width: ra.width, height: halfH })
    p.setBounds({ x: px, y: py, width: rp.width, height: cur.height - 8 - halfH })
  } else {
    // 左右排：y 对齐，两窗宽度均分工作区
    layout = 'horizontal'
    const halfW = Math.floor((cur.width - 12) / 2)
    const alignY = Math.round((ra.y + rp.y) / 2)
    ny = Math.max(cur.y + 4, Math.min(alignY, cur.y + cur.height - ra.height - 4))
    py = ny
    nx = cur.x + 4
    px = nx + halfW + 2
    a.setBounds({ x: nx, y: ny, width: halfW, height: ra.height })
    p.setBounds({ x: px, y: py, width: cur.width - 12 - halfW, height: rp.height })
  }
  a.setPosition(nx, ny)
  p.setPosition(px, py)
  rememberPane('ask', a)
  rememberPane('paper', p)
  console.info(`[v10panes] 吸附固定：${layout === 'vertical' ? '上下' : '左右'}排布`)
  return { layout }
}

/** 单独收起/展开（v10 拍板：拆开后每块能单独收起，统一管理） */
export function collapsePane(which: 'ask' | 'paper'): void {
  const w = which === 'ask' ? askPaneWindow : paperPaneWindow
  if (w && !w.isDestroyed()) w.hide()
}

export function expandPane(which: 'ask' | 'paper'): void {
  const w = which === 'ask' ? askPaneWindow : paperPaneWindow
  if (w && !w.isDestroyed()) {
    w.show()
    w.focus()
  }
}

/** 托盘/管理入口的收起态 */
/** 玻璃片窗口置顶（v10：桌面组件常需浮在其他应用上） */
export function setPaneTop(which: 'ask' | 'paper', on: boolean): void {
  const w = which === 'ask' ? askPaneWindow : paperPaneWindow
  if (w && !w.isDestroyed()) w.setAlwaysOnTop(on, 'floating')
}

export function paneCollapsed(which: 'ask' | 'paper'): boolean {
  const w = which === 'ask' ? askPaneWindow : paperPaneWindow
  return !!w && !w.isDestroyed() && !w.isVisible()
}
