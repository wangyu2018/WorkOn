import { useEffect, useMemo, useRef, useState } from 'react'
import { useAppStore, type ViewKey } from '../stores/appStore'
import { useSettingsStore } from '../stores/settingsStore'
import { Icon, type IconName } from './Icon'
import { todayKey } from './utils'

interface Action {
  id: string
  title: string
  hint?: string
  icon: IconName
  keywords: string
  run: () => void | Promise<void>
}

/** 简易模糊匹配：query 字符按序出现即可 */
function fuzzy(query: string, text: string): boolean {
  const q = query.toLowerCase()
  const t = text.toLowerCase()
  let i = 0
  for (const ch of t) {
    if (ch === q[i]) i++
    if (i >= q.length) return true
  }
  return q.length === 0
}

/** 命令面板：Ctrl+K 唤起 */
export function CommandPalette() {
  const { paletteOpen, setPaletteOpen, setView } = useAppStore()
  const [query, setQuery] = useState('')
  const [mode, setMode] = useState<'actions' | 'plan'>('actions')
  const [sel, setSel] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const close = () => setPaletteOpen(false)
  const go = (v: ViewKey) => {
    setView(v)
    close()
  }

  const actions = useMemo<Action[]>(
    () => {
      const aiEnabled = useSettingsStore.getState().settings.aiEnabled
      const base: Action[] = [
      { id: 'nav-monitor', title: '跳转：监控', icon: 'activity', keywords: 'monitor jiankong 监控', run: () => go('monitor') },
      { id: 'nav-calendar', title: '跳转：日历', icon: 'calendar', keywords: 'calendar rili 日历', run: () => go('calendar') },
      { id: 'nav-plan', title: '跳转：计划', icon: 'target', keywords: 'plan jihua 计划', run: () => go('plan') },
      { id: 'nav-report', title: '跳转：报表', icon: 'chart', keywords: 'report baobiao 报表 日报 周报', run: () => go('report') },
      { id: 'nav-buddy', title: '跳转：桌搭', icon: 'cat', keywords: 'buddy pet zhuoda 桌搭 桌宠', run: () => go('buddy') },
      { id: 'nav-qa', title: '跳转：问答', icon: 'message', keywords: 'qa wenda 问答', run: () => go('qa') },
      { id: 'nav-privacy', title: '跳转：隐私', icon: 'shield', keywords: 'privacy yinsi 隐私 ocr', run: () => go('privacy') },
      { id: 'nav-settings', title: '跳转：设置', icon: 'settings', keywords: 'settings shezhi 设置', run: () => go('settings') },
      {
        id: 'new-plan',
        title: '新建计划（今日）',
        hint: '输入标题，回车保存',
        icon: 'plus',
        keywords: 'new plan xinjian jihua 新建 计划',
        run: () => {
          setMode('plan')
          setQuery('')
          setSel(0)
        }
      },
      { id: 'toggle-widget', title: '显隐悬浮窗', icon: 'monitor', keywords: 'widget xuanfuchuang 悬浮窗', run: () => { window.api.toggleWidget(); close() } },
      { id: 'toggle-pet', title: '显隐桌搭', icon: 'cat', keywords: 'pet zhuochong zhuoda 桌搭 桌宠', run: () => { window.api.togglePet(); close() } },
      ...(aiEnabled ? [
        {
          id: 'refresh-ai',
          title: '刷新 AI 画像',
          icon: 'refresh' as IconName,
          keywords: 'ai analysis huaxiang 画像 分析',
          run: async () => {
            close()
            await window.api.refreshAnalysis().catch(() => undefined)
          }
        },
        { id: 'ask-ai', title: '问 AI…', hint: '跳到问答视图', icon: 'sparkles' as IconName, keywords: 'ask ai wen 问', run: () => go('qa') }
      ] : []),
      {
        id: 'cycle-theme',
        title: '切换强调色主题',
        hint: '青 → 紫 → 绿 → 琥珀 循环',
        icon: 'sparkles',
        keywords: 'theme zhuti 主题 颜色 皮肤 color',
        run: () => {
          const order = ['cyan', 'violet', 'green', 'amber'] as const
          const s = useSettingsStore.getState()
          const next = order[(order.indexOf(s.settings.theme) + 1) % order.length]
          void s.patch({ theme: next })
          close()
        }
      }
      ]
      return base
    },
    [] // eslint-disable-line react-hooks/exhaustive-deps
  )

  const filtered = useMemo(() => actions.filter((a) => fuzzy(query, `${a.title} ${a.keywords}`)), [actions, query])

  useEffect(() => {
    if (paletteOpen) {
      setQuery('')
      setMode('actions')
      setSel(0)
      window.setTimeout(() => inputRef.current?.focus(), 40)
    }
  }, [paletteOpen])

  useEffect(() => setSel(0), [query])

  if (!paletteOpen) return null

  const savePlan = async () => {
    const title = query.trim()
    if (!title) return
    await window.api
      .savePlan({ date: todayKey(), title, category: 'other', status: 'planned', source: 'manual' })
      .catch(() => undefined)
    go('plan')
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      if (mode === 'plan') {
        setMode('actions')
        setQuery('')
      } else {
        close()
      }
      return
    }
    if (mode === 'plan') {
      if (e.key === 'Enter') {
        e.preventDefault()
        void savePlan()
      }
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSel((s) => Math.min(filtered.length - 1, s + 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSel((s) => Math.max(0, s - 1))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const a = filtered[sel]
      if (a) void a.run()
    }
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-start justify-center bg-black/55 pt-[16vh] backdrop-blur-sm" onClick={close}>
      <div
        className="glass-card anim-scale-in w-[560px] !overflow-hidden !p-0"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-white/[0.07] px-4 py-3">
          <Icon name={mode === 'plan' ? 'plus' : 'command'} size={15} className="shrink-0 text-neon-cyan" />
          <input
            ref={inputRef}
            className="w-full bg-transparent text-[14px] text-slate-100 outline-none placeholder:text-slate-600"
            placeholder={mode === 'plan' ? '输入计划标题，回车保存为今日计划（Esc 返回）' : '输入命令或搜索…'}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
          />
          <kbd className="shrink-0 rounded border border-white/10 px-1.5 py-0.5 text-[10px] text-slate-500">Esc</kbd>
        </div>
        {mode === 'actions' ? (
          <div ref={listRef} className="max-h-[320px] overflow-y-auto p-1.5">
            {filtered.length === 0 ? (
              <div className="py-8 text-center text-[12px] text-slate-600">没有匹配的命令</div>
            ) : (
              filtered.map((a, i) => (
                <button
                  key={a.id}
                  className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors ${
                    i === sel ? 'bg-neon-cyan/12 text-slate-100' : 'text-slate-400'
                  }`}
                  style={{ transitionDuration: '100ms' }}
                  onMouseEnter={() => setSel(i)}
                  onClick={() => void a.run()}
                >
                  <Icon name={a.icon} size={15} className={i === sel ? 'text-neon-cyan' : 'text-slate-500'} />
                  <span className="flex-1 text-[13px]">{a.title}</span>
                  {a.hint ? <span className="text-[11px] text-slate-600">{a.hint}</span> : null}
                </button>
              ))
            )}
          </div>
        ) : (
          <div className="px-4 py-3 text-[12px] text-slate-500">
            保存后自动跳转到计划视图 · 类别默认为「其他」，可在计划视图继续编辑
          </div>
        )}
      </div>
    </div>
  )
}
