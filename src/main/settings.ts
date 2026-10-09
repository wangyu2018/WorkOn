/**
 * 设置持久化（userData/settings.json）
 */
import { app } from 'electron'
import fs from 'fs'
import path from 'path'
import { AppSettings, DEFAULT_SETTINGS, DEFAULT_WIDGET_DISPLAY, type WidgetDisplayOptions } from '@shared/types'

let current: AppSettings = { ...DEFAULT_SETTINGS }
let file = ''

function mergeWidgetDisplay(raw: unknown): WidgetDisplayOptions {
  const d = DEFAULT_WIDGET_DISPLAY
  if (!raw || typeof raw !== 'object') return { ...d, dock: { ...d.dock }, mini: { ...d.mini }, full: { ...d.full }, todo: { ...d.todo } }
  const r = raw as Partial<WidgetDisplayOptions>
  return {
    dock: { ...d.dock, ...(r.dock ?? {}) },
    mini: { ...d.mini, ...(r.mini ?? {}) },
    full: { ...d.full, ...(r.full ?? {}) },
    todo: { ...d.todo, ...(r.todo ?? {}) }
  }
}

export function initSettings(): AppSettings {
  file = path.join(app.getPath('userData'), 'settings.json')
  let raw: Record<string, unknown> | null = null
  try {
    if (fs.existsSync(file)) {
      raw = JSON.parse(fs.readFileSync(file, 'utf-8')) as Record<string, unknown>
      current = { ...DEFAULT_SETTINGS, ...raw }
    }
  } catch (e) {
    console.warn('[settings] 读取失败，使用默认设置', e)
  }
  // Windows：半透明整窗会透出灰矩。用户滑条仍可调；建窗用实色面板+opacity。
  // 不再在启动时强制改回 1（否则设置/托盘透明度永久失效）。
  let dirty = false
  // 迁移①：清掉历史版本内置的和风共享 Key（已从默认值移除；存量 settings.json 里可能还存着）
  if (current.weatherApiKey === '07b9e0e0e70342b794728af1ccb5641d') {
    current.weatherApiKey = ''
    dirty = true
  }
  // 迁移②：隐私同意门——老用户（已有 settings.json）不回弹同意卡，视为已同意
  if (raw && raw.privacyConsent === undefined) {
    current.privacyConsent = 'granted'
    dirty = true
  }
  if (current.darkTone !== 'void' && current.darkTone !== 'navy') {
    current.darkTone = 'void'
    dirty = true
  }
  // 首次引入 widgetHabit：从旧单一坐标 / 穿透 / 顶层迁移
  if (!raw?.widgetHabit) {
    const edge = current.widgetDockEdge
    const px = current.widgetPosX ?? -1
    const py = current.widgetPosY ?? -1
    const last =
      edge ? 'dock' as const :
      (current.widgetMode === 'full' ? 'full' as const : 'mini' as const)
    const pos = px >= 0 && py >= 0 ? { x: px, y: py } : undefined
    current.widgetHabit = {
      lastLayout: last,
      penetration: !!current.widgetPenetration,
      onTop: current.widgetOnTop !== false,
      ...(last === 'dock' && edge && pos ? { dock: { edge, ...pos } } : {}),
      ...(last === 'full' && pos ? { full: pos } : {}),
      ...(last === 'mini' && pos ? { mini: pos } : {})
    }
    dirty = true
  }
  // widgetDisplay：缺省补全；嵌套 merge 保证新增字段有默认
  const mergedDisplay = mergeWidgetDisplay(current.widgetDisplay)
  if (!raw?.widgetDisplay || JSON.stringify(current.widgetDisplay) !== JSON.stringify(mergedDisplay)) {
    current.widgetDisplay = mergedDisplay
    dirty = true
  }
  // 旧版共用 desktopWidgetPin → 拆成待办 / 浮窗各自开关
  const legacyPin = !!(raw as { desktopWidgetPin?: boolean } | null)?.desktopWidgetPin
  if (raw && raw.todoWidgetDesktopPin === undefined && raw.widgetDesktopPin === undefined && legacyPin) {
    current.todoWidgetDesktopPin = true
    current.widgetDesktopPin = true
    dirty = true
  }
  if ('desktopWidgetPin' in (current as unknown as Record<string, unknown>)) {
    delete (current as unknown as Record<string, unknown>).desktopWidgetPin
    dirty = true
  }
  if (dirty) {
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true })
      fs.writeFileSync(file, JSON.stringify(current, null, 2), 'utf-8')
    } catch (e) {
      console.warn('[settings] 迁移写入失败', e)
    }
  }
  return current
}

export function getSettings(): AppSettings {
  return current
}

export function setSettings(patch: Partial<AppSettings>): AppSettings {
  if (patch.widgetDisplay !== undefined) {
    const prev = mergeWidgetDisplay(current.widgetDisplay)
    const p = patch.widgetDisplay
    current = {
      ...current,
      ...patch,
      widgetDisplay: mergeWidgetDisplay({
        dock: { ...prev.dock, ...(p.dock ?? {}) },
        mini: { ...prev.mini, ...(p.mini ?? {}) },
        full: { ...prev.full, ...(p.full ?? {}) },
        todo: { ...prev.todo, ...(p.todo ?? {}) }
      })
    }
  } else {
    current = { ...current, ...patch }
  }
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, JSON.stringify(current, null, 2), 'utf-8')
  } catch (e) {
    console.warn('[settings] 写入失败', e)
  }
  return current
}
