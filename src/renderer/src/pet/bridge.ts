/**
 * bridge：window.api 接线
 * - onPresence → WorkState→空间态映射（任务书 §空间行为系统）
 * - onPet → PAD 情感→表情/灯光/粒子；energy<0.3 → overworked；message → 气泡
 * - onPet.intent → INTENT_FEEDBACK 查表播 clip（短时打断空间态底噪）
 */
import type { PetState, PresenceSnapshot, WorkState } from '@shared/types'
import { PET_FEATURES } from './flags'
import { INTENT_FEEDBACK } from '@shared/petIntent'
import type { SpatialController } from './spatial/SpatialController'
import { SPATIAL_STATE_TABLE, type SpatialStateName } from './spatial/stateTable'
import type { Lighting, StatusMood } from './scene/Lighting'
import type { Animator } from './anim/Animator'
import type { AnimationManager } from './anim/AnimationManager'
import type { MicroBehaviors } from './anim/microBehaviors'
import type { ParticleSystem } from './fx/particles'
import type { Bubble } from './fx/bubble'
import { NEUTRAL_EXPRESSION, cloneExpression } from './character/expression'

interface BridgeDeps {
  spatial: SpatialController
  lighting: Lighting
  anim: Animator
  animMgr: AnimationManager
  micro: MicroBehaviors
  particles: ParticleSystem
  bubble: Bubble
}

export class Bridge {
  private deps: BridgeDeps
  private lastPet: PetState | null = null
  private lastWorkState: WorkState | null = null
  private lastPresence: PresenceSnapshot | null = null
  private debounceId: ReturnType<typeof setTimeout> | null = null
  /** 状态驻留迟滞：当前非紧急态至少停留 MIN_DWELL 才允许切走（识别层 coding/aidev/focus 秒级抖动 → 桌宠乱跳+缩放泵动） */
  private currentEnteredAt = 0
  private static MIN_DWELL_MS = 20_000

  constructor(deps: BridgeDeps) {
    this.deps = deps
  }

  /** 当前亲密度（点击回复语分档用） */
  get intimacy(): number {
    return this.lastPet?.intimacy ?? 1
  }

  /** 最近一次 presence 快照（场景化提醒用） */
  get presence(): PresenceSnapshot | null {
    return this.lastPresence
  }

  /** 桌宠能量（过劳提醒用） */
  get petEnergy(): number {
    return this.lastPet?.energy ?? 1
  }

  /** 状态切换防抖：紧急态立即执行；bottom 类互切 300ms；其余 800ms */
  private scheduleTransition(target: { name: SpatialStateName; pose?: string }): void {
    if (this.deps.spatial.docked) return
    if (!PET_FEATURES.autoSpatial) return // 排障基线：固定锚点，不做自动迁移
    if (target.name === this.deps.spatial.current) return
    const curCfg = SPATIAL_STATE_TABLE[this.deps.spatial.current]
    const cfg = SPATIAL_STATE_TABLE[target.name]
    if (cfg?.urgent) {
      this.deps.spatial.transitionTo(target.name, target.pose)
      this.currentEnteredAt = Date.now()
      return
    }
    // 驻留迟滞：非紧急态未住够最低时长就无视切换提案（下一轮 presence 再评估）
    if (Date.now() - this.currentEnteredAt < Bridge.MIN_DWELL_MS) return
    if (this.debounceId) clearTimeout(this.debounceId)
    const bottomClass = (n: SpatialStateName) => {
      const c = SPATIAL_STATE_TABLE[n]
      return c && (c.defaultPos.y === 'bottom' || c.defaultPos.y === 'peek')
    }
    const ms = bottomClass(target.name) && bottomClass(this.deps.spatial.current) ? 300 : 800
    this.debounceId = setTimeout(() => {
      this.debounceId = null
      this.deps.spatial.transitionTo(target.name, target.pose)
      this.currentEnteredAt = Date.now()
    }, ms)
  }

  /** 订阅 + 拉取初始状态 */
  async init(): Promise<void> {
    const api = typeof window !== 'undefined' ? window.api : undefined
    if (!api) return

    api.onPresence((p) => this.onPresence(p as PresenceSnapshot))
    api.onPet((pet) => this.onPet(pet as PetState))
    try {
      const [presence, pet] = await Promise.all([api.getPresence(), api.getPet()])
      if (presence) this.onPresence(presence as PresenceSnapshot)
      if (pet) this.onPet(pet as PetState)
    } catch {
      /* 主进程未就绪时保持默认 */
    }
  }

  /** WorkState → 空间态映射（任务书规定） */
  private mapWorkState(state: WorkState): { name: SpatialStateName; pose?: string } {
    switch (state) {
      case 'focus':
        return { name: 'deep_focus' }
      case 'coding':
        return { name: 'coding' }
      case 'writing':
        return { name: 'writing' }
      case 'aiqa':
        return { name: 'aiqa' }
      case 'aidev':
        return { name: 'aidev' }
      case 'slack':
        return { name: 'slack' }
      case 'relax':
        return { name: 'slack', pose: 'stand_relaxed' } // 放松变体
      case 'meeting':
      case 'remote':
        return { name: 'meeting' }
      case 'idle':
        return { name: 'working' }
      case 'break':
      case 'lunch':
        return { name: 'pomodoro_break', pose: 'stand_relaxed' } // 休息变体
      case 'away':
        return { name: 'sleeping' }
      default:
        return { name: 'working' }
    }
  }

  private onPresence(p: PresenceSnapshot): void {
    this.lastWorkState = p.state
    this.lastPresence = p
    // 前台窗口矩形 → 漫游避让（漫游时不在用户正在用的窗口上踩来踩去）
    this.deps.spatial.setAvoidRect(p.winRect ?? null)
    const energy = this.lastPet?.energy ?? 1
    let target = this.mapWorkState(p.state)

    // energy 低(<0.3) → overworked（睡眠/休息类状态除外）
    if (energy < 0.3 && !['away', 'break', 'lunch'].includes(p.state)) {
      target = { name: 'overworked' }
    }
    this.scheduleTransition(target)

    // 状态灯 + 粒子情绪
    const mood: StatusMood =
      p.state === 'focus'
        ? 'focus'
        : p.state === 'slack' || p.state === 'relax'
          ? 'slack'
          : p.state === 'break' || p.state === 'lunch' || p.state === 'away'
            ? 'rest'
            : 'idle'
    this.deps.lighting.setMood(mood)
    this.deps.particles.setMood(
      p.state === 'away' ? 'sleeping' : p.state === 'relax' || p.state === 'break' ? 'relax' : 'normal'
    )
  }

  private onPet(pet: PetState): void {
    const prev = this.lastPet
    this.lastPet = pet

    // PAD → 表情映射：P→嘴笑程度/腮红，A→身体摆动/眼睛睁大，D→眉毛高度
    const e = cloneExpression(NEUTRAL_EXPRESSION)
    e.smile = 0.25 + pet.emotion.pleasure * 0.4
    e.blush = Math.max(0.1, 0.25 + pet.emotion.pleasure * 0.35)
    e.eyeWide = Math.max(0, pet.emotion.arousal) * 0.4
    // 注意：不写 eyeOpen——PAD 情绪无权覆盖眼睑，否则睡觉/困倦姿态的闭眼会被周期性睁开
    e.browRaise = pet.emotion.dominance * 0.5
    // 仅在无姿态表情覆盖时平滑跟随（避免与姿态表情打架，权重 0.5 近似）
    this.deps.anim.setExpression(e, 0.5)
    if (PET_FEATURES.microLife) this.deps.micro.arousal = Math.abs(pet.emotion.arousal)

    // 开心跃升（pleasure 快速升到 0.6+）→ 挥一次手
    const prevP = prev?.emotion.pleasure ?? 0
    if (pet.emotion.pleasure > 0.6 && pet.emotion.pleasure - prevP > 0.25) {
      this.deps.micro.triggerWave()
    }

    // 能量变化 → 仅重评估 overworked（此前用半截假快照重进 onPresence：
    // 每次都清空避让矩形 + 污染场景快照，是「乱跳」的共犯）
    if (prev && prev.energy !== pet.energy && this.lastWorkState) {
      const restState = ['away', 'break', 'lunch'].includes(this.lastWorkState)
      if (pet.energy < 0.3 && !restState) this.scheduleTransition({ name: 'overworked' })
    }

    // 消息气泡（3-6s）
    if (PET_FEATURES.care && pet.message && pet.message !== prev?.message) {
      this.deps.bubble.show(pet.message, undefined, 'character', { priority: 'care' })
    }

    // 意图 → clip（intentAt 变化才播，同意图可连发）
    if (PET_FEATURES.intentClips && pet.intent && pet.intentAt && pet.intentAt !== prev?.intentAt) {
      const fb = INTENT_FEEDBACK[pet.intent]
      if (fb) {
        const ok = this.deps.animMgr.playClip(fb.clip, {
          loop: fb.loop,
          fade: 0.25,
          restart: true
        })
        if (ok) console.info(`[pet] intent ${pet.intent} → ${fb.clip}`)
      }
    }
  }
}
