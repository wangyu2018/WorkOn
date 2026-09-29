/**
 * 桌宠功能开关（排障模式）：基线 = 骨架（加载/渲染/拖拽/基础气泡），全部可选项关闭。
 * 排障方法：稳定后逐个翻 true，每翻一个重启验证——谁把桌宠搞坏一目了然；
 * 同时完成「哪些功能没必要」的裁剪投票（关掉就是候选删除项）。
 *
 * 核心骨架（不受开关控制）：窗口生命周期、VRM 加载、Stage 渲染/帧率档、
 * 命中测试+拖拽、气泡基础显示、AI 问答文本本身。
 */
export const PET_FEATURES = {
  /** presence → 空间态自动迁移（peek/bottom 跳转与缩放泵动的来源） */
  autoSpatial: false,
  /** 自由漫步 FSM */
  roam: false,
  /** 粒子（尘埃/星星/Zzz/音符） */
  particles: false,
  /** 全窗天气（雨雪花瓣落叶） */
  weather: false,
  /** 昼夜光照相位（关=恒定中性光） */
  dayNight: false,
  /** 微行为整包：眨眼/耳抖/呼吸起伏/挥手触发/偶发小动作/铃铛（走路腿摆随漫游走） */
  microLife: true,
  /** 眼神跟随鼠标（独立开关，关=视线朝前不动） */
  microGaze: true,
  /** 场景闲聊（20s 评估的主动说话） */
  chatter: false,
  /** 主进程关怀/通知消息气泡（bus.message） */
  care: false,
  /** 首次 CG + 重播 */
  intro: false,
  /** 拽脖颈拎猫完整体验（光标捏领+身体悬垂+被动晃动）：暂缓优化中，开启即恢复 */
  scruffLift: false,
  /** 拖拽+命中测试（关=整窗纯穿透纯展示，省每帧射线检测；不可拖不可点） */
  drag: true,
  /** 气泡+右键聊天（关=无对话入口，桌宠纯看） */
  chat: false,
  /** 动作总开关：程序化 clip + VRMA + 工坊动作全不注册（关=纯静态立绘，连呼吸摆动都无） */
  clips: false,
  /** SpringBone 头发/发饰物理（关=直接静止在造型位置，无沉降动画，省每帧物理） */
  springBone: false,
  /** AI 回复 [action:x] 驱动动作 clip（情绪表情不受此控） */
  aiActionClips: false,
  /** intent → clip 反馈（celebrate/nudge/offwork 等） */
  intentClips: false
} as const

export type PetFeatureKey = keyof typeof PET_FEATURES
