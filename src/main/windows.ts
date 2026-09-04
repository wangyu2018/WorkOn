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

let widgetPenetration = false

const WIDGET_DEFAULT_SIZE: Record<WidgetMode, { w: number; h: number }> = {
  mini: { w: 210, h: 44 },
  compact: { w: 300, h: 150 },
  full: { w: 340, h: 520 },
}

function resizeWidgetWindow(w: number, h: number): void {
  if (!widgetWindow || widgetWindow.isDestroyed()) return
  const [x, y] = widgetWindow.getPosition()
  const [, curH] = widgetWindow.getSize()
  widgetWindow.setSize(Math.round(w), Math.round(h))
  const wa = screen.getPrimaryDisplay().workArea
  const ny = Math.min(Math.max(y + curH - h, wa.y), Math.max(wa.y, wa.y + wa.height - h))
  const nx = Math.min(Math.max(x, wa.x), Math.max(wa.x, wa.x + wa.width - w))
  widgetWindow.setPosition(Math.round(nx), Math.round(ny))
}

let saveWidgetTimer: ReturnType<typeof setTimeout> | null = null
function scheduleWidgetBoundsSave(): void {
  if (saveWidgetTimer) clearTimeout(saveWidgetTimer)
  saveWidgetTimer = setTimeout(() => {
    if (!widgetWindow || widgetWindow.isDestroyed()) return
    const [x, y] = widgetWindow.getPosition()
    const [w, h] = widgetWindow.getSize()
    const s = getSettings()
    const sizes = { ...(s.widgetSizes ?? {}) }
    sizes[s.widgetMode] = { w, h }
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
  return `${process.env.ELECTRON_RENDERER_URL}/${page}.html`
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
  const mode: WidgetMode = s.widgetMode ?? 'mini'
  const size = s.widgetSizes?.[mode] ?? WIDGET_DEFAULT_SIZE[mode]
  const w = size.w
  const h = size.h
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
    show: s.widgetVisible,
    opacity: s.widgetOpacity,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })
  load(widgetWindow, 'widget')
  widgetPenetration = !!s.widgetPenetration
  if (widgetPenetration) widgetWindow.setIgnoreMouseEvents(true)
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

export function setPetIgnoreMouse(ignore: boolean): void {
  if (petModalLock) return
  if (petWindow && !petWindow.isDestroyed()) {
    petWindow.setIgnoreMouseEvents(ignore, ignore ? { forward: true } : undefined)
  }
}

/** 弹窗态：菜单/面板可见时强制窗口接收鼠标事件（优先级高于 hitTest） */
export function setPetModal(active: boolean): void {
  petModalLock = active
  if (!petWindow || petWindow.isDestroyed()) return
  if (active) {
    petWindow.setIgnoreMouseEvents(false)
  } else {
    petWindow.setIgnoreMouseEvents(true, { forward: true })
  }
}

export function setWidgetPenetration(v: boolean): void {
  widgetPenetration = v
  if (widgetWindow && !widgetWindow.isDestroyed()) {
    widgetWindow.setIgnoreMouseEvents(v)
  }
}

/** 切换悬浮窗模式：resize 到该模式的自定义尺寸（或默认） */
export function setWidgetMode(mode: WidgetMode): void {
  const s = getSettings()
  const size = s.widgetSizes?.[mode] ?? WIDGET_DEFAULT_SIZE[mode]
  if (widgetWindow && !widgetWindow.isDestroyed()) resizeWidgetWindow(size.w, size.h)
  setSettings({ widgetMode: mode })
}

/** 手动缩放：应用尺寸并记忆到当前模式 + 位置 */
export function resizeWidget(w: number, h: number): void {
  resizeWidgetWindow(w, h)
  scheduleWidgetBoundsSave()
}

/** 临时缩放（动态高度，如告警弹出）：不记忆尺寸 */
export function resizeWidgetTransient(w: number, h: number): void {
  resizeWidgetWindow(w, h)
}

/** 拖动：应用位移并记忆位置 */
export function moveWidgetBy(dx: number, dy: number): void {
  if (!widgetWindow || widgetWindow.isDestroyed()) return
  const [x, y] = widgetWindow.getPosition()
  const [w, h] = widgetWindow.getSize()
  const wa = screen.getPrimaryDisplay().workArea
  const nx = Math.min(Math.max(x + dx, wa.x), Math.max(wa.x, wa.x + wa.width - w))
  const ny = Math.min(Math.max(y + dy, wa.y), Math.max(wa.y, wa.y + wa.height - h))
  widgetWindow.setPosition(Math.round(nx), Math.round(ny))
  scheduleWidgetBoundsSave()
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

export function sendTo(page: 'main' | 'widget' | 'pet' | 'dialog' | 'todoWidget', channel: string, ...args: unknown[]): void {
  const win =
    page === 'main'
      ? mainWindow
      : page === 'widget'
        ? widgetWindow
        : page === 'pet'
          ? petWindow
          : page === 'dialog'
            ? dialogWindow
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
  todoWidgetWindow = new BrowserWindow({
    width: w,
    height: h,
    x: wa.x + wa.width - w - 12,
    y: wa.y + 48,
    frame: false,
    transparent: true,
    alwaysOnTop: s.todoWidgetOnTop !== false,
    skipTaskbar: true,
    resizable: false,
    hasShadow: false,
    backgroundColor: '#00000000',
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
  if (v) todoWidgetWindow.setIgnoreMouseEvents(true, { forward: true })
  else if (getSettings().todoWidgetOnTop !== false) todoWidgetWindow.setIgnoreMouseEvents(false)
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

export function broadcast(channel: string, ...args: unknown[]): void {
  sendTo('main', channel, ...args)
  sendTo('widget', channel, ...args)
  sendTo('pet', channel, ...args)
}
