/**
 * 日视角（Day Perspective）：一个人的一天 = 一家公司的一天。
 * 晨=架构师定方向 / 昼=工作者干活 / 晚=管理者复盘。
 * 视角是「模式」不是新页面：决定首页块编排与导航收敛，不新增数据层。
 */
export type Perspective = 'architect' | 'worker' | 'manager'

export const PERSPECTIVES: Perspective[] = ['architect', 'worker', 'manager']

export const PERSPECTIVE_META: Record<
  Perspective,
  { label: string; short: string; emoji: string; desc: string; range: string }
> = {
  architect: { label: '架构师', short: '晨', emoji: '🌅', desc: '定方向 · 今天干什么', range: '05:00–10:00' },
  worker: { label: '工作者', short: '昼', emoji: '🛠️', desc: '干正事 · 界面退后', range: '10:00–18:00' },
  manager: { label: '管理者', short: '晚', emoji: '📊', desc: '对结果 · 复盘今天', range: '18:00–24:00' }
}

/** 时钟 → 视角。深夜（0–5 点）默认在干活 = 工作者 */
export function autoPerspective(now: Date = new Date()): Perspective {
  const m = now.getHours() * 60 + now.getMinutes()
  if (m >= 300 && m < 600) return 'architect'
  if (m >= 1080) return 'manager'
  return 'worker'
}

/** 手动锁优先，否则按时钟 */
export function resolvePerspective(lock: Perspective | null | undefined, now?: Date): Perspective {
  return lock ?? autoPerspective(now)
}
