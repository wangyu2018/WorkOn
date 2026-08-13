/**
 * 窗口管理
 * 依据：PRD.md 架构「主窗口 + 悬浮窗 + 桌宠透明窗」；
 *       v4.0「方案B：alwaysOnTop + 点击穿透（人物区域外 setIgnoreMouseEvents forward）」
 */
import { BrowserWindow, screen, shell, app, nativeImage } from 'electron'
import path from 'path'
import fs from 'fs'
import { getSettings } from './settings'

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
  load(mainWindow, 'index')
  return mainWindow
}

/** 开启动画窗：独立 BrowserWindow 播放 assets/splash.html（约 8s，播完自动关闭） */
export function createSplashWindow(): BrowserWindow {
  splashWindow = new BrowserWindow({
    width: 640,
    height: 420,
    resizable: false,
    frame: false,
    backgroundColor: '#000713',
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
  const w = 340
  const h = 460
  widgetWindow = new BrowserWindow({
    width: w,
    height: h,
    x: display.workArea.x + display.workArea.width - w - 16,
    y: display.workArea.y + display.workArea.height - h - 16,
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
  return widgetWindow
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
      sandbox: false
    }
  })
  // 方案B 默认：整体点击穿透 + forward，由渲染层按命中结果逐帧切换
  petWindow.setIgnoreMouseEvents(true, { forward: true })
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

export function toggleWidget(): void {
  if (!widgetWindow || widgetWindow.isDestroyed()) return
  if (widgetWindow.isVisible()) widgetWindow.hide()
  else widgetWindow.show()
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

export function sendTo(page: 'main' | 'widget' | 'pet', channel: string, ...args: unknown[]): void {
  const win = page === 'main' ? mainWindow : page === 'widget' ? widgetWindow : petWindow
  if (win && !win.isDestroyed()) win.webContents.send(channel, ...args)
}

export function broadcast(channel: string, ...args: unknown[]): void {
  sendTo('main', channel, ...args)
  sendTo('widget', channel, ...args)
  sendTo('pet', channel, ...args)
}
