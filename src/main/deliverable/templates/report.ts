/**
 * 日报 / 周报：概览 + 分布 + 时间线 + 成果 + 计划达成
 */
import type { DeliverableSpec } from '@shared/deliverable/spec'
import { baseSpec, entryLine, fmtMin, src, type TemplateContext } from './common'

export function reportTemplate(ctx: TemplateContext): DeliverableSpec {
  const { report } = ctx
  const spec = baseSpec('report', ctx, `${report.date} 工作报告`, '由本地工作轨迹自动汇总')
  const timeline = [...report.entries]
    .sort((a, b) => a.startTs - b.startTs)
    .slice(0, 12)
    .map((e) => {
      const d = new Date(e.startTs)
      return {
        time: `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`,
        title: e.stateLabel,
        detail: entryLine(e),
        state: e.state
      }
    })

  spec.blocks = [
    {
      id: 'cover',
      type: 'cover',
      title: `${report.date} 工作报告`,
      subtitle: '工作概览 · 时间分布 · 成果 · 计划达成',
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
        { label: '摸鱼时长', value: fmtMin(report.stats.totalSlackMin) },
        { label: '专注分', value: Math.round(report.stats.focusScore), unit: '/100' },
        { label: '数据覆盖', value: Math.round(report.coverage * 100), unit: '%' }
      ]
    },
    { id: 'overview-h', type: 'heading', level: 1, text: '工作概览' },
    {
      id: 'overview-p',
      type: 'paragraph',
      text: `今日共记录 ${report.entries.length} 条工作段，有效工作 ${fmtMin(
        report.stats.totalWorkMin
      )}，专注分 ${Math.round(report.stats.focusScore)}。数据覆盖 ${Math.round(report.coverage * 100)}%，${
        report.pendingReview.length ? `${report.pendingReview.length} 条待确认。` : '无待确认条目。'
      }`,
      source: src(ctx, 'stats')
    },
    {
      id: 'state-donut',
      type: 'chart',
      kind: 'donut',
      title: '工作状态分布',
      points: report.stats.stateBreakdown.slice(0, 6).map((s) => ({ label: s.label, value: s.minutes })),
      caption: '单位：分钟',
      source: src(ctx, 'state')
    },
    {
      id: 'app-bars',
      type: 'chart',
      kind: 'bars',
      title: '应用时长排行',
      points: report.stats.appRanking.slice(0, 8).map((a) => ({ label: a.app.slice(0, 10), value: a.minutes })),
      caption: '单位：分钟',
      source: src(ctx, 'apps')
    },
    { id: 'timeline-h', type: 'heading', level: 1, text: '时间线' },
    {
      id: 'timeline',
      type: 'timeline',
      title: '今日主要工作段',
      items: timeline.length ? timeline : [{ time: '--:--', title: '暂无记录', detail: '开启深度模式后可自动采集' }],
      source: src(ctx, 'entries')
    },
    { id: 'ach-h', type: 'heading', level: 1, text: '计划达成' },
    {
      id: 'ach-table',
      type: 'table',
      title: '计划 vs 实际',
      columns: ['计划', '计划时长', '实际时长', '达成率'],
      align: ['left', 'right', 'right', 'right'],
      rows: report.achievements.length
        ? report.achievements.map((a) => [a.title, fmtMin(a.plannedMin), fmtMin(a.actualMin), `${Math.round(a.achievementRate * 100)}%`])
        : [['暂无计划', '0', fmtMin(report.stats.totalWorkMin), '--']],
      source: src(ctx, 'achievements')
    },
    {
      id: 'note',
      type: 'callout',
      kind: report.aiStatus === 'enhanced' ? 'success' : 'warn',
      title: '生成说明',
      text: `AI 状态：${report.aiStatus}；数据覆盖率 ${Math.round(report.coverage * 100)}%。${
        report.pendingReview.length ? `有 ${report.pendingReview.length} 条低置信度记录待确认。` : ''
      }`,
      source: src(ctx, 'ai')
    },
    { id: 'footer', type: 'footer', text: `WorkOn · ${report.date} · 本报告所有数字均可追溯到本地工具调用` }
  ]
  return spec
}
