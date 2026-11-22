/**
 * 今日闭环助手卡：显示当前可执行提示 + 今日闭环统计
 * 与悬浮卡共用同一份 coach 状态；这里常驻在首页首屏，避免提示过期后看不到
 */
import type { CoachCard } from '@shared/coach'
import { useCoach } from '../lib/useCoach'
import { COACH_KIND_META, COACH_STATUS_META } from '../lib/coachMeta'
import { Icon } from './Icon'

export function CoachToday() {
  const { state, act, evaluate, snooze } = useCoach()
  const now = Date.now()
  const active = state.items.find((c) => c.status === 'shown')
  const latest: CoachCard | undefined = active ?? state.items[0]
  const snoozed = state.snoozeUntil > now
  const stats = state.stats

  return (
    <section className="glass-card !p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="flex items-center gap-1.5 text-sm font-semibold text-slate-200">
          <Icon name="bell" size={14} />
          闭环助手
        </span>
        <span className="text-xs text-slate-500">
          今日 {stats.shown} 次提示 · 采纳 {stats.accepted} · 已跟进 {stats.followed}
          {stats.accepted > 0 ? ` · 跟进率 ${Math.round(stats.followRate * 100)}%` : ''}
        </span>
        <div className="ml-auto flex items-center gap-1.5">
          {snoozed ? (
            <>
              <span className="text-2xs text-slate-600">
                静默至 {new Date(state.snoozeUntil).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
              </span>
              <button className="glass-btn !px-2 !py-1 text-2xs" onClick={() => void snooze(0)}>
                取消静默
              </button>
            </>
          ) : (
            <button className="glass-btn !px-2 !py-1 text-2xs" onClick={() => void snooze(30)}>
              静默 30 分钟
            </button>
          )}
          <button className="glass-btn !px-2 !py-1 text-2xs" onClick={() => void evaluate()}>
            现在评估
          </button>
        </div>
      </div>

      {latest ? (
        <div className="mt-3 flex flex-col gap-2 rounded-xl p-3" style={{ background: 'var(--surface-2)' }}>
          <div className="flex flex-wrap items-center gap-2">
            <span className="flex items-center gap-1 text-2xs" style={{ color: COACH_KIND_META[latest.kind].color }}>
              <Icon name={COACH_KIND_META[latest.kind].icon} size={12} />
              {COACH_KIND_META[latest.kind].label}
            </span>
            <span className="text-2xs text-slate-600">
              {new Date(latest.ts).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
            </span>
            <span
              className="ml-auto rounded-full px-1.5 py-0.5 text-2xs"
              style={{ color: COACH_STATUS_META[latest.status].color, background: 'var(--surface-3)' }}
            >
              {COACH_STATUS_META[latest.status].label}
            </span>
          </div>
          <div className="text-sm font-medium leading-snug text-slate-200">{latest.title}</div>
          <div className="text-xs leading-relaxed text-slate-400">{latest.body}</div>
          <div className="text-2xs leading-relaxed text-slate-600">依据：{latest.reason}</div>
          <div className="flex flex-wrap items-center gap-1.5">
            {latest.status === 'shown' ? (
              latest.actions.map((a) => (
                <button
                  key={a.key}
                  className={`rounded-lg px-2.5 py-1 text-xs ${a.primary ? 'glass-btn primary' : 'glass-btn'}`}
                  onClick={() => void act(latest.id, a.key)}
                >
                  {a.label}
                </button>
              ))
            ) : latest.status === 'followed' ? (
              <span className="text-2xs" style={{ color: COACH_STATUS_META.followed.color }}>
                ✓ 已检测到你进入工作，这次提示闭环完成
              </span>
            ) : latest.status === 'missed' ? (
              <span className="text-2xs text-slate-500">10 分钟内没有检测到进入工作——下次我换个更小的切入点</span>
            ) : null}
          </div>
        </div>
      ) : (
        <div className="mt-3 rounded-xl p-3 text-xs leading-relaxed text-slate-500" style={{ background: 'var(--surface-2)' }}>
          监控在后台运行：计划到点、连续摸鱼、项目停摆或专注过久时，会在这里给你一条可执行的提示，并根据你的动作继续验证结果。
        </div>
      )}
    </section>
  )
}
