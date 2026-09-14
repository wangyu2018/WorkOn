/**
 * 意图 → 程序化 clip（与 AnimationManager.PROCEDURAL / STATE_CLIP 对齐）
 * 业务只发 PetIntent；渲染层查此表播放
 */
import type { PetIntent } from './types'

export interface IntentFeedback {
  clip: string
  /** false = 播完回落空间态 / ENTRY_FOLLOW */
  loop: boolean
}

export const INTENT_FEEDBACK: Record<PetIntent, IntentFeedback> = {
  idle: { clip: 'idle_breath', loop: true },
  focus: { clip: 'idle_focus', loop: true },
  slack: { clip: 'relax_sway', loop: true },
  rest: { clip: 'relax_sway', loop: true },
  away: { clip: 'doze_loop', loop: true },
  overworked: { clip: 'tired_sway', loop: true },
  celebrate: { clip: 'idle_greet', loop: false },
  nudge: { clip: 'serious_arms', loop: false },
  chat_open: { clip: 'idle_greet', loop: false },
  block: { clip: 'serious_arms', loop: true },
  offwork: { clip: 'idle_greet', loop: false },
  overtime: { clip: 'serious_arms', loop: false },
  meeting: { clip: 'idle_breath', loop: true }
}

/** 优先落地的 8 个核心意图（其余可选） */
export const CORE_INTENTS: PetIntent[] = [
  'idle',
  'focus',
  'slack',
  'rest',
  'away',
  'overworked',
  'celebrate',
  'nudge'
]
