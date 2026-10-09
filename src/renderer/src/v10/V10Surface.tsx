/**
 * v10「一面一角色」主表面（P2 骨架）
 * 左问右表：左栏 360px 对话流，右栏活页（报头 sticky + 折上版面 + 折线 + 折下 TTL 推送区）。
 * 数据全部来自现有主进程 IPC（单一事实源）：plans / trail / presence / qa ——
 * 本组件不新建任何数据存储，v7 旧版与 v10 读同一份数据。
 * 详见 docs/UI-DESIGN-SPEC-v10.md
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { PlanItem, TrailSegment, PresenceSnapshot } from '@shared/types'
import { AskPane, type ChatMsg } from './AskPane'
import { PaperPane } from './PaperPane'
import './v10.css'

export interface V10Data {
  plans: PlanItem[]
  trail: TrailSegment[]
  presence: PresenceSnapshot | null
}

export default function V10Surface(props: { onExit?: () => void }): JSX.Element {
  const [plans, setPlans] = useState<PlanItem[]>([])
  const [trail, setTrail] = useState<TrailSegment[]>([])
  const [presence, setPresence] = useState<PresenceSnapshot | null>(null)
  const [chat, setChat] = useState<ChatMsg[]>([
    { role: 'ai', text: '早上好。右页是你的版面——今天的计划和轨迹会自己长出来；有什么想问的，直接说。' }
  ])
  const [asking, setAsking] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

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
    const offP = window.api?.onPlanUpdated?.(() => reloadPlans())
    const offS = window.api?.onPresence?.((p) => setPresence(p as PresenceSnapshot))
    void window.api?.getPresence?.().then((p) => setPresence((p as PresenceSnapshot) ?? null))
    const timer = window.setInterval(reloadTrail, 60_000)
    return () => {
      offP?.()
      offS?.()
      window.clearInterval(timer)
    }
  }, [reloadPlans, reloadTrail])

  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [chat])

  const send = useCallback(
    (text: string) => {
      const q = text.trim()
      if (!q || asking) return
      setChat((c) => [...c, { role: 'user', text: q }])
      setAsking(true)
      void window.api
        ?.askQA?.(q)
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
    [asking]
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
      />
    </div>
  )
}
