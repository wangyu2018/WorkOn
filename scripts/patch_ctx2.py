# -*- coding: utf-8 -*-
"""ctx 标签收尾：Project 导入 + helpers + push 透传"""
import io

p = 'src/main/monitor.ts'
t = io.open(p, encoding='utf-8', newline='').read()
eol = '\r\n' if '\r\n' in t else '\n'

def rep(old, new, count=1):
    global t
    o = old.replace('\n', eol)
    n = new.replace('\n', eol)
    c = t.count(o)
    assert c == count, 'x' + str(c) + ': ' + old[:70]
    t = t.replace(o, n)
    print('OK |', old.strip().splitlines()[0][:44])

# 1) types 导入补 Project
rep(p,
    "import type { CorrectionRule, PlanItem, ProjectTimeLink, SegmentPlanLink, WorkState } from '@shared/types'",
    "import type { CorrectionRule, PlanItem, Project, ProjectTimeLink, SegmentPlanLink, WorkState } from '@shared/types'")

# 2) helpers 插到 tick 前
rep(p,
    "async function tick(): Promise<void> {",
    """/** 当前段关联的计划标题（拖拽归类/会话确认产生的关联） */
function currentPlanTitle(segStartTs: number): string | null {
  const links = col<SegmentPlanLink>('segmentPlans').filter((l) => l.segStartTs === segStartTs)
  if (!links.length) return null
  const planId = links[links.length - 1].planId
  return col<PlanItem>('plans').find((pl) => pl.id === planId)?.title ?? null
}

/** 当前应用归属的项目名（projectTimeLinks 最近一条） */
function currentProjectName(app: string): string | null {
  const links = col<ProjectTimeLink>('projectTimeLinks').filter((l) => l.app === app.toLowerCase())
  if (!links.length) return null
  const last = links.reduce((a, b) => (b.ts > a.ts ? b : a))
  return col<Project>('projects').find((x) => x.id === last.projectId)?.name ?? null
}

async function tick(): Promise<void> {""")

# 3) 主屏 presence.push 带上语义标签
rep(p,
    'presence.push({ ts, app: rec.app, title: rec.title, appName: rec.appName, state: rec.state, screen: fg.screen, active: true, idleSec, winRect })',
    'presence.push({ ts, app: rec.app, title: rec.title, appName: rec.appName, state: rec.state, planTitle, projectName, screen: fg.screen, active: true, idleSec, winRect })')

io.open(p, 'w', encoding='utf-8', newline='').write(t)
print('monitor ctx done')
