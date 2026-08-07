/**
 * 拖拽物理（digest-v3 §9.1 三阶段：Grab / Drag / Release）
 * 抓起 scale×1.05 + 腿下垂 + 惊讶表情 → 拖动跟随 → 松手按速度抛掷
 * 抛物线 + 落地弹跳 1-2 次 + 落地坐姿 1s 后恢复原空间态
 */
import type { VrmCharacter } from '../character/VrmCharacter'
import type { Animator } from '../anim/Animator'
import type { MicroBehaviors } from '../anim/microBehaviors'
import type { SpatialController } from '../spatial/SpatialController'
import { TASKBAR_HEIGHT } from '../spatial/stateTable'

type DragPhase = 'idle' | 'grab' | 'drag' | 'thrown' | 'landed'

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
    this.lastMouse = { x: mouseX, y: mouseY }
    this.lastMouseT = performance.now()
    this.vel = { x: 0, y: 0 }
    this.bounces = 0
    this.baseScale = this.spatial.currentScale
    this.spatial.beginOverride()
    this.spatial.noteInteraction()
    this.anim.setPose('stand_idle', 0.15)
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
    this.phase = 'thrown'
    this.thrownPos = {
      x: this.lastMouse.x + this.grabOffset.x,
      y: this.lastMouse.y + this.grabOffset.y
    }
    // 限制抛出速度
    const maxV = 2500
    this.vel.x = Math.max(-maxV, Math.min(maxV, this.vel.x))
    this.vel.y = Math.max(-maxV, Math.min(maxV, this.vel.y))
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
        // 抓手感：scale ×1.05（仅物理开启时）
        if (this.physicsEnabled) this.spatial.setScale(this.baseScale * 1.05)
        break
      }
      case 'thrown': {
        // 抛物线
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
            this.landedTimer = 1.0
            this.anim.setPose('stand_idle', 0.2)
          }
        }
        this.spatial.setPosition({ ...this.thrownPos })
        break
      }
      case 'landed': {
        this.landedTimer -= dt
        if (this.landedTimer <= 0) {
          this.phase = 'idle'
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
