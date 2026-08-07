/**
 * 双屏合并轨迹 —— 墙钟合并算法
 * 依据：PRD.md F2「并行屏只按墙钟计一次总时长（不重复累加），保留各屏独立占用分钟」
 */
import type { ActivityRecord, MergedTrail, TrailSegment, WorkState } from './types'
import { WORK_LIKE_STATES } from './stateMeta'

const SEG_GAP_MS = 60 * 1000 // 间隔超 1 分钟切段
const SEG_CAP_MS = 60 * 60 * 1000 // 单段时长封顶 1h，避免休眠跳变虚高

export function dateKey(ts: number): string {
  const d = new Date(ts)
  const m = `${d.getMonth() + 1}`.padStart(2, '0')
  const day = `${d.getDate()}`.padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

/** 把一天的 ActivityRecord 合并为 MergedTrail */
export function buildMergedTrail(records: ActivityRecord[], date: string): MergedTrail {
  const sorted = [...records].sort((a, b) => a.ts - b.ts)
  const segments: TrailSegment[] = []
  const screenMinutes: Record<number, number> = {}
  const stateMinutes = {} as Record<WorkState, number>
  let dualMin = 0
  let dualWorkSlackMin = 0
  let glanceMin = 0
  const mainStateCount = {} as Record<WorkState, number>
  const auxStateCount = {} as Record<WorkState, number>

  // 按墙钟把同一时刻的多屏记录聚合
  interface Bucket {
    startTs: number
    endTs: number
    byScreen: Map<number, ActivityRecord[]>
  }
  let cur: Bucket | null = null
  const buckets: Bucket[] = []

  for (const r of sorted) {
    if (!cur || r.ts - cur.endTs > SEG_GAP_MS) {
      if (cur) buckets.push(cur)
      cur = { startTs: r.ts, endTs: r.ts, byScreen: new Map() }
    }
    const list = cur.byScreen.get(r.screen) ?? []
    list.push(r)
    cur.byScreen.set(r.screen, list)
    cur.endTs = Math.max(cur.endTs, r.ts)
  }
  if (cur) buckets.push(cur)

  for (const b of buckets) {
    // 每屏独立占用分钟
    let bucketStart = Infinity
    let bucketEnd = 0
    const screenSpan = new Map<number, { start: number; end: number; top: ActivityRecord }>()
    for (const [screen, rs] of b.byScreen) {
      const start = rs[0].startTs ?? rs[0].ts
      const end = rs[rs.length - 1].ts
      // 选该屏持续时间最长/最新的代表记录
      const top = rs.reduce((a, c) => (c.ts - (c.startTs ?? c.ts) > a.ts - (a.startTs ?? a.ts) ? c : a), rs[0])
      screenSpan.set(screen, { start, end, top })
      bucketStart = Math.min(bucketStart, start)
      bucketEnd = Math.max(bucketEnd, end)
    }
    let spanMs = Math.min(bucketEnd - bucketStart, SEG_CAP_MS)
    if (spanMs < 0) spanMs = 0
    const spanMin = spanMs / 60000

    const activeEntry = [...screenSpan.values()].find((s) => s.top.active) ?? [...screenSpan.values()][0]
    const main = activeEntry.top
    const aux = [...screenSpan.entries()].find(([s]) => s !== main.screen)?.[1] ?? null

    const isDual = screenSpan.size > 1
    if (isDual) {
      dualMin += spanMin
      const mainWork = WORK_LIKE_STATES.includes(main.state)
      const auxSlack = aux ? !WORK_LIKE_STATES.includes(aux.top.state) : false
      if (mainWork && auxSlack) dualWorkSlackMin += spanMin
    }

    for (const [screen, s] of screenSpan) {
      screenMinutes[screen] = (screenMinutes[screen] ?? 0) + Math.min(s.end - s.start, SEG_CAP_MS) / 60000
    }
    // 短切换过滤：停留 <30s 的段标记为 glance（瞄了一眼/路过），不计入状态时长与作业链
    const glance = spanMin < 0.5
    if (glance) {
      glanceMin += spanMin
    } else {
      stateMinutes[main.state] = (stateMinutes[main.state] ?? 0) + spanMin
      mainStateCount[main.state] = (mainStateCount[main.state] ?? 0) + spanMin
    }
    if (aux) auxStateCount[aux.top.state] = (auxStateCount[aux.top.state] ?? 0) + spanMin

    segments.push({
      id: `s${bucketStart}`,
      startTs: bucketStart,
      endTs: bucketEnd,
      durationMin: spanMin,
      mainState: main.state,
      auxState: aux ? aux.top.state : null,
      mainApp: main.appName ?? main.app,
      auxApp: aux ? (aux.top.appName ?? aux.top.app) : null,
      mainTitle: main.title,
      auxTitle: aux ? aux.top.title : undefined,
      screens: [...screenSpan.keys()],
      glance
    })
  }

  const totalMin = segments.reduce((a, s) => a + s.durationMin, 0)
  const top = (c: Record<string, number>): WorkState | null => {
    const e = Object.entries(c).sort((a, b) => b[1] - a[1])[0]
    return e ? (e[0] as WorkState) : null
  }

  return {
    date,
    totalMin,
    dualMin,
    dualRatio: totalMin > 0 ? dualMin / totalMin : 0,
    screenMinutes,
    mainState: top(mainStateCount) ?? 'idle',
    auxTopState: top(auxStateCount),
    dualWorkSlackMin,
    glanceMin,
    segments,
    stateMinutes
  }
}
