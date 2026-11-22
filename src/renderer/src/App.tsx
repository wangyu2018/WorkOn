/**
 * 主窗口壳：左侧固定 5 个主入口 + 「更多」折叠 + 内容区
 * 设计：静谧深空 · accent 变量驱动的选中态（换主题自动联动）
 */
import { memo, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react'
import { useAppStore, type ViewKey } from './stores/appStore'
import { usePresenceStore } from './stores/presenceStore'
import { useSettingsStore } from './stores/settingsStore'
import { Icon, type IconName } from './components/Icon'
import { WeatherCard } from './components/WeatherCard'
import { CATEGORY_META, categoryOfWithOverride, type AppCategory } from '@shared/appCategory'
import { displayApp } from '@shared/appDisplayName'
import workonLogo from './assets/workon-logo.png'
import HomeView from './views/HomeView'
import MonitorView from './views/MonitorView'
import KnowledgeView from './views/KnowledgeView'
import CalendarView from './views/CalendarView'
import PlanView from './views/PlanView'
import MainlineView from './views/MainlineView'
import ReportHub from './views/ReportHub'
import QAReview from './views/QAReview'
import ProfileView from './views/ProfileView'
import PrivacyView from './views/PrivacyView'
import SettingsView from './views/SettingsView'
import IntelView from './views/IntelView'
import AgentView from './views/AgentView'
import WorkflowView from './views/WorkflowView'
import GraphView from './views/GraphView'
import { SessionFloat } from './components/SessionFloat'
import { SessionsBar } from './components/SessionsBar'
import { BookmarkBar } from './components/BookmarkBar'
import { PageWindow } from './components/PageWindow'
import { CoachCards } from './components/CoachCards'
import { PlanProposalCard } from './components/PlanProposalCard'
import { ViewErrorBoundary } from './components/ViewErrorBoundary'
import { AgentWizard } from './components/AgentWizard'
import { PasteInboxModal } from './components/PasteInboxModal'
import { ModalShell } from './components/ui/Modal'
import { usePerspective } from './lib/usePerspective'
import { EdgeDockBar } from './v10/EdgeDockBar'
import { RightRail } from './components/RightRail'

interface NavItem {
  key: ViewKey
  label: string
  icon: IconName
}

/** 浮窗拖动：边距与吸附阈值（px） */
const WIN_MARGIN = 12
const WIN_SNAP = 18

/** 把浮窗位置限制在中间板块内；snap=true 时吸附左右/上下/水平居中 */
function clampPageWin(
  x: number,
  y: number,
  w: number,
  h: number,
  W: number,
  H: number,
  snap = false
): { x: number; y: number } {
  const maxX = Math.max(WIN_MARGIN, W - w - WIN_MARGIN)
  const maxY = Math.max(WIN_MARGIN, H - h - WIN_MARGIN)
  let nx = Math.min(Math.max(x, WIN_MARGIN), maxX)
  let ny = Math.min(Math.max(y, WIN_MARGIN), maxY)
  if (snap) {
    if (Math.abs(nx - WIN_MARGIN) < WIN_SNAP) nx = WIN_MARGIN
    if (Math.abs(nx - maxX) < WIN_SNAP) nx = maxX
    if (Math.abs(nx + w / 2 - W / 2) < WIN_SNAP) nx = Math.round((W - w) / 2)
    if (Math.abs(ny - WIN_MARGIN) < WIN_SNAP) ny = WIN_MARGIN
    if (Math.abs(ny - maxY) < WIN_SNAP) ny = maxY
    if (Math.abs(ny + h / 2 - H / 2) < WIN_SNAP) ny = Math.round((H - h) / 2)
  }
  return { x: nx, y: ny }
}

/** 一级入口：对应「一天里的三个时刻」——现在 / 要做什么 / 做完了看什么 */
const PRIMARY_NAV: NavItem[] = [
  { key: 'home', label: '今天', icon: 'home' },
  { key: 'plan', label: '计划', icon: 'target' },
  { key: 'intel', label: '情报', icon: 'book' },
  { key: 'agents', label: 'Agent', icon: 'zap' },
  { key: 'workflow', label: '工作流', icon: 'sparkles' },
  { key: 'report', label: '回顾', icon: 'chart' },
  { key: 'more', label: '更多', icon: 'folder' }
]

/** 二级入口：低频但能力不丢，收进「更多」 */
const SECONDARY_NAV: NavItem[] = [
  { key: 'calendar', label: '日历', icon: 'calendar' },
  { key: 'knowledge', label: '知识', icon: 'book' },
  { key: 'mainline', label: '主线', icon: 'folder' },
  { key: 'graph', label: '图谱', icon: 'activity' },
  { key: 'qa', label: '问答', icon: 'message' },
  { key: 'profile', label: '画像', icon: 'eye' },
  { key: 'privacy', label: '隐私', icon: 'shield' }
]

const VIEWS: Record<ViewKey, () => JSX.Element> = {
  home: HomeView,
  more: MoreView,
  monitor: MonitorView,
  knowledge: KnowledgeView,
  calendar: CalendarView,
  plan: PlanView,
  mainline: MainlineView,
  report: ReportHub,
  qa: QAReview,
  profile: ProfileView,
  privacy: PrivacyView,
  settings: SettingsView,
  intel: IntelView,
  agents: AgentView,
  workflow: WorkflowView,
  graph: GraphView
}

/** 二级入口整页：不再用下拉浮层，点开即整页切换 */
function MoreView(): JSX.Element {
  const { view, setView } = useAppStore()
  return (
    <div className="mx-auto w-full max-w-[900px] px-6 py-8">
      <h1 className="text-lg font-semibold text-[var(--text-1)]">更多</h1>
      <p className="mt-1 text-xs text-[var(--text-3)]">低频入口都收在这里，点开直接整页打开。</p>
      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
        {SECONDARY_NAV.map((item) => (
          <button
            key={item.key}
            type="button"
            onClick={() => setView(item.key)}
            className={`flex items-center gap-2 rounded-xl px-3 py-3 text-sm transition-colors ${
              view === item.key
                ? 'bg-[var(--surface-3)] text-[var(--text-1)]'
                : 'text-[var(--text-2)] hover:bg-[var(--surface-2)] hover:text-[var(--text-1)]'
            }`}
            style={{ border: '1px solid var(--line)' }}
          >
            <Icon name={item.icon} size={15} className="shrink-0 opacity-70" />
            {item.label}
          </button>
        ))}
      </div>
    </div>
  )
}

/** 顶部文字导航：选中=黑字加粗，未选中=灰字，不用背景块
 *  窗口变窄（<1180px）自动收成图标，避免中文逐字竖排 */
function TopTab({ item, active, onClick }: { item: NavItem; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={item.label}
      aria-label={item.label}
      aria-current={active ? 'page' : undefined}
      className={`flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1.5 text-sm transition-colors max-[1180px]:px-2 ${
        active
          ? 'font-medium text-[var(--text-1)]'
          : 'text-[var(--text-2)] hover:bg-[var(--surface-2)] hover:text-[var(--text-1)]'
      }`}
      style={active ? { background: 'var(--surface-2)', boxShadow: 'inset 0 -2px 0 var(--accent)' } : undefined}
    >
      <Icon name={item.icon} size={14} className="hidden shrink-0 opacity-80 max-[1180px]:inline-block" />
      <span className="max-[1180px]:hidden">{item.label}</span>
    </button>
  )
}

/** 主窗窗口按钮：mac 左上角三色点，Windows 右上角常规按钮 */
function WindowControls({ mac, maxed }: { mac: boolean; maxed: boolean }): JSX.Element {
  if (mac) {
    return (
      <div className="app-no-drag flex shrink-0 items-center gap-2 pr-1">
        <button
          type="button"
          className="h-3 w-3 rounded-full"
          style={{ background: '#ff5f57', border: '1px solid rgba(0,0,0,0.12)' }}
          title="关闭（最小化到托盘）"
          aria-label="关闭窗口"
          onClick={() => window.api?.closeWindow?.()}
        />
        <button
          type="button"
          className="h-3 w-3 rounded-full"
          style={{ background: '#febc2e', border: '1px solid rgba(0,0,0,0.12)' }}
          title="最小化"
          aria-label="最小化"
          onClick={() => window.api?.minimize?.()}
        />
        <button
          type="button"
          className="h-3 w-3 rounded-full"
          style={{ background: '#28c840', border: '1px solid rgba(0,0,0,0.12)' }}
          title={maxed ? '还原窗口' : '最大化窗口'}
          aria-label="最大化或还原"
          onClick={() => window.api?.maximize?.()}
        />
      </div>
    )
  }
  return (
    <div className="app-no-drag flex shrink-0 items-center gap-2">
      <button
        type="button"
        className="ui-icon-btn"
        title="最小化"
        aria-label="最小化"
        onClick={() => window.api?.minimize?.()}
      >
        <Icon name="minimize" size={13} />
      </button>
      <button
        type="button"
        className="ui-icon-btn"
        title={maxed ? '还原窗口' : '最大化窗口'}
        aria-label="最大化或还原"
        onClick={() => window.api?.maximize?.()}
      >
        <Icon name={maxed ? 'minimize' : 'maximize'} size={13} />
      </button>
      <button
        type="button"
        className="ui-icon-btn hover:!bg-red-500 hover:!text-white"
        title="关闭（最小化到托盘）"
        aria-label="关闭窗口"
        onClick={() => window.api?.closeWindow?.()}
      >
        <Icon name="x" size={13} />
      </button>
    </div>
  )
}

export default function App() {
  const { view, setView } = useAppStore()
  const presence = usePresenceStore((s) => s.presence)
  const loadSettings = useSettingsStore((s) => s.load)
  const settings = useSettingsStore((s) => s.settings)
  const theme = useSettingsStore((s) => s.settings.theme)
  const appearanceMode = useSettingsStore((s) => s.settings.appearanceMode)
  const darkTone = useSettingsStore((s) => s.settings.darkTone)
  // 当前活跃应用 → 分类图标（跟随用户手动归类，override 变化即同步）
  const appCategoryOverride = useSettingsStore((s) => s.settings.appCategoryOverride)
  const mainScreen = presence?.screens?.find((s) => s.screen === presence.mainScreen)
  const mainApp = mainScreen?.app
  const mainCat: AppCategory | null = mainApp ? categoryOfWithOverride(mainApp, appCategoryOverride) : null
  /** 右上角当前应用标签；macOS 走 Swift 采集器，无数据时提示检查权限而非说平台不支持 */
  const isMac = typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform)
  const currentAppLabel = mainApp
    ? displayApp(mainApp)
    : isMac
      ? '等待采集…（macOS 需辅助功能 / 屏幕录制权限）'
      : '等待采集…'

  // 日视角仅用于首页块编排（usePerspective 内部仍会写 localStorage），导航保持恒定
  usePerspective()
  const [maxed, setMaxed] = useState(false)
  /** 右侧多态栏：开关在右侧边缘 */
  const [railOpen, setRailOpen] = useState(() => localStorage.getItem('workon:rail-open') !== '0')
  /** 页面浮窗：关闭后内容区留空，点顶部导航重新打开 */
  const [pageOpen, setPageOpen] = useState(true)
  const [pageMax, setPageMax] = useState(false)
  /** 页面浮窗位置：拖动后改为像素定位；null 时用默认百分比布局 */
  const [winPos, setWinPos] = useState<{ x: number; y: number; w: number; h: number } | null>(null)
  const [dragging, setDragging] = useState(false)
  const stageRef = useRef<HTMLDivElement>(null)
  const pageWrapRef = useRef<HTMLDivElement>(null)
  /** 浮窗返回栈 */
  const [pageHistory, setPageHistory] = useState<ViewKey[]>([])
  /** 左栏当前会话高亮（会话浮窗收起时也能保持） */
  const [activeSessionId, setActiveSessionId] = useState(() => {
    try {
      return localStorage.getItem('workon:global-session') || ''
    } catch {
      return ''
    }
  })
  const prevViewRef = useRef(view)
  const toggleRail = (): void => {
    setRailOpen((v) => {
      try {
        localStorage.setItem('workon:rail-open', v ? '0' : '1')
      } catch { /* ignore */ }
      return !v
    })
  }
  const openPage = (key: ViewKey): void => {
    setPageOpen(true)
    setView(key)
  }
  // 外部 setView（如编排生成后跳转）也让浮窗保持打开并记录返回栈
  useEffect(() => {
    if (prevViewRef.current !== view) {
      const from = prevViewRef.current
      prevViewRef.current = view
      setPageHistory((h) => [...h.slice(-9), from])
    }
    setPageOpen(true)
  }, [view])
  const goBack = (): void => {
    const last = pageHistory[pageHistory.length - 1]
    if (!last) {
      setPageOpen(false)
      return
    }
    prevViewRef.current = last
    setView(last)
    setPageHistory((h) => h.slice(0, -1))
  }
  const pageTitle =
    [...PRIMARY_NAV, ...SECONDARY_NAV].find((i) => i.key === view)?.label ??
    (view === 'settings' ? '设置' : view === 'monitor' ? '监控' : '页面')
  const inSecondary = useMemo(() => SECONDARY_NAV.some((i) => i.key === view), [view])

  // 窗口缩放后把已拖动的浮窗收回中间板块内
  useEffect(() => {
    const stage = stageRef.current
    if (!stage) return
    const ro = new ResizeObserver(() => {
      setWinPos((p) => {
        if (!p) return p
        const W = stage.clientWidth
        const H = stage.clientHeight
        const w = Math.min(p.w, Math.max(240, W - WIN_MARGIN * 2))
        const h = Math.min(p.h, Math.max(180, H - WIN_MARGIN * 2))
        const c = clampPageWin(p.x, p.y, w, h, W, H)
        return { x: c.x, y: c.y, w, h }
      })
    })
    ro.observe(stage)
    return () => ro.disconnect()
  }, [])

  /** 标题栏拖动浮窗：拖动中跟随指针，松手时做边缘/居中吸附 */
  const startPageDrag = (e: ReactPointerEvent<HTMLDivElement>): void => {
    if (pageMax || e.button !== 0) return
    const stage = stageRef.current
    const wrap = pageWrapRef.current
    if (!stage || !wrap) return
    const sr = stage.getBoundingClientRect()
    const wr = wrap.getBoundingClientRect()
    const size = { w: wr.width, h: wr.height }
    const offX = e.clientX - wr.left
    const offY = e.clientY - wr.top
    let last = { x: wr.left - sr.left, y: wr.top - sr.top }
    setWinPos({ ...last, ...size })
    setDragging(true)
    const move = (ev: PointerEvent): void => {
      const W = stage.clientWidth
      const H = stage.clientHeight
      last = clampPageWin(ev.clientX - sr.left - offX, ev.clientY - sr.top - offY, size.w, size.h, W, H)
      setWinPos({ ...last, ...size })
    }
    const up = (): void => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      document.body.style.cursor = ''
      setDragging(false)
      const W = stage.clientWidth
      const H = stage.clientHeight
      last = clampPageWin(last.x, last.y, size.w, size.h, W, H, true)
      setWinPos({ ...last, ...size })
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    document.body.style.cursor = 'grabbing'
    e.preventDefault()
  }

  // 最大化状态（窗口按钮图标 / 双击标题栏）
  useEffect(() => {
    void window.api?.isMaximized?.().then((v) => setMaxed(!!v)).catch(() => undefined)
    const off = window.api?.onWindowMaxState?.((v) => setMaxed(!!v))
    return () => off?.()
  }, [])

  // 强调色主题 + 亮暗模式应用到根节点
  useEffect(() => {
    // 空闲预热：统计页近 7 天 trail，主进程聚合一次后常驻缓存
    if (!(window as unknown as { __trailWarmed?: boolean }).__trailWarmed) {
      ;(window as unknown as { __trailWarmed?: boolean }).__trailWarmed = true
      const warm = (): void => {
        for (let i = 0; i < 7; i++) {
          const d = new Date()
          d.setDate(d.getDate() - i)
          const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
          void window.api?.getTrail?.(key).catch(() => undefined)
        }
      }
      const w = window as unknown as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => void }
      if (typeof w.requestIdleCallback === 'function') w.requestIdleCallback(warm, { timeout: 20000 })
      else setTimeout(warm, 6000)
    }
    document.documentElement.dataset.theme = theme
  }, [theme])
  useEffect(() => {
    document.documentElement.dataset.tone = darkTone === 'navy' ? 'navy' : 'void'
    // 浅色外观不套用深色底色，避免黑底渗进浅色界面
    if (appearanceMode === 'light') {
      document.documentElement.dataset.toneActive = '0'
    } else {
      document.documentElement.dataset.toneActive = '1'
    }
  }, [darkTone, appearanceMode])
  // 动效开关：关闭时给根节点加 data-anim=off（CSS 禁用动画/过渡）
  useEffect(() => {
    document.documentElement.dataset.anim = settings.animationsEnabled ? 'on' : 'off'
  }, [settings.animationsEnabled])
  useEffect(() => {
    const apply = () => {
      const mode =
        appearanceMode === 'auto'
          ? window.matchMedia('(prefers-color-scheme: dark)').matches
            ? 'dark'
            : 'light'
          : appearanceMode
      document.documentElement.dataset.mode = mode
    }
    apply()
    if (appearanceMode !== 'auto') return
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    mq.addEventListener('change', apply)
    return () => mq.removeEventListener('change', apply)
  }, [appearanceMode])

  // 页面切换广播到桌宠（抑制其状态切换 2s）
  useEffect(() => {
    window.api.pageSwitch()
  }, [view])

  useEffect(() => {
    const cleanup = usePresenceStore.getState().init()
    void loadSettings()
    return cleanup
  }, [loadSettings])

  // 全局错误横幅（数据写入失败等主进程异常 → 用户可感知）
  const [errorBanner, setErrorBanner] = useState<string | null>(null)
  useEffect(() => {
    const off = window.api.onErrorBanner?.((msg) => {
      setErrorBanner(String(msg))
      window.setTimeout(() => setErrorBanner(null), 8000)
    })
    return off
  }, [])

  // 首启隐私同意门（审计 F1）：pending 时弹欢迎+告知卡，选择后写入并按需启动采集
  const [consentDismissed, setConsentDismissed] = useState(false)
  const settingsLoaded = useSettingsStore((s) => s.loaded)
  const showConsent = settingsLoaded && settings.privacyConsent === 'pending' && !consentDismissed
  const answerConsent = (v: 'granted' | 'declined'): void => {
    void window.api?.setConsent?.(v)
    setConsentDismissed(true)
  }

  // 托盘快速问答等外部跳转请求
  useEffect(() => {
    const off = window.api.onNavView?.((v) => {
      if (typeof v !== 'string') return
      // 监控已迁入首页模块；旧入口落到首页
      useAppStore.getState().setView(v === 'monitor' ? 'home' : (v as never))
    })
    return off
  }, [])

  // 主窗口 Ctrl+V：非输入框时弹出粘贴识别预览（进展 / 待办 / 备忘）
  const [pasteInboxOpen, setPasteInboxOpen] = useState(false)
  /** 全局会话固定停靠在中间板块底部，⌘K / 顶栏「对话」只负责聚焦输入框 */
  const focusComposer = (): void => {
    window.dispatchEvent(new CustomEvent('workon:focus-composer'))
  }
  const railVisible = railOpen
  useEffect(() => {
    const onActive = (e: Event): void => {
      const id = (e as CustomEvent<string>).detail
      if (typeof id === 'string') setActiveSessionId(id)
    }
    window.addEventListener('workon:active-session', onActive)
    return () => window.removeEventListener('workon:active-session', onActive)
  }, [])
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 'k') return
      e.preventDefault()
      focusComposer()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])
  useEffect(() => {
    const isEditable = (el: EventTarget | null): boolean => {
      const n = el as HTMLElement | null
      if (!n) return false
      if (n.closest?.('[data-paste-inbox]')) return true
      const tag = n.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true
      if ((n as HTMLElement).isContentEditable) return true
      return !!n.closest?.('input, textarea, select, [contenteditable="true"]')
    }
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 'v') return
      if (isEditable(e.target)) return
      // 工作流画布有自己的 ⌘V（粘贴节点），不能被全局粘贴识别抢走
      if (useAppStore.getState().view === 'workflow') return
      e.preventDefault()
      e.stopPropagation()
      setPasteInboxOpen(true)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])

  // memo 化当前视图：presence 每 2s 更新时不再整页重渲染（修复时间轴/星图卡顿）
  const ActiveView = useMemo(() => memo(VIEWS[view]), [view])

  // EdgeDock 边缘分组（2026-11-02）：?edgedock=top|left|right → 渲染 Dock 条
  const edgeDockMode = useMemo(() => {
    const q = new URLSearchParams(window.location.search).get('edgedock')
    return q === 'top' || q === 'left' || q === 'right' ? q : null
  }, [])
  // EdgeDock 路由优先
  if (edgeDockMode) {
    return <EdgeDockBar edge={edgeDockMode} />
  }

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden text-slate-200" style={{ background: 'var(--bg-deep)' }}>
      <PasteInboxModal open={pasteInboxOpen} onClose={() => setPasteInboxOpen(false)} />
      <CoachCards />
      <PlanProposalCard />

      {/* 顶部导航（Today 式）：品牌 + 文字 tab + 状态/窗口操作，不再有左侧大栏 */}
      <header
        className="app-drag relative z-30 flex h-16 shrink-0 items-center gap-6 px-6"
        style={{ borderBottom: '1px solid var(--line)', background: 'var(--bg-deep)' }}
        onDoubleClick={(e) => {
          if ((e.target as HTMLElement).closest('.app-no-drag')) return
          window.api?.maximize?.()
        }}
      >
        {isMac ? <WindowControls mac maxed={maxed} /> : null}

        <div className="flex shrink-0 items-center gap-2.5">
          <img src={workonLogo} alt="WorkOn" className="h-6 w-6 rounded-md" />
          <span className="text-sm font-semibold tracking-tight text-[var(--text-1)]">WorkOn</span>
        </div>

        <nav className="app-no-drag flex items-center gap-1">
          {PRIMARY_NAV.map((item) => (
            <TopTab
              key={item.key}
              item={item}
              active={item.key === 'more' ? view === 'more' || inSecondary : view === item.key}
              onClick={() => openPage(item.key)}
            />
          ))}
        </nav>

        <div className="flex min-w-0 flex-1" />

        <div className="app-no-drag flex shrink-0 items-center gap-2" style={{ WebkitAppRegion: 'no-drag' } as CSSProperties}>
          <span className="hidden min-w-0 max-w-[260px] truncate text-xs text-slate-500 min-[1180px]:block">
            {mainCat ? `${CATEGORY_META[mainCat].label} · ` : ''}
            {currentAppLabel}
          </span>
          <WeatherCard />
          <button
            type="button"
            className="glass-btn flex items-center gap-1 px-2.5 py-1 text-xs"
            style={{ background: 'var(--accent-soft)', border: '1px solid var(--border-active)', color: 'var(--accent)' }}
            title="聚焦全局对话与 Agent 派发（⌘K）"
            onClick={focusComposer}
          >
            <Icon name="message" size={13} />
            对话
          </button>
          <button
            type="button"
            className="ui-icon-btn"
            style={{ background: 'var(--surface-2)', border: '1px solid var(--line)', color: 'var(--text-2)' }}
            title="设置"
            aria-label="设置"
            onClick={() => openPage('settings')}
          >
            <Icon name="settings" size={15} />
          </button>
          {!isMac ? <WindowControls mac={false} maxed={maxed} /> : null}
        </div>
      </header>

      {/* 顶部数据书签：任意页面的一条数据固定在此，像书签一样悬挂 */}
      <BookmarkBar />

      {/* 左：会话栏；中：页面浮窗；右：多态栏（开关在右侧边缘）；页面最大化时两侧自动让位 */}
      <div className="flex min-h-0 flex-1">
        {!pageMax ? <SessionsBar activeId={activeSessionId} onOpenSession={focusComposer} /> : null}

        <div ref={stageRef} className={`relative min-h-0 min-w-0 flex-1 ${pageMax ? 'p-0' : 'p-3'}`}>
          {/* 全局会话：中间板块的主体，铺满整个区域 */}
          <div className="h-full min-h-0">
            <SessionFloat />
          </div>

          {/* 页面浮层：盖在会话上方，关闭后回到完整会话；最大化时铺满中间 */}
          {pageOpen ? (
            <div
              ref={pageWrapRef}
              className={`absolute z-20 ${pageMax ? 'inset-0' : ''}`}
              style={
                pageMax
                  ? undefined
                  : winPos
                    ? {
                        left: winPos.x,
                        top: winPos.y,
                        width: winPos.w,
                        height: winPos.h,
                        transition: dragging
                          ? 'none'
                          : 'left 160ms cubic-bezier(.22,.9,.3,1.08), top 160ms cubic-bezier(.22,.9,.3,1.08)'
                      }
                    : { top: '56px', left: '10%', right: '10%', bottom: '24%' }
              }
            >
              <PageWindow
                title={pageTitle}
                isMac={isMac}
                maximized={pageMax}
                canBack={pageHistory.length > 0}
                onBack={goBack}
                onClose={() => setPageOpen(false)}
                onToggleMax={() => setPageMax((v) => !v)}
                onHeaderPointerDown={startPageDrag}
              >
                <div className="w-full px-8 pb-16 pt-10">
                  <ViewErrorBoundary view={view}>
                    <ActiveView />
                  </ViewErrorBoundary>
                </div>
              </PageWindow>
            </div>
          ) : null}
        </div>

        {!pageMax ? (
          <button
            type="button"
            onClick={toggleRail}
            title={railVisible ? '收起右侧栏' : '展开右侧栏（流程 / 计划安排 / 项目流程）'}
            aria-label={railVisible ? '收起右侧栏' : '展开右侧栏'}
            className="flex w-8 shrink-0 flex-col items-center justify-center gap-1.5 text-[var(--text-2)] transition-colors hover:bg-[var(--surface-3)] hover:text-[var(--text-1)]"
            style={{ background: 'var(--surface-2)', borderLeft: '1px solid var(--line-strong)' }}
          >
            <Icon name={railVisible ? 'chevronRight' : 'chevronLeft'} size={13} />
            <span className="text-[10px] tracking-[0.2em]" style={{ writingMode: 'vertical-rl' }}>
              {railVisible ? '收起' : '右栏'}
            </span>
          </button>
        ) : null}
        {!pageMax && railVisible ? <RightRail collapsed={false} /> : null}
      </div>

      {/* 全局错误横幅（主进程异常通知：写入失败/目录不可写等） */}
      {errorBanner ? (
        <div
          role="alert"
          className="anim-fade-in fixed left-1/2 top-3 z-[80] -translate-x-1/2 rounded-xl border px-4 py-2 text-xs shadow-glass backdrop-blur"
          style={{ borderColor: 'rgba(239,68,68,0.3)', background: 'rgba(239,68,68,0.15)', color: '#fca5a5' }}
        >
          {errorBanner}
        </div>
      ) : null}

      {/* 首启隐私同意门（审计 F1）：同意后主进程才启动窗口/键鼠/目录采集 */}
      <ModalShell open={showConsent} onClose={() => setConsentDismissed(true)} labelledBy="consent-title" bare>
        <div
          className="w-[560px] p-7"
          style={{
            background: 'var(--bg-deep)',
            borderRadius: 'var(--r-lg)',
            boxShadow: 'var(--shadow-lg)'
          }}
        >
          <div id="consent-title" className="text-xl font-semibold tracking-tight text-slate-100">
            欢迎使用 WorkOn
          </div>
          <div className="mb-6 mt-2.5 text-sm leading-relaxed text-slate-500">
            这是一台<strong className="text-slate-200">本地优先</strong>的工作陪伴器。允许采集后，它会记录：前台窗口标题、键鼠活动计数（只计数，不记录内容）、项目目录变动——
            <strong className="text-slate-200">全部数据只存在你的电脑上</strong>；云端 AI 需要你自己配置 Key 才会启用，发送前经过脱敏。
            你也可以先不采集，待办、报表等手动功能照常可用，之后随时在设置里更改。
          </div>
          <div className="flex gap-3">
            <button className="glass-btn primary flex-1 py-2.5" onClick={() => answerConsent('granted')}>
              开始使用，允许采集
            </button>
            <button className="glass-btn flex-1 py-2.5" onClick={() => answerConsent('declined')}>
              先不采集
            </button>
          </div>
        </div>
      </ModalShell>

      {/* 动态 Agent 接入向导：聊天里说“增加一个 Agent”或 Agent 页点＋都会打开 */}
      <AgentWizard />
    </div>
  )
}
