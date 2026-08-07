// 冒烟脚本（临时）：用真实 userData 跑 generateReport，验证基础能力层全链路
// electron 依赖经 esbuild alias 替换为 ./electron-stub.cjs
// 用法：node smoke-report.cjs [date]          —— 单日
//       node smoke-report.cjs week [startDate] —— 智能周报（startDate 起 7 天，缺省为 6 天前）
import { initDb } from '../src/main/db'
import { generateReport, generateWeeklyReport } from '../src/main/report/engine'

const fmtDate = (d: Date) =>
  `${d.getFullYear()}-${`${d.getMonth() + 1}`.padStart(2, '0')}-${`${d.getDate()}`.padStart(2, '0')}`

async function main() {
  initDb()
  if (process.argv[2] === 'week') {
    const startDate = process.argv[3] ?? fmtDate(new Date(Date.now() - 6 * 86400000))
    const report = await generateWeeklyReport(startDate, undefined, false)
    console.log(
      '=== week:', report.startDate, '~', report.endDate,
      '| aiStatus:', report.aiStatus, '| coverage:', report.coverage.toFixed(2), '| pendingReview:', report.pendingReview.length
    )
    console.log(
      '=== weekStats: work', Math.round(report.weekStats.totalWorkMin), 'min | slack', Math.round(report.weekStats.totalSlackMin),
      'min | daysWithData', report.weekStats.daysWithData, '| avgFocus', report.weekStats.avgFocusScore
    )
    console.log('=== achievements:', report.achievements.length, report.achievements.map((a) => `${a.status}:${a.title}`).join(' | ') || '(无计划)')
    console.log('=== patterns:', report.patterns ? report.patterns.patternTags.join(',') + ' | 碎片化 ' + report.patterns.fragmentationScore : 'null')
    for (const d of report.days) {
      console.log(`  ${d.date} entries=${d.entries.length} work=${Math.round(d.stats.totalWorkMin)}m slack=${Math.round(d.stats.totalSlackMin)}m focus=${d.stats.focusScore}`)
    }
    return
  }
  const y = new Date(Date.now() - 86400000)
  const date = process.argv[2] ?? fmtDate(y)
  const report = await generateReport(date, undefined, false)
  console.log('=== aiStatus:', report.aiStatus, '| coverage:', report.coverage.toFixed(2), '| entries:', report.entries.length, '| pendingReview:', report.pendingReview.length)
  console.log('=== stats: work', Math.round(report.stats.totalWorkMin), 'min | slack', Math.round(report.stats.totalSlackMin), 'min | focus', Math.round(report.stats.focusScore))
  console.log('=== achievements:', report.achievements.length, report.achievements.map((a) => `${a.status}:${a.title}`).join(' | ') || '(无计划)')
  console.log('=== patterns:', report.patterns ? report.patterns.patternTags.join(',') + ' | 碎片化 ' + report.patterns.fragmentationScore : 'null')
  console.log('=== sections:', report.sections.map((s) => `${s.title}(${s.entries.length})`).join(' '))
  for (const e of report.entries.slice(0, 12)) {
    console.log(
      `  [${e.timeSlot}] ${e.stateLabel} ${Math.round(e.durationMin)}m conf=${e.confidence.toFixed(2)} src=${e.dataSource.join('+')}` +
        ` | app=${e.app ?? '-'} subject=${e.subject ?? '-'} content=${e.contentTag ?? '-'} project=${e.project ?? '-'} location=${e.location ?? '-'} output=${e.output ?? '-'}${e.planItemId ? ' plan✓' : ''}`
    )
  }
  // 调试：原始段的 app/title（富化输入是否齐全）
  const { buildMergedTrail } = await import('../src/shared/trail')
  const { listActivities } = await import('../src/main/db')
  const trail = buildMergedTrail(listActivities(date), date)
  console.log('=== raw segments:', trail.segments.length)
  for (const s of trail.segments.filter((s2) => !s2.glance).slice(0, 10)) {
    console.log(`  seg ${s.mainState} app=${s.mainApp ?? '-'} title=${(s.mainTitle ?? '-').slice(0, 50)}`)
  }
}
main().catch((e) => {
  console.error('SMOKE_FAIL', e)
  process.exit(1)
})
