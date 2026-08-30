/**
 * 识别引擎类型（主进程内部；对外口径的 RecognitionSource / RecognitionLogRecord 在 @shared/types）
 */
import type { WorkState } from '@shared/types'
export type { RecognitionSource } from '@shared/types'

/** 一轮前台采样输入 */
export interface RecognitionInput {
  ts: number
  screen: number
  app: string // 进程名（纠偏前）
  title: string // 窗口标题
  active: boolean // 是否激活屏（仅激活屏走模型管道）
  idleSec: number
  /** 行为探针聚合快照（识别二期；探针未运行时缺省 → 占位特征） */
  behavior?: BehaviorSnapshot | null
  /** UIAutomation 焦点元素提示（deepMode 时由 monitor 注入） */
  uiaHint?: UiaHint | null
}

/** 行为探针聚合快照（最近 10s 滑动窗口；隐私口径=只计数不记内容） */
export interface BehaviorSnapshot {
  windowSec: number
  typeKeys: number
  clicks: number
  wheels: number
  typeKeyTotal: number
  clickTotal: number
  wheelTotal: number
  hasShortcut: boolean
  lastShortcutName: 'copy' | 'paste' | 'cut' | 'save' | 'find' | 'undo' | null
  lastShortcutAgeMs: number | null
  clipboardChangedAgeMs: number | null
  pasteHint: boolean
  copyHint: boolean
}

/** UIAutomation 焦点元素提示（field/text_length 真实化用） */
export interface UiaHint {
  controlType: string
  valueLength: number
  selectedLength: number
  docLength: number
}

export interface RecognitionResult {
  /** 纠偏后的进程名 */
  app: string
  title: string
  /** 友好名（VSCode / Chrome …），presence 媒体粘性依赖 */
  appName: string
  state: WorkState
  source: import('@shared/types').RecognitionSource
  /** 置信度 0-1：模型输出为最大类概率，规则路径恒为 1 */
  confidence: number
}

/** 小模型单条预测（8 类动作标签 + 最大类概率） */
export interface ModelPrediction {
  label: string
  prob: number
}

/** 与 ml/train.py 特征列严格对齐的动作特征（9 字段） */
export interface ActionFeatures {
  app_category: string
  action_type: string
  field: string
  duration_ms: number
  hour: number
  day_of_week: number
  time_since_prev_ms: number
  text_length: number
  has_shortcut: boolean
}
