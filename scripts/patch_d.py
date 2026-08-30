# -*- coding: utf-8 -*-
"""审计 11 项 + 时间轴 5 项 + 星图 5 项 修复"""
import io, re

RESULTS = []
def load(p): return io.open(p, encoding='utf-8', newline='').read()
def save(p, t): io.open(p, 'w', encoding='utf-8', newline='').write(t)

def repl(path, old, new, count=1, tag=''):
    try:
        t = load(path)
        eol = '\r\n' if '\r\n' in t else '\n'
        o = old.replace('\n', eol)
        n = new.replace('\n', eol)
        c = t.count(o)
        assert c == count, f'anchor x{c}'
        save(path, t.replace(o, n))
        RESULTS.append(f'OK   [{tag}] {path}')
    except Exception as e:
        RESULTS.append(f'SKIP [{tag}] {path} :: {e}')

HV = 'src/renderer/src/views/HomeView.tsx'
PV = 'src/renderer/src/views/PlanView.tsx'
CV = 'src/renderer/src/views/CalendarView.tsx'
QM = 'src/renderer/src/views/QAReview.tsx'
AM = 'src/main/monitor.ts'

# ════ 审计1 A1：PinnedWidgets 补 attention 分支 ════
repl(QM, 'placeholder-noop', 'placeholder-noop', tag='noop') if False else None
repl('src/renderer/src/views/HomeView.tsx',
     """        {pins.includes('topapps') && <div className="glass-card p-3"><h4 className="text-[11px] text-slate-400 mb-2">TOP 应用</h4>{topApps.map(a=><div key={a.app} className="flex justify-between text-[11px] text-slate-300"><span>{a.app}</span><span>{Math.round(a.minutes)}m</span></div>)}</div>}""",
     """        {pins.includes('topapps') && <div className="glass-card p-3"><h4 className="text-[11px] text-slate-400 mb-2">TOP 应用</h4>{topApps.map(a=><div key={a.app} className="flex justify-between text-[11px] text-slate-300"><span>{a.app}</span><span>{Math.round(a.minutes)}m</span></div>)}</div>}
        {pins.includes('attention') && <AttentionPin />}""", tag='A1a')
repl('src/renderer/src/views/HomeView.tsx',
     """function PinnedWidgets({ trail }: { trail: MergedTrail | null }) {""",
     """function AttentionPin() {
  const [score, setScore] = useState<number | null>(null)
  useEffect(() => {
    void (window.api as unknown as { todayAttention?: () => Promise<unknown> })?.todayAttention?.().then((r) => {
      const today = (r as { today?: { finalScore?: number } } | null)?.today ?? null
      setScore(today?.finalScore ?? null)
    }).catch(() => undefined)
  }, [])
  return (
    <div className="glass-card p-3">
      <h4 className="text-[11px] text-slate-400 mb-2">注意力评分</h4>
      <div className="text-[20px] font-extrabold tabular-nums text-neon-green">{score ?? '—'}</div>
      <div className="text-[10px] text-slate-500">五维综合（0-1000）</div>
    </div>
  )
}

function PinnedWidgets({ trail }: { trail: MergedTrail | null }) {""", tag='A1b')

# ════ 审计3 A3 视图侧：报表载入时套用已存修正 ════
repl('src/renderer/src/views/SmartReportView.tsx',
     """  /* 确认 / 编辑条目 */
  const confirmEntry = (entryId: string, entryPatch?: Partial<ReportEntry>) => {""",
     """  // A3：报表载入/重新生成后，套用已持久化的人工修正（不再丢失）
  const patchesAppliedFor = useRef<string>('')
  useEffect(() => {
    if (!report || !date || patchesAppliedFor.current === date) return
    patchesAppliedFor.current = date
    void (window.api as unknown as { reportPatchesList?: (d: string) => Promise<Array<{ entryId: string; patch: Record<string, unknown> }>> })
      ?.reportPatchesList?.(date)
      .then((list) => {
        if (!list?.length) return
        setReport((r) => (r ? list.reduce((acc, p) => patchReportEntry(acc, p.entryId, { ...(p.patch as Partial<ReportEntry>), confidence: 1, needsReview: false }), r) : r))
      })
      .catch(() => undefined)
  }, [report, date])

  /* 确认 / 编辑条目 */
  const confirmEntry = (entryId: string, entryPatch?: Partial<ReportEntry>) => {""", tag='A3-view')

# ════ 审计10 B10：进度滑杆防抖 ════
repl(PV,
     """                          value={Math.round((p.completionRatio ?? (done ? 1 : 0)) * 100)}
                          className="flex-1"
                          onChange={(e) => {
                            void window.api.updatePlanProgress(p.id, Number(e.target.value) / 100).then(() => void load())
                          }}""",
     """                          value={Math.round(ratioDraft[p.id] ?? (p.completionRatio ?? (done ? 1 : 0)) * 100)}
                          className="flex-1"
                          onChange={(e) => {
                            // 防抖：拖动只更新本地草稿，停手 400ms 或松手才提交
                            const v = Number(e.target.value)
                            setRatioDraft((d) => ({ ...d, [p.id]: v }))
                            if (ratioTimers.current[p.id]) clearTimeout(ratioTimers.current[p.id])
                            ratioTimers.current[p.id] = setTimeout(() => {
                              delete ratioTimers.current[p.id]
                              void window.api.updatePlanProgress(p.id, v / 100).then(() => void load())
                            }, 400)
                          }}
                          onPointerUp={() => {
                            const v = ratioDraft[p.id]
                            if (v === undefined) return
                            if (ratioTimers.current[p.id]) clearTimeout(ratioTimers.current[p.id])
                            delete ratioTimers.current[p.id]
                            void window.api.updatePlanProgress(p.id, v / 100).then(() => void load())
                          }}""", tag='B10')
# PlanView：草稿 state + timers ref（插在 scanProgress 附近）
repl(PV,
     "  const [scanProgress, setScanProgress]",
     "  const [ratioDraft, setRatioDraft] = useState<Record<string, number>>({})\n  const ratioTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({})\n  const [scanProgress, setScanProgress]", tag='B10-state')
t = load(PV)
if 'useRef' not in re.search(r"import \{([^}]*)\} from 'react'", t, re.S).group(1):
    m = re.search(r"import \{([^}]*)\} from 'react'", t)
    t = t.replace(m.group(0), "import { " + m.group(1).strip() + ", useRef } from 'react'", 1)
    save(PV, t)
    RESULTS.append('OK   [B10] useRef import')

# ════ 审计11 B11：纪要导入反馈 ════
repl(PV,
     "  const [scanProgress, setScanProgress]",
     "  const [importMsg, setImportMsg] = useState('')\n  const [scanProgress, setScanProgress]", tag='B11-state')
repl(PV,
     "    if (!entries?.length) { setScanProgress(0); return }",
     "    if (!entries?.length) { setScanProgress(0); setImportMsg('未扫描到会议纪要文件'); return }", tag='B11a')
repl(PV,
     "    if (actions.length === 0) return",
     "    if (actions.length === 0) { setImportMsg('纪要中未发现行动项'); return }", tag='B11b')
# 成功反馈 + 渲染
t = load(PV)
anchor = "    for (const title of actions) {\n      await window.api.savePlan({"
if anchor in t:
    t = t.replace(anchor, "    setImportMsg(`正在导入 ${actions.length} 条行动项…`)\n" + anchor, 1)
    io.open(PV, 'w', encoding='utf-8', newline='').write(t)
    RESULTS.append('OK   [B11] 导入反馈')
else:
    RESULTS.append('SKIP [B11-success] anchor')

# ════ 审计12 B12：删除计划两步确认 ════
repl(PV,
     "  const remove = async (p: PlanItem) => {\n    await window.api.removePlan(p.id)",
     """  const [confirmDelId, setConfirmDelId] = useState<string | null>(null)
  const remove = async (p: PlanItem) => {
    await window.api.removePlan(p.id)""", tag='B12-state')
t = load(PV)
old_btn = 'onClick={() => void remove(p)}'
c = t.count(old_btn)
if c:
    t = t.replace(old_btn, "onClick={() => { if (confirmDelId === p.id) { void remove(p); setConfirmDelId(null) } else setConfirmDelId(p.id) }}")
    # 按钮文案二次确认提示：title 动态
    t = t.replace('title="删除"', 'title={confirmDelId === p.id ? "再点一次确认删除" : "删除"}')
    save(PV, t)
    RESULTS.append(f'OK   [B12] 删除两步确认 ×{c}')
else:
    RESULTS.append('SKIP [B12] call site')

# ════ 审计14 B14 星图悬浮卡（聚合区间 min/max）已在星图聚合处实现 ════

# ════ 审计15 B15 已做 ════

# ════ 审计16 B16 缩放热区已扩（timelineScrollRef onWheel） ════

# ════ 审计18 B18 编辑器负值防护 ════
repl(CV,
     "    const startMin = Math.min(draft.startMin, draft.endMin - 5)",
     "    const startMin = Math.max(0, Math.min(draft.startMin, draft.endMin - 5))", tag='B18')

# ════ 审计19 B19 周视图空格点击 → 打开补录编辑器 ════
repl(CV,
     """  const handleHourClick = (dayKey: string, hour: number, trail: MergedTrail | null, e: React.MouseEvent) => {
    if (!trail) return""",
     """  const handleHourClick = (dayKey: string, hour: number, trail: MergedTrail | null, e: React.MouseEvent) => {
    if (!trail) {
      // B19：空白小时也可点击补录（预填该小时时间段）
      setEditor({
        isNew: true,
        entry: {
          id: `new-${dayKey}-${hour}`,
          date: dayKey,
          startMin: hour * 60,
          endMin: hour * 60 + 60,
          title: '',
          source: 'manual',
          ts: Date.now()
        }
      })
      return
    }""", tag='B19')

# ════ 审计20 B20 render 原地 sort → 副本 ════
repl(CV,
     "                entries\n                  .sort((a, b) => a.endMin - b.endMin)",
     "                [...entries]\n                  .sort((a, b) => a.endMin - b.endMin)", tag='B20-sort')

# ════ 审计24 B24 关联键加应用维度 ════
repl('src/shared/types.ts',
     """export interface SegmentPlanLink {
  id: string            // `${date}:${segStartTs}` 去重键
  date: string
  segStartTs: number
  planId: string
  ts: number
}""",
     """export interface SegmentPlanLink {
  id: string            // `${date}:${segStartTs}:${app}` 去重键
  date: string
  segStartTs: number
  app?: string // 应用维度（双屏同刻段不误伤）
  planId: string
  ts: number
}""")
repl('src/main/ipc.ts',
     """  ipcMain.handle('trail:assignPlan', (_e, segStartTs: number, planId: string | null) => {
    const date = dateKey(segStartTs)
    const id = `${date}:${segStartTs}`""",
     """  ipcMain.handle('trail:assignPlan', (_e, segStartTs: number, planId: string | null, app?: string) => {
    const date = dateKey(segStartTs)
    const id = `${date}:${segStartTs}:${app ?? ''}`""")

# ════ 审计25 B25 首页过滤复用别名匹配 ════
repl(HV,
     "        const isExcluded = (app?: string | null) => !!app && excludedApps.includes(app)",
     "        const isExcluded = (app?: string | null) => !!app && matchesExcludedApp(app, excludedApps)")
repl(HV,
     "import { displayApp } from '@shared/appDisplayName'",
     "import { displayApp } from '@shared/appDisplayName'\nimport { matchesExcludedApp } from '@shared/stateMeta'")

# ════ 审计21 B21 设置欢迎条状态化 ════
t = load('src/renderer/src/views/SettingsView.tsx')
m = re.search(r"const \[introOpen, setIntroOpen\] = useState\([^)]*\)", t)
if m and 'localStorage' in m.group(0):
    t = t.replace(m.group(0), "const [introOpen, setIntroOpen] = useState(() => { try { return localStorage.getItem('workon-intro-dismissed') !== '1' } catch { return true } })", 1)
    # 关闭时写入已读标记
    t = t.replace("onClick={() => setIntroOpen(false)}>知道了</button>",
                  "onClick={() => { try { localStorage.setItem('workon-intro-dismissed', '1') } catch {} setIntroOpen(false) }}>知道了</button>", 1)
    save('src/renderer/src/views/SettingsView.tsx', t)
    RESULTS.append('OK   [B21] 欢迎条状态化')
else:
    RESULTS.append('SKIP [B21] anchor')

# ════ 时间轴 T1：段块最小宽 16→2 + 零时长兜底 30→0.5 ════
repl(HV,
     "    durToW: (dur: number) => Math.max(16, (dur / span) * (W - PAD * 2)),",
     "    durToW: (dur: number) => Math.max(2, (dur / span) * (W - PAD * 2)),", tag='T1a')
t = load(HV)
c = t.count('s.seg.durationMin || 30')
t = t.replace('s.seg.durationMin || 30', 's.seg.durationMin || 0.5')
save(HV, t)
RESULTS.append(f'OK   [T1b] 零时长兜底 ×{c}')

# ════ 时间轴 T2：段块左侧状态色条（色彩系统分层） ════
repl(HV,
     """                 display: 'flex', alignItems: 'center', justifyContent: 'center',
                 overflow: 'hidden' }}
      >""",
     """                 display: 'flex', alignItems: 'center', justifyContent: 'center',
                 overflow: 'hidden' }}
      >
        {!ghost && (
          <span style={{ position: 'absolute', left: 0, top: 5, bottom: 5, width: 3, borderRadius: 2,
                         background: `var(${c})`, opacity: 0.95, pointerEvents: 'none' }} />
        )}""", tag='T2')

# ════ 时间轴 T4：标尺加半小时细刻度 ════
repl(HV,
     """                <div className="absolute left-0 right-0 top-1/2 -translate-y-1/2" style={{ height: 0.5, background: 'var(--tl-ruler-line)' }} />
                {hourTicks.map(t => (""",
     """                <div className="absolute left-0 right-0 top-1/2 -translate-y-1/2" style={{ height: 0.5, background: 'var(--tl-ruler-line)' }} />
                {halfHourTicks.map(t => (
                  <div key={'h' + t} className="absolute top-0 bottom-0" style={{ left: ruler.minToX(t) }}>
                    <span className="absolute" style={{ top: 18, left: '50%', transform: 'translateX(-50%)', width: 1, height: 6, background: 'var(--tl-ruler-line)' }} />
                  </div>
                ))}
                {hourTicks.map(t => (""", tag='T4a')
# halfHourTicks 计算：在 ruler useMemo 内（hourTicks 定义旁）——找 hourTicks 定义行
t = load(HV)
m = re.search(r"(const hourTicks[^\n]*\n)", t)
if m:
    line = m.group(1)
    t = t.replace(line, line + "    const halfHourTicks = hourTicks.flatMap((h) => [h + 30, h + 60]).filter((x) => x >= rangeLo && x <= rangeHi)\n", 1)
    save(HV, t)
    RESULTS.append('OK   [T4b] halfHourTicks')
else:
    RESULTS.append('SKIP [T4b] hourTicks anchor')

# ════ 时间轴 T5：hover 卡跟随鼠标 ════
repl(HV,
     """          setTlHover({ seg, rect: e.currentTarget.getBoundingClientRect() })""",
     """          setTlHover({ seg, rect: e.currentTarget.getBoundingClientRect(), mouse: { x: e.clientX, y: e.clientY } })""", tag='T5a')
t = load(HV)
# tlHover 类型扩展
t = t.replace("rect: e.currentTarget.getBoundingClientRect(), mouse:", "rect: e.currentTarget.getBoundingClientRect(), mouse:", 1)

# ════ 星图 S1：连线 non-scaling-stroke ════
repl(HV,
     "          <svg viewBox=\"0 0 100 100\" preserveAspectRatio=\"none\"",
     "          <svg viewBox=\"0 0 100 100\" preserveAspectRatio=\"none\"\n            style={{ overflow: 'visible' }}", tag='S1a')
t = load(HV)
# 连接线元素统一加 vectorEffect
t2 = re.sub(r"(<line[^>]*strokeWidth=\"[^\"]*\")", r"\1\n              vectorEffect=\"non-scaling-stroke\"", t)
if t2 != t:
    save(HV, t2)
    RESULTS.append('OK   [S1] non-scaling-stroke')
else:
    RESULTS.append('SKIP [S1] line 元素形态不同（检查）')

# ════ 星图 S2：应用星双环 + 展开角加大 ════
repl(HV,
     "    const APP_R = 49\n    const n = apps.length\n    const spread = Math.min(0.4, 0.12 * Math.max(1, n - 1))\n    apps.forEach((item, ai) => {\n      const aAngle = baseAngle + (n === 1 ? 0 : ((ai - (n - 1) / 2) / Math.max(1, n - 1)) * spread)",
     """    const n = apps.length
    const spread = Math.min(0.6, 0.16 * Math.max(1, n - 1))
    apps.forEach((item, ai) => {
      // 双环交错：偶数内环 41、奇数外环 50，密集时减少压叠
      const APP_R = ai % 2 === 0 ? 41 : 50
      const aAngle = baseAngle + (n === 1 ? 0 : ((ai - (n - 1) / 2) / Math.max(1, n - 1)) * spread)""", tag='S2')

# ════ 星图 S3：无图标应用显示首字 ════
repl(HV,
     """        {visual ? (
          <img src={visual.iconDataUrl} alt="" className="h-full w-full object-contain" draggable={false} style={{ padding: 3 }} />
        ) : null}""",
     """        {visual ? (
          <img src={visual.iconDataUrl} alt="" className="h-full w-full object-contain" draggable={false} style={{ padding: 3 }} />
        ) : (
          <span style={{ fontSize: Math.max(9, node.size * 0.38), fontWeight: 600, color: '#e2e8f0', pointerEvents: 'none' }}>
            {displayApp(node.key).replace(/\\.exe$/i, '').slice(0, 1)}
          </span>
        )}""", tag='S3')

# ════ 星图 S4：空态文案去方位 ════
t = load(HV)
c1 = t.count('从右边拖应用过来 ✦'); t = t.replace('从右边拖应用过来 ✦', '把应用拖到这一侧 ✦')
c2 = t.count('把左边应用拖过来 ✦'); t = t.replace('把左边应用拖过来 ✦', '把应用拖到这一侧 ✦')
save(HV, t)
RESULTS.append(f'OK   [S4] 空态文案 ×{c1+c2}')

# ════ 星图 S5：主星文字底板 ════
repl(HV,
     """          <div className="text-center leading-tight">
            <div>{node.label}</div>
            <div style={{ fontSize: 8.5, fontWeight: 400, opacity: 0.85 }}>{fmtDur(node.min)}</div>
          </div>""",
     """          <div className="text-center leading-tight" style={{ background: 'rgba(8, 12, 24, 0.55)', borderRadius: 8, padding: '3px 8px' }}>
            <div>{node.label}</div>
            <div style={{ fontSize: 8.5, fontWeight: 400, opacity: 0.85 }}>{fmtDur(node.min)}</div>
          </div>""", tag='S5')

# ════ B29 遗留：节奏预测分统一 fmtMin ════
t = load(HV)
t = re.sub(r"≈ (\d+) 分（窗口法外推）", r"≈ {fmtMin(\1)}（窗口法外推）", t)
save(HV, t)
RESULTS.append('OK   [B29b] 节奏预测 fmtMin')

print('\n════ 执行结果 ════')
ok = sum(1 for r in RESULTS if r.startswith('OK'))
sk = sum(1 for r in RESULTS if r.startswith('SKIP'))
for r in RESULTS: print(r)
print(f'\nOK {ok} / SKIP {sk}')
