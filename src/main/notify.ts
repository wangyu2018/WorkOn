/**
 * 应用内通知中心（v7）：四类通知卡（日报就绪/休息提醒/AI发现/时段修正）
 * - 广播到悬浮窗渲染层堆栈展示，带自动过期与操作按钮
 * - 操作按钮回调 main 分发（打开日报/稍后/撤销修正…）
 */
import { ipcMain } from 'electron'
import { sendTo } from './windows'
import { genId } from '@shared/types'

export type NotifyKind = 'report' | 'rest' | 'ai' | 'correction' | 'generic'

export interface NotifyAction {
  label: string
  /** 预置动作：open-report / open-qa / snooze / dismiss（自定义动作直接写 handler） */
  action: string
  primary?: boolean
}

export interface NotifyCard {
  id: string
  kind: NotifyKind
  title: string
  body: string
  time: number
  ttlSec: number
  actions: NotifyAction[]
}

const pending = new Map<string, NotifyCard>()
const timers = new Map<string, ReturnType<typeof setTimeout>>()

/** 推送一条应用内通知（悬浮窗堆栈展示） */
export function pushNotify(kind: NotifyKind, title: string, body: string, actions: NotifyAction[] = [], ttlSec = 30): NotifyCard {
  const card: NotifyCard = {
    id: genId('nt'),
    kind,
    title,
    body,
    time: Date.now(),
    ttlSec,
    actions
  }
  pending.set(card.id, card)
  sendTo('widget', 'notify', card)
  const t = setTimeout(() => expire(card.id), ttlSec * 1000)
  timers.set(card.id, t)
  return card
}

function expire(id: string): void {
  pending.delete(id)
  const t = timers.get(id)
  if (t) clearTimeout(t)
  timers.delete(id)
  sendTo('widget', 'notify-expired', id)
}

/** 注册 IPC：通知操作回调 */
export function registerNotifyIpc(openMainView: (view?: string) => void): void {
  ipcMain.handle('notify:action', (_e, id: string, action: string) => {
    expire(id)
    switch (action) {
      case 'open-report':
        openMainView('report')
        break
      case 'open-qa':
        openMainView('qa')
        break
      case 'snooze':
        // 稍后提醒：30 分钟后再推一次休息提醒
        setTimeout(() => pushNotify('rest', '休息提醒', '之前约定的休息时间到啦，起来活动一下吧～', [
          { label: '知道了', action: 'dismiss', primary: true }
        ]), 30 * 60 * 1000)
        break
      default:
        break
    }
  })
}

/** 通知数（托盘 tooltip 等场景备用） */
export function pendingNotifyCount(): number {
  return pending.size
}
