/**
 * 5 种过渡动画（digest-v4 §12）：A 行走 / B 缩放 / C 钻入钻出 / D 漂浮 / E 奔跑
 * 切换时长 0.5-2s，由 SpatialController 每帧驱动 update()
 */
import * as THREE from 'three'
import type { TransitionKind } from './stateTable'

export interface Vec2 {
  x: number
  y: number
}

export interface TransitionSpec {
  kind: TransitionKind
  from: Vec2
  to: Vec2
  fromScale: number
  toScale: number
  duration: number
  screenH: number
}

export interface TransitionFrame {
  pos: Vec2
  scale: number
  /** 移动水平速度（用于朝向/行走循环），px/s */
  vx: number
  /** 该过渡的 locomotion 模式 */
  mode: 'walk' | 'run' | 'float' | null
  opacity: number
}

function easeInOut(t: number): number {
  return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t
}

function easeOutBack(t: number): number {
  const c1 = 1.70158
  const c3 = c1 + 1
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2)
}

export class Transition {
  private spec: TransitionSpec
  private t = 0
  private prevPos: Vec2
  finished = false

  constructor(spec: TransitionSpec) {
    this.spec = spec
    this.prevPos = { ...spec.from }
  }

  /** 进度 0-1（冲突检测用） */
  get progress(): number {
    return this.spec.duration <= 0 ? 1 : this.t / this.spec.duration
  }

  /** 快进到 p（打断当前过渡时先收尾再开新过渡） */
  fastForward(p = 0.8): void {
    this.t = Math.max(this.t, this.spec.duration * p)
  }

  /** 返回当前帧数据；完成后 finished=true */
  update(dt: number): TransitionFrame {
    const s = this.spec
    this.t = Math.min(this.t + dt, s.duration)
    const raw = s.duration <= 0 ? 1 : this.t / s.duration
    const e = easeInOut(raw)
    const frame: TransitionFrame = {
      pos: { x: 0, y: 0 },
      scale: s.fromScale,
      vx: 0,
      mode: null,
      opacity: 1
    }

    switch (s.kind) {
      case 'A': // 行走：二次贝塞尔微弧线
      case 'E': {
        // 奔跑
        const midX = (s.from.x + s.to.x) / 2
        const midY = Math.min(s.from.y, s.to.y) - Math.abs(s.to.x - s.from.x) * 0.06 - 20
        const u = 1 - e
        frame.pos.x = u * u * s.from.x + 2 * u * e * midX + e * e * s.to.x
        frame.pos.y = u * u * s.from.y + 2 * u * e * midY + e * e * s.to.y
        frame.scale = THREE.MathUtils.lerp(s.fromScale, s.toScale, e)
        frame.mode = s.kind === 'E' ? 'run' : 'walk'
        break
      }
      case 'B': {
        // 缩放：位置插值 + ease-out-back 缩放
        frame.pos.x = THREE.MathUtils.lerp(s.from.x, s.to.x, e)
        frame.pos.y = THREE.MathUtils.lerp(s.from.y, s.to.y, e)
        frame.scale = THREE.MathUtils.lerp(s.fromScale, s.toScale, easeOutBack(raw))
        frame.mode = Math.abs(s.to.x - s.from.x) > 50 ? 'walk' : null
        break
      }
      case 'C': {
        // 钻入/钻出：先沉到屏幕底边之下，再横向移动，最后升起
        const below = s.screenH + 140
        if (raw < 0.3) {
          const p = easeInOut(raw / 0.3)
          frame.pos.x = s.from.x
          frame.pos.y = THREE.MathUtils.lerp(s.from.y, below, p)
          frame.opacity = 1 - p * 0.5
          frame.scale = THREE.MathUtils.lerp(s.fromScale, Math.min(s.fromScale, s.toScale) * 0.8, p)
        } else if (raw < 0.7) {
          const p = (raw - 0.3) / 0.4
          frame.pos.x = THREE.MathUtils.lerp(s.from.x, s.to.x, p)
          frame.pos.y = below
          frame.opacity = 0.5
          frame.scale = Math.min(s.fromScale, s.toScale) * 0.8
          frame.mode = 'walk'
        } else {
          const p = easeInOut((raw - 0.7) / 0.3)
          frame.pos.x = s.to.x
          frame.pos.y = THREE.MathUtils.lerp(below, s.to.y, p)
          frame.opacity = 0.5 + p * 0.5
          frame.scale = THREE.MathUtils.lerp(Math.min(s.fromScale, s.toScale) * 0.8, s.toScale, p)
        }
        break
      }
      case 'D': {
        // 漂浮：缓慢 + 正弦浮动
        frame.pos.x = THREE.MathUtils.lerp(s.from.x, s.to.x, e)
        frame.pos.y = THREE.MathUtils.lerp(s.from.y, s.to.y, e) + Math.sin(raw * Math.PI * 3) * 14
        frame.scale = THREE.MathUtils.lerp(s.fromScale, s.toScale, e)
        frame.mode = 'float'
        break
      }
    }

    if (dt > 0) frame.vx = (frame.pos.x - this.prevPos.x) / dt
    this.prevPos = { ...frame.pos }
    if (raw >= 1) {
      this.finished = true
      frame.pos = { ...s.to }
      frame.scale = s.toScale
      frame.mode = null
      frame.opacity = 1
    }
    return frame
  }
}
