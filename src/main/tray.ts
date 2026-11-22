/**
 * 系统托盘（精简版）：状态 → 打开主界面 → 记录控制 → 设置 / 退出。
 * - 已下线功能不再出现在菜单：玻璃模式、悬浮窗 / 右页窗格、日报与问答快捷入口
 * - 托盘常驻：主窗口关闭只隐藏，托盘是最后的控制权
 * - 菜单是系统原生外观；macOS 用模板图，Windows 按明暗主题切换图标
 */
import { app, Menu, Tray, nativeImage, nativeTheme } from 'electron'
import path from 'path'
import fs from 'fs'
import type { ChatSession } from '@shared/types'
import { createMainWindow, openAskSession, sendTo } from './windows'
import { createChatSession, listChatSessions } from './chatSessions'
import { getSettings, setSettings } from './settings'

let tray: Tray | null = null

function loadIcon(filename: string): Electron.NativeImage {
  const file = path.join(app.getAppPath(), 'assets', filename)
  try {
    if (fs.existsSync(file)) return nativeImage.createFromPath(file)
  } catch { /* ignore */ }
  return nativeImage.createEmpty()
}

/**
 * 托盘图标：
 * - macOS 菜单栏是单色模板图，深色图标在深色菜单栏会「看不见」，交给系统按明暗着色
 * - Windows 任务栏深浅随系统主题，暗色用浅图标、亮色用深图标（主题切换时重设）
 */
function trayIcon(): Electron.NativeImage {
  if (process.platform === 'darwin') {
    const icon = loadIcon('tray-dark-16.png')
    icon.setTemplateImage(true)
    return icon
  }
  return loadIcon(nativeTheme.shouldUseDarkColors ? 'tray-light-16.png' : 'tray-dark-16.png')
}

/** 打开主窗口并跳到指定视图 */
function openMain(view?: string): void {
  createMainWindow()
  if (view) setTimeout(() => sendTo('main', 'nav:view', view), 600)
}

/** 会话菜单文案：标题 + 条数（过长截断） */
function sessionLabel(s: ChatSession): string {
  const title = s.title.length > 22 ? `${s.title.slice(0, 22)}…` : s.title
  return `${title}（${s.items.length} 条）`
}

function buildMenu(): Electron.Menu {
  const paused = !!getSettings().recordingPaused
  const recent = listChatSessions().slice(0, 5)

  const sep = (): Electron.MenuItemConstructorOptions => ({ type: 'separator' })
  const sessionItems: Electron.MenuItemConstructorOptions[] = recent.length
    ? recent.map((s) => ({ label: sessionLabel(s), click: () => openAskSession(s.id) }))
    : [{ label: '暂无会话', enabled: false }]

  const items: Electron.MenuItemConstructorOptions[] = [
    // ── 状态 ──
    { label: paused ? '⏸ 记录已暂停' : '● 记录中', enabled: false },
    sep(),
    // ── 主界面 / 会话 ──
    { label: '打开 WorkOn', click: () => openMain() },
    sep(),
    {
      label: '发起新会话',
      click: () => {
        // 已有空会话就复用，避免反复点出现一串「新会话」
        const empty = listChatSessions().find((s) => s.items.length === 0 && !(s.participants?.length))
        const created = empty ?? createChatSession({ target: { kind: 'local' } })
        openAskSession(created.id)
      }
    },
    {
      label: '切换会话 ▸',
      submenu: sessionItems
    },
    sep(),
    // ── 系统控制 ──
    {
      label: paused ? '恢复记录' : '暂停记录',
      click: () => {
        setSettings({ recordingPaused: !getSettings().recordingPaused })
      }
    },
    { label: '设置…', click: () => openMain('settings') },
    { label: '退出 WorkOn', click: () => app.exit(0) }
  ]
  return Menu.buildFromTemplate(items)
}

/** 每次弹出前重建菜单：最近会话 / 记录状态始终是最新的 */
function showMenu(): void {
  if (!tray || tray.isDestroyed()) return
  tray.popUpContextMenu(buildMenu())
}

export function createTray(): void {
  if (tray) return
  tray = new Tray(trayIcon())
  tray.setToolTip('WorkOn — 桌面工作记录')
  // macOS：左右键都出菜单（系统标准行为）
  // Windows：左键打开主窗口、右键出菜单；系统明暗切换时同步换图标
  if (process.platform === 'darwin') {
    tray.on('click', () => showMenu())
    tray.on('right-click', () => showMenu())
  } else {
    tray.on('click', () => openMain())
    tray.on('right-click', () => showMenu())
    nativeTheme.on('updated', () => {
      if (!tray || tray.isDestroyed()) return
      tray.setImage(trayIcon())
    })
  }
}

/** 托盘常驻：确保托盘存在（主窗口关闭只隐藏，托盘是最后的控制权） */
export function syncTrayFromSettings(): void {
  createTray()
}
