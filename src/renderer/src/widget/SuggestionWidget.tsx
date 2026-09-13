/**
 * 右下角悬浮窗（PRD F12 + 问题 7/12）：
 * 三态浮窗：mini（收起·胶囊）、compact（状态卡）、full（完整面板）
 * 设计：静谧深空 · accent 变量驱动 · 统一头部/告警壳
 */
import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import type { SuggestionQuestion, FocusChainState, Project, PlanItem, DockRingContent, WidgetDisplayOptions } from '@shared/types'
import { DEFAULT_WIDGET_DISPLAY } from '@shared/types'

interface AttributionState {
  projectId: string | null
  projectName: string
  taskId: string | null
  taskTitle: string
  sec: number
  source: 'binding' | 'keyword' | 'question' | 'none'
}
import { WORK_STATES } from '@shared/stateMeta'
import { usePresenceStore } from '../stores/presenceStore'
import { useSettingsStore } from '../stores/settingsStore'
import { Icon, type IconName } from '../components/Icon'
import { AiAssistStrip, AiAssistRing } from '../components/AiAssistStrip'
import { CATEGORY_META, categoryOfWithOverride, type AppCategory } from '@shared/appCategory'
import { StateDot, ChainChip, GrainChip, Firefly } from '../components/widgetKit'
import type { AiAssistItem } from '@shared/aiAssistWatch'

/** 应用内通知卡（main notify.ts 推送） */
interface WidgetNotify {
  id: string
  kind: 'report' | 'rest' | 'ai' | 'correction' | 'generic'
  title: string
  body: string
  time: number
  ttlSec: number
  actions: { label: string; action: string; primary?: boolean }[]
}

const NOTIFY_ICON: Record<WidgetNotify['kind'], { emoji: string; bg: string }> = {
  report: { emoji: '📊', bg: 'rgba(15,181,164,.25)' },
  rest: { emoji: '☕', bg: 'rgba(245,158,11,.25)' },
  ai: { emoji: '✦', bg: 'rgba(139,92,246,.28)' },
  correction: { emoji: '✓', bg: 'rgba(16,185,129,.25)' },
  generic: { emoji: '🔔', bg: 'rgba(255,255,255,.12)' }
}

/** 通知卡堆栈（v7）：进度条自动消失 + 操作按钮回传 main */
function NotificationStack({ list, onDone }: { list: WidgetNotify[]; onDone: (id: string) => void }) {
  if (!list.length) return null
  return (
    <div className="flex w-[320px] flex-col gap-2">
      {list.map((n) => {
        const ic = NOTIFY_ICON[n.kind] ?? NOTIFY_ICON.generic
        return (
          <div key={n.id} className="relative overflow-hidden rounded-xl border border-[var(--line)] p-2.5" style={PANEL_STYLE} data-widget-solid>
            <div className="flex items-start gap-2.5">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-sm" style={{ background: ic.bg }}>
                {ic.emoji}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <b className="text-[11.5px] text-[var(--text-1)]">{n.title}</b>
                  <span className="text-[9px] text-[var(--text-3)]">刚刚</span>
                  <button
                    className="ml-auto text-[var(--text-3)] transition-colors hover:text-[var(--text-1)]"
                    onClick={() => { onDone(n.id); void window.api.notifyAction(n.id, 'dismiss') }}
                  >✕</button>
                </div>
                <div className="mt-0.5 text-[10.5px] leading-relaxed text-[var(--text-3)]">{n.body}</div>
                {n.actions.length ? (
                  <div className="mt-1.5 flex gap-1.5">
                    {n.actions.map((a) => (
                      <button
                        key={a.action}
                        className={`rounded-full px-2.5 py-1 text-[10px] font-semibold transition-all hover:-translate-y-px ${
                          a.primary ? 'bg-[var(--teal)] text-white' : 'border border-[var(--line-strong)] text-[var(--text-2)] hover:bg-[var(--surface-3)]'
                        }`}
                        onClick={() => { onDone(n.id); void window.api.notifyAction(n.id, a.action) }}
                      >
                        {a.label}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>
            <i
              className="absolute bottom-0 left-0 h-[2px] bg-[var(--teal)] opacity-70"
              style={{ animation: `notify-ttl ${n.ttlSec}s linear forwards`, width: '100%' }}
            />
          </div>
        )
      })}
      <style>{`@keyframes notify-ttl { from { width: 100%; } to { width: 0%; } }`}</style>
    </div>
  )
}

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
  mini:    { w: 210, h: 52 },
  compact: { w: 300, h: 150 },
  full:    { w: 340, h: 520 },
} as const
const MAX_FULL_H = 760
const APP_DRAG = { WebkitAppRegion: 'drag' } as unknown as CSSProperties
const APP_NO_DRAG = { WebkitAppRegion: 'no-drag' } as unknown as CSSProperties

/**
 * mini 胶囊不用 -webkit-app-region:drag（会吞掉 click/dblclick）。
 * 超过移动阈值才 beginWidgetDrag；未移动则识别双击进 full。
 */
function bindMiniCapsulePointer(
  e: ReactPointerEvent,
  onDoubleTap: () => void,
  lastTapRef: { current: number }
): void {
  if (e.button !== 0) return
  const raw = e.target as HTMLElement | null
  if (raw?.closest?.('button, a, input, textarea, [data-no-capsule-drag]')) return
  const pointerId = e.pointerId
  const originX = e.screenX
  const originY = e.screenY
  let moved = false
  let dragStarted = false
  let cleaned = false

  const detach = (): void => {
    if (cleaned) return
    cleaned = true
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', onUp)
    window.removeEventListener('pointercancel', onCancel)
    window.removeEventListener('blur', onBlur)
  }

  const onMove = (ev: PointerEvent): void => {
    if (ev.pointerId !== pointerId) return
    if (Math.abs(ev.screenX - originX) + Math.abs(ev.screenY - originY) <= 6) return
    moved = true
    if (!dragStarted) {
      dragStarted = true
      try { window.api.beginWidgetDrag() } catch { /* ignore */ }
    }
  }

  const onUp = (ev: PointerEvent): void => {
    if (ev.pointerId !== pointerId) return
    const wasMoved = moved
    detach()
    if (dragStarted) {
      try { window.api.endWidgetDrag() } catch { /* ignore */ }
    }
    if (wasMoved) return
    const now = Date.now()
    if (now - lastTapRef.current < 380) {
      lastTapRef.current = 0
      onDoubleTap()
    } else {
      lastTapRef.current = now
    }
  }

  const onCancel = (ev: PointerEvent): void => {
    if (ev.pointerId !== pointerId) return
    detach()
    if (dragStarted) {
      try { window.api.endWidgetDrag() } catch { /* ignore */ }
    }
  }

  const onBlur = (): void => {
    detach()
    if (dragStarted) {
      try { window.api.endWidgetDrag() } catch { /* ignore */ }
    }
  }

  e.preventDefault()
  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerup', onUp)
  window.addEventListener('pointercancel', onCancel)
  window.addEventListener('blur', onBlur)
}

function hexAlpha(hex: string, a: number): string {
  const n = Math.round(Math.min(1, Math.max(0, a)) * 255).toString(16).padStart(2, '0')
  return (hex.length === 7 ? hex : hex + 'F'.repeat(7 - hex.length)) + n
}

function restoreWidgetOpacity(): void {
  window.api.getSettings().then((s) => window.api.setWidgetOpacity(s.widgetOpacity)).catch(() => undefined)
}

/* ── 共享小件 ── */

/** 浮窗面板：实色铺满窗口，禁用 backdrop/外阴影（Win 透明窗会画出高透明直角灰框） */
const PANEL_STYLE: CSSProperties = {
  background: 'var(--bg-surface)',
  border: '1px solid var(--line)',
  color: 'var(--text-1)',
  boxShadow: 'inset 0 1px 0 rgba(255, 255, 255, 0.04)'
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
      className="flex h-6 w-6 items-center justify-center rounded-md text-[var(--text-3)] transition-colors hover:bg-[var(--surface-3)] hover:text-[var(--text-1)]"
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
      className="flex h-7 shrink-0 cursor-move select-none items-center justify-end border-b border-[var(--line)] px-2.5"
      style={APP_DRAG}
    >
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
      className="absolute bottom-0 right-0 z-20 flex h-5 w-5 cursor-nwse-resize items-end justify-end rounded-bl-lg p-[3px] text-[var(--text-3)] transition-colors hover:text-[var(--text-2)]"
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

/** 吸附胶囊单环仪表（左右圆弧内） */
function IslandGauge({
  size,
  value,
  color,
  glow,
  children,
  title
}: {
  size: number
  value: number
  color: string
  glow?: boolean
  children: ReactNode
  title?: string
}) {
  const R = 18.5
  const CIRC = 2 * Math.PI * R
  const v = Math.max(0, Math.min(100, value)) / 100
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }} title={title}>
      <svg viewBox="0 0 48 48" className="-rotate-90" style={{ width: size, height: size }}>
        <circle cx="24" cy="24" r={R} fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth="3" />
        <circle
          cx="24" cy="24" r={R} fill="none"
          stroke={color} strokeWidth="3" strokeLinecap="round"
          strokeDasharray={CIRC}
          strokeDashoffset={CIRC * (1 - v)}
          style={{
            transition: 'stroke-dashoffset 400ms ease-out',
            filter: glow ? `drop-shadow(0 0 3px ${color}99)` : undefined
          }}
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">{children}</div>
    </div>
  )
}

/** 吸附环内容 → 数值/颜色/中心 */
function dockRingFace(kind: DockRingContent, ctx: {
  focus: number
  focusColor: string
  appPct: number
  appColor: string
  emoji: string
  icon?: AppCategory
  chainSec: number
  projectName: string
  minutes: number
}): { value: number; color: string; title: string; center: ReactNode; glow?: boolean } {
  const iconSize = 11
  switch (kind) {
    case 'app':
      return {
        value: ctx.appPct,
        color: ctx.appColor,
        title: `应用 · ${Math.round(ctx.appPct)}%`,
        center: ctx.icon ? (
          <svg width={iconSize} height={iconSize} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" style={{ color: ctx.appColor }}>
            <use href={`#cat-${ctx.icon}`} />
          </svg>
        ) : (
          <span style={{ fontSize: 10, lineHeight: 1 }}>{ctx.emoji}</span>
        )
      }
    case 'focus':
      return {
        value: ctx.focus,
        color: ctx.focusColor,
        title: `专注 ${Math.round(ctx.focus)}`,
        glow: true,
        center: (
          <span className="text-[8px] font-bold tabular-nums leading-none" style={{ color: ctx.focusColor }}>
            {Math.round(ctx.focus)}
          </span>
        )
      }
    case 'chain': {
      const min = Math.max(0, Math.round(ctx.chainSec / 60))
      const pct = Math.min(100, Math.round((ctx.chainSec / 2700) * 100))
      return {
        value: pct || (ctx.chainSec > 0 ? 12 : 0),
        color: ctx.focusColor,
        title: `链路 ${min || 0}m`,
        glow: ctx.chainSec > 0,
        center: (
          <span className="text-[8px] font-bold tabular-nums leading-none" style={{ color: ctx.focusColor }}>
            {min > 0 ? `${min}m` : '·'}
          </span>
        )
      }
    }
    case 'project': {
      const ch = (ctx.projectName || '·').trim().slice(0, 1) || '·'
      return {
        value: ctx.focus || ctx.appPct || 8,
        color: ctx.focusColor,
        title: ctx.projectName ? `项目 · ${ctx.projectName}` : '未归属',
        center: (
          <span className="text-[10px] font-bold leading-none" style={{ color: ctx.focusColor }}>{ch}</span>
        )
      }
    }
    case 'minutes': {
      const m = Math.max(0, Math.round(ctx.minutes))
      const pct = Math.min(100, Math.round((ctx.minutes / 45) * 100))
      return {
        value: pct || (m > 0 ? 10 : 0),
        color: ctx.focusColor,
        title: `已专注 ${m} 分钟`,
        center: (
          <span className="text-[8px] font-bold tabular-nums leading-none" style={{ color: ctx.focusColor }}>
            {m > 0 ? `${m}` : '0'}
          </span>
        )
      }
    }
  }
}

/** 吸附黑胶囊：左右环由桌搭 widgetDisplay.dock 配置 */
function DockCapsuleRings({
  left,
  right,
  focus,
  focusColor,
  appPct,
  appColor,
  emoji,
  icon,
  chainSec,
  projectName,
  minutes
}: {
  left: DockRingContent
  right: DockRingContent
  focus: number
  focusColor: string
  appPct: number
  appColor: string
  emoji: string
  icon?: AppCategory
  chainSec: number
  projectName: string
  minutes: number
}) {
  const gauge = 26
  const ctx = { focus, focusColor, appPct, appColor, emoji, icon, chainSec, projectName, minutes }
  const L = dockRingFace(left, ctx)
  const R = dockRingFace(right, ctx)
  return (
    <div className="flex h-full w-full items-center justify-between gap-1 px-1.5">
      <IslandGauge size={gauge} value={L.value} color={L.color} glow={L.glow} title={L.title}>{L.center}</IslandGauge>
      <span className="h-[3px] w-[3px] shrink-0 rounded-full" style={{ background: 'rgba(255,255,255,0.28)' }} />
      <IslandGauge size={gauge} value={R.value} color={R.color} glow={R.glow} title={R.title}>{R.center}</IslandGauge>
    </div>
  )
}

/** 告警/问答/空态共用内嵌卡壳（full 态视觉统一） */
function InsetCard({ color, title, children, className = '' }: {
  color: string
  title?: string
  children: ReactNode
  className?: string
}) {
  return (
    <div
      className={`rounded-xl border p-2.5 ${className}`}
      style={{ borderColor: hexAlpha(color, 0.25), background: hexAlpha(color, 0.07) }}
      data-widget-solid
    >
      {title ? (
        <div className="mb-1.5 text-[11px] font-medium" style={{ color }}>{title}</div>
      ) : null}
      {children}
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
      data-widget-solid
    >
      <button
        className="absolute right-1.5 top-1.5 flex h-4 w-4 items-center justify-center rounded text-[var(--text-3)] transition-colors hover:bg-[var(--surface-3)] hover:text-[var(--text-2)]"
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

/** 问答条（input / thinking / answer 三态）— 与情境确认同款圆角输入 */
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
          className="w-full rounded-lg border bg-white/[0.05] px-2.5 py-1.5 text-[11.5px] text-[var(--text-1)] outline-none placeholder:text-[var(--text-3)]"
          style={{ borderColor: hexAlpha(accent, 0.3) }}
          placeholder="问点什么…（回车发送）"
          value={askText}
          onChange={(e) => { setAskText(e.target.value); if (blurTimer.current) window.clearTimeout(blurTimer.current) }}
          onKeyDown={(e) => { if (e.key === 'Enter') void submitAsk(); if (e.key === 'Escape') onEscape() }}
          onBlur={onAskBlur}
        />
      ) : askState === 'thinking' ? (
        <div className="flex items-center gap-2 rounded-lg border border-[var(--line)] bg-white/[0.04] px-2.5 py-1.5 text-[11.5px] text-[var(--text-3)]">
          <span className="pulse-dot inline-block h-1.5 w-1.5 rounded-full" style={{ background: accent }} />思考中…
        </div>
      ) : (
        <div
          className="max-h-24 overflow-y-auto rounded-lg border px-2.5 py-2 text-[11.5px] leading-relaxed text-[var(--text-1)]"
          style={{ borderColor: hexAlpha(accent, 0.2), background: hexAlpha(accent, 0.06) }}
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
  const rawDisplay = useSettingsStore((s) => s.settings.widgetDisplay)
  const settingsCompact = useSettingsStore((s) => s.settings.widgetCompact)
  const aiAssistEnabled = useSettingsStore((s) => s.settings.aiAssistWatchEnabled)
  const widgetDisplay: WidgetDisplayOptions = {
    dock: { ...DEFAULT_WIDGET_DISPLAY.dock, ...(rawDisplay?.dock ?? {}) },
    mini: { ...DEFAULT_WIDGET_DISPLAY.mini, ...(rawDisplay?.mini ?? {}) },
    full: { ...DEFAULT_WIDGET_DISPLAY.full, ...(rawDisplay?.full ?? {}) },
    todo: { ...DEFAULT_WIDGET_DISPLAY.todo, ...(rawDisplay?.todo ?? {}) }
  }
  const [aiAssistItems, setAiAssistItems] = useState<AiAssistItem[]>([])
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
  const miniTapRef = useRef(0)
  const expandLockRef = useRef(0)
  const [dockEdge, setDockEdge] = useState<'left' | 'right' | 'top' | 'bottom' | null>(null)
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
  const [widgetCompact, setWidgetCompact] = useState(!!settingsCompact)
  useEffect(() => { setWidgetCompact(!!settingsCompact) }, [settingsCompact])
  const [alertCollapsed, setAlertCollapsed] = useState<Record<string, boolean>>({})
  const [showFocusMinutes, setShowFocusMinutes] = useState(false)
  /** 专注链路 v2（悬浮窗只回答「干得怎样」：链路时长取代无口径的专注度数字） */
  const [chain, setChain] = useState<FocusChainState | null>(null)
  /** 应用内通知堆栈 */
  const [notifies, setNotifies] = useState<WidgetNotify[]>([])
  /** 归属链（项目·任务颗粒）：胶囊显示归属而非窗口标题 */
  const [attr, setAttr] = useState<AttributionState | null>(null)
  const [allProjects, setAllProjects] = useState<Project[]>([])
  /** 未归因轻问浮层 */
  const [showUnattrAsk, setShowUnattrAsk] = useState(false)
  useEffect(() => {
    const pull = (): void => { void window.api?.getAttribution?.().then((a) => setAttr(a as AttributionState)).catch(() => undefined) }
    pull()
    const t = window.setInterval(pull, 8000)
    return () => window.clearInterval(t)
  }, [])
  const loadProjects = (): void => {
    void window.api?.listProjects?.().then((ps) => setAllProjects((ps as Project[]) ?? [])).catch(() => undefined)
  }
  /** 未归类时的操作钮（各态共用） */
  const attrBtn = (
    <button
      className="shrink-0 rounded-full border border-[var(--line)] px-2 py-0.5 text-[10px] text-[var(--text-3)] transition-colors hover:border-[rgba(139,92,246,0.5)] hover:text-[var(--violet)]"
      title="把当前工作挂到一个项目，时长才会计入"
      onClick={(e) => {
        e.stopPropagation()
        loadProjects()
        setShowUnattrAsk(true)
      }}
    >
      ◈ 归到项目
    </button>
  )
  /** 未归因卡（compact/full 内嵌） */
  const unattrCard = showUnattrAsk && !attr?.projectId ? (
    <div className="mx-3 mb-2">
      <InsetCard color="#8B5CF6" title="📂 归到哪个项目？">
        <UnattrAskCard
          projects={allProjects}
          apps={(question as unknown as { apps?: string[] })?.apps}
          fp={(question?.ctx ?? '').startsWith('attrib:') ? question!.ctx.slice(7) : undefined}
          date={new Date().toISOString().slice(0, 10)}
          onDone={() => {
            setShowUnattrAsk(false)
            if (question) answer('yes')
          }}
        />
      </InsetCard>
    </div>
  ) : null
  /** 萤火虫：有未处理确认问题 或 AI 回答尚未查看 */
  const firefly = !!question || askState === 'answer' || notifies.length > 0
  /** 归属项目的今日待办（full 态直接勾选） */
  const [attrPlans, setAttrPlans] = useState<PlanItem[]>([])
  useEffect(() => {
    if (!attr?.projectId) {
      setAttrPlans([])
      return
    }
    void window.api
      ?.listPlans?.()
      .then((pl) => {
        const list = ((pl as PlanItem[]) ?? []).filter((x) => x.projectId === attr.projectId && x.status !== 'done')
        setAttrPlans(list.slice(0, 4))
      })
      .catch(() => undefined)
  }, [attr?.projectId, attr?.taskTitle])
  useEffect(() => {
    const pull = (): void => { void window.api.getFocusChain?.().then((c) => setChain(c as FocusChainState)).catch(() => undefined) }
    pull()
    const t = window.setInterval(pull, 5000)
    return () => window.clearInterval(t)
  }, [])

  const setMode = (mode: WidgetMode) => {
    const next: WidgetMode = mode === 'compact' ? 'full' : mode
    if (next === 'full') setDockEdge(null)
    setWidgetMode(next)
    window.api.widgetSetMode(next)
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
      const edge = (s as { widgetDockEdge?: typeof dockEdge }).widgetDockEdge ?? null
      setWidgetMode(mode === 'compact' ? 'full' : mode)
      if (mode === 'mini') setDockEdge(edge)
      window.api.widgetSetMode(mode === 'compact' ? 'full' : mode)
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
    const offNotify = window.api.onNotify((n) => setNotifies((l) => [n as WidgetNotify, ...l].slice(0, 3)))
    const offNotifyExp = window.api.onNotifyExpired((id) => setNotifies((l) => l.filter((x) => x.id !== (id as string))))
    const offDock = window.api.onWidgetDock?.((p) => {
      const edge = (p as { edge?: typeof dockEdge })?.edge ?? null
      setDockEdge(edge)
    })
    const offSettings = window.api.onWidgetSettings?.((p) => {
      const patch = p as {
        widgetPenetration?: boolean
        widgetCompact?: boolean
        widgetAccent?: string
        widgetDisplay?: WidgetDisplayOptions
        aiAssistWatchEnabled?: boolean
      }
      if (typeof patch.widgetPenetration === 'boolean') setPenetration(patch.widgetPenetration)
      if (typeof patch.widgetCompact === 'boolean') setWidgetCompact(patch.widgetCompact)
      if (typeof patch.widgetAccent === 'string' && patch.widgetAccent) setAccent(patch.widgetAccent)
      if (patch.widgetDisplay || patch.aiAssistWatchEnabled !== undefined) void useSettingsStore.getState().load()
    })
    const offAiAssist = window.api.onAiAssistUpdate?.((p) => {
      const payload = p as { enabled?: boolean; items?: AiAssistItem[] }
      setAiAssistItems(Array.isArray(payload.items) ? payload.items : [])
    })

    // 挖洞：仅 [data-widget-solid] 收鼠标，空白穿透桌面
    let lastHit = false
    const reportHit = (over: boolean): void => {
      if (over === lastHit) return
      lastHit = over
      try { window.api.widgetHit?.(over) } catch { /* ignore */ }
    }
    const onPointerMove = (e: PointerEvent): void => {
      const el = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null
      reportHit(!!el?.closest?.('[data-widget-solid]'))
    }
    const onPointerLeave = (): void => reportHit(false)
    window.addEventListener('pointermove', onPointerMove)
    document.documentElement.addEventListener('mouseleave', onPointerLeave)

    return () => {
      cleanup()
      offQ()
      offBP()
      offW()
      offMD()
      offME()
      offAccent()
      offNotify()
      offNotifyExp()
      offDock?.()
      offSettings?.()
      offAiAssist?.()
      window.removeEventListener('pointermove', onPointerMove)
      document.documentElement.removeEventListener('mouseleave', onPointerLeave)
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
      // 吸附态：有告警/通知只亮点，不强制打成 full（避免拆掉胶囊）
      // 自由 mini：仅「需回应的确认」进 full；普通 notify 用萤火虫提示
      if (hasAlert && !penetration && !dockEdge) setMode('full')
      return
    }
    // full：不在此临时撑高（避免窗体抽动）
    if (mode === 'full') return
    const base = SIZES.compact.h
    const extra = hasContent ? Math.min(340,
      (question ? 170 : 0) + (bpConfirm ? 150 : 0) + (meetingDetected ? 170 : 0) + (askState !== 'hidden' ? 70 : 0)
    ) : 0
    const target = base + extra
    window.api.widgetResizeTransient(SIZES.compact.w, target)
  }, [widgetMode, question, bpConfirm, meetingDetected, askState, petBubble, penetration, dockEdge])

  // 右下角拖拽改大小（从当前窗尺寸起步，避免跳回默认）
  const onResizePointerDown = (e: ReactPointerEvent) => {
    e.preventDefault(); e.stopPropagation()
    const base = SIZES[widgetMode]
    resizeRef.current = {
      x: e.clientX,
      y: e.clientY,
      w: window.outerWidth || base.w,
      h: window.outerHeight || base.h
    }
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

  const penetrationTitle = penetration
    ? '整窗穿透中（空区也不收鼠标；请在设置/桌搭关闭）'
    : '整窗穿透（开启后需在设置或桌搭关闭；默认已是空区挖洞）'
  const dm = widgetDisplay.mini
  const dd = widgetDisplay.dock
  const df = widgetDisplay.full
  const fireflyActive = firefly || notifies.length > 0 || (aiAssistEnabled && aiAssistItems.some((i) => i.status === 'done' || i.status === 'busy'))
  const continuousMin = Math.max(0, Math.round((presence?.continuousFocusSec ?? 0) / 60))
  const liveTitle = presence?.screens?.find((s) => s.screen === presence.mainScreen)?.title
  // 当前活跃应用 → 分类图标（跟随用户手动归类，override 变化即同步）
  const mainApp = presence?.screens?.find((s) => s.screen === presence.mainScreen)?.app
  const appCategoryOverride = useSettingsStore((s) => s.settings.appCategoryOverride)
  const mainCat = mainApp ? categoryOfWithOverride(mainApp, appCategoryOverride) : null
  const mainCatEmoji = mainCat ? CATEGORY_META[mainCat].emoji : null

  // ── mini 态：胶囊三形态（归属颗粒 / 未归因轻问 / 萤火虫呼吸） ──
  if (widgetMode === 'mini') {
    const hasAttr = !!(attr?.projectId && attr.projectName)
    const hasPopup = !!(question || bpConfirm || meetingDetected || showUnattrAsk)
    const docked = !!dockEdge
    const expandMiniToFull = (): void => {
      const now = Date.now()
      if (now - expandLockRef.current < 600) return
      expandLockRef.current = now
      miniTapRef.current = 0
      void window.api?.listProjects?.().then((ps) => setAllProjects((ps as Project[]) ?? [])).catch(() => undefined)
      setMode('full')
    }

    // 贴边：一条纯黑胶囊（两端半圆），不是双筒望远镜
    if (docked && dockEdge) {
      return (
        <Firefly active={fireflyActive}>
          <div
            data-widget-solid
            className="drop-in flex h-screen w-screen cursor-grab items-center overflow-hidden active:cursor-grabbing"
            style={{
              background: '#000000',
              borderRadius: 9999,
              border: fireflyActive
                ? `1px solid ${hexAlpha(accent, 0.55)}`
                : '1px solid rgba(255,255,255,0.10)',
              boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.05)'
            }}
            title={hasPopup || notifies.length
              ? '有待办确认/通知 · 双击展开'
              : `${meta.label} · 拖离边缘恢复 · 双击展开`}
            onPointerDown={(e) => bindMiniCapsulePointer(e, expandMiniToFull, miniTapRef)}
          >
            <DockCapsuleRings
              left={dd.left}
              right={dd.right}
              focus={focus}
              focusColor={meta.color}
              appPct={Math.max(focus, 8)}
              appColor={meta.color}
              emoji={mainCatEmoji || meta.emoji}
              icon={mainCat ?? undefined}
              chainSec={chain?.sec ?? 0}
              projectName={attr?.projectName ?? ''}
              minutes={continuousMin}
            />
            <style>{`
              .drop-in { animation: dropIn 260ms cubic-bezier(0.22, 1.15, 0.36, 1); }
              @keyframes dropIn {
                0% { transform: scaleX(0.88) scaleY(0.92); opacity: 0.6; }
                100% { transform: scaleX(1) scaleY(1); opacity: 1; }
              }
            `}</style>
          </div>
        </Firefly>
      )
    }

    // mini 定死尺寸：胶囊铺满窗口，无 padding 透明边
    return (
      <Firefly active={fireflyActive}>
      <div
        data-widget-solid
        className={`flex h-screen w-screen cursor-grab items-center gap-2 rounded-xl px-3 active:cursor-grabbing ${shimmer || fireflyActive ? 'shimmer-ring' : ''}`}
        style={PANEL_STYLE}
        title={hasPopup || notifies.length ? '有确认/通知 · 双击展开' : '拖近边缘可贴边 · 双击展开面板'}
        onPointerDown={(e) => bindMiniCapsulePointer(e, expandMiniToFull, miniTapRef)}
      >
        {hasAttr && dm.project ? (
          <>
            <GrainChip projectName={attr!.projectName} taskTitle={attr!.taskTitle} sec={attr!.sec} />
            {aiAssistEnabled ? aiAssistItems.filter((i) => i.status === 'busy' || i.status === 'done').slice(0, 2).map((i) => (
              <span
                key={i.key}
                data-no-capsule-drag
                className={`inline-block h-2 w-2 shrink-0 rounded-full ${i.status === 'busy' ? 'bg-[#10B981] ring-breathe-green' : 'bg-[#EF4444]'}`}
                title={`${i.label} · ${i.status === 'busy' ? '处理中' : '刚停止回复'}`}
              />
            )) : null}
            {dm.chain && chain?.active ? <ChainChip sec={chain.sec} interruptions={chain.interruptionsToday} /> : null}
          </>
        ) : (
          <>
            {dm.focusRing ? <StateDot color={meta.color} size={11} /> : null}
            {dm.emptyHint ? (
              <span className="min-w-0 flex-1 truncate text-[11px] text-[var(--text-3)]">做点什么，然后归到项目</span>
            ) : <span className="min-w-0 flex-1" />}
            {dm.classifyBtn ? (
            <button
              className="shrink-0 rounded-full bg-[rgba(139,92,246,0.15)] px-2 py-0.5 text-[9.5px] font-bold text-[var(--violet)]"
              data-no-capsule-drag
              onClick={(e) => {
                e.stopPropagation()
                void window.api?.listProjects?.().then((ps) => setAllProjects((ps as Project[]) ?? [])).catch(() => undefined)
                setShowUnattrAsk(true)
                setMode('full')
              }}
            >
              归类
            </button>
            ) : null}
          </>
        )}
        {dm.penetrationBtn && !penetration ? (
        <button
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[var(--text-3)] transition-colors hover:bg-[var(--surface-3)] hover:text-[var(--text-1)]"
          style={{ color: penetration ? accent : undefined }}
          title={penetrationTitle}
          data-no-capsule-drag
          onClick={(e) => { e.stopPropagation(); togglePenetration() }}
        >
          <Icon name="eyeOff" size={12} />
        </button>
        ) : null}
        {fireflyActive ? (
          <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: accent }} title="有通知或待确认" />
        ) : null}
        <style>{`
          .shimmer-ring { animation: shimmer 2s ease-out; }
          @keyframes shimmer {
            0% { box-shadow: inset 0 0 0 1px ${hexAlpha(accent, 0.35)}; }
            50% { box-shadow: inset 0 0 0 1px ${hexAlpha(accent, 0.7)}; }
            100% { box-shadow: inset 0 0 0 1px ${hexAlpha(accent, 0.35)}; }
          }
        `}</style>
      </div>
      </Firefly>
    )
  }

  // ── compact 态：铺满窗口，无透明外边 ──
  if (widgetMode === 'compact') {
    return (
      <div
        data-widget-solid
        className="relative flex h-screen w-screen flex-col overflow-hidden rounded-xl"
        style={PANEL_STYLE}
      >
        {unattrCard}
          {/* 左缘状态色条 */}
          <WidgetHeader>
            <HeaderBtn icon="chevronRight" rotate={-90} title="展开" onClick={() => setMode('full')} />
            <HeaderBtn icon="eyeOff" title={penetrationTitle} onClick={togglePenetration} active={penetration} accent={accent} />
            <HeaderBtn icon="chevronRight" rotate={90} title="收起到最小" onClick={() => setMode('mini')} />
          </WidgetHeader>
          <div className="flex items-center gap-3 pl-4 py-3 pr-3">
            <FocusRing size={44} focus={focus} color={meta.color} emoji={mainCatEmoji || meta.emoji} icon={mainCat ?? undefined} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <span className="text-[14px] font-bold" style={{ color: meta.color }}>{meta.label}</span>
                <span className="text-[10px] tabular-nums text-[var(--text-3)]">
                  {chain?.active ? `⚡ 链路 ${Math.max(1, Math.round(chain.sec / 60))}min` : `专注度 ${focus}`}
                </span>
              </div>
              <div className="mt-0.5 truncate text-[12px] text-[var(--text-2)]">
                {attr?.projectId
                  ? (attr.taskTitle || attr.projectName)
                  : liveTitle || '等待采集…'}
              </div>
              {chain ? (
                <div className="mt-0.5 truncate text-[10px] text-[var(--text-3)]">
                  今日 {chain.chainsToday} 段 · 最长 {Math.max(1, Math.round(chain.longestChainSecToday / 60))}m · 中断 {chain.interruptionsToday}
                </div>
              ) : null}
            </div>
            {!attr?.projectId ? attrBtn : (
              <button
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-[var(--violet)] transition-colors hover:bg-[var(--surface-3)]"
                title="问点什么…"
                onClick={() => setAskState(askState === 'hidden' || askState === 'answer' ? 'input' : 'hidden')}
              >
                <Icon name="message" size={20} />
              </button>
            )}
          </div>
          <div className="mx-3 mb-3 flex flex-col gap-2 overflow-y-auto" style={{ maxHeight: 120 }}>
            <AskBar askState={askState} askText={askText} setAskText={setAskText} submitAsk={submitAsk} onAskBlur={onAskBlur} onEscape={() => setAskState('hidden')} askAnswer={askAnswer} accent={accent} blurTimer={blurTimer} />
            {petBubble && !widgetCompact && <PetBubbleLine text={petBubble} accent={accent} />}
          </div>
          <ResizeHandle onDown={onResizePointerDown} onMove={onResizePointerMove} onUp={onResizePointerUp} />
      </div>
    )
  }

  // ── full 态：铺满窗口，无透明外边 ──
  return (
      <div
        data-widget-solid
        className="relative flex h-screen w-screen flex-col overflow-hidden rounded-xl"
        style={PANEL_STYLE}
      >
        {/* 左缘状态色条 */}
        <WidgetHeader>
          <HeaderBtn icon="eyeOff" title={penetrationTitle} onClick={togglePenetration} active={penetration} accent={accent} />
          <HeaderBtn icon="chevronRight" rotate={90} title="收起" onClick={() => setMode('mini')} />
          <HeaderBtn icon="x" title="隐藏悬浮窗" onClick={() => window.api.toggleWidget()} />
        </WidgetHeader>

        <div className="mx-3 mt-1">
          <NotificationStack list={notifies} onDone={(id) => setNotifies((l) => l.filter((x) => x.id !== id))} />
        </div>


        {welcome && !widgetCompact && (
          <div className="anim-fade-in mx-3 mt-2 rounded-lg border border-neon-green/20 bg-neon-green/10 px-3 py-1.5 text-center text-xs text-neon-green">
            欢迎回到正事
          </div>
        )}

        {/* ── 状态（桌搭 widgetDisplay.full.status）── */}
        {df.status ? (
        <div
          className="flex items-center gap-3 px-3.5 py-3"
          onMouseEnter={() => setShowFocusMinutes(true)}
          onMouseLeave={() => setShowFocusMinutes(false)}
        >
          <FocusRing size={44} focus={focus} color={meta.color} emoji={mainCatEmoji || meta.emoji} icon={mainCat ?? undefined} />
          <div className="min-w-0 flex-1">
            <div className="text-[13px] font-semibold" style={{ color: meta.color }}>
              {aiAssistEnabled && aiAssistItems.some((i) => i.status === 'done' && mainApp && mainApp.toLowerCase().replace(/\.exe$/i, '') === i.key) ? (
                <span className="ai-assist-dot-done mr-1.5 inline-block h-1.5 w-1.5 rounded-full align-middle" style={{ background: '#34D399' }} />
              ) : null}
              {meta.label}{' '}
              <span
                className="text-[11px] font-normal text-[var(--text-3)]"
                title={presence ? `实时专注度 ${focus}（0-100）· 当前状态 ${presence.state}\n多维注意力评分见「监控/报表」页` : undefined}
              >
                专注度 {focus}
              </span>
            </div>
            {attr?.projectId ? (
              <>
                {df.projectChip ? <div className="mt-0.5 flex min-w-0 items-center gap-1"><GrainChip projectName={attr.projectName} taskTitle={attr.taskTitle} sec={attr.sec} /></div> : null}
                {aiAssistEnabled && aiAssistItems.length ? (
                  <div className="mt-1 flex items-center gap-2.5">
                    {aiAssistItems.slice(0, 6).map((i) => (
                      <AiAssistRing key={i.key} item={i} />
                    ))}
                  </div>
                ) : null}
              </>
            ) : (
              <div className="mt-0.5">{attrBtn}</div>
            )}
            {presence && presence.continuousFocusSec > 60 && showFocusMinutes && df.focusMinutes && (
              <div className="mt-0.5 text-[11px]" style={{ color: accent }}>
                已专注 {Math.round(presence.continuousFocusSec / 60)} 分钟
              </div>
            )}
          </div>
            <button
              className={`ml-auto flex h-11 w-11 shrink-0 items-center justify-center rounded-lg transition-colors hover:bg-[var(--surface-3)] ${askState !== 'hidden' && askState !== 'answer' ? 'text-[var(--text-3)] hover:text-[var(--text-1)]' : 'text-[var(--violet)]'}`}
              title="问点什么…"
              onClick={() => setAskState(askState === 'hidden' || askState === 'answer' ? 'input' : 'hidden')}
              style={{ display: df.askBtn && aiEnabled ? undefined : 'none' }}
            >
              <span className="relative inline-flex items-center justify-center">
                <Icon name="message" size={22} />
                <span className="absolute inset-0 flex items-center justify-center text-[8px] font-black" style={{ color: 'var(--violet)' }}>AI</span>
              </span>
            </button>
        </div>
        ) : null}

        {unattrCard}
        {/* 归属项目今日待办（颗粒勾选） */}
        {attrPlans.length && df.attrPlans ? (
          <div className="mx-3 mb-2 rounded-xl border border-[var(--line)] bg-[var(--surface-2)] px-2.5 py-2">
            <div className="mb-1 text-[10px] uppercase tracking-wider text-[var(--text-3)]">{attr?.projectName} · 今日待办</div>
            {attrPlans.map((p) => (
              <div key={p.id} className="flex items-center gap-2 py-[3px]">
                <button
                  className="shrink-0 text-[12px] text-[var(--text-3)] transition-colors hover:text-[var(--text-1)]"
                  title="完成"
                  onClick={() => {
                    void window.api?.setPlanStatus?.(p.id, 'done')
                    setAttrPlans((l) => l.filter((x) => x.id !== p.id))
                  }}
                >
                  ○
                </button>
                <span className="min-w-0 flex-1 truncate text-[11.5px] text-[var(--text-2)]">{p.title}</span>
              </div>
            ))}
          </div>
        ) : null}

        {/* 展开的问答条（与情境确认同壳）+ 桌宠气泡 */}
        {askState && askState !== 'hidden' ? (
          <div className="mx-3 mb-3">
            <InsetCard color="#8B5CF6" title="💬 AI 问答">
              <AskBar askState={askState} askText={askText} setAskText={setAskText} submitAsk={submitAsk} onAskBlur={onAskBlur} onEscape={() => setAskState('hidden')} askAnswer={askAnswer} accent={accent} blurTimer={blurTimer} />
            </InsetCard>
          </div>
        ) : null}
        {petBubble && !widgetCompact && df.petBubble ? <div className="mx-3 mb-2"><PetBubbleLine text={petBubble} accent={accent} /></div> : null}

        {/* ── 情境确认（动态流） ── */}
        <div className="mx-3 mb-1 mt-2 flex max-h-[320px] flex-col gap-2 overflow-y-auto">
          {bpConfirm ? (
            <AlertShell color="#3B82F6" label="🌐 浏览器检测" collapsed={!!alertCollapsed['bp']} onToggle={() => toggleAlert('bp')}>
              <div className="mb-1 text-[11px] font-medium" style={{ color: '#7FB0F7' }}>🌐 浏览器检测</div>
              <div className="mb-2 pr-4 text-xs leading-relaxed text-[var(--text-1)]">
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
                  className="flex-1 rounded-lg bg-white/[0.05] py-1.5 text-xs text-[var(--text-3)] transition-colors hover:bg-[var(--surface-3)]"
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
              <div className="mb-2 pr-4 text-xs leading-relaxed text-[var(--text-1)]">
                检测到你正在使用 {meetingDetected.app.replace(/\.exe$/i, '')} 开会，选择会议模式：
              </div>
              <div className="flex gap-1.5">
                <button
                  className="flex-1 rounded-lg bg-white/[0.07] py-1.5 text-[11px] text-[var(--text-1)] transition-colors hover:bg-white/[0.12]"
                  onClick={() => chooseMeetingMode('stealth')}
                >
                  🤫 一键隐身
                </button>
                <button
                  className="flex-1 rounded-lg bg-white/[0.07] py-1.5 text-[11px] text-[var(--text-1)] transition-colors hover:bg-white/[0.12]"
                  onClick={() => chooseMeetingMode('quiet')}
                >
                  🔇 免打扰
                </button>
                <button
                  className="flex-1 rounded-lg bg-white/[0.07] py-1.5 text-[11px] text-[var(--text-1)] transition-colors hover:bg-white/[0.12]"
                  onClick={() => chooseMeetingMode('assist')}
                >
                  📝 会议辅助
                </button>
              </div>
              <label className="mt-2 flex cursor-pointer items-center gap-1.5 text-[10px] text-[var(--text-3)]">
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

          {question && (question.ctx ?? '').startsWith('attrib') ? (
            <InsetCard color="#8B5CF6" title="📂 归到哪个项目？">
              <UnattrAskCard
                projects={allProjects}
                apps={(question as unknown as { apps?: string[] })?.apps}
                fp={(question?.ctx ?? '').startsWith('attrib:') ? question!.ctx.slice(7) : undefined}
                onDone={() => answer('yes')}
              />
            </InsetCard>
          ) : question ? (
            <AlertShell color="#8B5CF6" label="📋 轻问诊" collapsed={!!alertCollapsed['q']} onToggle={() => toggleAlert('q')}>
              <div className="mb-2 pr-4 text-xs leading-relaxed text-[var(--text-1)]">{question.question}</div>
              <div className="flex gap-2">
                <button
                  className="flex-1 rounded-lg py-1.5 text-xs transition-colors hover:brightness-125"
                  style={{ background: 'rgba(16,185,129,0.16)', color: '#34D399' }}
                  onClick={() => answer('yes')}
                >
                  是
                </button>
                <button
                  className="flex-1 rounded-lg bg-white/[0.05] py-1.5 text-xs text-[var(--text-3)] transition-colors hover:bg-[var(--surface-3)]"
                  onClick={() => answer('no')}
                >
                  不是
                </button>
              </div>
            </AlertShell>
          ) : !bpConfirm ? (
            widgetCompact || !df.idleHint ? null : (
              <InsetCard color="#94A3B8" title="📋 情境确认">
                <div className="text-center text-[11px] text-[var(--text-3)]">
                  暂无新的情境确认 · 越用越聪明
                </div>
              </InsetCard>
            )
          ) : null}
        </div>

        <ResizeHandle onDown={onResizePointerDown} onMove={onResizePointerMove} onUp={onResizePointerUp} />
      </div>
  )
}

/** 未归因轻问卡：先问在干啥 → 归到已有项目 / 现场新建（真指纹+真应用，归属后自动落一条计划） */
function UnattrAskCard({ onDone, projects, apps, fp, date }: { onDone: () => void; projects: Project[]; apps?: string[]; fp?: string; date?: string }) {
  const [pick, setPick] = useState<string>('')
  const [newName, setNewName] = useState('')
  const [doing, setDoing] = useState('')
  const realApps = (apps ?? []).filter(Boolean)
  const answer = (answer: string, payload?: { projectId?: string; projectName?: string }): void => {
    void window.api
      ?.answerAttribution?.(fp || `unattr-ui:${Date.now()}`, answer, { apps: realApps, ...payload })
      ?.then((res) => {
        const r = res as { projectId?: string | null; projectName?: string } | undefined
        const pid = r?.projectId ?? payload?.projectId
        // 归属成功且填了"在干啥" → 落一条今日计划挂到该项目
        if (pid && doing.trim()) {
          void window.api?.savePlan?.({
            date: date ?? new Date().toISOString().slice(0, 10),
            title: doing.trim().slice(0, 100),
            category: 'other',
            status: 'planned',
            projectId: pid,
            source: 'manual',
            note: '来自归属归类'
          })
        }
      })
    onDone()
  }
  return (
    <div className="w-full">
      <div className="mb-2 flex flex-col gap-1">
        {projects.slice(0, 5).map((p) => (
          <button
            key={p.id}
            className={`flex items-center gap-2 rounded-lg border px-2 py-1.5 text-left text-[11px] transition-all ${
              pick === p.id ? 'border-[rgba(15,181,164,0.5)] bg-[var(--teal-soft)] text-[var(--teal-deep)]' : 'border-[var(--line)] text-[var(--text-2)] hover:bg-[var(--surface-2)]'
            }`}
            onClick={() => setPick(p.id)}
          >
            {pick === p.id ? '◉' : '○'} {p.name}
          </button>
        ))}
        {!projects.length ? <div className="text-[10.5px] text-[var(--text-3)]">还没有项目</div> : null}
      </div>
      <input
        className="mb-2 w-full rounded-lg border border-[var(--line)] bg-[var(--surface-2)] px-2 py-1.5 text-[11px] text-[var(--text-1)] outline-none focus:border-[var(--border-active)]"
        placeholder="刚才在干什么？（如：调 DM8 连接）"
        value={doing}
        onChange={(e) => setDoing(e.target.value)}
      />
      {!pick ? (
        <div className="flex items-center gap-1.5">
          <input
            className="min-w-0 flex-1 rounded-lg border border-[var(--line)] bg-[var(--surface-2)] px-2 py-1.5 text-[11px] text-[var(--text-1)] outline-none focus:border-[var(--border-active)]"
            placeholder="或新建项目名…"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
          />
        </div>
      ) : null}
      <div className="mt-2 flex justify-end gap-1.5">
        <button className="rounded-lg bg-[var(--surface-2)] px-2.5 py-1 text-[10.5px] text-[var(--text-3)] hover:bg-[var(--surface-3)]" onClick={onDone}>
          忽略
        </button>
        <button
          className="rounded-lg bg-[var(--teal)] px-2.5 py-1 text-[10.5px] font-bold text-white disabled:opacity-40"
          disabled={!pick && !newName.trim()}
          onClick={() => answer(pick ? 'bind' : 'create', pick ? { projectId: pick } : { projectName: newName.trim() || doing.trim() })}
        >
          {pick ? '归到该项目' : '创建并归入'}
        </button>
      </div>
    </div>
  )
}
