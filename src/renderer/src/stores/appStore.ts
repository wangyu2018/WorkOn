import { create } from 'zustand'

export type ViewKey = 'home' | 'more' | 'monitor' | 'knowledge' | 'calendar' | 'plan' | 'mainline' | 'report' | 'qa' | 'profile' | 'privacy' | 'settings' | 'intel' | 'agents' | 'workflow' | 'graph'

interface AppState {
  view: ViewKey
  setView: (v: ViewKey) => void
}

export const useAppStore = create<AppState>()((set) => ({
  view: 'home',
  setView: (view) => set({ view })
}))
