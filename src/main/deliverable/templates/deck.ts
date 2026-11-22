/**
 * 演示文稿：每节一页，16:9
 */
import type { DeliverableSpec } from '@shared/deliverable/spec'
import { baseSpec, entryLine, fmtMin, src, topEntries, type TemplateContext } from './common'

export function deckTemplate(ctx: TemplateContext): DeliverableSpec {
  const { report } = ctx
  const top = topEntries(report, 6)
  const spec = baseSpec('deck', ctx, `${report.date} 工作复盘`, '演示模式 · 每节一页')
  spec.blocks = [
    {
      id: 'cover',
      type: 'cover',
      title: `${report.date} 工作复盘`,
      subtitle: '今天做了什么 · 时间去哪了 · 明天怎么改',
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
        { label: '记录条数', value: report.entries.length, unit: '条' }
      ]
    },
    { id: 's1', type: 'heading', level: 1, text: '时间去哪了' },
    {
      id: 'apps',
      type: 'chart',
      kind: 'bars',
      title: '应用时长 Top 6',
      points: top.map((e) => ({ label: (e.app ?? e.stateLabel).slice(0, 10), value: e.durationMin })),
      caption: '单位：分钟',
      source: src(ctx, 'entries')
    },
    { id: 's2', type: 'heading', level: 1, text: '状态结构' },
    {
      id: 'state',
      type: 'chart',
      kind: 'donut',
      title: '工作状态占比',
      points: report.stats.stateBreakdown.slice(0, 6).map((s) => ({ label: s.label, value: s.minutes })),
      caption: '单位：分钟',
      source: src(ctx, 'state')
    },
    { id: 's3', type: 'heading', level: 1, text: '关键产出' },
    {
      id: 'out-table',
      type: 'table',
      columns: ['时间段', '内容', '项目'],
      rows: top.map((e) => {
        const d = new Date(e.startTs)
        return [
          `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`,
          entryLine(e).slice(0, 60),
          e.project ?? '--'
        ]
      }),
      source: src(ctx, 'entries')
    },
    { id: 's4', type: 'heading', level: 1, text: '计划达成' },
    {
      id: 'ach',
      type: 'chart',
      kind: 'bars',
      title: '计划达成率',
      points: report.achievements.slice(0, 6).map((a) => ({
        label: a.title.slice(0, 10),
        value: Math.round(a.achievementRate * 100)
      })),
      caption: '单位：%',
      max: 100,
      source: src(ctx, 'achievements')
    },
    {
      id: 'next',
      type: 'callout',
      kind: 'info',
      title: '下一步建议',
      text: report.achievements.some((a) => a.achievementRate < 0.6)
        ? '有计划的达成率偏低，建议明天把大任务拆成 30-60 分钟块，并在计划页锁定时间。'
        : '达成率正常，明天可以尝试提前锁定 1 个深度工作块。',
      source: src(ctx, 'achievements')
    },
    { id: 'footer', type: 'footer', text: 'WorkOn · 数据来自本地工具调用' }
  ]
  return spec
}
