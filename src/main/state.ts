/**
 * 中央状态总线：presence / petState / 轻问诊问题
 * 主进程各模块（ipc / integration / windows）经此订阅与广播
 */
import { EventEmitter } from 'events'
import type { DesktopState, PADEmotion, PetState, PresenceSnapshot, SuggestionQuestion } from '@shared/types'
import { presence } from './presence'
import { getSettings } from './settings'
import { getScoreStrategy } from './attention'

const clamp1 = (n: number): number => Math.min(1, Math.max(-1, n))

const PAD_BY_STATE: Record<string, { p: number; a: number; d: number }> = {
  focus: { p: 0.5, a: 0.3, d: 0.4 },
  coding: { p: 0.55, a: 0.4, d: 0.5 },
  aidev: { p: 0.6, a: 0.45, d: 0.5 },
  aiqa: { p: 0.5, a: 0.35, d: 0.3 },
  writing: { p: 0.45, a: 0.25, d: 0.35 },
  meeting: { p: 0.3, a: 0.4, d: 0.2 },
  remote: { p: 0.3, a: 0.35, d: 0.2 },
  slack: { p: 0.35, a: 0.5, d: -0.2 },
  relax: { p: 0.55, a: 0.1, d: -0.1 },
  idle: { p: 0.1, a: -0.2, d: -0.2 },
  break: { p: 0.5, a: -0.1, d: 0 },
  lunch: { p: 0.5, a: -0.1, d: 0 },
  away: { p: 0, a: -0.5, d: -0.3 }
}

class StateBus extends EventEmitter {
  pet: PetState
  question: SuggestionQuestion | null = null
  private lastPresence: PresenceSnapshot | null = null

  constructor() {
    super()
    const s = getSettings()
    this.pet = {
      workState: 'idle',
      emotion: { pleasure: 0.2, arousal: 0.2, dominance: 0 },
      energy: 1,
      intimacy: 1,
      message: null,
      characterId: s.petCharacter || 'ling',
      visible: s.petEnabled
    }
    presence.on('update', (snap: PresenceSnapshot) => {
      this.lastPresence = snap
      // 工作状态驱动桌宠情感（v2.4 双向共振：状态→PAD 基线）
      const pad = PAD_BY_STATE[snap.state] ?? { p: 0.2, a: 0.2, d: 0 }
      let emotion: PADEmotion = { pleasure: pad.p, arousal: pad.a, dominance: pad.d }
      // v2.6 评分驱动桌宠策略（scorePetAdapt）：按今日评分档叠加 PAD 偏移（§4.2）
      if (getSettings().scorePetAdapt) {
        const { padOffset } = getScoreStrategy()
        emotion = {
          pleasure: clamp1(emotion.pleasure + padOffset.p),
          arousal: clamp1(emotion.arousal + padOffset.a),
          dominance: clamp1(emotion.dominance + padOffset.d)
        }
      }
      this.pet = {
        ...this.pet,
        workState: snap.state,
        emotion
      }
      this.emit('presence', snap)
      this.emit('desktop-state', this.desktopState())
      this.emit('pet', this.pet)
    })
  }

  setPet(patch: Partial<PetState>): PetState {
    this.pet = { ...this.pet, ...patch }
    this.emit('pet', this.pet)
    this.emit('desktop-state', this.desktopState())
    return this.pet
  }

  setQuestion(q: SuggestionQuestion | null): void {
    this.question = q
    this.emit('question', q)
  }

  desktopState(): DesktopState {
    const snap = this.lastPresence ?? presence.getSnapshot()
    return {
      ts: Date.now(),
      presence: snap,
      pet: this.pet,
      todayMin: 0, // 由 integration 广播前填充（避免循环依赖）
      planAchievement: null
    }
  }
}

export const bus = new StateBus()
