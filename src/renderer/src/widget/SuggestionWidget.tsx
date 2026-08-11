/**
 * 右下角悬浮窗（PRD F12 + 问题 7/12）：
 * 状态 + 桌宠气泡 + 轻问诊确认/否定 + 浏览器计划匹配确认 + 折叠态问答输入 + 透明度 + 展开收起
 */
import { useEffect, useRef, useState } from 'react'
import type { SuggestionQuestion } from '@shared/types'
import { WORK_STATES } from '@shared/stateMeta'
import { attentionGrade, focusScoreLine } from '@shared/focusMeta'
import { usePresenceStore } from '../stores/presenceStore'
import { useSettingsStore } from '../stores/settingsStore'

interface BrowserPlanConfirm {
  planId: string
  planTitle: string
  keyword: string
  browserTitle: string
  app: string
}

type AskState = 'hidden' | 'input' | 'thinking' | 'answer'

export default function SuggestionWidget() {
  const presence = usePresenceStore((s) => s.presence)
  const pet = usePresenceStore((s) => s.pet)
  const aiEnabled = useSettingsStore((s) => s.settings.aiEnabled)
  const [question, setQuestion] = useState<SuggestionQuestion | null>(null)
  const [bpConfirm, setBpConfirm] = useState<BrowserPlanConfirm | null>(null)
  const [meetingDetected, setMeetingDetected] = useState<{ app: string; title: string } | null>(null)
  const [meetingActive, setMeetingActive] = useState<{ mode: 'stealth' | 'quiet' | 'assist'; sinceTs: number } | null>(null)
  const meetingActiveRef = useRef<{ mode: 'stealth' | 'quiet' | 'assist'; sinceTs: number } | null>(null)
  meetingActiveRef.current = meetingActive
  const [meetingSetDefault, setMeetingSetDefault] = useState(false)
  // 会议辅助计时：每 30s 强制刷新一次显示
  const [, setTimerTick] = useState(0)
  useEffect(() => {
    if (!meetingActive) return
    const t = window.setInterval(() => setTimerTick((n) => n + 1), 30_000)
    return () => window.clearInterval(t)
  }, [meetingActive])
  const [opacity, setOpacity] = useState(0.92)
  const [collapsed, setCollapsed] = useState(false)
  const [welcome, setWelcome] = useState(false)
  const [askState, setAskState] = useState<AskState>('hidden')
  const [askText, setAskText] = useState('')
  const [askAnswer, setAskAnswer] = useState('')
  const dragRef = useRef<{ x: number; y: number } | null>(null)
  const blurTimer = useRef<number | null>(null)

  useEffect(() => {
    const cleanup = usePresenceStore.getState().init()
    window.api.getQuestion().then((q) => setQuestion(q as SuggestionQuestion | null)).catch(() => undefined)
    const offQ = window.api.onQuestion((q) => setQuestion(q as SuggestionQuestion | null))
    const offBP = window.api.onBrowserPlanConfirm((p) => {
      setBpConfirm(p as BrowserPlanConfirm)
      setCollapsed(false) // 浏览器计划确认时自动展开
    })
    const offW = window.api.onWelcomeBack(() => {
      setWelcome(true)
      setTimeout(() => setWelcome(false), 3000)
    })
    // 会议检测：ask 弹选项；预设模式直接执行
    const offMD = window.api.onMeetingDetected((p) => {
      const payload = p as { app: string; title: string }
      window.api.getSettings().then((s) => {
        const mode = s.meetingMode ?? 'ask'
        if (mode === 'ask') {
          setMeetingDetected(payload)
          setCollapsed(false)
        } else {
          applyMeetingMode(mode, true, Date.now())
        }
      })
    })
    const offME = window.api.onMeetingEnded(() => {
      const cur = meetingActiveRef.current
      if (cur) {
        window.api.meetingApply({ mode: cur.mode, active: false, sinceTs: cur.sinceTs })
        setMeetingActive(null)
        setOpacity(0.92)
      }
    })
    window.api.getSettings().then((s) => setOpacity(s.widgetOpacity)).catch(() => undefined)

    return () => {
      cleanup()
      offQ()
      offBP()
      offW()
      offMD()
      offME()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 拖拽（独立于 StrictMode 重装载，避免事件重复绑定）
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!dragRef.current) return
      const dx = e.clientX - dragRef.current.x
      const dy = e.clientY - dragRef.current.y
      if (dx || dy) {
        window.api.dragWidget(dx, dy)
        dragRef.current = { x: e.clientX, y: e.clientY }
      }
    }
    const onUp = () => { dragRef.current = null }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [])

  const state = presence?.state ?? 'idle'
  const meta = WORK_STATES[state] ?? WORK_STATES.idle
  const focus = presence?.focusLevel ?? 0
  const R = 21
  const CIRC = 2 * Math.PI * R

  /** 轻问诊确认：带浏览器来源信息（区分浏览器确认与手动确认） */
  const answer = (a: 'yes' | 'no') => {
    if (!question) return
    const main = presence?.screens?.find((s) => s.screen === presence.mainScreen)
    void window.api.confirmQuestion({
      qid: question.id,
      ctx: question.ctx,
      question: question.question,
      answer: a,
      browserInfo: main ? { app: main.app, title: main.title } : undefined
    })
    setQuestion(null)
  }

  const answerBrowserPlan = (a: 'yes' | 'no') => {
    if (!bpConfirm) return
    void window.api.confirmBrowserPlan(bpConfirm.planId, a)
    setBpConfirm(null)
  }

  /** 会议模式应用（本地状态 + 主进程执行） */
  const applyMeetingMode = (mode: 'stealth' | 'quiet' | 'assist', active: boolean, sinceTs: number) => {
    window.api.meetingApply({ mode, active, sinceTs: active ? undefined : sinceTs })
    if (active) {
      setMeetingActive({ mode, sinceTs })
      if (mode === 'quiet') setOpacity(0.3) // 免打扰：悬浮窗降透明
      setMeetingDetected(null)
    } else {
      setMeetingActive(null)
      setOpacity(0.92)
    }
  }

  const chooseMeetingMode = (mode: 'stealth' | 'quiet' | 'assist') => {
    if (meetingSetDefault) void window.api.setSettings({ meetingMode: mode })
    applyMeetingMode(mode, true, Date.now())
  }

  /** 折叠态问答：思考中 → 回复 → 5s 收起 */
  const submitAsk = async () => {
    const q = askText.trim()
    if (!q) return
    setAskText('')
    setAskState('thinking')
    try {
      const ans = (await window.api.petAsk(q)) as string
      setAskAnswer(ans)
    } catch {
      setAskAnswer('出了一点小问题，晚点再聊吧~')
    }
    setAskState('answer')
    window.setTimeout(() => {
      setAskState('hidden')
      setAskAnswer('')
    }, 5000)
  }

  const onAskBlur = () => {
    if (askText.trim()) return
    blurTimer.current = window.setTimeout(() => setAskState('hidden'), 3000)
  }

  return (
    <div className="flex h-screen w-screen items-stretch justify-center p-2" style={{ opacity }}>
      <div className="glass relative flex w-full flex-col overflow-hidden rounded-2xl border border-white/10 bg-ink-900/80 shadow-glass backdrop-blur-md">
        {/* 拖动区 */}
        <div
          className="flex h-9 shrink-0 cursor-move items-center justify-between border-b border-white/5 px-3 select-none"
          onMouseDown={(e) => (dragRef.current = { x: e.clientX, y: e.clientY })}
        >
          <span className="text-xs font-medium tracking-wider text-slate-400">WorkOn</span>
          <div className="flex items-center gap-1">
            <button
              className="rounded p-1 text-slate-500 hover:bg-white/10 hover:text-slate-300"
              onClick={() => setCollapsed(!collapsed)}
              title={collapsed ? '展开' : '收起'}
            >
              {collapsed ? '▸' : '▾'}
            </button>
            <button
              className="rounded p-1 text-slate-500 hover:bg-white/10 hover:text-slate-300"
              onClick={() => window.api.toggleWidget()}
              title="隐藏悬浮窗"
            >
              ✕
            </button>
          </div>
        </div>

        {welcome && (
          <div className="mx-3 mt-2 rounded-lg bg-neon-green/15 px-3 py-1.5 text-center text-xs text-neon-green">
            欢迎回到正事 🎯
          </div>
        )}

        {/* 状态区 */}
        <div className="flex items-center gap-3 px-4 py-3">
          <div className="relative h-14 w-14 shrink-0">
            <svg viewBox="0 0 56 56" className="h-14 w-14 -rotate-90">
              <circle cx="28" cy="28" r={R} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="4" />
              <circle
                cx="28" cy="28" r={R} fill="none"
                stroke={meta.color} strokeWidth="4" strokeLinecap="round"
                strokeDasharray={CIRC}
                strokeDashoffset={CIRC * (1 - focus / 100)}
                style={{ transition: 'stroke-dashoffset 400ms ease-out' }}
              />
            </svg>
            <div className="absolute inset-0 flex items-center justify-center text-lg">{meta.emoji}</div>
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold" style={{ color: meta.color }}>
              {meta.label}{' '}
              <span
                className="text-xs text-slate-500"
                title={presence ? `专注度怎么算的：${focusScoreLine(presence)}\n评级 ${attentionGrade(focus).grade}（S≥90 / A≥75 / B≥55 / C≥35 / D<35）` : undefined}
              >
                · 专注度 {focus} · {attentionGrade(focus).grade}
              </span>
            </div>
            <div className="mt-0.5 truncate text-xs text-slate-400">
              {presence?.screens?.find((s) => s.screen === presence.mainScreen)?.title || '等待采集…'}
            </div>
            {presence && presence.continuousFocusSec > 60 && (
              <div className="mt-0.5 text-xs text-neon-cyan">
                已专注 {Math.round(presence.continuousFocusSec / 60)} 分钟
              </div>
            )}
          </div>
          {/* 折叠态问答入口 */}
          {collapsed && aiEnabled ? (
            <button
              className="shrink-0 rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-white/10 hover:text-neon-cyan"
              title="问点什么…"
              onClick={() => setAskState(askState === 'hidden' ? 'input' : 'hidden')}
            >
              💬
            </button>
          ) : null}
        </div>

        {/* 折叠态问答条（input/thinking/answer 三态） */}
        {collapsed && askState !== 'hidden' ? (
          <div className="mx-3 mb-2 transition-all">
            {askState === 'input' ? (
              <input
                autoFocus
                className="w-full rounded-full border border-neon-cyan/30 bg-white/[0.06] px-3 py-1.5 text-xs text-slate-200 outline-none placeholder:text-slate-600"
                placeholder="问点什么…（回车发送）"
                value={askText}
                onChange={(e) => {
                  setAskText(e.target.value)
                  if (blurTimer.current) window.clearTimeout(blurTimer.current)
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void submitAsk()
                  if (e.key === 'Escape') setAskState('hidden')
                }}
                onBlur={onAskBlur}
              />
            ) : askState === 'thinking' ? (
              <div className="flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs text-slate-400">
                <span className="pulse-dot inline-block h-1.5 w-1.5 rounded-full bg-neon-cyan" />
                思考中…
              </div>
            ) : (
              <div className="max-h-20 overflow-hidden rounded-xl rounded-bl-sm border border-neon-cyan/20 bg-neon-cyan/10 px-3 py-2 text-xs leading-relaxed text-neon-cyan">
                {askAnswer}
              </div>
            )}
          </div>
        ) : null}

        {!collapsed && (
          <>
            {/* 桌宠气泡 */}
            {pet?.message && (
              <div className="mx-3 mb-2 rounded-xl rounded-bl-sm border border-neon-cyan/20 bg-neon-cyan/10 px-3 py-2 text-xs text-neon-cyan">
                🐾 {pet.message}
              </div>
            )}

            {/* 浏览器计划匹配确认 */}
            {bpConfirm ? (
              <div className="mx-3 mb-2 rounded-xl border border-neon-blue/30 bg-neon-blue/10 p-3">
                <div className="mb-1 text-[11px] font-medium text-neon-blue">🌐 浏览器检测</div>
                <div className="mb-2 text-xs leading-relaxed text-slate-200">
                  检测到你在浏览与计划【{bpConfirm.planTitle}】相关的内容，你在做这项计划吗？
                </div>
                <div className="flex gap-2">
                  <button
                    className="flex-1 rounded-lg bg-neon-green/20 py-1.5 text-xs text-neon-green transition-colors hover:bg-neon-green/30"
                    onClick={() => answerBrowserPlan('yes')}
                  >
                    是，在做这个
                  </button>
                  <button
                    className="flex-1 rounded-lg bg-white/5 py-1.5 text-xs text-slate-400 transition-colors hover:bg-white/10"
                    onClick={() => answerBrowserPlan('no')}
                  >
                    不是
                  </button>
                </div>
              </div>
            ) : null}

            {/* 会议检测选项 */}
            {meetingDetected ? (
              <div className="mx-3 mb-2 rounded-xl border border-neon-amber/30 bg-neon-amber/10 p-3">
                <div className="mb-1 text-[11px] font-medium text-neon-amber">👥 会议检测</div>
                <div className="mb-2 text-xs leading-relaxed text-slate-200">
                  检测到你正在使用 {meetingDetected.app.replace(/\.exe$/i, '')} 开会，选择会议模式：
                </div>
                <div className="flex gap-1.5">
                  <button
                    className="flex-1 rounded-lg bg-white/[0.08] py-1.5 text-[11px] text-slate-200 transition-colors hover:bg-white/[0.14]"
                    onClick={() => chooseMeetingMode('stealth')}
                  >
                    🤫 一键隐身
                  </button>
                  <button
                    className="flex-1 rounded-lg bg-white/[0.08] py-1.5 text-[11px] text-slate-200 transition-colors hover:bg-white/[0.14]"
                    onClick={() => chooseMeetingMode('quiet')}
                  >
                    🔇 免打扰
                  </button>
                  <button
                    className="flex-1 rounded-lg bg-white/[0.08] py-1.5 text-[11px] text-slate-200 transition-colors hover:bg-white/[0.14]"
                    onClick={() => chooseMeetingMode('assist')}
                  >
                    📝 会议辅助
                  </button>
                </div>
                <label className="mt-2 flex cursor-pointer items-center gap-1.5 text-[10px] text-slate-500">
                  <input type="checkbox" checked={meetingSetDefault} onChange={(e) => setMeetingSetDefault(e.target.checked)} />
                  以后都这样（可在设置中修改）
                </label>
              </div>
            ) : null}

            {/* 会议辅助计时（自动递增 + 手动结束） */}
            {meetingActive?.mode === 'assist' ? (
              <div className="mx-3 mb-2 flex items-center gap-2 rounded-xl border border-neon-green/25 bg-neon-green/10 px-3 py-2">
                <span className="text-xs text-neon-green">📝</span>
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-medium text-neon-green">
                    会议辅助中 · {Math.max(1, Math.round((Date.now() - meetingActive.sinceTs) / 60000))} 分钟
                  </div>
                  <div className="text-[10px] text-neon-green/60">每 15 分钟报时提醒</div>
                </div>
                <button
                  className="shrink-0 rounded-lg border border-neon-green/30 px-2 py-1 text-[10px] text-neon-green transition-colors hover:bg-neon-green/15"
                  onClick={() => applyMeetingMode('assist', false, meetingActive.sinceTs)}
                >
                  结束会议
                </button>
              </div>
            ) : null}

            {/* 轻问诊 */}
            {question ? (
              <div className="mx-3 mb-2 rounded-xl border border-neon-violet/30 bg-neon-violet/10 p-3">
                <div className="mb-2 text-xs leading-relaxed text-slate-200">{question.question}</div>
                <div className="flex gap-2">
                  <button
                    className="flex-1 rounded-lg bg-neon-green/20 py-1.5 text-xs text-neon-green transition-colors hover:bg-neon-green/30"
                    onClick={() => answer('yes')}
                  >
                    确认
                  </button>
                  <button
                    className="flex-1 rounded-lg bg-white/5 py-1.5 text-xs text-slate-400 transition-colors hover:bg-white/10"
                    onClick={() => answer('no')}
                  >
                    否定
                  </button>
                </div>
              </div>
            ) : !bpConfirm ? (
              <div className="mx-3 mb-2 rounded-xl border border-white/5 bg-white/[0.03] px-3 py-2 text-center text-xs text-slate-500">
                暂无新的情境确认 · 越用越聪明
              </div>
            ) : null}

            <div className="flex-1" />

            {/* 底部控制 */}
            <div className="flex items-center gap-2 border-t border-white/5 px-4 py-2.5">
              <span className="text-[10px] text-slate-500">透明度</span>
              <input
                type="range"
                min={0.2}
                max={1}
                step={0.02}
                value={opacity}
                className="h-1 flex-1 accent-neon-cyan"
                onChange={(e) => {
                  const v = Number(e.target.value)
                  setOpacity(v)
                  window.api.setWidgetOpacity(v)
                  void window.api.setSettings({ widgetOpacity: v })
                }}
              />
              <span className="w-8 text-right text-[10px] text-slate-500">{Math.round(opacity * 100)}%</span>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
