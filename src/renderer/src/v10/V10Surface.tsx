/**
 * v10「一面一角色」主表面
 * 左问右表 + 提醒中心 + 快捷回复协议 + 首启三步 + 块进化（拖组件入对话→参数 diff 就地重渲染）
 * 数据全部来自现有主进程 IPC（单一事实源）：plans / trail / presence / qa / reminders / notify。
 * 详见 docs/UI-DESIGN-SPEC-v10.md
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { PlanItem, TrailSegment, PresenceSnapshot, GoalView, GoalDraft, ChatSession } from '@shared/types'
import { AskPane, type ChatMsg, type ObjectChipData } from './AskPane'
import { PaperPane, type FeedItem } from './PaperPane'
import { parseReminderIntent, parseGoalIntent, parseScheduleProposal } from './nlu'
import { FlowMap } from './FlowMap'
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
  const [goals, setGoals] = useState<GoalView[]>([])
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
  /** 日程提议待确认（快捷回复 ① 建带确认器的提醒） */
  const pendingProposalRef = useRef<{ msgIndex: number; proposal: { whenLabel: string; event: string; atHHMM?: string; atTs?: number; isMeeting: boolean } } | null>(null)
  /** 待确认的预期拆解草稿（确认创建/重新拆解/算了） */
  const pendingGoalRef = useRef<{ msgIndex: number; sourceText: string; draft: GoalDraft } | null>(null)
  /** 块进化：挂在输入场的对象芯片 */
  const [objectChip, setObjectChip] = useState<ObjectChipData | null>(null)
  const [now, setNow] = useState(Date.now())
  const [archived, setArchived] = useState<FeedItem[]>([])
  const [aiOn, setAiOn] = useState<boolean | null>(null)
  const [showFlowMap, setShowFlowMap] = useState(false)
  const [mindMapText, setMindMapText] = useState<string | null>(null)
  const [sessions, setSessions] = useState<ChatSession[]>([])
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)
  /** 会话中所有 AI 回复统一走这里（纯数据入参；IPC 绝不放 setChat updater——StrictMode 双调用会双写） */
  const pushAI = useCallback((msgs: ChatMsg[]) => {
    setChat((c) => [...c, ...msgs])
    if (activeSessionId) {
      for (const m of msgs) {
        if (m.role === 'ai') void window.api?.addSessionItem?.(activeSessionId, { role: 'ai', text: m.text, time: Date.now() })
      }
    }
  }, [activeSessionId])

  const reloadPlans = useCallback(() => {
    void window.api?.listPlans?.().then((p) => setPlans((p as PlanItem[]) ?? []))
  }, [])
  const reloadGoals = useCallback(() => {
    void window.api?.listGoals?.().then((g) => setGoals((g as GoalView[]) ?? []))
  }, [])
  const reloadTrail = useCallback(() => {
    void window.api?.getTrail?.().then((t) => {
      const merged = t as { segments?: TrailSegment[] } | null
      setTrail(Array.isArray(merged?.segments) ? merged!.segments : [])
    })
  }, [])

  useEffect(() => {
    reloadPlans()
    reloadGoals()
    reloadTrail()
    void window.api?.listReminders?.().then((r) => setReminders((r as typeof reminders) ?? []))
    const offP = window.api?.onPlanUpdated?.(() => reloadPlans())
    const offS = window.api?.onPresence?.((p) => setPresence(p as PresenceSnapshot))
    const offR = window.api?.onReminderFired?.((r) => {
      const tag = r.confirmed ? '✓ 已自动确认' : (r.origin ?? 'user') === 'system' ? '系统记录提醒' : '你的提醒'
      setChat((c) => {
        const opts = ['知道了', '晚 10 分钟再提']
        const next = [
          ...c,
          { role: 'ai' as const, text: `⏰【${tag}】${r.title}${r.atHHMM ? `（${r.atHHMM}）` : ''}`, options: opts }
        ]
        optionsRef.current = { msgIndex: next.length - 1, options: opts }
        return next
      })
    })
    // 消息总线（v10 §5 折下接真）：现有 pushNotify 四类卡落折下，TTL 倒计时消亡
    const offN = window.api?.onNotify?.((raw) => {
      const card = raw as { id: string; title: string; body: string; time: number; ttlSec: number; kind?: string }
      setFeed((f) => [
        { kind: 'notify', id: card.id, title: card.title, body: card.body, time: card.time, ttlSec: Math.max(card.ttlSec, 25), keep: card.kind === 'report' || card.kind === 'correction' },
        ...f
      ])
    })
    void window.api?.getPresence?.().then((p) => setPresence((p as PresenceSnapshot) ?? null))
    void window.api?.getSettings?.().then((st) => setAiOn(!!(st as { aiEnabled?: boolean })?.aiEnabled))
    void window.api?.listSessions?.().then((x) => setSessions((x as ChatSession[]) ?? []))
    // 秒级 tick：时钟 + 折下 TTL（keep 类到期转归档，fade 类消亡）
    const tick = window.setInterval(() => {
      setNow(Date.now())
      setFeed((f) => {
        const expired = f.filter((x) => Date.now() - x.time > x.ttlSec * 1000)
        if (!expired.length) return f
        setArchived((a) => [...expired.filter((x) => x.keep), ...a])
        return f.filter((x) => Date.now() - x.time <= x.ttlSec * 1000)
      })
    }, 1000)
    const timer = window.setInterval(() => {
      reloadTrail()
      reloadGoals()
    }, 60_000)
    return () => {
      offP?.()
      offS?.()
      offR?.()
      offN?.()
      window.clearInterval(tick)
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
      if (raw.startsWith('__page__')) {
        setMindMapText(raw.slice(8))
        setChat((c) => [...c, { role: 'ai', text: '思维导图落右页了——那边宽，看全貌。' }])
        return
      }
      if (raw === '__flowmap__') {
        setShowFlowMap(true)
        setChat((c) => [...c, { role: 'ai', text: '状态导图落右页了——实线是你实际走过的，虚线是计划和锚点建议你去的地方。' }])
        return
      }
      if (raw.startsWith('__chip__')) {
        try {
          setObjectChip(JSON.parse(raw.slice(8)) as ObjectChipData)
        } catch { /* ignore */ }
        return
      }
      const text = raw.trim()
      if (!text || asking) return
      setChat((c) => [...c, { role: 'user', text }])
      if (activeSessionId) void window.api?.addSessionItem?.(activeSessionId, { role: 'user', text, time: Date.now() })

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

      // ── 快捷回复协议：回数字 = 应答最近一条带选项的消息（全角数字归一：中文输入法 １２３） ──
      const normalized = text.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0)).trim()
      const num = /^([1-4])[．.、，,]?\s*$/.exec(normalized)
      if (num && !optionsRef.current && pendingGoalRef.current) {
        // 确认卡被后续通知顶掉时自动复挂（用户回 1 不能石沉大海）
        const g = pendingGoalRef.current
        const msg = chat[g.msgIndex]
        if (msg?.options) {
          optionsRef.current = { msgIndex: g.msgIndex, options: msg.options }
          setChat((c) => c.map((m, i) => (i === g.msgIndex ? { ...m, options: msg.options } : m)))
        }
      }
      if (num && optionsRef.current) {
        const pending = optionsRef.current
        const picked = pending.options[parseInt(num[1], 10) - 1]
        if (!picked) return
        optionsRef.current = null
        setChat((c) => c.map((m, i) => (i === pending.msgIndex ? { ...m, options: undefined, picked } : m)))
        // 预期拆解确认卡
        if (pendingGoalRef.current && pendingGoalRef.current.msgIndex === pending.msgIndex) {
          const { sourceText, draft } = pendingGoalRef.current
          pendingGoalRef.current = null
          if (picked.includes('确认创建')) {
            void window.api
              ?.createGoal?.({
                sourceText,
                event: draft.event,
                deadline: draft.deadline,
                keywords: draft.keywords,
                projectIds: draft.projectIds,
                dailyTargetMin: draft.dailyTargetMin,
                anchors: draft.anchors
              })
              .then(() => {
                reloadGoals()
                pushAI([{ role: 'ai', text: `立了。右页「人生预期」开始盯轨——「${draft.event}」，${draft.deadline} 见分晓。` }])
              })
          } else if (picked.includes('重新拆')) {
            setAsking(true)
            void window.api
              ?.decomposeGoal?.(sourceText, '重新拆一版')
              .then((d) => {
                const draft = d as GoalDraft | null
                if (!draft) {
                  setChat((c) => [...c, { role: 'ai', text: '还是没拆出来——说得再具体点，或者直接说「算了」。' }])
                  return
                }
                const anchorsText = draft.anchors.map((a) => `  · ${a.targetDate} ${a.title}`).join('\n')
                const kw = draft.keywords.length ? `\n归因关键词：${draft.keywords.join('、')}` : ''
                const opts = ['确认创建', '重新拆一版', '算了']
                setChat((c) => {
                  const next = [
                    ...c,
                    {
                      role: 'ai' as const,
                      text: `重拆了一版（${draft.source === 'ai' ? 'AI' : '本地'}）：「${draft.event}」→ ${draft.deadline}\n每天应投入约 ${draft.dailyTargetMin} 分钟${kw}\n锚点轨迹：\n${anchorsText}`,
                      options: opts
                    }
                  ]
                  optionsRef.current = { msgIndex: next.length - 1, options: opts }
                  pendingGoalRef.current = { msgIndex: next.length - 1, sourceText, draft }
                  return next
                })
              })
              .finally(() => setAsking(false))
          } else {
            setChat((c) => [...c, { role: 'ai', text: '好，不立了。' }])
          }
          return
        }
        if (pendingProposalRef.current && pendingProposalRef.current.msgIndex === pending.msgIndex) {
          const { proposal } = pendingProposalRef.current
          pendingProposalRef.current = null
          if (picked.includes('提醒我')) {
            const leadTs = proposal.atTs ? proposal.atTs - 5 * 60_000 : undefined
            void window.api?.addReminder?.({
              title: `${proposal.event}（入会）`,
              recurring: 'daily',
              atHHMM: proposal.atHHMM,
              atTs: leadTs ?? proposal.atTs,
              origin: 'user',
              confirmKeywords: proposal.isMeeting ? ['meeting'] : undefined
            })
            setReminders((list) => [...list, { id: `tmp${Date.now()}`, title: `${proposal.event}（入会）`, atHHMM: proposal.atHHMM }])
            pushAI([{ role: 'ai', text: `好——${proposal.whenLabel} 的「${proposal.event}」我会提前 5 分钟叫你${proposal.isMeeting ? '；到点若检测到你已入会就自动确认，不打扰' : ''}。` }])
          } else {
            pushAI([{ role: 'ai', text: '好，不打扰。' }])
          }
          return
        }
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

      // ── 日程提议（v10：识别消息里的时间+事件，主动问要不要提前提醒；入会类自动挂行为确认） ──
      const proposal = parseScheduleProposal(normalized)
      if (proposal) {
        const lead = proposal.isMeeting ? '提前 5 分钟' : ''
        setChat((c) => {
          const opts = [`${lead}提醒我`, '不用了']
          const next = [
            ...c,
            {
              role: 'ai' as const,
              text: `${proposal.whenLabel}有个「${proposal.event}」——${proposal.isMeeting ? '到点我会看你是否已入会，在会里就不打扰；' : ''}要我提醒你吗？`,
              options: opts
            }
          ]
          optionsRef.current = { msgIndex: next.length - 1, options: opts }
          pendingProposalRef.current = { msgIndex: next.length - 1, proposal }
          return next
        })
        return
      }

      // ── 对话控制台（v10：问答开启任何功能；规则先行，意图判定后续接 jev） ──
      const cmd = /^(开启|打开|启用|关闭|停用|显示|隐藏)\s*(虚拟角色|桌宠|搭子|悬浮窗|待办树|待办小组件|深度模式|忙时轻档|天气|AI|键鼠|行为探针)\s*$/.exec(normalized)
      if (cmd) {
        const on = /^(开启|打开|启用|显示)$/.test(cmd[1])
        const kw = cmd[2]
        const FIELD: Record<string, string> = {
          '虚拟角色': 'petEnabled', '桌宠': 'petEnabled', '搭子': 'petEnabled',
          '悬浮窗': 'widgetVisible', '待办树': 'todoWidgetVisible', '待办小组件': 'todoWidgetVisible',
          '深度模式': 'deepMode', '忙时轻档': 'loadGuardEnabled', '天气': 'weatherEnabled',
          'AI': 'aiEnabled', '键鼠': 'inputProbeEnabled', '行为探针': 'inputProbeEnabled'
        }
        const field = FIELD[kw]
        if (field) {
          void window.api?.setSettings?.({ [field]: on } as never)
          pushAI([{ role: 'ai', text: `${on ? '开' : '关'}了${kw} ✦（生效即可见，桌宠/悬浮窗的开关会即时创建或收起窗口）` }])
          return
        }
      }
      if (/^(镜|设置|打开设置)$/.test(normalized)) {
        void window.api?.openMain?.()
        setChat((c) => [...c, { role: 'ai', text: '镜开了（旧版设置页）——例程、习惯、隐私都在那边，v10 会逐步把它们搬进来。' }])
        return
      }

      // ── 人生预期意图（v10 人生规划模拟）：「我想在X前做到Y」→ AI拆锚点→确认卡 ──
      const goalIntent = parseGoalIntent(text)
      if (goalIntent) {
        setAsking(true)
        void window.api
          ?.decomposeGoal?.(text)
          .then((d) => {
            const draft = d as GoalDraft | null
            if (!draft) {
              setChat((c) => [
                ...c,
                { role: 'ai', text: '听着像个目标，但我没听出截止时间——带上「年底前」「三个月后」「6 月前」这类时间锚点再跟我说一次。' }
              ])
              return
            }
            const anchorsText = draft.anchors.map((a) => `  · ${a.targetDate} ${a.title}`).join('\n')
            const kw = draft.keywords.length ? `\n归因关键词：${draft.keywords.join('、')}` : ''
            const pj = draft.projectIds.length ? `\n建议绑定项目：${draft.projectIds.length} 个（按名称命中，可在目标卡上改）` : ''
            const opts = ['确认创建', '重新拆一版', '算了']
            setChat((c) => {
              const next = [
                ...c,
                {
                  role: 'ai' as const,
                  text: `拆好了（${draft.source === 'ai' ? 'AI' : '本地'}拆解）：「${draft.event}」→ ${draft.deadline}\n每天应投入约 ${draft.dailyTargetMin} 分钟${kw}${pj}\n锚点轨迹：\n${anchorsText}\n确认就开始盯轨（回 1/2/3）。`,
                  options: opts
                }
              ]
              optionsRef.current = { msgIndex: next.length - 1, options: opts }
              pendingGoalRef.current = { msgIndex: next.length - 1, sourceText: text, draft }
              return next
            })
          })
          .catch(() => {
            setChat((c) => [...c, { role: 'ai', text: '拆解失败——稍后再试，或说得再具体些。' }])
          })
          .finally(() => setAsking(false))
        return
      }

      // ── 我的提醒清单 ──
      if (/^(我的?提醒|提醒清单|有哪些提醒)$/.test(normalized)) {
        void window.api?.listReminders?.().then((list) => {
          const rs = (list as Array<{ id: string; title: string; atHHMM?: string; recurring: string; origin?: string; enabled: boolean }>).filter((x) => x.enabled)
          if (!rs.length) {
            pushAI([{ role: 'ai', text: '还没有提醒。说「晚上 9 点提醒我看日报」就能建一条。' }])
            return
          }
          const mine = rs.filter((x) => (x.origin ?? 'user') === 'user')
          const sys = rs.filter((x) => x.origin === 'system')
          const fmt = (arr: typeof rs) => arr.map((x) => `  · ${x.atHHMM ?? '定时'} ${x.title}`).join('\n') || '  （无）'
          pushAI([{ role: 'ai', text: `你的提醒（${mine.length}）：\n${fmt(mine)}\n系统记录提醒（${sys.length}）：\n${fmt(sys)}` }])
        })
        return
      }

      // ── 建提醒意图（本地规则，v10 §4 第六去向；歧义判定后续接 jev choice 小题） ──
      const intent = parseReminderIntent(text)
      if (intent) {
        const isMeeting = /(会|会议|评审|面试|例会)/.test(intent.title) || /(开会|入会|评审|例会|会议)/.test(text)
        void window.api
          ?.addReminder?.({ title: intent.title, recurring: intent.recurring, atHHMM: intent.atHHMM, atTs: intent.atTs, origin: 'user', confirmKeywords: isMeeting ? ['meeting'] : undefined })
          .then((r) => {
            setReminders((list) => [...list, r as { id: string; title: string; atHHMM?: string }])
            // optionsRef 赋值是幂等 ref 写，安全；IPC 一律走 pushAI 纯数据
            const opts = ['就这么定', '不用了']
            pushAI([{ role: 'ai', text: `好——${intent.whenLabel}提醒你「${intent.title}」。`, options: opts }])
            optionsRef.current = { msgIndex: chat.length, options: opts }
          })
        return
      }

      // ── 状态类问句：文字回答 + 「状态导图」可拆件 chip（点一下落右页） ──
      if (/当前状态|什么状态|在干嘛|在做什么|现在干|状态导图|画个?图/.test(normalized)) {
        const st = presence?.state
        const summary = st
          ? `此刻：${st === 'other' ? '在电脑前（细分识别中）' : `${st}`}${presence?.screens?.[0]?.app ? ` · ${presence.screens[0].app}` : ''}。下面给你拆了张状态导图——实线是实际轨迹，虚线是建议去的地方。`
          : '采集还没出数据，导图会空一阵。'
        setChat((c) => {
          const next = [...c, { role: 'ai' as const, text: summary, attach: 'flowmap' as const }]
          return next
        })
        return
      }

      // ── 常规问答走现有 qa 管道（会话中：回答同步写回 session） ──
      setAsking(true)
      void window.api
        ?.askQA?.(text)
        .then((r) => {
          const content =
            typeof r === 'string' ? r : ((r as { content?: string })?.content ?? '（没有回答）')
          pushAI([{ role: 'ai', text: content }])
        })
        .catch(() => {
          pushAI([{ role: 'ai', text: '这个问题暂时答不上来（AI 未配置或网络异常）。' }])
        })
        .finally(() => setAsking(false))
    },
    [asking, reminders, objectChip, blockParams, reloadGoals, pushAI, activeSessionId]
  )

  const markAnchor = useCallback(
    (goalId: string, anchorId: string, status: 'hit' | 'pending') => {
      void window.api?.updateGoal?.(goalId, { markAnchor: { anchorId, status } }).then(() => reloadGoals())
    },
    [reloadGoals]
  )
  const patchGoal = useCallback(
    (goalId: string, patch: unknown) => {
      void window.api?.updateGoal?.(goalId, patch).then(() => reloadGoals())
    },
    [reloadGoals]
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
        sessions={sessions}
        activeSessionId={activeSessionId}
        onSessionRenamed={(id, title) => setSessions((list) => list.map((x) => (x.id === id ? { ...x, title } : x)))}
        onSessionRemoved={(id) => setSessions((list) => list.filter((x) => x.id !== id))}
        onEnterSession={(id) => {
          if (id === '__list__') {
            // 会话列表视图：临时用 null 但显示列表——简化：开抽屉提示
            setChat((c) => [...c, { role: 'ai', text: `现有 ${sessions.length} 个会话：${sessions.slice(0, 5).map((x) => `「${x.title}」`).join(' ')}。说会话名可进入（下批做列表视图）。` }])
            return
          }
          setActiveSessionId(id)
        }}
        onAddToSession={(msgIndex, sessionId, topic) => {
          const m = chat[msgIndex]
          if (!m) return
          if (sessionId) {
            void window.api?.addSessionItem?.(sessionId, { role: m.role, text: m.text, time: Date.now() })
            setChat((c) => [...c, { role: 'ai', text: '收进会话了——在左栏顶部「会话」里可继续追问。' }])
          } else if (topic) {
            setArchived((a) => [{ kind: 'notify', id: `mg${Date.now()}`, title: m.text.slice(0, 16) || '归档件', body: m.text, time: Date.now(), ttlSec: 3600, keep: true, topic }, ...a])
            setChat((c) => [...c, { role: 'ai', text: `归档到「${topic === 'project' ? '项目' : '生活'}」了——右页归档抽屉可查。` }])
          } else {
            const s2 = window.api?.createSession?.({ first: { role: m.role, text: m.text, time: Date.now() } })
            void s2?.then((x) => {
              setSessions((list) => [x as ChatSession, ...list])
              setChat((c) => [...c, { role: 'ai', text: `新会话「${(x as ChatSession).title}」建好了。` }])
            })
          }
        }}
      />
      <PaperPane
        dateLabel={dateLabel}
        plans={plans}
        goals={goals}
        onMarkAnchor={markAnchor}
        onGoalPatch={patchGoal}
        trail={trail}
        presence={presence}
        onTogglePlan={togglePlan}
        onExit={props.onExit}
        onboardStep={onboardStep !== 3 ? onboardStep : undefined}
        onOnboardFinish={finishOnboard}
        feed={feed}
        archived={archived}
        blockParams={blockParams}
        onDropBlock={(b) => setObjectChip(b)}
        now={now}
        aiOn={aiOn}
        showFlowMap={showFlowMap}
        mindMapText={mindMapText}
        onCloseMindMap={() => setMindMapText(null)}
        onFeedReorder={(from, to) => {
          setFeed((f) => {
            const next = [...f]
            const [m] = next.splice(from, 1)
            next.splice(to, 0, m)
            return next
          })
        }}
      />
    </div>
  )
}
