/**
 * 系统托盘（菜单随设置动态刷新：未开启的模块不显示）
 */
import { app, Menu, Tray, nativeImage } from 'electron'
import path from 'path'
import fs from 'fs'
import { createMainWindow, toggleWidget, togglePet, sendTo } from './windows'
import { getSettings } from './settings'

let tray: Tray | null = null

function loadIcon(filename: string): Electron.NativeImage {
  const file = path.join(app.getAppPath(), 'assets', filename)
  try {
    if (fs.existsSync(file)) return nativeImage.createFromPath(file)
  } catch { /* ignore */ }
  return nativeImage.createEmpty()
}

function buildMenu(): void {
  if (!tray) return
  const s = getSettings()
  const items: Electron.MenuItemConstructorOptions[] = [
    { label: '显示主界面', click: () => createMainWindow() },
    {
      label: '快速问答',
      click: () => {
        createMainWindow()
        // 主窗口就绪后切到问答页
        setTimeout(() => sendTo('main', 'nav:view', 'qa'), 600)
      }
    },
    {
      label: '隐私管理',
      click: () => {
        createMainWindow()
        setTimeout(() => sendTo('main', 'nav:view', 'privacy'), 600)
      }
    }
  ]
  if (s.widgetVisible) {
    items.push({ label: '悬浮窗 显/隐', click: () => toggleWidget() })
  }
  if (s.petEnabled) {
    items.push({ label: '桌搭 显/隐', click: () => togglePet() })
  }
  items.push({ type: 'separator' })
  items.push({
    label: '退出',
    click: () => {
      app.exit(0)
    }
  })
  tray.setContextMenu(Menu.buildFromTemplate(items))
}

export function createTray(): void {
  const icon = loadIcon('tray-dark-16.png')
  tray = new Tray(icon)
  tray.setToolTip('WorkOn — 桌面工作记录')
  buildMenu()
  tray.on('click', () => createMainWindow())
}

/** 设置变更时刷新托盘菜单（模块开关影响菜单项显示） */
export function refreshTray(): void {
  buildMenu()
}

/** 根据设置的总开关创建/销毁托盘 */
export function syncTrayFromSettings(): void {
  const s = getSettings()
  if (!s.widgetVisible && tray) {
    tray.destroy()
    tray = null
  } else if (s.widgetVisible && !tray) {
    createTray()
  }
}
