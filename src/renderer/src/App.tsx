/**
 * 主窗口壳：左侧分组导航 + 内容区 + 命令面板
 * 设计：静谧深空 · accent 变量驱动的选中态（换主题自动联动）
 */
import { memo, useEffect, useMemo, useState } from 'react'
import { useAppStore, type ViewKey } from './stores/appStore'
import { usePresenceStore } from './stores/presenceStore'
import { useSettingsStore } from './stores/settingsStore'
import { CommandPalette } from './components/CommandPalette'
import { Icon, type IconName } from './components/Icon'
import { CATEGORY_META, categoryOfWithOverride, type AppCategory } from '@shared/appCategory'
import workonLogo from './assets/workon-logo.png'
import HomeView from './views/HomeView'
import MonitorView from './views/MonitorView'
import CalendarView from './views/CalendarView'
import PlanView from './views/PlanView'
import ReportHub from './views/ReportHub'
import BuddyStage from './views/BuddyStage'
import QAReview from './views/QAReview'
import ProfileView from './views/ProfileView'
import PrivacyView from './views/PrivacyView'
import SettingsView from './views/SettingsView'

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
      { key: 'report', label: '报表', icon: 'chart' },
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
  calendar: '日历',
  plan: '计划',
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
  calendar: CalendarView,
  plan: PlanView,
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
      className={`group relative flex w-full items-center gap-2.5 rounded-lg px-2.5 py-[7px] text-[13px] transition-colors duration-150 ${
        active ? 'text-slate-100' : 'text-slate-400 hover:bg-white/[0.04] hover:text-slate-200'
      }`}
      style={active ? { background: 'var(--accent-softer)' } : undefined}
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
  const { view, setView, setPaletteOpen } = useAppStore()
  const presence = usePresenceStore((s) => s.presence)
  const loadSettings = useSettingsStore((s) => s.load)
  const settings = useSettingsStore((s) => s.settings)
  const theme = useSettingsStore((s) => s.settings.theme)
  const appearanceMode = useSettingsStore((s) => s.settings.appearanceMode)
  // 当前活跃应用 → 分类图标（跟随用户手动归类，override 变化即同步）
  const appCategoryOverride = useSettingsStore((s) => s.settings.appCategoryOverride)
  const mainApp = presence?.screens?.find((s) => s.screen === presence.mainScreen)?.app
  const mainCat: AppCategory | null = mainApp ? categoryOfWithOverride(mainApp, appCategoryOverride) : null

  // 强调色主题 + 亮暗模式应用到根节点
  useEffect(() => {
    document.documentElement.dataset.theme = theme
  }, [theme])
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

  useEffect(() => {
    const off = window.api.onOpenPalette(() => setPaletteOpen(true))
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        if (!useSettingsStore.getState().settings.cmdPaletteEnabled) return
        setPaletteOpen(!useAppStore.getState().paletteOpen)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => {
      off()
      window.removeEventListener('keydown', onKey)
    }
  }, [setPaletteOpen])

  // 全局错误横幅（数据写入失败等主进程异常 → 用户可感知）
  const [errorBanner, setErrorBanner] = useState<string | null>(null)
  useEffect(() => {
    const off = window.api.onErrorBanner?.((msg) => {
      setErrorBanner(String(msg))
      window.setTimeout(() => setErrorBanner(null), 8000)
    })
    return off
  }, [])

  // 托盘快速问答等外部跳转请求
  useEffect(() => {
    const off = window.api.onNavView?.((v) => {
      if (typeof v === 'string') useAppStore.getState().setView(v as never)
    })
    return off
  }, [])

  // memo 化当前视图：presence 每 2s 更新时不再整页重渲染（修复时间轴/星图卡顿）
  const ActiveView = useMemo(() => memo(VIEWS[view]), [view])

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-ink-900 text-slate-200">
      <aside className="flex w-[212px] shrink-0 flex-col border-r border-white/[0.06] bg-ink-950/50 px-3 pb-3 pt-3">
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

        {/* 分组导航 */}
        <nav className="flex flex-col gap-4">
          {NAV_GROUPS.map((g) => (
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
        </nav>

        <div className="flex-1" />

        {/* 底部：命令面板提示 + 设置 */}
        <button
          onClick={() => setPaletteOpen(true)}
          className="mb-2 flex w-full items-center gap-2 rounded-lg border border-white/[0.06] bg-white/[0.03] px-2.5 py-1.5 text-[12px] text-slate-500 transition-colors duration-150 hover:border-white/[0.12] hover:text-slate-300"
        >
          <Icon name="command" size={13} />
          <span className="flex-1 text-left">命令面板</span>
          <kbd className="rounded border border-white/10 px-1 text-[10px] text-slate-600">Ctrl K</kbd>
        </button>
        <NavButton item={{ key: 'settings', label: '设置', icon: 'settings' }} active={view === 'settings'} onClick={() => setView('settings')} />
      </aside>

      <main className="flex min-w-0 flex-1 flex-col">
        <header className="app-drag flex h-11 shrink-0 items-center justify-between border-b border-white/[0.06] px-4">
          <div className="flex items-baseline gap-2 pl-1">
            <span className="text-[13px] font-semibold text-slate-200">{VIEW_TITLES[view]}</span>
          </div>
          <div className="app-no-drag flex items-center gap-2">
            {presence && (
              <div
                className="mr-1 flex items-center gap-2 rounded-full border border-white/[0.07] bg-white/[0.03] py-1 pl-2.5 pr-2"
                title={presence ? `实时专注度 ${presence.focusLevel}（0-100）· 当前状态 ${presence.state}\n多维注意力评分见「监控/报表」页` : undefined}
              >
                {mainCat ? (
                  <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" style={{ color: CATEGORY_META[mainCat].color, flexShrink: 0 }}>
                    <use href={`#cat-${mainCat}`} />
                  </svg>
                ) : null}
                <span className="text-[11px] tabular-nums text-slate-400">
                  专注度 <span className="font-medium text-slate-200">{presence.focusLevel}</span>
                </span>
              </div>
            )}
            {/* 无边框自定义窗口控制 */}
            <button
              className="flex h-7 w-8 items-center justify-center rounded-md text-slate-500 transition-colors hover:bg-white/[0.08] hover:text-slate-200"
              title="最小化"
              onClick={() => window.api.minimize()}
            >
              <span className="mb-0.5 text-sm">–</span>
            </button>
            <button
              className="flex h-7 w-8 items-center justify-center rounded-md text-slate-500 transition-colors hover:bg-white/[0.08] hover:text-slate-200"
              title="最大化/还原"
              onClick={() => window.api.maximize()}
            >
              <span className="text-[11px]">▢</span>
            </button>
            <button
              className="flex h-7 w-8 items-center justify-center rounded-md text-slate-500 transition-colors hover:bg-red-500/80 hover:text-white"
              title="关闭（最小化到托盘）"
              onClick={() => window.api.closeWindow()}
            >
              <span className="text-[11px]">✕</span>
            </button>
          </div>
        </header>
        <div className="min-h-0 flex-1 overflow-auto p-5">
          <ActiveView />
        </div>
      </main>

      <CommandPalette />

      {/* 全局错误横幅（主进程异常通知：写入失败/目录不可写等） */}
      {errorBanner ? (
        <div className="anim-fade-in fixed left-1/2 top-3 z-[80] -translate-x-1/2 rounded-xl border border-red-500/30 bg-red-500/15 px-4 py-2 text-[12px] text-red-300 shadow-glass backdrop-blur">
          ⚠️ {errorBanner}
        </div>
      ) : null}
    </div>
  )
}
