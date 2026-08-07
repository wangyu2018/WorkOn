/**
 * 专注度可解释化：打分一句话 / 注意力评级 / 提升建议
 * 与 presence.ts 的算法同口径（STATE_FOCUS_BASE 唯一来源，禁止另抄一份）
 */
import type { PresenceSnapshot, WorkState } from './types'
import { INPUT_REQUIRED_STATES, WORK_LIKE_STATES, WORK_STATES } from './stateMeta'

/** 各状态基础分（presence.ts focusLevel 公式的基础项） */
export const STATE_FOCUS_BASE: Record<WorkState, number> = {
  focus: 80, coding: 90, aidev: 88, aiqa: 70, writing: 82, meeting: 60,
  remote: 55, slack: 12, relax: 25, idle: 15, break: 30, lunch: 30, away: 5
}

/** 工作态持续奖励上限与斜率（presence.ts 同款：每分钟 +0.5，30 分钟拿满 +15） */
const CONT_BONUS_MAX = 15
const CONT_BONUS_PER_MIN = 0.5
/** 无输入封顶阈值（presence.ts IDLE_DOWNGRADE_SEC 同款） */
const IDLE_CAP_SEC = 60
const IDLE_CAP_SCORE = 40

function minOf(sec: number): number {
  return Math.floor(sec / 60)
}

/** 打分一句话：解释当前 focusLevel 怎么来的 */
export function focusScoreLine(snap: PresenceSnapshot): string {
  const base = STATE_FOCUS_BASE[snap.state]
  const label = WORK_STATES[snap.state].label
  const parts: string[] = [`${label}基础 ${base}`]

  if (WORK_LIKE_STATES.includes(snap.state)) {
    const bonus = Math.min(CONT_BONUS_MAX, (snap.continuousFocusSec / 60) * CONT_BONUS_PER_MIN)
    if (bonus >= 0.5) parts.push(`连续 ${minOf(snap.continuousFocusSec)} 分钟 +${Math.round(bonus)}`)
  }
  const capped = snap.idleSec > IDLE_CAP_SEC && snap.state !== 'away' && base >= IDLE_CAP_SCORE
  if (capped) parts.push(`无输入超 1 分钟，封顶 ${IDLE_CAP_SCORE}`)

  return `${parts.join(' · ')} → ${snap.focusLevel}`
}

export interface AttentionGrade {
  grade: 'S' | 'A' | 'B' | 'C' | 'D'
  label: string
  color: string
}

/** 注意力评级：由实时 focusLevel 分档 */
export function attentionGrade(level: number): AttentionGrade {
  if (level >= 90) return { grade: 'S', label: '深度专注', color: '#FBBF24' }
  if (level >= 75) return { grade: 'A', label: '高效', color: '#10B981' }
  if (level >= 55) return { grade: 'B', label: '平稳', color: '#22D3EE' }
  if (level >= 35) return { grade: 'C', label: '涣散', color: '#F59E0B' }
  return { grade: 'D', label: '离线/摸鱼', color: '#EF4444' }
}

/** 提升专注的一句话建议（规则版；无建议时返回 null） */
export function focusAdvice(snap: PresenceSnapshot): string | null {
  const { state, continuousSlackSec, continuousFocusSec } = snap

  if (state === 'slack') {
    return continuousSlackSec >= 600
      ? `已摸鱼 ${minOf(continuousSlackSec)} 分钟，喝口水站起来走走，回来试试 25 分钟番茄钟`
      : '正在摸鱼——再刷一会儿，还是回去干活？'
  }
  if (state === 'idle') return '键盘安静了一阵子了，回到刚才的任务？'
  if (INPUT_REQUIRED_STATES.includes(state)) {
    if (continuousFocusSec >= 50 * 60) return `已连续专注 ${minOf(continuousFocusSec)} 分钟，很棒了，记得起来活动一下`
    if (continuousFocusSec < 5 * 60) return '刚进入状态，关掉无关标签页更容易沉浸'
  }
  // meeting/remote/relax/break/lunch/away：不打扰
  return null
}
