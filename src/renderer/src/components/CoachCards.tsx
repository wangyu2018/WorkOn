/**
 * 闭环助手悬浮提示：监控命中规则时从主进程推送，页面右下角（左）浮出
 * 卡片有时效，动作直接回传主进程；采纳「开始」后会由监控验证是否真的进入工作
 */
import { useEffect, useState } from 'react'
import type { CoachCard } from '@shared/coach'
import { useCoach } from '../lib/useCoach'
import { COACH_KIND_META } from '../lib/coachMeta'
import { Icon } from './Icon'

export function CoachCards() {
  const { state, act } = useCoach()
  const [, setTick] = useState(0)

  // 5s 刷新一次可见性：卡片到期自动收起，不需要用户手动关
  useEffect(() => {
    const t = window.setInterval(() => setTick((n) => n + 1), 5000)
    return () => window.clearInterval(t)
  }, [])

  const now = Date.now()
  const visible = state.items
    .filter((c) => c.status === 'shown' && now - c.ts < Math.max(c.ttlSec, 30) * 1000)
    .slice(0, 2)

  if (!visible.length) return null

  const close = (card: CoachCard): void => {
    void act(card.id, 'expire')
  }

  return (
    <div className="pointer-events-none fixed bottom-4 left-4 z-[62] flex w-[344px] flex-col gap-2">
      {visible.map((card) => {
        const meta = COACH_KIND_META[card.kind]
        const remain = Math.max(0, Math.ceil((card.ts + card.ttlSec * 1000 - now) / 1000))
        return (
          <div
            key={card.id}
            className="pointer-events-auto anim-fade-in overflow-hidden rounded-2xl"
            style={{
              background: 'var(--bg-surface)',
              border: '1px solid var(--line)',
              borderLeft: `3px solid ${meta.color}`,
              boxShadow: 'var(--shadow-lg)'
            }}
          >
            <div className="flex items-center gap-2 px-3 pt-2.5">
              <span className="flex items-center gap-1 text-2xs" style={{ color: meta.color }}>
                <Icon name={meta.icon} size={12} />
                {meta.label}
              </span>
              <span className="text-2xs text-slate-600">{new Date(card.ts).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</span>
              <span className="ml-auto text-2xs text-slate-600">{remain}s</span>
              <button className="ui-icon-btn h-5 w-5" title="收起" onClick={() => close(card)}>
                <Icon name="x" size={11} />
              </button>
            </div>
            <div className="px-3 pb-2 pt-1.5">
              <div className="text-sm font-medium leading-snug text-slate-200">{card.title}</div>
              <div className="mt-1 text-xs leading-relaxed text-slate-400">{card.body}</div>
              <div className="mt-1.5 text-2xs leading-relaxed text-slate-600">依据：{card.reason}</div>
              <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                {card.actions.map((a) => (
                  <button
                    key={a.key}
                    className={`rounded-lg px-2.5 py-1 text-xs transition-colors ${
                      a.primary ? 'glass-btn primary' : 'glass-btn'
                    }`}
                    onClick={() => void act(card.id, a.key)}
                  >
                    {a.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}
