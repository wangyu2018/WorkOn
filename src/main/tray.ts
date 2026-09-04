/**
 * 系统托盘（v7 重构：记录/生成/显示/系统 四段分组 + 快捷键提示 + 勾选态）
 * 菜单随设置动态刷新：未开启的模块不显示
 */
import { app, Menu, Tray, nativeImage } from 'electron'
import path from 'path'
import fs from 'fs'
import { createMainWindow, toggleWidget, togglePet, sendTo, setWidgetPenetration, petWindow, widgetWindow, toggleTodoWidget, setTodoWidgetPenetration, setTodoWidgetLayer, setWidgetOnTop, setPetOpacity } from './windows'
import { getSettings, setSettings } from './settings'

let tray: Tray | null = null

function loadIcon(filename: string): Electron.NativeImage {
  const file = path.join(app.getAppPath(), 'assets', filename)
  try {
    if (fs.existsSync(file)) return nativeImage.createFromPath(file)
  } catch { /* ignore */ }
  return nativeImage.createEmpty()
}

/** 打开主窗口并跳到指定视图 */
function openMain(view?: string): void {
  createMainWindow()
  if (view) setTimeout(() => sendTo('main', 'nav:view', view), 600)
}

/** 生成今日日报：后台生成完成后打开报表页 */
async function generateTodayReport(): Promise<void> {
  const { dateKey } = await import('@shared/trail')
  const { generateReport } = await import('./report/engine')
  try {
    await generateReport(dateKey(Date.now()), undefined, true)
  } catch { /* 生成失败也打开报表页，页面内可见错误态 */ }
  openMain('report')
}

function buildMenu(): void {
  if (!tray) return
  const s = getSettings()

  const sep = (): Electron.MenuItemConstructorOptions => ({ type: 'separator' })

  const items: Electron.MenuItemConstructorOptions[] = [
    // ── 记录 ──
    { label: '记录', enabled: false },
    {
      label: '暂停记录',
      type: 'checkbox',
      checked: !!s.recordingPaused,
      accelerator: 'CmdOrCtrl+Alt+P',
      registerAccelerator: false,
      click: (item) => {
        const paused = !!(item as Electron.MenuItem & { checked?: boolean }).checked
        setSettings({ recordingPaused: paused })
        refreshTray()
      }
    },
    {
      label: '打开主界面',
      accelerator: 'CmdOrCtrl+Alt+O',
      registerAccelerator: false,
      click: () => openMain()
    },
    sep(),
    // ── 生成（AI） ──
    { label: '生成', enabled: false },
    {
      label: '✦ 生成今日日报',
      accelerator: 'CmdOrCtrl+Alt+D',
      registerAccelerator: false,
      click: () => { void generateTodayReport() }
    },
    {
      label: '✦ 问 AI 搭子',
      accelerator: 'CmdOrCtrl+Alt+K',
      registerAccelerator: false,
      click: () => openMain('qa')
    },
    sep(),
    // ── 显示 ──
    { label: '显示', enabled: false },
    {
      label: '悬浮窗',
      type: 'checkbox',
      checked: !!s.widgetVisible,
      registerAccelerator: false,
      click: () => {
        setSettings({ widgetVisible: !getSettings().widgetVisible })
        refreshTray()
      }
    },
    {
      label: '鼠标穿透（悬浮窗）',
      type: 'checkbox',
      checked: !!s.widgetPenetration,
      visible: !!s.widgetVisible,
      registerAccelerator: false,
      click: (item) => {
        const v = !!(item as Electron.MenuItem & { checked?: boolean }).checked
        setSettings({ widgetPenetration: v })
        setWidgetPenetration(v)
      }
    },
    {
      label: '桌宠',
      type: 'checkbox',
      checked: !!s.petEnabled,
      registerAccelerator: false,
      click: () => {
        const next = !getSettings().petEnabled
        setSettings({ petEnabled: next })
        if (next) togglePet()
        else if (petWindow && !petWindow.isDestroyed() && petWindow.isVisible()) togglePet()
        refreshTray()
      }
    },
    sep(),
    // ── 显示设置（默认收起，展开编辑三块悬浮面） ──
    {
      label: '显示设置 ▸',
      submenu: [
        // 悬浮窗
        { label: '悬浮窗', enabled: false },
        { label: '鼠标穿透', type: 'checkbox', checked: !!s.widgetPenetration, click: (it) => { const v = !!(it as Electron.MenuItem & { checked?: boolean }).checked; setSettings({ widgetPenetration: v }); setWidgetPenetration(v) } },
        { label: '顶层显示', type: 'checkbox', checked: s.widgetOnTop !== false, click: (it) => { const v = !!(it as Electron.MenuItem & { checked?: boolean }).checked; setWidgetOnTop(v) } },
        { label: '透明度', enabled: false },
        { label: '   100%', type: 'radio', checked: (s.widgetOpacity ?? 1) > 0.85, click: () => { setSettings({ widgetOpacity: 1 }); if (widgetWindow && !widgetWindow.isDestroyed()) widgetWindow.setOpacity(1) } },
        { label: '   70%', type: 'radio', checked: (s.widgetOpacity ?? 1) <= 0.85 && (s.widgetOpacity ?? 1) > 0.55, click: () => { setSettings({ widgetOpacity: 0.7 }); if (widgetWindow && !widgetWindow.isDestroyed()) widgetWindow.setOpacity(0.7) } },
        { label: '   40%', type: 'radio', checked: (s.widgetOpacity ?? 1) <= 0.55, click: () => { setSettings({ widgetOpacity: 0.4 }); if (widgetWindow && !widgetWindow.isDestroyed()) widgetWindow.setOpacity(0.4) } },
        { type: 'separator' },
        // 待办小组件
        { label: '待办小组件', enabled: false },
        { label: '显示', type: 'checkbox', checked: !!s.todoWidgetVisible, click: () => toggleTodoWidget() },
        { label: '鼠标穿透', type: 'checkbox', checked: !!s.todoWidgetPenetration, click: (it) => { const v = !!(it as Electron.MenuItem & { checked?: boolean }).checked; setTodoWidgetPenetration(v) } },
        { label: '顶层显示', type: 'checkbox', checked: s.todoWidgetOnTop !== false, click: (it) => { const v = !!(it as Electron.MenuItem & { checked?: boolean }).checked; setTodoWidgetLayer(v) } },
        { label: '透明度', enabled: false },
        { label: '   100%', type: 'radio', checked: (s.todoWidgetOpacity ?? 0.95) > 0.85, click: () => { setSettings({ todoWidgetOpacity: 1 }); refreshTray() } },
        { label: '   70%', type: 'radio', checked: (s.todoWidgetOpacity ?? 0.95) <= 0.85 && (s.todoWidgetOpacity ?? 0.95) > 0.55, click: () => { setSettings({ todoWidgetOpacity: 0.7 }); refreshTray() } },
        { label: '   40%', type: 'radio', checked: (s.todoWidgetOpacity ?? 0.95) <= 0.55, click: () => { setSettings({ todoWidgetOpacity: 0.4 }); refreshTray() } },
        { type: 'separator' },
        // 桌宠
        { label: '桌宠', enabled: false },
        { label: '显示', type: 'checkbox', checked: !!s.petEnabled, click: () => togglePet() },
        { label: '透明度', enabled: false },
        { label: '   100%', type: 'radio', checked: (s.petOpacity ?? 1) > 0.85, click: () => setPetOpacity(1) },
        { label: '   70%', type: 'radio', checked: (s.petOpacity ?? 1) <= 0.85 && (s.petOpacity ?? 1) > 0.55, click: () => setPetOpacity(0.7) },
        { label: '   40%', type: 'radio', checked: (s.petOpacity ?? 1) <= 0.55, click: () => setPetOpacity(0.4) }
      ]
    },
    sep(),
    // ── 系统 ──
    { label: '设置…', accelerator: 'CmdOrCtrl+,', registerAccelerator: false, click: () => openMain('settings') },
    {
      label: '退出 WorkOn',
      accelerator: 'CmdOrCtrl+Q',
      registerAccelerator: false,
      click: () => app.exit(0)
    }
  ]
  tray.setContextMenu(Menu.buildFromTemplate(items))
}

export function createTray(): void {
  const icon = loadIcon('tray-dark-16.png')
  tray = new Tray(icon)
  tray.setToolTip('WorkOn — 桌面工作记录')
  buildMenu()
  tray.on('click', () => openMain())
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
