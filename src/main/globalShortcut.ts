/**
 * 全局快捷键
 *  - Ctrl+Alt+B：悬浮窗显隐
 *  - Ctrl+Alt+P：桌宠显隐
 */
import { globalShortcut } from 'electron'
import { toggleWidget, togglePet, toggleDialogWindow, toggleTodoWidget } from './windows'

export function registerShortcuts(): void {
  try {
    globalShortcut.register('CommandOrControl+Alt+B', () => toggleWidget())
    globalShortcut.register('CommandOrControl+Alt+P', () => togglePet())
    globalShortcut.register('Alt+Space', () => toggleDialogWindow())
    // 只 toggle：内部会在需要时 create，避免 create(show)+toggle 立刻关掉
    globalShortcut.register('CommandOrControl+Alt+T', () => toggleTodoWidget())
  } catch (e) {
    console.warn('[shortcut] 注册失败:', e)
  }
}

export function unregisterShortcuts(): void {
  globalShortcut.unregisterAll()
}
