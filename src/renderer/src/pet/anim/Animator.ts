/**
 * Animator：姿态混合 + 表情混合 + 加性修正总线
 * - 姿态：PoseEntry 骨骼欧拉角（度）双向 lerp，默认回落 DEFAULT_POSE
 * - 加性总线：微行为/行走循环/拖拽/点击反馈每帧写入角度偏移，统一叠加
 */
import * as THREE from 'three'
import type { VrmCharacter } from '../character/VrmCharacter'
import { DEFAULT_POSE, POSES, type PoseEntry } from '../character/poses'
import {
  NEUTRAL_EXPRESSION,
  cloneExpression,
  lerpExpression,
  type Expression
} from '../character/expression'
import { DEFAULT_HIPS_Y } from '../character/VrmCharacter'

const D2R = THREE.MathUtils.degToRad

/** 参与混合的骨骼（身体链） */
const BLEND_BONES = [
  'body',
  'hips',
  'spine_01',
  'spine_02',
  'spine_03',
  'neck_01',
  'head',
  'shoulder_L',
  'shoulder_R',
  'upperarm_L',
  'upperarm_R',
  'forearm_L',
  'forearm_R',
  'hand_L',
  'hand_R',
  'thigh_L',
  'thigh_R',
  'calf_L',
  'calf_R',
  'foot_L',
  'foot_R',
  'foxEar_L',
  'foxEar_R'
] as const

type BoneName = (typeof BLEND_BONES)[number]

interface ExprImpulse {
  delta: Partial<Expression>
  t: number
  dur: number
}

export class Animator {
  private char: VrmCharacter
  private fromPose: PoseEntry = DEFAULT_POSE
  private toPose: PoseEntry = DEFAULT_POSE
  private poseT = 1
  private poseDur = 0.4
  private hipsFrom = DEFAULT_HIPS_Y
  private hipsTo = DEFAULT_HIPS_Y

  private fromExpr: Expression = cloneExpression(NEUTRAL_EXPRESSION)
  private toExpr: Expression = cloneExpression(NEUTRAL_EXPRESSION)
  private exprT = 1
  private exprDur = 0.5
  private exprImpulses: ExprImpulse[] = []

  private additive = new Map<string, THREE.Vector3>()
  currentPoseName = 'stand_idle'
  /** 表情反馈总开关（互动开关：关闭后表情脉冲/状态表情不再注入，姿态自带表情除外） */
  emotionEnabled = true

  constructor(char: VrmCharacter) {
    this.char = char
  }

  /** 切换姿态（0.3-0.5s 混合） */
  setPose(name: string, duration = 0.4): void {
    const pose = POSES[name]
    if (!pose) return
    if (this.currentPoseName !== name) console.info(`[anim] setPose ${this.currentPoseName} → ${name} (${duration.toFixed(2)}s)`)
    this.fromPose = this.snapshotCurrentPose()
    this.toPose = pose
    this.poseT = 0
    this.poseDur = Math.max(0.05, duration)
    this.hipsFrom = this.currentHipsY()
    this.hipsTo = pose.hipsY ?? DEFAULT_HIPS_Y
    this.currentPoseName = name
    // 姿态自带表情则合并覆盖；不带表情的姿态回落中性表情
    // （否则困倦/睡眠姿态的闭眼表情会在切回 stand_idle 后残留，眼睛一直睁不开）
    const merged = { ...cloneExpression(NEUTRAL_EXPRESSION), ...pose.expression }
    this.setPoseExpression(merged, Math.min(0.5, duration + 0.1))
  }

  setExpression(e: Expression, duration = 0.5): void {
    if (!this.emotionEnabled) return
    this.fromExpr = lerpExpression(this.fromExpr, this.toExpr, this.ease(this.exprT))
    this.toExpr = cloneExpression(e)
    this.exprT = 0
    this.exprDur = Math.max(0.05, duration)
  }

  /** 姿态自带表情（不受表情反馈开关影响） */
  private setPoseExpression(e: Expression, duration: number): void {
    const saved = this.emotionEnabled
    this.emotionEnabled = true
    this.setExpression(e, duration)
    this.emotionEnabled = saved
  }

  /** 表情感冲（点击反馈等）：delta 在 dur 内以 sin 包络叠加后自动消退 */
  expressionImpulse(delta: Partial<Expression>, dur = 0.8): void {
    if (!this.emotionEnabled) return
    this.exprImpulses.push({ delta, t: 0, dur })
  }

  /** 加性角度偏移（度），每帧由微行为/行走/拖拽写入 */
  add(bone: string, x: number, y = 0, z = 0): void {
    let v = this.additive.get(bone)
    if (!v) {
      v = new THREE.Vector3()
      this.additive.set(bone, v)
    }
    v.x += x
    v.y += y
    v.z += z
  }

  private poseValue(pose: PoseEntry, bone: BoneName): THREE.Vector3 {
    const e = pose.bones[bone] ?? DEFAULT_POSE.bones[bone] ?? [0, 0, 0]
    return new THREE.Vector3(e[0], e[1], e[2])
  }

  private snapshotCurrentPose(): PoseEntry {
    const bones: Record<string, [number, number, number]> = {}
    const t = this.ease(this.poseT)
    for (const b of BLEND_BONES) {
      const a = this.poseValue(this.fromPose, b)
      const c = this.poseValue(this.toPose, b)
      bones[b] = [a.x + (c.x - a.x) * t, a.y + (c.y - a.y) * t, a.z + (c.z - a.z) * t]
    }
    return { bones, hipsY: this.currentHipsY() }
  }

  private currentHipsY(): number {
    return this.hipsFrom + (this.hipsTo - this.hipsFrom) * this.ease(this.poseT)
  }

  private ease(t: number): number {
    const x = THREE.MathUtils.clamp(t, 0, 1)
    return x < 0.5 ? 2 * x * x : -1 + (4 - 2 * x) * x
  }

  update(dt: number): void {
    // 混合已收敛且本帧无加性偏移 → 直接写目标姿态，跳过 lerp 重算（闲置减负）
    const poseDone = this.poseT >= 1
    const noAdditive = this.additive.size === 0
    this.poseT += dt / this.poseDur
    this.exprT += dt / this.exprDur
    const pt = this.ease(this.poseT)

    // 姿态混合 + 加性叠加
    for (const b of BLEND_BONES) {
      const node = this.char.bone(b)
      if (poseDone && noAdditive) {
        const c = this.poseValue(this.toPose, b)
        node.rotation.set(D2R(c.x), D2R(c.y), D2R(c.z))
        continue
      }
      const a = this.poseValue(this.fromPose, b)
      const c = this.poseValue(this.toPose, b)
      const add = this.additive.get(b)
      const x = a.x + (c.x - a.x) * pt + (add?.x ?? 0)
      const y = a.y + (c.y - a.y) * pt + (add?.y ?? 0)
      const z = a.z + (c.z - a.z) * pt + (add?.z ?? 0)
      node.rotation.set(D2R(x), D2R(y), D2R(z))
    }
    this.char.bone('hips').position.y = this.currentHipsY()
    this.additive.clear()

    // 表情混合 + 脉冲
    const et = this.ease(this.exprT)
    const expr = lerpExpression(this.fromExpr, this.toExpr, et)
    this.exprImpulses = this.exprImpulses.filter((imp) => {
      imp.t += dt
      if (imp.t >= imp.dur) return false
      const env = Math.sin((imp.t / imp.dur) * Math.PI)
      for (const [k, v] of Object.entries(imp.delta)) {
        const key = k as keyof Expression
        expr[key] = THREE.MathUtils.clamp(expr[key] + (v ?? 0) * env, -1, 1.5)
      }
      return true
    })
    this.char.face.apply(expr)
  }
}
