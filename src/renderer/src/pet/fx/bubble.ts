/**
 * 气泡 v6：DOM overlay（v5 基础上增强）
 * - 优先级队列：ai(3) > care(2) > chatter(1)——AI 回答播放中，关怀/闲聊排队不打断
 * - 真流式消费：streamChunk 直接喂 LLM 增量（reveal 打字机追赶），streamReset 重置 tool 轮次
 * - 工作区感知：下边界避开任务栏；钳制后尾巴跟随锚点（不再指向空气）
 * - 悬停展开：长回答折叠 150px，悬停 0.7s 自动展开（petModal 接管点击，文本可选中复制），移开自动收起
 * - 对外 API 向后兼容：show/hide/update/hide/visible/worldWidth/visibleHeight/hitTest/setHovered
 */
import type * as THREE from 'three'
import { TASKBAR_HEIGHT } from '../spatial/stateTable'

const FONT_FAMILY = '"Microsoft YaHei", "PingFang SC", sans-serif'
const MAX_W = 300
const MIN_W = 96
const PAD_X = 16
const PAD_Y = 12
const TAIL = 10
/** 打字机速度（字符/秒） */
const TYPE_CPS = 32
/** 超过此高度折叠；悬停 0.7s 展开 */
const COLLAPSE_H = 150
const EXPAND_HOVER_S = 0.7

export type BubbleVariant = 'character' | 'user'
export type BubblePriority = 'ai' | 'care' | 'chatter'

const PRECEDENCE: Record<BubblePriority, number> = { ai: 3, care: 2, chatter: 1 }

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

interface ShowRequest {
  text: string
  duration?: number
  variant?: BubbleVariant
  priority: BubblePriority
  stream?: boolean
}

export class Bubble {
  private el: HTMLDivElement
  private textEl: HTMLSpanElement
  private footerEl: HTMLDivElement | null = null
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
  private priority: BubblePriority = 'chatter'
  /** 低优先级消息队列（当前气泡结束自动放出；cap 2，超出丢最旧） */
  private pending: ShowRequest[] = []
  /** 悬停展开状态 */
  private expanded = false
  private collapsible = false
  private hoverMs = 0
  private leaveMs = 0
  private onModal: ((open: boolean) => void) | null
  /** 窗口级鼠标位置（穿透窗 forward 模式下仍可收到 mousemove） */
  private mouse: { x: number; y: number } | null = null
  private mouseHandler = (e: MouseEvent): void => {
    this.mouse = { x: e.clientX, y: e.clientY }
  }
  private tailEl: HTMLElement

  constructor(_scene?: unknown, variant: BubbleVariant = 'character', hooks?: { onModal?: (open: boolean) => void }) {
    this.variant = variant
    this.onModal = hooks?.onModal ?? null
    this.el = document.createElement('div')
    this.el.className = 'pet-bubble'
    this.textEl = document.createElement('span')
    this.textEl.className = 'pet-bubble-text'
    this.tailEl = document.createElement('i')
    this.tailEl.className = 'pet-bubble-tail'
    this.el.appendChild(this.textEl)
    this.el.appendChild(this.tailEl)
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
    const tail = this.tailEl
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

  /** v6：优先级入口。低优先级在 AI/关怀播放中排队，不打断 */
  show(
    text: string,
    duration?: number,
    variant?: BubbleVariant,
    opts?: { stream?: boolean; priority?: BubblePriority }
  ): void {
    const priority = opts?.priority ?? 'chatter'
    if (this.visibleFlag && PRECEDENCE[priority] < PRECEDENCE[this.priority]) {
      // 排队（cap 2，丢最旧）；正在打字机的 ai 永不被闲聊覆盖
      if (this.pending.length >= 2) this.pending.shift()
      this.pending.push({ text, duration, variant, priority })
      return
    }
    this.display(text, duration, variant, opts, priority)
  }

  private display(
    text: string,
    duration: number | undefined,
    variant: BubbleVariant | undefined,
    opts: { stream?: boolean } | undefined,
    priority: BubblePriority
  ): void {
    if (variant) {
      this.variant = variant
      this.applyStyle()
    }
    this.priority = priority
    this.fullText = text
    this.revealed = opts?.stream ? 0 : text.length
    this.streaming = !!opts?.stream
    if (this.expanded) this.expand(false)
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
    this.applyCollapse()

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

  /** v6 真流式：LLM 增量喂入。已在播的 ai 气泡只推全文、打字机追赶；否则新开 */
  streamChunk(full: string, variant: BubbleVariant = 'character'): void {
    if (!this.visibleFlag || this.priority !== 'ai') {
      this.display(full, undefined, variant, { stream: true }, 'ai')
      return
    }
    this.fullText = full
    if (this.revealed > full.length) this.revealed = full.length
    this.textEl.textContent = full.slice(0, this.revealed)
  }

  /** v6：tool 轮次重置——丢弃已显的中间文本，等最终回答重新吐字 */
  streamReset(): void {
    if (this.priority !== 'ai') return
    this.fullText = ''
    this.revealed = 0
    this.textEl.textContent = ''
  }

  /** v6：流式收尾——全文定格（不重新打字），随后消息队列放出下一条 */
  finishStream(final: string): void {
    this.fullText = final
    this.revealed = final.length
    this.streaming = false
    this.textEl.textContent = final
    this.duration = Math.max(this.duration, this.timer + Math.min(14, 4 + final.length * 0.1))
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

  /** 悬停展开：长内容折叠 150px，悬停 0.7s 展开（可选中复制），移开 0.35s 收起 */
  private updateExpand(dt: number): void {
    if (!this.collapsible || !this.visibleFlag) return
    if (this.hovered) {
      this.leaveMs = 0
      if (!this.expanded) {
        this.hoverMs += dt
        if (this.hoverMs >= EXPAND_HOVER_S) this.expand(true)
      }
    } else if (this.expanded) {
      this.leaveMs += dt
      if (this.leaveMs > 0.35) this.expand(false)
    } else {
      this.hoverMs = 0
    }
  }

  private expand(open: boolean): void {
    if (this.expanded === open) return
    this.expanded = open
    this.el.style.maxHeight = open ? 'none' : `${COLLAPSE_H}px`
    this.el.style.overflow = open ? 'visible' : 'hidden'
    this.el.style.userSelect = open ? 'text' : 'none'
    this.el.style.pointerEvents = open ? 'auto' : 'none'
    this.el.style.cursor = open ? 'text' : ''
    if (this.footerEl) this.footerEl.textContent = open ? '收起 ▴' : '… 展开 ▾'
    try { this.onModal?.(open) } catch { /* ignore */ }
  }

  /** 折叠判定 + 底部提示条（长回答才可展开） */
  private applyCollapse(): void {
    this.expanded = false
    this.hoverMs = 0
    this.leaveMs = 0
    const h = this.el.offsetHeight
    this.collapsible = h > COLLAPSE_H && this.variant === 'character'
    if (this.collapsible) {
      this.el.style.maxHeight = `${COLLAPSE_H}px`
      this.el.style.overflow = 'hidden'
      this.el.style.userSelect = 'none'
      this.el.style.pointerEvents = 'none'
      if (!this.footerEl) {
        this.footerEl = document.createElement('div')
        this.footerEl.style.cssText =
          'margin-top:6px;padding-top:4px;border-top:1px solid rgba(255,255,255,0.12);' +
          'text-align:center;font-size:10px;opacity:0.65;pointer-events:none'
        this.el.appendChild(this.footerEl)
      }
      this.footerEl.textContent = '… 展开 ▾'
      this.footerEl.style.display = 'block'
    } else if (this.footerEl) {
      this.footerEl.style.display = 'none'
      this.el.style.maxHeight = 'none'
      this.el.style.overflow = ''
      this.el.style.userSelect = ''
      this.el.style.pointerEvents = 'none'
    }
  }

  /** 世界坐标锚点 → 屏幕像素（世界原点 = 屏幕中心，y 向上）。
   *  角色：气泡底沿悬在头顶上方 ~40px，尾巴向下指头；贴近屏幕顶时翻转尾巴挂到头下。
   *  用户：气泡在锚点侧上方，尾巴朝上。 */
  update(dt: number, anchorWorldX: number, anchorWorldY: number, charScale = 1): void {
    if (!this.visibleFlag) return
    this.updateHover()
    this.updateExpand(dt)
    this.showT += dt
    // 打字机：先吐字，吐完才开始计时消失
    if (this.revealed < this.fullText.length) {
      this.revealed = Math.min(this.fullText.length, this.revealed + Math.ceil(dt * TYPE_CPS))
      this.textEl.textContent = this.fullText.slice(0, this.revealed)
      this.timer = 0
    } else if (!this.hovered && !this.expanded) {
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
    // 工作区下界：避开任务栏
    const workBottom = window.innerHeight - TASKBAR_HEIGHT

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
    top = Math.max(8, Math.min(workBottom - h - 8, top))
    const x = Math.max(10, Math.min(window.innerWidth - w - 10, sx - w / 2))
    this.el.style.left = `${x}px`
    this.el.style.top = `${top}px`
    this.lastBox = { x, y: top, w, h }

    // 尾巴跟随锚点：盒子被边缘钳制后，尾巴滑向锚点一侧而不是指向空气
    const tailX = Math.max(14, Math.min(w - 14, sx - x))
    this.tailEl.style.left = `${tailX}px`

    if (remain <= 0 && this.revealed >= this.fullText.length) {
      this.visibleFlag = false
      this.el.style.display = 'none'
      if (this.expanded) this.expand(false)
      // 队列放出下一条（低优先级排队不打断的意义所在）
      const next = this.pending.shift()
      if (next) this.display(next.text, next.duration, next.variant, { stream: next.stream }, next.priority)
    }
  }

  /** 尾巴朝向切换（角色气泡贴顶时尾巴翻到上方） */
  private setTailTop(top: boolean): void {
    if (this.tailIsTop === top) return
    this.tailIsTop = top
    const tail = this.tailEl
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
