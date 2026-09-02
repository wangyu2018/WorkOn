/**
 * AnimationManager：动画层重构核心（v5.0）
 * - 统一播放层：VRMA 文件（@pixiv/three-vrm-animation）与程序化 VRMAnimation 共走
 *   createVRMAnimationClip → AnimationMixer，可 crossFade
 * - 程序化 clip 关键帧直接采样自 poses.ts 美术角度（欧拉→四元数），避免 T-pose 轴向偏差
 * - clip 激活期间置 Animator.clipMode：姿态/加性骨骼写入挂起，表情/眨眼/视线不受影响
 * - 空间态 → clip 映射：有映射用 crossFade，无映射回落旧 setPose
 *
 * 稳定性（审计修复）：
 *   - stop() 的延迟 action.stop 与快速重播竞态 → pendingStop 可取消 + fade 期间保活 mixer
 *   - 一次性 clip 结束 → 自动回空间态 clip；clampWhenFinished 跟随 loop
 *   - VRM0 四元数 x/z 预翻转，抵消库内对旧模型的坐标约定转换
 */
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import {
  VRMAnimationLoaderPlugin,
  VRMAnimation,
  createVRMAnimationClip
} from '@pixiv/three-vrm-animation'
import type { VRMHumanBoneName } from '@pixiv/three-vrm-core'
import type { VrmCharacter } from '../character/VrmCharacter'
import type { Animator } from './Animator'
import { POSES, DEFAULT_POSE, type PoseEntry } from '../character/poses'
import { SPATIAL_STATE_TABLE, type SpatialStateName } from '../spatial/stateTable'
import type { MotionClipData } from '@shared/types'

const D2R = THREE.MathUtils.degToRad

/** 旧骨骼名（poses 键）→ VRM humanoid 骨名（与 VrmCharacter.BONE_ALIAS 一致） */
const BONE_TO_VRM: Record<string, VRMHumanBoneName> = {
  spine_01: 'spine',
  spine_02: 'chest',
  spine_03: 'upperChest',
  neck_01: 'neck',
  head: 'head',
  shoulder_L: 'leftShoulder',
  shoulder_R: 'rightShoulder',
  upperarm_L: 'leftUpperArm',
  upperarm_R: 'rightUpperArm',
  forearm_L: 'leftLowerArm',
  forearm_R: 'rightLowerArm',
  hand_L: 'leftHand',
  hand_R: 'rightHand',
  thigh_L: 'leftUpperLeg',
  thigh_R: 'rightUpperLeg',
  calf_L: 'leftLowerLeg',
  calf_R: 'rightLowerLeg',
  foot_L: 'leftFoot',
  foot_R: 'rightFoot'
}

/** 空间态 → clip id 映射（未列出的状态回落 poseName 静态姿态） */
const STATE_CLIP: Partial<Record<SpatialStateName, string>> = {
  deep_focus: 'idle_focus',
  working: 'idle_breath',
  coding: 'idle_breath',
  writing: 'idle_breath',
  meeting: 'idle_breath',
  aidev: 'idle_focus',
  aiqa: 'idle_greet',
  slack: 'relax_sway',
  pomodoro_break: 'relax_sway',
  pomodoro_focus: 'doze_loop',
  sleeping: 'doze_loop',
  overworked: 'tired_sway',
  global_chat: 'idle_greet',
  offwork_remind: 'idle_greet',
  screen_block: 'serious_arms',
  overtime_confirm: 'serious_arms'
}

interface ClipEntry {
  clip: THREE.AnimationClip
  action: THREE.AnimationAction
  loop: boolean
  source: 'vrma' | 'procedural'
}

interface PoseBoneFrameSpec {
  pose: string
  /** 每根骨的摆动幅度（欧拉度）：offset = amp * sin(2π * cycles * t/dur + phase)
   *  cycles 必须为整数——保证循环首尾闭合，LoopRepeat 回卷不跳变 */
  sway?: Partial<Record<string, [x: number, y: number, z: number, cycles: number, phase: number]>>
}

/** 程序化动作库：base 姿态（poses.ts 美术角度）+ 整周期正弦摆动 */
const PROCEDURAL: Record<string, { dur: number; loop: boolean; spec: PoseBoneFrameSpec }> = {
  idle_breath: {
    dur: 4.0, loop: true,
    spec: { pose: 'stand_idle', sway: { spine_02: [2.2, 0, 0, 1, 0], neck_01: [1.2, 0.8, 0, 1, 1.2], head: [0.8, 1.5, 0, 1, 2.1] } }
  },
  idle_focus: {
    dur: 5.0, loop: true,
    spec: { pose: 'stand_idle', sway: { spine_02: [1.2, 0, 0, 1, 0], head: [0.6, 0.5, 0, 1, 0.8] } }
  },
  idle_greet: {
    dur: 2.6, loop: false, // 一次性：挥 2 次收手，结束后自动回落 idle_breath
    spec: { pose: 'stand_greet', sway: { forearm_R: [0, 0, 9, 2, 0], upperarm_R: [0, 0, 2.5, 1, 1.6], head: [0, 1.2, 0, 1, 0.5] } }
  },
  relax_sway: {
    dur: 4.5, loop: true,
    spec: { pose: 'stand_relaxed', sway: { spine_02: [0, 0, 2.2, 1, 0], spine_01: [0, 1.6, 0, 1, 1.5], head: [0, 0, 1.0, 1, 3.0] } }
  },
  doze_loop: {
    dur: 5.5, loop: true,
    spec: { pose: 'stand_sleepy', sway: { neck_01: [3.5, 0.6, 0, 2, 0], spine_03: [1.5, 0, 0, 1, 2.2] } }
  },
  tired_sway: {
    dur: 3.8, loop: true,
    spec: { pose: 'stand_tired', sway: { spine_02: [1.8, 0, 1.6, 1, 0], head: [1.2, 0, 2.0, 1, 1.8] } }
  },
  serious_arms: {
    dur: 4.2, loop: true,
    spec: { pose: 'stand_serious', sway: { spine_02: [0.8, 0.5, 0, 1, 0], head: [0, 1.0, 0, 1, 2.4] } }
  }
}

const _euler = new THREE.Euler()
const _quat = new THREE.Quaternion()

/** 动作工坊产出（模型空间四元数关键帧）→ AnimationClip；VRM0 按 x/z 预翻转 */
export function buildClipFromMotionData(vrm: VrmCharacter, data: MotionClipData): THREE.AnimationClip {
  const isVrm0 = vrm.vrm.meta.metaVersion === '0'
  const times = data.frames.map((f) => f.t)
  const bones = Object.keys(data.frames[0]?.rot ?? {})
  const rotation = new Map<VRMHumanBoneName, THREE.QuaternionKeyframeTrack>()
  for (const bone of bones) {
    const rest = vrm.restQuatOf(bone)
    const values: number[] = []
    for (const f of data.frames) {
      const q = f.rot[bone] ?? [0, 0, 0, 1]
      const qq = new THREE.Quaternion(q[0], q[1], q[2], q[3]).premultiply(rest)
      values.push(isVrm0 ? -qq.x : qq.x, qq.y, isVrm0 ? -qq.z : qq.z, qq.w)
    }
    rotation.set(bone as VRMHumanBoneName, new THREE.QuaternionKeyframeTrack('__motion__', times, values))
  }
  const anim = new VRMAnimation()
  anim.duration = data.duration
  anim.restHipsPosition = new THREE.Vector3(0, 1, 0)
  anim.humanoidTracks.rotation = rotation
  return createVRMAnimationClip(anim, vrm.vrm)
}

export class AnimationManager {
  private char: VrmCharacter
  private animator: Animator
  private mixer: THREE.AnimationMixer
  private clips = new Map<string, ClipEntry>()
  private currentId: string | null = null
  /** eco 档：10fps 播动画是幻灯片 → 停用 clip 回落姿态 */
  private eco = false
  /** stop() 后的淡出保活：mixer 在此时间前继续 update，让 fadeOut 真正完成 */
  private fadeHoldUntil = 0
  /** 延迟的 action.stop（可被重播取消，修复定格竞态） */
  private pendingStop: { timer: ReturnType<typeof setTimeout>; action: THREE.AnimationAction } | null = null
  vrmaCount = 0
  proceduralCount = 0

  constructor(char: VrmCharacter, animator: Animator) {
    this.char = char
    this.animator = animator
    this.mixer = new THREE.AnimationMixer(char.vrm.scene)
    this.mixer.addEventListener('finished', this.onClipFinished)
    this.buildProcedural()
    void this.loadVrmaAssets()
  }

  private lastState: SpatialStateName = 'working'
  /** 一次性动作 → 结束后自动接的循环 clip */
  private static ENTRY_FOLLOW: Record<string, string> = { idle_greet: 'idle_breath' }

  private onClipFinished = (): void => {
    // 一次性动作播完 → 优先接「回落 clip」（如 greet 完接呼吸），否则回空间态 clip
    const id = this.currentId
    const follow = id ? AnimationManager.ENTRY_FOLLOW[id] : null
    if (follow && this.clips.has(follow)) {
      this.playClip(follow, { fade: 0.3 })
      return
    }
    if (this.currentId) this.playForState(this.lastState, true)
  }

  /** 程序化 clip：以 poses.ts 美术角度为基线 + 整周期正弦摆动 */
  private buildProcedural(): void {
    // VRM0 模型：createVRMAnimationClip 内部会对四元数 x/z 取反（VRMA 规范按 VRM1 朝向约定），
    // 我们的角度按 Animator 的模型空间写，这里预先取反抵消，否则手臂等肢体会镜像错向
    const isVrm0 = this.char.vrm.meta.metaVersion === '0'
    for (const [id, def] of Object.entries(PROCEDURAL)) {
      try {
        const base: PoseEntry = POSES[def.spec.pose] ?? DEFAULT_POSE
        const times: number[] = []
        const steps = Math.max(12, Math.round(def.dur * 12))
        for (let i = 0; i <= steps; i++) times.push((i / steps) * def.dur)

        const rotation = new Map<VRMHumanBoneName, THREE.QuaternionKeyframeTrack>()
        const bones = new Set<string>(Object.keys(base.bones))
        for (const b of Object.keys(def.spec.sway ?? {})) bones.add(b)
        for (const bone of bones) {
          const vrmBone = BONE_TO_VRM[bone]
          if (!vrmBone) continue
          const baseE = base.bones[bone] ?? DEFAULT_POSE.bones[bone] ?? [0, 0, 0]
          const sway = def.spec.sway?.[bone]
          const values: number[] = []
          for (const t of times) {
            let x = baseE[0], y = baseE[1], z = baseE[2]
            if (sway) {
              const s = Math.sin((t / def.dur) * Math.PI * 2 * sway[3] + sway[4])
              x += sway[0] * s
              y += sway[1] * s
              z += sway[2] * s
            }
            _euler.set(D2R(x), D2R(y), D2R(z), 'XYZ')
            _quat.setFromEuler(_euler)
            // premultiply rest：A-pose 模型的绑定偏移也参与最终姿态
            _quat.premultiply(this.char.restQuatOf(vrmBone))
            values.push(
              isVrm0 ? -_quat.x : _quat.x,
              _quat.y,
              isVrm0 ? -_quat.z : _quat.z,
              _quat.w
            )
          }
          rotation.set(
            vrmBone,
            new THREE.QuaternionKeyframeTrack('__proc__', times, values)
          )
        }
        const anim = new VRMAnimation()
        anim.duration = def.dur
        anim.restHipsPosition = new THREE.Vector3(0, 1, 0)
        anim.humanoidTracks.rotation = rotation
        const clip = createVRMAnimationClip(anim, this.char.vrm)
        this.registerClip(id, clip, def.loop, 'procedural')
        this.proceduralCount++
      } catch (e) {
        console.warn(`[anim] 程序化 clip ${id} 构建失败:`, e)
      }
    }
    console.info(`[anim] 程序化 clip 就绪: ${this.proceduralCount} 个`)
  }

  /** 尝试加载 public/motions/*.vrma（清单 motions.json 可选；失败静默，不阻塞主流程） */
  private async loadVrmaAssets(): Promise<void> {
    try {
      const resp = await fetch('./motions/motions.json')
      const manifest = (await resp.json()) as { clips?: { id: string; file: string; loop?: boolean }[] }
      const loader = new GLTFLoader()
      loader.register((parser) => new VRMAnimationLoaderPlugin(parser))
      for (const item of manifest.clips ?? []) {
        try {
          const gltf = await loader.loadAsync(`./motions/${item.file}`)
          const anims = gltf.userData.vrmAnimations as VRMAnimation[] | undefined
          if (!anims?.length) continue
          const clip = createVRMAnimationClip(anims[0], this.char.vrm)
          this.registerClip(item.id, clip, item.loop ?? true, 'vrma')
          this.vrmaCount++
        } catch (e) {
          console.warn(`[anim] VRMA ${item.id} 加载失败（跳过）:`, e)
        }
      }
      if (this.vrmaCount) console.info(`[anim] VRMA 资产就绪: ${this.vrmaCount} 个`)
    } catch {
      console.info('[anim] 无 motions.json 清单，仅使用程序化 clip')
    }
  }

  private registerClip(id: string, clip: THREE.AnimationClip, loop: boolean, source: 'vrma' | 'procedural'): void {
    const old = this.clips.get(id)
    if (old) {
      // 撞 id：若正在播先停（否则旧 action 停止后 currentId 悬空导致定格）
      if (this.currentId === id) this.stop(0)
      old.action.stop()
      try { this.mixer.uncacheClip(old.clip) } catch { /* ignore */ }
    }
    const action = this.mixer.clipAction(clip)
    action.clampWhenFinished = !loop
    this.clips.set(id, { clip, action, loop, source })
  }

  hasClip(id: string): boolean {
    return this.clips.has(id)
  }

  hasStateClip(state: SpatialStateName): boolean {
    if (this.eco) return false
    const id = STATE_CLIP[state]
    return !!id && this.clips.has(id)
  }

  get activeClipId(): string | null {
    return this.currentId
  }

  /** 空间态驱动入口：Animator.playState 内部调用（有 clip crossFade，无 clip 返回 false 走 setPose） */
  playForState(state: SpatialStateName, forceRestart = false): boolean {
    this.lastState = state
    if (this.eco) return false
    const id = STATE_CLIP[state]
    if (!id || !this.clips.has(id)) return false
    this.playClip(id, { fade: 0.3, restart: forceRestart })
    return true
  }

  /** 播放指定 clip（跨 fade 切换；一次性动作结束自动回空间态 clip） */
  playClip(id: string, opts: { loop?: boolean; fade?: number; restart?: boolean } = {}): boolean {
    const entry = this.clips.get(id)
    if (!entry) return false
    // 重播前取消 pending 的延迟 stop（否则 action 复活后又被停掉 → 定格）
    if (this.pendingStop && this.pendingStop.action === entry.action) {
      clearTimeout(this.pendingStop.timer)
      this.pendingStop = null
    }
    const loop = opts.loop ?? entry.loop
    // 同 id 已在播：仅当显式要求 one-shot/重启时才重播，否则视为 no-op
    if (this.currentId === id && entry.action.isRunning() && !opts.restart && opts.loop === undefined) return true
    const fade = opts.fade ?? 0.25

    const prev = this.currentId ? this.clips.get(this.currentId) : null
    entry.action.reset()
    entry.action.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, loop ? Infinity : 1)
    entry.action.clampWhenFinished = !loop
    entry.action.enabled = true
    if (prev && prev !== entry && prev.action.isRunning()) {
      entry.action.crossFadeFrom(prev.action, fade, false)
    }
    entry.action.play()
    this.currentId = id
    this.animator.clipMode = true
    return true
  }

  /**
   * 停止 clip → Animator 回落姿态。
   * fadeOut 期间保活 mixer（fadeHoldUntil），真正淡出而非冻结在末帧。
   */
  stop(fade = 0.2): void {
    const prev = this.currentId ? this.clips.get(this.currentId) : null
    this.currentId = null
    this.animator.clipMode = false
    if (!prev) return
    if (this.pendingStop?.action === prev.action) {
      clearTimeout(this.pendingStop.timer)
    }
    prev.action.fadeOut(Math.max(0.01, fade))
    this.fadeHoldUntil = Date.now() + fade * 1000 + 80
    const timer = setTimeout(() => {
      prev.action.stop()
      if (this.pendingStop?.action === prev.action) this.pendingStop = null
    }, fade * 1000 + 80)
    this.pendingStop = { timer, action: prev.action }
  }

  /** eco 档停用 clip（10fps 播放像幻灯片），并按空间态回落静态姿态（含表情） */
  setEco(on: boolean): void {
    if (this.eco === on) return
    this.eco = on
    if (on) {
      this.stop()
      const cfg = SPATIAL_STATE_TABLE[this.lastState]
      this.animator.playState(this.lastState, cfg?.poseName ?? 'stand_idle', 0.4)
    } else {
      void this.playForState(this.lastState, true)
    }
  }

  /** 注册动作工坊产出的自定义动作（未解锁的由调用方过滤） */
  registerMotionFromData(id: string, data: MotionClipData, loop = false): void {
    try {
      const clip = buildClipFromMotionData(this.char, data)
      this.registerClip(id, clip, loop, 'vrma')
    } catch (e) {
      console.warn(`[anim] 自定义动作 ${id} 注册失败:`, e)
    }
  }

  /** 主循环每帧驱动（在 char.update 之前调用）；淡出期间也保活 */
  update(dt: number): void {
    if (this.currentId || Date.now() < this.fadeHoldUntil) this.mixer.update(dt)
  }
}
