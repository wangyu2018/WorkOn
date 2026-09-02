# -*- coding: utf-8 -*-
"""日历月模式重做：滚动月历（月份流 + 视口高亮 + 天格补录）"""
import io

p = 'src/renderer/src/views/CalendarView.tsx'
t = io.open(p, encoding='utf-8', newline='').read()

def repl(old, new, count=1):
    global t
    eol = '\r\n' if '\r\n' in t else '\n'
    o = old.replace('\n', eol)
    n = new.replace('\n', eol)
    c = t.count(o)
    assert c == count, 'x' + str(c) + ': ' + old[:70]
    t = t.replace(o, n)
    print('OK |', old.strip().splitlines()[0][:52])

# 1) CalMode 扩展 heat
repl("type CalMode = 'week' | 'month'",
     "type CalMode = 'week' | 'month' | 'heat'")
repl("""    if (v === 'week' || v === 'month') return v
    return 'week'""",
     """    if (v === 'week' || v === 'month' || v === 'heat') return v
    return 'week'""")
repl("""    return 'week'
  }

  const [draft""",
     """    return 'week'
  }

  const [draft""")

# 2) MODES 加热度
repl("""    { key: 'week', label: '周' },
    { key: 'month', label: '月' }
  ]""",
     """    { key: 'week', label: '周' },
    { key: 'month', label: '月' },
    { key: 'heat', label: '热度' }
  ]""")

# 3) 渲染三分支：月=滚动月历，热度=原热力图
repl("""      {mode === 'week' ? (
        <WeekGrid date={date} />
      ) : (
        <div className="glass-card hoverable anim-fade-up" style={{ animationDelay: '120ms' }}>
          <h2 className="mb-3 flex items-center gap-2 text-[15px] font-semibold text-slate-200">
            <Icon name="flame" size={15} className="text-neon-amber" />
            {monthLabel} 工作热度
          </h2>
          <HeatmapView range="month" yearMonth={currentMonth} />
        </div>
      )}""",
     """      {mode === 'week' ? (
        <WeekGrid date={date} />
      ) : mode === 'heat' ? (
        <div className="glass-card hoverable anim-fade-up" style={{ animationDelay: '120ms' }}>
          <h2 className="mb-3 flex items-center gap-2 text-[15px] font-semibold text-slate-200">
            <Icon name="flame" size={15} className="text-neon-amber" />
            {monthLabel} 工作热度
          </h2>
          <HeatmapView range="month" yearMonth={currentMonth} />
        </div>
      ) : (
        <MonthStream />
      )}""")

# 4) MonthStream 组件（模块级，插在 WeekGrid 定义之前）
month_stream = """/* ── 月模式：滚动月历（月份流 + 视口高亮 + 天格点击补录） ── */
interface MonthDayStat {
  date: string
  min: number
  topState: WorkState
}

function monthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function MonthStream() {
  const [months, setMonths] = useState<string[]>(() => {
    const now = new Date()
    const out: string[] = []
    for (let i = 0; i < 12; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
      out.push(monthKey(d))
    }
    return out
  })
  const [active, setActive] = useState(() => monthKey(new Date()))
  const [stats, setStats] = useState<Record<string, MonthDayStat[]>>({})
  const [editor, setEditor] = useState<{ entry: TimeEntry; isNew: boolean } | null>(null)
  const sectionRefs = useRef<Record<string, HTMLDivElement | null>>({})
  const refreshTick = useRef(0)

  const loadMonth = useCallback(async (ym: string) => {
    const [y, m] = ym.split('-').map(Number)
    const days = new Date(y, m, 0).getDate()
    const stats: MonthDayStat[] = []
    for (let d = 1; d <= days; d++) {
      const date = `${ym}-${String(d).padStart(2, '0')}`
      try {
        const trail = await window.api?.getTrail?.(date)
        if (!trail) continue
        let topState: WorkState = 'idle'
        let topMin = 0
        ;(Object.entries(trail.stateMinutes) as [WorkState, number][]).forEach(([st, min]) => {
          if (min > topMin) { topState = st; topMin = min }
        })
        if (trail.totalMin > 0) stats.push({ date, min: Math.round(trail.totalMin), topState })
      } catch { /* ignore */ }
    }
    setStats((prev) => ({ ...prev, [ym]: stats }))
  }, [])

  useEffect(() => {
    months.forEach((ym) => void loadMonth(ym))
  }, [months, loadMonth])

  // 视口高亮：滚动监听，取与视口中线最近的月份
  useEffect(() => {
    const onScroll = (): void => {
      const mid = window.innerHeight * 0.4
      let best: string | null = null
      let bestDist = Infinity
      for (const ym of months) {
        const el = sectionRefs.current[ym]
        if (!el) continue
        const r = el.getBoundingClientRect()
        const dist = Math.abs(r.top + r.height / 2 - mid)
        if (dist < bestDist) { bestDist = dist; best = ym }
      }
      if (best) setActive(best)
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    onScroll()
    return () => window.removeEventListener('scroll', onScroll)
  }, [months])

  const scrollToMonth = (ym: string): void => {
    sectionRefs.current[ym]?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    setActive(ym)
  }

  const monthLabelOf = (ym: string): string => {
    const [y, m] = ym.split('-').map(Number)
    return `${y}年${m}月`
  }

  return (
    <div className="view-enter flex flex-col gap-4">
      {/* 工具条：跟随视口高亮的月份 */}
      <div className="anim-fade-up flex items-center gap-2">
        <button className="glass-btn !px-2" onClick={() => scrollToMonth(months[Math.min(months.indexOf(active) + 1, months.length - 1)])}>
          <Icon name="chevronLeft" size={14} />
        </button>
        <button className="glass-btn" onClick={() => scrollToMonth(monthKey(new Date()))}>本月</button>
        <button className="glass-btn !px-2" onClick={() => scrollToMonth(months[Math.max(0, months.indexOf(active) - 1)])}>
          <Icon name="chevronRight" size={14} />
        </button>
        <span className="ml-1 text-[16px] font-semibold tabular-nums text-slate-100">{monthLabelOf(active)}</span>
        <span className="ml-2 text-[11px] text-slate-500">滚动页面浏览历史月份 · 点击日期补录</span>
      </div>

      {months.map((ym) => {
        const days = stats[ym]
        const total = (days ?? []).reduce((s, d) => s + d.min, 0)
        const isActive = active === ym
        return (
          <div
            key={ym}
            data-month={ym}
            ref={(el) => { sectionRefs.current[ym] = el }}
            className="glass-card anim-fade-up"
            style={{
              borderColor: isActive ? 'var(--tl-now)' : undefined,
              boxShadow: isActive ? '0 0 0 1px var(--tl-now), 0 8px 30px rgba(0,0,0,0.25)' : undefined,
              scrollMarginTop: 16
            }}
          >
            <div className="mb-2 flex items-center justify-between">
              <h3 className={`text-[15px] font-semibold ${isActive ? 'text-neon-cyan' : 'text-slate-200'}`}>
                {monthLabelOf(ym)}
                {ym === monthKey(new Date()) ? <span className="ml-2 text-[10px] text-slate-500">本月</span> : null}
              </h3>
              <span className="text-[11px] text-slate-500">合计 {total > 0 ? `${Math.floor(total / 60)}h ${total % 60}m` : total > 0 ? `${total}m` : '—'}</span>
            </div>
            {!days ? (
              <div className="py-4 text-center text-[11px] text-slate-600">加载中…</div>
            ) : days.length === 0 ? (
              <div className="py-4 text-center text-[11px] text-slate-600">当月无记录</div>
            ) : (
              <div className="grid grid-cols-7 gap-1.5">
                {days.map((d) => {
                  const meta = WORK_STATES[d.topState] ?? WORK_STATES.idle
                  const dayNum = Number(d.date.slice(-2))
                  return (
                    <button
                      key={d.date}
                      className="rounded-lg border p-2 text-left transition-all hover:border-neon-cyan/40 hover:bg-white/[0.04]"
                      style={{ borderColor: 'rgba(255,255,255,0.07)', background: 'rgba(255,255,255,0.02)' }}
                      onClick={() => {
                        setEditor({
                          isNew: true,
                          entry: {
                            id: `new-${d.date}`,
                            date: d.date,
                            startMin: 9 * 60,
                            endMin: 18 * 60,
                            title: '',
                            source: 'manual',
                            ts: Date.now()
                          }
                        })
                      }}
                      title={`${d.date} · ${meta.label} ${d.min}m · 点击补录`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-[12px] font-semibold text-slate-200">{dayNum}</span>
                        <span className="h-2 w-2 rounded-full" style={{ background: meta.color, opacity: Math.min(1, 0.3 + d.min / 240) }} />
                      </div>
                      <div className="mt-0.5 text-[10px] tabular-nums text-slate-500">{d.min > 0 ? `${Math.floor(d.min / 60)}h ${d.min % 60}m` : '—'}</div>
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        )
      })}

      {editor ? (
        <EntryEditor
          entry={editor.entry}
          isNew={editor.isNew}
          onClose={() => setEditor(null)}
          onSaved={() => { setEditor(null); refreshTick.current++; void loadMonth(monthKey(new Date())) }}
        />
      ) : null}
    </div>
  )
}

function WeekGrid({ date }: { date: string }) {"""

repl("function WeekGrid({ date }: { date: string }) {", month_stream)

io.open(p, 'w', encoding='utf-8', newline='').write(t)
print('month stream done')
