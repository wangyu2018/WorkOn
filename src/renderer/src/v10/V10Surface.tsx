/**
 * v10「一面一角色」主表面（P2 骨架 + P3 提醒/协议 + 首启三步卡）
 * 左问右表：左栏 360px 对话流，右栏活页（报头 sticky + 折上版面 + 折线 + 折下 TTL 推送区）。
 * 数据全部来自现有主进程 IPC（单一事实源）：plans / trail / presence / qa / reminders。
 * 详见 docs/UI-DESIGN-SPEC-v10.md
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { PlanItem, TrailSegment, PresenceSnapshot } from '@shared/types'
import { AskPane, type ChatMsg } from './AskPane'
import { PaperPane } from './PaperPane'
import { parseReminderIntent } from './nlu'
import './v10.css'

/** 首启三步卡状态（v10 §2：指引式首启，两分钟） */
type OnboardStep = 0 | 1 | 2 | 3

function loadOnboardStep(): OnboardStep {
  try {
    if (window.localStorage.getItem('v10onboard') === 'done') return 3
  } catch { /* ignore */ }
  return 0
}

export default function V10Surface(props: { onExit?: () => void }): JSX.Element {
  const [plans, setPlans] = useState<PlanItem[]>([])
  const [trail, setTrail] = useState<TrailSegment[]>([])
  const [presence, setPresence] = useState<PresenceSnapshot | null>(null)
  const [reminders, setReminders] = useState<Array<{ id: string; title: string; atHHMM?: string }>>([])
  const [chat, setChat] = useState<ChatMsg[]>([
    { role: 'ai', text: '早上好。右页是你的版面——今天的计划和轨迹会自己长出来；有什么想问的，直接说。' }
  ])
  const [asking, setAsking] = useState(false)
  const [onboardStep, setOnboardStep] = useState<OnboardStep>(loadOnboardStep)
  const scrollRef = useRef<HTMLDivElement>(null)
  /** 快捷回复协议：最近一条带选项的消息 index → 选项数组；回 1/2 即答 */
  const optionsRef = useRef<{ msgIndex: number; options: string[] } | null>(null)

  const reloadPlans = useCallback(() => {
    void window.api?.listPlans?.().then((p) => setPlans((p as PlanItem[]) ?? []))
  }, [])
  const reloadTrail = useCallback(() => {
    void window.api?.getTrail?.().then((t) => {
      const merged = t as { segments?: TrailSegment[] } | null
      setTrail(Array.isArray(merged?.segments) ? merged!.segments : [])
    })
  }, [])

  useEffect(() => {
    reloadPlans()
    reloadTrail()
    void window.api?.listReminders?.().then((r) => setReminders((r as typeof reminders) ?? []))
    const offP = window.api?.onPlanUpdated?.(() => reloadPlans())
    const offS = window.api?.onPresence?.((p) => setPresence(p as PresenceSnapshot))
    const offR = window.api?.onReminderFired?.((r) => {
      setChat((c) => {
        const next = [
          ...c,
          { role: 'ai' as const, text: `⏰ 到点了：${r.title}${r.atHHMM ? `（${r.atHHMM}）` : ''}`, options: ['知道了', '晚 10 分钟再提'] }
        ]
        optionsRef.current = { msgIndex: next.length - 1, options: ['知道了', '晚 10 分钟再提'] }
        return next
      })
    })
    void window.api?.getPresence?.().then((p) => setPresence((p as PresenceSnapshot) ?? null))
    const timer = window.setInterval(reloadTrail, 60_000)
    return () => {
      offP?.()
      offS?.()
      offR?.()
      window.clearInterval(timer)
    }
  }, [reloadPlans, reloadTrail])

  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [chat])

  const finishOnboard = useCallback((payload: { evening?: boolean }) => {
    try {
      window.localStorage.setItem('v10onboard', 'done')
    } catch { /* ignore */ }
    setOnboardStep(3)
    if (payload.evening) {
      void window.api?.addReminder?.({ title: '看今日章', recurring: 'daily', atHHMM: '21:00' }).then((r) => {
        setReminders((list) => [...list, r as { id: string; title: string; atHHMM?: string }])
      })
    }
    setChat((c) => [
      ...c,
      { role: 'ai', text: '版面备好了。以后我说话带 ①② 编号——直接回数字就能答我；说「晚上 9 点提醒我…」我也能记。' }
    ])
  }, [])

  const send = useCallback(
    (raw: string) => {
      const text = raw.trim()
      if (!text || asking) return
      setChat((c) => [...c, { role: 'user', text }])

      // 快捷回复协议：回数字 = 应答最近一条带选项的消息
      const num = /^[12]$/.exec(text)
      if (num && optionsRef.current) {
        const pending = optionsRef.current
        const picked = pending.options[parseInt(num[1], 10) - 1]
        optionsRef.current = null
        setChat((c) => c.map((m, i) => (i === pending.msgIndex ? { ...m, options: undefined, picked } : m)))
        if (picked.includes('晚 10 分钟')) {
          void window.api?.addReminder?.({ title: '稍后再提（延后 10 分钟）', recurring: 'once', atTs: Date.now() + 10 * 60_000 })
          setChat((c) => [...c, { role: 'ai', text: '好，10 分钟后再提一次。' }])
        } else if (picked.includes('不用了')) {
          const last = reminders[reminders.length - 1]
          if (last) void window.api?.removeReminder?.(last.id)
          setReminders((list) => list.slice(0, -1))
          setChat((c) => [...c, { role: 'ai', text: '行，这条不记了。' }])
        } else {
          setChat((c) => [...c, { role: 'ai', text: '好。' }])
        }
        return
      }

      // 建提醒意图（本地规则，v10 §4 第六去向；歧义判定后续接 jev choice 小题）
      const intent = parseReminderIntent(text)
      if (intent) {
        void window.api
          ?.addReminder?.({ title: intent.title, recurring: intent.recurring, atHHMM: intent.atHHMM, atTs: intent.atTs })
          .then((r) => {
            setReminders((list) => [...list, r as { id: string; title: string; atHHMM?: string }])
            setChat((c) => {
              const opts = ['就这么定', '不用了']
              const next = [
                ...c,
                { role: 'ai' as const, text: `好——${intent.whenLabel}提醒你「${intent.title}」。`, options: opts }
              ]
              optionsRef.current = { msgIndex: next.length - 1, options: opts }
              return next
            })
          })
        return
      }

      // 常规问答走现有 qa 管道
      setAsking(true)
      void window.api
        ?.askQA?.(text)
        .then((r) => {
          const content =
            typeof r === 'string' ? r : ((r as { content?: string })?.content ?? '（没有回答）')
          setChat((c) => [...c, { role: 'ai', text: content }])
        })
        .catch(() => {
          setChat((c) => [...c, { role: 'ai', text: '这个问题暂时答不上来（AI 未配置或网络异常）。' }])
        })
        .finally(() => setAsking(false))
    },
    [asking, reminders]
  )

  const togglePlan = useCallback((p: PlanItem) => {
    const next = p.status === 'done' ? 'planned' : 'done'
    setPlans((list) => list.map((x) => (x.id === p.id ? { ...x, status: next } : x)))
    void window.api?.setPlanStatus?.(p.id, next)
  }, [])

  const today = new Date()
  const dateLabel = `${today.getMonth() + 1} 月 ${today.getDate()} 日 · ${['周日', '周一', '周二', '周三', '周四', '周五', '周六'][today.getDay()]}`

  return (
    <div className="v10">
      <AskPane
        chat={chat}
        asking={asking}
        onSend={send}
        scrollRef={scrollRef}
        presence={presence}
      />
      <PaperPane
        dateLabel={dateLabel}
        plans={plans}
        trail={trail}
        presence={presence}
        onTogglePlan={togglePlan}
        onExit={props.onExit}
        onboardStep={onboardStep !== 3 ? onboardStep : undefined}
        onOnboardFinish={finishOnboard}
      />
    </div>
  )
}
