import { create } from 'zustand'
import type { AgentInput } from '@shared/agents'

interface AgentWizardState {
  open: boolean
  /** 每次打开自增：已打开时再次说“增加 Agent”也能回到第一步 */
  session: number
  initial: Partial<AgentInput> | null
  openWizard: (initial?: Partial<AgentInput>) => void
  closeWizard: () => void
}

/** 全局“接入 Agent”向导：聊天里说“增加一个 Agent”或 Agent 页点＋都会打开 */
export const useAgentWizardStore = create<AgentWizardState>()((set) => ({
  open: false,
  session: 0,
  initial: null,
  openWizard: (initial) => set((s) => ({ open: true, session: s.session + 1, initial: initial ?? null })),
  closeWizard: () => set({ open: false, initial: null })
}))
