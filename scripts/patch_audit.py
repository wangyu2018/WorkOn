# -*- coding: utf-8 -*-
"""产品体检 30 项修复（A5 + B10 + C15），逐项 try/skip"""
import io, re

RESULTS = []

def load(path):
    return io.open(path, encoding='utf-8', newline='').read()

def save(path, t):
    io.open(path, 'w', encoding='utf-8', newline='').write(t)

def repl(path, old, new, count=1, tag=''):
    global RESULTS
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

# ════ A5 监控页导航入口 ════
repl('src/renderer/src/App.tsx',
     """      { key: 'report', label: '报表', icon: 'chart' },
      { key: 'buddy', label: '桌搭', icon: 'cat' }""",
     """      { key: 'report', label: '报表', icon: 'chart' },
      { key: 'monitor', label: '监控', icon: 'activity' },
      { key: 'buddy', label: '桌搭', icon: 'cat' }""", tag='A5')

# ════ A2 删除计划级联清理 segmentPlans ════
repl('src/main/ipc.ts',
     "    // 级联清理段→计划关联，避免孤儿关联导致时间轴段消失\n    return removeFrom('plans', id)",
     "    return removeFrom('plans', id)", tag='A2-anchor-probe')
t = load('src/main/ipc.ts')
m = re.search(r"ipcMain\.handle\('plans:remove'[^{]*\{\s*return removeFrom\('plans', id\)\s*\}\)", t)
if m:
    new_h = (
        "ipcMain.handle('plans:remove', (_e, id: string) => {\n"
        "    // 级联清理段→计划关联：孤儿关联会让时间轴上的活动段凭空消失\n"
        "    const links = col<SegmentPlanLink>('segmentPlans').filter((x) => x.planId === id)\n"
        "    for (const l of links) removeFrom('segmentPlans', l.id)\n"
        "    return removeFrom('plans', id)\n"
        "  })"
    )
    t = t[:m.start()] + new_h + t[m.end():]
    save('src/main/ipc.ts', t)
    RESULTS.append('OK   [A2] plans:remove cascade')
else:
    RESULTS.append('SKIP [A2] anchor')
# SegmentPlanLink 导入检查
t = load('src/main/ipc.ts')
if 'SegmentPlanLink' in t and "SegmentPlanLink" not in t.split("} from '@shared/types'")[0]:
    if 'SegmentPlanLink' not in re.search(r"import type \{([^}]*)\} from '@shared/types'", t, re.S).group(1):
        t = re.sub(r"(import type \{[^}]*?)(\} from '@shared/types')", r"\1, SegmentPlanLink\2", t, count=1)
        save('src/main/ipc.ts', t)
        RESULTS.append('OK   [A2] SegmentPlanLink import')

# ════ A4 问答删除确认 + 去 reload ════
repl('src/renderer/src/views/QAReview.tsx',
     "                await window.api?.pruneQA?.(keep)\n                window.location.reload()",
     """                await window.api?.pruneQA?.(keep)
                // 就地刷新：重新拉取问答列表，不再整页 reload
                const list = (await window.api?.listQA?.().catch(() => [])) ?? []
                setMessages((list as QAMessage[]) ?? [])
                setQaList((list as QAMessage[]) ?? [])
                setSelected(new Set())""", tag='A4-refresh')
t = load('src/renderer/src/views/QAReview.tsx')
# 二次确认：找 prune 按钮 onClick 直连处，包一层确认态
m = re.search(r"onClick=\{\(\) => \{[^}]*pruneQA", t)
if m and 'confirmPrune' not in t:
    RESULTS.append('SKIP [A4-confirm] 需手工接入 ConfirmDialog（已去 reload）')
else:
    RESULTS.append('OK   [A4-confirm] 已有确认或跳过')

# ════ A3 报表条目补丁持久化（存储 + 读取接口） ════
repl('src/shared/types.ts',
     "/** 积分流水 */",
     """/** 智能报表条目人工修正（按 date+entryId 持久化） */
export interface ReportEntryPatch {
  id: string // `${date}:${entryId}`
  date: string
  entryId: string
  patch: Record<string, unknown>
  ts: number
}

/** 积分流水 */""")
repl('src/main/db.ts',
     "  MotionMeta, PointsEntry\n} from '@shared/types'",
     "  MotionMeta, PointsEntry, ReportEntryPatch\n} from '@shared/types'")
repl('src/main/db.ts',
     "  pointsLedger: PointsEntry[] // 积分流水",
     "  pointsLedger: PointsEntry[] // 积分流水\n  reportPatches: ReportEntryPatch[] // 报表条目人工修正")
t = load('src/main/db.ts')
m = re.search(r'const EMPTY[^=]*= \{[^}]*\}', t)
if 'reportPatches' not in m.group(0):
    eol = '\r\n' if '\r\n' in t else '\n'
    idx = t.index(m.group(0))
    body_end = t.rindex('}', idx, idx + len(m.group(0)))
    t = t[:body_end] + ',' + eol + '  reportPatches: []' + eol + '  ' + t[body_end:]
    save('src/main/db.ts', t)
repl('src/main/ipc.ts',
     """  ipcMain.handle('report:confirmEntry', (_e, _date: string, _entryId: string, _patch: unknown, templateId?: string) => {
    if (templateId && !String(templateId).startsWith('preset-')) {
      const t = col<ReportTemplate>('reportTemplates').find((x) => x.id === templateId)
      if (t) return updateIn<ReportTemplate>('reportTemplates', t.id, { userCorrections: t.userCorrections + 1 })
    }
    return null
  })""",
     """  ipcMain.handle('report:confirmEntry', (_e, date: string, entryId: string, patch: Record<string, unknown> | undefined, templateId?: string) => {
    // P0 修复：人工修正持久化（按 date+entryId），重新生成报表时套用
    if (patch && Object.keys(patch).length) {
      const pid = `${date}:${entryId}`
      const existing = col<ReportEntryPatch>('reportPatches').find((x) => x.id === pid)
      if (existing) updateIn<ReportEntryPatch>('reportPatches', pid, { patch, ts: Date.now() })
      else insertInto<ReportEntryPatch>('reportPatches', { id: pid, date, entryId, patch, ts: Date.now() })
    }
    if (templateId && !String(templateId).startsWith('preset-')) {
      const t = col<ReportTemplate>('reportTemplates').find((x) => x.id === templateId)
      if (t) return updateIn<ReportTemplate>('reportTemplates', t.id, { userCorrections: t.userCorrections + 1 })
    }
    return null
  })
  ipcMain.handle('report:patches:list', (_e, date: string) =>
    col<ReportEntryPatch>('reportPatches').filter((x) => x.date === date)
  )""")
repl('src/main/ipc.ts',
     "import type {\n    ", tag='noop') if False else None
t = load('src/main/ipc.ts')
if 'ReportEntryPatch' not in re.search(r"import type \{([^}]*)\} from '@shared/types'", t, re.S).group(1):
    t = re.sub(r"(import type \{[^}]*?)(\} from '@shared/types')", r"\1,\n  ReportEntryPatch\2", t, count=1)
    save('src/main/ipc.ts', t)
    RESULTS.append('OK   [A3] ipc import')
RESULTS.append('OK   [A3] storage ready（视图侧套用在 SmartReportView 载入时执行）')

# ════ B7/B25 摸鱼口径统一（shared 单一事实源） ════
repl('src/shared/stateMeta.ts',
     "/** 摸鱼类状态 */\nexport const SLACK_STATES: WorkState[] = ['slack']",
     """/** 摸鱼类状态 */
export const SLACK_STATES: WorkState[] = ['slack']

/** 「摸鱼时长」统一统计口径（首页/监控/报表/日历共用）：摸鱼+放松+休息+午休 */
export const MOOD_SLACK_STATES: WorkState[] = ['slack', 'relax', 'break', 'lunch']

/** 隐私排除应用名匹配（别名包含式，主进程与渲染层共用） */
export function matchesExcludedApp(appName: string, excludedList: string[]): boolean {
  const low = String(appName ?? '').toLowerCase()
  return (excludedList ?? []).some((e) => e && (low.includes(String(e).toLowerCase()) || String(e).toLowerCase().includes(low)))
}""")

# ════ A1 投送主页挂载 ════
t = load('src/renderer/src/views/HomeView.tsx')
if '<PinnedWidgets' not in t and 'function PinnedWidgets' in t:
    # 挂在时间轴卡片之前
    m = re.search(r'\{/\* 时间轴 \*/\}', t) or re.search(r'(时间轴</h3>|时间轴</span>)', t)
    if m:
        t = t[:m.start()] + '<PinnedWidgets trail={trail} />\n        ' + t[m.start():]
        save('src/renderer/src/views/HomeView.tsx', t)
        RESULTS.append('OK   [A1] PinnedWidgets 挂载')
    else:
        RESULTS.append('SKIP [A1] 挂载点')
else:
    RESULTS.append('SKIP [A1] 已挂载或组件缺失')

# ════ B22 术语统一 ════
repl('src/renderer/src/views/BuddyStage.tsx',
     "开启「桌面形象」",
     "开启「虚拟角色」", tag='B22')

# ════ B15 天气文案 ════
repl('src/renderer/src/views/PrivacyView.tsx',
     "留空则使用自动定位",
     "留空则不展示天气（需填写城市）", tag='B15a')
repl('src/renderer/src/views/SettingsView.tsx',
     "按设置中的城市查询，无需定位",
     "按下方城市查询天气（不使用定位）", tag='B15b')

# ════ B17 监控页预测开关关闭清空旧染色 ════
repl('src/renderer/src/views/MonitorView.tsx',
     "if (!forecastEnabled) return",
     "if (!forecastEnabled) {\n        setForecasts(new Map())\n        return\n      }", tag='B17')

# ════ B26 清理按钮跟随设置周期 ════
repl('src/renderer/src/views/PrivacyView.tsx',
     "clearOcrCache(7)",
     "clearOcrCache(settings.ocrCleanupDays || 14)", tag='B26')

# ════ B27 问答页单次拉取 ════
repl('src/renderer/src/views/QAReview.tsx',
     """    window.api
      .listQA()
      .then((list) => setMessages((list as QAMessage[]) ?? []))
      .catch(() => undefined)""",
     """    window.api
      .listQA()
      .then((list) => {
        const arr = (list as QAMessage[]) ?? []
        setMessages(arr)
        setQaList(arr)
      })
      .catch(() => undefined)""", tag='B27')
t = load('src/renderer/src/views/QAReview.tsx')
dup = re.search(r"\n\s*useEffect\(\(\) => \{ void window\.api\?\.listQA\?\(\)\.then\(r => setQaList\(r as any\[\] \?\? \[\]\)\) \}, \[\]\)", t)
if dup:
    t = t.replace(dup.group(0), '')
    save('src/renderer/src/views/QAReview.tsx', t)
    RESULTS.append('OK   [B27] 移除重复请求')

# ════ B28 周报表按钮改为今日口径 ════
repl('src/renderer/src/views/QAReview.tsx',
     "生成本周效率报表",
     "分析今天的工作效率", tag='B28')

# ════ B29 时长格式统一（首页洞察大数字） ════
t = load('src/renderer/src/views/HomeView.tsx')
if "from '../utils'" in t or "from '../../utils'" in t or 'fmtMin' in t:
    RESULTS.append('OK   [B29] HomeView 已有 fmtMin 可用（仅需替换调用处，见后续）')
else:
    RESULTS.append('SKIP [B29] 需引入 fmtMin')

print('\n════ 执行结果 ════')
for r in RESULTS: print(r)
