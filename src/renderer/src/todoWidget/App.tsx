/**
 * 待办树小组件（v7）：三区（项目树/待办/生活）· 项目→任务
 * - 顶层/底层（沉底）与穿透拆开；勾选即完成；正在干高亮（归属引擎）
 */
import { useEffect, useRef, useState, type CSSProperties } from 'react'
import type { Project, ProjectTask, PlanItem, WidgetDisplayOptions } from '@shared/types'
import { DEFAULT_WIDGET_DISPLAY } from '@shared/types'

interface AttributionState {
  projectId: string | null
  projectName: string
  taskId: string | null
  taskTitle: string
  sec: number
  source: 'binding' | 'keyword' | 'question' | 'none'
}

type NodeState = 'done' | 'doing' | 'todo' | 'blocked'

function taskState(s: ProjectTask['status']): NodeState {
  return s === 'done' ? 'done' : s === 'in_progress' ? 'doing' : s === 'blocked' ? 'blocked' : 'todo'
}

const STATE_MARK: Record<NodeState, string> = { done: '☑', doing: '◐', blocked: '⊘', todo: '○' }
const APP_DRAG = { WebkitAppRegion: 'drag' } as unknown as CSSProperties
const APP_NO_DRAG = { WebkitAppRegion: 'no-drag' } as unknown as CSSProperties

/**
 * 实心 / 磨砂：opacity 连续映射到底色深浅（不再只分 3 档，滑条能改「里面」）。
 * Windows 不用半透/acrylic，避免直角高透框。
 */
function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n))
}

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '')
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]
}

function rgbToHex(r: number, g: number, b: number): string {
  const c = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0')
  return `#${c(r)}${c(g)}${c(b)}`
}

function lerpHex(a: string, b: string, t: number): string {
  const A = hexToRgb(a)
  const B = hexToRgb(b)
  const u = clamp01(t)
  return rgbToHex(A[0] + (B[0] - A[0]) * u, A[1] + (B[1] - A[1]) * u, A[2] + (B[2] - A[2]) * u)
}

/** 滑条 0.3→1 映射为 0→1 */
function opacityT(opacity: number): number {
  return clamp01((Math.max(0.3, Math.min(1, opacity)) - 0.3) / 0.7)
}

function todoPanelStyle(glass: boolean, opacity: number, light = false): CSSProperties {
  const t = opacityT(opacity)
  if (light) {
    if (!glass) {
      const bg = lerpHex('#e8e8ec', '#f7f7f8', t)
      return {
        background: bg,
        border: '1px solid rgba(0,0,0,0.08)',
        boxShadow: 'none',
        backdropFilter: 'none',
        WebkitBackdropFilter: 'none',
        color: '#1c1c1e'
      }
    }
    const top = lerpHex('#d8d8de', '#ffffff', t)
    const bot = lerpHex('#c8c8d0', '#ebebef', t)
    return {
      background: `linear-gradient(165deg, ${top} 0%, ${bot} 100%)`,
      border: '1px solid rgba(0,0,0,0.08)',
      boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.9)',
      backdropFilter: 'none',
      WebkitBackdropFilter: 'none',
      color: '#1c1c1e'
    }
  }
  if (!glass) {
    // 实心：越低越浅灰，越高越黑
    const bg = lerpHex('#2a2a2e', '#000000', t)
    return {
      background: bg,
      border: '1px solid rgba(255,255,255,0.08)',
      boxShadow: 'none',
      backdropFilter: 'none',
      WebkitBackdropFilter: 'none'
    }
  }
  // 磨砂：越低越深，越高越亮（看得见滑条在改面板）
  const top = lerpHex('#1a1a1e', '#4a4a52', t)
  const bot = lerpHex('#101014', '#26262c', t)
  return {
    background: `linear-gradient(165deg, ${top} 0%, ${bot} 72%)`,
    border: '1px solid rgba(255,255,255,0.14)',
    boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.16)',
    backdropFilter: 'none',
    WebkitBackdropFilter: 'none',
    color: '#f5f5f7'
  }
}

function todoWindowChromeColor(glass: boolean, opacity: number, light = false): string {
  const t = opacityT(opacity)
  if (light) return glass ? lerpHex('#d0d0d6', '#f2f2f4', t) : lerpHex('#e4e4e8', '#f4f4f5', t)
  if (!glass) return lerpHex('#2a2a2e', '#000000', t)
  return lerpHex('#141418', '#323236', t)
}

function resolvePreferLight(mode?: 'light' | 'dark' | 'auto'): boolean {
  if (mode === 'light') return true
  if (mode === 'dark') return false
  return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-color-scheme: light)').matches
}

function todayKey(): string {
  return new Date().toISOString().slice(0, 10)
}

export default function TodoWidgetApp() {
  const [projects, setProjects] = useState<Project[]>([])
  const [tasks, setTasks] = useState<Record<string, ProjectTask[]>>({})
  const [plans, setPlans] = useState<PlanItem[]>([])
  const [attr, setAttr] = useState<AttributionState | null>(null)
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [activityHint, setActivityHint] = useState<Record<string, string>>({})
  const [onTop, setOnTop] = useState(true)
  const [desktopPin, setDesktopPin] = useState(false)
  const [collapsed, setCollapsed] = useState(false)
  const [loadErr, setLoadErr] = useState<string | null>(null)
  const [glass, setGlass] = useState(false)
  const [lightMode, setLightMode] = useState(false)
  const [panelOpacity, setPanelOpacity] = useState(1)
  const prevTaskStatus = useRef<Record<string, ProjectTask['status']>>({})
  const prevPlanStatus = useRef<Record<string, PlanItem['status']>>({})
  /** 三分区显隐：settings.widgetDisplay.todo（桌搭页可配；⚙ 本地也可切） */
  const [editMode, setEditMode] = useState(false)
  const [zones, setZones] = useState<WidgetDisplayOptions['todo']>(() => ({ ...DEFAULT_WIDGET_DISPLAY.todo }))
  const zoneOn = (k: keyof WidgetDisplayOptions['todo'], dflt = true): boolean => zones[k] ?? dflt
  const persistZones = (next: WidgetDisplayOptions['todo']): void => {
    setZones(next)
    try { localStorage.setItem('woTodoZones', JSON.stringify(next)) } catch { /* ignore */ }
    void window.api?.setSettings?.({ widgetDisplay: { todo: next } } as never)
  }
  const toggleZone = (k: keyof WidgetDisplayOptions['todo']): void => {
    persistZones({ ...zones, [k]: !zoneOn(k) })
  }

  const refresh = async (): Promise<void> => {
    try {
      const ps = ((await window.api?.listProjects?.()) as Project[]) ?? []
      const active = ps.filter((p) => p.status === 'active')
      setProjects(active)
      const map: Record<string, ProjectTask[]> = {}
      // 与展示同集：全部活跃项目都拉任务，避免第 7+ 假「暂无任务」
      await Promise.all(active.map(async (p) => {
        map[p.id] = ((await window.api?.listProjectTasks?.(p.id)) as ProjectTask[]) ?? []
      }))
      setTasks(map)
      const pl = ((await window.api?.listPlans?.(todayKey())) as PlanItem[]) ?? []
      setPlans(pl.filter((p) => !p.archived))
      setLoadErr(null)
    } catch (e) {
      setLoadErr((e as Error)?.message || '加载失败')
    }
  }

  useEffect(() => {
    void window.api?.getSettings?.().then((s) => {
      const st = s as {
        todoWidgetOnTop?: boolean
        todoWidgetDesktopPin?: boolean
        todoWidgetCollapsed?: boolean
        overlayGlass?: boolean
        todoWidgetOpacity?: number
        widgetDisplay?: WidgetDisplayOptions
        appearanceMode?: 'light' | 'dark' | 'auto'
      }
      setOnTop(st.todoWidgetOnTop !== false)
      setDesktopPin(!!st.todoWidgetDesktopPin)
      setCollapsed(!!st.todoWidgetCollapsed)
      setGlass(!!st.overlayGlass)
      setPanelOpacity(st.todoWidgetOpacity ?? 1)
      const preferLight = resolvePreferLight(st.appearanceMode)
      setLightMode(preferLight)
      document.documentElement.dataset.mode = preferLight ? 'light' : 'dark'
      const todo = st.widgetDisplay?.todo
      if (todo) setZones({ ...DEFAULT_WIDGET_DISPLAY.todo, ...todo })
      else {
        try {
          const legacy = JSON.parse(localStorage.getItem('woTodoZones') ?? '{}') as Partial<WidgetDisplayOptions['todo']>
          if (legacy && Object.keys(legacy).length) {
            const next = { ...DEFAULT_WIDGET_DISPLAY.todo, ...legacy }
            setZones(next)
            void window.api?.setSettings?.({ widgetDisplay: { todo: next } } as never)
          }
        } catch { /* ignore */ }
      }
    }).catch(() => undefined)
    void refresh()
    const pullAttr = (): void => { void window.api?.getAttribution?.().then((a) => setAttr(a as AttributionState)).catch(() => undefined) }
    pullAttr()
    const tAttr = window.setInterval(pullAttr, 8000)
    const tRefresh = window.setInterval(() => { void refresh() }, 30_000)
    const offPlan = window.api?.onPlanUpdated?.(() => { void refresh() })
    const offStyle = window.api?.onTodoWidgetStyle?.((p) => {
      setGlass(!!p.glass)
      setPanelOpacity(typeof p.opacity === 'number' ? p.opacity : 1)
    })
    const offOpacity = window.api?.onTodoWidgetContentOpacity?.((v) => {
      setPanelOpacity(typeof v === 'number' ? v : 1)
    })
    const offPin = (window.api as {
      onTodoWidgetDesktopPinResult?: (cb: (p: { ok: boolean; reason?: string; pinned?: boolean }) => void) => () => void
    }).onTodoWidgetDesktopPinResult?.((p) => {
      if (!p?.ok) {
        setDesktopPin(false)
        return
      }
      if (typeof p.pinned === 'boolean') setDesktopPin(p.pinned)
      else setDesktopPin(true)
    })
    const offCollapsed = (window.api as {
      onTodoWidgetCollapsed?: (cb: (p: { collapsed: boolean }) => void) => () => void
    }).onTodoWidgetCollapsed?.((p) => {
      if (typeof p?.collapsed === 'boolean') setCollapsed(p.collapsed)
    })
    const offDisplay = (window.api as { onTodoWidgetDisplay?: (cb: (p: WidgetDisplayOptions['todo']) => void) => () => void }).onTodoWidgetDisplay?.((p) => {
      if (p) setZones({ ...DEFAULT_WIDGET_DISPLAY.todo, ...p })
    })
    const syncAppearance = (mode?: 'light' | 'dark' | 'auto'): void => {
      const apply = (appearanceMode?: 'light' | 'dark' | 'auto'): void => {
        const preferLight = resolvePreferLight(appearanceMode)
        setLightMode(preferLight)
        document.documentElement.dataset.mode = preferLight ? 'light' : 'dark'
      }
      if (mode) {
        apply(mode)
        return
      }
      void window.api?.getSettings?.().then((s) => {
        apply((s as { appearanceMode?: 'light' | 'dark' | 'auto' }).appearanceMode)
      }).catch(() => undefined)
    }
    const mq = window.matchMedia?.('(prefers-color-scheme: light)')
    const onMq = (): void => { syncAppearance() }
    mq?.addEventListener?.('change', onMq)
    const offAppear = window.api?.onAppearanceUpdate?.((p) => {
      syncAppearance(p?.appearanceMode)
    })
    return () => {
      window.clearInterval(tAttr)
      window.clearInterval(tRefresh)
      mq?.removeEventListener?.('change', onMq)
      offPlan?.()
      offStyle?.()
      offOpacity?.()
      offPin?.()
      offCollapsed?.()
      offDisplay?.()
      offAppear?.()
    }
  }, [])

  useEffect(() => {
    void (window.api as { setTodoWidgetCollapsed?: (v: boolean) => Promise<unknown> })?.setTodoWidgetCollapsed?.(collapsed)
  }, [collapsed])

  const toggleTask = async (t: ProjectTask): Promise<void> => {
    if (t.status !== 'done') prevTaskStatus.current[t.id] = t.status
    const next = t.status === 'done' ? (prevTaskStatus.current[t.id] ?? 'todo') : 'done'
    setTasks((m) => {
      const list = (m[t.projectId] ?? []).map((x) => (x.id === t.id ? { ...x, status: next } : x))
      return { ...m, [t.projectId]: list }
    })
    try {
      await window.api?.saveProjectTask?.({ ...t, status: next })
    } catch {
      await refresh()
    }
  }

  const togglePlan = async (p: PlanItem): Promise<void> => {
    if (p.status !== 'done') prevPlanStatus.current[p.id] = p.status
    const next = p.status === 'done' ? (prevPlanStatus.current[p.id] ?? 'planned') : 'done'
    setPlans((list) => list.map((x) => (x.id === p.id ? { ...x, status: next } : x)))
    try {
      await window.api?.setPlanStatus?.(p.id, next)
    } catch {
      await refresh()
    }
  }

  const toggleLayer = async (): Promise<void> => {
    if (desktopPin) return
    const next = !onTop
    setOnTop(next)
    try {
      // 底层 = 沉底（可点）；穿透走设置页/托盘单独开关；钉桌面另有开关
      await (window.api as { setTodoWidgetLayer?: (v: boolean) => Promise<unknown> })?.setTodoWidgetLayer?.(next)
        ?? window.api?.setSettings?.({ todoWidgetOnTop: next } as never)
    } catch { /* ignore */ }
  }

  const toggleDesktopPin = async (): Promise<void> => {
    const next = !desktopPin
    setDesktopPin(next)
    try {
      await window.api?.setSettings?.({ todoWidgetDesktopPin: next } as never)
    } catch {
      setDesktopPin(!next)
    }
  }

  const progressOf = (list: ProjectTask[]): { done: number; total: number; pct: number } => {
    const total = list.length
    const done = list.filter((t) => t.status === 'done').length
    return { done, total, pct: total ? Math.round((done / total) * 100) : 0 }
  }

  const todayPlans = plans.filter((p) => p.status !== 'cancelled')
  const todayOpen = todayPlans.filter((p) => p.status !== 'done')
  const childMap = todayOpen.reduce<Record<string, PlanItem[]>>((acc, p) => {
    if (!p.parentPlanId) return acc
    ;(acc[p.parentPlanId] ??= []).push(p)
    return acc
  }, {})
  /** 挂了项目的今日计划（含已完成）→ 进项目区；待办区只留「未挂项目」的未完成项 */
  const plansByProject = todayPlans.reduce<Record<string, PlanItem[]>>((acc, p) => {
    if (!p.projectId) return acc
    ;(acc[p.projectId] ??= []).push(p)
    return acc
  }, {})
  const isPlanRoot = (p: PlanItem): boolean => {
    if (!p.parentPlanId) return true
    return !todayPlans.some((x) => x.id === p.parentPlanId)
  }
  const todoRoots = todayOpen.filter((p) => {
    if (p.category === 'personal') return false
    if (p.projectId) return false
    return isPlanRoot(p)
  })
  const lifeRoots = todayOpen.filter((p) => {
    if (p.category !== 'personal') return false
    return isPlanRoot(p)
  })
  const todoZone = todoRoots.slice(0, 8)
  const lifeZone = lifeRoots.slice(0, 5)

  const renderPlanRow = (p: PlanItem, nested = false) => (
    <div key={p.id} className={`flex items-center gap-2 py-[3px] ${nested ? 'pl-4' : ''}`}>
      <button
        className={`shrink-0 text-[12px] ${p.status === 'done' ? 'text-[var(--teal-deep)]' : 'text-slate-500 hover:text-slate-300'}`}
        onClick={() => void togglePlan(p)}
      >
        {p.status === 'done' ? '☑' : p.status === 'in_progress' || p.status === 'partial' ? '◐' : '○'}
      </button>
      <span className={`min-w-0 flex-1 truncate text-[12px] ${p.status === 'done' ? 'text-slate-500 line-through' : nested ? 'text-slate-400' : 'text-slate-300'}`}>
        {nested ? `↳ ${p.title}` : p.title}
      </span>
    </div>
  )

  const loadActivity = (projectId: string): void => {
    if (activityHint[projectId] !== undefined) return
    void window.api?.getTodayActivity?.(projectId).then((a) => {
      const act = a as { changedFiles?: number; newFiles?: number; hotspot?: string; lastChangeTs?: number }
      if (!act || (!(act.changedFiles || act.newFiles) && !act.lastChangeTs)) {
        setActivityHint((h) => ({ ...h, [projectId]: '今天暂无目录活动' }))
        return
      }
      const parts = [
        act.changedFiles ? `改 ${act.changedFiles}` : '',
        act.newFiles ? `新 ${act.newFiles}` : '',
        act.hotspot ? `热点 ${act.hotspot}` : ''
      ].filter(Boolean)
      setActivityHint((h) => ({ ...h, [projectId]: parts.join(' · ') || '今天暂无目录活动' }))
    }).catch(() => setActivityHint((h) => ({ ...h, [projectId]: '活动读取失败' })))
  }

  const renderNode = (t: ProjectTask, projectId: string, isLevel2: boolean): React.ReactNode => {
    const st = taskState(t.status)
    const isCurrent = !!(attr?.projectId === projectId && (attr.taskId ? attr.taskId === t.id : attr.taskTitle === t.title))
    const open = expanded[t.id] ?? false
    return (
      <div key={t.id} style={{ paddingLeft: isLevel2 ? 14 : 26 }} className="py-[3px]">
        <div className="group flex items-center gap-2">
          <button
            className={`shrink-0 text-[12px] transition-colors ${st === 'done' ? 'text-[var(--teal-deep)]' : st === 'doing' ? 'text-[#fbbf24]' : 'text-slate-500 hover:text-slate-300'}`}
            style={APP_NO_DRAG}
            onClick={() => void toggleTask(t)}
            title={st === 'done' ? '取消完成' : '完成'}
          >
            {STATE_MARK[st]}
          </button>
          <span
            className={`min-w-0 flex-1 cursor-pointer truncate text-left text-[12px] ${
              st === 'done' ? 'text-slate-500 line-through decoration-slate-600' : isCurrent ? 'font-medium text-[var(--teal-deep)]' : 'text-slate-300'
            }`}
            style={APP_NO_DRAG}
            onClick={() => {
              setExpanded((e) => ({ ...e, [t.id]: !open }))
              if (!open) loadActivity(projectId)
            }}
          >
            {t.title}
            {isCurrent ? <span className="ml-1.5 text-[10px] text-[var(--teal-deep)]">● 正在干{attr?.sec ? ` ${Math.max(1, Math.round(attr.sec / 60))}m` : ''}</span> : null}
          </span>
        </div>
        {open && isLevel2 ? (
          <div className="mt-0.5 rounded-lg bg-white/[0.03] px-2.5 py-1.5 text-[10.5px] leading-relaxed text-slate-500">
            {isCurrent
              ? `今天：归属自实时监控 · 已持续 ${Math.max(1, Math.round((attr?.sec ?? 0) / 60))} 分钟`
              : (activityHint[projectId] ?? '加载中…')}
          </div>
        ) : null}
      </div>
    )
  }

  if (collapsed) {
    const openN = todayOpen.length
    const chrome = lightMode ? '#f4f4f5' : '#0a0a0c'
    return (
      <div
        className="flex h-screen w-screen cursor-pointer items-center justify-center gap-1.5 overflow-hidden"
        style={{
          background: chrome,
          boxShadow: lightMode
            ? 'inset 0 0.5px 0 rgba(255,255,255,0.8)'
            : 'inset 0 0.5px 0 rgba(255,255,255,0.12)',
          ...APP_NO_DRAG
        }}
        onClick={() => setCollapsed(false)}
        title="展开待办"
      >
        <span className={`text-[11px] font-semibold tracking-wide ${lightMode ? 'text-slate-700' : 'text-white/90'}`}>
          待办
        </span>
        {openN > 0 ? (
          <span
            className="min-w-[16px] rounded-full px-1 text-center text-[9px] font-bold text-white"
            style={{ background: 'var(--teal)' }}
          >
            {openN > 99 ? '99+' : openN}
          </span>
        ) : null}
      </div>
    )
  }

  return (
    // 整窗实色铺满 + 系统圆角；无透明外圈 = 无直角高透框
    <div
      className="flex h-screen w-screen flex-col overflow-hidden p-0"
      style={{ background: todoWindowChromeColor(glass, panelOpacity, lightMode) }}
    >
      <div
        className={`flex min-h-0 flex-1 flex-col overflow-hidden p-3.5 ${lightMode ? 'todo-light-legible' : glass ? 'todo-glass-legible' : ''}`}
        style={todoPanelStyle(glass, panelOpacity, lightMode)}
      >
        {/* 操作条：文案按钮，别再用看不懂的 ◉ */}
        <div className="mb-1.5 flex cursor-move items-center gap-1" style={APP_DRAG}>
          <button
            type="button"
            className="rounded-md border border-white/10 bg-white/[0.04] px-1.5 py-0.5 text-[10px] font-medium text-slate-300 transition-colors hover:border-white/20 hover:text-slate-100"
            style={APP_NO_DRAG}
            onClick={() => setCollapsed(true)}
            title="收起成角落小按钮"
          >
            收起
          </button>
          <div className="ml-auto flex items-center gap-1" style={APP_NO_DRAG}>
            <button
              type="button"
              className={`rounded-md border px-1.5 py-0.5 text-[10px] font-medium transition-colors ${
                desktopPin
                  ? 'border-[rgba(15,181,164,0.45)] bg-[var(--teal-soft)] text-[var(--teal-deep)]'
                  : 'border-white/10 bg-white/[0.04] text-slate-400 hover:text-slate-200'
              }`}
              onClick={() => void toggleDesktopPin()}
              title={desktopPin ? '已钉在桌面层（显示桌面后仍可见）· 再点取消' : '钉到桌面图标同层·显示桌面后仍可见'}
            >
              {desktopPin ? '已钉桌面' : '钉桌面'}
            </button>
            <button
              type="button"
              className={`rounded-md border px-1.5 py-0.5 text-[10px] font-medium transition-colors ${
                desktopPin
                  ? 'border-white/10 bg-white/[0.02] text-slate-600'
                  : onTop
                    ? 'border-[rgba(15,181,164,0.45)] bg-[var(--teal-soft)] text-[var(--teal-deep)]'
                    : 'border-white/10 bg-white/[0.04] text-slate-400 hover:text-slate-200'
              }`}
              onClick={() => void toggleLayer()}
              disabled={desktopPin}
              title={
                desktopPin
                  ? '已钉桌面时顶层/沉底不生效'
                  : onTop
                    ? '当前置顶：点一下沉到底层（仍是普通窗，不是桌面层）'
                    : '当前沉底：点一下重新置顶'
              }
            >
              {desktopPin ? '层级锁定' : onTop ? '置顶中' : '已沉底'}
            </button>
            <button
              type="button"
              className={`rounded-md border px-1.5 py-0.5 text-[10px] font-medium transition-colors ${
                editMode
                  ? 'border-[rgba(15,181,164,0.45)] bg-[var(--teal-soft)] text-[var(--teal-deep)]'
                  : 'border-white/10 bg-white/[0.04] text-slate-300 hover:text-slate-100'
              }`}
              onClick={() => setEditMode((m) => !m)}
              title="选择显示：项目 / 待办 / 生活"
            >
              {editMode ? '完成' : '分区'}
            </button>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto pr-0.5" style={APP_NO_DRAG}>
          {loadErr ? <div className="mb-2 text-[10.5px] text-[#f87171]">加载失败：{loadErr}</div> : null}
          {editMode ? (
            <div className="mb-2 flex flex-wrap items-center gap-1.5 rounded-lg border border-dashed border-[var(--line)] p-1.5">
              <span className="text-[10px] text-slate-500">显示分区：</span>
              {([['projects', '项目'], ['todos', '待办'], ['life', '生活']] as const).map(([k, label]) => (
                <button
                  key={k}
                  className={`rounded-full border px-2 py-0.5 text-[10px] font-bold transition-all ${zoneOn(k) ? 'border-[rgba(15,181,164,0.5)] bg-[var(--teal-soft)] text-[var(--teal-deep)]' : 'border-[var(--line)] text-slate-500'}`}
                  onClick={() => toggleZone(k)}
                >
                  {label}{zoneOn(k) ? ' ✓' : ''}
                </button>
              ))}
            </div>
          ) : null}
          {/* ── 项目区：一级项目 + 二级任务树 ── */}
          {zoneOn('projects') ? (
            <>
              {projects.map((p) => {
                const list = tasks[p.id] ?? []
                const linkedPlans = (plansByProject[p.id] ?? [])
                  .filter(isPlanRoot)
                  .sort((a, b) => {
                    // 未完成在前，已完成在后
                    const ao = a.status === 'done' ? 1 : 0
                    const bo = b.status === 'done' ? 1 : 0
                    if (ao !== bo) return ao - bo
                    return a.ts - b.ts
                  })
                const linkedChildren = (parentId: string): PlanItem[] => childMap[parentId] ?? []
                const planOpen = linkedPlans.filter((x) => x.status !== 'done').length
                const { done, total } = progressOf(list)
                const combinedTotal = total + linkedPlans.length
                const combinedDone = done + (linkedPlans.length - planOpen)
                const combinedPct = combinedTotal ? Math.round((combinedDone / combinedTotal) * 100) : 0
                const open = expanded[p.id] ?? true
                const shown = list.slice(0, 8)
                const shownPlans = linkedPlans.slice(0, 10)
                return (
                  <div key={p.id} className="mb-2">
                    <div className="flex cursor-pointer items-center gap-1.5 py-[3px]" onClick={() => setExpanded((e) => ({ ...e, [p.id]: !open }))}>
                      <span className="text-[10px] text-slate-500">{open ? '▾' : '▸'}</span>
                      <span className="min-w-0 flex-1 truncate text-[12.5px] font-semibold text-slate-100">{p.name}</span>
                      {combinedTotal > 0 ? (
                        <span className="flex shrink-0 items-center gap-1.5">
                          <span className="text-[10px] tabular-nums text-slate-500">{combinedPct}%</span>
                          <span className="h-1 w-12 overflow-hidden rounded-full bg-white/10">
                            <span className="block h-full rounded-full bg-[var(--teal)]" style={{ width: `${combinedPct}%` }} />
                          </span>
                        </span>
                      ) : null}
                      {p.deadline ? (
                        (() => {
                          const days = Math.ceil((new Date(`${p.deadline}T23:59:59`).getTime() - Date.now()) / 86400000)
                          return (
                            <span
                              className={`shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-bold ${
                                days < 0 ? 'bg-[rgba(239,68,68,0.12)] text-[#f87171]' : days <= 7 ? 'bg-[rgba(245,158,11,0.12)] text-[#fbbf24]' : 'bg-[var(--teal-soft)] text-[var(--teal-deep)]'
                              }`}
                            >
                              {days < 0 ? `超期${-days}天` : `↦${days}天`}
                            </span>
                          )
                        })()
                      ) : combinedTotal - combinedDone > 0 ? (
                        <span className="shrink-0 text-[9px] text-slate-500">剩{combinedTotal - combinedDone}项</span>
                      ) : null}
                    </div>
                    {open ? (
                      <>
                        {shown.map((t) => renderNode(t, p.id, true))}
                        {list.length > shown.length ? (
                          <div className="pl-6 text-[10px] text-slate-600">还有 {list.length - shown.length} 条跨天任务</div>
                        ) : null}
                        {shownPlans.length ? (
                          <>
                            {list.length ? (
                              <div className="mb-0.5 mt-1 pl-6 text-[9px] uppercase tracking-wider text-slate-600">今日安排</div>
                            ) : (
                              <div className="mb-0.5 mt-0.5 pl-6 text-[9px] uppercase tracking-wider text-slate-600">今日安排</div>
                            )}
                            {shownPlans.map((pl) => (
                              <div key={pl.id}>
                                <div className="pl-[14px]">{renderPlanRow(pl)}</div>
                                {linkedChildren(pl.id).map((c) => (
                                  <div key={c.id} className="pl-[14px]">{renderPlanRow(c, true)}</div>
                                ))}
                              </div>
                            ))}
                            {linkedPlans.length > shownPlans.length ? (
                              <div className="pl-6 text-[10px] text-slate-600">还有 {linkedPlans.length - shownPlans.length} 条今日安排</div>
                            ) : null}
                          </>
                        ) : null}
                        {!list.length && !linkedPlans.length ? (
                          <div className="pl-6 text-[10.5px] text-slate-600">暂无任务 / 今日待办</div>
                        ) : null}
                      </>
                    ) : null}
                  </div>
                )
              })}
              {!projects.length ? <div className="py-1 text-[11px] text-slate-600">还没有活跃项目 · Alt+Space 打开对话框创建</div> : null}
            </>
          ) : null}

          {/* ── 待办区：未挂项目的今日项 ── */}
          {zoneOn('todos') ? (
            <>
              <div className="mb-0.5 mt-3 border-t border-[var(--line)] pt-2 text-[10px] uppercase tracking-wider text-slate-600">待办 · 未挂项目</div>
              {todoZone.map((p) => (
                <div key={p.id}>
                  {renderPlanRow(p)}
                  {(childMap[p.id] ?? []).map((c) => renderPlanRow(c, true))}
                </div>
              ))}
              {!todoZone.length ? <div className="py-1 text-[10.5px] text-slate-600">暂无未挂项目的待办</div> : null}
              {todoRoots.length > todoZone.length ? <div className="text-[10px] text-slate-600">还有 {todoRoots.length - todoZone.length} 条</div> : null}
            </>
          ) : null}

          {/* ── 生活区 ── */}
          {zoneOn('life') ? (
            <>
              <div className="mb-0.5 mt-3 border-t border-[var(--line)] pt-2 text-[10px] uppercase tracking-wider text-slate-600">生活</div>
              {lifeZone.map((p) => (
                <div key={p.id}>
                  {renderPlanRow(p)}
                  {(childMap[p.id] ?? []).map((c) => renderPlanRow(c, true))}
                </div>
              ))}
              {!lifeZone.length ? <div className="py-1 text-[10.5px] text-slate-600">暂无生活事项</div> : null}
              {lifeRoots.length > lifeZone.length ? <div className="text-[10px] text-slate-600">还有 {lifeRoots.length - lifeZone.length} 条</div> : null}
            </>
          ) : null}
        </div>
      </div>
    </div>
  )
}
