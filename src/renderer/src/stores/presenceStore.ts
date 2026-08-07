import { create } from 'zustand'
import type { DesktopState, PresenceSnapshot, PetState } from '@shared/types'

interface PresenceState {
  presence: PresenceSnapshot | null
  pet: PetState | null
  todayMin: number
  planAchievement: number | null
  /** 初始化快照 + 订阅推送；返回清理函数 */
  init: () => () => void
}

export const usePresenceStore = create<PresenceState>()((set) => ({
  presence: null,
  pet: null,
  todayMin: 0,
  planAchievement: null,
  init: () => {
    window.api
      .getDesktop()
      .then((d) => {
        const ds = d as DesktopState | null
        if (ds) {
          set({
            presence: ds.presence ?? null,
            pet: ds.pet ?? null,
            todayMin: ds.todayMin ?? 0,
            planAchievement: ds.planAchievement ?? null
          })
        }
      })
      .catch(() => undefined)
    window.api
      .getPresence()
      .then((p) => {
        if (p) set({ presence: p as PresenceSnapshot })
      })
      .catch(() => undefined)
    window.api
      .getPet()
      .then((p) => {
        if (p) set({ pet: p as PetState })
      })
      .catch(() => undefined)
    const offPresence = window.api.onPresence((p) => set({ presence: p as PresenceSnapshot }))
    const offPet = window.api.onPet((p) => set({ pet: p as PetState }))
    return () => {
      offPresence()
      offPet()
    }
  }
}))
