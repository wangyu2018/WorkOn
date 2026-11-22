/**
 * 每日首启简报（FEAT-21）：每天第一次进主窗时出现一次。
 * 内容块可自选（昨天 / 今天 / 提醒），提醒自带「开始 / 延后 / 完成」动作。
 */
import { useEffect, useMemo, useState } from 'react'
import type { MergedTrail, PlanItem } from '@shared/types'
import { dateKey } from '@shared/trail'
import { useSettingsStore } from '../stores/settingsStore'
import { Icon } from './Icon'

interface ReminderLite {
  id: string
  title: string
  recurring: 'daily' | 'once'
  atHHMM?: string
  atTs?: number
  enabled: boolean
  action?: { kind: 'open_view' | 'open_app' | 'run_workflow'; target?: string; label?: string }
}

const fmtMin = (min: number): string => {
  const m = Math.round(min)
  if (m < 60) return `${m} 分钟`
  const h = Math.floor(m / 60)
  const rest = m % 60
  return rest > 0 ? `${h} 小时 ${rest} 分` : `${h} 小时`
}

function hm(ts?: number): string {
  if (!ts) return ''
  return new Date(ts).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
}

export function DailyBriefing(): JSX.Element | null {
  const settings = useSettingsStore((s) => s.settings)
  const loaded = useSettingsStore((s) => s.loaded)
  const [dismissed, setDismissed] = useState(true)
  const [yesterday, setYesterday] = useState<MergedTrail | null>(null)
  const [plans, setPlans] = useState<PlanItem[]>([])
  const [allPlans, setAllPlans] = useState<PlanItem[]>([])
  const [reminders, setReminders] = useState<ReminderLite[]>([])
  const [note, setNote] = useState('')

  const today = dateKey(Date.now())
  const key = `workon:briefing:${today}`

  useEffect(() => {
    if (!loaded) return
    if (settings.briefingEnabled === false) return
    try {
      if (localStorage.getItem(key)) return
    } catch {
      return
    }
    setDismissed(false)
  }, [loaded, settings.briefingEnabled, key])

  useEffect(() => {
    if (dismissed) return
    const yd = dateKey(Date.now() - 86400000)
    void Promise.all([
      (window.api.getTrail?.(yd) as Promise<MergedTrail | null>).catch(() => null),
      (window.api.listPlans?.(today) as Promise<PlanItem[]>).catch(() => []),
      (window.api.listPlans?.() as Promise<PlanItem[]>).catch(() => []),
      (window.api.listReminders?.() as Promise<ReminderLite[]>).catch(() => [])
    ]).then(([t, todayPlans, all, rem]) => {
      setYesterday(t)
      setPlans(Array.isArray(todayPlans) ? todayPlans.filter((p) => !p.archived) : [])
      setAllPlans(Array.isArray(all) ? all.filter((p) => !p.archived) : [])
      setReminders(Array.isArray(rem) ? rem.filter((r) => r.enabled) : [])
    })
  }, [dismissed, today])

  const blocks = settings.briefingBlocks ?? { yesterday: true, today: true, reminders: true }
  const backlog = useMemo(
    () => allPlans.filter((p) => p.status !== 'done' && p.status !== 'cancelled' && p.date < today).length,
    [allPlans, today]
  )
  const yesterdayTop = useMemo(() => {
    const segs = (yesterday?.segments ?? []).filter((s) => !s.glance)
    if (segs.length === 0) return null
    const map = new Map<string, number>()
    for (const s of segs) map.set(s.mainApp, (map.get(s.mainApp) ?? 0) + s.durationMin)
    const top = [...map.entries()].sort((a, b) => b[1] - a[1])[0]
    return top ? top[0] : null
  }, [yesterday])

  const upcoming = useMemo(() => {
    const now = Date.now()
    return [...reminders]
      .filter((r) => r.recurring === 'daily' || (r.atTs ?? 0) > now - 60_000)
      .sort((a, b) => {
        if (a.recurring === 'daily' && b.recurring !== 'daily') return -1
        if (b.recurring === 'daily' && a.recurring !== 'daily') return 1
        return (a.atTs ?? 0) - (b.atTs ?? 0)
      })
      .slice(0, 3)
  }, [reminders])

  if (dismissed) return null

  const close = (): void => {
    try { localStorage.setItem(key, '1') } catch { /* ignore */ }
    setDismissed(true)
  }

  const act = async (r: ReminderLite, kind: 'start' | 'snooze' | 'done'): Promise<void> => {
    if (kind === 'snooze') {
      await window.api.snoozeReminder?.(r.id, 10)
      setReminders((prev) => prev.filter((x) => x.id !== r.id))
      setNote(`已延后 10 分钟：${r.title}`)
      window.setTimeout(() => setNote(''), 2400)
      return
    }
    if (kind === 'done') {
      await window.api.doneReminder?.(r.id)
      setReminders((prev) => prev.filter((x) => x.id !== r.id))
      setNote(`已完成：${r.title}`)
      window.setTimeout(() => setNote(''), 2400)
      return
    }
    const action = r.action
    if (action?.kind === 'open_app' && action.target) {
      await window.api.openApp?.(action.target)
    } else if (action?.kind === 'open_view' && action.target) {
      await window.api.openMain?.(action.target)
      close()
      return
    } else {
      await window.api.openMain?.('plan')
      close()
      return
    }
    setNote(`已执行：${action?.label ?? r.title}`)
    window.setTimeout(() => setNote(''), 2400)
  }

  return (
    <section className="glass-card anim-fade-up !p-4" style={{ borderColor: 'var(--teal-border)' }}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="flex items-center gap-1.5 text-sm font-semibold text-slate-200">
          <Icon name="sparkles" size={14} /> 今日简报
        </span>
        <span className="text-2xs text-slate-500">{new Date().toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' })}</span>
        <div className="ml-auto flex items-center gap-1.5">
          {note ? <span className="text-2xs" style={{ color: 'var(--teal)' }}>{note}</span> : null}
          <button className="glass-btn !px-2 !py-0.5 text-2xs" onClick={close}>开始今天</button>
          <button className="ui-icon-btn h-6 w-6" title="关闭" onClick={close}><Icon name="x" size={11} /></button>
        </div>
      </div>

      <div className="mt-3 flex flex-col gap-2">
        {blocks.yesterday ? (
          <div className="flex items-start gap-2 text-sm leading-relaxed text-slate-300">
            <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: 'var(--text-3)' }} />
            <span>
              昨天活动 {fmtMin(yesterday?.totalMin ?? 0)}
              {yesterdayTop ? `，主要在 ${yesterdayTop}` : ''}。
            </span>
          </div>
        ) : null}

        {blocks.today ? (
          <div className="flex items-start gap-2 text-sm leading-relaxed text-slate-300">
            <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: 'var(--teal)' }} />
            <span>
              今天已排 {plans.length} 项计划
              {plans.filter((p) => p.status === 'done').length > 0 ? `（已完成 ${plans.filter((p) => p.status === 'done').length}）` : ''}
              {plans.length > 0 ? `：${plans.slice(0, 3).map((p) => p.title).join(' / ')}` : '，还没排——说一句「帮我把 X 安排到下午」就行'}
              {backlog > 0 ? `。另有过期未完成 ${backlog} 项，可以说「梳理下我的待办」` : ''}
            </span>
          </div>
        ) : null}

        {blocks.reminders ? (
          upcoming.length > 0 ? (
            <div className="flex flex-col gap-1.5">
              {upcoming.map((r) => (
                <div key={r.id} className="flex flex-wrap items-center gap-2 rounded-lg px-2 py-1.5" style={{ background: 'var(--surface-2)' }}>
                  <span className="text-2xs tabular-nums text-slate-500">{r.recurring === 'daily' ? `每天 ${r.atHHMM ?? ''}` : hm(r.atTs)}</span>
                  <span className="min-w-0 flex-1 truncate text-sm text-slate-200">{r.title}</span>
                  <button className="glass-btn primary !px-2 !py-0.5 text-2xs" onClick={() => void act(r, 'start')}>开始</button>
                  <button className="glass-btn !px-2 !py-0.5 text-2xs" onClick={() => void act(r, 'snooze')}>延后 10 分钟</button>
                  <button className="glass-btn !px-2 !py-0.5 text-2xs" onClick={() => void act(r, 'done')}>完成</button>
                </div>
              ))}
            </div>
          ) : (
            <div className="flex items-start gap-2 text-sm leading-relaxed text-slate-500">
              <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: 'var(--line-strong)' }} />
              <span>今天没有到点提醒。</span>
            </div>
          )
        ) : null}
      </div>
    </section>
  )
}
