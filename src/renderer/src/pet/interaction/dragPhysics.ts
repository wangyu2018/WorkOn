/**
 * 拖拽物理（digest-v3 §9.1 三阶段：Grab / Drag / Release）
 * 抓起 scale×1.05 + 腿下垂 + 惊讶表情 → 拖动跟随 → 松手按速度抛掷
 * 抛物线 + 落地弹跳 1-2 次 + 落地坐姿 1s 后恢复原空间态
 */
import * as THREE from 'three'
import { PET_FEATURES } from '../flags'
import type { VrmCharacter } from '../character/VrmCharacter'
import type { Animator } from '../anim/Animator'
import type { MicroBehaviors } from '../anim/microBehaviors'
import type { SpatialController } from '../spatial/SpatialController'
import { TASKBAR_HEIGHT } from '../spatial/stateTable'

type DragPhase = 'idle' | 'grab' | 'drag' | 'thrown' | 'landed'

/** 自动旋转速度（弧度/秒）：约 4 秒一圈 */
const SPIN_SPEED = 1.6

export class DragPhysics {
  private char: VrmCharacter
  private anim: Animator
  private micro: MicroBehaviors
  private spatial: SpatialController
  /** 光标状态统一出口（main.ts 注入 hitTest.setCursorState） */
  onCursor: ((state: 'grab' | 'grabbing') => void) | null = null
  /** 拖拽需要流畅手感：抓起时临时升帧，落地归位后解除 */
  onFpsBoost: (() => void) | null = null
  onFpsUnboost: (() => void) | null = null
  /** 拖拽物理开关（默认关）：关时仅跟手位移，不摆动/不抛物线 */
  physicsEnabled = false
  /** 拖拽落地回调（main.ts 注入：持久化放置位置） */
  onDrop: (() => void) | null = null

  private phase: DragPhase = 'idle'
  private grabOffset = { x: 0, y: 0 }
  private vel = { x: 0, y: 0 }
  private lastMouse = { x: 0, y: 0 }
  private lastMouseT = 0
  private thrownPos = { x: 0, y: 0 }
  private bounces = 0
  private landedTimer = 0
  private baseScale = 1

  constructor(char: VrmCharacter, anim: Animator, micro: MicroBehaviors, spatial: SpatialController) {
    this.char = char
    this.anim = anim
    this.micro = micro
    this.spatial = spatial
  }

  get active(): boolean {
    return this.phase !== 'idle'
  }

  /** mousedown 命中角色时调用（pos = 角色锚点屏幕坐标） */
  grab(mouseX: number, mouseY: number): void {
    const pos = this.spatial.position
    this.phase = 'grab'
    this.grabOffset.x = pos.x - mouseX
    this.grabOffset.y = pos.y - mouseY
    if (this.physicsEnabled && PET_FEATURES.scruffLift) {
      // 后脖颈手感：把角色向上提 60% 身高——光标正落在后脖颈位置，身体垂在下面（真·拎猫）
      this.grabOffset.y += this.char.topY * this.spatial.currentScale * 0.6
      this.anim.setPose('grab_dangle', 0.12)
      this.anim.expressionImpulse({ eyeWide: 0.5, mouthOpen: 0.28, browRaise: 0.25 }, 0.9)
      this.micro.ringBells(0.6)
    }
    this.lastMouse = { x: mouseX, y: mouseY }
    this.lastMouseT = performance.now()
    this.vel = { x: 0, y: 0 }
    this.bounces = 0
    this.baseScale = this.spatial.stateScale // 状态缩放：不含用户缩放，防止 ×userScale 复利
    this.spatial.beginOverride()
    this.spatial.noteInteraction()
    if (!this.physicsEnabled) this.anim.setPose('stand_idle', 0.15) // 物理关：维持原站姿
    this.onCursor?.('grabbing')
    this.onFpsBoost?.()
  }

  move(mouseX: number, mouseY: number): void {
    if (this.phase === 'idle') return
    const now = performance.now()
    const dt = Math.max(1, now - this.lastMouseT) / 1000
    // 速度 EMA
    const vx = (mouseX - this.lastMouse.x) / dt
    const vy = (mouseY - this.lastMouse.y) / dt
    this.vel.x = this.vel.x * 0.6 + vx * 0.4
    this.vel.y = this.vel.y * 0.6 + vy * 0.4
    this.lastMouse = { x: mouseX, y: mouseY }
    this.lastMouseT = now
    if (this.phase === 'grab' || this.phase === 'drag') this.phase = 'drag'
  }

  release(): void {
    if (this.phase === 'idle') return
    if (!this.physicsEnabled) {
      // 物理关闭：直接落点停住（无抛物线/弹跳），保留位置记忆
      this.phase = 'landed'
      this.landedTimer = 0.1
      this.onCursor?.('grab')
      return
    }
    // 松手 = 角度定格 + 卡哇伊反馈（抬腿小跳 + 眯眼笑 + 铃铛），不屁股蹲
    this.phase = 'landed'
    this.landedTimer = 0.5
    this.anim.expressionImpulse({ smile: 0.5, blush: 0.45, squint: 0.3, eyeWide: 0.22, mouthOpen: 0.18 }, 1.3)
    this.micro.ringBells(0.9)
    this.onCursor?.('grab')
  }

  update(dt: number): void {
    const floorY = window.innerHeight - TASKBAR_HEIGHT - 4
    switch (this.phase) {
      case 'grab':
      case 'drag': {
        const tx = this.lastMouse.x + this.grabOffset.x
        const ty = this.lastMouse.y + this.grabOffset.y
        this.spatial.setPosition({ x: tx, y: ty })
        if (this.physicsEnabled) this.spatial.rotateBy(SPIN_SPEED * dt) // 长按展示：自动原地转圈
        if (PET_FEATURES.scruffLift) {
          // 拽脖颈拎猫（暂缓体验）：放大 + 身体随移动晃
          this.spatial.setScale(this.baseScale * 1.05)
          const sway = THREE.MathUtils.clamp(-this.vel.x * 0.00012, -0.16, 0.16)
          this.anim.add('spine_02', 0, 0, sway)
          this.anim.add('thigh_L', 0, 0, THREE.MathUtils.clamp(-this.vel.x * 0.00008, -0.1, 0.1))
          this.anim.add('thigh_R', 0, 0, THREE.MathUtils.clamp(-this.vel.x * 0.00008, -0.1, 0.1))
        }
        break
      }
      case 'thrown': {
        // 抛物线（下落中保持悬垂姿态，由 grab 已设置）
        this.vel.y += 4200 * dt // 屏幕坐标 y 向下为正
        this.thrownPos.x += this.vel.x * dt
        this.thrownPos.y += this.vel.y * dt
        // 侧墙反弹
        if (this.thrownPos.x < 40) {
          this.thrownPos.x = 40
          this.vel.x = Math.abs(this.vel.x) * 0.4
        } else if (this.thrownPos.x > window.innerWidth - 40) {
          this.thrownPos.x = window.innerWidth - 40
          this.vel.x = -Math.abs(this.vel.x) * 0.4
        }
        // 落地弹跳（1-2 次）
        if (this.thrownPos.y >= floorY) {
          this.thrownPos.y = floorY
          if (Math.abs(this.vel.y) > 260 && this.bounces < 2) {
            this.vel.y = -this.vel.y * 0.42
            this.vel.x *= 0.6
            this.bounces++
          } else {
            this.phase = 'landed'
            this.landedTimer = 0.9
            // 屁股蹲：坐地缓冲（眯眼 + 微张嘴），带一点下坠顿挫
            this.anim.setPose('land_butt', 0.06)
            this.anim.expressionImpulse({ squint: 0.4, mouthOpen: 0.2 }, 0.6)
            this.micro.ringBells(1.2)
          }
        }
        this.spatial.setPosition({ ...this.thrownPos })
        break
      }
      case 'landed': {
        this.landedTimer -= dt
        if (this.landedTimer <= 0) {
          this.phase = 'idle'
          // 展示结束：恢复原尺寸 + 回站立姿态（保持用户选定的朝向不变）
          this.spatial.setScale(this.baseScale)
          this.anim.setPose('stand_idle', 0.3)
          // 拖拽放定后不回弹：停在落点（闲置超时由 SpatialController 自动回位）
          this.spatial.endOverride()
          this.spatial.noteInteraction()
          this.onCursor?.('grab')
          this.onFpsUnboost?.()
          this.onDrop?.()
        }
        break
      }
      case 'idle':
        break
    }
  }
}
