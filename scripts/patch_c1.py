# -*- coding: utf-8 -*-
"""审计修复批次 C：Animator/气泡/bridge/micro/SpatialController/main/intro"""
import io

def repl(path, old, new, count=1):
    t = io.open(path, encoding='utf-8', newline='').read()
    eol = '\r\n' if '\r\n' in t else '\n'
    o = old.replace('\n', eol)
    n = new.replace('\n', eol)
    c = t.count(o)
    assert c == count, path + ': x' + str(c) + ': ' + old[:70]
    io.open(path, 'w', encoding='utf-8', newline='').write(t.replace(o, n))
    print('OK', path, '|', old.strip().splitlines()[0][:48])

# ── Animator.ts ──
# 1) setPose 自动停 clip（poseOverride/手动姿态被 mixer 吞掉的根因）
repl('src/renderer/src/pet/anim/Animator.ts',
     """  /** 切换姿态（0.3-0.5s 混合） */
  setPose(name: string, duration = 0.4): void {
    const pose = POSES[name]
    if (!pose) return""",
     """  /** 切换姿态（0.3-0.5s 混合）；若 clip 正在播则先停，否则会被 mixer 每帧覆盖 */
  setPose(name: string, duration = 0.4): void {
    const pose = POSES[name]
    if (!pose) return
    if (this.clipMode) this.clipMgr?.stop(0.15)""")

# 2) playState clip 分支：同步姿态簿记（currentPoseName/toPose/快照），修自愈检查与随机去重
repl('src/renderer/src/pet/anim/Animator.ts',
     """    if (this.clipMgr?.playForState(state)) {
      // 关键：clip 只驱动骨骼不携带表情。若不重置表情，上一状态（如睡觉姿态）的
      // 闭眼表情会永久残留——这就是"眼睛睁不开"的根因。切 clip 时平滑到目标状态
      // 基础姿态的表情（睡觉=闭眼、其余=中性开眼），与旧 setPose 的行为对齐。
      const expr = { ...cloneExpression(NEUTRAL_EXPRESSION), ...POSES[poseName]?.expression }
      this.setPoseExpression(expr, 0.6)
      return
    }""",
     """    if (this.clipMgr?.playForState(state)) {
      // 关键：clip 只驱动骨骼不携带表情。若不重置表情，上一状态（如睡觉姿态）的
      // 闭眼表情会永久残留——这就是"眼睛睁不开"的根因。切 clip 时平滑到目标状态
      // 基础姿态的表情（睡觉=闭眼、其余=中性开眼），与旧 setPose 的行为对齐。
      const pose = POSES[poseName] ?? DEFAULT_POSE
      // 同步姿态簿记：退出 clip（eco/stop）时 Animator 从该基线混合，不做过期快照跳变
      this.currentPoseName = poseName
      this.toPose = pose
      this.fromPose = pose
      this.poseT = 1
      this.poseDur = 0.4
      this.hipsFrom = this.hipsTo = pose.hipsY ?? DEFAULT_HIPS_Y
      const expr = { ...cloneExpression(NEUTRAL_EXPRESSION), ...pose.expression }
      this.setPoseExpression(expr, 0.6)
      return
    }""")

# 3) clip 分支清空加性缓存（退出首帧毛刺）
repl('src/renderer/src/pet/anim/Animator.ts',
     """    // clip 模式：骨骼由 AnimationMixer 接管，这里只推进表情混合
    if (this.clipMode) {""",
     """    // clip 模式：骨骼由 AnimationMixer 接管，这里只推进表情混合
    if (this.clipMode) {
      this.additive.clear() // 防止退出 clip 首帧消费进 clip 前的陈旧偏移""")

# ── bubble.ts ──
# 4) show() 量宽：display:none 下 scrollWidth 恒 0 → worldWidth 恒 96 的 bug
repl('src/renderer/src/pet/fx/bubble.ts',
     """    // 内容变化后量宽（先临时放全文测宽）
    this.textEl.textContent = text
    this.contentW = Math.max(MIN_W, Math.min(MAX_W, this.el.scrollWidth + PAD_X * 2))
    this.textEl.textContent = this.fullText.slice(0, this.revealed)""",
     """    // 内容变化后量宽：先以隐藏可见性挂出 DOM（display:none 时 scrollWidth 恒 0）
    this.textEl.textContent = text
    const prevDisplay = this.el.style.display
    const prevVis = this.el.style.visibility
    this.el.style.visibility = 'hidden'
    this.el.style.display = 'block'
    this.contentW = Math.max(MIN_W, Math.min(MAX_W, this.el.scrollWidth + PAD_X * 2))
    this.el.style.display = prevDisplay
    this.el.style.visibility = prevVis
    this.textEl.textContent = this.fullText.slice(0, this.revealed)""")

# 5) 打字机结束帧闪烁：入场淡入与消失计时分离
repl('src/renderer/src/pet/fx/bubble.ts',
     """    this.visibleFlag = true
    this.timer = 0
    this.hovered = false""",
     """    this.visibleFlag = true
    this.timer = 0
    this.showT = 0
    this.hovered = false""")
repl('src/renderer/src/pet/fx/bubble.ts',
     """  private timer = 0
  private duration = 0""",
     """  private timer = 0
  private showT = 0 // 入场淡入独立计时（不被打字机清零）
  private duration = 0""")
repl('src/renderer/src/pet/fx/bubble.ts',
     """    this.updateHover()
    // 打字机：先吐字，吐完才开始计时消失
    if (this.revealed < this.fullText.length) {
      this.revealed = Math.min(this.fullText.length, this.revealed + Math.ceil(dt * TYPE_CPS))
      this.textEl.textContent = this.fullText.slice(0, this.revealed)
      this.timer = 0
    } else if (!this.hovered) {
      this.timer += dt
    }
    const fadeIn = Math.min(1, this.timer / 0.18)
    const remain = this.duration - this.timer
    const fadeOut = Math.min(1, Math.max(0, remain / 0.3))
    this.el.style.opacity = String(Math.min(1, fadeIn * fadeOut + (this.revealed < this.fullText.length ? 1 : 0)))""",
     """    this.updateHover()
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
    this.el.style.opacity = String(Math.min(1, fadeIn * fadeOut))""")

# 6) applyStyle 重置尾巴四属性 + tailIsTop 复位
repl('src/renderer/src/pet/fx/bubble.ts',
     """  private applyStyle(): void {
    const s = this.el.style
    const pal = PALETTE[this.variant]""",
     """  private tailIsTop = false

  private applyStyle(): void {
    const s = this.el.style
    const pal = PALETTE[this.variant]
    this.tailIsTop = false""")
repl('src/renderer/src/pet/fx/bubble.ts',
     """    const tail = this.el.querySelector('.pet-bubble-tail') as HTMLElement
    tail.style.position = 'absolute'
    tail.style.left = '50%'
    tail.style.width = '0'
    tail.style.height = '0'
    tail.style.transform = 'translateX(-50%)'
    if (this.variant === 'character') {
      tail.style.bottom = `-${TAIL}px`
      tail.style.borderLeft = '7px solid transparent'
      tail.style.borderRight = '7px solid transparent'
      tail.style.borderTop = `${TAIL}px solid ${pal.bg}`
    } else {
      tail.style.top = `-${TAIL}px`
      tail.style.borderLeft = '7px solid transparent'
      tail.style.borderRight = '7px solid transparent'
      tail.style.borderBottom = `${TAIL}px solid ${pal.bg}`
    }""",
     """    const tail = this.el.querySelector('.pet-bubble-tail') as HTMLElement
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
    }""")

# 7) hover 检测去 getBoundingClientRect（用自身缓存的定位盒，避免每帧强制布局）
repl('src/renderer/src/pet/fx/bubble.ts',
     """  private updateHover(): void {
    if (!this.visibleFlag || !this.mouse) {
      this.setHovered(false)
      return
    }
    const r = this.el.getBoundingClientRect()
    const inside =
      this.mouse.x >= r.left - 4 &&
      this.mouse.x <= r.right + 4 &&
      this.mouse.y >= r.top - 4 &&
      this.mouse.y <= r.bottom + 4
    this.setHovered(inside)
  }""",
     """  private lastBox = { x: 0, y: 0, w: 0, h: 0 }

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
  }""")
repl('src/renderer/src/pet/fx/bubble.ts',
     """    this.el.style.left = `${x}px`
    this.el.style.top = `${top}px`

    if (remain <= 0 && this.revealed >= this.fullText.length) {""",
     """    this.el.style.left = `${x}px`
    this.el.style.top = `${top}px`
    this.lastBox = { x, y: top, w, h }

    if (remain <= 0 && this.revealed >= this.fullText.length) {""")

# ── bridge.ts：PAD 不再覆盖 eyeOpen（睡觉闭眼被周期性睁开的根因） ──
repl('src/renderer/src/pet/bridge.ts',
     """    const e = cloneExpression(NEUTRAL_EXPRESSION)
    e.smile = 0.25 + pet.emotion.pleasure * 0.4
    e.blush = Math.max(0.1, 0.25 + pet.emotion.pleasure * 0.35)
    e.eyeWide = Math.max(0, pet.emotion.arousal) * 0.4
    e.eyeOpen = 1 + pet.emotion.arousal * 0.08
    e.browRaise = pet.emotion.dominance * 0.5""",
     """    const e = cloneExpression(NEUTRAL_EXPRESSION)
    e.smile = 0.25 + pet.emotion.pleasure * 0.4
    e.blush = Math.max(0.1, 0.25 + pet.emotion.pleasure * 0.35)
    e.eyeWide = Math.max(0, pet.emotion.arousal) * 0.4
    // 注意：不写 eyeOpen——PAD 情绪无权覆盖眼睑，否则睡觉/困倦姿态的闭眼会被周期性睁开
    e.browRaise = pet.emotion.dominance * 0.5""")

# ── microBehaviors.ts：深呼吸分支不再打断远眺 ──
repl('src/renderer/src/pet/anim/microBehaviors.ts',
     """    if (this.nextDeepBreath <= 0) {
      this.nextDeepBreath = 45 + Math.random() * 30
      this.distantGazeT = -1
      anim.expressionImpulse({ smile: 0.05 }, 1.2)
    }""",
     """    if (this.nextDeepBreath <= 0) {
      this.nextDeepBreath = 45 + Math.random() * 30
      // 不再打断进行中的远眺（原实现会把 3s 远眺包络拦腰截断）
      anim.expressionImpulse({ smile: 0.05 }, 1.2)
    }""")

print('batch C1 done')
