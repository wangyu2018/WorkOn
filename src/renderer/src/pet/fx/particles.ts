/**
 * 粒子系统（digest §10）：THREE.Points + 加性混合
 * - 常驻青绿慢漂尘 2-3 点绕身 / 金尘近鸟与发 1-2 点
 * - sleeping → Zzz 上升 / relax → 音符
 * - 交互星辉爆发 burst()
 * 不用 EffectComposer/Bloom（透明背景约束）
 */
import * as THREE from 'three'

/** 径向发光圆点贴图（柔光尘点用） */
function makeRadialGlowTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas')
  c.width = c.height = 64
  const ctx = c.getContext('2d')!
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32)
  g.addColorStop(0, 'rgba(255,255,255,1)')
  g.addColorStop(0.4, 'rgba(255,255,255,0.5)')
  g.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, 64, 64)
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
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

interface Particle {
  alive: boolean
  x: number
  y: number
  z: number
  vx: number
  vy: number
  vz: number
  life: number
  maxLife: number
  size: number
  r: number
  g: number
  b: number
  fadeIn: number
}

function makeTextSpriteTexture(text: string, color = '#FFFFFF'): THREE.CanvasTexture {
  const c = document.createElement('canvas')
  c.width = 64
  c.height = 64
  const ctx = c.getContext('2d')!
  ctx.font = 'bold 44px "Segoe UI", "Microsoft YaHei", sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.shadowColor = color
  ctx.shadowBlur = 10
  ctx.fillStyle = color
  ctx.fillText(text, 32, 34)
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

function makeStarTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas')
  c.width = 64
  c.height = 64
  const ctx = c.getContext('2d')!
  ctx.translate(32, 32)
  ctx.fillStyle = '#FFFFFF'
  ctx.shadowColor = '#FFF8D0'
  ctx.shadowBlur = 8
  ctx.beginPath()
  for (let i = 0; i < 8; i++) {
    const r = i % 2 === 0 ? 26 : 8
    const a = (i / 8) * Math.PI * 2 - Math.PI / 2
    ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r)
  }
  ctx.closePath()
  ctx.fill()
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

class PointPool {
  readonly points: THREE.Points
  private particles: Particle[] = []
  private posAttr: THREE.BufferAttribute
  private sizeAttr: THREE.BufferAttribute
  private alphaAttr: THREE.BufferAttribute
  private colorAttr: THREE.BufferAttribute

  constructor(capacity: number, map: THREE.Texture, scene: THREE.Scene) {
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
    const mat = new THREE.ShaderMaterial({
      uniforms: { map: { value: map } },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    })
    this.points = new THREE.Points(geo, mat)
    this.points.frustumCulled = false
    this.points.renderOrder = 10
    scene.add(this.points)
    for (let i = 0; i < capacity; i++) {
      this.particles.push({ alive: false, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, life: 0, maxLife: 1, size: 1, r: 1, g: 1, b: 1, fadeIn: 0.15 })
    }
  }

  spawn(p: Partial<Particle> & { x: number; y: number }): void {
    const slot = this.particles.find((q) => !q.alive)
    if (!slot) return
    slot.alive = true
    slot.x = p.x
    slot.y = p.y
    slot.z = p.z ?? 10
    slot.vx = p.vx ?? 0
    slot.vy = p.vy ?? 0
    slot.vz = p.vz ?? 0
    slot.maxLife = p.maxLife ?? 2
    slot.life = slot.maxLife
    slot.size = p.size ?? 8
    slot.r = p.r ?? 1
    slot.g = p.g ?? 1
    slot.b = p.b ?? 1
    slot.fadeIn = p.fadeIn ?? 0.15
  }

  update(dt: number): void {
    let n = 0
    for (const p of this.particles) {
      if (!p.alive) continue
      p.life -= dt
      if (p.life <= 0) {
        p.alive = false
        continue
      }
      p.x += p.vx * dt
      p.y += p.vy * dt
      p.z += p.vz * dt
      const age = p.maxLife - p.life
      const fadeIn = Math.min(1, age / p.fadeIn)
      const fadeOut = Math.min(1, p.life / (p.maxLife * 0.5))
      this.posAttr.setXYZ(n, p.x, p.y, p.z)
      this.sizeAttr.setX(n, p.size)
      this.alphaAttr.setX(n, fadeIn * fadeOut)
      this.colorAttr.setXYZ(n, p.r, p.g, p.b)
      n++
    }
    this.points.geometry.setDrawRange(0, n)
    this.posAttr.needsUpdate = true
    this.sizeAttr.needsUpdate = true
    this.alphaAttr.needsUpdate = true
    this.colorAttr.needsUpdate = true
  }
}

export type ParticleMood = 'normal' | 'sleeping' | 'relax'

export class ParticleSystem {
  private scene: THREE.Scene
  private dots!: PointPool // 软点（青绿尘/金尘）
  private stars: PointPool | null = null // 星辉（首次 burst 时懒初始化）
  private glyphs: PointPool | null = null // Zzz（首次 sleeping 时懒初始化）
  private notes: PointPool | null = null // 音符（首次 relax 时懒初始化）
  private mood: ParticleMood = 'normal'
  private density = 1
  private ambientTimer = 0
  private glyphTimer = 0
  private inited = false

  constructor(scene: THREE.Scene) {
    this.scene = scene
  }

  /** 懒初始化：仅创建 dots（常驻尘点），stars/glyphs/notes 按需延迟 */
  private ensureInit(): void {
    if (this.inited) return
    this.inited = true
    this.dots = new PointPool(64, makeRadialGlowTexture(), this.scene)
  }

  private ensureStars(): PointPool {
    if (!this.stars) this.stars = new PointPool(48, makeStarTexture(), this.scene)
    return this.stars
  }

  private ensureGlyphs(): PointPool {
    if (!this.glyphs) this.glyphs = new PointPool(24, makeTextSpriteTexture('Z', '#BFD8FF'), this.scene)
    return this.glyphs
  }

  private ensureNotes(): PointPool {
    if (!this.notes) this.notes = new PointPool(24, makeTextSpriteTexture('♪', '#C77DBA'), this.scene)
    return this.notes
  }

  setMood(mood: ParticleMood): void {
    this.mood = mood
  }

  /** 性能降级：粒子按概率跳帧（1=全量 0.5=减半 0=关闭） */
  setDensity(d: number): void {
    this.density = d
  }

  /** 星辉爆发（点击反馈/金铃） */
  burst(wx: number, wy: number, count = 2, colorHex = 0xffffff): void {
    this.ensureInit()
    const stars = this.ensureStars()
    const c = new THREE.Color(colorHex)
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2
      stars.spawn({
        x: wx + (Math.random() - 0.5) * 20,
        y: wy + (Math.random() - 0.5) * 20,
        vx: Math.cos(a) * 30,
        vy: Math.sin(a) * 30 + 20,
        size: 8 + Math.random() * 8,
        maxLife: 0.6 + Math.random() * 0.4,
        r: c.r,
        g: c.g,
        b: c.b
      })
    }
  }

  /** 常驻/情绪粒子，anchor 为角色中心世界坐标 */
  update(dt: number, anchorX: number, anchorY: number, scale: number): void {
    this.ensureInit()
    // 青绿慢漂尘 2-3 点绕身（density 概率跳帧：eco/降级时稀疏但不为零）
    this.ambientTimer -= dt
    if (this.ambientTimer <= 0) {
      this.ambientTimer = 1.2
      if (Math.random() < this.density) {
        const gold = Math.random() < 0.35
        const c = gold ? new THREE.Color('#D4AF37') : new THREE.Color('#50C878')
        this.dots.spawn({
          x: anchorX + (Math.random() - 0.5) * 90 * scale,
          y: anchorY + Math.random() * 140 * scale,
          vx: (Math.random() - 0.5) * 12,
          vy: 8 + Math.random() * 10,
          size: (gold ? 5 : 7) * scale,
          maxLife: 2.5 + Math.random() * 1.5,
          r: c.r,
          g: c.g,
          b: c.b,
          fadeIn: 0.5
        })
      }
    }

    // Zzz / 音符（按需懒初始化对应池）
    this.glyphTimer -= dt
    if (this.glyphTimer <= 0) {
      this.glyphTimer = 1.6
      if (Math.random() >= this.density) {
        // 概率跳帧：本轮不生成
      } else if (this.mood === 'sleeping') {
        const glyphs = this.ensureGlyphs()
        glyphs.spawn({
          x: anchorX + 30 * scale,
          y: anchorY + 130 * scale,
          vx: 12,
          vy: 26,
          size: 16 * scale,
          maxLife: 2.6,
          r: 0.75,
          g: 0.85,
          b: 1,
          fadeIn: 0.4
        })
      } else if (this.mood === 'relax') {
        const notes = this.ensureNotes()
        notes.spawn({
          x: anchorX - 30 * scale,
          y: anchorY + 110 * scale,
          vx: -8,
          vy: 20,
          size: 15 * scale,
          maxLife: 2.4,
          r: 0.78,
          g: 0.49,
          b: 0.73,
          fadeIn: 0.4
        })
      }
    }

    this.dots.update(dt)
    if (this.stars) this.stars.update(dt)
    if (this.glyphs) this.glyphs.update(dt)
    if (this.notes) this.notes.update(dt)
  }
}
