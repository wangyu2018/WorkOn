/**
 * 项目状态卡（v7 项目循环的枢纽载体）
 * - build：Project + 今日计划 + 归属时长 + 目录活动 → 结构化 markdown（可粘贴给任何 AI 工具）
 * - parse：解析粘回来的状态卡/自由进展 → diff 预览（完成/新增/未知）→ 确认后落 PlanItem
 */
import { col, insertInto, updateIn } from './db'
import { getAttribution } from './attributions'
import { getTodayActivity } from './dirWatcher'
import { dateKey } from '@shared/trail'
import { genId } from '@shared/types'
import type { PlanItem, Project } from '@shared/types'

export interface StatusCard {
  markdown: string
  projectId: string
  projectName: string
  generatedAt: number
}

export function buildStatusCard(projectId: string): StatusCard {
  const project = col<Project>('projects').find((p) => p.id === projectId)
  const name = project?.name ?? '未命名项目'
  const today = dateKey(Date.now())
  const plans = col<PlanItem>('plans').filter((p) => p.projectId === projectId || p.date === today)
  const done = plans.filter((p) => p.status === 'done')
  const doing = plans.filter((p) => p.status === 'in_progress' || p.status === 'partial')
  const todo = plans.filter((p) => p.status === 'planned')
  const attr = getAttribution()
  const dir = getTodayActivity(projectId)

  const fmtMin = (m: number): string => (m >= 60 ? `${Math.floor(m / 60)}h${m % 60}m` : `${Math.round(m)}m`)

  const md = [
    `# 🔄 项目循环 · ${name} · ${today}`,
    '',
    '## 🎯 目标与预期',
    `- 一句话：${(project as unknown as { goal?: string })?.goal ?? '（待补充：这个项目做成什么样算成功？）'}`,
    '',
    '## 📍 当前进展',
    `- ✅ 已完成：${done.length ? done.map((p) => p.title).join('、') : '（暂无）'}`,
    `- 🔥 进行中：${doing.length ? doing.map((p) => p.title).join('、') : attr.taskTitle || '（暂无）'}`,
    dir.changedFiles > 0
      ? `- 📁 实测信号：今日目录变更 ${dir.changedFiles} 个文件${dir.hotspot ? `（热点：${dir.hotspot}/）` : ''}，最近一次 ${new Date(dir.lastChangeTs).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`
      : '',
    attr.projectId === projectId ? `- ⏱ 归属时长：当前颗粒「${attr.taskTitle || name}」已持续 ${fmtMin(attr.sec)}` : '',
    '',
    '## 🔮 下一步（待办）',
    ...(todo.length ? todo.map((p) => `- [ ] ${p.title}`) : ['- [ ] （待补充）']),
    '',
    '## ⚠️ 风险',
    '- （待补充）',
    '',
    '## 📎 给 AI 的指令',
    '基于此卡：1) 校准剩余计划 2) 给出今天最重要 3 件事 3) 指出新风险'
  ]
    .filter((l) => l !== '')
    .join('\n')

  return { markdown: md, projectId, projectName: name, generatedAt: Date.now() }
}

// ───────────────────────── 导入解析 ─────────────────────────

export interface CardDiff {
  /** 勾选完成的既有待办（标题匹配） */
  completed: string[]
  /** 卡里有但系统没有的新待办 */
  added: string[]
  /** 系统有但卡里未提及的进行中项（提示可能完成） */
  untouched: string[]
}

const CHECK_DONE = /^\s*[-*]\s*\[x\]\s*(.+)$/i
const CHECK_TODO = /^\s*[-*]\s*\[\s?\]\s*(.+)$/i

export function parseStatusCard(markdown: string): CardDiff {
  const today = dateKey(Date.now())
  const lines = markdown.split(/\r?\n/)
  const doneLines: string[] = []
  const todoLines: string[] = []
  for (const line of lines) {
    const mDone = line.match(CHECK_DONE)
    const mTodo = line.match(CHECK_TODO)
    if (mDone) doneLines.push(mDone[1].trim())
    else if (mTodo) todoLines.push(mTodo[1].trim())
  }
  const plans = col<PlanItem>('plans').filter((p) => p.date === today)
  const matchPlan = (title: string): PlanItem | undefined =>
    plans.find((p) => p.title === title || p.title.includes(title) || title.includes(p.title))

  const completed: string[] = []
  for (const t of doneLines) {
    const p = matchPlan(t)
    if (p && p.status !== 'done') completed.push(p.title)
    else if (!p) completed.push(t) // 新出现且已勾选 → 视为新增并完成
  }
  const added: string[] = []
  const known = new Set([...doneLines, ...completed])
  for (const t of todoLines) {
    const p = matchPlan(t)
    if (!p && !known.has(t)) added.push(t)
  }
  const untouched = plans
    .filter((p) => (p.status === 'in_progress' || p.status === 'partial') && !doneLines.some((d) => matchPlan(d)?.id === p.id) && !todoLines.some((d) => matchPlan(d)?.id === p.id))
    .map((p) => p.title)
  return { completed, added, untouched }
}

/** 应用 diff：勾选完成 + 插入新待办 */
export function applyCardDiff(diff: CardDiff): { completed: number; added: number } {
  const today = dateKey(Date.now())
  let completed = 0
  for (const title of diff.completed) {
    const plans = col<PlanItem>('plans').filter((p) => p.date === today)
    const p = plans.find((x) => x.title === title || x.title.includes(title) || title.includes(x.title))
    if (p && p.status !== 'done') {
      updateIn<PlanItem>('plans', p.id, { status: 'done' })
      completed++
    }
  }
  let added = 0
  for (const title of diff.added) {
    insertInto<PlanItem>('plans', {
      id: genId('pl'),
      date: today,
      title,
      category: 'other',
      planType: 'task',
      status: 'planned',
      source: 'manual',
      ts: Date.now()
    } as unknown as PlanItem)
    added++
  }
  return { completed, added }
}
