/**
 * 气泡 v5：DOM overlay 实现（替换旧 canvas sprite 版）
 * - 玻璃拟态卡片 + 指向角色的尾巴，视觉规格对齐 VPet/Open-LLM-VTuber 的气泡
 * - 支持打字机流式渲染（AI 回复逐字显现）
 * - 屏幕边缘自动避让；hover 暂停消失计时（监听窗口级 mousemove，穿透窗下也可用）
 * - 对外 API 与旧版完全一致（show/update/hide/visible/worldWidth/...），消费方零改动
 */
import type * as THREE from 'three'

const FONT_FAMILY = '"Microsoft YaHei", "PingFang SC", sans-serif'
const MAX_W = 300
const MIN_W = 96
const PAD_X = 16
const PAD_Y = 12
const TAIL = 10
/** 打字机速度（字符/秒） */
const TYPE_CPS = 32

export type BubbleVariant = 'character' | 'user'

const PALETTE: Record<BubbleVariant, { bg: string; border: string; text: string; shadow: string }> = {
  character: {
    bg: 'rgba(24, 20, 44, 0.86)',
    border: 'rgba(167, 139, 250, 0.55)',
    text: '#F5F2FF',
    shadow: '0 8px 28px rgba(80, 40, 160, 0.35)'
  },
  user: {
    bg: 'rgba(12, 30, 48, 0.88)',
    border: 'rgba(56, 189, 248, 0.5)',
    text: '#EAF6FF',
    shadow: '0 8px 28px rgba(20, 90, 160, 0.3)'
  }
}

export class Bubble {
  private el: HTMLDivElement
  private textEl: HTMLSpanElement
  private timer = 0
  private showT = 0 // 入场淡入独立计时（不被打字机清零）
  private duration = 0
  private visibleFlag = false
  private hovered = false
  private variant: BubbleVariant = 'character'
  private contentW = 256
  /** 打字机状态：fullText 全文 / revealed 已显字符数 */
  private fullText = ''
  private revealed = 0
  private streaming = false
  /** 窗口级鼠标位置（穿透窗 forward 模式下仍可收到 mousemove） */
  private mouse: { x: number; y: number } | null = null
  private mouseHandler = (e: MouseEvent): void => {
    this.mouse = { x: e.clientX, y: e.clientY }
  }

  constructor(_scene?: unknown, variant: BubbleVariant = 'character') {
    this.variant = variant
    this.el = document.createElement('div')
    this.el.className = 'pet-bubble'
    this.textEl = document.createElement('span')
    this.textEl.className = 'pet-bubble-text'
    const tail = document.createElement('i')
    tail.className = 'pet-bubble-tail'
    this.el.appendChild(this.textEl)
    this.el.appendChild(tail)
    this.applyStyle()
    this.el.style.opacity = '0'
    this.el.style.display = 'none'
    this.el.style.pointerEvents = 'none'
    document.body.appendChild(this.el)
    window.addEventListener('mousemove', this.mouseHandler, { passive: true })
  }

  private tailIsTop = false

  private applyStyle(): void {
    const s = this.el.style
    const pal = PALETTE[this.variant]
    this.tailIsTop = false
    s.position = 'fixed'
    s.maxWidth = `${MAX_W}px`
    s.minWidth = `${MIN_W}px`
    s.padding = `${PAD_Y}px ${PAD_X}px ${PAD_Y + 2}px`
    s.background = pal.bg
    s.border = `1px solid ${pal.border}`
    s.borderRadius = '14px'
    s.boxShadow = pal.shadow
    s.backdropFilter = 'blur(10px)'
    s.color = pal.text
    s.fontFamily = FONT_FAMILY
    s.fontSize = '15px'
    s.lineHeight = '1.5'
    s.letterSpacing = '0.2px'
    s.boxSizing = 'border-box'
    s.wordBreak = 'break-word'
    s.whiteSpace = 'pre-wrap'
    s.zIndex = '60'
    s.transition = 'opacity 0.18s ease, transform 0.18s ease'
    s.transformOrigin = 'bottom center'
    // 尾巴（向下指角色；user 变体在顶部向上指）
    const tail = this.el.querySelector('.pet-bubble-tail') as HTMLElement
    tail.style.position = 'absolute'
    tail.style.left = '50%'
    tail.style.width = '0'
    tail.style.height = '0'
    tail.style.transform = 'translateX(-50%)'
    // 四属性全量重置，避免变体/翻边切换时残留对侧三角（双尾巴）
    tail.style.top = 'auto'
    tail.style.bottom = 'auto'
    tail.style.borderTop = 'none'
    tail.style.borderBottom = 'none'
    tail.style.borderLeft = '7px solid transparent'
    tail.style.borderRight = '7px solid transparent'
    if (this.variant === 'character') {
      tail.style.bottom = `-${TAIL}px`
      tail.style.borderTop = `${TAIL}px solid ${pal.bg}`
    } else {
      tail.style.top = `-${TAIL}px`
      tail.style.borderBottom = `${TAIL}px solid ${pal.bg}`
    }
    this.textEl.style.display = 'block'
  }

  get visible(): boolean {
    return this.visibleFlag
  }
  get currentVariant(): BubbleVariant {
    return this.variant
  }
  get worldWidth(): number {
    return this.contentW
  }
  /** 屏幕像素高度（右键输入框避让用） */
  get visibleHeight(): number {
    return this.visibleFlag ? this.el.offsetHeight + TAIL : 0
  }

  setHovered(h: boolean): void {
    if (h === this.hovered) return
    this.hovered = h
    if (h) this.duration = Math.max(this.duration, this.timer + 6)
  }

  /** 兼容旧签名（旧版用 raycaster 检测；DOM 版内部已自带 hover 检测） */
  hitTest(_raycaster: THREE.Raycaster): boolean {
    return this.hovered
  }

  show(
    text: string,
    duration?: number,
    variant?: BubbleVariant,
    opts?: { stream?: boolean }
  ): void {
    if (variant) {
      this.variant = variant
      this.applyStyle()
    }
    this.fullText = text
    this.revealed = opts?.stream ? 0 : text.length
    this.streaming = !!opts?.stream
    this.textEl.textContent = text.slice(0, this.revealed)

    // 内容变化后量宽：先以隐藏可见性挂出 DOM（display:none 时 scrollWidth 恒 0）
    this.textEl.textContent = text
    const prevDisplay = this.el.style.display
    const prevVis = this.el.style.visibility
    this.el.style.visibility = 'hidden'
    this.el.style.display = 'block'
    this.contentW = Math.max(MIN_W, Math.min(MAX_W, this.el.scrollWidth + PAD_X * 2))
    this.el.style.display = prevDisplay
    this.el.style.visibility = prevVis
    this.textEl.textContent = this.fullText.slice(0, this.revealed)

    this.el.style.display = 'block'
    this.el.style.opacity = '0'
    requestAnimationFrame(() => {
      this.el.style.opacity = '1'
      this.el.style.transform = 'scale(1)'
    })
    this.el.style.transform = 'scale(0.96)'

    this.visibleFlag = true
    this.timer = 0
    this.showT = 0
    this.hovered = false
    this.duration =
      duration ??
      (this.streaming
        ? 6 + text.length * 0.12
        : text.length <= 15
          ? Math.min(6, Math.max(3, text.length * 0.25))
          : Math.max(8, Math.min(20, text.length * 0.35)))
  }

  hide(): void {
    this.duration = Math.min(this.duration, this.timer + 0.25)
  }

  private lastBox = { x: 0, y: 0, w: 0, h: 0 }

  private updateHover(): void {
    if (!this.visibleFlag || !this.mouse) {
      this.setHovered(false)
      return
    }
    // 用自己写入的定位盒做命中（避免每帧 getBoundingClientRect 强制布局）
    const b = this.lastBox
    const inside =
      this.mouse.x >= b.x - 4 &&
      this.mouse.x <= b.x + b.w + 4 &&
      this.mouse.y >= b.y - 4 &&
      this.mouse.y <= b.y + b.h + 4
    this.setHovered(inside)
  }

  /** 世界坐标锚点 → 屏幕像素（世界原点 = 屏幕中心，y 向上）。
   *  角色：气泡底沿悬在头顶上方 ~40px，尾巴向下指头；贴近屏幕顶时翻转尾巴挂到头下。
   *  用户：气泡在锚点侧上方，尾巴朝上。 */
  update(dt: number, anchorWorldX: number, anchorWorldY: number, charScale = 1): void {
    if (!this.visibleFlag) return
    this.updateHover()
    this.showT += dt
    // 打字机：先吐字，吐完才开始计时消失
    if (this.revealed < this.fullText.length) {
      this.revealed = Math.min(this.fullText.length, this.revealed + Math.ceil(dt * TYPE_CPS))
      this.textEl.textContent = this.fullText.slice(0, this.revealed)
      this.timer = 0
    } else if (!this.hovered) {
      this.timer += dt
    }
    const fadeIn = Math.min(1, this.showT / 0.18)
    const remain = this.duration - this.timer
    const fadeOut = Math.min(1, Math.max(0, remain / 0.3))
    this.el.style.opacity = String(Math.min(1, fadeIn * fadeOut))

    const sx = anchorWorldX + window.innerWidth / 2
    // 锚点的屏幕 Y（锚点本身已在头顶上方：main.ts 传 w.y + topY*scale）
    const anchorScreenY = window.innerHeight / 2 - anchorWorldY
    const w = this.el.offsetWidth
    const h = this.el.offsetHeight

    let top: number
    if (this.variant === 'character') {
      let want = anchorScreenY - 40 * charScale - h
      if (want < 8) {
        // 顶部空间不足：翻到头下方，尾巴朝上
        want = anchorScreenY + 16 * charScale
        this.setTailTop(true)
      } else {
        this.setTailTop(false)
      }
      top = want
    } else {
      this.setTailTop(true)
      top = anchorScreenY - h - TAIL
    }
    top = Math.max(8, Math.min(window.innerHeight - h - 8, top))
    const x = Math.max(10, Math.min(window.innerWidth - w - 10, sx - w / 2))
    this.el.style.left = `${x}px`
    this.el.style.top = `${top}px`
    this.lastBox = { x, y: top, w, h }

    if (remain <= 0 && this.revealed >= this.fullText.length) {
      this.visibleFlag = false
      this.el.style.display = 'none'
    }
  }

  /** 尾巴朝向切换（角色气泡贴顶时尾巴翻到上方） */
  private setTailTop(top: boolean): void {
    if (this.tailIsTop === top) return
    this.tailIsTop = top
    const tail = this.el.querySelector('.pet-bubble-tail') as HTMLElement | null
    if (!tail) return
    const pal = PALETTE[this.variant]
    if (top) {
      tail.style.bottom = 'auto'
      tail.style.top = `-${TAIL}px`
      tail.style.borderTop = 'none'
      tail.style.borderBottom = `${TAIL}px solid ${pal.bg}`
    } else {
      tail.style.top = 'auto'
      tail.style.bottom = `-${TAIL}px`
      tail.style.borderBottom = 'none'
      tail.style.borderTop = `${TAIL}px solid ${pal.bg}`
    }
  }
}
