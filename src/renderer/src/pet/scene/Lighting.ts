/**
 * 5 光源系统（digest-LING §10）：
 * Key 定向 / Fill 定向 / Rim 聚光（青绿轮廓）/ Hemisphere / Status 点光（挂角色根，随状态变色）
 * 构造分两步：Key/Fill/Hemisphere 立即创建（场景先有光照感）；
 * Rim/Status 等角色加载后经 attachCharacterRoot 挂载（懒加载分批渲染）。
 *
 * 昼夜循环（v2.9）：根据本地时间自动调整光照色温/强度/曝光
 * - 黎明 5-7  / 白天 7-17 / 黄昏 17-19 / 夜晚 19-5
 * - 每个时段有 key/fill/hemi 色温 + 曝光参数，通过 lerp 平滑过渡
 */
import * as THREE from 'three'

export type StatusMood = 'focus' | 'slack' | 'rest' | 'urgent' | 'happy' | 'idle'

/** 昼夜时段 */
export type TimeOfDay = 'dawn' | 'day' | 'dusk' | 'night'

/** 时段光照参数 */
interface PhaseLighting {
  keyColor: string
  keyIntensity: number
  fillColor: string
  fillIntensity: number
  hemiSky: string
  hemiGround: string
  hemiIntensity: number
  rimColor: string
  rimIntensity: number
  exposure: number
}

const PHASES: Record<TimeOfDay, PhaseLighting> = {
  dawn: {
    keyColor: '#FFD4A8', keyIntensity: 0.7,
    fillColor: '#C8D8FF', fillIntensity: 0.45,
    hemiSky: '#FFE8D0', hemiGround: '#D8C8B0', hemiIntensity: 0.4,
    rimColor: '#FFB880', rimIntensity: 0.5,
    exposure: 1.0
  },
  day: {
    keyColor: '#FFF8F0', keyIntensity: 1.0,
    fillColor: '#F0F5FF', fillIntensity: 0.65,
    hemiSky: '#E0F0E8', hemiGround: '#F0E8D8', hemiIntensity: 0.55,
    rimColor: '#50C878', rimIntensity: 0.8,
    exposure: 1.15
  },
  dusk: {
    keyColor: '#FFA060', keyIntensity: 0.85,
    fillColor: '#8090C0', fillIntensity: 0.5,
    hemiSky: '#FFC890', hemiGround: '#C0A080', hemiIntensity: 0.45,
    rimColor: '#FF8040', rimIntensity: 0.6,
    exposure: 1.05
  },
  night: {
    keyColor: '#B0C8FF', keyIntensity: 0.4,
    fillColor: '#6080B0', fillIntensity: 0.3,
    hemiSky: '#2030A0', hemiGround: '#1A1A30', hemiIntensity: 0.25,
    rimColor: '#4060B0', rimIntensity: 0.4,
    exposure: 0.85
  }
}

/** 根据小时获取时段 */
export function getPhaseByHour(hour: number): TimeOfDay {
  if (hour >= 5 && hour < 7) return 'dawn'
  if (hour >= 7 && hour < 17) return 'day'
  if (hour >= 17 && hour < 19) return 'dusk'
  return 'night'
}

const STATUS_COLORS: Record<StatusMood, { color: string; intensity: number }> = {
  idle: { color: '#50C878', intensity: 0.5 },
  focus: { color: '#D4AF37', intensity: 0.7 },
  slack: { color: '#C77DBA', intensity: 0.7 },
  rest: { color: '#F0F5FF', intensity: 0.5 },
  urgent: { color: '#E04040', intensity: 0.6 },
  happy: { color: '#50C878', intensity: 0.9 }
}

export class Lighting {
  private key: THREE.DirectionalLight
  private fill: THREE.DirectionalLight
  private rim: THREE.SpotLight | null = null
  private hemi: THREE.HemisphereLight
  private status: THREE.PointLight | null = null
  private statusTarget = new THREE.Color(STATUS_COLORS.idle.color)
  private statusIntensityTarget = STATUS_COLORS.idle.intensity
  private time = 0

  // 昼夜系统
  private currentPhase: TimeOfDay = 'day'
  private phaseLerp = 1 // 0→1，1=完全到达目标
  private targetPhase: TimeOfDay = 'day'
  private renderer: THREE.WebGLRenderer | null = null
  private phaseCheckTimer = 0

  constructor(scene: THREE.Scene, characterRoot: THREE.Object3D | null) {
    // 初始化时段
    this.currentPhase = getPhaseByHour(new Date().getHours())
    this.targetPhase = this.currentPhase
    const phase = PHASES[this.currentPhase]

    // Key：主光，左上前
    this.key = new THREE.DirectionalLight(phase.keyColor, phase.keyIntensity)
    this.key.position.set(-300, 450, 350)
    scene.add(this.key)

    // Fill：补光，右下
    this.fill = new THREE.DirectionalLight(phase.fillColor, phase.fillIntensity)
    this.fill.position.set(320, -180, 250)
    scene.add(this.fill)

    // Hemisphere：环境光
    this.hemi = new THREE.HemisphereLight(phase.hemiSky, phase.hemiGround, phase.hemiIntensity)
    scene.add(this.hemi)

    if (characterRoot) this.attachCharacterRoot(characterRoot)
  }

  /** 关联渲染器（用于调整 toneMappingExposure） */
  attachRenderer(renderer: THREE.WebGLRenderer): void {
    this.renderer = renderer
    this.applyExposure()
  }

  /** 角色加载后挂载 Rim/Status 光源到角色根节点（幂等） */
  attachCharacterRoot(root: THREE.Object3D): void {
    if (this.rim) return
    const phase = PHASES[this.currentPhase]
    // Rim：SpotLight，正后方
    this.rim = new THREE.SpotLight(phase.rimColor, phase.rimIntensity, 900, Math.PI / 4, 0.5, 1)
    this.rim.position.set(0, 260, -320)
    const rimTarget = new THREE.Object3D()
    rimTarget.position.set(0, 140, 0)
    root.add(rimTarget)
    this.rim.target = rimTarget
    root.add(this.rim)

    // Status：PointLight 挂角色根
    this.status = new THREE.PointLight(STATUS_COLORS.idle.color, STATUS_COLORS.idle.intensity, 500, 1.2)
    this.status.position.set(0, 150, 80)
    root.add(this.status)
  }

  setMood(mood: StatusMood): void {
    const s = STATUS_COLORS[mood]
    this.statusTarget.set(s.color)
    this.statusIntensityTarget = s.intensity
  }

  /** 降级：关闭 rim 光 */
  setDegraded(): void {
    if (this.rim) this.rim.visible = false
  }

  /** 恢复：重新打开 rim 光 */
  setRecovered(): void {
    if (this.rim) this.rim.visible = true
  }

  /** 获取当前时段 */
  getPhase(): TimeOfDay {
    return this.currentPhase
  }

  /** 手动设置时段（用于调试/未来手动切换） */
  setPhase(phase: TimeOfDay): void {
    if (phase === this.targetPhase) return
    this.targetPhase = phase
    this.phaseLerp = 0
  }

  /** 应用曝光到渲染器 */
  private applyExposure(): void {
    if (this.renderer) {
      const phase = PHASES[this.currentPhase]
      this.renderer.toneMappingExposure = phase.exposure
    }
  }

  /** 昼夜光照 lerp */
  private updatePhaseLerp(dt: number): void {
    // 每 60 秒检查一次时间
    this.phaseCheckTimer += dt
    if (this.phaseCheckTimer >= 60) {
      this.phaseCheckTimer = 0
      const hour = new Date().getHours()
      const detected = getPhaseByHour(hour)
      if (detected !== this.targetPhase) {
        this.setPhase(detected)
      }
    }

    if (this.phaseLerp >= 1) return

    // 30 秒平滑过渡
    this.phaseLerp = Math.min(1, this.phaseLerp + dt / 30)
    const k = this.phaseLerp
    const from = PHASES[this.currentPhase]
    const to = PHASES[this.targetPhase]

    const fromKey = new THREE.Color(from.keyColor)
    const toKey = new THREE.Color(to.keyColor)
    this.key.color.lerpColors(fromKey, toKey, k)
    this.key.intensity = from.keyIntensity + (to.keyIntensity - from.keyIntensity) * k

    const fromFill = new THREE.Color(from.fillColor)
    const toFill = new THREE.Color(to.fillColor)
    this.fill.color.lerpColors(fromFill, toFill, k)
    this.fill.intensity = from.fillIntensity + (to.fillIntensity - from.fillIntensity) * k

    const fromSky = new THREE.Color(from.hemiSky)
    const toSky = new THREE.Color(to.hemiSky)
    const fromGround = new THREE.Color(from.hemiGround)
    const toGround = new THREE.Color(to.hemiGround)
    this.hemi.color.lerpColors(fromSky, toSky, k)
    this.hemi.groundColor.lerpColors(fromGround, toGround, k)
    this.hemi.intensity = from.hemiIntensity + (to.hemiIntensity - from.hemiIntensity) * k

    if (this.rim) {
      const fromRim = new THREE.Color(from.rimColor)
      const toRim = new THREE.Color(to.rimColor)
      this.rim.color.lerpColors(fromRim, toRim, k)
      this.rim.intensity = from.rimIntensity + (to.rimIntensity - from.rimIntensity) * k
    }

    // 曝光
    if (this.renderer) {
      this.renderer.toneMappingExposure = from.exposure + (to.exposure - from.exposure) * k
    }

    // 过渡完成
    if (this.phaseLerp >= 1) {
      this.currentPhase = this.targetPhase
    }
  }

  update(dt: number): void {
    this.time += dt
    // 昼夜过渡
    this.updatePhaseLerp(dt)
    // 状态光
    if (!this.status) return
    const k = 1 - Math.exp(-dt / 0.25)
    this.status.color.lerp(this.statusTarget, k)
    const pulse = 1 + Math.sin(this.time * (Math.PI * 2) / 1.5) * 0.12
    const cur = this.status.intensity + (this.statusIntensityTarget - this.status.intensity) * k
    this.status.intensity = cur * pulse
  }
}
