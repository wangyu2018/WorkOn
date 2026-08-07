/**
 * 微行为系统（digest §11 的 14 个微行为 Q 版子集 + 行走循环 + 眼/头追踪 + 金铃弹簧）
 * 全部通过 Animator 加性总线叠加，不与姿态混合冲突
 */
import * as THREE from 'three'
import type { VrmCharacter } from '../character/VrmCharacter'
import type { Animator } from './Animator'
import { Spring } from './spring'

export type LocomotionMode = 'walk' | 'run' | null

export class MicroBehaviors {
  private char: VrmCharacter
  private anim: Animator
  private time = 0

  // 眨眼：3-5s 随机，0.15s 闭 + 0.1s 开
  private nextBlink = 2.5
  private blinkT = -1
  // 耳抖动
  private nextEarTwitch = 5
  private earTwitchT = -1
  private earTwitchSide = 1
  // 金铃弹簧
  private bellL = new Spring(60, 5)
  private bellR = new Spring(60, 5)
  // 眼追踪（0.3s ease-out 滞后）
  private gazeTarget = new THREE.Vector2(0, 0)
  private gaze = new THREE.Vector2(0, 0)
  // 偶发微行为计时
  private nextSmile = 20
  private nextDeepBreath = 30
  private nextDistantGaze = 40
  private distantGazeT = -1
  // 挥手（开心/打招呼）
  private waveT = -1
  private waveDur = 1.6
  // 行走循环
  private locomotion: LocomotionMode = null
  private locomotionPhase = 0
  private locomotionRamp = 0 // 0→1 缓入
  private moveSpeedFactor = 1
  // 呼吸幅度（PAD-A 驱动）
  arousal = 0.5
  /** eco 档：呼吸减半、眨眼稀少（30s）、关闭偶发微行为 */
  ecoMode = false

  constructor(char: VrmCharacter, anim: Animator) {
    this.char = char
    this.anim = anim
  }

  /** 鼠标位置（屏幕归一化 -1..1） */
  setGazeTarget(nx: number, ny: number): void {
    this.gazeTarget.set(
      THREE.MathUtils.clamp(nx, -1, 1),
      THREE.MathUtils.clamp(ny, -1, 1)
    )
  }

  setLocomotion(mode: LocomotionMode, speedFactor = 1): void {
    if (mode !== this.locomotion) this.locomotionPhase = 0
    this.locomotion = mode
    this.moveSpeedFactor = speedFactor
    if (mode === null) {
      this.locomotionRamp = Math.max(0, this.locomotionRamp - 0.3)
    }
    this.char.setMoving(mode !== null)
  }

  /** 外部触发耳抖（点击头发反馈） */
  triggerEarTwitch(): void {
    this.earTwitchT = 0
    this.earTwitchSide = Math.random() < 0.5 ? -1 : 1
  }

  /** 摇铃（移动冲击/点击反馈） */
  ringBells(strength = 1): void {
    this.bellL.impulse(2.5 * strength)
    this.bellR.impulse(-2.5 * strength)
  }

  /** 挥一次手（开心/打招呼触发）：右臂举起左右摆，1.6s 自动结束 */
  triggerWave(dur = 1.6): void {
    this.waveT = 0
    this.waveDur = dur
  }

  update(dt: number): void {
    this.time += dt
    const t = this.time
    const add = (b: string, x: number, y = 0, z = 0) => this.anim.add(b, x, y, z)

    // ── 呼吸：spine_02 轻微正弦（频率随 arousal）──
    const breathFreq = 1 / (3.8 - this.arousal * 0.8)
    const breathAmp = (0.9 + this.arousal * 0.6) * (this.ecoMode ? 0.5 : 1)
    add('spine_02', Math.sin(t * Math.PI * 2 * breathFreq) * 1.4 * breathAmp)
    add('spine_03', Math.sin(t * Math.PI * 2 * breathFreq - 0.4) * 0.8 * breathAmp)

    // ── 眨眼 ──
    this.nextBlink -= dt
    if (this.nextBlink <= 0 && this.blinkT < 0) {
      this.blinkT = 0
      this.nextBlink = this.ecoMode ? 25 + Math.random() * 10 : 3 + Math.random() * 2
    }
    if (this.blinkT >= 0) {
      this.blinkT += dt
      const total = 0.25 // 0.15 闭 + 0.1 开
      const p = this.blinkT / total
      const closed = p < 0.6 ? Math.sin((p / 0.6) * Math.PI * 0.5) : Math.cos(((p - 0.6) / 0.4) * Math.PI * 0.5)
      this.char.face.applyBlinkOverride?.(1 - Math.max(0, closed))
      if (p >= 1) this.blinkT = -1
    }

    // ── 耳朵偶发抖动 ──
    if (!this.ecoMode) {
      this.nextEarTwitch -= dt
      if (this.nextEarTwitch <= 0) {
        this.triggerEarTwitch()
        this.nextEarTwitch = 4 + Math.random() * 5
      }
    }
    if (this.earTwitchT >= 0) {
      this.earTwitchT += dt
      const p = this.earTwitchT / 0.4
      if (p >= 1) {
        this.earTwitchT = -1
      } else {
        const wobble = Math.sin(p * Math.PI * 4) * (1 - p) * 8
        add(this.earTwitchSide < 0 ? 'foxEar_L' : 'foxEar_R', 0, 0, wobble)
        if (this.earTwitchT < dt * 2) this.ringBells(0.5)
      }
    }

    // ── 金铃弹簧（随头动） ──
    const bellL = this.bellL.update(dt)
    const bellR = this.bellR.update(dt)
    this.char.bone('bell_L').rotation.z = bellL * 0.12
    this.char.bone('bell_R').rotation.z = bellR * 0.12

    // ── 眼/头追踪鼠标（±15° 水平 / ±10° 垂直，0.3s 滞后） ──
    const k = 1 - Math.exp(-dt / 0.3)
    this.gaze.lerp(this.gazeTarget, k)
    this.char.face.setGaze(this.gaze.x, this.gaze.y)
    add('head', -this.gaze.y * 3.5, this.gaze.x * 6)
    add('neck_01', -this.gaze.y * 2.5, this.gaze.x * 3)

    // ── 挥手（一次性）：右臂从站姿抬到举起 + 小臂慢摆（幅度小、速度慢） ──
    if (this.waveT >= 0) {
      this.waveT += dt
      const p = this.waveT / this.waveDur
      if (p >= 1) {
        this.waveT = -1
      } else {
        const env = Math.sin(p * Math.PI)
        // 挥手路径：先往身前送（y-45）再抬起（z+150），全程在躯干前方，不经过头部；头微向右倾
        add('upperarm_R', 0, -45 * env, 150 * env)
        add('forearm_R', 0, Math.sin(this.waveT * 5.5) * 16 * env, 0)
        add('head', 0, 0, -7 * env)
        this.anim.expressionImpulse({ smile: 0.2 * env }, 0.3)
      }
    }

    // ── 打招呼姿态常驻手摆（stand_greet 保持轻摆，慢速小幅，头微向右倾） ──
    if (this.anim.currentPoseName === 'stand_greet' && this.waveT < 0) {
      add('forearm_R', 0, Math.sin(t * 4) * 10, 0)
      add('head', 0, 0, -5)
    }

    // ── 偶发：微笑加深 / 深呼吸 / 远望 ──
    this.nextSmile -= dt
    if (this.nextSmile <= 0) {
      this.anim.expressionImpulse({ smile: 0.15 }, 0.6)
      this.nextSmile = 15 + Math.random() * 20
    }
    this.nextDeepBreath -= dt
    if (this.nextDeepBreath <= 0) {
      this.anim.expressionImpulse({ smile: 0.05 }, 1.5)
      this.distantGazeT = -1
      this.nextDeepBreath = 25 + Math.random() * 30
    }
    this.nextDistantGaze -= dt
    if (this.nextDistantGaze <= 0) {
      this.distantGazeT = 0
      this.nextDistantGaze = 30 + Math.random() * 40
    }
    if (this.distantGazeT >= 0) {
      this.distantGazeT += dt
      const p = this.distantGazeT / 3
      if (p >= 1) {
        this.distantGazeT = -1
      } else {
        const env = Math.sin(p * Math.PI)
        add('head', -5 * env, 8 * env)
        this.char.face.setGaze(this.gaze.x, this.gaze.y + 0.4 * env)
      }
    }

    // ── 行走/奔跑循环（缓入 ramp 0→1，防止抽搐）──
    if (this.locomotion) {
      this.locomotionRamp = Math.min(1, this.locomotionRamp + dt * 2.5)
      const run = this.locomotion === 'run'
      const freq = (run ? 3.2 : 2.0) * this.moveSpeedFactor
      this.locomotionPhase += dt * freq * Math.PI * 2
      const p = this.locomotionPhase
      const amp = (run ? 38 : 24) * this.locomotionRamp
      const swing = Math.sin(p)
      add('thigh_L', swing * amp)
      add('thigh_R', -swing * amp)
      add('calf_L', Math.max(0, -Math.sin(p)) * amp * 0.8)
      add('calf_R', Math.max(0, Math.sin(p)) * amp * 0.8)
      add('upperarm_L', -swing * amp * 0.5)
      add('upperarm_R', swing * amp * 0.5)
      add('spine_02', run ? 8 : 3, swing * 2)
    } else if (this.locomotionRamp > 0) {
      this.locomotionRamp = Math.max(0, this.locomotionRamp - dt * 4)
    }
  }
}
