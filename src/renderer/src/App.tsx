/**
 * 主窗口壳：左侧分组导航 + 内容区
 * 设计：静谧深空 · accent 变量驱动的选中态（换主题自动联动）
 */
import { memo, useEffect, useMemo, useState, type CSSProperties } from 'react'
import { useAppStore, type ViewKey } from './stores/appStore'
import { usePresenceStore } from './stores/presenceStore'
import { useSettingsStore } from './stores/settingsStore'
import { Icon, type IconName } from './components/Icon'
import { WeatherCard } from './components/WeatherCard'
import { CATEGORY_META, categoryOfWithOverride, type AppCategory } from '@shared/appCategory'
import { WORK_STATES } from '@shared/stateMeta'
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
import { usePerspective } from './lib/usePerspective'
import { PERSPECTIVE_NAV } from './lib/perspective'
import { PERSPECTIVES, PERSPECTIVE_META } from '@shared/perspective'

interface NavItem {
  key: ViewKey
  label: string
  icon: IconName
}

interface NavGroup {
  label: string
  items: NavItem[]
}

const NAV_GROUPS: NavGroup[] = [
  {
    label: '工作区',
    items: [
      { key: 'home', label: '首页', icon: 'home' },
      { key: 'calendar', label: '日历', icon: 'calendar' },
      { key: 'plan', label: '计划', icon: 'target' },
      { key: 'mainline', label: '主线', icon: 'folder' },
      { key: 'report', label: '报表', icon: 'chart' },
      { key: 'knowledge', label: '知识库', icon: 'book' },
      { key: 'buddy', label: '桌搭', icon: 'cat' }
    ]
  },
  {
    label: '洞察',
    items: [
      { key: 'qa', label: '问答', icon: 'message' },
      { key: 'profile', label: '画像', icon: 'eye' },
      { key: 'privacy', label: '隐私', icon: 'shield' }
    ]
  }
]

const VIEW_TITLES: Record<ViewKey, string> = {
  home: '首页',
  monitor: '监控',
  knowledge: '知识库',
  calendar: '日历',
  plan: '计划',
  mainline: '主线',
  report: '报表',
  buddy: '桌搭',
  qa: '问答',
  profile: '画像',
  privacy: '隐私',
  settings: '设置'
}

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

function NavButton({ item, active, onClick }: { item: NavItem; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`group relative flex w-full items-center gap-2.5 rounded-lg px-2.5 py-[7px] text-[13px] transition-all duration-150 ${
        active ? 'text-slate-100' : 'text-slate-400 hover:bg-[var(--surface-2)] hover:text-slate-200'
      }`}
      style={active ? { background: 'var(--surface-2)', boxShadow: 'var(--shadow-sm)' } : undefined}
    >
      {/* active 左侧指示条 */}
      <span
        className="absolute left-0 top-1/2 h-4 w-[3px] -translate-y-1/2 rounded-full transition-opacity duration-150"
        style={{ background: 'var(--accent)', opacity: active ? 1 : 0, boxShadow: active ? '0 0 8px var(--accent-glow)' : 'none' }}
      />
      <Icon
        name={item.icon}
        size={16}
        className="shrink-0 transition-colors duration-150"
        style={active ? { color: 'var(--accent)' } : undefined}
      />
      <span className={active ? 'font-medium' : ''}>{item.label}</span>
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

  // 日视角：晨·架构师 / 昼·工作者 / 晚·管理者（手动锁 ∥ 时钟自动）
  const { perspective, locked, lock } = usePerspective()
  const [moreOpen, setMoreOpen] = useState(false)
  const { navGroups, moreItems } = useMemo(() => {
    const allow = new Set<ViewKey>(PERSPECTIVE_NAV[perspective])
    return {
      navGroups: NAV_GROUPS.map((g) => ({ ...g, items: g.items.filter((i) => allow.has(i.key)) })).filter(
        (g) => g.items.length > 0
      ),
      moreItems: NAV_GROUPS.flatMap((g) => g.items).filter((i) => !allow.has(i.key))
    }
  }, [perspective])

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
  const showConsent = settings.privacyConsent === 'pending' && !consentDismissed
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

  return (
    <div className="flex h-screen w-screen overflow-hidden text-slate-200" style={{ background: 'var(--bg-deep)' }}>
      <PasteInboxModal open={pasteInboxOpen} onClose={() => setPasteInboxOpen(false)} />
      <aside
        className="app-sidebar flex w-[212px] shrink-0 flex-col border-r border-white/[0.06] px-3 pb-3 pt-3"
      >
        {/* 品牌区 */}
        <div className="mb-5 flex items-center gap-2.5 px-1.5 pt-1">
          <img
            src={workonLogo}
            alt="WorkOn"
            className="h-7 w-7 rounded-lg"
            style={{ boxShadow: '0 0 14px var(--accent-glow)' }}
          />
          <div className="leading-tight">
            <div className="text-[14px] font-semibold tracking-wide text-slate-100">WorkOn</div>
            <div className="text-[10px] text-slate-500">看得见的专注</div>
          </div>
        </div>

        {/* 日视角切换：点选=锁定该视角，再点已激活项或「自动」回到时钟驱动 */}
        <div className="mb-4 flex flex-col gap-1.5 px-1.5">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-medium uppercase tracking-[0.14em] text-slate-600">视角</span>
            <button
              type="button"
              onClick={() => lock(locked ? null : perspective)}
              title={locked ? '已锁定 · 点击回到按时钟自动切换' : '按时钟自动切换 · 点击锁定当前视角'}
              className="rounded-md px-1.5 py-0.5 text-[10px] transition-colors"
              style={{
                color: locked ? 'var(--accent)' : 'var(--text-3, #64748b)',
                background: locked ? 'var(--accent-softer)' : 'transparent'
              }}
            >
              {locked ? '已锁定' : '自动'}
            </button>
          </div>
          <div className="grid grid-cols-3 gap-1">
            {PERSPECTIVES.map((p) => {
              const m = PERSPECTIVE_META[p]
              const active = perspective === p
              return (
                <button
                  key={p}
                  type="button"
                  onClick={() => lock(active && locked ? null : p)}
                  title={`${m.emoji} ${m.label}视角 · ${m.desc}（自动时段 ${m.range}）`}
                  className={`rounded-lg py-1 text-[11px] transition-all duration-150 ${
                    active ? 'font-semibold' : 'text-slate-500 hover:text-slate-300'
                  }`}
                  style={
                    active
                      ? {
                          background: 'var(--accent-softer)',
                          color: 'var(--accent)',
                          boxShadow: 'inset 0 0 0 1px var(--border-active)'
                        }
                      : undefined
                  }
                >
                  {m.emoji} {m.short}
                </button>
              )
            })}
          </div>
          <div className="px-0.5 text-[10px] leading-snug text-slate-600">
            {PERSPECTIVE_META[perspective].label}视角 · {PERSPECTIVE_META[perspective].desc}
          </div>
        </div>

        {/* 分组导航（按当前视角收敛；其余入口收进「更多」） */}
        <nav className="flex flex-col gap-4">
          {navGroups.map((g) => (
            <div key={g.label}>
              <div className="mb-1 px-2.5 text-[10px] font-medium uppercase tracking-[0.14em] text-slate-600">
                {g.label}
              </div>
              <div className="flex flex-col gap-0.5">
                {g.items.map((item) => (
                  <NavButton key={item.key} item={item} active={view === item.key} onClick={() => setView(item.key)} />
                ))}
              </div>
            </div>
          ))}
          {moreItems.length > 0 ? (
            <div>
              <button
                type="button"
                onClick={() => setMoreOpen((o) => !o)}
                className="mb-1 flex w-full items-center justify-between px-2.5 text-[10px] font-medium uppercase tracking-[0.14em] text-slate-600 transition-colors hover:text-slate-400"
              >
                <span>更多</span>
                <span>{moreOpen ? '▾' : '▸'}</span>
              </button>
              {moreOpen ? (
                <div className="flex flex-col gap-0.5">
                  {moreItems.map((item) => (
                    <NavButton key={item.key} item={item} active={view === item.key} onClick={() => setView(item.key)} />
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
        </nav>

        <div className="flex-1" />

        <NavButton item={{ key: 'settings', label: '设置', icon: 'settings' }} active={view === 'settings'} onClick={() => setView('settings')} />
      </aside>

      <main className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-11 shrink-0 items-center justify-between border-b border-white/[0.06] px-4">
          <div className="app-drag flex min-w-0 flex-1 items-baseline gap-2 self-stretch pl-1">
            <span className="self-center text-[13px] font-semibold text-slate-200">{VIEW_TITLES[view]}</span>
            <span
              className="self-center rounded-md px-1.5 py-0.5 text-[10px] text-slate-500"
              style={{ background: 'var(--surface-2)' }}
              title={`${PERSPECTIVE_META[perspective].desc}${locked ? '（已锁定）' : '（自动）'}`}
            >
              {PERSPECTIVE_META[perspective].emoji} {PERSPECTIVE_META[perspective].label}
            </span>
          </div>
          <div
            className="app-no-drag flex shrink-0 items-center gap-2"
            style={{ WebkitAppRegion: 'no-drag' } as CSSProperties}
          >
            {/* 天气卡（现在 / 未来几小时 / 未来几天） */}
            <WeatherCard />
            {/* 窗口控制（独立，与状态胶囊分开） */}
            <button
              type="button"
              className="flex h-7 w-8 items-center justify-center rounded-md text-slate-500 transition-colors hover:bg-white/[0.08] hover:text-slate-200"
              style={{ WebkitAppRegion: 'no-drag' } as CSSProperties}
              title="最小化"
              onClick={(e) => {
                e.preventDefault()
                e.stopPropagation()
                window.api?.minimize?.()
              }}
            >
              <span className="mb-0.5 text-sm">–</span>
            </button>
            <button
              type="button"
              className="flex h-7 w-8 items-center justify-center rounded-md text-slate-500 transition-colors hover:bg-white/[0.08] hover:text-slate-200"
              style={{ WebkitAppRegion: 'no-drag' } as CSSProperties}
              title="最大化/还原"
              onClick={(e) => {
                e.preventDefault()
                e.stopPropagation()
                window.api?.maximize?.()
              }}
            >
              <span className="text-[11px]">▢</span>
            </button>
            <button
              type="button"
              className="flex h-7 w-8 items-center justify-center rounded-md text-slate-500 transition-colors hover:bg-red-500/80 hover:text-white"
              style={{ WebkitAppRegion: 'no-drag' } as CSSProperties}
              title="关闭（最小化到托盘）"
              onClick={(e) => {
                e.preventDefault()
                e.stopPropagation()
                window.api?.closeWindow?.()
              }}
            >
              <span className="text-[11px]">✕</span>
            </button>
          </div>
        </header>
        <div className="min-h-0 flex-1 overflow-auto p-5">
          <ActiveView />
        </div>
      </main>

      {/* 全局错误横幅（主进程异常通知：写入失败/目录不可写等） */}
      {errorBanner ? (
        <div className="anim-fade-in fixed left-1/2 top-3 z-[80] -translate-x-1/2 rounded-xl border border-red-500/30 bg-red-500/15 px-4 py-2 text-[12px] text-red-300 shadow-glass backdrop-blur">
          ⚠️ {errorBanner}
        </div>
      ) : null}

      {/* 首启隐私同意门（审计 F1）：同意后主进程才启动窗口/键鼠/目录采集 */}
      {showConsent ? (
        <div className="anim-fade-in fixed inset-0 z-[90] flex items-center justify-center bg-black/55 backdrop-blur-sm">
          <div className="w-[540px] rounded-2xl border border-white/10 bg-[#131b2b] p-6 shadow-glass">
            <div className="mb-1 text-[17px] font-semibold text-zinc-100">欢迎使用 WorkOn</div>
            <div className="mb-4 text-[12.5px] leading-relaxed text-zinc-400">
              这是一台<strong className="text-zinc-200">本地优先</strong>的工作陪伴器。允许采集后，它会记录：前台窗口标题、键鼠活动计数（只计数，不记录内容）、项目目录变动——
              <strong className="text-zinc-200">全部数据只存在你的电脑上</strong>；云端 AI 需要你自己配置 Key 才会启用，发送前经过脱敏。
              你也可以先不采集，待办、报表、桌宠等手动功能照常可用，之后随时在设置里更改。
            </div>
            <div className="flex gap-3">
              <button
                className="flex-1 rounded-lg bg-emerald-500/90 px-4 py-2.5 text-[13px] font-medium text-white transition hover:bg-emerald-500"
                onClick={() => answerConsent('granted')}
              >
                开始使用，允许采集
              </button>
              <button
                className="flex-1 rounded-lg border border-white/15 px-4 py-2.5 text-[13px] text-zinc-300 transition hover:bg-white/5"
                onClick={() => answerConsent('declined')}
              >
                先不采集（仅手动功能）
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
