/**
 * Stage：渲染器/相机/主循环/性能降级
 * 约束（digest §1.2/§2）：alpha:true, premultipliedAlpha:false, 透明清屏
 * 禁用 EffectComposer/Bloom（破坏透明背景），辉光全部用 emissive + 加性 sprite
 * 坐标系：世界单位 = 屏幕像素，原点屏幕中心，x 右 y 上
 */
import * as THREE from 'three'

export type FrameCallback = (dt: number, time: number) => void

export type FpsTier = 'eco' | 'standard' | 'smooth' | 'ultra'
const FPS_LIMIT: Record<FpsTier, number> = { eco: 10, standard: 20, smooth: 30, ultra: 0 }

export class Stage {
  readonly renderer: THREE.WebGLRenderer
  readonly scene: THREE.Scene
  readonly camera: THREE.PerspectiveCamera
  width = window.innerWidth
  height = window.innerHeight

  private callbacks: FrameCallback[] = []
  private last = 0
  private running = false
  /** 帧回调异常计数（节流日志用） */
  private frameErrors = 0
  /** 渲染器支持的最大各向异性（VRM 贴图锐化用） */
  readonly maxAnisotropy: number
  // FPS 统计与自动降级
  private fpsAccum = 0
  private fpsFrames = 0
  private fpsCheckTimer = 0
  private fpsLastSample = 60
  private degraded = false
  private degradeListeners: Array<() => void> = []
  private recoverListeners: Array<() => void> = []
  /** 滑动窗口计数：连续 4 次采样（10s）低于阈值才降级，连续 12 次（30s）高于恢复线才恢复 */
  private degradeStreak = 0
  private recoverStreak = 0
  /** 帧率档位（用户设置） */
  private tier: FpsTier = 'smooth'
  private lastFrame = 0
  private tierListeners: Array<(t: FpsTier) => void> = []
  /** 动态帧率提升（拖拽/过渡期间）：来源集合非空时保持 boost */
  private boostSources = new Set<string>()
  private preBoostTier: FpsTier | null = null

  constructor() {
    this.renderer = new THREE.WebGLRenderer({
      alpha: true,
      premultipliedAlpha: false,
      antialias: true,
      powerPreference: 'low-power'
    })
    this.renderer.setClearColor(0x000000, 0)
    // 清晰度：透明窗口在 Windows HiDPI 下有合成 bug（内容被放大 dpr 倍），
    // 此前用 pixelRatio=1 规避但发虚。改为 pixelRatio=dpr 并验证合成是否正常。
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.setSize(this.width, this.height)
    // 贴图各向异性过滤：斜视角下纹理更锐利（清晰度优化）
    this.maxAnisotropy = this.renderer.capabilities.getMaxAnisotropy()
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    // 亮度：ACES 色调映射压缩动态范围，中间调更亮（亮部不过曝）
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1.15
    document.body.appendChild(this.renderer.domElement)

    this.scene = new THREE.Scene()

    // fov=40，z 固定距离，换算使世界高度 = 屏幕像素高度（§1.4）
    this.camera = new THREE.PerspectiveCamera(40, this.width / this.height, 10, 8000)
    this.updateCamera()

    window.addEventListener('resize', () => this.onResize())
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.pause()
      else this.resume()
    })
    // 看门狗：Electron 透明置顶窗在锁屏/显示桌面/程序化隐藏恢复等场景下，
    // visibilitychange 可能丢失 visible 事件，渲染循环永久停摆 → 画面冻结（如停在闭眼帧）。
    // 每 2s 自检：文档可见但循环未运行则恢复
    window.setInterval(() => {
      if (!document.hidden && !this.running) this.resume()
    }, 2000)
  }

  private updateCamera(): void {
    const dist = this.height / 2 / Math.tan(THREE.MathUtils.degToRad(20))
    this.camera.position.set(0, 0, dist)
    this.camera.lookAt(0, 0, 0)
    this.camera.aspect = this.width / this.height
    this.camera.updateProjectionMatrix()
  }

  private onResize(): void {
    this.width = window.innerWidth
    this.height = window.innerHeight
    this.renderer.setSize(this.width, this.height)
    this.updateCamera()
  }

  /** 屏幕 px → 世界坐标（z=0 平面） */
  screenToWorld(px: number, py: number): { x: number; y: number } {
    return { x: px - this.width / 2, y: this.height / 2 - py }
  }

  onFrame(cb: FrameCallback): void {
    this.callbacks.push(cb)
  }

  offFrame(cb: FrameCallback): void {
    const i = this.callbacks.indexOf(cb)
    if (i >= 0) this.callbacks.splice(i, 1)
  }

  onDegrade(cb: () => void): void {
    this.degradeListeners.push(cb)
  }

  onRecover(cb: () => void): void {
    this.recoverListeners.push(cb)
  }

  /** 档位等级（比较高低用；ultra=不限帧最高） */
  private static tierRank(t: FpsTier): number {
    return t === 'eco' ? 0 : t === 'standard' ? 1 : t === 'smooth' ? 2 : 3
  }

  /** 临时提升帧率（拖拽/状态过渡期间调用），对应 unboostFps 解除 */
  boostFps(source = 'generic', target: FpsTier = 'smooth'): void {
    const wasEmpty = this.boostSources.size === 0
    this.boostSources.add(source)
    if (!wasEmpty) return
    if (Stage.tierRank(target) <= Stage.tierRank(this.tier)) return
    this.preBoostTier = this.tier
    this.tier = target
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    for (const cb of this.tierListeners) cb(target)
  }

  unboostFps(source = 'generic'): void {
    if (!this.boostSources.delete(source)) return
    if (this.boostSources.size > 0 || this.preBoostTier === null) return
    this.tier = this.preBoostTier
    this.preBoostTier = null
    const prCap = this.tier === 'ultra' || this.tier === 'smooth' ? Math.min(window.devicePixelRatio, 2) : 1
    this.renderer.setPixelRatio(prCap)
    for (const cb of this.tierListeners) cb(this.tier)
  }

  /** 设置帧率档位：pixelRatio 上限随档位调整，副作用广播给粒子/微行为 */
  setFpsTier(t: FpsTier): void {
    // 用户设置优先：清除进行中的 boost
    this.boostSources.clear()
    this.preBoostTier = null
    if (t === this.tier) return
    this.tier = t
    // 清晰度：smooth/ultra 都给满 dpr（上限 2），eco/standard 降到 1
    const prCap = t === 'ultra' || t === 'smooth' ? Math.min(window.devicePixelRatio, 2) : 1
    this.renderer.setPixelRatio(prCap)
    for (const cb of this.tierListeners) cb(t)
  }

  onFpsTier(cb: (t: FpsTier) => void): void {
    this.tierListeners.push(cb)
  }

  get fpsTier(): FpsTier {
    return this.tier
  }

  get isDegraded(): boolean {
    return this.degraded
  }

  private fpsSample(dt: number): void {
    this.fpsAccum += dt
    this.fpsFrames++
    this.fpsCheckTimer += dt
    if (this.fpsCheckTimer >= 2.5) {
      const avg = this.fpsFrames / this.fpsAccum
      this.fpsLastSample = Math.round(avg)
      this.fpsAccum = 0
      this.fpsFrames = 0
      this.fpsCheckTimer = 0
      // 阈值跟随档位上限：限帧档位（eco/standard/smooth）的 fps 天然低于 45，
      // 不能以绝对 45 判定降级，否则每个限帧档都会被误判为"性能不足"
      const cap = FPS_LIMIT[this.tier] // 0 = ultra 不限帧
      const degradeBelow = cap > 0 ? cap * 0.66 : 45
      const recoverAbove = cap > 0 ? cap * 0.92 : 50
      // 滑动窗口：连续 10s 低于阈值才降级（避免瞬时抖动误触发）
      if (!this.degraded && avg < degradeBelow) {
        this.recoverStreak = 0
        if (++this.degradeStreak >= 4) {
          this.degradeStreak = 0
          this.degraded = true
          this.renderer.setPixelRatio(1)
          for (const cb of this.degradeListeners) cb()
          console.info(`[pet] 连续10s fps<${degradeBelow.toFixed(0)}，自动降级：pixelRatio→1、粒子减半、关闭 rim 光`)
        }
      } else if (!this.degraded) {
        this.degradeStreak = 0
      }
      // 滑动窗口：连续 30s 高于恢复线才恢复（避免来回震荡）
      if (this.degraded && avg > recoverAbove) {
        this.degradeStreak = 0
        if (++this.recoverStreak >= 12) {
          this.recoverStreak = 0
          this.degraded = false
          const prCap = this.tier === 'ultra' || this.tier === 'smooth' ? Math.min(window.devicePixelRatio, 2) : 1
          this.renderer.setPixelRatio(prCap)
          for (const cb of this.recoverListeners) cb()
          console.info(`[pet] 连续30s fps>${recoverAbove.toFixed(0)}，性能恢复：pixelRatio 回满、粒子/轮廓光恢复`)
        }
      } else if (this.degraded) {
        this.recoverStreak = 0
      }
    }
  }

  start(): void {
    if (this.running) return
    this.running = true
    this.last = performance.now()
    const loop = (now: number) => {
      if (!this.running) return
      requestAnimationFrame(loop)
      // 帧率档位限制：未到间隔直接跳过本帧
      const limit = FPS_LIMIT[this.tier]
      if (limit > 0 && now - this.lastFrame < 1000 / limit - 1) return
      this.lastFrame = now
      // dt 上限随档位弹性调整：eco 帧间隔 100ms，若仍按 50ms 截断动画会跑半速（慢动作）
      const dtCap = this.tier === 'eco' ? 0.12 : this.tier === 'standard' ? 0.06 : 0.05
      const dt = Math.min((now - this.last) / 1000, dtCap)
      this.last = now
      this.fpsSample(dt)
      // 回调异常隔离：任一帧回调抛错不阻塞渲染与其他回调
      // （否则渲染永久停摆、画面冻结在最后一帧，如闭眼帧）
      for (const cb of this.callbacks) {
        try {
          cb(dt, now / 1000)
        } catch (e) {
          this.frameErrors++
          if (this.frameErrors <= 3 || this.frameErrors % 600 === 0) {
            console.error(`[pet] 帧回调异常（已隔离，第 ${this.frameErrors} 次）:`, e)
          }
        }
      }
      this.renderer.render(this.scene, this.camera)
    }
    requestAnimationFrame(loop)
  }

  pause(): void {
    this.running = false
  }

  resume(): void {
    this.last = performance.now()
    this.start()
  }

  /** 资源占用快照（供主窗口展示） */
  getStats(): { fps: number; tier: string; degraded: boolean; drawCalls: number; triangles: number; textures: number } {
    const info = this.renderer.info
    return {
      fps: this.fpsLastSample,
      tier: this.tier,
      degraded: this.degraded,
      drawCalls: info.render.calls,
      triangles: info.render.triangles,
      textures: info.memory.textures
    }
  }
}
