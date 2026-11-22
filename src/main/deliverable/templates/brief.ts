/**
 * 一页纸简报：封面 + 3 KPI + 1 图表 + 3 条结论
 */
import type { DeliverableSpec } from '@shared/deliverable/spec'
import { baseSpec, fmtMin, src, topEntries, type TemplateContext } from './common'

export function briefTemplate(ctx: TemplateContext): DeliverableSpec {
  const { report } = ctx
  const top = topEntries(report, 5)
  const spec = baseSpec('brief', ctx, `${report.date} 工作简报`, '一页看清今天做了什么')
  spec.blocks = [
    {
      id: 'cover',
      type: 'cover',
      title: `${report.date} 工作简报`,
      subtitle: '工作轨迹 · 专注度 · 产出',
      date: report.date,
      author: 'WorkOn',
      source: src(ctx, 'cover')
    },
    {
      id: 'kpi',
      type: 'metrics',
      source: src(ctx, 'stats'),
      items: [
        { label: '有效工作', value: fmtMin(report.stats.totalWorkMin) },
        { label: '专注分', value: Math.round(report.stats.focusScore), unit: '/100' },
        { label: '数据覆盖', value: Math.round(report.coverage * 100), unit: '%' }
      ]
    },
    {
      id: 'apps',
      type: 'chart',
      kind: 'bars',
      title: '时间去向 Top 5',
      points: top.map((e) => ({ label: (e.app ?? e.stateLabel).slice(0, 10), value: e.durationMin })),
      caption: '单位：分钟',
      source: src(ctx, 'entries')
    },
    {
      id: 'conclusions',
      type: 'callout',
      kind: 'info',
      title: '三条结论',
      text:
        report.achievements.length
          ? report.achievements
              .slice(0, 3)
              .map((a, i) => `${i + 1}. ${a.title}（达成 ${Math.round(a.achievementRate * 100)}%）`)
              .join('\n')
          : '今天还没有计划达成记录；建议先在「计划」里建 1-2 个可交付目标。',
      source: src(ctx, 'achievements')
    },
    {
      id: 'footer',
      type: 'footer',
      text: `WorkOn 生成 · 覆盖率 ${Math.round(report.coverage * 100)}% · AI ${report.aiStatus}`
    }
  ]
  return spec
}
