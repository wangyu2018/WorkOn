/**
 * 全局快捷键
 *  - Ctrl+Space：命令面板（唤起主窗口并打开面板）
 *  - Ctrl+Alt+B：悬浮窗显隐
 *  - Ctrl+Alt+P：桌宠显隐
 */
import { globalShortcut } from 'electron'
import { createMainWindow, mainWindow, toggleWidget, togglePet } from './windows'

export function registerShortcuts(): void {
  try {
    globalShortcut.register('CommandOrControl+Space', () => {
      const win = createMainWindow()
      win.show()
      win.focus()
      win.webContents.send('open-palette')
    })
    globalShortcut.register('CommandOrControl+Alt+B', () => toggleWidget())
    globalShortcut.register('CommandOrControl+Alt+P', () => togglePet())
  } catch (e) {
    console.warn('[shortcut] 注册失败:', e)
  }
}

export function unregisterShortcuts(): void {
  globalShortcut.unregisterAll()
  void mainWindow
}
