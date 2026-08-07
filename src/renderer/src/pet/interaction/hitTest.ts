/**
 * 像素级命中检测 + 光标状态机（digest-v4 §2 + 光标冲突修复）
 * - raycast 命中角色实体 → window.api.petHit(true) 恢复窗口鼠标接收
 * - 光标三态 hidden/grab/grabbing 统一管理，先设 cursor 再切穿透（rAF 保证时序）
 * - 迟滞区间：连续命中 2 帧才进入 grab，连续未命中 3 帧才回 hidden，消除边界闪烁
 */
import * as THREE from 'three'

export interface HitResult {
  hit: boolean
  part: string | null // hair / face / shoulder / hand / body / null
  point: THREE.Vector3 | null
}

type HitListener = (r: HitResult) => void
export type CursorState = 'hidden' | 'grab' | 'grabbing'

const CURSOR_MAP: Record<CursorState, string> = {
  hidden: 'none',
  grab: 'grab',
  grabbing: 'grabbing'
}

/** raycastCached 用的临时向量（避免每帧分配） */
const _targetPos = new THREE.Vector3()

export class HitTest {
  private raycaster = new THREE.Raycaster()
  private ndc = new THREE.Vector2()
  private camera: THREE.Camera
  private target: THREE.Object3D
  /** 粗判代理（圆柱）：先 raycast 它，不中就跳过整个蒙皮模型的精检 */
  private proxy: THREE.Object3D | null = null
  private lastMouse = { x: -1, y: -1 }
  private throttleTimer = 0
  private lastHitState = false
  private cursorState: CursorState = 'hidden'
  /** 迟滞计数：进入 grab 需连续命中 2 帧，离开需连续未命中 3 帧 */
  private hitStreak = 0
  private missStreak = 0
  private listeners: HitListener[] = []
  /** 静止帧缓存：鼠标与角色位置都没动时复用上帧结果，跳过 raycast */
  private lastRayResult: HitResult = { hit: false, part: null, point: null }
  private lastRayMouse = { x: -1, y: -1 }
  private lastTargetPos = new THREE.Vector3()
  private resultFresh = false

  onHitChanged: ((hit: boolean) => void) | null = null

  constructor(camera: THREE.Camera, target: THREE.Object3D, proxy?: THREE.Object3D) {
    this.camera = camera
    this.target = target
    this.proxy = proxy ?? null
    // 初始化即隐藏光标，避免窗口加载时系统光标短暂可见
    document.body.style.cursor = 'none'
  }

  /** 拖拽开关（dragPhysics 调用）：进入 grabbing / 退出后按最近命中回 grab 或 hidden */
  setDragging(d: boolean): void {
    this.setCursorState(d ? 'grabbing' : this.lastHitState ? 'grab' : 'hidden')
  }

  /** 统一光标状态：先写 cursor，下一帧再切鼠标穿透（避免时序差闪烁） */
  setCursorState(state: CursorState): void {
    if (state === this.cursorState) return
    this.cursorState = state
    document.body.style.cursor = CURSOR_MAP[state]
    const hit = state !== 'hidden'
    if (hit !== this.lastHitState) {
      this.lastHitState = hit
      requestAnimationFrame(() => {
        try {
          window.api?.petHit?.(hit)
        } catch {
          /* preload 未就绪时忽略 */
        }
        this.onHitChanged?.(hit)
      })
    }
  }

  onFrame(cb: HitListener): void {
    this.listeners.push(cb)
  }

  setMouse(px: number, py: number): void {
    this.lastMouse.x = px
    this.lastMouse.y = py
  }

  private raycast(): HitResult {
    if (this.lastMouse.x < 0) return { hit: false, part: null, point: null }
    this.ndc.set(
      (this.lastMouse.x / window.innerWidth) * 2 - 1,
      -(this.lastMouse.y / window.innerHeight) * 2 + 1
    )
    this.raycaster.setFromCamera(this.ndc, this.camera)
    // 粗判：圆柱代理不命中 → 直接 miss（蒙皮网格逐三角形求交是最贵的一步）
    if (this.proxy) {
      const coarse = this.raycaster.intersectObject(this.proxy, false)
      if (coarse.length === 0) return { hit: false, part: null, point: null }
    }
    const intersects = this.raycaster.intersectObject(this.target, true)
    // 只认 opacity > 0.1 的网格（§2）；代理 opacity=0 自然被过滤
    const valid = intersects.find((it) => {
      const mesh = it.object as THREE.Mesh
      if (!mesh.isMesh) return false
      const mat = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material
      return mat && mat.opacity > 0.1
    })
    if (!valid) return { hit: false, part: null, point: null }
    const part = (valid.object.userData.part as string) ?? 'body'
    return { hit: true, part, point: valid.point.clone() }
  }

  /** 鼠标与角色位置都没变时复用上帧结果（静止时跳过 raycast） */
  private raycastCached(): HitResult {
    this.target.getWorldPosition(_targetPos)
    const still =
      this.resultFresh &&
      this.lastRayMouse.x === this.lastMouse.x &&
      this.lastRayMouse.y === this.lastMouse.y &&
      _targetPos.distanceToSquared(this.lastTargetPos) < 0.25
    if (still) return this.lastRayResult
    this.lastRayMouse.x = this.lastMouse.x
    this.lastRayMouse.y = this.lastMouse.y
    this.lastTargetPos.copy(_targetPos)
    this.resultFresh = true
    this.lastRayResult = this.raycast()
    return this.lastRayResult
  }

  /** 每帧调用（内部 16ms 节流）；角色移动时鼠标不动也能更新穿透状态 */
  update(dt: number): void {
    this.throttleTimer -= dt
    if (this.throttleTimer > 0) return
    this.throttleTimer = 0.016

    // 拖拽期间强制保持命中（窗口保持可交互）
    const r = this.cursorState === 'grabbing' ? { hit: true, part: 'body' as string | null, point: null } : this.raycastCached()

    // 迟滞：连续命中 2 帧进 grab，连续未命中 3 帧回 hidden
    if (r.hit) {
      this.hitStreak++
      this.missStreak = 0
    } else {
      this.missStreak++
      this.hitStreak = 0
    }
    if (this.cursorState !== 'grabbing') {
      // 迟滞加强（3 帧进 / 6 帧出）：边缘命中抖动不再引发光标抽搐
      if (r.hit && this.cursorState === 'hidden' && this.hitStreak >= 3) {
        this.setCursorState('grab')
      } else if (!r.hit && this.cursorState === 'grab' && this.missStreak >= 6) {
        this.setCursorState('hidden')
      }
    }

    for (const cb of this.listeners) cb(r)
  }
}
