/**
 * Jev 决策模型（WorkOn-Jev）类型 —— 追加到 src/main/recognition/types.ts
 *
 * 旧口径只返回 8 类「动作标签」；Jev 一次可以同时回答：
 *   work_state（工作状态）/ scene_l1..l3（桌面场景三级）/ action（动作）
 * 并给出**每个选项的概率分布**（Jev 的核心：高置信自动执行，低置信交给人或规则）。
 */

/** 场景三级预测（full 通道返回） */
export interface JevScenePrediction {
  scene_l1?: string
  scene_l2?: string
  scene_l3?: string
}

/** 单题答案：key 是稳定标签（如 coding / 浏览器），text 是展示文本 */
export interface JevAnswer {
  key: string
  text: string
  /** 最大类概率（0-1，已做逐题温度校准） */
  prob: number
  /** 全部候选选项的概率分布 */
  probs: Record<string, number>
}

/** full 通道返回：一次前向回答全部内置问题 */
export interface JevFullPrediction {
  /** 与 ModelPrediction 对齐的快捷字段（= work_state 的 key/prob） */
  label: string
  prob: number
  scene: JevScenePrediction | null
  answers: Record<string, JevAnswer> | null
  /** 侧车侧实测耗时（包含 python 序列化开销），用于端侧性能观测 */
  latencyMs: number | null
}
