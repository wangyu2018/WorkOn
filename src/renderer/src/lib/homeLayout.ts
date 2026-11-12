/**
 * 首页模块布局：显隐 + 拖拽顺序（localStorage）
 */
import type { MonitorSectionKey } from '../views/MonitorView'
import { DEFAULT_MONITOR_SECTIONS, MONITOR_SECTION_META } from '../views/MonitorView'

export type HomeCoreKey = 'dayplan' | 'insight' | 'timeline' | 'starmap' | 'quote' | 'soup' | 'almanac' | 'countdown' | 'festival' | 'habit' | 'planahead' | 'goal'
export type HomeBlockKey = HomeCoreKey | MonitorSectionKey

export type HomeWidgets = Record<HomeBlockKey, boolean>

export const HOME_CORE_META: {
  key: HomeCoreKey
  label: string
  desc: string
  size: '整行' | '半宽'
  group: '首页' | '监控'
}[] = [
  { key: 'dayplan', label: '今日计划', desc: '今日三件事 · 计划清单预览 · 顺延项', size: '整行', group: '首页' },
  { key: 'insight', label: '今日洞察', desc: '专注 / 摸鱼 / AI 评分 KPI 与基线对比', size: '整行', group: '首页' },
  { key: 'timeline', label: '工作时间轴', desc: '泳道时间轴 · 计划对照 · 可缩放', size: '整行', group: '首页' },
  { key: 'starmap', label: '应用星图', desc: '近 7 天应用切换关系与停留', size: '整行', group: '首页' },
  { key: 'quote', label: '每日一句', desc: '按天换一句，可手动换', size: '整行', group: '首页' },
  { key: 'soup', label: '毒鸡汤', desc: '按天一碗，可手动换', size: '整行', group: '首页' },
  { key: 'almanac', label: '今日黄历', desc: '宜忌五行冲煞（本地规则，图一乐）', size: '整行', group: '首页' },
  { key: 'countdown', label: '倒数日', desc: '自定义事件倒数（本地存储）', size: '整行', group: '首页' },
  { key: 'festival', label: '节日倒数', desc: '传统节日（农历自动算）+自定义事件', size: '整行', group: '首页' },
  { key: 'habit', label: '习惯打卡', desc: '连击计数，今天不打就断', size: '整行', group: '首页' },
  { key: 'planahead', label: '计划倒数', desc: '未来 7 天排期（接计划数据）', size: '整行', group: '首页' },
  { key: 'goal', label: '目标进度', desc: '盯一条主线的任务完成率与下一步', size: '整行', group: '首页' }
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

/** 默认顺序按「此刻 → 今天做了什么 → 为什么」讲：计划 → 时间轴 → 洞察 → 监控明细 */
export const DEFAULT_HOME_ORDER: HomeBlockKey[] = [
  'dayplan',
  'timeline',
  'insight',
  ...MONITOR_SECTION_META.map((m) => m.key),
  'starmap',
  'quote',
  'soup',
  'almanac',
  'countdown',
  'festival',
  'habit',
  'planahead',
  'goal'
]

export function isMonitorBlockKey(k: string): k is MonitorSectionKey {
  return MONITOR_SECTION_META.some((m) => m.key === k)
}

export function defaultHomeWidgets(): HomeWidgets {
  // v8 默认只留三块：今日计划 / 时间轴 / 洞察。
  // 监控明细（概览、评分、分布、双屏、TOP 应用）骨架重复且压垮首屏，默认关闭，编辑布局里可开。
  return {
    dayplan: true,
    insight: true,
    timeline: true,
    starmap: false,
    quote: false,
    soup: false,
    almanac: false,
    countdown: false,
    festival: false,
    habit: false,
    planahead: false,
    goal: false,
    ...DEFAULT_MONITOR_SECTIONS,
    presence: false,
    overview: false,
    attention: false,
    dist: false,
    screens: false,
    topApps: false,
    trail: false
  }
}

export function loadHomeWidgets(): HomeWidgets {
  const base = defaultHomeWidgets()
  try {
    const s = localStorage.getItem('homeWidgetsV8')
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
    // v8：默认顺序改为「计划 → 时间轴 → 洞察 → 监控」，旧顺序作废（模块显隐仍保留）
    const s = localStorage.getItem('homeWidgetOrderV8')
    if (s) {
      const parsed = JSON.parse(s) as string[]
      const cleaned = parsed.filter((k): k is HomeBlockKey => valid.has(k as HomeBlockKey))
      // 新增块插到默认序的对应位置（而不是一律垫底）：找默认序里它后面第一个已存在的块插到其前面
      for (const k of DEFAULT_HOME_ORDER) {
        if (cleaned.includes(k)) continue
        const successor = DEFAULT_HOME_ORDER.slice(DEFAULT_HOME_ORDER.indexOf(k) + 1).find((s) => cleaned.includes(s))
        if (successor) cleaned.splice(cleaned.indexOf(successor), 0, k)
        else cleaned.push(k)
      }
      return cleaned
    }
  } catch { /* ignore */ }
  return [...DEFAULT_HOME_ORDER]
}

export function saveHomeLayout(widgets: HomeWidgets, order: HomeBlockKey[]): void {
  try {
    localStorage.setItem('homeWidgetsV8', JSON.stringify(widgets))
    localStorage.setItem('homeWidgetOrderV8', JSON.stringify(order))
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
