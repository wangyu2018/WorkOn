/**
 * 主窗口壳：左侧固定 5 个主入口 + 「更多」折叠 + 内容区
 * 设计：静谧深空 · accent 变量驱动的选中态（换主题自动联动）
 */
import { memo, useEffect, useMemo, useState, type CSSProperties } from 'react'
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
import BuddyStage from './views/BuddyStage'
import QAReview from './views/QAReview'
import ProfileView from './views/ProfileView'
import PrivacyView from './views/PrivacyView'
import SettingsView from './views/SettingsView'
import { PasteInboxModal } from './components/PasteInboxModal'
import { ModalShell } from './components/ui/Modal'
import { usePerspective } from './lib/usePerspective'
import { EdgeDockBar } from './v10/EdgeDockBar'

interface NavItem {
  key: ViewKey
  label: string
  icon: IconName
}

/** 一级入口：对应「一天里的三个时刻」——现在 / 要做什么 / 做完了看什么 */
const PRIMARY_NAV: NavItem[] = [
  { key: 'home', label: '今天', icon: 'home' },
  { key: 'plan', label: '计划', icon: 'target' },
  { key: 'report', label: '回顾', icon: 'chart' }
]

/** 二级入口：低频但能力不丢，收进「更多」 */
const SECONDARY_NAV: NavItem[] = [
  { key: 'calendar', label: '日历', icon: 'calendar' },
  { key: 'knowledge', label: '知识', icon: 'book' },
  { key: 'mainline', label: '主线', icon: 'folder' },
  { key: 'qa', label: '问答', icon: 'message' },
  { key: 'profile', label: '画像', icon: 'eye' },
  { key: 'buddy', label: '桌面搭子', icon: 'cat' },
  { key: 'privacy', label: '隐私', icon: 'shield' }
]

const VIEWS: Record<ViewKey, () => JSX.Element> = {
  home: HomeView,
  monitor: MonitorView,
  knowledge: KnowledgeView,
  calendar: CalendarView,
  plan: PlanView,
  mainline: MainlineView,
  report: ReportHub,
  buddy: BuddyStage,
  qa: QAReview,
  profile: ProfileView,
  privacy: PrivacyView,
  settings: SettingsView
}

/** 顶部文字导航：选中=黑字加粗，未选中=灰字，不用背景块 */
function TopTab({ item, active, onClick }: { item: NavItem; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      className={`rounded-full px-3 py-1.5 text-sm transition-colors ${
        active ? 'font-medium text-slate-100' : 'text-slate-500 hover:text-slate-200'
      }`}
      style={active ? { background: 'var(--surface-2)' } : undefined}
    >
      {item.label}
    </button>
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
  /** 右上角当前应用标签；mac 等平台窗口采集不可用时明说（审计 F3：静默「等待采集…」= 看不懂的坏） */
  const isUnsupportedPlatform = typeof navigator !== 'undefined' && /Mac|Linux/i.test(navigator.platform)
  const currentAppLabel = mainApp
    ? displayApp(mainApp)
    : isUnsupportedPlatform
      ? '此平台暂不支持窗口采集（Windows 完整支持）'
      : '等待采集…'

  // 日视角仅用于首页块编排（usePerspective 内部仍会写 localStorage），导航保持恒定
  usePerspective()
  const [moreOpen, setMoreOpen] = useState(false)
  const inSecondary = useMemo(() => SECONDARY_NAV.some((i) => i.key === view), [view])

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

  useEffect(() => {
    if (!settings.petEnabled) window.api?.hidePet?.()
    else window.api?.showPet?.()
  }, [settings.petEnabled])

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

      {/* 顶部导航（Today 式）：品牌 + 文字 tab + 状态/窗口操作，不再有左侧大栏 */}
      <header
        className="app-drag relative z-30 flex h-16 shrink-0 items-center gap-6 px-6"
        style={{ borderBottom: '1px solid var(--line)', background: 'var(--bg-deep)' }}
      >
        <div className="flex shrink-0 items-center gap-2.5">
          <img src={workonLogo} alt="WorkOn" className="h-6 w-6 rounded-md" />
          <span className="text-sm font-semibold tracking-tight text-slate-100">WorkOn</span>
        </div>

        <nav className="app-no-drag flex items-center gap-1">
          {PRIMARY_NAV.map((item) => (
            <TopTab key={item.key} item={item} active={view === item.key} onClick={() => setView(item.key)} />
          ))}
          <div className="relative">
            <button
              type="button"
              onClick={() => setMoreOpen((o) => !o)}
              aria-expanded={moreOpen}
              className={`rounded-full px-3 py-1.5 text-sm transition-colors ${
                inSecondary ? 'font-medium text-slate-100' : 'text-slate-500 hover:text-slate-200'
              }`}
              style={inSecondary ? { background: 'var(--surface-2)' } : undefined}
            >
              更多
            </button>
            {moreOpen ? (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setMoreOpen(false)} />
                <div
                  className="anim-fade-in absolute left-0 top-full z-50 mt-2 w-44 overflow-hidden rounded-xl p-1"
                  style={{ background: 'var(--bg-surface)', border: '1px solid var(--line)', boxShadow: 'var(--shadow-lg)' }}
                >
                  {SECONDARY_NAV.map((item) => (
                    <button
                      key={item.key}
                      type="button"
                      onClick={() => {
                        setView(item.key)
                        setMoreOpen(false)
                      }}
                      className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-sm ${
                        view === item.key ? 'bg-[var(--surface-3)] text-slate-100' : 'text-slate-400 hover:bg-[var(--surface-2)] hover:text-slate-200'
                      }`}
                    >
                      <Icon name={item.icon} size={14} className="shrink-0 opacity-70" />
                      {item.label}
                    </button>
                  ))}
                </div>
              </>
            ) : null}
          </div>
        </nav>

        <div className="flex min-w-0 flex-1" />

        <div className="app-no-drag flex shrink-0 items-center gap-2" style={{ WebkitAppRegion: 'no-drag' } as CSSProperties}>
          <span className="hidden min-w-0 max-w-[260px] truncate text-xs text-slate-500 sm:block">
            {mainCat ? `${CATEGORY_META[mainCat].label} · ` : ''}
            {currentAppLabel}
          </span>
          <WeatherCard />
          <button
            type="button"
            className="ui-icon-btn"
            title="设置"
            aria-label="设置"
            onClick={() => setView('settings')}
          >
            <Icon name="settings" size={15} />
          </button>
          <span className="mx-1 h-4 w-px" style={{ background: 'var(--line)' }} />
          <button
            type="button"
            className="ui-icon-btn"
            title="最小化"
            aria-label="最小化"
            onClick={(e) => {
              e.preventDefault()
              e.stopPropagation()
              window.api?.minimize?.()
            }}
          >
            <svg width="13" height="13" viewBox="0 0 12 12" aria-hidden>
              <path d="M2 6h8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            </svg>
          </button>
          <button
            type="button"
            className="ui-icon-btn"
            title="最大化/还原"
            aria-label="最大化或还原"
            onClick={(e) => {
              e.preventDefault()
              e.stopPropagation()
              window.api?.maximize?.()
            }}
          >
            <svg width="13" height="13" viewBox="0 0 12 12" aria-hidden>
              <rect x="2.2" y="2.2" width="7.6" height="7.6" rx="1.4" fill="none" stroke="currentColor" strokeWidth="1.3" />
            </svg>
          </button>
          <button
            type="button"
            className="ui-icon-btn hover:!bg-red-500 hover:!text-white"
            title="关闭（最小化到托盘）"
            aria-label="关闭窗口"
            onClick={(e) => {
              e.preventDefault()
              e.stopPropagation()
              window.api?.closeWindow?.()
            }}
          >
            <svg width="13" height="13" viewBox="0 0 12 12" aria-hidden="true">
              <path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      </header>

      {/* 内容：单列居中，最宽 1120，留白由这里统一控制 */}
      <main className="min-h-0 flex-1 overflow-auto">
        <div className="mx-auto w-full max-w-[1120px] px-8 pb-16 pt-10">
          <ActiveView />
        </div>
      </main>

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
            你也可以先不采集，待办、报表、桌面搭子等手动功能照常可用，之后随时在设置里更改。
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
    </div>
  )
}
