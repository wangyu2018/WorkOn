/**
 * v10「一面一角色」主表面
 * 左问右表 + 提醒中心 + 快捷回复协议 + 首启三步 + 块进化（拖组件入对话→参数 diff 就地重渲染）
 * 数据全部来自现有主进程 IPC（单一事实源）：plans / trail / presence / qa / reminders / notify。
 * 详见 docs/UI-DESIGN-SPEC-v10.md
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { PlanItem, TrailSegment, PresenceSnapshot } from '@shared/types'
import { AskPane, type ChatMsg, type ObjectChipData } from './AskPane'
import { PaperPane, type FeedItem } from './PaperPane'
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

/** 块参数（块进化 diff 的作用对象；v10 §4.C：改参数不改画） */
export interface BlockParams {
  timelineDays: 1 | 7 | 14
}

export default function V10Surface(props: { onExit?: () => void }): JSX.Element {
  const [plans, setPlans] = useState<PlanItem[]>([])
  const [trail, setTrail] = useState<TrailSegment[]>([])
  const [presence, setPresence] = useState<PresenceSnapshot | null>(null)
  const [reminders, setReminders] = useState<Array<{ id: string; title: string; atHHMM?: string }>>([])
  const [feed, setFeed] = useState<FeedItem[]>([])
  const [blockParams, setBlockParams] = useState<BlockParams>({ timelineDays: 1 })
  const [chat, setChat] = useState<ChatMsg[]>([
    { role: 'ai', text: '早上好。右页是你的版面——今天的计划和轨迹会自己长出来；抓着右页的栏目拖到输入框，还能直接指挥它变。' }
  ])
  const [asking, setAsking] = useState(false)
  const [onboardStep, setOnboardStep] = useState<OnboardStep>(loadOnboardStep)
  const scrollRef = useRef<HTMLDivElement>(null)
  /** 快捷回复协议：最近一条带选项的消息 index → 选项数组；回 1/2 即答 */
  const optionsRef = useRef<{ msgIndex: number; options: string[] } | null>(null)
  /** 块进化：挂在输入场的对象芯片 */
  const [objectChip, setObjectChip] = useState<ObjectChipData | null>(null)

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
        const opts = ['知道了', '晚 10 分钟再提']
        const next = [
          ...c,
          { role: 'ai' as const, text: `⏰ 到点了：${r.title}${r.atHHMM ? `（${r.atHHMM}）` : ''}`, options: opts }
        ]
        optionsRef.current = { msgIndex: next.length - 1, options: opts }
        return next
      })
    })
    // 消息总线（v10 §5 折下接真）：现有 pushNotify 四类卡落折下，TTL 倒计时消亡
    const offN = window.api?.onNotify?.((raw) => {
      const card = raw as { id: string; title: string; body: string; time: number; ttlSec: number }
      setFeed((f) => [
        { kind: 'notify', id: card.id, title: card.title, body: card.body, time: card.time, ttlSec: card.ttlSec },
        ...f
      ])
    })
    void window.api?.getPresence?.().then((p) => setPresence((p as PresenceSnapshot) ?? null))
    const timer = window.setInterval(reloadTrail, 60_000)
    return () => {
      offP?.()
      offS?.()
      offR?.()
      offN?.()
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
      // 对象芯片挂载（AskPane drop 转发的内部协议，不上屏）
      if (raw.startsWith('__chip__')) {
        try {
          setObjectChip(JSON.parse(raw.slice(8)) as ObjectChipData)
        } catch { /* ignore */ }
        return
      }
      const text = raw.trim()
      if (!text || asking) return
      setChat((c) => [...c, { role: 'user', text }])

      // ── 全局撤销（v10 §4.C：块进化的可召回；无需重新拖芯片） ──
      if (/(换回来|撤销|还原)/.test(text)) {
        setBlockParams({ timelineDays: 1 })
        setChat((c) => [...c, { role: 'ai', text: '换回今天的轨迹了。' }])
        return
      }

      // ── 块进化（v10 §4.C）：挂着对象芯片时，指令只作用于该块（改参数不改画） ──
      if (objectChip) {
        const chip = objectChip
        setObjectChip(null)
        const daysMatch = /(最近|近|这)?\s*(\d{1,2})\s*天/.exec(text)
        if (chip.blockKey === 'timeline' && daysMatch) {
          const days = Math.max(1, Math.min(14, parseInt(daysMatch[2], 10)))
          const next: BlockParams = { ...blockParams, timelineDays: days as BlockParams['timelineDays'] }
          setBlockParams(next)
          setChat((c) => [
            ...c,
            { role: 'ai', text: `好，轨迹改成最近 ${days} 天了（旧版本在账里，说「换回来」可召回）。` }
          ])
          return
        }
        setChat((c) => [
          ...c,
          { role: 'ai', text: `收到——想调整「${chip.label}」。现在能听懂的：「最近 N 天」（时间窗）、「换回来」（撤销）。更多调整（换图表/改粒度）在学。` }
        ])
        return
      }

      // ── 快捷回复协议：回数字 = 应答最近一条带选项的消息 ──
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

      // ── 建提醒意图（本地规则，v10 §4 第六去向；歧义判定后续接 jev choice 小题） ──
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

      // ── 常规问答走现有 qa 管道 ──
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
    [asking, reminders, objectChip, blockParams]
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
        objectChip={objectChip}
        onClearChip={() => setObjectChip(null)}
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
        feed={feed}
        blockParams={blockParams}
        onDropBlock={(b) => setObjectChip(b)}
      />
    </div>
  )
}
