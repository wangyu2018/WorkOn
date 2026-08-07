/**
 * 主窗口壳：左侧导航（5核心 + 2全局 + 1设置）+ 内容区 + 命令面板
 * 依据：v2.3 导航重组
 */
import { useEffect, useState } from 'react'
import { useAppStore, type ViewKey } from './stores/appStore'
import { usePresenceStore } from './stores/presenceStore'
import { useSettingsStore } from './stores/settingsStore'
import { CommandPalette } from './components/CommandPalette'
import { Icon, type IconName } from './components/Icon'
import { StateBadge } from './components/StateBadge'
import { attentionGrade, focusScoreLine } from '@shared/focusMeta'
import workonLogo from './assets/workon-logo.png'
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
  key: ViewKey | 'palette'
  label: string
  icon: IconName
}

const CORE_NAV: NavItem[] = [
  { key: 'monitor', label: '监控', icon: 'activity' },
  { key: 'calendar', label: '日历', icon: 'calendar' },
  { key: 'plan', label: '计划', icon: 'target' },
  { key: 'report', label: '报表', icon: 'chart' },
  { key: 'buddy', label: '桌搭', icon: 'cat' }
]

const GLOBAL_NAV: NavItem[] = [
  { key: 'qa', label: '问答', icon: 'message' },
  { key: 'profile', label: '画像', icon: 'eye' },
  { key: 'privacy', label: '隐私', icon: 'shield' }
]

const VIEWS: Record<ViewKey, () => JSX.Element> = {
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

export default function App() {
  const { view, setView, setPaletteOpen } = useAppStore()
  const presence = usePresenceStore((s) => s.presence)
  const loadSettings = useSettingsStore((s) => s.load)
  const theme = useSettingsStore((s) => s.settings.theme)
  const appearanceMode = useSettingsStore((s) => s.settings.appearanceMode)

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

  const ActiveView = VIEWS[view]

  const renderNav = (items: NavItem[]) =>
    items.map((item) => {
      const active = item.key !== 'palette' && view === item.key
      return (
        <button
          key={item.key}
          onClick={() => (item.key === 'palette' ? setPaletteOpen(true) : setView(item.key as ViewKey))}
          className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-all duration-150 ${
            active
              ? 'bg-neon-cyan/15 text-neon-cyan shadow-glow'
              : 'text-slate-400 hover:bg-white/5 hover:text-slate-200'
          }`}
        >
          <Icon name={item.icon} size={16} />
          <span>{item.label}</span>
        </button>
      )
    })

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-ink-900 text-slate-200">
      <aside className="flex w-48 shrink-0 flex-col gap-1 border-r border-white/5 bg-ink-950/60 p-3">
        <div className="mb-4 flex items-center gap-2 px-2 py-1">
          <img src={workonLogo} alt="WorkOn" className="h-6 w-6 rounded-md" style={{ boxShadow: '0 0 12px rgba(52,211,153,0.35)' }} />
          <span className="text-base font-semibold tracking-wide text-slate-100">WorkOn</span>
        </div>
        {renderNav(CORE_NAV)}
        <div className="my-2 border-t border-white/5" />
        {renderNav(GLOBAL_NAV)}
        <div className="flex-1" />
        {renderNav([{ key: 'settings', label: '设置', icon: 'settings' }])}
      </aside>

      <main className="flex min-w-0 flex-1 flex-col">
        <header
          className="app-drag flex h-10 shrink-0 items-center justify-between border-b border-white/5 px-3"
        >
          <div className="flex items-center gap-2 pl-1 text-sm text-slate-400">
            <span className="text-[13px] font-medium text-slate-300">
              {CORE_NAV.find((n) => n.key === view)?.label ?? (view === 'qa' ? '问答' : view === 'profile' ? '画像' : view === 'privacy' ? '隐私' : '设置')}
            </span>
          </div>
          <div className="app-no-drag flex items-center gap-2">
            {presence && (
              <div className="mr-1 flex items-center gap-2">
                <span
                  className="text-xs text-slate-500"
                  title={presence ? `专注度怎么算的：${focusScoreLine(presence)}\n评级 ${attentionGrade(presence.focusLevel).grade}（S≥90 / A≥75 / B≥55 / C≥35 / D<35）` : undefined}
                >
                  专注度 {presence.focusLevel} · {attentionGrade(presence.focusLevel).grade}
                </span>
                <StateBadge state={presence.state} size="sm" pulse />
              </div>
            )}
            {/* 无边框自定义窗口控制（深色融合） */}
            <button
              className="flex h-7 w-8 items-center justify-center rounded-md text-slate-500 transition-colors hover:bg-white/10 hover:text-slate-200"
              title="最小化"
              onClick={() => window.api.minimize()}
            >
              <span className="mb-0.5 text-sm">–</span>
            </button>
            <button
              className="flex h-7 w-8 items-center justify-center rounded-md text-slate-500 transition-colors hover:bg-white/10 hover:text-slate-200"
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
