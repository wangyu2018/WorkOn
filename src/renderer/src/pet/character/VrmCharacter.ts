/**
 * VrmCharacter：姵儿 VRM 桌宠角色
 * 对外保持旧 LingCharacter 的调用面（root / bone(name) / face / height / topY /
 * setMoving / setGlobalOpacity / setRenderOrder / update），内部换成 VRM 人形骨骼：
 *
 * 层级（世界单位 = 屏幕像素）：
 *   root（脚底锚点，SpatialController 驱动 position/scale/rotation.y）
 *     └ body（Animator 'body' 骨：整体俯仰，趴/躺姿态）
 *        └ hipsProxy（Animator 'hips' 骨：position.y=hipsY、微旋转）
 *           └ scaleG（scale = px/米，把 VRM 归一化到 DEFAULT_HIPS_Y=100 髋高）
 *              └ vrm.scene（已居中、髋部对齐原点）
 *
 * 骨骼别名：poses/Animator/microBehaviors 沿用旧命名（hips/spine_01/upperarm_L...），
 * 这里映射到 VRM humanoid 标准化骨骼；狐耳/金铃等旧配件骨骼给隐形替身骨。
 */
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js'
import { VRMLoaderPlugin, VRMUtils, VRM, VRMHumanBoneName } from '@pixiv/three-vrm'
import {
  NEUTRAL_EXPRESSION,
  cloneExpression,
  type Expression
} from './expression'

/** 站姿髋高（px，scale 1.0 时）；VRM 归一化基准（130 → 角色总高约 245px） */
export const DEFAULT_HIPS_Y = 130

/** 共享 DRACOLoader 实例（WASM 解码器，只加载一次） */
let dracoLoader: DRACOLoader | null = null
function getDracoLoader(): DRACOLoader {
  if (!dracoLoader) {
    dracoLoader = new DRACOLoader()
    dracoLoader.setDecoderPath('./draco/')
    dracoLoader.setDecoderConfig({ type: 'wasm' })
  }
  return dracoLoader
}

/** 旧骨骼名 → VRM humanoid 骨骼名 */
const BONE_ALIAS: Record<string, VRMHumanBoneName> = {
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

/** 表情参数 → VRM 预设表情 */
class VrmFace {
  private vrm: VRM
  private expr: Expression = cloneExpression(NEUTRAL_EXPRESSION)
  private available = new Set<string>()
  private gaze = new THREE.Vector2(0, 0)
  private blinkOverride = -1

  constructor(vrm: VRM) {
    this.vrm = vrm
    const em = vrm.expressionManager
    if (em) {
      for (const name of ['happy', 'sad', 'angry', 'relaxed', 'surprised', 'aa', 'ih', 'ou', 'blink']) {
        if (em.getExpression(name)) this.available.add(name)
      }
    }
  }

  private set(name: string, v: number): void {
    if (!this.available.has(name)) return
    this.vrm.expressionManager!.setValue(name, THREE.MathUtils.clamp(v, 0, 1))
  }

  /** Animator 每帧写入（先缓存，commit 统一应用） */
  apply(e: Expression): void {
    this.expr = e
  }

  /** 眼追踪输入：nx/ny ∈ [-1,1] */
  setGaze(nx: number, ny: number): void {
    this.gaze.set(
      THREE.MathUtils.clamp(nx, -1, 1),
      THREE.MathUtils.clamp(ny, -1, 1)
    )
  }

  get gazeX(): number {
    return this.gaze.x
  }
  get gazeY(): number {
    return this.gaze.y
  }

  /** 眨眼覆盖（1=全开 0=闭合，-1 解除），commit 时消费 */
  applyBlinkOverride(open: number): void {
    this.blinkOverride = open
  }

  /** 每帧提交到 expressionManager（在 vrm.update 前调用） */
  commit(): void {
    const e = this.expr
    let open = THREE.MathUtils.clamp(e.eyeOpen, 0.04, 1)
    // NaN 防护：上游数据异常时不让 NaN 写入 morph（会导致表情永久卡死）
    if (!Number.isFinite(open)) open = 0.88
    if (this.blinkOverride >= 0 && Number.isFinite(this.blinkOverride)) {
      open *= this.blinkOverride
      this.blinkOverride = -1
    }
    open *= 1 + e.eyeWide * 0.18 - e.squint * 0.25
    this.set('blink', 1 - THREE.MathUtils.clamp(open, 0, 1))
    this.set('happy', e.smile)
    this.set('sad', e.frown)
    this.set('angry', Math.max(0, -e.browRaise) * 0.7)
    this.set('surprised', e.eyeWide * 0.6)
    this.set('relaxed', e.squint * 0.8)
    this.set('aa', e.mouthOpen)
  }
}

export class VrmCharacter {
  readonly root = new THREE.Group() // 脚底锚点
  readonly body = new THREE.Group() // 整体俯仰
  readonly face: VrmFace
  readonly vrm: VRM
  /** 命中检测粗判代理（圆柱，不渲染；raycast 先打它，不中则跳过昂贵的蒙皮网格检测） */
  readonly hitProxy: THREE.Mesh

  private hipsProxy = new THREE.Group()
  private dummies = new Map<string, THREE.Group>()
  private materials: THREE.Material[] = []
  private lookTarget = new THREE.Object3D()
  private charHeight: number
  private moving = false
  private time = 0
  /** 上次 root.scale：突变 >3% 时加速 SpringBone 收敛（防头发缓慢飘落） */
  private lastScale = 1

  private constructor(vrm: VRM, modelHeightPx: number, scale: number) {
    this.vrm = vrm
    this.charHeight = modelHeightPx
    this.face = new VrmFace(vrm)

    this.root.name = 'root'
    this.body.name = 'body'
    this.hipsProxy.name = 'hips'
    this.hipsProxy.position.y = DEFAULT_HIPS_Y

    this.root.add(this.body)
    this.body.add(this.hipsProxy)

    // scaleG：VRM 米制 → 屏幕像素
    const scaleG = new THREE.Group()
    scaleG.name = 'scaleG'
    scaleG.scale.setScalar(scale)
    scaleG.add(vrm.scene)
    this.hipsProxy.add(scaleG)

    // 旧配件骨替身（狐耳/金铃：VRM 无对应件，微行为写旋转不报错即可）
    const headNode = vrm.humanoid?.getNormalizedBoneNode('head')
    for (const name of ['foxEar_L', 'foxEar_R', 'bell_L', 'bell_R']) {
      const d = new THREE.Group()
      d.name = name
      if (headNode) headNode.add(d)
      this.dummies.set(name, d)
    }

    // 材质收集（透明度统一控制用）
    vrm.scene.traverse((o) => {
      const mesh = o as THREE.Mesh
      if (mesh.isMesh) {
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
        for (const m of mats) if (m && !this.materials.includes(m)) this.materials.push(m)
      }
    })

    // 视线目标（挂在场景层，update 里跟随头部世界坐标）
    this.lookTarget.name = 'lookTarget'
    if (vrm.lookAt) vrm.lookAt.target = this.lookTarget

    // 命中代理：包裹身体的矮圆柱（opacity=0，精检时被 opacity>0.1 过滤，不参与渲染）
    const proxyGeo = new THREE.CylinderGeometry(modelHeightPx * 0.2, modelHeightPx * 0.22, modelHeightPx, 8)
    const proxyMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false })
    proxyMat.visible = false
    this.hitProxy = new THREE.Mesh(proxyGeo, proxyMat)
    this.hitProxy.name = 'hitProxy'
    this.hitProxy.position.y = modelHeightPx / 2
    this.root.add(this.hitProxy)
  }

  /** 异步加载 VRM，归一化到 DEFAULT_HIPS_Y 髋高
   *  支持 URL 字符串或 ArrayBuffer（用户上传的文件） */
  static async load(urlOrBuffer: string | ArrayBuffer): Promise<VrmCharacter> {
    const loader = new GLTFLoader()
    loader.setDRACOLoader(getDracoLoader())
    loader.register((parser) => new VRMLoaderPlugin(parser))
    const gltf = typeof urlOrBuffer === 'string'
      ? await loader.loadAsync(urlOrBuffer)
      : await loader.parseAsync(urlOrBuffer, '')
    const vrm = gltf.userData.vrm as VRM
    if (!vrm) throw new Error('文件不是有效的 VRM 格式（缺少 VRM 元数据）')
    if (vrm.meta.metaVersion === '0') VRMUtils.rotateVRM0(vrm)
    VRMUtils.removeUnnecessaryVertices(gltf.scene)
    VRMUtils.combineSkeletons(gltf.scene)

    vrm.scene.updateMatrixWorld(true)
    const box = new THREE.Box3().setFromObject(vrm.scene)
    const hipsNode = vrm.humanoid!.getNormalizedBoneNode('hips')!
    const hipsWorld = new THREE.Vector3()
    hipsNode.getWorldPosition(hipsWorld)

    // 归一化：髋高 = DEFAULT_HIPS_Y px；角色总高按比例
    const hipsAboveFeet = Math.max(0.01, hipsWorld.y - box.min.y)
    const scale = DEFAULT_HIPS_Y / hipsAboveFeet
    const heightPx = (box.max.y - box.min.y) * scale

    // 居中 + 髋对齐：vrm.scene 平移使髋部落在 scaleG 原点
    const center = box.getCenter(new THREE.Vector3())
    vrm.scene.position.set(-center.x, -hipsWorld.y, -center.z)

    return new VrmCharacter(vrm, heightPx, scale)
  }

  /** 把视线目标挂到场景（需要世界坐标，随 root 一起加到 scene 即可） */
  attachLookTarget(scene: THREE.Scene): void {
    scene.add(this.lookTarget)
  }

  bone(name: string): THREE.Object3D {
    if (name === 'body') return this.body
    if (name === 'hips') return this.hipsProxy
    const dummy = this.dummies.get(name)
    if (dummy) return dummy
    const humanBone = BONE_ALIAS[name]
    if (humanBone) {
      const node = this.vrm.humanoid?.getNormalizedBoneNode(humanBone)
      if (node) return node
      // 模型缺该骨（如 shoulder）→ 给替身，避免姿态系统报错
      const d = new THREE.Group()
      d.name = name
      this.dummies.set(name, d)
      return d
    }
    throw new Error(`bone missing: ${name}`)
  }

  /** 身高（px，scale 1.0 时） */
  get height(): number {
    return this.charHeight
  }

  /** 头顶高度（气泡锚点用） */
  get topY(): number {
    return this.charHeight + 12
  }

  setMoving(moving: boolean): void {
    this.moving = moving
  }

  setGlobalOpacity(a: number): void {
    for (const m of this.materials) {
      m.transparent = a < 1
      m.opacity = a
    }
  }

  setRenderOrder(order: number): void {
    this.root.traverse((o) => {
      o.renderOrder = order
    })
  }

  update(dt: number): void {
    this.time += dt
    // 视线：头部世界坐标 + 朝向偏移 + gaze 偏移
    const head = this.vrm.humanoid?.getNormalizedBoneNode('head')
    if (head && this.lookTarget.parent) {
      head.getWorldPosition(_v1)
      this.root.getWorldQuaternion(_q)
      _v2.set(this.face.gazeX * 40, this.face.gazeY * 30, 160).applyQuaternion(_q)
      this.lookTarget.position.copy(_v1).add(_v2)
    }
    this.face.commit()
    // 头发物理：root.scale 突变 >3% 时，SpringBone 的 prevPosition 还在旧缩放下，
    // 头发会"缓慢降落"。额外跑 3 帧小步长 vrm.update 让物理快速收敛到新缩放。
    const curScale = this.root.scale.x
    if (Math.abs(curScale - this.lastScale) > 0.03) {
      this.lastScale = curScale
      for (let i = 0; i < 3; i++) this.vrm.update(dt * 0.5)
    }
    this.vrm.update(dt)
  }

  /** 移动标记（行走时头发/裙摆物理已在 VRM springBone 内，保留接口） */
  get isMoving(): boolean {
    return this.moving
  }

  /** 释放 Three.js 资源（切换角色时调用，防止内存泄漏） */
  dispose(): void {
    this.root.traverse((o) => {
      const mesh = o as THREE.Mesh
      if (mesh.isMesh) {
        mesh.geometry?.dispose()
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
        for (const m of mats) {
          const mat = m as THREE.Material & { map?: THREE.Texture }
          mat.map?.dispose()
          mat.dispose()
        }
      }
    })
    // 从场景移除
    if (this.root.parent) this.root.parent.remove(this.root)
    if (this.lookTarget.parent) this.lookTarget.parent.remove(this.lookTarget)
  }
}

const _v1 = new THREE.Vector3()
const _v2 = new THREE.Vector3()
const _q = new THREE.Quaternion()
