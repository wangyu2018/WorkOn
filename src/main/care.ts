/**
 * 桌宠关怀调度器（v7 分工原则：悬浮窗管工作，桌宠只管你）
 * - 节律关怀：连续工作 ≥ 阈值 → 休息提醒（气泡 + 通知卡），一次会话内不重复轰炸
 * - 里程碑庆祝：今日完成待办数超过昨日全天 → 庆祝一次
 * - 免打扰：petDndUntilTs 期间静默；petCareEnabled 总开关
 */
import { col } from './db'
import { getSettings, setSettings } from './settings'
import { bus } from './state'
import { pushNotify } from './notify'
import { dateKey } from '@shared/trail'
import { getFocusChainState } from './focusChain'
import type { PlanItem } from '@shared/types'

/** 连续工作提醒阈值（秒）：2h */
const CONTINUOUS_WORK_SEC = 2 * 3600
/** 提醒冷却（秒）：同一次连续工作段只提醒一次；重新活跃重置 */
const CARE_COOLDOWN_SEC = 45 * 60

let lastContinuousSec = 0
let lastCareAt = 0
let lastMilestoneDay = ''
let lastHour = -1
let lastCallAt = 0

/** 连续工作秒数（presence 侧维护的 continuousFocusSec 透传，monitor 每 tick 更新） */
export function reportContinuousWork(sec: number): void {
  lastContinuousSec = sec
}

function doneCount(day: string): number {
  return col<PlanItem>('plans').filter((p) => p.date === day && p.status === 'done').length
}

function dndActive(): boolean {
  return Date.now() < (getSettings().petDndUntilTs ?? 0)
}

/** 每 tick 调用（内部 60s 节流） */
export function careTick(): void {
  const now0 = Date.now()
  if (now0 - lastCallAt < 60_000) return
  lastCallAt = now0
  const s = getSettings()
  if (s.recordingPaused) return
  if (!s.petCareEnabled || dndActive()) return

  const now = Date.now()

  // ── 节律关怀：连续工作 2h → 休息提醒
  //    时机尊重注意力：链路活跃（正专注）时耐心等，等链路断掉的自然瞬间再递上
  const chainActive = getFocusChainState().active
  if (
    lastContinuousSec >= CONTINUOUS_WORK_SEC &&
    !chainActive &&
    now - lastCareAt > CARE_COOLDOWN_SEC * 1000
  ) {
    lastCareAt = now
    const h = Math.floor(lastContinuousSec / 3600)
    bus.setPet({ message: `你已经连续坐了 ${h} 小时啦，肩膀是不是有点僵？起来倒杯水、看看窗外～` })
    pushNotify('rest', '连续专注提醒', `你已经专注 ${h} 小时啦，起来接杯水，让眼睛也放个假。`, [
      { label: '开始休息', action: 'dismiss', primary: true },
      { label: '30 分钟后叫我', action: 'snooze' }
    ], 40)
    return
  }

  // ── 里程碑庆祝：今日完成待办 > 昨日全天（每天最多一次，且 ≥3 件才有庆祝意义） ──
  const day = dateKey(now)
  if (lastMilestoneDay !== day) {
    const today = doneCount(day)
    const yesterday = doneCount(dateKey(now - 86400_000))
    if (today >= 3 && today > yesterday) {
      lastMilestoneDay = day
      bus.setPet({ message: `今天已经干完 ${today} 个待办，比昨天多 ${Math.max(1, today - yesterday)} 个，别对自己太狠 🎉` })
      pushNotify('ai', '里程碑达成', `今日已完成 ${today} 个待办，超过昨天全天。奖励自己休息 5 分钟吧～`, [
        { label: '太好了', action: 'dismiss', primary: true }
      ], 30)
    }
  }

  // 整点轻问候（工作时间）：每小时一条，语气短
  const hour = new Date().getHours()
  if (hour !== lastHour) {
    lastHour = hour
    if (hour >= 10 && hour <= 21 && hour % 2 === 0) {
      const msgs: Record<number, string> = {
        10: '上午好，状态不错的话把硬任务放这段～',
        12: '午休时间到，吃饭要专心吃 🍚',
        14: '午后容易困，来杯茶？',
        16: '下午茶时间，站起来伸个懒腰吧',
        18: '傍晚了，看看今天的待办还剩几个',
        20: '夜深了哦，别熬太晚',
        21: '再一小时就收拾收工吧 🌙'
      }
      const m = msgs[hour]
      if (m) bus.setPet({ message: m })
    }
  }
}
