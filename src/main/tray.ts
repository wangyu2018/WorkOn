/**
 * 系统托盘（v8 重构）：状态 → 日常动作 → 三个悬浮面 → 细化 → 系统控制。
 * - 去重：穿透/桌宠开关只出现一处；主界面入口不再混在「记录」组
 * - 人话：鼠标穿透 → 点击穿过；透明度缩进不再用空格伪装
 * - 托盘常驻：藏悬浮窗不再销毁托盘（否则用户彻底失联，只能重启）
 * 注：托盘是 Windows 原生菜单，颜色字体跟系统走，无法套应用主题皮肤；
 *     这里的「风格」= 命名与产品词典一致 + 结构与勾选逻辑干净。
 */
import { app, Menu, Tray, nativeImage } from 'electron'
import path from 'path'
import fs from 'fs'
import { createMainWindow, toggleWidget, togglePet, sendTo, setWidgetPenetration, petWindow, widgetWindow, toggleTodoWidget, setTodoWidgetPenetration, setTodoWidgetLayer, setWidgetOnTop, setPetOpacity, applyWidgetOpacity, detachPanes, attachPanes, expandPane, paneCollapsed, panesState } from './windows'
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

/** 透明度三档 radio（共用模板）：档位判定与写回 */
function opacityRadios(
  value: number,
  pick: (v: number) => void
): Electron.MenuItemConstructorOptions[] {
  const tiers: { label: string; v: number }[] = [
    { label: '不透明', v: 1 },
    { label: '半透明', v: 0.7 },
    { label: '更透', v: 0.4 },
    { label: '无极调节…', v: -1 } // 跳设置页滑杆（原生菜单做不了滑块）
  ]
  return tiers.map((t, i) => ({
    label: t.label,
    type: 'radio',
    checked: t.v > 0 && (i === 0 ? value > 0.85 : i === 1 ? value > 0.55 && value <= 0.85 : value <= 0.55),
    click: () => {
      if (t.v < 0) {
        // 无极调节：跳设置页滑杆（原生菜单做不了滑块）
        openMain('settings')
        return
      }
      pick(t.v)
    }
  }))
}

function buildMenu(): void {
  if (!tray) return
  const s = getSettings()
  const paused = !!s.recordingPaused

  const sep = (): Electron.MenuItemConstructorOptions => ({ type: 'separator' })

  const items: Electron.MenuItemConstructorOptions[] = [
    // ── 状态 ──
    { label: paused ? '⏸ 记录已暂停' : '● 记录中', enabled: false },
    sep(),
    // ── 日常动作 ──
    { label: '打开 WorkOn', accelerator: 'CmdOrCtrl+Alt+O', registerAccelerator: false, click: () => openMain() },
    { label: '✦ 生成今日日报', accelerator: 'CmdOrCtrl+Alt+D', registerAccelerator: false, click: () => { void generateTodayReport() } },
    { label: '✦ 问 AI 搭子', accelerator: 'CmdOrCtrl+Alt+K', registerAccelerator: false, click: () => openMain('qa') },
    sep(),
    // ── 玻璃模式（v10）：两块穿透玻璃片统一管理 ──
    {
      label: '玻璃模式 ▸',
      submenu: [
        { label: '拆开（问/右页 两块玻璃片）', click: () => detachPanes() },
        { label: '合回一面', click: () => attachPanes() },
        { label: '吸附固定排布', click: () => { void import('./windows').then((m) => m.snapPanes()) } },
        { type: 'separator' },
        { label: '问玻璃（显示/唤回）', click: () => expandPane('ask') },
        { label: '右页玻璃（显示/唤回）', click: () => expandPane('paper') },
        {
          label: '收起全部玻璃',
          click: () => {
            const { collapsePane } = require('./windows') as typeof import('./windows')
            collapsePane('ask')
            collapsePane('paper')
          }
        }
      ]
    },
    sep(),
    // ── 三个悬浮面（一级开关，一处一个） ──
    {
      label: '悬浮窗',
      type: 'checkbox',
      checked: !!s.widgetVisible,
      registerAccelerator: false,
      click: () => {
        // toggleWidget 统一负责显隐+设置写入+托盘刷新（修复托盘勾选无效，审计 D1）
        toggleWidget()
      }
    },
    {
      label: '待办小组件',
      type: 'checkbox',
      checked: !!s.todoWidgetVisible,
      registerAccelerator: false,
      click: () => toggleTodoWidget()
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
    // ── 细化（每个悬浮面只在这里调穿透/层级/透明度） ──
    {
      label: '右页窗格调节 ▸',
      visible: !!s.widgetVisible,
      submenu: [
        { label: '点击穿透（点到下层应用）', type: 'checkbox', checked: !!s.widgetPenetration, click: (it) => { const v = !!(it as Electron.MenuItem & { checked?: boolean }).checked; setSettings({ widgetPenetration: v }); setWidgetPenetration(v) } },
        { label: '置顶显示', type: 'checkbox', checked: s.widgetOnTop !== false, click: (it) => { const v = !!(it as Electron.MenuItem & { checked?: boolean }).checked; setWidgetOnTop(v) } },
        { type: 'separator' },
        ...opacityRadios(s.widgetOpacity ?? 1, (v) => { setSettings({ widgetOpacity: v }); applyWidgetOpacity() })
      ]
    },
    {
      label: '待办窗格调节 ▸',
      visible: !!s.todoWidgetVisible,
      submenu: [
        { label: '点击穿透（点到下层应用）', type: 'checkbox', checked: !!s.todoWidgetPenetration, click: (it) => { const v = !!(it as Electron.MenuItem & { checked?: boolean }).checked; setTodoWidgetPenetration(v) } },
        { label: '置顶显示', type: 'checkbox', checked: s.todoWidgetOnTop !== false, click: (it) => { const v = !!(it as Electron.MenuItem & { checked?: boolean }).checked; setTodoWidgetLayer(v) } },
        { type: 'separator' },
        ...opacityRadios(s.todoWidgetOpacity ?? 0.95, (v) => { setSettings({ todoWidgetOpacity: v }); refreshTray() })
      ]
    },
    {
      label: '桌宠调节 ▸',
      visible: !!s.petEnabled,
      submenu: opacityRadios(s.petOpacity ?? 1, (v) => setPetOpacity(v))
    },
    sep(),
    // ── 系统控制 ──
    {
      label: paused ? '恢复记录' : '暂停记录',
      accelerator: 'CmdOrCtrl+Alt+P',
      registerAccelerator: false,
      click: () => {
        setSettings({ recordingPaused: !getSettings().recordingPaused })
        refreshTray()
      }
    },
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
  if (tray) return
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

/**
 * 托盘常驻：不管悬浮窗藏不藏，托盘都是最后的控制权
 * （旧逻辑藏悬浮窗即销毁托盘 → 用户失联只能重启，已废弃；仅确保存在）。
 */
export function syncTrayFromSettings(): void {
  createTray()
}
