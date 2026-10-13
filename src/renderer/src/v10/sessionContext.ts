/**
 * 会话上下文（v10 简化模型，用户 2026-10-13 拍板：框即 session）
 * 右页每个框绑定一个数据源；左栏切换上下文后，问答自动带该数据源的摘要——
 * 不用每次拖引用，绑定即持续聚焦。通用=不带特定数据源（服务端默认注入全量）。
 */
import type { PlanItem, TrailSegment, GoalView } from '@shared/types'

export type ContextKey = 'general' | 'timeline' | 'plans' | 'goals' | 'reminders'

export interface SessionContext {
  key: ContextKey
  label: string
  /** 生成聚焦摘要（注入问句前缀）；general 返回空 */
  digest: (data: ContextData) => string
}

export interface ContextData {
  trail: TrailSegment[]
  plans: PlanItem[]
  goals: GoalView[]
  reminders: Array<{ title: string; atHHMM?: string; recurring?: string }>
}

const hhmm = (ts: number): string => {
  const d = new Date(ts)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

export const SESSION_CONTEXTS: SessionContext[] = [
  { key: 'general', label: '通用', digest: () => '' },
  {
    key: 'timeline',
    label: '轨迹',
    digest: (d) => {
      const segs = d.trail.filter((t) => !t.glance).slice(-8)
      if (!segs.length) return '（轨迹暂无数据）'
      const lines = segs.map((t) => `${hhmm(t.startTs)} ${t.mainState} ${t.mainApp}${t.mainTitle ? `(${t.mainTitle.slice(0, 20)})` : ''} ${Math.round(t.durationMin)}min`)
      return `最近轨迹：\n${lines.join('\n')}`
    }
  },
  {
    key: 'plans',
    label: '计划',
    digest: (d) => {
      const today = new Date()
      const key = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
      const list = d.plans.filter((p) => p.date === key && p.status !== 'cancelled')
      if (!list.length) return '（今日无计划）'
      return `今日计划：\n${list.map((p) => `- [${p.status}] ${p.title}`).join('\n')}`
    }
  },
  {
    key: 'goals',
    label: '人生预期',
    digest: (d) => {
      const actives = d.goals.filter((v) => v.goal.status === 'active')
      if (!actives.length) return '（暂无在轨目标）'
      return `在轨目标：\n${actives
        .map((v) => `- ${v.goal.event}（D-${v.remainingDays} · 已投 ${Math.round(v.cumMin)} 分钟 · 节奏 ${Math.round(v.paceRatio * 100)}%）`)
        .join('\n')}`
    }
  },
  {
    key: 'reminders',
    label: '提醒',
    digest: (d) => {
      if (!d.reminders.length) return '（无提醒）'
      return `提醒清单：\n${d.reminders.map((r) => `- ${r.atHHMM ?? '定时'} ${r.title}`).join('\n')}`
    }
  }
]

/** 组装带上下文的问句 */
export function withContext(key: ContextKey, text: string, data: ContextData): string {
  const ctx = SESSION_CONTEXTS.find((c) => c.key === key)
  if (!ctx || key === 'general') return text
  return `【当前会话：${ctx.label}】\n${ctx.digest(data)}\n\n${text}`
}
