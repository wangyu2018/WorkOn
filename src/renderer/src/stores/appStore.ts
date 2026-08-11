import { create } from 'zustand'

export type ViewKey = 'home' | 'monitor' | 'calendar' | 'plan' | 'report' | 'buddy' | 'qa' | 'profile' | 'privacy' | 'settings'

interface AppState {
  view: ViewKey
  paletteOpen: boolean
  setView: (v: ViewKey) => void
  setPaletteOpen: (open: boolean) => void
}

export const useAppStore = create<AppState>()((set) => ({
  view: 'home',
  paletteOpen: false,
  setView: (view) => set({ view }),
  setPaletteOpen: (paletteOpen) => set({ paletteOpen })
}))
