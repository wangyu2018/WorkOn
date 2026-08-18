/**
 * 右下角悬浮窗（PRD F12 + 问题 7/12）：
 * 三态浮窗：mini（收起·胶囊）、compact（状态卡）、full（完整面板）
 * 设计：静谧深空 · accent 变量驱动 · 统一头部/告警壳
 */
import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import type { SuggestionQuestion } from '@shared/types'
import { WORK_STATES } from '@shared/stateMeta'
import { usePresenceStore } from '../stores/presenceStore'
import { useSettingsStore } from '../stores/settingsStore'
import { Icon, type IconName } from '../components/Icon'
import { CATEGORY_META, categoryOfWithOverride, type AppCategory } from '@shared/appCategory'

interface BrowserPlanConfirm {
  planId: string
  planTitle: string
  keyword: string
  browserTitle: string
  app: string
}

type AskState = 'hidden' | 'input' | 'thinking' | 'answer'
type WidgetMode = 'mini' | 'compact' | 'full'
const SIZES = {
  mini:    { w: 210, h: 44 },
  compact: { w: 300, h: 150 },
  full:    { w: 340, h: 520 },
} as const
const MAX_FULL_H = 760
const APP_DRAG = { WebkitAppRegion: 'drag' } as unknown as CSSProperties
const APP_NO_DRAG = { WebkitAppRegion: 'no-drag' } as unknown as CSSProperties

function hexAlpha(hex: string, a: number): string {
  const n = Math.round(Math.min(1, Math.max(0, a)) * 255).toString(16).padStart(2, '0')
  return (hex.length === 7 ? hex : hex + 'F'.repeat(7 - hex.length)) + n
}

function restoreWidgetOpacity(): void {
  window.api.getSettings().then((s) => window.api.setWidgetOpacity(s.widgetOpacity)).catch(() => undefined)
}

/* ── 共享小件 ── */

/** 浮窗面板容器（三态统一质感） */
const PANEL_STYLE: CSSProperties = {
  background: 'linear-gradient(180deg, rgba(255,255,255,0.045), rgba(255,255,255,0) 30%), rgba(12, 16, 27, 0.84)',
  border: '1px solid rgba(255, 255, 255, 0.09)',
  boxShadow: '0 14px 36px rgba(0, 0, 0, 0.48), 0 2px 8px rgba(0, 0, 0, 0.3), inset 0 1px 0 rgba(255, 255, 255, 0.05)',
  backdropFilter: 'blur(16px) saturate(1.2)',
  WebkitBackdropFilter: 'blur(16px) saturate(1.2)'
}

/** 头部小图标按钮 */
function HeaderBtn({ icon, rotate, title, onClick, active, accent }: {
  icon: IconName
  rotate?: number
  title: string
  onClick: (e: React.MouseEvent) => void
  active?: boolean
  accent?: string
}) {
  return (
    <button
      className="flex h-6 w-6 items-center justify-center rounded-md text-slate-500 transition-colors hover:bg-white/10 hover:text-slate-200"
      style={{ ...APP_NO_DRAG, color: active ? accent : undefined }}
      title={title}
      onClick={onClick}
    >
      <Icon name={icon} size={13} style={rotate ? { transform: `rotate(${rotate}deg)` } : undefined} />
    </button>
  )
}

/** 拖拽头部条（compact / full 共用） */
function WidgetHeader({ children }: { children: ReactNode }) {
  return (
    <div
      className="flex h-8 shrink-0 cursor-move select-none items-center justify-between border-b border-white/[0.06] px-2.5"
      style={APP_DRAG}
    >
      <span className="pl-0.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">WorkOn</span>
      <div className="flex items-center gap-0.5">{children}</div>
    </div>
  )
}

/** 右下角缩放手柄 */
function ResizeHandle({ onDown, onMove, onUp }: {
  onDown: (e: ReactPointerEvent) => void
  onMove: (e: ReactPointerEvent) => void
  onUp: () => void
}) {
  return (
    <div
      className="absolute bottom-0 right-0 z-20 flex h-5 w-5 cursor-nwse-resize items-end justify-end rounded-bl-lg p-[3px] text-slate-600 transition-colors hover:text-slate-300"
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      title="拖动改变大小"
    >
      <svg viewBox="0 0 24 24" className="h-3 w-3">
        <path d="M24 0 L24 24 L0 24" fill="none" stroke="currentColor" strokeWidth="2.5" />
      </svg>
    </div>
  )
}

/** 专注度状态环：中心显示分类线性图标（icon）或 emoji 降级 */
function FocusRing({ size, focus, color, emoji, icon }: { size: number; focus: number; color: string; emoji: string; icon?: AppCategory }) {
  const R = 18
  const CIRC = 2 * Math.PI * R
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg viewBox="0 0 48 48" className="-rotate-90" style={{ width: size, height: size }}>
        <circle cx="24" cy="24" r={R} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="3.5" />
        <circle
          cx="24" cy="24" r={R} fill="none"
          stroke={color} strokeWidth="3.5" strokeLinecap="round"
          strokeDasharray={CIRC}
          strokeDashoffset={CIRC * (1 - focus / 100)}
          style={{ transition: 'stroke-dashoffset 400ms ease-out' }}
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        {icon ? (
          <svg width={size * 0.42} height={size * 0.42} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--pop-text)' }}>
            <use href={`#cat-${icon}`} />
          </svg>
        ) : (
          <span style={{ fontSize: Math.round(size * 0.34) }}>{emoji}</span>
        )}
      </div>
    </div>
  )
}

/** 告警卡外壳：统一色调 + 收起/展开（修复原收起后无法展开的死端） */
function AlertShell({ color, label, collapsed, onToggle, children }: {
  color: string
  label: string
  collapsed: boolean
  onToggle: () => void
  children: ReactNode
}) {
  return (
    <div
      className="relative rounded-xl border p-2.5"
      style={{ borderColor: hexAlpha(color, 0.25), background: hexAlpha(color, 0.07) }}
    >
      <button
        className="absolute right-1.5 top-1.5 flex h-4 w-4 items-center justify-center rounded text-slate-500 transition-colors hover:bg-white/10 hover:text-slate-300"
        onClick={onToggle}
        title={collapsed ? '展开' : '收起'}
      >
        <Icon name="chevronRight" size={10} style={{ transform: collapsed ? 'rotate(-90deg)' : 'rotate(90deg)' }} />
      </button>
      {collapsed ? (
        <div className="cursor-pointer text-[11px]" style={{ color }} onClick={onToggle}>
          {label}（已收起）
        </div>
      ) : children}
    </div>
  )
}

/** 问答条（input / thinking / answer 三态） */
function AskBar({ askState, askText, setAskText, submitAsk, onAskBlur, onEscape, askAnswer, accent, blurTimer }: {
  askState: AskState
  askText: string
  setAskText: (v: string) => void
  submitAsk: () => Promise<void>
  onAskBlur: () => void
  onEscape: () => void
  askAnswer: string
  accent: string
  blurTimer: React.MutableRefObject<number | null>
}) {
  if (askState === 'hidden') return null
  return (
    <div className="transition-all">
      {askState === 'input' ? (
        <input
          autoFocus
          className="w-full rounded-full border bg-white/[0.05] px-3 py-1.5 text-xs text-slate-200 outline-none placeholder:text-slate-600"
          style={{ borderColor: hexAlpha(accent, 0.3) }}
          placeholder="问点什么…（回车发送）"
          value={askText}
          onChange={(e) => { setAskText(e.target.value); if (blurTimer.current) window.clearTimeout(blurTimer.current) }}
          onKeyDown={(e) => { if (e.key === 'Enter') void submitAsk(); if (e.key === 'Escape') onEscape() }}
          onBlur={onAskBlur}
        />
      ) : askState === 'thinking' ? (
        <div className="flex items-center gap-2 rounded-full border border-white/[0.08] bg-white/[0.04] px-3 py-1.5 text-xs text-slate-400">
          <span className="pulse-dot inline-block h-1.5 w-1.5 rounded-full" style={{ background: accent }} />思考中…
        </div>
      ) : (
        <div
          className="max-h-20 overflow-hidden rounded-xl rounded-bl-sm border px-3 py-2 text-xs leading-relaxed"
          style={{ borderColor: hexAlpha(accent, 0.18), background: hexAlpha(accent, 0.09), color: accent }}
        >
          {askAnswer}
        </div>
      )}
    </div>
  )
}

/** 桌宠气泡 */
function PetBubbleLine({ text, accent }: { text: string; accent: string }) {
  return (
    <div
      className="rounded-xl rounded-bl-sm border px-3 py-2 text-xs"
      style={{ borderColor: hexAlpha(accent, 0.18), background: hexAlpha(accent, 0.09), color: accent }}
    >
      🐾 {text}
    </div>
  )
}

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
  const [, setTimerTick] = useState(0)
  useEffect(() => {
    if (!meetingActive) return
    const t = window.setInterval(() => setTimerTick((n) => n + 1), 30_000)
    return () => window.clearInterval(t)
  }, [meetingActive])
  const [widgetMode, setWidgetMode] = useState<WidgetMode>('mini')
  const [penetration, setPenetration] = useState(false)
  const [accent, setAccent] = useState('#22D3EE')
  const [shimmer, setShimmer] = useState(false)
  const [welcome, setWelcome] = useState(false)
  const [askState, setAskState] = useState<AskState>('hidden')
  const [askText, setAskText] = useState('')
  const [askAnswer, setAskAnswer] = useState('')
  const resizeRef = useRef<{ x: number; y: number; w: number; h: number } | null>(null)
  const blurTimer = useRef<number | null>(null)
  const prevAlert = useRef(false)
  const [petBubble, setPetBubble] = useState<string | null>(null)
  const petBubbleTimer = useRef<number | null>(null)
  useEffect(() => {
    if (pet?.message) {
      setPetBubble(pet.message)
      if (petBubbleTimer.current) window.clearTimeout(petBubbleTimer.current)
      petBubbleTimer.current = window.setTimeout(() => setPetBubble(null), 3000)
    }
    return () => {
      if (petBubbleTimer.current) window.clearTimeout(petBubbleTimer.current)
    }
  }, [pet?.message])
  const [widgetCompact, setWidgetCompact] = useState(false)
  const [alertCollapsed, setAlertCollapsed] = useState<Record<string, boolean>>({})
  const [showFocusMinutes, setShowFocusMinutes] = useState(false)

  const setMode = (mode: WidgetMode) => {
    setWidgetMode(mode)
    window.api.widgetSetMode(mode)
  }

  const togglePenetration = () => {
    const v = !penetration
    setPenetration(v)
    const api = window.api as Record<string, any>
    if (typeof api.setWidgetPenetration === 'function') api.setWidgetPenetration(v)
    void window.api.setSettings({ widgetPenetration: v })
  }

  const toggleAlert = (key: string) => setAlertCollapsed((c) => ({ ...c, [key]: !c[key] }))

  useEffect(() => {
    window.api.getSettings().then((s) => {
      const mode = (s as { widgetMode?: WidgetMode }).widgetMode ?? 'mini'
      setWidgetMode(mode)
      window.api.widgetSetMode(mode)
    }).catch(() => undefined)

    window.api.getSettings().then((s) => setWidgetCompact(!!(s as { widgetCompact?: boolean }).widgetCompact)).catch(() => undefined)

    const cleanup = usePresenceStore.getState().init()
    window.api.getQuestion().then((q) => setQuestion(q as SuggestionQuestion | null)).catch(() => undefined)
    const offQ = window.api.onQuestion((q) => setQuestion(q as SuggestionQuestion | null))
    const offBP = window.api.onBrowserPlanConfirm((p) => {
      setBpConfirm(p as BrowserPlanConfirm)
    })
    const offW = window.api.onWelcomeBack(() => {
      setWelcome(true)
      setTimeout(() => setWelcome(false), 3000)
    })
    const offMD = window.api.onMeetingDetected((p) => {
      const payload = p as { app: string; title: string }
      window.api.getSettings().then((s) => {
        const mode = s.meetingMode ?? 'ask'
        if (mode === 'ask') {
          setMeetingDetected(payload)
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
        restoreWidgetOpacity()
      }
    })
    window.api.getSettings().then((s) => setPenetration(!!(s as { widgetPenetration?: boolean }).widgetPenetration)).catch(() => undefined)
    window.api.getSettings().then((s) => {
      const a = (s as { widgetAccent?: string }).widgetAccent
      if (a) setAccent(a)
    }).catch(() => undefined)
    const offAccent = window.api.onWidgetAccent((a) => {
      if (typeof a === 'string' && a) setAccent(a)
    })

    return () => {
      cleanup()
      offQ()
      offBP()
      offW()
      offMD()
      offME()
      offAccent()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const hasAlert = !!(question || bpConfirm || meetingDetected)
    if (hasAlert && !prevAlert.current) {
      setShimmer(true)
      const t = window.setTimeout(() => setShimmer(false), 2000)
      return () => window.clearTimeout(t)
    }
    prevAlert.current = hasAlert
  }, [question, bpConfirm, meetingDetected])

  // 动态高度：问答/告警出现时窗口从底部往上顶
  useEffect(() => {
    const mode = widgetMode
    const hasAlert = !!(question || bpConfirm || meetingDetected)
    const hasContent = hasAlert || askState !== 'hidden' || petBubble
    if (mode === 'mini') {
      // 仅「需要用户回应的告警」才展开；闲聊气泡不顶开；穿透态保持不动
      if (hasAlert && !penetration) setMode('compact')
      return
    }
    const base = SIZES[mode].h
    const extra = hasContent ? Math.min(220,
      (question ? 90 : 0) + (bpConfirm ? 110 : 0) + (meetingDetected ? 130 : 0) + (askState !== 'hidden' ? 60 : 0)
    ) : 0
    const target = Math.min(mode === 'full' ? MAX_FULL_H : base + extra, base + extra)
    const sz = SIZES[mode]
    window.api.widgetResizeTransient(sz.w, target)
  }, [widgetMode, question, bpConfirm, meetingDetected, askState, petBubble, penetration])

  // 右下角拖拽改大小（pointer capture：鼠标移出窗口仍持续触发，避免缩放中断）
  const onResizePointerDown = (e: ReactPointerEvent) => {
    e.preventDefault(); e.stopPropagation()
    const base = SIZES[widgetMode]
    resizeRef.current = { x: e.clientX, y: e.clientY, w: base.w, h: base.h }
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  const onResizePointerMove = (e: ReactPointerEvent) => {
    if (!resizeRef.current) return
    const w = Math.max(200, Math.min(640, Math.round(resizeRef.current.w + (e.clientX - resizeRef.current.x))))
    const h = Math.max(120, Math.min(900, Math.round(resizeRef.current.h + (e.clientY - resizeRef.current.y))))
    window.api.widgetResize(w, h)
  }
  const onResizePointerUp = () => { resizeRef.current = null }

  const state = presence?.state ?? 'idle'
  const meta = WORK_STATES[state] ?? WORK_STATES.idle
  const focus = presence?.focusLevel ?? 0

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

  const applyMeetingMode = (mode: 'stealth' | 'quiet' | 'assist', active: boolean, sinceTs: number) => {
    window.api.meetingApply({ mode, active, sinceTs: active ? undefined : sinceTs })
    if (active) {
      setMeetingActive({ mode, sinceTs })
      if (mode === 'quiet') window.api.setWidgetOpacity(0.3)
      setMeetingDetected(null)
    } else {
      setMeetingActive(null)
      restoreWidgetOpacity()
    }
  }

  const chooseMeetingMode = (mode: 'stealth' | 'quiet' | 'assist') => {
    if (meetingSetDefault) void window.api.setSettings({ meetingMode: mode })
    applyMeetingMode(mode, true, Date.now())
  }

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

  const penetrationTitle = penetration ? '穿透中（桌搭页关闭）' : '开启鼠标穿透（穿透后需在桌搭页关闭）'
  const liveTitle = presence?.screens?.find((s) => s.screen === presence.mainScreen)?.title
  // 当前活跃应用 → 分类图标（跟随用户手动归类，override 变化即同步）
  const mainApp = presence?.screens?.find((s) => s.screen === presence.mainScreen)?.app
  const appCategoryOverride = useSettingsStore((s) => s.settings.appCategoryOverride)
  const mainCat = mainApp ? categoryOfWithOverride(mainApp, appCategoryOverride) : null
  const mainCatEmoji = mainCat ? CATEGORY_META[mainCat].emoji : null

  // ── mini 态：悬浮胶囊（状态环 + 实时工作内容） ──
  if (widgetMode === 'mini') {
    return (
      <div className="flex h-screen w-screen items-end justify-end">
        <div
          className={`flex h-11 w-full cursor-pointer items-center gap-2.5 rounded-full px-3 ${shimmer ? 'shimmer-ring' : ''}`}
          style={PANEL_STYLE}
          onClick={() => setMode('compact')}
        >
          <FocusRing size={26} focus={focus} color={meta.color} emoji={mainCatEmoji || meta.emoji} icon={mainCat ?? undefined} />
          <span className="min-w-0 flex-1 truncate text-xs text-slate-200">{liveTitle || meta.label}</span>
          <button
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-slate-500 transition-colors hover:bg-white/10 hover:text-slate-200"
            style={{ color: penetration ? accent : undefined }}
            title={penetrationTitle}
            onClick={(e) => { e.stopPropagation(); togglePenetration() }}
          >
            <Icon name="eyeOff" size={12} />
          </button>
        </div>
        <style>{`
          .shimmer-ring { animation: shimmer 2s ease-out; }
          @keyframes shimmer {
            0% { box-shadow: 0 0 4px ${hexAlpha(accent, 0.5)}, 0 0 12px ${hexAlpha(accent, 0.3)}; }
            50% { box-shadow: 0 0 8px ${hexAlpha(accent, 0.8)}, 0 0 24px ${hexAlpha(accent, 0.5)}; }
            100% { box-shadow: 0 0 4px ${hexAlpha(accent, 0.5)}, 0 0 12px ${hexAlpha(accent, 0.3)}; }
          }
        `}</style>
      </div>
    )
  }

  // ── compact 态：状态区 + 问答/气泡 ──
  if (widgetMode === 'compact') {
    return (
      <div className="flex h-screen w-screen items-end justify-end p-3">
        <div className="relative flex w-[300px] flex-col overflow-hidden rounded-2xl" style={PANEL_STYLE}>
          <WidgetHeader>
            <HeaderBtn icon="chevronRight" rotate={-90} title="展开" onClick={() => setMode('full')} />
            <HeaderBtn icon="eyeOff" title={penetrationTitle} onClick={togglePenetration} active={penetration} accent={accent} />
            <HeaderBtn icon="chevronRight" rotate={90} title="收起到最小" onClick={() => setMode('mini')} />
          </WidgetHeader>
          <div className="flex items-center gap-3 px-3.5 py-2.5">
            <FocusRing size={42} focus={focus} color={meta.color} emoji={mainCatEmoji || meta.emoji} icon={mainCat ?? undefined} />
            <div className="min-w-0 flex-1">
              <div className="text-[13px] font-semibold" style={{ color: meta.color }}>
                {meta.label}
                <span className="ml-1 text-[11px] font-normal text-slate-500">专注度 {focus}</span>
              </div>
              <div className="mt-0.5 truncate text-[11px] text-slate-400">{liveTitle || '等待采集…'}</div>
            </div>
            {aiEnabled ? (
              <button
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-slate-500 transition-colors hover:bg-white/10 hover:text-slate-200"
                title="问点什么…"
                onClick={() => setAskState(askState === 'hidden' ? 'input' : 'hidden')}
              >
                <Icon name="message" size={12} />
              </button>
            ) : null}
          </div>
          <div className="mx-2.5 mb-2.5 flex flex-col gap-2 overflow-y-auto" style={{ maxHeight: 120 }}>
            <AskBar askState={askState} askText={askText} setAskText={setAskText} submitAsk={submitAsk} onAskBlur={onAskBlur} onEscape={() => setAskState('hidden')} askAnswer={askAnswer} accent={accent} blurTimer={blurTimer} />
            {petBubble && !widgetCompact && <PetBubbleLine text={petBubble} accent={accent} />}
          </div>
          <ResizeHandle onDown={onResizePointerDown} onMove={onResizePointerMove} onUp={onResizePointerUp} />
        </div>
      </div>
    )
  }

  // ── full 态：完整面板 ──
  return (
    <div className="flex h-screen w-screen items-end justify-end p-3">
      <div className="relative flex w-full flex-col overflow-hidden rounded-2xl" style={PANEL_STYLE}>
        <WidgetHeader>
          <HeaderBtn icon="eyeOff" title={penetrationTitle} onClick={togglePenetration} active={penetration} accent={accent} />
          <HeaderBtn icon="chevronRight" rotate={90} title="收起" onClick={() => setMode('mini')} />
          <HeaderBtn icon="x" title="隐藏悬浮窗" onClick={() => window.api.toggleWidget()} />
        </WidgetHeader>

        {welcome && !widgetCompact && (
          <div className="anim-fade-in mx-3 mt-2 rounded-lg border border-neon-green/20 bg-neon-green/10 px-3 py-1.5 text-center text-xs text-neon-green">
            欢迎回到正事
          </div>
        )}

        {/* 状态区 */}
        <div
          className="flex items-center gap-3 px-3.5 py-3"
          onMouseEnter={() => setShowFocusMinutes(true)}
          onMouseLeave={() => setShowFocusMinutes(false)}
        >
          <FocusRing size={44} focus={focus} color={meta.color} emoji={mainCatEmoji || meta.emoji} icon={mainCat ?? undefined} />
          <div className="min-w-0 flex-1">
            <div className="text-[13px] font-semibold" style={{ color: meta.color }}>
              {meta.label}{' '}
              <span
                className="text-[11px] font-normal text-slate-500"
                title={presence ? `实时专注度 ${focus}（0-100）· 当前状态 ${presence.state}\n多维注意力评分见「监控/报表」页` : undefined}
              >
                专注度 {focus}
              </span>
            </div>
            <div className="mt-0.5 truncate text-[11px] text-slate-400">
              {liveTitle || '等待采集…'}
            </div>
            {presence && presence.continuousFocusSec > 60 && showFocusMinutes && (
              <div className="mt-0.5 text-[11px]" style={{ color: accent }}>
                已专注 {Math.round(presence.continuousFocusSec / 60)} 分钟
              </div>
            )}
          </div>
          {aiEnabled ? (
            <button
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-slate-500 transition-colors hover:bg-white/10 hover:text-slate-200"
              title="问点什么…"
              onClick={() => setAskState(askState === 'hidden' ? 'input' : 'hidden')}
            >
              <Icon name="message" size={12} />
            </button>
          ) : null}
        </div>

        {/* 折叠态问答条 + 桌宠气泡 */}
        <div className="mx-3 flex flex-col gap-2">
          <AskBar askState={askState} askText={askText} setAskText={setAskText} submitAsk={submitAsk} onAskBlur={onAskBlur} onEscape={() => setAskState('hidden')} askAnswer={askAnswer} accent={accent} blurTimer={blurTimer} />
          {petBubble && !widgetCompact && <PetBubbleLine text={petBubble} accent={accent} />}
        </div>

        {/* 告警区：浏览器计划确认 / 会议检测 / 会议辅助 / 轻问诊 */}
        <div className="mx-3 mb-1 mt-2 flex max-h-[240px] flex-col gap-2 overflow-y-auto">
          {bpConfirm ? (
            <AlertShell color="#3B82F6" label="🌐 浏览器检测" collapsed={!!alertCollapsed['bp']} onToggle={() => toggleAlert('bp')}>
              <div className="mb-1 text-[11px] font-medium" style={{ color: '#7FB0F7' }}>🌐 浏览器检测</div>
              <div className="mb-2 pr-4 text-xs leading-relaxed text-slate-200">
                检测到你在浏览与计划【{bpConfirm.planTitle}】相关的内容，你在做这项计划吗？
              </div>
              <div className="flex gap-2">
                <button
                  className="flex-1 rounded-lg py-1.5 text-xs transition-colors hover:brightness-125"
                  style={{ background: 'rgba(16,185,129,0.16)', color: '#34D399' }}
                  onClick={() => answerBrowserPlan('yes')}
                >
                  是，在做这个
                </button>
                <button
                  className="flex-1 rounded-lg bg-white/[0.05] py-1.5 text-xs text-slate-400 transition-colors hover:bg-white/10"
                  onClick={() => answerBrowserPlan('no')}
                >
                  不是
                </button>
              </div>
            </AlertShell>
          ) : null}

          {meetingDetected ? (
            <AlertShell color="#F59E0B" label="👥 会议检测" collapsed={!!alertCollapsed['md']} onToggle={() => toggleAlert('md')}>
              <div className="mb-1 text-[11px] font-medium" style={{ color: '#FBBF24' }}>👥 会议检测</div>
              <div className="mb-2 pr-4 text-xs leading-relaxed text-slate-200">
                检测到你正在使用 {meetingDetected.app.replace(/\.exe$/i, '')} 开会，选择会议模式：
              </div>
              <div className="flex gap-1.5">
                <button
                  className="flex-1 rounded-lg bg-white/[0.07] py-1.5 text-[11px] text-slate-200 transition-colors hover:bg-white/[0.12]"
                  onClick={() => chooseMeetingMode('stealth')}
                >
                  🤫 一键隐身
                </button>
                <button
                  className="flex-1 rounded-lg bg-white/[0.07] py-1.5 text-[11px] text-slate-200 transition-colors hover:bg-white/[0.12]"
                  onClick={() => chooseMeetingMode('quiet')}
                >
                  🔇 免打扰
                </button>
                <button
                  className="flex-1 rounded-lg bg-white/[0.07] py-1.5 text-[11px] text-slate-200 transition-colors hover:bg-white/[0.12]"
                  onClick={() => chooseMeetingMode('assist')}
                >
                  📝 会议辅助
                </button>
              </div>
              <label className="mt-2 flex cursor-pointer items-center gap-1.5 text-[10px] text-slate-500">
                <input type="checkbox" checked={meetingSetDefault} onChange={(e) => setMeetingSetDefault(e.target.checked)} />
                以后都这样（可在设置中修改）
              </label>
            </AlertShell>
          ) : null}

          {meetingActive?.mode === 'assist' ? (
            <AlertShell color="#10B981" label="📝 会议辅助中" collapsed={!!alertCollapsed['ma']} onToggle={() => toggleAlert('ma')}>
              <div className="flex items-center gap-2">
                <span className="text-xs" style={{ color: '#34D399' }}>📝</span>
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-medium" style={{ color: '#34D399' }}>
                    会议辅助中 · {Math.max(1, Math.round((Date.now() - meetingActive.sinceTs) / 60000))} 分钟
                  </div>
                  <div className="text-[10px]" style={{ color: 'rgba(52,211,153,0.6)' }}>每 15 分钟报时提醒</div>
                </div>
                <button
                  className="shrink-0 rounded-lg border px-2 py-1 text-[10px] transition-colors hover:bg-white/[0.06]"
                  style={{ borderColor: 'rgba(16,185,129,0.3)', color: '#34D399' }}
                  onClick={() => applyMeetingMode('assist', false, meetingActive.sinceTs)}
                >
                  结束会议
                </button>
              </div>
            </AlertShell>
          ) : null}

          {question ? (
            <AlertShell color="#8B5CF6" label="📋 轻问诊" collapsed={!!alertCollapsed['q']} onToggle={() => toggleAlert('q')}>
              <div className="mb-2 pr-4 text-xs leading-relaxed text-slate-200">{question.question}</div>
              <div className="flex gap-2">
                <button
                  className="flex-1 rounded-lg py-1.5 text-xs transition-colors hover:brightness-125"
                  style={{ background: 'rgba(16,185,129,0.16)', color: '#34D399' }}
                  onClick={() => answer('yes')}
                >
                  是
                </button>
                <button
                  className="flex-1 rounded-lg bg-white/[0.05] py-1.5 text-xs text-slate-400 transition-colors hover:bg-white/10"
                  onClick={() => answer('no')}
                >
                  不是
                </button>
              </div>
            </AlertShell>
          ) : !bpConfirm ? (
            widgetCompact ? null : (
              <div className="rounded-xl border border-white/[0.05] bg-white/[0.03] px-3 py-2 text-center text-[11px] text-slate-500">
                暂无新的情境确认 · 越用越聪明
              </div>
            )
          ) : null}
        </div>

        <ResizeHandle onDown={onResizePointerDown} onMove={onResizePointerMove} onUp={onResizePointerUp} />
      </div>
    </div>
  )
}
