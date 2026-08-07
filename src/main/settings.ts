/**
 * 设置持久化（userData/settings.json）
 */
import { app } from 'electron'
import fs from 'fs'
import path from 'path'
import { AppSettings, DEFAULT_SETTINGS } from '@shared/types'

let current: AppSettings = { ...DEFAULT_SETTINGS }
let file = ''

export function initSettings(): AppSettings {
  file = path.join(app.getPath('userData'), 'settings.json')
  try {
    if (fs.existsSync(file)) {
      const raw = JSON.parse(fs.readFileSync(file, 'utf-8'))
      current = { ...DEFAULT_SETTINGS, ...raw }
    }
  } catch (e) {
    console.warn('[settings] 读取失败，使用默认设置', e)
  }
  return current
}

export function getSettings(): AppSettings {
  return current
}

export function setSettings(patch: Partial<AppSettings>): AppSettings {
  current = { ...current, ...patch }
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, JSON.stringify(current, null, 2), 'utf-8')
  } catch (e) {
    console.warn('[settings] 写入失败', e)
  }
  return current
}
