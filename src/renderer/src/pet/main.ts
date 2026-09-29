/**
 * 桌宠入口：组装 Stage / VRM 角色 / 空间控制 / 交互 / 特效 / 桥接
 */
import * as THREE from 'three'
import { PET_FEATURES } from './flags'
import { Stage } from './scene/Stage'
import { Lighting } from './scene/Lighting'
import { VrmCharacter } from './character/VrmCharacter'
import { Animator } from './anim/Animator'
import { AnimationManager } from './anim/AnimationManager'
import { MicroBehaviors } from './anim/microBehaviors'
import { SpatialController } from './spatial/SpatialController'
import { ParticleSystem } from './fx/particles'
import { WeatherSystem, autoWeatherForPhase } from './fx/weather'
import { Bubble } from './fx/bubble'
import { HitTest } from './interaction/hitTest'
import { DragPhysics } from './interaction/dragPhysics'
import { ClickFeedback } from './interaction/clickFeedback'
import { Bridge } from './bridge'
import { pickChatter, SCENE_MIN_INTERVAL, getActiveRole, type ChatterScene } from './character/chatter'
import type { SpatialStateName } from './spatial/stateTable'

/** 互动开关（桌搭页可配，关闭即注销对应行为降低开销） */
interface Interactions {
  click: boolean
  drag: boolean
  dragPhysics: boolean
  follow: boolean
  costume: boolean
  emotion: boolean
  chat: boolean
}

async function boot(): Promise<void> {
  // ── Phase 1：基础场景 + 光照（加载期窗口保持透明，模型就绪直接入场） ──
  const stage = new Stage()
  const lighting = new Lighting(stage.scene, null)
  lighting.attachRenderer(stage.renderer) // 昼夜系统需要调整 toneMappingExposure
  stage.start()
  console.warn(`[pet] boot: stage started ${stage.width}x${stage.height}`)

  // ── Phase 2：VRM 加载 ──
  // 从设置读取自定义 VRM 路径，无则用默认姵儿
  const s = (await window.api?.getSettings?.()) as { petVrmPath?: string } | undefined
  // 默认加载 Draco 压缩版（9.6MB vs 21.9MB），加载时间约减半
  const devMode = !!(s as unknown as { devMode?: boolean } | undefined)?.devMode
  const vrmPath = s?.petVrmPath || './vrm/peier-compressed.vrm'
  let char: VrmCharacter
  try {
    char = await VrmCharacter.load(vrmPath)
  } catch (err) {
    console.warn('[pet] VRM 加载失败，回退默认角色:', err)
    try {
      char = await VrmCharacter.load('./vrm/peier.vrm')
    } catch (err2) {
      console.error('[pet] 默认角色也加载失败:', err2)
      const errEl = document.createElement('div')
      errEl.style.cssText =
        'position:fixed;left:50%;top:45%;transform:translateX(-50%);color:#F87171;' +
        'font:14px "Microsoft YaHei",sans-serif;z-index:60;pointer-events:none'
      errEl.textContent = '角色加载失败，请重启应用'
      document.body.appendChild(errEl)
      return
    }
  }
  // 角色暂不入场：先装配姿态系统并收敛到站立姿态，再挂场景——
  // 否则挂载到首次姿态写入之间会以 VRM 原始 T-pose（抬手）亮相一闪

  // 清晰度：VRM 贴图各向异性过滤延迟到首帧之后（避免阻塞第一帧渲染）
  window.setTimeout(() => {
    char.root.traverse((o) => {
      const mesh = o as THREE.Mesh
      if (!mesh.isMesh) return
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
      for (const m of mats) {
        const mat = m as THREE.MeshToonMaterial
        if (mat.map) mat.map.anisotropy = stage.maxAnisotropy
      }
    })
  }, 0)

  // ── Phase 3：子系统组装（姿态先收敛，再挂场景入场） ──
  lighting.attachCharacterRoot(char.root)
  const anim = new Animator(char)
  anim.emotionEnabled = false // 与互动开关默认一致（settings 就绪后由 applyInteractions 覆盖）
  const animMgr = new AnimationManager(char, anim)
  // 姿态写完还不够：蒙皮骨骼要经 char.update 内的 vrm.update 才会同步。
  // 入场前先隐藏 → 写姿态 → 同步蒙皮 → 挂场景 → 揭幕，任何一帧都不会露出 T-pose。
  char.root.visible = false
  anim.update(0)
  stage.scene.add(char.root)
  char.attachLookTarget(stage.scene)
  char.update(0)
  char.root.visible = true
  anim.attachClipManager(animMgr)
  const micro = new MicroBehaviors(char, anim)
  const spatial = new SpatialController(char, anim, micro)
  if (!PET_FEATURES.roam) spatial.setRoamEnabled(false)
  const particles = new ParticleSystem(stage.scene)
  // 天气系统：根据时段自动选择天气效果
  const weather = new WeatherSystem(stage.scene, stage.width, stage.height)
  weather.setWeather(autoWeatherForPhase(lighting.getPhase()))
  // 单气泡实例：任何时刻最多一个气泡（角色/user 变体切换），物理上不可能重叠
  const bubble = new Bubble(stage.scene, 'character', {
    onModal: (open) => { try { window.api.petModal?.(open) } catch { /* ignore */ } }
  })

  // SpringBone：拆掉（关）= 直接静止在造型位，无沉降动画；开 = 预热 90 帧再亮相
  char.setSpringBones(PET_FEATURES.springBone)
  if (PET_FEATURES.springBone) {
    stage.scene.updateMatrixWorld(true)
    await new Promise<void>((resolve) => {
      let done = 0
      const step = (): void => {
        for (let i = 0; i < 15 && done < 90; i++, done++) char.update(1 / 60)
        if (done < 90) requestAnimationFrame(step)
        else resolve()
      }
      requestAnimationFrame(step)
    })
  }
  // shader 预编译：避免首帧/首次姿态变化时因编译着色器掉帧
  void stage.renderer.compileAsync(stage.scene, stage.camera).catch(() => stage.renderer.compile(stage.scene, stage.camera))

  // ── 首次启动 CG：只播一次（introPlayed），可跳过；播完角色归位进入常态 ──
  try {
    const s0 = (await window.api?.getSettings?.()) as { introPlayed?: boolean } | undefined
    if (PET_FEATURES.intro && !s0?.introPlayed) {
      const { playIntroCG } = await import('./intro')
      spatial.setRoamEnabled(false) // CG 期间游荡会拉起 clip 打断分镜
      await playIntroCG({ stage, char, anim, micro, spatial, particles, bubble, animMgr })
      // CG 后接 3 步气泡引导（小白上手：点我 / 右键聊我 / 拖我）
      const guideLines = ['嗨！以后我就住在这里啦～', '点我一下试试？会有惊喜哦', '右键我可以聊天，拖我可以去任何地方！']
      for (const line of guideLines) {
        bubble.show(line, 4, 'character')
        await new Promise((r) => setTimeout(r, 4500))
      }
    }
  } catch (e) {
    console.warn('[intro] CG 播放失败，直接进入常态', e)
  }

  // ── 命中检测 / 拖拽 / 点击反馈 ──
  const hit = new HitTest(stage.camera, char.root, char.hitProxy)
  const drag = new DragPhysics(char, anim, micro, spatial)
  drag.onCursor = (c) => hit.setCursorState(c)
  // 主进程状态桥接（点击回复语需要读亲密度）
  const bridge = new Bridge({ spatial, lighting, anim, animMgr, micro, particles, bubble: bubble })

  // 互动开关（默认：点击/拖拽/右键聊天开，物理/页面跟随/换装/表情关；游荡走 petRoam）
  const interactions: Interactions = { click: true, drag: true, dragPhysics: true, follow: false, costume: false, emotion: false, chat: true }
  const applyInteractions = (p: Partial<Interactions>): void => {
    Object.assign(interactions, p)
    anim.emotionEnabled = interactions.emotion
    drag.physicsEnabled = interactions.dragPhysics
  }

  // ── 闲置渲染优化：30s 无活动自动降 eco，有活动恢复原档位 ──
  let idleTimer = 0
  const IDLE_DROP = 30
  let idleDropped = false
  let preIdleTier: 'eco' | 'standard' | 'smooth' | 'ultra' = 'smooth'
    let deepIdleOn = false
    function noteActivity(): void {
    idleTimer = 0
    if (deepIdleOn) {
      deepIdleOn = false
      stage.setDeepIdle(false)
    }
    if (idleDropped) {
      idleDropped = false
      stage.setFpsTier(preIdleTier)
    }
  }
  function resetIdle(): void {
    noteActivity()
  }

  // 忙时轻档：整机卡顿时强制 eco（复用闲置降档的状态机，解除后回落原档）
  let loadEcoOn = false
  window.api?.onLoadEco?.((v: unknown) => {
    loadEcoOn = !!v
    if (loadEcoOn) {
      if (!idleDropped) {
        idleDropped = true
        preIdleTier = stage.fpsTier
        stage.setFpsTier('eco')
      }
    } else if (idleDropped) {
      idleTimer = 0
      idleDropped = false
      stage.setFpsTier(preIdleTier)
    }
  })

  // 拖拽/过渡期间临时升帧，结束回落（Stage 内来源计数，叠加安全）
  // 拖拽直接拉满 ultra：30fps 下角色 33ms 才跟一次手，体感"卡+粘连"
  drag.onFpsBoost = () => stage.boostFps('drag', 'ultra')
  drag.onFpsUnboost = () => stage.unboostFps('drag')
  spatial.onFpsBoost = () => stage.boostFps('transition', 'smooth')
  spatial.onFpsUnboost = () => stage.unboostFps('transition')
  // 游荡行走期间升帧（10/20fps 下走路像幻灯片），停步回落
  let roamBoosted = false
  const syncRoamBoost = (): void => {
    const moving = spatial.roamMoving
    if (moving && !roamBoosted) {
      roamBoosted = true
      stage.boostFps('roam', 'smooth')
    } else if (!moving && roamBoosted) {
      roamBoosted = false
      stage.unboostFps('roam')
    }
  }

  // 桌宠设置：启动拉取 + 实时同步（缩放 / 游荡开关 / 帧率档位 / 互动开关 / 位置记忆）；一键回位
  try {
    const s = (await window.api?.getSettings?.()) as
      | {
          petScale?: number
          petRoam?: boolean
          petFpsTier?: 'eco' | 'standard' | 'smooth' | 'ultra'
          petInteractions?: Partial<Interactions>
          petRememberPos?: boolean
          petReturnMin?: number
          petPosX?: number
          petPosY?: number
          petRotY?: number
        }
      | undefined
    spatial.setUserScale(s?.petScale ?? 1)
    spatial.setRoamEnabled(s?.petRoam ?? false)
    stage.setFpsTier(s?.petFpsTier ?? 'smooth')
    if (s?.petInteractions) applyInteractions(s.petInteractions)
    spatial.setReturnMin(s?.petReturnMin ?? 30)
    // 位置记忆：恢复上次拖拽放置的位置（须在任一屏内，防拔屏丢窗；保留期内不被状态切换搬走）
    const posOnScreen = (x: number, y: number): boolean =>
      window.innerWidth > 100 && x > -60 && y > -20 && x < window.innerWidth - 80 && y < window.innerHeight - 60
    if (s?.petRememberPos && (s.petPosX ?? -1) >= 0 && (s.petPosY ?? -1) >= 0 && posOnScreen(s.petPosX!, s.petPosY!)) {
      spatial.markUserPlaced({ x: s.petPosX!, y: s.petPosY! })
    }
    // 旋转角度记忆：用户 360° 转出的习惯朝向，重启恢复
    if (typeof s?.petRotY === 'number' && Number.isFinite(s.petRotY)) {
      spatial.setYaw(s.petRotY)
    }
  } catch {
    /* 设置未就绪时用默认 */
  }
  // 拖拽落地：持久化放置位置（重启后恢复）
  drag.onDrop = () => {
    const p = spatial.position
    void window.api?.setSettings?.({
      petPosX: Math.round(p.x),
      petPosY: Math.round(p.y),
      petRotY: +spatial.yaw.toFixed(3)
    })
  }
  // 骨架态帧率基线：全部动态功能关闭时强制 eco（静态场景 10fps 足够，120s 后仍会降至 1fps）
  const skeletonStatic =
    !PET_FEATURES.microLife && !PET_FEATURES.autoSpatial && !PET_FEATURES.roam &&
    !PET_FEATURES.drag && !PET_FEATURES.clips && !PET_FEATURES.particles && !PET_FEATURES.weather
  // 拖拽需要流畅跟手：骨架 eco 基线不适用于拖拽态（拖拽本身有 boostFps ultra 叠加）
  if (skeletonStatic) stage.setFpsTier('eco')

  window.api?.onPetSettings?.((s) => {
    const ps = s as { aiStreaming?: boolean } | undefined
    if (ps && ps.aiStreaming !== undefined) aiStreaming = ps.aiStreaming
    const p = s as { petScale?: number; petRoam?: boolean; petFpsTier?: 'eco' | 'standard' | 'smooth' | 'ultra'; petInteractions?: Partial<Interactions>; petReturnMin?: number }
    if (p.petScale !== undefined) spatial.setUserScale(p.petScale)
    if (p.petRoam !== undefined) spatial.setRoamEnabled(p.petRoam)
    if (p.petFpsTier !== undefined) stage.setFpsTier(p.petFpsTier)
    if (p.petInteractions) applyInteractions(p.petInteractions)
    if (p.petReturnMin !== undefined) spatial.setReturnMin(p.petReturnMin)
  })
  // 帧率档位副作用：eco/standard 关粒子，eco 降微行为
  stage.onFpsTier((t) => {
    const d = t === 'eco' || t === 'standard' ? 0 : 1
    particles.setDensity(d)
    weather.setDensity(d)
    micro.ecoMode = t === 'eco'
    animMgr.setEco(t === 'eco') // 10fps 播动画像幻灯片 → eco 回落静态姿态
  })
  // 自定义动作库：启动时加载已解锁动作（工坊产出）
  void (async () => {
    try {
      const metas = (await window.api?.motionsList?.()) ?? []
      for (const m of metas) {
        if (!m.owned && m.cost > 0) continue
        const data = await window.api?.motionsData?.(m.id)
        if (data) animMgr.registerMotionFromData(m.id, data as never)
      }
      if (metas.length) console.info(`[pet] 自定义动作已加载 ${metas.length} 个`)
    } catch { /* 动作库加载失败不阻塞 */ }
  })()
  window.api?.onPetPlayMotion?.((p) => {
    const id = (p as { id: string }).id
    animMgr.playClip(id, { loop: false, restart: true })
    noteActivity()
  })
  window.api?.onPetRestore?.(() => spatial.restore())
  // 重播启动 CG（桌搭页入口）
  window.api?.onPetIntroReplay?.(() => {
    void (async () => {
      const { playIntroCG } = await import('./intro')
      await playIntroCG({ stage, char, anim, micro, spatial, particles, bubble, animMgr })
    })()
  })
  window.api?.onPageSwitch?.(() => {
    if (interactions.follow) spatial.notePageSwitch(2000)
  })
  // 桌搭「对桌宠说点什么」→ 用户气泡（侧下）
  const clickFx = new ClickFeedback(
    anim,
    micro,
    particles,
    bubble,
    () => {
      const p = spatial.position
      return stage.screenToWorld(p.x, p.y)
    },
    () => spatial.current === 'slack',
    () => ({ state: spatial.current, intimacy: bridge.intimacy })
  )

  let hoverPart: string | null = null
  let pressedOnChar = false
  let downPos = { x: 0, y: 0 }
  let downAt = 0
  /** 首次拖拽提示（每次启动只提示一次） */
  let dragTipped = false
  if (PET_FEATURES.drag) {
    hit.onFrame((r) => {
      hoverPart = r.hit ? r.part : null
    })
  }

  window.addEventListener('mousemove', (e) => {
    hit.setMouse(e.clientX, e.clientY)
    spatial.setMouse(e.clientX, e.clientY)
    if (PET_FEATURES.microLife) {
      micro.setGazeTarget(
        (e.clientX / window.innerWidth) * 2 - 1,
        -((e.clientY / window.innerHeight) * 2 - 1)
      )
    }
    // 按下后移动超阈值才进入拖拽（避免点击被当成微抛掷；拖拽开关关闭则不抓起）
    if (pressedOnChar && !drag.active && interactions.drag) {
      const moved = Math.hypot(e.clientX - downPos.x, e.clientY - downPos.y)
      if (moved > 8) {
        resetIdle()
        hit.setDragging(true)
        drag.grab(downPos.x, downPos.y)
        if (!dragTipped) {
          dragTipped = true
          bubble.show('拖我去喜欢的地方吧，放稳了我就不乱跑~', 3.5, 'character')
        }
      }
    }
    if (drag.active) drag.move(e.clientX, e.clientY)
  })

  window.addEventListener('mousedown', (e) => {
    // 快捷操作栏按钮：窗口级命中检测（绕过 canvas 的 pointer-event 问题）
    if (actions.style.display === 'flex') {
      const actRect = actions.getBoundingClientRect()
      if (e.clientX >= actRect.left && e.clientX <= actRect.right &&
          e.clientY >= actRect.top && e.clientY <= actRect.bottom) {
        const btn = (e.target as HTMLElement).closest('button') as HTMLElement | null
        if (btn) {
          e.preventDefault()
          const action = btn.dataset.action
          if (action === 'dock') {
            spatial.dock()
            bubble.show('收好啦，托盘唤我~', 2, 'character')
            window.setTimeout(() => window.api?.petHide?.(), 950)
          } else if (action === 'undock') {
            spatial.undock()
            bubble.show('来啦！', 2.5, 'character')
          } else if (action === 'pose') {
            anim.stopClip()
            const currentPose = anim.currentPoseName
            const others = CLICK_POSES.filter((p) => p !== currentPose)
            const pick = others[Math.floor(Math.random() * others.length)]
            anim.setPose(pick, 0.5)
            const names: Record<string, string> = { stand_idle: '站好', stand_greet: '打招呼', stand_relaxed: '放松', stand_tired: '疲惫', stand_serious: '严肃' }
            bubble.show(names[pick] ?? pick, 2, 'character')
          } else if (action === 'state') {
            const pick = CLICK_STATES[Math.floor(Math.random() * CLICK_STATES.length)]
            spatial.transitionTo(pick)
            bubble.show(STATE_LABELS[pick] ?? pick, 2.5, 'character')
          } else if (action === 'dnd') {
            // 免打扰 1 小时（关怀调度静默，工作提醒不受影响）
            void window.api?.getSettings?.().then((s) => {
              void window.api?.setSettings?.({ ...(s ?? {}), petDndUntilTs: Date.now() + 3600_000 })
      refreshDnd()
            })
            bubble.show('好，1 小时后见～', 2.5, 'character')
          }
          spatial.noteInteraction()
          resetIdle()
          hideSaybox()
          return
        }
      }
    }
    if (!hoverPart) return
    spatial.noteInteraction()
    pressedOnChar = true
    downPos = { x: e.clientX, y: e.clientY }
    downAt = performance.now()
  })

  window.addEventListener('mouseup', (e) => {
    if (!pressedOnChar) return
    pressedOnChar = false
    if (drag.active) {
      hit.setDragging(false)
      drag.release()
      return
    }
    const quick =
      performance.now() - downAt < 400 &&
      Math.hypot(e.clientX - downPos.x, e.clientY - downPos.y) <= 8
    if (quick && hoverPart && interactions.click) {
      resetIdle()
      clickFx.click(hoverPart)
    }
  })

  window.addEventListener('resize', () => {
    spatial.setScreenSize(window.innerWidth, window.innerHeight)
    weather.resize(window.innerWidth, window.innerHeight)
  })

  // ── 主动说话：场景感知（深度专注不打扰，提醒按频率矩阵） ──
  const chatterLast: Partial<Record<ChatterScene, number>> = {}
  const chatterRecent: string[] = []
  const chatterDayFlags = new Set<string>()
  let chatterNext = 30 // 首检 30s
  /** 会议模式：quiet 抑制全部冒泡；assist 每 15min 报时 */
  let meetingQuiet = false
  let meetingAssistSince = 0
  let meetingNoticeLast = 0
  /** 免打扰截止（DND）：chatter 与会议辅助一起静音 */
  let dndUntil = 0
  const refreshDnd = (): void => {
    void window.api?.getSettings?.().then((s) => {
      dndUntil = (s as { petDndUntilTs?: number } | undefined)?.petDndUntilTs ?? 0
    }).catch(() => undefined)
  }
  refreshDnd()
  window.api?.onPetMeeting?.((p) => {
    const payload = p as { mode: string; active: boolean }
    meetingQuiet = payload.active && payload.mode === 'quiet'
    meetingAssistSince = payload.active && payload.mode === 'assist' ? Date.now() : 0
  })
  const detectScene = (): ChatterScene | null => {
    const p = bridge.presence
    if (!p) return null
    const now = Date.now()
    const hour = new Date().getHours()
    const dayKey = new Date().toDateString()
    const onceADay = (key: string): boolean => {
      const k = `${dayKey}:${key}`
      if (chatterDayFlags.has(k)) return false
      chatterDayFlags.add(k)
      return true
    }
    // 高优先级场景
    if (hour >= 11 && hour < 13 && onceADay('lunch')) return 'lunch'
    if (hour === 18 && onceADay('offwork')) return 'offwork'
    if (hour >= 22) {
      if (now - (chatterLast.lateNight ?? 0) >= SCENE_MIN_INTERVAL.lateNight) return 'lateNight'
    }
    const energy = bridge.petEnergy
    if (energy < 0.3 && now - (chatterLast.overworked ?? 0) >= SCENE_MIN_INTERVAL.overworked) return 'overworked'
    if ((p.continuousFocusSec ?? 0) > 3600 && now - (chatterLast.standup ?? 0) >= SCENE_MIN_INTERVAL.standup) return 'standup'
    // 深度专注不打扰
    if ((p.focusLevel ?? 0) > 85 && (p.continuousFocusSec ?? 0) > 600) return null
    // 状态场景
    if (p.state === 'slack' && now - (chatterLast.slack ?? 0) >= SCENE_MIN_INTERVAL.slack) return 'slack'
    if ((p.state === 'meeting' || p.state === 'remote') && now - (chatterLast.meeting ?? 0) >= SCENE_MIN_INTERVAL.meeting) return 'meeting'
    if (['focus', 'coding', 'aidev', 'writing', 'aiqa'].includes(p.state) && now - (chatterLast.focus ?? 0) >= SCENE_MIN_INTERVAL.focus) return 'focus'
    if (now - (chatterLast.general ?? 0) >= SCENE_MIN_INTERVAL.general) return 'general'
    return null
  }
  stage.onFrame((dt) => {
    if (!PET_FEATURES.chatter) return
    chatterNext -= dt
    if (chatterNext > 0) return
    chatterNext = 20 // 每 20s 评估一次
    if (bubble.visible || drag.active || spatial.docked) return
    // 会议模式：免打扰静默；DND 全静音（此前只管 care 不管闲聊——半接线的坑）
    if (meetingQuiet) return
    if (Date.now() < dndUntil) return
    if (meetingAssistSince && Date.now() - meetingNoticeLast > 900_000) {
      meetingNoticeLast = Date.now()
      bubble.show(`会议已进行 ${Math.round((Date.now() - meetingAssistSince) / 60000)} 分钟，加油~`, undefined, 'character', { priority: 'care' })
      return
    }
    const scene = detectScene()
    if (!scene) return
    chatterLast[scene] = Date.now()
    const line = pickChatter(scene, chatterRecent, getActiveRole())
    chatterRecent.push(line)
    if (chatterRecent.length > 10) chatterRecent.shift()
    bubble.show(line, undefined, 'character', { priority: 'chatter' })
  })

  // ── 真流式问答（aiStreaming 开启时走 petAskStream，chunk 逐字喂气泡） ──
  let aiStreaming = !!(await window.api?.getSettings?.())?.aiStreaming
  let streamSeq = 0
  let streamSeqSeen = 0
  /** 情绪/动作标签解析：[emotion:x] [action:y] → 表情脉冲 + one-shot clip；返回清理后的回答 */
  const applyReplyTags = (raw: string): string => {
    let answer = raw
    const emo = answer.match(/\[emotion:([a-z_]+)\]/i)
    const act = answer.match(/\[action:([a-z_]+)\]/i)
    answer = answer.replace(/\s*\[(emotion|action):[a-z_]+\]/gi, '').trim()
    if (emo) {
      const map: Record<string, Partial<Parameters<typeof anim.expressionImpulse>[0]>> = {
        happy: { smile: 0.45 }, sad: { frown: 0.4 }, angry: { browRaise: -0.4, squint: 0.3 },
        surprised: { eyeWide: 0.6, mouthOpen: 0.35 }, sleepy: { squint: 0.45, eyeOpen: -0.2 },
        shy: { blush: 0.5, smile: 0.2 }
      }
      const imp = map[emo[1].toLowerCase()]
      if (imp) anim.expressionImpulse(imp, 1.6)
    }
    if (act && PET_FEATURES.aiActionClips) {
      const ok = animMgr.playClip(act[1].toLowerCase(), { loop: false })
      if (!ok) console.warn('[pet] 回复动作 id 未注册:', act[1])
    }
    return answer
  }
  window.api.onAIStreamChunk?.((payload: unknown) => {
    const d = payload as { full?: string } | undefined
    if (!d || streamSeqSeen !== streamSeq) return
    bubble.streamChunk(String(d.full ?? ''))
  })
  window.api.onAIStreamReset?.((payload: unknown) => {
    if (streamSeqSeen !== streamSeq) return
    void payload
    bubble.streamReset()
  })
  window.api.onAIStreamDone?.((answer: unknown) => {
    if (streamSeqSeen !== streamSeq) return
    streamSeqSeen++
    const cleaned = applyReplyTags(String(answer ?? ''))
    bubble.finishStream(cleaned || '…')
    anim.expressionImpulse({ smile: 0.3 }, 1)
  })
  window.api.onAIStreamError?.(() => {
    if (streamSeqSeen !== streamSeq) return
    streamSeqSeen++
    bubble.show('出了一点小问题，晚点再聊吧~', 4, 'character', { priority: 'ai' })
  })

  // ── 右键「对桌宠说点什么」：玻璃面板（精简输入行） ──
  const saybox = document.createElement('div')
  saybox.id = 'saybox'
  saybox.innerHTML = `
    <span class="say-icon">💬</span>
    <input maxlength="40" placeholder="对她说点什么…" />
    <span class="say-hint">⏎</span>
  `
  const sayInput = saybox.querySelector('input')!
  document.body.appendChild(saybox)

  // ── 快捷操作栏（独立面板，浮在输入框下方） ──
  const actions = document.createElement('div')
  actions.id = 'say-actions'
  actions.innerHTML = `
    <button data-action="dock">🏠 回到收纳栏</button>
    <button data-action="pose">🎭 换个动作</button>
    <button data-action="state">🎲 随机状态</button>
  `
  document.body.appendChild(actions)

  // ── 桌面控制栏：悬停角色时浮现，聚合常用操作（青瓷风格） ──
  const ctlBar = document.createElement('div')
  ctlBar.id = 'pet-ctl-bar'
  ctlBar.innerHTML = `
    <button data-ctl="chat" title="和姵儿聊天">💬</button>
    <button data-ctl="dock" title="收到任务栏，托盘唤回">🏠</button>
    <button data-ctl="spin" title="转一圈看看">🔄</button>
    <button data-ctl="lie" title="趴在任务栏上，只露头">😪</button>
    <button data-ctl="hide" title="先藏起来">👁️</button>
    <button data-ctl="settings" title="桌搭设置">⚙️</button>
  `
  document.body.appendChild(ctlBar)

  let ctlBarVisible = false
  const showCtlBar = (): void => {
    if (ctlBarVisible) return
    ctlBarVisible = true
    const p = spatial.position
    const scale = spatial.currentScale
    const barW = ctlBar.offsetWidth || 220
    const x = Math.max(8, Math.min(window.innerWidth - barW - 8, p.x - barW / 2))
    const y = Math.min(window.innerHeight - 44, p.y + 8)
    ctlBar.style.left = `${x}px`
    ctlBar.style.top = `${y}px`
    ctlBar.style.display = 'flex'
    requestAnimationFrame(() => ctlBar.classList.add('open'))
  }
  const hideCtlBar = (): void => {
    ctlBarVisible = false
    ctlBar.classList.remove('open')
    window.setTimeout(() => { if (!ctlBarVisible) ctlBar.style.display = 'none' }, 200)
  }

  ctlBar.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest('[data-ctl]') as HTMLElement | null
    if (!btn) return
    const action = btn.dataset.ctl
    spatial.noteInteraction()
    resetIdle()
    if (action === 'chat' && PET_FEATURES.chat) {
      // 打开右键聊天输入框
      const evt = new MouseEvent('contextmenu', { clientX: spatial.position.x, clientY: spatial.position.y - 120 })
      window.dispatchEvent(evt)
    } else if (action === 'dock') {
      spatial.dock()
      bubble.show('收好啦，托盘唤我~', 2, 'character')
      window.setTimeout(() => window.api?.petHide?.(), 950)
    } else if (action === 'spin') {
      // 原地转一圈（1.6rad/s × 4s ≈ 一整圈）
      const dur = 4
      let elapsed = 0
      const spinStep = (dt: number): void => {
        elapsed += dt
        spatial.rotateBy(1.6 * dt)
        if (elapsed < dur) stage.onFrame(spinStep)
      }
      stage.onFrame(spinStep)
    } else if (action === 'lie') {
      // 趴任务栏：切到 sleeping 空间态（peek 锚点=脚底沉入屏幕下方，露头+肩），
      // 睡姿 + 闭眼，不打扰也不失踪；点角色唤醒
      spatial.transitionTo('sleeping')
      bubble.show('我先趴一会儿…', 2.5, 'character')
      resetIdle()
    } else if (action === 'hide') {
      bubble.show('先藏起来，托盘唤我~', 2, 'character')
      window.setTimeout(() => window.api?.petHide?.(), 800)
    } else if (action === 'settings') {
      openMain()
    }
    hideCtlBar()
  })

  const openMain = (): void => {
    window.api?.openMain?.()
    // 主窗打开后切到桌搭视图
    setTimeout(() => { try { window.api?.setSettings?.({} as never) } catch { /* ignore */ } }, 800)
  }

  const hideSaybox = (): void => {
    saybox.classList.remove('open')
    actions.classList.remove('open')
    window.api?.petModal?.(false)
    window.setTimeout(() => {
      saybox.style.display = 'none'
      actions.style.display = 'none'
    }, 300)
  }
  /** AI 思考守卫：思考期间禁止新输入 */
  let thinking = false
  window.addEventListener('contextmenu', (e) => {
    if (!PET_FEATURES.chat) { e.preventDefault(); return }
    e.preventDefault()
    if (!interactions.chat) return
    spatial.noteInteraction()
    resetIdle()
    const p = spatial.position
    const scale = spatial.currentScale
    // 输入框与角色气泡平行（同一水平线），放在屏幕较空的一侧：
    // 角色偏右 → 输入框在左；偏左 → 在右；居中无所谓（默认右侧）
    const w = saybox.offsetWidth || 230
    const sayH = saybox.offsetHeight || 40
    // 避让半宽：气泡可见时按气泡宽度（可能比身体宽），否则按角色身体近似半宽
    const clearHalf = bubble.visible
      ? Math.max(bubble.worldWidth / 2, char.height * 0.3 * scale)
      : char.height * 0.3 * scale
    const gap = 14
    const placeLeft = p.x > window.innerWidth / 2
    let x = placeLeft ? p.x - clearHalf - gap - w : p.x + clearHalf + gap
    x = Math.max(12, Math.min(window.innerWidth - w - 12, x))
    // 垂直：与气泡中心对齐（气泡锚点在头顶上方 ~46px 处）；无气泡时同一高度
    const centerY = p.y - char.topY * scale - 46 * scale
    const y = Math.max(12, Math.min(window.innerHeight - sayH - 12, centerY - sayH / 2))
    saybox.style.left = `${x}px`
    saybox.style.top = `${y}px`
    saybox.style.display = 'flex'
    // 操作栏：收纳态显示唤出，否则显示收纳
    actions.innerHTML = spatial.docked
      ? '<button data-action="undock">🔓 唤出</button><button data-action="pose">🎭 换个动作</button><button data-action="dnd">🔕 免打扰 1h</button>'
      : '<button data-action="dock">🏠 回到收纳栏</button><button data-action="pose">🎭 换个动作</button><button data-action="dnd">🔕 免打扰 1h</button>'
    actions.style.left = `${x}px`
    actions.style.top = `${y + sayH + 4}px`
    actions.style.display = 'flex'
    requestAnimationFrame(() => {
      saybox.classList.add('open')
      actions.classList.add('open')
    })
    sayInput.value = ''
    window.api?.petModal?.(true)
    // 打开对话 → 打招呼意图（挥手）
    void window.api?.setPet?.({ intent: 'chat_open', intentAt: Date.now() })
    window.setTimeout(() => sayInput.focus(), 60)
  })
  sayInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const m = sayInput.value.trim()
      hideSaybox()
      if (!m || thinking) return
      spatial.noteInteraction()
      // 单气泡：先显示用户气泡（user 变体，侧下），AI 思考/回答覆盖到同一气泡
      bubble.show(m, 3.5, 'user')
      thinking = true
      sayInput.disabled = true
      void (async () => {
        try {
          const s = (await window.api?.getSettings?.()) as { aiEnabled?: boolean; aiApiKey?: string } | undefined
          if (!s?.aiEnabled || !s.aiApiKey) {
            bubble.show('还没配置 AI 模型哦~ 去设置里看看吧！', 5, 'character')
            return
          }
          // 微表情 + 占位气泡（合并到同一个气泡，不闪跳）
          anim.expressionImpulse({ browRaise: 0.25, squint: 0.12 }, 1.2)
          bubble.show('嗯…让我想想…', 8, 'character')
          if (aiStreaming) {
            // 真流式：chunk 事件驱动气泡逐字；Done 里做标签解析与定格
            streamSeq++
            await window.api.petAskStream(m)
          } else {
            let answer = (await window.api.petAsk(m)) as string
            answer = applyReplyTags(answer)
            // 打字机流式显现（LLM 一次性返回时也有逐字说话感）
            bubble.show(answer || '…', undefined, 'character', { stream: true, priority: 'ai' })
            anim.expressionImpulse({ smile: 0.3 }, 1)
          }
        } catch {
          bubble.show('出了一点小问题，晚点再聊吧~', 4, 'character')
        } finally {
          thinking = false
          sayInput.disabled = false
        }
      })()
    } else if (e.key === 'Escape') {
      hideSaybox()
    }
  })
  sayInput.addEventListener('blur', () => {
    if (saybox.classList.contains('open') && !saybox.matches(':hover')) hideSaybox()
  })

  // ── 快捷操作按钮 ──
  const CLICK_POSES = ['stand_idle', 'stand_greet', 'stand_relaxed', 'stand_tired', 'stand_serious'] as const
  const CLICK_STATES: SpatialStateName[] = ['working', 'coding', 'writing', 'aiqa', 'aidev', 'slack', 'meeting', 'pomodoro_break', 'global_chat']
  const STATE_LABELS: Record<string, string> = { working: '工作中', coding: '写代码', writing: '写作', aiqa: 'AI 问答', aidev: 'AI 开发', slack: '摸鱼中', meeting: '会议中', pomodoro_break: '番茄休息', global_chat: '群聊模式' }

  // ── 情境确认面板（虚拟角色独立问答：轻问诊 / 浏览器确认 / 会议检测）──
  const qconfirm = document.createElement('div')
  qconfirm.id = 'qconfirm'
  qconfirm.innerHTML = `
    <div class="qc-title"><span class="qc-icon"></span><span class="qc-label"></span></div>
    <div class="qc-body"></div>
    <div class="qc-actions">
      <button class="qc-btn qc-yes">确认</button>
      <button class="qc-btn qc-no">不是</button>
    </div>
    <button class="qc-close">✕</button>
  `
  document.body.appendChild(qconfirm)
  const qcTitleIcon = qconfirm.querySelector('.qc-icon') as HTMLElement
  const qcTitleLabel = qconfirm.querySelector('.qc-label') as HTMLElement
  const qcBody = qconfirm.querySelector('.qc-body') as HTMLElement
  const qcYes = qconfirm.querySelector('.qc-yes') as HTMLElement
  const qcNo = qconfirm.querySelector('.qc-no') as HTMLElement
  const qcClose = qconfirm.querySelector('.qc-close') as HTMLElement

  let qcState: { type: 'question' | 'browser-plan' | 'meeting'; data: unknown } | null = null
  let lastAnsweredQid: string | null = null

  const hideQConfirm = (): void => {
    qconfirm.classList.remove('open')
    window.api?.petModal?.(false)
    window.setTimeout(() => { qconfirm.style.display = 'none'; qcState = null }, 200)
  }

  qcClose.addEventListener('click', hideQConfirm)

  const showQConfirm = (pos: { x: number; y: number }, scale: number): void => {
    const w = qconfirm.offsetWidth || 260
    // 放在角色右侧偏上；确保不超出屏幕
    let x = pos.x + 80 * scale + 20
    if (x + w > window.innerWidth - 12) x = pos.x - 100 * scale - w
    const y = Math.max(12, pos.y - 160 * scale)
    qconfirm.style.left = `${x}px`
    qconfirm.style.top = `${y}px`
    qconfirm.style.display = 'block'
    window.api?.petModal?.(true)
    requestAnimationFrame(() => qconfirm.classList.add('open'))
  }

  // 轻问诊（去重 + null 自动关闭）；排障模式：chat 拆除时同步关闭
  window.api?.onQuestion?.((q) => {
    if (!PET_FEATURES.chat) return
    if (!q) { hideQConfirm(); return }
    const p = q as { question: string; id: string; ctx: string }
    if (p.id === lastAnsweredQid) return
    qcState = { type: 'question', data: p }
    qcTitleIcon.textContent = '💡'
    qcTitleLabel.textContent = '姵儿有个小问题'
    qcBody.textContent = p.question
    qcYes.textContent = '确认'
    qcNo.textContent = '否定'
    const pos = spatial.position
    const scale = spatial.currentScale
    showQConfirm(pos, scale)
    resetIdle()
    bubble.show('嗯…你觉得呢？', 4, 'character')
  })

  qcYes.addEventListener('click', () => {
    if (!qcState) return
    if (qcState.type === 'question') {
      const q = qcState.data as { id: string; ctx: string; question: string }
      lastAnsweredQid = q.id
      void window.api?.confirmQuestion?.({ qid: q.id, ctx: q.ctx, question: q.question, answer: 'yes' })
      bubble.show('好~ 知道了！', 3, 'character')
    } else if (qcState.type === 'browser-plan') {
      const bp = qcState.data as { planId: string }
      void window.api?.confirmBrowserPlan?.(bp.planId, 'yes')
      bubble.show('好的，已记录！', 3, 'character')
    } else if (qcState.type === 'meeting') {
      const md = qcState.data as { mode: 'stealth' | 'quiet' | 'assist' }
      void window.api?.meetingApply?.({ mode: md.mode, active: true })
      bubble.show('收到，切换会议模式~', 3, 'character')
    }
    hideQConfirm()
  })

  qcNo.addEventListener('click', () => {
    if (!qcState) return
    if (qcState.type === 'question') {
      const q = qcState.data as { id: string; ctx: string; question: string }
      lastAnsweredQid = q.id
      void window.api?.confirmQuestion?.({ qid: q.id, ctx: q.ctx, question: q.question, answer: 'no' })
    } else if (qcState.type === 'browser-plan') {
      const bp = qcState.data as { planId: string }
      void window.api?.confirmBrowserPlan?.(bp.planId, 'no')
    }
    bubble.show('好吧~', 2, 'character')
    hideQConfirm()
  })

  // 浏览器计划确认
  window.api?.onBrowserPlanConfirm?.((p) => {
    const bp = p as { planId: string; planTitle: string; keyword: string; browserTitle: string; app: string }
    qcState = { type: 'browser-plan', data: bp }
    qcTitleIcon.textContent = '🌐'
    qcTitleLabel.textContent = '浏览器检测'
    qcBody.textContent = `检测到你在浏览与计划【${bp.planTitle}】相关的内容，你在做这项计划吗？`
    qcYes.textContent = '是，在做'
    qcNo.textContent = '不是'
    const pos = spatial.position
    const scale = spatial.currentScale
    showQConfirm(pos, scale)
    resetIdle()
  })

  // 会议检测
  window.api?.onMeetingDetected?.((p) => {
    const md = p as { app: string; title: string }
    // 拉取设置看是否 ask 模式才弹
    void window.api?.getSettings?.().then((s) => {
      if ((s as { meetingMode?: string }).meetingMode !== 'ask') return
      qcState = { type: 'meeting', data: { app: md.app, title: md.title, mode: 'stealth' } }
      qcTitleIcon.textContent = '👥'
      qcTitleLabel.textContent = '会议检测'
      qcBody.textContent = `检测到你正在使用 ${md.app.replace(/\.exe$/i, '')} 开会，启用隐身模式？`
      qcYes.textContent = '🤫 隐身'
      qcNo.textContent = '忽略'
      const pos = spatial.position
      const scale = spatial.currentScale
      showQConfirm(pos, scale)
      resetIdle()
    })
  })

  // 性能降级/恢复联动：降级 pixelRatio→1 + 粒子减半 + 关轮廓光；恢复全部回满
  stage.onDegrade(() => {
    particles.setDensity(0.5)
    weather.setDensity(0)
    lighting.setDegraded()
  })
  stage.onRecover(() => {
    const t = stage.fpsTier
    const d = t === 'eco' || t === 'standard' ? 0 : 1
    particles.setDensity(d)
    weather.setDensity(d)
    lighting.setRecovered()
  })

  // ── 主循环 ──
  let lastPhase = lighting.getPhase()
  let phaseWeatherTimer = 0
  stage.onFrame((dt) => {

    spatial.update(dt) // 位置/姿态写入 3D 场景的唯一通道；自动迁移/漫游已在上游关死
    if (PET_FEATURES.drag) {
      drag.update(dt)
      clickFx.update(dt)
    }
    // 闲置减负：静止（无拖拽/无过渡/无气泡）时 Animator 走收敛快路径（内部判定）
    anim.update(dt)
    if (PET_FEATURES.clips) animMgr.update(dt)
    if (PET_FEATURES.microLife) micro.update(dt)
    char.update(dt)
    if (PET_FEATURES.dayNight) lighting.update(dt)
    if (PET_FEATURES.weather) weather.update(dt)

    // 时段变化时自动切换天气（每 60s 检查一次）
    phaseWeatherTimer += dt
    if (PET_FEATURES.weather && phaseWeatherTimer >= 60) {
      phaseWeatherTimer = 0
      const curPhase = lighting.getPhase()
      if (curPhase !== lastPhase) {
        lastPhase = curPhase
        weather.setWeather(autoWeatherForPhase(curPhase))
      }
    }

    const busy = drag.active || spatial.transitionActive || bubble.visible || spatial.roamMoving
    syncRoamBoost()
    if (busy) {
      noteActivity()
    } else {
      idleTimer += dt
      if (idleTimer > IDLE_DROP && !idleDropped && stage.fpsTier !== 'eco') {
        idleDropped = true
        preIdleTier = stage.fpsTier
        stage.setFpsTier('eco')
      }
      // 深度闲置：120s 零交互 → 1fps（透明置顶窗常驻渲染是持续 GPU/CPU 消耗）
      if (idleTimer > 120 && !deepIdleOn) {
        deepIdleOn = true
        stage.setDeepIdle(true)
      }
    }

    const p = spatial.position
    const w = stage.screenToWorld(p.x, p.y)
    const scale = spatial.currentScale // 含用户缩放：气泡锚点与偏移都正确
    if (PET_FEATURES.particles) particles.update(dt, w.x, w.y, spatial.stateScale) // 粒子密度不受用户缩放影响
    // 单气泡：按当前变体选锚点（character=头顶，user=侧下让位），任何时刻只有一个气泡
    if (bubble.visible) {
      if (bubble.currentVariant === 'user') {
        const side = p.x > stage.width / 2 ? -1 : 1
        const clearance = 62 * scale + bubble.worldWidth / 2 + 14
        bubble.update(dt, w.x + side * clearance, w.y + char.topY * scale * 0.45, scale)
      } else {
        bubble.update(dt, w.x, w.y + char.topY * scale, scale)
      }
      // P3 气泡可见期间交互锁定（不因闲置被拉走）
      spatial.noteBubbleVisible()
    }

    if (PET_FEATURES.drag) hit.update(dt)

    // 资源占用统计：仅开发者模式推送（普通用户无消费方）
    if (devMode && Math.floor(performance.now() / 3000) !== Math.floor((performance.now() - dt * 1000) / 3000)) {
      window.api?.petStats?.(stage.getStats())
    }
  })

  // ── 主进程状态桥接 ──
  void bridge.init()



  // ── VRM 角色动态切换：收到 reload 信号时重载窗口（最可靠的全量重建方式） ──
  if (window.api?.onReloadVrm) {
    window.api.onReloadVrm(() => {
      // 重载页面，boot() 会读取新的 petVrmPath
      location.reload()
    })
  }
}

void boot()
