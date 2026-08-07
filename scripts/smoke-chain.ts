// 冒烟脚本（临时）：用真实 userData 跑 analyzeDayChains，验证 v2.6.1 链路识别引擎
// electron 依赖经 esbuild alias 替换为 ./electron-stub.cjs
// 用法：node smoke-chain.cjs [date]   —— 缺省跑今天和昨天
import { initDb } from '../src/main/db'
import { analyzeDayChains, analyzeTrailSegments } from '../src/main/chain/engine'
import type { ChainDayReport } from '../src/shared/chain'
import type { TrailSegment } from '../src/shared/types'

const fmtDate = (d: Date) =>
  `${d.getFullYear()}-${`${d.getMonth() + 1}`.padStart(2, '0')}-${`${d.getDate()}`.padStart(2, '0')}`
const hhmm = (ts: number) => {
  const d = new Date(ts)
  return `${`${d.getHours()}`.padStart(2, '0')}:${`${d.getMinutes()}`.padStart(2, '0')}`
}

function printReport(r: ChainDayReport) {
  const m = r.metrics
  console.log(`=== ${r.date} userType=${r.userType} | 链路数 ${m.chainCount} | distracted ${Math.round(m.distractedMin)}min | neutral ${Math.round(m.neutralMin)}min`)
  for (const c of r.chains) {
    console.log(
      `  [${c.type}/${c.templateName}] ${hhmm(c.startTs)}-${hhmm(c.endTs)} ${Math.round(c.totalMin)}m conf=${c.confidence.toFixed(2)}` +
        ` status=${c.status} output=${c.hasOutput ? c.outputType : 'none'} switchEff=${(c.switchEfficiency * 100).toFixed(0)}%`
    )
    console.log(`    steps: ${c.steps.map((s) => `${s.app}(${s.role})`).join(' → ')}`)
  }
  console.log(
    `  metrics: chainCount=${m.chainCount} outputRate=${m.chainOutputRate.toFixed(2)} avgChainMin=${m.avgChainMin.toFixed(0)}` +
      ` switchEff=${m.switchEfficiency.toFixed(2)} diversity=${m.chainDiversity} distractedMin=${m.distractedMin.toFixed(1)} neutralMin=${m.neutralMin.toFixed(1)}`
  )
}

function main() {
  initDb()
  const dates = process.argv[2] ? [process.argv[2]] : [fmtDate(new Date()), fmtDate(new Date(Date.now() - 86400000))]
  for (const d of dates) printReport(analyzeDayChains(d))

  // ── 合成场景（办公族）：领导任务执行链 + 链路外刷抖音 + 微切换 ──
  const day = new Date()
  const at = (h: number, m: number) => new Date(day.getFullYear(), day.getMonth(), day.getDate(), h, m).getTime()
  const seg = (app: string, title: string, start: number, min: number): TrailSegment => ({
    id: `syn${start}`, startTs: start, endTs: start + min * 60000, durationMin: min,
    mainState: 'focus', auxState: null, mainApp: app, auxApp: null, mainTitle: title, screens: [0]
  })
  const syn: TrailSegment[] = [
    seg('WeChat', '王总', at(9, 15), 12), // 领导派单 intake
    seg('Office', 'Q3数据汇总.xlsx - Excel', at(9, 28), 40), // 处理
    seg('Cursor', 'analyze.py — Cursor', at(10, 10), 15), // AI 辅助
    seg('Office', 'Q3数据汇总v2.xlsx - Excel', at(10, 27), 18), // 汇总（标题变化→产出信号）
    seg('WeChat', '王总', at(10, 47), 8), // 交付
    seg('Browser', '抖音 - Microsoft Edge', at(11, 30), 25), // 链路外分心
    seg('Video', 'PotPlayer', at(12, 10), 2) // 微切换 <3min → neutral
  ]
  console.log('=== synthetic office_worker 场景 ===')
  printReport(analyzeTrailSegments(fmtDate(day), 'office_worker', syn))
}
main()
