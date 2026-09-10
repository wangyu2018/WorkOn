import { create } from 'zustand'

export type ViewKey = 'home' | 'monitor' | 'knowledge' | 'calendar' | 'plan' | 'report' | 'buddy' | 'qa' | 'profile' | 'privacy' | 'settings'

interface AppState {
  view: ViewKey
  setView: (v: ViewKey) => void
}

export const useAppStore = create<AppState>()((set) => ({
  view: 'home',
  setView: (view) => set({ view })
}))
