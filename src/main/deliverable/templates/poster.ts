/**
 * 长图：纵向信息流，适合分享
 */
import type { DeliverableSpec } from '@shared/deliverable/spec'
import { baseSpec, entryLine, fmtMin, src, topEntries, type TemplateContext } from './common'

export function posterTemplate(ctx: TemplateContext): DeliverableSpec {
  const { report } = ctx
  const top = topEntries(report, 8)
  const spec = baseSpec('poster', ctx, `${report.date} 我的一天`)
  spec.blocks = [
    {
      id: 'cover',
      type: 'cover',
      title: `${report.date} 我的一天`,
      subtitle: `有效工作 ${fmtMin(report.stats.totalWorkMin)} · 专注 ${Math.round(report.stats.focusScore)} 分`,
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
        { label: '摸鱼', value: fmtMin(report.stats.totalSlackMin) },
        { label: '记录', value: report.entries.length, unit: '段' }
      ]
    },
    {
      id: 'apps',
      type: 'chart',
      kind: 'bars',
      title: '时间去向',
      points: top.map((e) => ({ label: (e.app ?? e.stateLabel).slice(0, 12), value: e.durationMin })),
      source: src(ctx, 'entries')
    },
    {
      id: 'trend',
      type: 'chart',
      kind: 'line',
      title: '专注趋势',
      points: report.stats.focusTrend.map((v, i) => ({ label: `${i}`, value: v })),
      caption: '按小时',
      source: src(ctx, 'focus')
    },
    {
      id: 'list',
      type: 'timeline',
      title: '今天做了什么',
      items: top.map((e) => {
        const d = new Date(e.startTs)
        return {
          time: `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`,
          title: e.stateLabel,
          detail: entryLine(e).slice(0, 70),
          state: e.state
        }
      }),
      source: src(ctx, 'entries')
    },
    {
      id: 'note',
      type: 'callout',
      kind: 'info',
      title: '一句话',
      text: report.achievements.length
        ? `今天完成 ${report.achievements.filter((a) => a.achievementRate >= 0.8).length} 个计划，达成率均值 ${Math.round(
            (report.achievements.reduce((s, a) => s + a.achievementRate, 0) / report.achievements.length) * 100
          )}%。`
        : '今天还没有计划达成记录，明天先定 1 个能交付的小目标。',
      source: src(ctx, 'achievements')
    },
    { id: 'footer', type: 'footer', text: 'WorkOn · 长图由本地数据生成' }
  ]
  return spec
}
