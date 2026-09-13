/**
 * 专注判定 v2「链路思维」（v7 核心）
 * 链路 = 一段连续的工作活动（IDE → AI问答 → 文档 这类高频切换序列）。
 * 规则：
 *  - 链路内切换应用不打断、全部计入专注（适配大模型时代的碎片化工作）
 *  - 摸鱼类状态（slack/relax/break/lunch）持续 ≥ SLACK_BREAK_SEC 才判定为「摸鱼中断」：
 *    链路切断、此前时长保留、中断计数 +1（瞬时误判不切碎链路）
 *  - 离开（idle ≥ IDLE_BREAK_SEC）同样切断链路，但不计摸鱼中断（缺口 = 会议/离开自动跳过）
 *  - focusChainV2 = false 时回退 v1 口径（本模块休眠，presence 严格判定）
 */
import { dateKey } from '@shared/trail'
import type { WorkState } from '@shared/types'

/** 摸鱼持续超过该秒数 → 链路切断（打断计数） */
const SLACK_BREAK_SEC = 45
/** 离开持续超过该秒数 → 链路切断（不计中断） */
const IDLE_BREAK_SEC = 120

export interface FocusChainState {
  /** 当前链路是否活跃 */
  active: boolean
  /** 当前链路开始时间戳（ms） */
  startTs: number
  /** 当前链路持续秒数 */
  sec: number
  /** 链路内应用及停留秒数（按首达序） */
  apps: { app: string; sec: number }[]
  /** 今日摸鱼中断次数 */
  interruptionsToday: number
  /** 今日最长链路秒数 */
  longestChainSecToday: number
  /** 今日已完成链路数 */
  chainsToday: number
}

interface ChainRuntime {
  day: string
  startTs: number | null
  apps: { app: string; sec: number }[]
  appIdx: Map<string, number>
  slackSince: number | null
  idleSince: number | null
  interruptions: number
  longest: number
  chains: number
}

let rt: ChainRuntime = freshDay(dateKey(Date.now()))

function freshDay(day: string): ChainRuntime {
  return {
    day,
    startTs: null,
    apps: [],
    appIdx: new Map(),
    slackSince: null,
    idleSince: null,
    interruptions: 0,
    longest: 0,
    chains: 0
  }
}

const SLACK_STATES: ReadonlySet<string> = new Set(['slack', 'relax', 'break', 'lunch'])

function closeChain(rt: ChainRuntime, endTs: number): void {
  if (rt.startTs == null) return
  const sec = Math.max(0, Math.round((endTs - rt.startTs) / 1000))
  if (sec >= 30) {
    rt.chains++
    if (sec > rt.longest) rt.longest = sec
  }
  rt.startTs = null
  rt.apps = []
  rt.appIdx.clear()
  rt.slackSince = null
  rt.idleSince = null
}

/** 每 tick（约 2s）调用一次；excluded 应用与 recordingPaused 时传 app='' + state='idle' */
export function focusChainTick(ts: number, app: string, state: WorkState, idleSec: number, enabled: boolean): void {
  const day = dateKey(ts)
  if (day !== rt.day) rt = freshDay(day)
  if (!enabled) return

  const noWork = !app || state === 'idle'
  // AI 生成时人在盯流式输出：idle 容忍与状态软化同口径（aidev/aiqa 180s 才算离开）
  const effectiveIdle = state === 'aidev' || state === 'aiqa' ? Math.max(0, idleSec - 60) : idleSec
  idleSec = effectiveIdle

  if (noWork || SLACK_STATES.has(state)) {
    const since = rt.slackSince ?? ts
    rt.slackSince = since
    // 离开判定（不区分摸鱼/离开的细分，交给中断计数与否）
    if (idleSec >= IDLE_BREAK_SEC) {
      rt.idleSince = rt.idleSince ?? since
      closeChain(rt, since)
      return
    }
    // 摸鱼判定：持续 ≥ 阈值 → 打断
    if (SLACK_STATES.has(state) && ts - since >= SLACK_BREAK_SEC * 1000) {
      rt.interruptions++
      closeChain(rt, since)
      return
    }
    // 未达阈值的短暂摸鱼/离开：链路保持（计入链路时长，切换不切碎）
    if (rt.startTs != null) accumulate(ts)
    return
  }

  // 工作状态：从摸鱼/离开恢复
  rt.slackSince = null
  rt.idleSince = null
  if (rt.startTs == null) {
    rt.startTs = ts
    rt.apps = []
    rt.appIdx.clear()
  }
  const i = rt.appIdx.get(app)
  if (i == null) {
    rt.appIdx.set(app, rt.apps.length)
    rt.apps.push({ app, sec: 0 })
  }
  accumulate(ts)
}

let lastAccumTs = 0
function accumulate(ts: number): void {
  const delta = lastAccumTs ? Math.min(10, Math.max(0, (ts - lastAccumTs) / 1000)) : 0
  lastAccumTs = ts
  if (rt.apps.length && delta > 0) {
    // 均摊到链路内应用（当前应用权重更大更准确，但 tick 内无 state 参数，均摊足够）
    const each = delta / rt.apps.length
    for (const a of rt.apps) a.sec += each
  }
}

/** 悬浮窗/首页读取当前链路状态 */
export function getFocusChainState(): FocusChainState {
  const now = Date.now()
  const sec = rt.startTs != null ? Math.max(0, Math.round((now - rt.startTs) / 1000)) : 0
  return {
    active: rt.startTs != null,
    startTs: rt.startTs ?? now,
    sec,
    apps: rt.apps.map((a) => ({ app: a.app, sec: Math.round(a.sec) })).sort((x, y) => y.sec - x.sec).slice(0, 5),
    interruptionsToday: rt.interruptions,
    longestChainSecToday: rt.longest,
    chainsToday: rt.chains
  }
}

/** 供测试/重置 */
export function resetFocusChain(): void {
  rt = freshDay(dateKey(Date.now()))
  lastAccumTs = 0
}
