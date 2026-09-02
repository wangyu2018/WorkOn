# -*- coding: utf-8 -*-
"""顶栏/悬浮窗计划·项目标题：查询 helper + presence 透传 + 两端显示"""
import io

def load(p): return io.open(p, encoding='utf-8', newline='').read()
def save(p, t): io.open(p, 'w', encoding='utf-8', newline='').write(t)

def repl(path, old, new, count=1):
    t = load(path)
    eol = '\r\n' if '\r\n' in t else '\n'
    o = old.replace('\n', eol)
    n = new.replace('\n', eol)
    c = t.count(o)
    assert c == count, path + ': x' + str(c) + ': ' + old[:70]
    t = t.replace(o, n)
    save(path, t)
    print('OK', path, '|', old.strip().splitlines()[0][:44])

# ── 1) monitor.ts：helpers + 查询 + 传入 presence ──
repl('src/main/monitor.ts',
    "import type { CorrectionRule, PlanItem, WorkState } from '@shared/types'",
    "import type { CorrectionRule, PlanItem, Project, ProjectTimeLink, SegmentPlanLink, WorkState } from '@shared/types'")

repl('src/main/monitor.ts',
    "async function tick(): Promise<void> {",
    """/** 当前段关联的计划标题（拖拽归类/会话确认产生的关联） */
function currentPlanTitle(segStartTs: number): string | null {
  const links = col<SegmentPlanLink>('segmentPlans').filter((l) => l.segStartTs === segStartTs)
  if (!links.length) return null
  const planId = links[links.length - 1].planId
  return col<PlanItem>('plans').find((p) => p.id === planId)?.title ?? null
}

/** 当前应用归属的项目名（projectTimeLinks 最近一条） */
function currentProjectName(app: string): string | null {
  const links = col<ProjectTimeLink>('projectTimeLinks').filter((l) => l.app === app.toLowerCase())
  if (!links.length) return null
  const last = links.reduce((a, b) => (b.ts > a.ts ? b : a))
  return col<Project>('projects').find((x) => x.id === last.projectId)?.name ?? null
}

async function tick(): Promise<void> {""")

repl('src/main/monitor.ts',
    "      // 仅主屏样本携带窗口矩形（桌宠漫游避让用；桌宠窗口只覆盖主屏）",
    """      // 语义标签：当前段关联的计划标题 / 项目名（顶栏与悬浮窗显示）
      const planTitle = currentPlanTitle(tr.startTs)
      const projectName = currentProjectName(corrected.app)
      // 仅主屏样本携带窗口矩形（桌宠漫游避让用；桌宠窗口只覆盖主屏）""")

repl('src/main/monitor.ts',
    'presence.push({ ts, app: corrected.app, title: safeTitle, appName: identified.appName, state: identified.state, screen: fg.screen, active: true, idleSec, winRect })',
    'presence.push({ ts, app: rec.app, title: rec.title, appName: rec.appName, state: rec.state, planTitle, projectName, screen: fg.screen, active: true, idleSec, winRect })')

# ── 2) shared/types.ts：PresenceSnapshot 加字段 ──
repl('src/shared/types.ts',
    "  continuousFocusSec: number\n  idleSec: number\n  /** 当前活动关联的计划标题（拖拽归类/会话归属） */",
    "  continuousFocusSec: number\n  idleSec: number\n  /** 当前活动关联的计划标题（拖拽归类/会话归属） */\n  planTitle?: string | null\n  projectName?: string | null")

# ── 3) presence.ts：样本透传进快照 ──
repl('src/main/presence.ts',
    "  /** 当前活动关联的计划/项目标题（monitor 计算后传入） */\n  planTitle?: string | null\n  projectName?: string | null\n  screen: number",
    "  /** 当前活动关联的计划/项目标题（monitor 计算后传入） */\n  planTitle?: string | null\n  projectName?: string | null\n  screen: number")
repl('src/main/presence.ts',
    "  private lastPlanTitle: string | null = null\n  private lastProjectName: string | null = null",
    "  private lastPlanTitle: string | null = null\n  private lastProjectName: string | null = null")
repl('src/main/presence.ts',
    "    if (sample.planTitle !== undefined) this.lastPlanTitle = sample.planTitle\n    if (sample.projectName !== undefined) this.lastProjectName = sample.projectName",
    "    if (sample.planTitle !== undefined) this.lastPlanTitle = sample.planTitle\n    if (sample.projectName !== undefined) this.lastProjectName = sample.projectName")
repl('src/main/presence.ts',
    "      continuousFocusSec: this.focusSince ? Math.round((ts - this.focusSince) / 1000) : 0,\n      idleSec",
    "      continuousFocusSec: this.focusSince ? Math.round((ts - this.focusSince) / 1000) : 0,\n      idleSec,\n      planTitle: this.lastPlanTitle,\n      projectName: this.lastProjectName")
print('context label done')
