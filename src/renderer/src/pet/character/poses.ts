/**
 * 姿态库（VRM 版 v5）：仅站姿 + 表情变体
 * 原则：自然站立、动作小幅度、不穿模；
 * 表情按状态拉开差异（平常/开心打招呼/严肃），开心跃升由微行为挥手叠加
 *
 * 约定（经 ?calib 标定验证，姵儿模型；右臂 y/z 取左臂镜像）：
 * - upperarm z：0=T-pose 水平，+z 放下（90=垂直下垂），负 z 举起（左臂；右臂相反）
 * - upperarm y：+y 手臂绕身前摆，-y 身后摆（右臂取负镜像）
 * - forearm y：肘部前弯（左 + 右 -），弯度 ≤60° 避免袖子穿进身体
 * - hipsY：站姿 130（DEFAULT_HIPS_Y）
 */
import type { Expression } from './expression'

export type BoneEuler = [number, number, number] // 度

export interface PoseEntry {
  /** 骨骼欧拉角（度），未列出的骨骼回落到 DEFAULT_POSE */
  bones: Record<string, BoneEuler>
  /** 覆盖表情（部分） */
  expression?: Partial<Expression>
  /** hips 高度（px），默认 130 */
  hipsY?: number
}

/** 默认站姿：双臂自然垂放身体两侧，目视前方 */
export const DEFAULT_POSE: PoseEntry = {
  hipsY: 130,
  bones: {
    body: [0, 0, 0],
    hips: [0, 0, 0],
    spine_01: [0, 0, 0],
    spine_02: [0, 0, 0],
    spine_03: [0, 0, 0],
    neck_01: [0, 0, 0],
    head: [0, 0, 0],
    shoulder_L: [0, 0, 0],
    shoulder_R: [0, 0, 0],
    upperarm_L: [0, 6, 82],
    upperarm_R: [0, -6, -82],
    forearm_L: [0, 4, 0],
    forearm_R: [0, -4, 0],
    hand_L: [0, 0, 0],
    hand_R: [0, 0, 0],
    thigh_L: [0, 0, 2],
    thigh_R: [0, 0, -2],
    calf_L: [0, 0, 0],
    calf_R: [0, 0, 0],
    foot_L: [0, 0, 0],
    foot_R: [0, 0, 0]
  }
}

export const POSES: Record<string, PoseEntry> = {
  /** 站立（默认） */
  stand_idle: DEFAULT_POSE,

  /** 站立·打招呼：右臂举向前上方（对角线前送，全程远离头部），开心 */
  stand_greet: {
    bones: {
      upperarm_R: [0, -45, 70],
      forearm_R: [0, 15, 8],
      spine_02: [-2, 0, 0],
      head: [-3, -4, -5]
    },
    expression: { smile: 0.5, eyeWide: 0.12, blush: 0.3 }
  },

  /** 站立·严肃：表情收紧（拦屏/加班确认用），双臂自然 */
  stand_serious: {
    bones: {
      spine_02: [-2, 0, 0],
      neck_01: [2, 0, 0],
      head: [4, 0, 0]
    },
    expression: { smile: 0, frown: 0.25, browRaise: -0.2, eyeWide: 0.15, squint: 0.1 }
  },

  /** 站立·困倦：闭目养神（睡觉/冥想/休息用），头微垂 */
  stand_sleepy: {
    bones: {
      spine_01: [4, 0, 0],
      neck_01: [10, 0, 5],
      head: [8, 2, 4]
    },
    expression: { eyeOpen: 0.08, smile: 0.12, browRaise: 0 }
  },

  /** 站立·疲惫：没精打采，头低 */
  stand_tired: {
    bones: {
      spine_01: [8, 0, 0],
      spine_02: [6, 0, 0],
      neck_01: [12, 0, 0],
      head: [10, 0, 0]
    },
    expression: { frown: 0.2, browRaise: 0.25, squint: 0.15, smile: 0, eyeOpen: 0.6 }
  },

  /** 站立·放松：歪头微笑（摸鱼/休息） */
  stand_relaxed: {
    bones: {
      neck_01: [-2, 0, -5],
      head: [0, 6, -4]
    },
    expression: { smile: 0.4, eyeOpen: 0.8, blush: 0.2 }
  }
}
