/** 项目优先级统一口径：排序权重 + 展示元数据（主线/计划/待办/选择器共用） */

export type Prio = 'low' | 'medium' | 'high'

/** 排序权重：高 0 / 中 1 / 低 2，未知按中处理 */
export const prioW = (p?: string | null): number => (p === 'high' ? 0 : p === 'low' ? 2 : 1)

export const PRIO_META: Record<Prio, { label: string; mark: string; color: string }> = {
  high: { label: '高', mark: '▲', color: '#f87171' },
  medium: { label: '中', mark: '●', color: '#fbbf24' },
  low: { label: '低', mark: '▽', color: '#94a3b8' }
}

export const prioMeta = (p?: string | null): { label: string; mark: string; color: string } =>
  PRIO_META[(p as Prio) ?? 'medium'] ?? PRIO_META.medium
