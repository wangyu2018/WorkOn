/**
 * 全局快捷键
 *  - Ctrl+Alt+B：悬浮窗显隐
 *  - Ctrl+Alt+P：桌宠显隐
 */
import { globalShortcut } from 'electron'
import { toggleWidget, togglePet } from './windows'

export function registerShortcuts(): void {
  try {
    globalShortcut.register('CommandOrControl+Alt+B', () => toggleWidget())
    globalShortcut.register('CommandOrControl+Alt+P', () => togglePet())
  } catch (e) {
    console.warn('[shortcut] 注册失败:', e)
  }
}

export function unregisterShortcuts(): void {
  globalShortcut.unregisterAll()
}
