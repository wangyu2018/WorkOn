/**
 * 气泡 v4：单行紧凑 / 多行正方形，hover 展开
 * - ≤15字 → 单行紧凑
 * - >15字 / 含换行 → 多行正方形（最大 280px × 8 行）
 * - hover → 暂停消失 + 缩放 1.08
 * - 尾巴在画布内有 padding，从不裁切
 * - 每次 show 重建纹理，无残影
 */
import * as THREE from 'three'

const FONT_FAMILY = '"Microsoft YaHei", "PingFang SC", sans-serif'
const SS = 3
const FONT_SIZE = 18
const FONT_SMALL = 15
const MAX_W = 280
const MAX_LINES = 8
const MIN_W = 88
const PAD_X = 18
const PAD_Y = 14
const TAIL_H = 12
const STROKE_W = 2
const SHORT_THRESHOLD = 15

export type BubbleVariant = 'character' | 'user'

const PALETTE: Record<BubbleVariant, { bg: string; border: string; text: string }> = {
  character: { bg: 'rgba(30, 25, 45, 0.88)', border: 'rgba(180, 140, 220, 0.6)', text: '#F0E6F6' },
  user: { bg: 'rgba(20, 40, 55, 0.88)', border: 'rgba(100, 200, 220, 0.55)', text: '#E0F2F8' }
}

function roundRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.lineTo(x + w - r, y)
  ctx.arcTo(x + w, y, x + w, y + r, r)
  ctx.lineTo(x + w, y + h - r)
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r)
  ctx.lineTo(x + r, y + h)
  ctx.arcTo(x, y + h, x, y + h - r, r)
  ctx.lineTo(x, y + r)
  ctx.arcTo(x, y, x + r, y, r)
  ctx.closePath()
}

function wrapLines(ctx: CanvasRenderingContext2D, text: string, maxW: number, fontPx: number): string[] {
  ctx.font = `${fontPx * SS}px ${FONT_FAMILY}`
  const lines: string[] = []
  let cur = ''
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    const test = cur + ch
    if (ctx.measureText(test).width / SS > maxW && cur.length > 0) {
      lines.push(cur)
      cur = ch
    } else {
      cur = test
    }
  }
  if (cur) lines.push(cur)
  return lines
}

export class Bubble {
  private sprite: THREE.Sprite
  private material: THREE.SpriteMaterial
  private texture: THREE.CanvasTexture
  private canvas: HTMLCanvasElement
  private ctx: CanvasRenderingContext2D
  private timer = 0
  private duration = 0
  private opacity = 0
  private variant: BubbleVariant
  private hovered = false
  private baseW = 256
  private baseH = 64
  private isLarge = false

  constructor(scene: THREE.Scene, variant: BubbleVariant = 'character') {
    this.variant = variant
    this.canvas = document.createElement('canvas')
    this.ctx = this.canvas.getContext('2d')!
    this.texture = new THREE.CanvasTexture(this.canvas)
    this.texture.colorSpace = THREE.SRGBColorSpace
    this.texture.generateMipmaps = true
    this.texture.minFilter = THREE.LinearMipmapLinearFilter
    this.texture.magFilter = THREE.LinearFilter
    this.material = new THREE.SpriteMaterial({
      map: this.texture,
      transparent: true,
      opacity: 0,
      depthWrite: false
    })
    this.sprite = new THREE.Sprite(this.material)
    this.sprite.renderOrder = variant === 'character' ? 20 : 19
    this.sprite.visible = false
    scene.add(this.sprite)
  }

  get visible(): boolean { return this.sprite.visible }
  get currentVariant(): BubbleVariant { return this.variant }
  get worldWidth(): number { return this.baseW }

  setHovered(h: boolean): void {
    if (h === this.hovered) return
    this.hovered = h
    if (h) this.duration = Math.max(this.duration, this.timer + 6)
  }

  hitTest(raycaster: THREE.Raycaster): boolean {
    if (!this.sprite.visible) return false
    return raycaster.intersectObject(this.sprite, false).length > 0
  }

  show(text: string, duration?: number, variant?: BubbleVariant): void {
    if (variant) this.variant = variant
    const pal = PALETTE[this.variant]
    const isUser = this.variant === 'user'
    const ctx = this.ctx

    const isShort = text.length <= SHORT_THRESHOLD && !text.includes('\n')
    this.isLarge = !isShort
    const fontPx = isShort ? FONT_SIZE : FONT_SMALL
    const lineH = Math.ceil(fontPx * 1.45)

    let lines: string[]
    if (isShort) {
      ctx.font = `${fontPx * SS}px ${FONT_FAMILY}`
      const flat = text.replace(/\s*\n\s*/g, ' ')
      const w = ctx.measureText(flat).width / SS
      if (w + PAD_X * 2 > MAX_W) {
        let cut = flat
        while (cut.length > 1 && ctx.measureText(cut + '…').width / SS + PAD_X * 2 > MAX_W) cut = cut.slice(0, -1)
        lines = [cut + '…']
      } else {
        lines = [flat]
      }
    } else {
      lines = wrapLines(ctx, text, MAX_W - PAD_X * 2, fontPx)
      if (lines.length > MAX_LINES) {
        lines = lines.slice(0, MAX_LINES)
        lines[MAX_LINES - 1] = lines[MAX_LINES - 1].slice(0, -2) + '…'
      }
    }

    let maxLineW = 0
    ctx.font = `${fontPx * SS}px ${FONT_FAMILY}`
    for (const l of lines) {
      const lw = ctx.measureText(l).width / SS
      if (lw > maxLineW) maxLineW = lw
    }
    const bodyW = Math.max(MIN_W, Math.ceil(maxLineW) + PAD_X * 2)
    const bodyH = lineH * lines.length + PAD_Y * 2

    // 画布尺寸：body + tail + stroke padding + safe margin
    const safe = STROKE_W * 2 + 4
    const cw = (bodyW + safe) * SS
    const ch = (bodyH + TAIL_H + safe) * SS

    this.canvas.width = cw
    this.canvas.height = ch
    // 确保完全透明清空
    ctx.clearRect(0, 0, cw, ch)
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
    ctx.font = `${fontPx * SS}px ${FONT_FAMILY}`
    ctx.textAlign = 'left'
    ctx.textBaseline = 'top'
    ctx.lineWidth = STROKE_W * SS
    ctx.strokeStyle = pal.border
    ctx.fillStyle = pal.bg

    // 绘图偏移（留 safe/2 的描边 padding）
    const ox = (safe / 2) * SS
    const oy = isUser ? (safe / 2 + TAIL_H) * SS : (safe / 2) * SS
    const bw = (bodyW) * SS
    const bh = (bodyH) * SS
    const radius = isShort ? 14 * SS : 20 * SS
    const bx = ox
    const by = oy

    // 泡泡体
    roundRectPath(ctx, bx, by, bw, bh, radius)
    ctx.fill()
    ctx.stroke()

    // 尾巴
    ctx.beginPath()
    if (isUser) {
      ctx.moveTo(bx + bw * 0.65, by)
      ctx.lineTo(bx + bw * 0.65 + 8 * SS, by - TAIL_H * SS + STROKE_W * SS)
      ctx.lineTo(bx + bw * 0.65 + 14 * SS, by)
    } else {
      ctx.moveTo(bx + bw * 0.5 - 7 * SS, by + bh)
      ctx.lineTo(bx + bw * 0.5, by + bh + TAIL_H * SS - STROKE_W * SS)
      ctx.lineTo(bx + bw * 0.5 + 7 * SS, by + bh)
    }
    ctx.closePath()
    ctx.fill()
    ctx.stroke()

    // 文字
    ctx.fillStyle = pal.text
    for (let i = 0; i < lines.length; i++) {
      ctx.fillText(lines[i], bx + PAD_X * SS, by + PAD_Y * SS + i * lineH * SS)
    }

    // 强制重上传纹理（销毁旧的避免残留）
    this.texture.dispose()
    this.texture = new THREE.CanvasTexture(this.canvas)
    this.texture.colorSpace = THREE.SRGBColorSpace
    this.texture.generateMipmaps = true
    this.texture.minFilter = THREE.LinearMipmapLinearFilter
    this.texture.magFilter = THREE.LinearFilter
    this.material.map = this.texture
    this.material.needsUpdate = true

    this.baseW = bodyW + safe
    this.baseH = bodyH + TAIL_H + safe
    this.sprite.scale.set(this.baseW, this.baseH, 1)
    this.sprite.visible = true

    this.timer = 0
    this.hovered = false
    this.duration = duration ?? (isShort ? Math.min(6, Math.max(3, text.length * 0.25)) : Math.max(8, Math.min(20, text.length * 0.35)))
    this.opacity = 0
  }

  hide(): void {
    this.duration = Math.min(this.duration, this.timer + 0.3)
  }

  /** 当前气泡的屏幕像素高度（不可见时为 0；右键输入框等 UI 避让用） */
  get visibleHeight(): number {
    return this.sprite.visible ? this.baseH : 0
  }

  update(dt: number, anchorX: number, anchorY: number, charScale = 1): void {
    if (!this.sprite.visible) return
    if (!this.hovered) this.timer += dt
    const fadeIn = Math.min(1, this.timer / 0.2)
    const remain = this.duration - this.timer
    const fadeOut = Math.min(1, Math.max(0, remain / 0.35))
    this.opacity = fadeIn * fadeOut
    this.material.opacity = this.opacity
    const bump = this.hovered ? 1.08 : 1
    this.sprite.scale.set(this.baseW * bump, this.baseH * bump, 1)
    const tailOffset = this.variant === 'user' ? TAIL_H : 0
    this.sprite.position.set(anchorX, anchorY + (40 + tailOffset) * charScale * bump, 30)
    if (remain <= 0) {
      this.sprite.visible = false
      this.material.opacity = 0
    }
  }
}
