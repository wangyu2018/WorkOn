/**
 * 首页模块布局：显隐 + 拖拽顺序（localStorage）
 */
import type { MonitorSectionKey } from '../views/MonitorView'
import { DEFAULT_MONITOR_SECTIONS, MONITOR_SECTION_META } from '../views/MonitorView'

export type HomeCoreKey = 'insight' | 'timeline' | 'starmap'
export type HomeBlockKey = HomeCoreKey | MonitorSectionKey

export type HomeWidgets = Record<HomeBlockKey, boolean>

export const HOME_CORE_META: {
  key: HomeCoreKey
  label: string
  desc: string
  size: '整行' | '半宽'
  group: '首页' | '监控'
}[] = [
  { key: 'insight', label: '今日洞察', desc: '专注 / 摸鱼 / AI 评分 KPI 与基线对比', size: '整行', group: '首页' },
  { key: 'timeline', label: '工作时间轴', desc: '泳道时间轴 · 计划对照 · 可缩放', size: '整行', group: '首页' },
  { key: 'starmap', label: '应用星图', desc: '近 7 天应用切换关系与停留', size: '整行', group: '首页' }
]

export const HOME_BLOCK_META: {
  key: HomeBlockKey
  label: string
  desc: string
  size: '整行' | '半宽'
  group: '首页' | '监控'
}[] = [
  ...HOME_CORE_META,
  ...MONITOR_SECTION_META.map((m) => ({ ...m, group: '监控' as const }))
]

export const DEFAULT_HOME_ORDER: HomeBlockKey[] = [
  ...MONITOR_SECTION_META.map((m) => m.key),
  'insight',
  'timeline',
  'starmap'
]

export function isMonitorBlockKey(k: string): k is MonitorSectionKey {
  return MONITOR_SECTION_META.some((m) => m.key === k)
}

export function defaultHomeWidgets(): HomeWidgets {
  return {
    insight: true,
    timeline: true,
    starmap: true,
    ...DEFAULT_MONITOR_SECTIONS
  }
}

export function loadHomeWidgets(): HomeWidgets {
  const base = defaultHomeWidgets()
  try {
    const s = localStorage.getItem('homeWidgets')
    if (!s) return base
    const parsed = JSON.parse(s) as Partial<HomeWidgets> & { monitor?: boolean }
    const next = { ...base, ...parsed }
    if (typeof parsed.monitor === 'boolean') {
      for (const { key } of MONITOR_SECTION_META) {
        if (parsed[key] === undefined) next[key] = parsed.monitor
      }
    }
    return next
  } catch {
    return base
  }
}

export function loadHomeOrder(): HomeBlockKey[] {
  const valid = new Set(HOME_BLOCK_META.map((m) => m.key))
  try {
    const s = localStorage.getItem('homeWidgetOrder')
    if (s) {
      const parsed = JSON.parse(s) as string[]
      const cleaned = parsed.filter((k): k is HomeBlockKey => valid.has(k as HomeBlockKey))
      for (const k of DEFAULT_HOME_ORDER) {
        if (!cleaned.includes(k)) cleaned.push(k)
      }
      return cleaned
    }
  } catch { /* ignore */ }
  return [...DEFAULT_HOME_ORDER]
}

export function saveHomeLayout(widgets: HomeWidgets, order: HomeBlockKey[]): void {
  try {
    localStorage.setItem('homeWidgets', JSON.stringify(widgets))
    localStorage.setItem('homeWidgetOrder', JSON.stringify(order))
  } catch { /* ignore */ }
}

export type HomeRenderSlot =
  | { kind: 'home'; key: HomeCoreKey }
  | { kind: 'monitor'; keys: MonitorSectionKey[] }

/** 按顺序生成渲染槽：连续监控块合并为一次 MonitorView，可与首页块交错 */
export function buildHomeRenderSlots(order: HomeBlockKey[], visible: HomeWidgets): HomeRenderSlot[] {
  const slots: HomeRenderSlot[] = []
  let i = 0
  while (i < order.length) {
    const k = order[i]
    if (isMonitorBlockKey(k)) {
      const keys: MonitorSectionKey[] = []
      while (i < order.length && isMonitorBlockKey(order[i])) {
        const mk = order[i] as MonitorSectionKey
        if (visible[mk]) keys.push(mk)
        i++
      }
      if (keys.length) slots.push({ kind: 'monitor', keys })
    } else {
      if (visible[k]) slots.push({ kind: 'home', key: k })
      i++
    }
  }
  return slots
}

export function metaOf(key: HomeBlockKey) {
  return HOME_BLOCK_META.find((m) => m.key === key)!
}
