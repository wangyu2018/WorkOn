/**
 * 天气系统（v2.9）：基于时间的天气粒子效果
 *
 * 天气类型：
 *   clear  — 无天气粒子
 *   rain   — 雨滴（蓝色线段，快速下落）
 *   snow   — 雪花（白色圆点，缓慢飘落+左右漂移）
 *   petals — 樱花瓣（粉色，随风飘舞）
 *   leaves — 落叶（橙棕色，旋转下落）
 *
 * 粒子覆盖整个窗口区域，不影响角色周围的环境粒子（由 ParticleSystem 管理）
 * 性能：粒子数随 density 和 fpsTier 调整，eco 档位自动减半
 */
import * as THREE from 'three'
import type { TimeOfDay } from '../scene/Lighting'

export type WeatherType = 'clear' | 'rain' | 'snow' | 'petals' | 'leaves'

interface WeatherParticle {
  alive: boolean
  x: number
  y: number
  z: number
  vx: number
  vy: number
  vz: number
  size: number
  r: number
  g: number
  b: number
  alpha: number
  phase: number // 用于摆动/旋转
}

const VERT = `
attribute float aSize;
attribute float aAlpha;
attribute vec3 aColor;
varying float vAlpha;
varying vec3 vColor;
void main() {
  vAlpha = aAlpha;
  vColor = aColor;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = aSize * (600.0 / -mv.z);
  gl_Position = projectionMatrix * mv;
}
`
const FRAG = `
uniform sampler2D map;
varying float vAlpha;
varying vec3 vColor;
void main() {
  vec4 t = texture2D(map, gl_PointCoord);
  gl_FragColor = vec4(vColor * t.rgb, vAlpha * t.a);
}
`

function makeGlowTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas')
  c.width = c.height = 32
  const ctx = c.getContext('2d')!
  const g = ctx.createRadialGradient(16, 16, 0, 16, 16, 16)
  g.addColorStop(0, 'rgba(255,255,255,1)')
  g.addColorStop(0.5, 'rgba(255,255,255,0.6)')
  g.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, 32, 32)
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

/** 根据时段和随机性选择天气（可被外部覆盖） */
export function autoWeatherForPhase(phase: TimeOfDay): WeatherType {
  const r = Math.random()
  // 夜晚 30% 概率下雪/下雨
  if (phase === 'night') {
    if (r < 0.15) return 'snow'
    if (r < 0.30) return 'rain'
  }
  // 黄昏 10% 花瓣
  if (phase === 'dusk' && r < 0.10) return 'petals'
  // 白天 5% 落叶（秋天感）
  if (phase === 'day' && r < 0.05) return 'leaves'
  // 黎明 10% 花瓣
  if (phase === 'dawn' && r < 0.10) return 'petals'
  return 'clear'
}

export class WeatherSystem {
  private scene: THREE.Scene
  private points: THREE.Points | null = null
  private particles: WeatherParticle[] = []
  private posAttr: THREE.BufferAttribute
  private sizeAttr: THREE.BufferAttribute
  private alphaAttr: THREE.BufferAttribute
  private colorAttr: THREE.BufferAttribute
  private weather: WeatherType = 'clear'
  private density = 1
  private spawnTimer = 0
  private windPhase = 0
  private width: number
  private height: number
  private active = false

  constructor(scene: THREE.Scene, width: number, height: number) {
    this.scene = scene
    this.width = width
    this.height = height
    const capacity = 200
    const geo = new THREE.BufferGeometry()
    this.posAttr = new THREE.BufferAttribute(new Float32Array(capacity * 3), 3)
    this.sizeAttr = new THREE.BufferAttribute(new Float32Array(capacity), 1)
    this.alphaAttr = new THREE.BufferAttribute(new Float32Array(capacity), 1)
    this.colorAttr = new THREE.BufferAttribute(new Float32Array(capacity * 3), 3)
    this.posAttr.setUsage(THREE.DynamicDrawUsage)
    this.sizeAttr.setUsage(THREE.DynamicDrawUsage)
    this.alphaAttr.setUsage(THREE.DynamicDrawUsage)
    this.colorAttr.setUsage(THREE.DynamicDrawUsage)
    geo.setAttribute('position', this.posAttr)
    geo.setAttribute('aSize', this.sizeAttr)
    geo.setAttribute('aAlpha', this.alphaAttr)
    geo.setAttribute('aColor', this.colorAttr)
    const tex = makeGlowTexture()
    const mat = new THREE.ShaderMaterial({
      uniforms: { map: { value: tex } },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    })
    this.points = new THREE.Points(geo, mat)
    this.points.frustumCulled = false
    this.points.renderOrder = 5 // 在角色之前（renderOrder 10 是环境粒子）
    this.points.visible = false
    scene.add(this.points)
    for (let i = 0; i < capacity; i++) {
      this.particles.push({
        alive: false, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0,
        size: 1, r: 1, g: 1, b: 1, alpha: 1, phase: 0
      })
    }
  }

  /** 设置天气类型 */
  setWeather(w: WeatherType): void {
    if (w === this.weather) return
    this.weather = w
    if (w === 'clear') {
      this.points!.visible = false
      // 清除所有活跃粒子
      for (const p of this.particles) p.alive = false
    } else {
      this.points!.visible = true
    }
    this.active = w !== 'clear'
    console.log(`[weather] 切换天气: ${w}`)
  }

  /** 获取当前天气 */
  getWeather(): WeatherType {
    return this.weather
  }

  /** 性能降级：0=关闭 0.5=减半 1=全量 */
  setDensity(d: number): void {
    this.density = d
    if (d === 0) {
      this.points!.visible = false
    } else if (this.active) {
      this.points!.visible = true
    }
  }

  /** 更新窗口尺寸 */
  resize(w: number, h: number): void {
    this.width = w
    this.height = h
  }

  private spawnParticle(): void {
    const slot = this.particles.find((p) => !p.alive)
    if (!slot) return
    slot.alive = true
    slot.phase = Math.random() * Math.PI * 2

    const w = this.width
    const h = this.height

    switch (this.weather) {
      case 'rain': {
        slot.x = (Math.random() - 0.5) * w * 1.2
        slot.y = h / 2 + 50
        slot.z = 20 + Math.random() * 80
        slot.vx = -30 // 风向偏左
        slot.vy = -400 + Math.random() * -100
        slot.vz = 0
        slot.size = 3 + Math.random() * 2
        slot.r = 0.6; slot.g = 0.7; slot.b = 0.9
        slot.alpha = 0.4 + Math.random() * 0.2
        break
      }
      case 'snow': {
        slot.x = (Math.random() - 0.5) * w * 1.2
        slot.y = h / 2 + 50
        slot.z = 20 + Math.random() * 100
        slot.vx = (Math.random() - 0.5) * 20
        slot.vy = -30 - Math.random() * 20
        slot.vz = 0
        slot.size = 4 + Math.random() * 6
        slot.r = 0.9; slot.g = 0.95; slot.b = 1.0
        slot.alpha = 0.5 + Math.random() * 0.3
        break
      }
      case 'petals': {
        slot.x = -w / 2 - 20
        slot.y = (Math.random() - 0.2) * h * 0.8
        slot.z = 30 + Math.random() * 80
        slot.vx = 30 + Math.random() * 20
        slot.vy = -10 + Math.random() * -5
        slot.vz = 0
        slot.size = 5 + Math.random() * 4
        slot.r = 1.0; slot.g = 0.6; slot.b = 0.75
        slot.alpha = 0.6 + Math.random() * 0.2
        break
      }
      case 'leaves': {
        slot.x = (Math.random() - 0.5) * w * 1.2
        slot.y = h / 2 + 50
        slot.z = 30 + Math.random() * 60
        slot.vx = -15 + Math.random() * 10
        slot.vy = -25 - Math.random() * 15
        slot.vz = 0
        slot.size = 5 + Math.random() * 5
        slot.r = 0.8; slot.g = 0.5; slot.b = 0.2
        slot.alpha = 0.5 + Math.random() * 0.2
        break
      }
    }
  }

  /** 获取生成间隔（秒） */
  private get spawnInterval(): number {
    if (this.density === 0) return Infinity
    switch (this.weather) {
      case 'rain': return 0.008 / this.density
      case 'snow': return 0.06 / this.density
      case 'petals': return 0.12 / this.density
      case 'leaves': return 0.15 / this.density
      default: return Infinity
    }
  }

  update(dt: number): void {
    if (!this.active || this.density === 0) return

    this.windPhase += dt * 0.5

    // 生成新粒子
    this.spawnTimer -= dt
    while (this.spawnTimer <= 0) {
      this.spawnParticle()
      this.spawnTimer += this.spawnInterval
    }

    // 更新粒子
    let n = 0
    const halfH = this.height / 2
    const halfW = this.width / 2
    for (const p of this.particles) {
      if (!p.alive) continue

      // 风/摆动效果
      const windX = Math.sin(this.windPhase + p.phase) * 15
      p.x += (p.vx + windX) * dt
      p.y += p.vy * dt

      // 出界回收
      if (p.y < -halfH - 50 || p.x < -halfW - 100 || p.x > halfW + 100) {
        p.alive = false
        continue
      }

      this.posAttr.setXYZ(n, p.x, p.y, p.z)
      this.sizeAttr.setX(n, p.size)

      // 摆动透明度（花瓣/落叶）
      let alpha = p.alpha
      if (this.weather === 'petals' || this.weather === 'leaves') {
        alpha = p.alpha * (0.7 + Math.sin(this.windPhase * 2 + p.phase) * 0.3)
      }
      this.alphaAttr.setX(n, alpha)
      this.colorAttr.setXYZ(n, p.r, p.g, p.b)
      n++
    }

    this.points!.geometry.setDrawRange(0, n)
    this.posAttr.needsUpdate = true
    this.sizeAttr.needsUpdate = true
    this.alphaAttr.needsUpdate = true
    this.colorAttr.needsUpdate = true
  }

  /** 释放资源 */
  dispose(): void {
    if (this.points) {
      this.scene.remove(this.points)
      this.points.geometry.dispose()
      ;(this.points.material as THREE.Material).dispose()
    }
  }
}
