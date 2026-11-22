/**
 * 全局快捷键
 *  - Ctrl+Alt+B：悬浮窗显隐
 */
import { globalShortcut } from 'electron'
import { toggleWidget, toggleDialogWindow } from './windows'

export function registerShortcuts(): void {
  try {
    globalShortcut.register('CommandOrControl+Alt+B', () => toggleWidget())
    globalShortcut.register('Alt+Space', () => toggleDialogWindow())
  } catch (e) {
    console.warn('[shortcut] 注册失败:', e)
  }
}

export function unregisterShortcuts(): void {
  globalShortcut.unregisterAll()
}
