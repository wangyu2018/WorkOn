/**
 * 主进程：发出桌宠动作意图（气泡可一并带上）
 */
import type { PetIntent, PetState } from '@shared/types'
import { bus } from './state'

/** 发意图并可选合并 message / 其它 PetState 字段 */
export function emitPetIntent(intent: PetIntent, patch: Partial<PetState> = {}): PetState {
  return bus.setPet({
    ...patch,
    intent,
    intentAt: Date.now()
  })
}
