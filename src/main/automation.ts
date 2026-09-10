/**
 * MotionLab 自动化引擎（v7）：触发器 → 条件 → 动作
 * 触发器：daily(每天定时) / appSwitch(切到某应用) / focusReached(专注满 Nh)
 * 条件：仅工作日 / 今日专注 ≥ Nh（focusReached 触发器复用该条件做阈值）
 * 动作：genReport(生成今日日报) / petCelebrate(桌宠庆祝) / notify(发通知) / addTodo(建待办)
 * 调度：60s 分钟级 tick（daily）+ monitor 事件钩子（appSwitch / focusReached）
 */
import { col, insertInto, updateIn, removeFrom, listActivities } from './db'
import { getSettings } from './settings'
import { pushNotify } from './notify'
import { dateKey, buildMergedTrail } from '@shared/trail'
import type { PlanItem, AutomationRule, AutomationAction, AutomationTrigger } from '@shared/types'

export type { AutomationAction, AutomationTrigger, AutomationRule }

/** 同一触发键的冷却（秒）：appSwitch/focusReached 事件型防抖 */
const FIRE_COOLDOWN_SEC = 30 * 60

export function listAutomations(): AutomationRule[] {
  return col<AutomationRule>('automations')
}

export function saveAutomation(rule: Partial<AutomationRule> & { name: string; trigger: AutomationTrigger; actions: AutomationAction[] }): AutomationRule {
  const saved = insertInto<AutomationRule>('automations', {
    id: rule.id ?? '',
    name: rule.name,
    enabled: rule.enabled ?? true,
    trigger: rule.trigger,
    minFocusHours: rule.minFocusHours,
    actions: rule.actions,
    lastFiredKey: rule.lastFiredKey,
    lastFiredTs: rule.lastFiredTs
  })
  return saved
}

export function removeAutomation(id: string): boolean {
  return removeFrom('automations', id)
}

const NON_FOCUS_STATES = new Set(['slack', 'relax', 'break', 'lunch', 'idle'])

/** 今日累计专注秒数（非摸鱼/离开段之和；条件判定用，触发频率低可接受） */
function todayFocusSec(): number {
  try {
    const day = dateKey(Date.now())
    const segs = buildMergedTrail(listActivities(day), day).segments.filter((s) => !s.glance)
    let sec = 0
    for (const s of segs) {
      if (!NON_FOCUS_STATES.has(s.mainState)) sec += s.durationMin * 60
    }
    return sec
  } catch {
    return 0
  }
}

export function toggleAutomation(id: string, enabled: boolean): AutomationRule | null {
  return updateIn<AutomationRule>('automations', id, { enabled })
}

// ── 动作执行 ──

async function runActions(rule: AutomationRule): Promise<void> {
  for (const act of rule.actions) {
    try {
      switch (act.kind) {
        case 'genReport': {
          const { generateReport } = await import('./report/engine')
          const today = dateKey(Date.now())
          await generateReport(today, undefined, true)
          pushNotify('report', '自动化 · 日报已就绪', `「${rule.name}」触发：今日日报已生成，等你审阅。`, [
            { label: '查看日报', action: 'open-report', primary: true }
          ], 45)
          break
        }
        case 'petCelebrate': {
          const { emitPetIntent } = await import('./petIntent')
          emitPetIntent('celebrate', {
            message: act.text || `自动化「${rule.name}」完成啦，为你欢呼 🎉`
          })
          break
        }
        case 'notify': {
          pushNotify('ai', `自动化 · ${rule.name}`, act.text || '触发成功。', [
            { label: '知道了', action: 'dismiss', primary: true }
          ], 30)
          break
        }
        case 'addTodo': {
          const title = act.text || rule.name
          insertInto<PlanItem>('plans', {
            id: '',
            date: dateKey(Date.now()),
            title,
            category: 'other',
            planType: 'task',
            status: 'planned',
            source: 'manual',
            ts: Date.now()
          } as unknown as PlanItem)
          break
        }
      }
    } catch {
      // 单个动作失败不阻断后续动作
    }
  }
}

function workdayToday(): boolean {
  const dow = new Date().getDay()
  return dow >= 1 && dow <= 5
}

async function fire(rule: AutomationRule, fireKey: string): Promise<void> {
  const now = Date.now()
  if (rule.lastFiredKey === fireKey && now - (rule.lastFiredTs ?? 0) < FIRE_COOLDOWN_SEC * 1000) return
  // 条件：今日专注 ≥ Nh
  if (rule.minFocusHours != null) {
    if (todayFocusSec() < rule.minFocusHours * 3600) return
  }
  updateIn<AutomationRule>('automations', rule.id, { lastFiredKey: fireKey, lastFiredTs: now })
  rule.lastFiredKey = fireKey
  rule.lastFiredTs = now
  await runActions(rule)
}

/** 分钟级 tick：daily 触发器（引擎自身 60s 节流） */
let lastMinuteTick = 0
export function automationMinuteTick(): void {
  const now = Date.now()
  if (now - lastMinuteTick < 60_000) return
  lastMinuteTick = now
  const s = getSettings()
  if (s.recordingPaused) return
  const hhmm = `${String(new Date().getHours()).padStart(2, '0')}:${String(new Date().getMinutes()).padStart(2, '0')}`
  const fireKey = `${dateKey(now)} ${hhmm}`
  for (const rule of listAutomations()) {
    if (!rule.enabled || rule.trigger.kind !== 'daily' || !rule.trigger.time) continue
    if (rule.trigger.workdayOnly && !workdayToday()) continue
    if (rule.trigger.time === hhmm) void fire(rule, fireKey)
  }
}

/** monitor 钩子：应用切换 */
export function automationOnAppSwitch(appName: string): void {
  void (async () => {
    const s = getSettings()
    if (s.recordingPaused) return
    for (const rule of listAutomations()) {
      if (!rule.enabled || rule.trigger.kind !== 'appSwitch' || !rule.trigger.app) continue
      if (rule.trigger.workdayOnly && !workdayToday()) continue
      if (!appName.includes(rule.trigger.app)) continue
      await fire(rule, `${dateKey(Date.now())}:${rule.id}`)
    }
  })()
}

/** monitor 钩子：连续专注时长变化（focusReached 触发器） */
export function automationOnFocusTick(continuousSec: number): void {
  void (async () => {
    const s = getSettings()
    if (s.recordingPaused) return
    for (const rule of listAutomations()) {
      if (!rule.enabled || rule.trigger.kind !== 'focusReached' || !rule.trigger.focusHours) continue
      if (rule.trigger.workdayOnly && !workdayToday()) continue
      if (continuousSec >= rule.trigger.focusHours * 3600) {
        await fire(rule, `${dateKey(Date.now())}:${rule.id}`)
      }
    }
  })()
}
