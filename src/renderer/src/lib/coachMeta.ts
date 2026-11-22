import type { CoachKind, CoachStatus } from '@shared/coach'
import type { IconName } from '../components/Icon'

export const COACH_KIND_META: Record<CoachKind, { label: string; color: string; icon: IconName }> = {
  plan_due: { label: '计划到点', color: '#60a5fa', icon: 'target' },
  slack_return: { label: '拉回节奏', color: '#a78bfa', icon: 'zap' },
  project_resume: { label: '项目推进', color: '#34d399', icon: 'folder' },
  overwork: { label: '休息提醒', color: '#fbbf24', icon: 'bell' },
  wrap_up: { label: '收尾回顾', color: '#22d3ee', icon: 'chart' },
  check_in: { label: '即时建议', color: '#94a3b8', icon: 'sparkles' }
}

export const COACH_STATUS_META: Record<CoachStatus, { label: string; color: string }> = {
  shown: { label: '待响应', color: '#f59e0b' },
  accepted: { label: '已采纳', color: '#60a5fa' },
  followed: { label: '已跟进', color: '#34d399' },
  missed: { label: '未跟进', color: '#f87171' },
  dismissed: { label: '已忽略', color: '#64748b' },
  expired: { label: '已过期', color: '#475569' }
}
