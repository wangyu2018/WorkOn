/**
 * 星图逻辑层（v6）：不只 UI —— 应用关系图的数据处理
 * - 节点 = 应用，权重 = 近 N 天有效停留时长（glance 段不计）
 * - 连线 = 应用间切换频次（相邻段转移计数，越亮切得越频繁）
 * - 双星团 = 按 work/play 分类分区（media/game = 摸鱼星团，其余 = 工作星团）
 */
import { listActivities } from './db'
import { buildMergedTrail } from '@shared/trail'
import { dateKey } from '@shared/trail'
import { categoryOfWithOverride } from '@shared/appCategory'
import { getSettings } from './settings'
import { matchesExcludedApp } from '@shared/stateMeta'

export interface StarNode {
  app: string
  sec: number
  cluster: 'work' | 'play'
  /** 权重排名：星团内 1=最重（W1），2=W2… */
  weight: number
}

export interface StarEdge {
  from: string
  to: string
  count: number
}

export interface StarGraph {
  nodes: StarNode[]
  edges: StarEdge[]
  /** 切换总次数（连线粗细归一用） */
  totalSwitches: number
  days: number
}

const PLAY_CATEGORIES = new Set(['media', 'game'])

export function starGraphForDays(days = 7): StarGraph {
  const nodeSec = new Map<string, number>()
  const edgeCount = new Map<string, number>()
  const override = getSettings().appCategoryOverride
  const now = Date.now()

  for (let i = 0; i < days; i++) {
    const d = dateKey(now - i * 86400_000)
    let segments
    try {
      segments = buildMergedTrail(listActivities(d), d).segments
    } catch {
      continue
    }
    const valid = segments
      .filter((s) => !s.glance && s.mainApp)
      .sort((a, b) => a.startTs - b.startTs)

    let prev: string | null = null
    for (const seg of valid) {
      const app = seg.mainApp
      nodeSec.set(app, (nodeSec.get(app) ?? 0) + seg.durationMin * 60)
      if (prev && prev !== app) {
        const key = `${prev}→${app}`
        edgeCount.set(key, (edgeCount.get(key) ?? 0) + 1)
      }
      prev = app
    }
  }

  // 分类 + 星团内权重排名
  const clusterSec = new Map<string, number>()
  const clusterOf = new Map<string, 'work' | 'play'>()
  for (const [app, sec] of nodeSec) {
    const cat = categoryOfWithOverride(app, override)
    if ((getSettings().privacyExcludedApps ?? []).some((e) => matchesExcludedApp(app, [e]))) continue
    const cluster: 'work' | 'play' = PLAY_CATEGORIES.has(cat) ? 'play' : 'work'
    clusterOf.set(app, cluster)
    clusterSec.set(app, sec)
  }
  const byCluster: Record<'work' | 'play', string[]> = { work: [], play: [] }
  for (const app of nodeSec.keys()) {
    const c = clusterOf.get(app) ?? 'work'
    byCluster[c].push(app)
  }
  const rank = new Map<string, number>()
  for (const c of ['work', 'play'] as const) {
    byCluster[c]
      .sort((a, b) => (nodeSec.get(b) ?? 0) - (nodeSec.get(a) ?? 0))
      .forEach((app, i) => rank.set(app, i + 1))
  }

  const nodes: StarNode[] = [...nodeSec.entries()]
    .map(([app, sec]) => ({ app, sec, cluster: clusterOf.get(app) ?? 'work', weight: rank.get(app) ?? 99 }))
    .sort((a, b) => b.sec - a.sec)
    .slice(0, 14)

  const keep = new Set(nodes.map((n) => n.app))
  let totalSwitches = 0
  const edges: StarEdge[] = [...edgeCount.entries()]
    .map(([key, count]) => {
      const [from, to] = key.split('→')
      totalSwitches += count
      return { from, to, count }
    })
    .filter((e) => keep.has(e.from) && keep.has(e.to))
    .sort((a, b) => b.count - a.count)
    .slice(0, 30)

  return { nodes, edges, totalSwitches, days }
}
