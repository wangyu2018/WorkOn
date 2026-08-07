/**
 * 计划 vs 实际达成率 + 计划完成/延期预测
 * 依据：PRD.md F5「把结构化计划与当日合并轨迹比对，达成率封顶100%」
 */
import type {
  CustomCategory, ForecastFactor, MergedTrail, PlanForecast, PlanItem, PlanVsActual, PlanVsActualItem, WorkState
} from './types'
import { WORK_LIKE_STATES } from './stateMeta'

/** 内置计划分类（不可删除） */
export const BUILTIN_CATEGORIES: CustomCategory[] = [
  { id: 'ai-dev', label: 'AI 开发', color: '#8B5CF6', emoji: '🤖', stateHints: ['aidev', 'aiqa', 'coding'], isBuiltIn: true, ts: 0 },
  { id: 'work-customer', label: '客户工作', color: '#3B82F6', emoji: '💼', stateHints: ['meeting', 'remote', 'writing', 'focus'], isBuiltIn: true, ts: 0 },
  { id: 'leader', label: '管理沟通', color: '#F59E0B', emoji: '👥', stateHints: ['meeting', 'remote'], isBuiltIn: true, ts: 0 },
  { id: 'personal', label: '个人事务', color: '#10B981', emoji: '🏠', stateHints: ['relax', 'break', 'writing'], isBuiltIn: true, ts: 0 },
  { id: 'other', label: '其他', color: '#64748B', emoji: '📋', stateHints: [], isBuiltIn: true, ts: 0 }
]

const CATEGORY_STATE_HINT: Record<string, string[]> = Object.fromEntries(
  BUILTIN_CATEGORIES.map((c) => [c.id, c.stateHints ?? []])
)

/** 分类 → 关联工作状态（自定义分类覆盖内置映射） */
export function categoryStateHints(category: string, categories?: CustomCategory[]): string[] {
  const custom = categories?.find((c) => c.id === category)
  if (custom?.stateHints) return custom.stateHints
  return CATEGORY_STATE_HINT[category] ?? []
}

export function planVsActual(plans: PlanItem[], trail: MergedTrail, categories?: CustomCategory[]): PlanVsActual {
  // 排除 cancelled 与 delayed：延期的原计划由目标日期副本承担，不计入本日分母（防双计）
  const dayPlans = plans.filter((p) => p.date === trail.date && p.status !== 'cancelled' && p.status !== 'delayed')

  // 实际工作分钟（墙钟）：工作类状态的总和
  const actualWorkMin = WORK_LIKE_STATES.reduce((a, s) => a + (trail.stateMinutes[s] ?? 0), 0)

  const items: PlanVsActualItem[] = dayPlans.map((plan) => {
    const hints = categoryStateHints(plan.category, categories)
    let coveredMin = 0
    for (const seg of trail.segments) {
      if (plan.startMin != null && plan.endMin != null) {
        // 有时间窗的计划：看片段是否落在窗口内
        const segDate = new Date(seg.startTs)
        const segMin = segDate.getHours() * 60 + segDate.getMinutes()
        if (segMin >= plan.startMin && segMin < plan.endMin && hints.includes(seg.mainState)) {
          coveredMin += seg.durationMin
        }
      } else if (hints.includes(seg.mainState)) {
        coveredMin += seg.durationMin
      }
    }
    const plannedMin = plan.durationMin ?? (plan.startMin != null && plan.endMin != null ? plan.endMin - plan.startMin : 0)
    return { plan, coveredMin: Math.min(coveredMin, plannedMin || coveredMin), matched: coveredMin >= Math.max(10, plannedMin * 0.5) }
  })

  const plannedMin = dayPlans.reduce((a, p) => a + (p.durationMin ?? (p.startMin != null && p.endMin != null ? p.endMin - p.startMin : 0)), 0)
  const achievement = plannedMin > 0 ? Math.min(100, Math.round((actualWorkMin / plannedMin) * 100)) : 0

  return {
    date: trail.date,
    plannedMin,
    actualWorkMin: Math.round(actualWorkMin),
    achievement,
    matchedCount: items.filter((i) => i.matched).length,
    deviationMin: Math.round(actualWorkMin - plannedMin),
    items
  }
}

/** 计划已被实际工作覆盖的分钟（预测用，宽松口径：仅时间窗+状态匹配） */
function computeElapsedMin(plan: PlanItem, trail: MergedTrail, categories?: CustomCategory[]): number {
  const hints = categoryStateHints(plan.category, categories)
  let covered = 0
  for (const seg of trail.segments) {
    if (plan.startMin != null && plan.endMin != null) {
      const segDate = new Date(seg.startTs)
      const segMin = segDate.getHours() * 60 + segDate.getMinutes()
      if (segMin >= plan.startMin && segMin < plan.endMin && hints.includes(seg.mainState)) {
        covered += seg.durationMin
      }
    } else if (hints.includes(seg.mainState)) {
      covered += seg.durationMin
    }
  }
  return covered
}

/** 规则预测引擎：计划完成/延期概率（问题 17） */
export function forecastPlan(
  plan: PlanItem,
  trail: MergedTrail,
  historicalTrails: MergedTrail[],
  nowMin: number,
  categories?: CustomCategory[]
): PlanForecast {
  const factors: ForecastFactor[] = []
  let score = 50

  // 因素1：已用时间 vs 计划时间
  const elapsed = computeElapsedMin(plan, trail, categories)
  const planned = plan.durationMin ?? (plan.endMin != null && plan.startMin != null ? plan.endMin - plan.startMin : 60)
  const timeRatio = planned > 0 ? elapsed / planned : 0
  if (timeRatio > 0.8) {
    score += 20
    factors.push({ label: '时间进度', impact: 'positive', detail: `已完成 ${Math.round(timeRatio * 100)}% 的计划时间` })
  } else if (timeRatio > 0.5) {
    score += 5
    factors.push({ label: '时间进度', impact: 'neutral', detail: `已完成 ${Math.round(timeRatio * 100)}% 的计划时间` })
  } else {
    score -= 15
    factors.push({ label: '时间进度', impact: 'negative', detail: `仅完成 ${Math.round(timeRatio * 100)}% 的计划时间` })
  }

  // 因素2：当前工作状态匹配度
  const currentState = trail.segments[trail.segments.length - 1]?.mainState as WorkState | undefined
  const hints = categoryStateHints(plan.category, categories) as WorkState[]
  if (currentState && hints.includes(currentState)) {
    score += 15
    factors.push({ label: '当前状态', impact: 'positive', detail: `当前正在做相关类型的工作` })
  } else if (currentState && hints.length > 0 && !hints.includes(currentState)) {
    score -= 10
    factors.push({ label: '当前状态', impact: 'negative', detail: `当前工作状态与计划不匹配` })
  }

  // 因素3：历史同时段表现（近 7 天工作占比）
  const avgFocus =
    historicalTrails.length > 0
      ? historicalTrails.reduce((a, t) => {
          const workMin = WORK_LIKE_STATES.reduce((s, st) => s + (t.stateMinutes[st] ?? 0), 0)
          return a + (t.totalMin > 0 ? workMin / t.totalMin : 0)
        }, 0) / historicalTrails.length
      : 0.5
  if (avgFocus > 0.7) {
    score += 10
    factors.push({ label: '历史表现', impact: 'positive', detail: '近期同时段专注度较高' })
  } else if (avgFocus < 0.4) {
    score -= 10
    factors.push({ label: '历史表现', impact: 'negative', detail: '近期同时段专注度偏低' })
  }

  // 因素4：今日摸鱼占比
  const slackRatio = (trail.stateMinutes.slack ?? 0) / Math.max(1, trail.totalMin)
  if (slackRatio > 0.3) {
    score -= 15
    factors.push({ label: '今日摸鱼', impact: 'negative', detail: `今日摸鱼占比 ${Math.round(slackRatio * 100)}%` })
  }

  // 因素5：任务复杂度（标题关键词粗估）
  if (/修复|debug|紧急|hotfix/i.test(plan.title)) {
    score -= 5
    factors.push({ label: '任务复杂度', impact: 'negative', detail: '修复/debug 类任务可能耗时超预期' })
  }
  if (/文档|doc|更新|update/i.test(plan.title)) {
    score += 5
    factors.push({ label: '任务复杂度', impact: 'positive', detail: '文档类任务通常耗时可控' })
  }

  const completionProb = Math.max(5, Math.min(95, Math.round(score)))
  const delayProb = 100 - completionProb
  const remainingMin = Math.max(0, planned - elapsed)
  const estimatedEndMin = nowMin + Math.round(remainingMin / Math.max(0.3, avgFocus))
  const recommendation =
    completionProb > 70 ? '进度良好，继续保持当前节奏' : completionProb > 40 ? '进度有风险，建议减少干扰，集中精力完成' : '完成概率较低，建议拆分任务或调整计划时间'

  return { planId: plan.id, completionProb, delayProb, factors, recommendation, estimatedEndMin }
}
