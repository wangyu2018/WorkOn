/**
 * 首次启动 CG（加载动画多帧方案 · VRM 实时渲染版，替代 AI 生图路径）
 * 分镜：1 粒子汇聚(0-1.2s) → 2 成型(1.2-2.2s) → 3 挥手问候(2.2-3.4s)
 *      → 4-6 能力展示 监控/计划/AI(3.4-6.4s) → 7 桌面伙伴(6.4-7.4s) → 8 就绪归位(7.4-8.6s)
 * 只播一次（settings.introPlayed），右下角可跳过；播完角色走回右下角进入常态。
 */
import type { Stage } from './scene/Stage'
import type { VrmCharacter } from './character/VrmCharacter'
import type { Animator } from './anim/Animator'
import type { MicroBehaviors } from './anim/microBehaviors'
import type { SpatialController } from './spatial/SpatialController'
import type { ParticleSystem } from './fx/particles'
import type { Bubble } from './fx/bubble'
import { TASKBAR_HEIGHT } from './spatial/stateTable'

interface IntroDeps {
  stage: Stage
  char: VrmCharacter
  anim: Animator
  micro: MicroBehaviors
  spatial: SpatialController
  particles: ParticleSystem
  bubble: Bubble
}

const CAPTIONS = [
  { icon: '⏱', title: '自动记录', desc: '按设置间隔采样前台窗口，自动分类工作状态；时长与类目为精确记录，细颗粒内容标记为估算' },
  { icon: '📅', title: '计划对照', desc: '计划虚线叠在时间轴上，达成率一眼看穿' },
  { icon: '🧠', title: 'AI 画像', desc: '习惯推导 + 效率分析 + 可以追问的问答' },
  { icon: '🐱', title: '桌面搭子', desc: '我常驻右下角陪你：点我、拖我、右键聊我' }
]

export async function playIntroCG(deps: IntroDeps): Promise<void> {
  const { stage, char, anim, micro, spatial, particles, bubble } = deps
  let skipped = false

  // ── DOM 覆盖层：左侧能力卡 + 顶部 logo + 底部进度条 + 跳过按钮 ──
  const overlay = document.createElement('div')
  overlay.id = 'intro'
  overlay.innerHTML = `
    <div class="intro-logo">
      <span class="intro-logo-dot"></span>WorkOn
      <div class="intro-tagline">你的桌面效率搭子</div>
    </div>
    <div class="intro-captions"></div>
    <div class="intro-progress"><div class="intro-progress-fill"></div></div>
    <button class="intro-skip">跳过 →</button>
  `
  document.body.appendChild(overlay)
  const capBox = overlay.querySelector('.intro-captions') as HTMLElement
  const progressFill = overlay.querySelector('.intro-progress-fill') as HTMLElement
  const skipBtn = overlay.querySelector('.intro-skip') as HTMLButtonElement
  skipBtn.addEventListener('click', () => {
    skipped = true
  })
  requestAnimationFrame(() => overlay.classList.add('on'))

  const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))
  const waitS = async (ms: number): Promise<void> => {
    const t0 = Date.now()
    while (Date.now() - t0 < ms && !skipped) await wait(50)
  }

  // ── 舞台布置：角色到右中部，放大出场 ──
  const W = window.innerWidth
  const H = window.innerHeight
  spatial.setPosition({ x: W * 0.62, y: H - TASKBAR_HEIGHT - 6 })
  spatial.setScale(1.15)
  char.setGlobalOpacity(0)
  particles.setDensity(1)

  // ── 自驱动渲染循环（主循环尚未注册，CG 期间独立驱动） ──
  let particleTimer = 0
  const drive = (dt: number): void => {
    spatial.update(dt)
    anim.update(dt)
    micro.update(dt)
    char.update(dt)
    const p = spatial.position
    const w = stage.screenToWorld(p.x, p.y)
    particleTimer -= dt
    if (particleTimer <= 0) {
      particleTimer = 0.28
      particles.burst(w.x + (Math.random() - 0.5) * 80, w.y + Math.random() * 140, 2, 0x67e8f9)
    }
    particles.update(dt, w.x, w.y, 1)
    if (bubble.visible) bubble.update(dt, w.x, w.y + char.topY * 1.15, 1.15)
  }
  stage.onFrame(drive)

  try {
    // 分镜 1-2：粒子汇聚 + 成型（0 → 2.2s）
    anim.setPose('stand_idle', 0.3)
    const t0 = Date.now()
    while (Date.now() - t0 < 2200 && !skipped) {
      const k = Math.min(1, (Date.now() - t0) / 1800)
      char.setGlobalOpacity(k)
      await wait(50)
    }
    char.setGlobalOpacity(1)

    // 分镜 3：挥手问候（2.2 → 3.4s）
    if (!skipped) {
      anim.setPose('stand_greet', 0.5)
      micro.triggerWave()
      bubble.show('你好呀，我是姵儿！', 2.4, 'character')
      await waitS(1200)
    }

    // 分镜 4-6：能力卡依次展示（3.4 → 6.4s）
    for (let i = 0; i < CAPTIONS.length && !skipped; i++) {
      const c = CAPTIONS[i]
      const el = document.createElement('div')
      el.className = 'intro-cap'
      el.innerHTML = `<span class="intro-cap-icon">${c.icon}</span><div><div class="intro-cap-title">${c.title}</div><div class="intro-cap-desc">${c.desc}</div></div>`
      capBox.appendChild(el)
      requestAnimationFrame(() => el.classList.add('on'))
      if (i === 1) bubble.show('这些我都会哦~', 1.6, 'character')
      await waitS(750)
    }

    // 分镜 7：桌面伙伴（6.4 → 7.4s）
    if (!skipped) {
      bubble.show('以后一起加油！', 2, 'character')
      overlay.classList.add('final')
      // 进度条充能
      progressFill.style.transition = 'width 900ms ease-out'
      progressFill.style.width = '100%'
      await waitS(1000)
    }

    // 分镜 8：归位（7.4 → 8.6s）：角色走回右下角，覆盖层淡出
    overlay.classList.add('bye')
    spatial.restore()
    await waitS(900)
  } finally {
    // 收尾：清理循环与 DOM，恢复常态
    stage.offFrame(drive)
    overlay.classList.remove('on')
    window.setTimeout(() => overlay.remove(), 400)
    char.setGlobalOpacity(1)
    // 标记已播放（下次启动不再播）
    try {
      void window.api?.setSettings?.({ introPlayed: true })
    } catch {
      /* preload 未就绪 */
    }
  }
}
