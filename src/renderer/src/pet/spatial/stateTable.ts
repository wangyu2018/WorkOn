/**
 * 16 状态空间行为表（digest-v4 §10 总表 + §11 详参 + §14 Z 层级）
 * defaultPos 坐标为屏幕分数（0-1），y 可用 'bottom'（贴任务栏上沿）/ 'peek'（身体 70% 在屏下）
 */
export type ZLayer = 'DESKTOP_BG' | 'WINDOW_BACK' | 'WINDOW_MID' | 'WINDOW_FRONT' | 'TOPMOST'

export type SpatialStateName =
  | 'deep_focus'
  | 'working'
  | 'coding'
  | 'writing'
  | 'aiqa'
  | 'aidev'
  | 'slack'
  | 'meeting'
  | 'pomodoro_focus'
  | 'pomodoro_break'
  | 'overworked'
  | 'sleeping'
  | 'global_chat'
  | 'screen_block'
  | 'offwork_remind'
  | 'overtime_confirm'

export type TransitionKind = 'A' | 'B' | 'C' | 'D' | 'E' // 行走/缩放/钻入钻出/漂浮/奔跑（§12）

export interface SpatialStateConfig {
  name: SpatialStateName
  defaultPos: { x: number; y: number | 'bottom' | 'peek' }
  scale: number
  zLayer: ZLayer
  poseName: string
  entryDuration: number
  exitDuration: number
  transparency: number
  allowClickThrough: boolean
  transition: TransitionKind
  /** 紧急状态可立即打断当前过渡（screen_block / pomodoro_break） */
  urgent?: boolean
  /** 允许自由游荡（working/idle） */
  roam?: boolean
}

export const TASKBAR_HEIGHT = 48

export const SPATIAL_STATE_TABLE: Record<SpatialStateName, SpatialStateConfig> = {
  deep_focus: {
    name: 'deep_focus',
    defaultPos: { x: 0.7, y: 'peek' },
    scale: 0.85,
    zLayer: 'WINDOW_BACK',
    poseName: 'stand_idle',
    entryDuration: 1.5,
    exitDuration: 0.8,
    transparency: 1.0,
    allowClickThrough: true,
    transition: 'C'
  },
  working: {
    name: 'working',
    defaultPos: { x: 0.85, y: 'bottom' },
    scale: 1,
    zLayer: 'WINDOW_MID',
    poseName: 'stand_idle',
    entryDuration: 1.2,
    exitDuration: 0.8,
    transparency: 0.85,
    allowClickThrough: false,
    transition: 'A',
    roam: true // 游荡能力保留，是否启用由设置 petRoam 控制（默认关）
  },
  coding: {
    name: 'coding',
    defaultPos: { x: 0.78, y: 'bottom' },
    scale: 1,
    zLayer: 'WINDOW_BACK',
    poseName: 'stand_idle',
    entryDuration: 1.5,
    exitDuration: 0.8,
    transparency: 0.9,
    allowClickThrough: false,
    transition: 'A'
  },
  writing: {
    name: 'writing',
    defaultPos: { x: 0.8, y: 'bottom' },
    scale: 0.95,
    zLayer: 'WINDOW_MID',
    poseName: 'stand_idle',
    entryDuration: 1.5,
    exitDuration: 0.8,
    transparency: 0.85,
    allowClickThrough: false,
    transition: 'A'
  },
  aiqa: {
    name: 'aiqa',
    defaultPos: { x: 0.82, y: 'bottom' },
    scale: 1.15,
    zLayer: 'WINDOW_FRONT',
    poseName: 'stand_idle',
    entryDuration: 1.2,
    exitDuration: 0.8,
    transparency: 0.95,
    allowClickThrough: false,
    transition: 'B'
  },
  aidev: {
    name: 'aidev',
    defaultPos: { x: 0.85, y: 'bottom' },
    scale: 0.9,
    zLayer: 'WINDOW_BACK',
    poseName: 'stand_idle',
    entryDuration: 1.5,
    exitDuration: 0.8,
    transparency: 0.85,
    allowClickThrough: true,
    transition: 'C'
  },
  slack: {
    name: 'slack',
    defaultPos: { x: 0.82, y: 'bottom' },
    scale: 1.05,
    zLayer: 'WINDOW_FRONT',
    poseName: 'stand_relaxed',
    entryDuration: 1.8,
    exitDuration: 1.0,
    transparency: 0.9,
    allowClickThrough: false,
    transition: 'A'
  },
  meeting: {
    name: 'meeting',
    defaultPos: { x: 0.78, y: 'bottom' },
    scale: 0.9,
    zLayer: 'WINDOW_BACK',
    poseName: 'stand_idle',
    entryDuration: 1.5,
    exitDuration: 0.8,
    transparency: 0.85,
    allowClickThrough: true,
    transition: 'A'
  },
  pomodoro_focus: {
    name: 'pomodoro_focus',
    defaultPos: { x: 0.9, y: 'bottom' },
    scale: 0.7,
    zLayer: 'TOPMOST',
    poseName: 'stand_sleepy',
    entryDuration: 1.5,
    exitDuration: 0.8,
    transparency: 1.0,
    allowClickThrough: true,
    transition: 'D'
  },
  pomodoro_break: {
    name: 'pomodoro_break',
    defaultPos: { x: 0.5, y: 0.5 },
    scale: 1.3,
    zLayer: 'TOPMOST',
    poseName: 'stand_relaxed',
    entryDuration: 0.8,
    exitDuration: 0.5,
    transparency: 1.0,
    allowClickThrough: false,
    transition: 'E',
    urgent: true
  },
  overworked: {
    name: 'overworked',
    defaultPos: { x: 0.85, y: 'bottom' },
    scale: 0.85,
    zLayer: 'WINDOW_MID',
    poseName: 'stand_tired',
    entryDuration: 1.5,
    exitDuration: 0.8,
    transparency: 0.85,
    allowClickThrough: true,
    transition: 'D'
  },
  sleeping: {
    name: 'sleeping',
    defaultPos: { x: 0.88, y: 'bottom' },
    scale: 0.75,
    zLayer: 'DESKTOP_BG',
    poseName: 'stand_sleepy',
    entryDuration: 2.0,
    exitDuration: 1.0,
    transparency: 0.85,
    allowClickThrough: true,
    transition: 'D'
  },
  global_chat: {
    name: 'global_chat',
    defaultPos: { x: 0.8, y: 'bottom' },
    scale: 1.15,
    zLayer: 'WINDOW_FRONT',
    poseName: 'stand_greet',
    entryDuration: 1.0,
    exitDuration: 0.8,
    transparency: 0.95,
    allowClickThrough: false,
    transition: 'B'
  },
  screen_block: {
    name: 'screen_block',
    defaultPos: { x: 0.5, y: 0.45 },
    scale: 1.8,
    zLayer: 'TOPMOST',
    poseName: 'stand_serious',
    entryDuration: 0.8,
    exitDuration: 0.5,
    transparency: 1.0,
    allowClickThrough: false,
    transition: 'E',
    urgent: true
  },
  offwork_remind: {
    name: 'offwork_remind',
    defaultPos: { x: 0.82, y: 'bottom' },
    scale: 1.1,
    zLayer: 'WINDOW_FRONT',
    poseName: 'stand_greet',
    entryDuration: 1.2,
    exitDuration: 0.8,
    transparency: 0.95,
    allowClickThrough: false,
    transition: 'E'
  },
  overtime_confirm: {
    name: 'overtime_confirm',
    defaultPos: { x: 0.8, y: 'bottom' },
    scale: 1.15,
    zLayer: 'WINDOW_FRONT',
    poseName: 'stand_serious',
    entryDuration: 1.0,
    exitDuration: 0.8,
    transparency: 0.95,
    allowClickThrough: false,
    transition: 'B'
  }
}

/** Z 层 → 渲染近似（opacity + renderOrder，digest §14） */
export const Z_LAYER_RENDER: Record<ZLayer, { opacity: number; renderOrder: number }> = {
  DESKTOP_BG: { opacity: 0.85, renderOrder: 0 },
  WINDOW_BACK: { opacity: 0.85, renderOrder: 1 },
  WINDOW_MID: { opacity: 0.85, renderOrder: 2 },
  WINDOW_FRONT: { opacity: 0.9, renderOrder: 3 },
  TOPMOST: { opacity: 1.0, renderOrder: 4 }
}
