/**
 * CharacterSpatialController（digest-v4 §16 骨架实现）
 * 职责：状态表查表 → 解析屏幕位置 → 过渡动画 → 姿态 → Z 层/透明度 → 自由游荡
 */
import * as THREE from 'three'
import type { VrmCharacter } from '../character/VrmCharacter'
import type { Animator } from '../anim/Animator'
import type { MicroBehaviors } from '../anim/microBehaviors'
import { RoamFSM } from '../anim/fsm'
import {
  SPATIAL_STATE_TABLE,
  Z_LAYER_RENDER,
  TASKBAR_HEIGHT,
  type SpatialStateConfig,
  type SpatialStateName
} from './stateTable'
import { Transition, type Vec2 } from './transitions'

export type ControlOwner = 'spatial' | 'drag'

export class SpatialController {
  private char: VrmCharacter
  private anim: Animator
  private micro: MicroBehaviors
  private roam = new RoamFSM()

  current: SpatialStateName = 'working'
  private transition: Transition | null = null
  /** 过渡动画期间临时升帧（回调注入，结束解除） */
  onFpsBoost: (() => void) | null = null
  onFpsUnboost: (() => void) | null = null
  private transitionBoosted = false
  private pos: Vec2
  private scale = 0.9
  private userScale = 1 // 用户自定义缩放（0.5-1.5，桌搭/设置调节）
  /** 允许自由游荡（设置 petRoam 驱动，默认关） */
  private roamEnabled = false
  private facing = 1 // 1 右 -1 左
  private facingCur = 0 // 朝向角（弧度，负=朝屏幕左）

  // Z 层切换：opacity 先降 0.3 再升目标 0.4s（§14）
  private opacity = 1
  private opacityTarget = 1
  private opacityDip = -1

  private screenW = 1920
  private screenH = 1080
  private mouse: Vec2 = { x: -9999, y: -9999 }
  /** 前台窗口矩形（漫游避让，presence 快照驱动；null=不避让） */
  private avoidRect: { x: number; y: number; width: number; height: number } | null = null
  private owner: ControlOwner = 'spatial'
  private bobPhase = 0
  /** 最近一次交互（拖拽/点击）时间；闲置超时自动回位 */
  private lastInteract = performance.now()
  /** 页面切换抑制（ms）：>0 期间 transitionTo 延迟到归零后执行最后一个 */
  private suppressTimer = 0
  private pendingState: { name: SpatialStateName; pose?: string } | null = null
  /** P1 过渡冷却：上次完整过渡开始时间，冷却期内新状态只切姿态 */
  private lastFullTransition = 0
  private static TRANSITION_COOLDOWN = 3000
  /** P2 页面切换缩放锁定：锁定期间只改位置/姿态，不改 scale */
  private scaleLocked = false
  private scaleLockTimer = 0
  /** P3 交互锁定（气泡可见/拖拽刚结束）：期间不触发闲置回位 */
  private interactionLockTimer = 0
  /** P3 用户拖拽放置位置（10min 内闲置不弹回） */
  private userPlacedPos: { pos: Vec2; at: number } | null = null
  private static USER_PLACE_EXPIRE = 10 * 60 * 1000
  /** 闲置自动归位分钟数（默认 30，桌搭设置可配） */
  private returnMin = 30
  /** 手动收纳锁：用户点"回到收纳栏"后永久抑制自动状态切换，直到右键"唤出" */
  private _docked = false

  get docked(): boolean {
    return this._docked
  }

  /** 收纳：锁定角色位置，不再响应自动状态切换 */
  dock(): void {
    this._docked = true
    this.restore()
  }

  /** 唤出：解除收纳锁，恢复自动跟随 */
  undock(): void {
    this._docked = false
  }

  constructor(char: VrmCharacter, anim: Animator, micro: MicroBehaviors) {
    this.char = char
    this.anim = anim
    this.micro = micro
    this.screenW = window.innerWidth
    this.screenH = window.innerHeight
    this.pos = { x: this.screenW * 0.85, y: this.screenH - TASKBAR_HEIGHT }
    this.applyTransform(0)
  }

  setScreenSize(w: number, h: number): void {
    this.screenW = w
    this.screenH = h
    this.pos.x = THREE.MathUtils.clamp(this.pos.x, 0, w)
    this.pos.y = THREE.MathUtils.clamp(this.pos.y, 0, h + 200)
  }

  setMouse(px: number, py: number): void {
    this.mouse.x = px
    this.mouse.y = py
  }

  /** 设置漫游避让区（前台窗口矩形，presence 快照驱动） */
  setAvoidRect(rect: { x: number; y: number; width: number; height: number } | null): void {
    this.avoidRect = rect
  }

  get position(): Vec2 {
    return { ...this.pos }
  }

  /** 视觉总缩放（状态缩放 × 用户缩放）——气泡锚点/偏移用 */
  get currentScale(): number {
    return this.scale * this.userScale
  }

  /** 状态缩放（不含用户缩放）——粒子密度等不想被用户缩放放大的场景用 */
  get stateScale(): number {
    return this.scale
  }

  get cfg(): SpatialStateConfig {
    return SPATIAL_STATE_TABLE[this.current]
  }

  /** 过渡动画进行中（主循环 busy 判定用） */
  get transitionActive(): boolean {
    return this.transition !== null
  }

  /** 游荡移动中（主循环 busy 判定 + 升帧用）：行走时低帧率会像幻灯片 */
  get roamMoving(): boolean {
    return this.roamEnabled && this.cfg.roam === true && this.roam.state === 'move'
  }

  private boostTransition(): void {
    if (this.transitionBoosted) return
    this.transitionBoosted = true
    this.onFpsBoost?.()
  }

  private unboostTransition(): void {
    if (!this.transitionBoosted) return
    this.transitionBoosted = false
    this.onFpsUnboost?.()
  }

  /** 拖拽期间接管 root 控制权 */
  beginOverride(): void {
    this.owner = 'drag'
    this.micro.setLocomotion(null)
  }

  endOverride(): void {
    this.owner = 'spatial'
    // P3 拖拽放定：记住用户放置位置（10min 内闲置不弹回）
    this.userPlacedPos = { pos: { ...this.pos }, at: performance.now() }
    this.interactionLockTimer = SpatialController.USER_PLACE_EXPIRE
  }

  setPosition(pos: Vec2): void {
    this.pos = { ...pos }
  }

  /** 记录一次用户交互（拖拽/点击），重置闲置回位计时 */
  noteInteraction(): void {
    this.lastInteract = performance.now()
  }

  /** 主窗口页面切换：抑制状态切换 ms 毫秒（期间只记最后一个目标）+ 缩放锁定 */
  notePageSwitch(ms: number): void {
    if (this._docked) return
    this.suppressTimer = ms
    this.scaleLocked = true
    this.scaleLockTimer = ms + 1000 // 比抑制期多 1s，确保过渡完成前 scale 不变
  }

  /** 气泡可见：交互锁定 10min（用户在「看」角色说话，不触发闲置弹回） */
  noteBubbleVisible(): void {
    this.interactionLockTimer = SpatialController.USER_PLACE_EXPIRE
  }

  /** 气泡消失：留 5s 缓冲再解锁 */
  noteBubbleGone(): void {
    this.interactionLockTimer = Math.min(Math.max(this.interactionLockTimer, 5000), 5000)
  }

  setScale(s: number): void {
    this.scale = s
  }

  /** 用户自定义缩放（叠在状态缩放之上） */
  setUserScale(s: number): void {
    this.userScale = THREE.MathUtils.clamp(s, 0.5, 1.5)
  }

  /** 开关自由游荡（设置 petRoam 驱动） */
  setRoamEnabled(v: boolean): void {
    this.roamEnabled = v
    if (!v) this.micro.setLocomotion(null)
  }

  /** 闲置自动归位分钟数（桌搭设置可配） */
  setReturnMin(min: number): void {
    this.returnMin = Math.max(1, min)
  }

  /** 启动恢复拖拽位置：标记为用户放置（保留期内不被状态切换搬走） */
  markUserPlaced(pos: Vec2): void {
    this.pos = { ...pos }
    this.userPlacedPos = { pos: { ...pos }, at: performance.now() }
    this.applyTransform(0)
  }

  /** 状态切换主入口（§16 transitionTo + 底部粘性 + 过渡冲突 + 冷却期 + 缩放锁） */
  transitionTo(name: SpatialStateName, poseOverride?: string, fromPending = false): void {
    // 收纳锁：dock/undock 通过 restore/dock/undock 直接操作，不走这条路径
    if (this._docked && !fromPending) return
    if (name === this.current && !poseOverride) {
      // 自愈：状态未变但姿态被残留覆盖（如闭眼姿态卡住不恢复）时，重新应用本状态姿态
      const cfgNow = SPATIAL_STATE_TABLE[name]
      if (cfgNow && this.anim.currentPoseName !== cfgNow.poseName) {
        this.anim.setPose(cfgNow.poseName, 0.4)
      }
      return
    }
    // 页面切换抑制中：只记最后一个目标，归零后批量执行
    if (this.suppressTimer > 0) {
      this.pendingState = { name, pose: poseOverride }
      return
    }
    const cfg = SPATIAL_STATE_TABLE[name]
    const prevCfg = this.cfg

    // 用户拖拽放置保留期（10min）内：非紧急状态切换只换姿态，不搬位置（防"切屏就弹回"）
    if (
      !cfg.urgent &&
      this.userPlacedPos &&
      performance.now() - this.userPlacedPos.at < SpatialController.USER_PLACE_EXPIRE
    ) {
      this.current = name
      this.roam.reset(12)
      this.anim.setPose(poseOverride ?? cfg.poseName, 0.4)
      return
    }

    // P1 过渡冷却：上次完整过渡开始不到 3s，新状态只切姿态（记入 pending 稍后执行）
    if (!cfg.urgent && !fromPending && performance.now() - this.lastFullTransition < SpatialController.TRANSITION_COOLDOWN) {
      this.pendingState = { name, pose: poseOverride }
      this.anim.setPose(poseOverride ?? cfg.poseName, 0.4)
      return
    }

    // 过渡冲突：当前过渡未完成（<60%）时
    if (this.transition && this.transition.progress < 0.6 && !cfg.urgent) {
      const target = this.resolvePosition(cfg)
      const sameLayer = Z_LAYER_RENDER[cfg.zLayer] === Z_LAYER_RENDER[prevCfg.zLayer]
      const dist = Math.hypot(target.x - this.pos.x, target.y - this.pos.y)
      if (sameLayer && dist < 100) {
        // 同层且位置差异小：取消新过渡，只切姿态，避免半途抖动
        this.current = name
        this.roam.reset(12)
        this.anim.setPose(poseOverride ?? cfg.poseName, 0.4)
        return
      }
      // 否则：快速收尾当前过渡再开新过渡
      this.transition.fastForward(0.8)
    }

    const target = this.resolvePosition(cfg)

    // 紧急状态立即打断当前过渡
    if (cfg.urgent) this.transition = null

    // 底部粘性：bottom 类互切只做 0.35s 快速短滑（不换过渡类型、不走完整流程）
    const bottomClass = (c: SpatialStateConfig) => c.defaultPos.y === 'bottom' || c.defaultPos.y === 'peek'
    const sticky = bottomClass(cfg) && bottomClass(prevCfg)

    // P2 缩放锁：锁定期间不改 scale（保持当前），其余照常过渡
    const toScale = this.scaleLocked && !cfg.urgent ? this.scale : cfg.scale

    const dur = sticky ? 0.35 : THREE.MathUtils.clamp(cfg.entryDuration, 0.5, 2.0)
    this.transition = new Transition({
      kind: sticky ? 'A' : cfg.transition,
      from: { ...this.pos },
      to: target,
      fromScale: this.scale,
      toScale,
      duration: this.transition ? dur : Math.min(dur, cfg.urgent ? 0.8 : dur),
      screenH: this.screenH
    })
    this.lastFullTransition = performance.now()
    this.boostTransition()

    // Z 层：opacity 先降再升
    if (Z_LAYER_RENDER[cfg.zLayer] !== Z_LAYER_RENDER[prevCfg.zLayer] || name !== this.current) {
      this.opacityDip = 0
      this.opacityTarget = Z_LAYER_RENDER[cfg.zLayer].opacity * cfg.transparency
    }

    this.current = name
    this.roam.reset(12)

    // 姿态在过渡中段开始混合（放缓：0.5-0.9s，动作更从容）
    const pose = poseOverride ?? cfg.poseName
    this.anim.setPose(pose, THREE.MathUtils.clamp(dur * 0.5, 0.5, 0.9))

    const render = Z_LAYER_RENDER[cfg.zLayer]
    this.char.setRenderOrder(render.renderOrder)
  }

  /** 恢复当前状态（一键回位/闲置超时）：回到状态锚点并清除放置记忆 */
  restore(): void {
    this.userPlacedPos = null
    const cfg = this.cfg
    const target = this.resolvePosition(cfg)
    this.lastFullTransition = performance.now()
    this.transition = new Transition({
      kind: 'A',
      from: { ...this.pos },
      to: target,
      fromScale: this.scale,
      toScale: cfg.scale,
      duration: 0.8,
      screenH: this.screenH
    })
    this.boostTransition()
    this.anim.setPose(cfg.poseName, 0.4)
  }

  private resolvePosition(cfg: SpatialStateConfig): Vec2 {
    const sw = this.screenW
    const sh = this.screenH
    const x = sw * cfg.defaultPos.x
    let y: number
    if (cfg.defaultPos.y === 'bottom') {
      y = sh - TASKBAR_HEIGHT - 6
    } else if (cfg.defaultPos.y === 'peek') {
      // §11.1：脚底锚点在屏幕下，身体 70% 在屏下，露头（scale 已调大保证可见）
      y = sh + this.char.height * cfg.scale * 0.55
    } else {
      y = sh * (cfg.defaultPos.y as number)
    }
    // 软边界：中心距边缘 ≥100px（peek 态除外）
    if (cfg.defaultPos.y !== 'peek') {
      return { x: THREE.MathUtils.clamp(x, 60, sw - 60), y }
    }
    return { x: THREE.MathUtils.clamp(x, 60, sw - 60), y }
  }

  update(dt: number): void {
    // 页面切换抑制倒计时：归零后执行缓存的最后一个状态切换
    if (this.suppressTimer > 0) {
      this.suppressTimer -= dt * 1000
      if (this.suppressTimer <= 0 && this.pendingState) {
        const p = this.pendingState
        this.pendingState = null
        this.transitionTo(p.name, p.pose, true)
      }
    }

    // P2 缩放锁倒计时：解锁后如有未应用的缩放目标，0.5s 平滑补过
    if (this.scaleLockTimer > 0) {
      this.scaleLockTimer -= dt * 1000
      if (this.scaleLockTimer <= 0) {
        this.scaleLocked = false
        const targetScale = this.cfg.scale
        if (Math.abs(targetScale - this.scale) > 0.01 && !this.transition) {
          this.transition = new Transition({
            kind: 'A',
            from: { ...this.pos },
            to: { ...this.pos },
            fromScale: this.scale,
            toScale: targetScale,
            duration: 0.5,
            screenH: this.screenH
          })
          this.lastFullTransition = performance.now()
          this.boostTransition()
        }
      }
    }

    // P3 交互锁倒计时（气泡可见/拖拽刚结束期间不触发闲置回位）
    if (this.interactionLockTimer > 0) this.interactionLockTimer -= dt * 1000

    // P1 冷却期结束后执行冷却期间缓存的状态切换
    if (
      this.pendingState &&
      this.suppressTimer <= 0 &&
      !this.transition &&
      performance.now() - this.lastFullTransition >= SpatialController.TRANSITION_COOLDOWN
    ) {
      const p = this.pendingState
      this.pendingState = null
      this.transitionTo(p.name, p.pose, true)
    }

    // ── Z 层 opacity 动画：0.2s 降到 0.3，0.4s 升回目标 ──
    if (this.opacityDip >= 0) {
      this.opacityDip += dt
      if (this.opacityDip < 0.2) {
        this.opacity = THREE.MathUtils.lerp(this.opacity, 0.3, this.opacityDip / 0.2)
      } else if (this.opacityDip < 0.6) {
        this.opacity = THREE.MathUtils.lerp(0.3, this.opacityTarget, (this.opacityDip - 0.2) / 0.4)
      } else {
        this.opacity = this.opacityTarget
        this.opacityDip = -1
      }
      this.char.setGlobalOpacity(this.opacity)
    }

    if (this.owner !== 'spatial') {
      this.applyTransform(dt)
      return
    }

    // ── 过渡动画（静默位移：不走动，仅改位置/缩放）──
    if (this.transition) {
      const frame = this.transition.update(dt)
      this.pos = { ...frame.pos }
      this.scale = frame.scale
      if (frame.opacity < 1) this.char.setGlobalOpacity(this.opacity * frame.opacity)
      if (Math.abs(frame.vx) > 20) this.facing = frame.vx > 0 ? 1 : -1
      if (this.transition.finished) {
        this.transition = null
        this.micro.setLocomotion(null)
        this.char.setGlobalOpacity(this.opacity)
        this.unboostTransition()
      }
      this.applyTransform(dt)
      return
    }

    // ── 闲置回位：交互锁（气泡可见/刚拖拽）不触发；用户放置位置 10min 内不弹回 ──
    if (this._docked) {
      // 收纳中：不触发任何自动操作
    } else if (performance.now() - this.lastInteract > this.returnMin * 60_000) {
      this.lastInteract = performance.now()
      if (this.interactionLockTimer > 0) {
        // 交互锁生效中：什么都不做
      } else if (
        this.userPlacedPos &&
        performance.now() - this.userPlacedPos.at < SpatialController.USER_PLACE_EXPIRE
      ) {
        // 用户放置位置未过期：停在原地
      } else {
        const target = this.resolvePosition(this.cfg)
        if (Math.hypot(this.pos.x - target.x, this.pos.y - target.y) > 60) {
          this.restore()
        }
      }
    }

    // ── 自由游荡（working/idle 且 roam 开启 + 设置允许） ──
    if (this.cfg.roam && this.roamEnabled && !this._docked) {
      const upd = this.roam.update(
        dt,
        this.pos,
        {
          minX: 100,
          maxX: this.screenW - 100,
          minY: this.screenH * 0.55,
          maxY: this.screenH - TASKBAR_HEIGHT - 6
        },
        this.mouse,
        this.avoidRect
      )
      if (upd.moving && this.roam.target) {
        const dx = this.roam.target.x - this.pos.x
        const dy = this.roam.target.y - this.pos.y
        const dist = Math.hypot(dx, dy)
        if (dist > 1) {
          this.pos.x += (dx / dist) * upd.speed * dt
          this.pos.y += (dy / dist) * upd.speed * dt
          this.facing = dx > 0 ? 1 : -1
          this.bobPhase += dt * (upd.mode === 'run' ? 14 : 9)
        }
        this.micro.setLocomotion(upd.mode, upd.mode === 'run' ? 1.2 : 1)
      } else {
        this.micro.setLocomotion(null)
        this.bobPhase = 0
        // 到达后回当前状态姿态（仅站姿，无需变体切换）
        if (this.roam.state !== 'move' && this.anim.currentPoseName !== this.cfg.poseName) {
          this.anim.setPose(this.cfg.poseName, 0.4)
        }
      }
    }

    this.applyTransform(dt)
  }

  /** 把屏幕坐标/缩放写入 three 场景（世界坐标 = 屏幕像素，锚点脚底） */
  private applyTransform(dt: number): void {
    const wx = this.pos.x - this.screenW / 2
    const wy = this.screenH / 2 - this.pos.y
    // 行走上下起伏
    const bob = this.micro && Math.abs(this.bobPhase) > 0 ? Math.abs(Math.sin(this.bobPhase)) * 6 : 0
    this.char.root.position.set(wx, wy + bob, 0)
    this.char.root.scale.setScalar(this.scale * this.userScale)

    // 朝向：位置驱动（面向屏幕中段视觉中心）；拖拽中暂按速度朝向，松手回正
    // rotation.y 负 = 面朝屏幕左，正 = 面朝屏幕右
    const ratio = this.pos.x / this.screenW
    let target: number
    if (this.owner === 'drag') {
      target = this.facing * -0.85 // 拖拽中保持速度朝向
    } else {
      target = ratio < 0.33 ? 0.6 : ratio > 0.66 ? -0.6 : 0
      // 底部停靠（贴任务栏/冒头）：幅度减半，避免侧脸过于明显
      if (this.pos.y > this.screenH - 150) target *= 0.5
    }
    const k = dt > 0 ? 1 - Math.exp(-dt / 0.8) : 1 // ~0.8s 平滑到位（更慢更沉稳）
    this.facingCur += (target - this.facingCur) * k
    this.char.root.rotation.y = this.facingCur
  }
}
