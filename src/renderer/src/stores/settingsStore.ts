import { create } from 'zustand'
import type { AppSettings } from '@shared/types'
import { DEFAULT_SETTINGS } from '@shared/types'

interface SettingsState {
  settings: AppSettings
  loaded: boolean
  load: () => Promise<void>
  /** 乐观更新 + 落盘（主进程会对部分键立即生效，如 widgetOpacity / petCharacter） */
  patch: (p: Partial<AppSettings>) => Promise<void>
}

function deepMerge<T>(base: T, override: Partial<T>): T {
  const result = { ...base } as Record<string, unknown>
  for (const key of Object.keys(override as Record<string, unknown>)) {
    const a = (base as Record<string, unknown>)[key]
    const b = (override as Record<string, unknown>)[key]
    if (a && typeof a === 'object' && !Array.isArray(a) && b && typeof b === 'object' && !Array.isArray(b)) {
      result[key] = deepMerge(a as Record<string, unknown>, b as Record<string, unknown>)
    } else {
      result[key] = b
    }
  }
  return result as T
}

export const useSettingsStore = create<SettingsState>()((set, get) => ({
  settings: DEFAULT_SETTINGS,
  loaded: false,
  load: async () => {
    try {
      const s = (await window.api.getSettings()) as AppSettings
      set({ settings: deepMerge(DEFAULT_SETTINGS, s), loaded: true })
    } catch {
      set({ loaded: true })
    }
  },
  patch: async (p) => {
    set({ settings: { ...get().settings, ...p } })
    await window.api.setSettings(p)
  }
}))
