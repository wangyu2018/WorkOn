/**
 * 项目状态卡（v7 项目循环的枢纽载体）
 * - build：导出给 Cursor / IDE / 其它 AI 工具的提示词+进展卡
 * - summarize：粘贴回传（任意格式）→ AI/规则 整理待办与进度
 * - apply：确认后落 PlanItem + ProjectTask + 项目「最近进展」
 */
import { col, insertInto, updateIn, removeFrom } from './db'
import { resolveTerm, type TermKey } from '@shared/dictionary'
import { getAttribution } from './attributions'
import { getTodayActivity } from './dirWatcher'
import { dateKey } from '@shared/trail'
import { genId } from '@shared/types'
import { llmChat, extractJson } from './ai'
import { getSettings } from './settings'
import { createTasksBulk, listTasks } from './projects'
import type { PlanItem, Project, ProjectTask } from '@shared/types'

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
  const tasks = listTasks(projectId)
  const taskIds = new Set(tasks.map((t) => t.id))

  /** 兴趣/生活不进开发反哺；其它项必须显式挂本项目（禁止标题模糊带入） */
  const isLifeOrInterest = (p: PlanItem): boolean =>
    p.category === 'personal' || p.category === 'interest'

  const belongs = (p: PlanItem): boolean => {
    if (p.archived || isLifeOrInterest(p)) return false
    if (p.projectId === projectId) return true
    if (p.linkedProjectId === projectId) return true
    if (p.projectTaskId && taskIds.has(p.projectTaskId)) return true
    return false
  }

  const related = col<PlanItem>('plans')
    .filter((p) => belongs(p))
    .filter((p) => !isJunkFeedbackTitle(p.title || ''))
  const todayPlans = related.filter((p) => p.date === today && p.status !== 'cancelled')
  const todayDone = todayPlans.filter((p) => p.status === 'done')
  const todayOpen = todayPlans.filter((p) => p.status !== 'done')
  // 跨日未完成（未完成树里挂在本项目下的）
  const backlog = related.filter(
    (p) => p.date !== today && p.status !== 'done' && p.status !== 'cancelled'
  )
  const taskDone = tasks.filter((t) => t.status === 'done')
  const taskOpen = tasks.filter((t) => t.status !== 'done')
  const deferredExisting = String(project?.attrs?.['未实现'] ?? '')
    .split(/\n/)
    .map((l) => l.replace(/^[·\-*\d.\s]+/, '').trim())
    .filter(Boolean)
    .filter((t) => !isJunkFeedbackTitle(t))
    .slice(0, 16)
  const attr = getAttribution()
  const dir = getTodayActivity(projectId)
  const recent = String(project?.attrs?.['最近进展'] ?? '')
    .split(/\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 12)
    .join('\n')

  const dom = project?.domain
  const t = (k: TermKey): string => resolveTerm(dom, k)
  const fmtMin = (m: number): string => (m >= 60 ? `${Math.floor(m / 60)}h${m % 60}m` : `${Math.round(m)}m`)
  const checkLine = (title: string, done: boolean, tag?: string): string =>
    `- [${done ? 'x' : ' '}] ${title}${tag ? ` ${tag}` : ''}`

  const md = [
    `# WorkOn 反哺卡 · ${name} · ${today}`,
    '',
    '> 用途：贴进 Cursor / IDE / 其它开发 AI。对方按固定格式回复后，把全文贴回 WorkOn（Ctrl+V 或「粘贴回传」），会写入「最近进展」+「今日粗目标」+「未实现」+ 项目任务。',
    '> 粒度：只要「今天达成什么目的 / 优化了哪些方面」，不要细到改某个文件某行。',
    '> 重要：下方「已有清单」必须带着走——完成的勾上，未完成的原样保留，禁止清空后只写新目标。',
    '',
    `## ${t('project')}上下文（只读）`,
    `- ${t('goal')}：${project?.goal?.trim() || '（待补充）'}`,
    recent ? `- 最近进展（WorkOn）：\n${recent.split('\n').map((l) => `  ${l}`).join('\n')}` : '- 最近进展：（暂无）',
    `- 今日已完成：${todayDone.length ? todayDone.map((p) => p.title).join('、') : '（无）'}`,
    `- 今日进行中：${
      todayOpen.filter((p) => p.status === 'in_progress' || p.status === 'partial').length
        ? todayOpen
            .filter((p) => p.status === 'in_progress' || p.status === 'partial')
            .map((p) => p.title)
            .join('、')
        : attr.projectId === projectId
          ? attr.taskTitle || '（无）'
          : '（无）'
    }`,
    `- 今日待做：${
      todayOpen.filter((p) => p.status === 'planned').length
        ? todayOpen
            .filter((p) => p.status === 'planned')
            .map((p) => p.title)
            .join('、')
        : '（无）'
    }`,
    `- 跨日未完成：${backlog.length ? backlog.slice(0, 12).map((p) => p.title).join('、') : '（无）'}`,
    `- ${t('projectTask')}：开放 ${taskOpen.length} / 合计 ${tasks.length || 0}`,
    deferredExisting.length ? `- 未实现（已记）：${deferredExisting.slice(0, 8).join('、')}` : '',
    dir.changedFiles > 0
      ? `- 目录信号：今日变更 ${dir.changedFiles} 个文件${dir.hotspot ? `（热点：${dir.hotspot}/）` : ''}`
      : '',
    attr.projectId === projectId ? `- 归属时长：当前「${attr.taskTitle || name}」已持续 ${fmtMin(attr.sec / 60)}` : '',
    '',
    '## 已有清单（请更新勾选；未完成项必须保留）',
    `### ${t('todayTodo')}`,
    ...(todayOpen.length
      ? todayOpen.slice(0, 24).map((p) =>
          checkLine(
            p.title,
            false,
            p.status === 'in_progress' || p.status === 'partial' ? '（进行中）' : undefined
          )
        )
      : ['- [ ] （暂无今日待办）']),
    ...(todayDone.length ? todayDone.slice(0, 10).map((p) => checkLine(p.title, true)) : []),
    '',
    '### 跨日未完成',
    ...(backlog.length
      ? backlog.slice(0, 20).map((p) => checkLine(`${p.title} · ${p.date}`, false))
      : ['- [ ] （无）']),
    '',
    `### ${t('projectTask')}`,
    ...(taskOpen.length
      ? taskOpen.slice(0, 30).map((t) =>
          checkLine(t.title, false, t.status === 'in_progress' ? '（进行中）' : undefined)
        )
      : ['- [ ] （暂无开放任务）']),
    ...(taskDone.length ? taskDone.slice(0, 8).map((t) => checkLine(t.title, true)) : []),
    '',
    '### 未实现（已有，请续写/勾掉）',
    ...(deferredExisting.length
      ? deferredExisting.map((t) => checkLine(t, false))
      : ['- [ ] （暂无）']),
    '',
    '---',
    '',
    '## 给开发 AI 的指令（请严格按下面格式回复）',
    '',
    `你是「${name}」的结对开发助手。用户在做机动/迭代开发。请用**粗粒度**回复：目的与优化面，不要写文件级细步骤。`,
    '用 markdown 按下列标题回复（不要省略标题；不要输出对比大表/长背景）：',
    '',
    '### 1. 本会话进展',
    '- 用短条列出：今天达成了什么目的、优化/改动了哪些方面（可带模块名，不要堆文件路径清单）',
    '- 若有卡点/待确认，单独写 `卡点：…`',
    '',
    '### 2. 勾选更新（必须基于上方已有清单）',
    '- 把上方已完成的项改为 `- [x] …`（标题尽量原样）',
    '- 仍待做的已有项保持 `- [ ] …`，**禁止删掉未完成的已有待办/任务/未实现**',
    '- 不要只输出新目标而丢掉已有清单',
    '',
    '### 3. 今日目标（粗）',
    '- 在已有未完成项之外，如需补充，给出 2～5 条**今天要达成的目的或优化面**（不是细步骤）',
    '- 格式：`- [ ] 今日目的：…` 或 `- [ ] 优化：…`',
    '- 示例：`- [ ] 今日目的：待办窗玻璃观感可读且无直角高透框`',
    '',
    '### 4. 未实现（必填，禁止省略）',
    '- 先保留上方「未实现」里仍未落地的项',
    '- 再把本会话总结/方案里提到但**没做完、没落地**的点全部追加',
    '- 格式：`- [ ] …`；没有则写 `- [ ] （无）`',
    '',
    '### 5. 项目任务（可选）',
    '- 仅跨天/子系统级跟踪时追加：`- [ ] …`；已有项目任务同上规则：完成勾选、未完成保留',
    '',
    '### 6. 一句话摘要',
    '- 最后一行：`摘要：…`（≤40 字：做到哪 + 未实现要点 + 下一步粗目标）',
    '',
    '回复时不要删项目名；整段可直接贴回 WorkOn。'
  ]
    .filter((l) => l !== '')
    .join('\n')

  return { markdown: md, projectId, projectName: name, generatedAt: Date.now() }
}

// ───────────────────────── 导入解析 ─────────────────────────

export interface CardDiff {
  projectId?: string
  /** 勾选完成的今日待办（标题） */
  completed: string[]
  /** 新增今日待办（粗目标：今日目的/优化面） */
  added: string[]
  /** 系统有但未提及的进行中项 */
  untouched: string[]
  /** 标记完成的项目任务标题 */
  completedTasks: string[]
  /** 新增项目任务标题 */
  addedTasks: string[]
  /** 文中写明但今日未做完/未实现的项（禁止丢弃） */
  deferred: string[]
  /** 进展小结（写入项目属性「最近进展」） */
  progressNote: string
  /** AI 整理的一句话进度摘要（展示用） */
  summary?: string
}

const CHECK_DONE = /^\s*[-*]\s*\[x\]\s*(.+)$/i
const CHECK_TODO = /^\s*[-*]\s*\[\s?\]\s*(.+)$/i

function normalizeTitle(t: string): string {
  return t.replace(/\s*（进行中）\s*$/u, '').trim()
}

/** 反哺卡章节标题被误当成待办的垃圾项 */
function isJunkFeedbackTitle(t: string): boolean {
  const s = normalizeTitle(t).replace(/[（(].*[）)]\s*$/u, '').trim()
  return /^(勾选更新|今日目标|项目任务|一句话摘要|本会话进展|可选项|未实现|未完成|给开发\s*AI|项目上下文|已有清单|下一步计划)$/i.test(s)
}

/** 从长文抽细粒度进展条：现状 + 本会话改动点 + 卡点/下一步（仍避开对比表全文） */
function extractShortProgressNote(markdown: string, maxLen = 420): string {
  const text = markdown.replace(/\r/g, '').trim()
  if (!text) return ''
  const lines = text.split(/\n/).map((l) => l.trim()).filter(Boolean)
  const parts: string[] = []

  const statusLine = lines.find((l) => /^(现状|当前进展|最近进展)[:：]/.test(l.replace(/^#+\s*/, '')))
    || lines.find((l) => /现状是|当前主要|两套构建/.test(l))
  if (statusLine) {
    const s = statusLine.replace(/^#+\s*/, '').replace(/^(现状|当前进展|最近进展)[:：]\s*/, '').replace(/\s+/g, ' ')
    if (s.length >= 8) parts.push(`现状：${s.slice(0, 120)}`)
  }

  const sessionIdx = lines.findIndex((l) => /本会话|本次改动|本次进展|改动[:：]/.test(l.replace(/^#+\s*/, '')))
  if (sessionIdx >= 0) {
    const bullets: string[] = []
    // 同行里的 ①②③
    const same = lines[sessionIdx].replace(/^.*?[：:]\s*/, '')
    for (const m of same.matchAll(/[①②③④⑤⑥⑦⑧⑨⑩]\s*([^①②③④⑤⑥⑦⑧⑨⑩]+)/g)) {
      const t = m[1].replace(/[；;。]\s*$/, '').trim()
      if (t.length >= 4) bullets.push(t.slice(0, 56))
    }
    for (let i = sessionIdx + 1; i < Math.min(lines.length, sessionIdx + 14) && bullets.length < 6; i++) {
      const l = lines[i]
      if (/^[|｜]/.test(l) || /^(二、|三、|四、|【|维度)/.test(l)) break
      const m =
        l.match(/^[①②③④⑤⑥⑦⑧⑨⑩]\s*(.+)$/) ||
        l.match(/^\d+[.)、]\s*(.+)$/) ||
        l.match(/^[-*]\s+(?!\[[ xX]?\])(.+)$/i)
      if (!m) continue
      const t = m[1].replace(/\s+/g, ' ').trim()
      if (t.length >= 4) bullets.push(t.slice(0, 56))
    }
    if (bullets.length) {
      parts.push('已做：')
      for (const b of bullets.slice(0, 6)) parts.push(`· ${b}`)
    }
  }

  const blockLine = lines.find((l) => /^(卡点|阻塞|风险|待确认)[:：]/.test(l) || /卡在|阻塞于/.test(l))
  if (blockLine) {
    const s = blockLine.replace(/^#+\s*/, '').replace(/^(卡点|阻塞|风险|待确认)[:：]\s*/, '').replace(/\s+/g, ' ')
    if (s.length >= 4) parts.push(`卡点：${s.slice(0, 80)}`)
  }

  const must: string[] = []
  for (const l of lines) {
    const m = l.match(/^【(必须|推荐)】\s*(.+)$/)
    if (!m) continue
    let t = m[2].replace(/\s+/g, ' ').trim()
    if (t.length > 48) t = t.slice(0, 48).replace(/[，,、].*$/, '').trim()
    if (t.length >= 4) must.push(t)
    if (must.length >= 4) break
  }
  if (must.length) {
    parts.push('下一步：')
    for (const t of must) parts.push(`· ${t}`)
  }

  let out = parts.join('\n').trim()
  if (!out) {
    // 兜底：非表格短段
    const blocks = text.split(/\n{2,}/).map((b) => b.trim()).filter((b) => b && !/^\|/.test(b))
    const prefer = blocks.find((b) =>
      /^(一、)?项目进展|现状|本会话|结论|小结|当前进展|最近进展/i.test(b.replace(/^#+\s*/, ''))
    ) || blocks[0] || ''
    out = prefer.replace(/^#+\s*/gm, '').replace(/\|.+\|/g, ' ').replace(/\s+/g, ' ').trim()
  }
  if (out.length <= maxLen) return out
  const cut = out.slice(0, maxLen)
  const sp = Math.max(cut.lastIndexOf('\n'), cut.lastIndexOf('。'), cut.lastIndexOf('；'))
  return (sp > 60 ? cut.slice(0, sp + (cut[sp] === '\n' ? 0 : 1)) : cut).trim()
}

/** 从优先级列表粗拆细待办（无 AI 兜底） */
function extractActionTodosHeuristic(markdown: string, limit = 14): string[] {
  const out: string[] = []
  for (const line of markdown.split(/\n/)) {
    const t = line.trim()
    // 【必须】xxx / 1. xxx / - xxx / ① xxx（非纯表格）
    let m =
      t.match(/^【[^】]+】\s*(.+)$/) ||
      t.match(/^[①②③④⑤⑥⑦⑧⑨⑩]\s*(.+)$/) ||
      t.match(/^\d+[.)、]\s*(.+)$/) ||
      t.match(/^[-*]\s+(?!\[[ xX]?\])(.+)$/i)
    if (!m) continue
    let title = m[1]
      .replace(/（[^）]*）/g, '')
      .replace(/\([^)]*\)/g, '')
      .replace(/：.+$/, (s) => (s.length > 12 ? s : ''))
      .replace(/^把/, '')
      .trim()
    // 过长则截到动词短语
    if (title.length > 48) title = title.slice(0, 48).replace(/[，,、].*$/, '').trim()
    if (title.length < 4 || title.length > 60) continue
    if (/^维度|主程序|小程序|注意|建议先做/.test(title)) continue
    out.push(title)
    if (out.length >= limit) break
  }
  return [...new Set(out)]
}

/** 从「下一步计划 / 今日待办 / 今日目标」等标题段抽取 checklist，优先作新增今日计划 */
function extractNextPlanSection(markdown: string, limit = 8): string[] {
  const lines = markdown.replace(/\r/g, '').split('\n')
  const out: string[] = []
  let inSec = false
  for (const raw of lines) {
    const t = raw.trim()
    if (!t) continue
    const heading = t.replace(/^#+\s*/, '').replace(/^\d+[.)、]\s*/, '')
    if (/^(本会话进展|勾选更新|项目任务|未实现|未完成|一句话摘要|摘要[:：]|给开发|项目上下文)/i.test(heading)) {
      inSec = false
      continue
    }
    if (/下一步计划|今日待办|今日目标|下一步|马上动手|接下来/.test(heading) && (t.startsWith('#') || /^(###?\s*)?\d+\./.test(t) || /^[三四]、/.test(t))) {
      inSec = true
      continue
    }
    if (!inSec) continue
    if (/^#{1,4}\s+/.test(t)) {
      inSec = /下一步计划|今日待办|今日目标|下一步/.test(heading)
      continue
    }
    const m = t.match(CHECK_TODO) || t.match(/^[-*]\s+(?!\[[xX]\])(?!\[[ ]?\])(.+)$/i) || t.match(/^[①②③④⑤⑥⑦⑧⑨⑩]\s*(.+)$/)
    if (!m) continue
    let title = normalizeTitle(m[1] || '')
    if (title.length > 48) title = title.slice(0, 48).replace(/[，,、].*$/, '').trim()
    if (title.length < 4 || /暂无|请在|可选|（无）/.test(title)) continue
    out.push(title)
    if (out.length >= limit) break
  }
  return [...new Set(out)]
}

/** 抽取「未实现 / 未完成 / 待落地」段，避免总结时丢掉 */
function extractDeferredSection(markdown: string, limit = 12): string[] {
  const lines = markdown.replace(/\r/g, '').split('\n')
  const out: string[] = []
  let inSec = false
  for (const raw of lines) {
    const t = raw.trim()
    if (!t) continue
    const heading = t.replace(/^#+\s*/, '').replace(/^\d+[.)、]\s*/, '')
    if (/^(本会话进展|勾选更新|今日目标|下一步计划|今日待办|项目任务|一句话摘要|摘要[:：])/i.test(heading) && !/未实现|未完成|未落地|待实现/.test(heading)) {
      inSec = false
      continue
    }
    if (/未实现|未完成|未落地|待实现|没做完|尚未实现/.test(heading) && (t.startsWith('#') || /^(###?\s*)?\d+\./.test(t) || /^[四五]、/.test(t) || /[:：]\s*$/.test(t))) {
      inSec = true
      continue
    }
    // 单行：未实现：a；b；c
    const inline = t.match(/^(?:未实现|未完成|未落地|待实现)[:：]\s*(.+)$/)
    if (inline) {
      for (const part of inline[1].split(/[；;、]/)) {
        const title = normalizeTitle(part)
        if (title.length >= 4 && title.length <= 60 && !/（无）|暂无/.test(title)) out.push(title.slice(0, 48))
      }
      continue
    }
    if (!inSec) continue
    if (/^#{1,4}\s+/.test(t)) {
      inSec = /未实现|未完成|未落地|待实现/.test(heading)
      continue
    }
    const m = t.match(CHECK_TODO) || t.match(CHECK_DONE) || t.match(/^[-*]\s+(?!\[[xX]\])(.+)$/i) || t.match(/^[①②③④⑤⑥⑦⑧⑨⑩]\s*(.+)$/) || t.match(/^\d+[.)、]\s*(.+)$/)
    if (!m) continue
    let title = normalizeTitle(m[1] || '')
    if (title.length > 48) title = title.slice(0, 48).replace(/[，,、].*$/, '').trim()
    if (title.length < 4 || /（无）|暂无|无$/.test(title)) continue
    out.push(title)
    if (out.length >= limit) break
  }
  return [...new Set(out)]
}

function matchByTitle<T extends { title: string; id: string }>(list: T[], title: string): T | undefined {
  const t = normalizeTitle(title)
  return list.find((p) => p.title === t || p.title.includes(t) || t.includes(p.title))
}

/** 规则解析（无 AI / AI 失败时兜底） */
export function parseStatusCard(markdown: string, projectId?: string): CardDiff {
  const today = dateKey(Date.now())
  const lines = markdown.split(/\r?\n/)
  const doneLines: string[] = []
  const todoLines: string[] = []
  for (const line of lines) {
    const mDone = line.match(CHECK_DONE)
    const mTodo = line.match(CHECK_TODO)
    if (mDone) doneLines.push(normalizeTitle(mDone[1]))
    else if (mTodo) todoLines.push(normalizeTitle(mTodo[1]))
  }

  const tasks = projectId ? listTasks(projectId) : []
  const taskIds = new Set(tasks.map((t) => t.id))
  const plans = col<PlanItem>('plans').filter((p) => {
    if (p.archived || p.status === 'cancelled') return false
    if (p.category === 'personal' || p.category === 'interest') return false
    if (!projectId) return p.date === today
    if (p.projectId === projectId) return true
    if (p.linkedProjectId === projectId) return true
    if (p.projectTaskId && taskIds.has(p.projectTaskId)) return true
    return false
  })

  const completed: string[] = []
  const completedTasks: string[] = []
  for (const t of doneLines) {
    const p = matchByTitle(plans, t)
    if (p && p.status !== 'done') completed.push(p.title)
    const task = matchByTitle(tasks, t)
    if (task && task.status !== 'done') completedTasks.push(task.title)
    if (!p && !task) completed.push(t)
  }

  const added: string[] = []
  const known = new Set([...doneLines, ...completed.map(normalizeTitle)])
  // 优先：明确「下一步计划」段
  for (const t of extractNextPlanSection(markdown)) {
    if (isJunkFeedbackTitle(t) || known.has(t) || matchByTitle(plans, t) || matchByTitle(tasks, t)) continue
    added.push(t)
    known.add(t)
  }
  for (const t of todoLines) {
    if (isJunkFeedbackTitle(t) || known.has(t)) continue
    const p = matchByTitle(plans, t)
    const task = matchByTitle(tasks, t)
    if (!p && !task) {
      added.push(t)
      known.add(t)
    }
  }
  // 仍无计划时，从「必须/推荐」等优先级条粗拆
  if (added.length === 0) {
    for (const t of extractActionTodosHeuristic(markdown)) {
      if (isJunkFeedbackTitle(t)) continue
      if (!known.has(t) && !matchByTitle(plans, t) && !matchByTitle(tasks, t)) added.push(t)
    }
  }
  const addedTasks: string[] = []
  const deferred = extractDeferredSection(markdown)

  const untouched = plans
    .filter((p) =>
      (p.status === 'in_progress' || p.status === 'partial') &&
      !doneLines.some((d) => matchByTitle(plans, d)?.id === p.id) &&
      !todoLines.some((d) => matchByTitle(plans, d)?.id === p.id)
    )
    .map((p) => p.title)

  let progressNote = extractShortProgressNote(markdown, 420)
  if (deferred.length) {
    const block = ['未实现：', ...deferred.slice(0, 8).map((t) => `· ${t}`)].join('\n')
    progressNote = progressNote ? `${progressNote}\n${block}`.slice(0, 800) : block
  }
  const summary = progressNote
    ? progressNote.split(/\n/).map((l) => l.replace(/^[·\-]\s*/, '').trim()).find((l) => l.length >= 6)?.slice(0, 72)
    : undefined

  // 未实现项不要进「今日新增」重复；从 added 剔除
  const deferredSet = new Set(deferred.map(normalizeTitle))
  const addedClean = [...new Set(added)].filter((t) => !deferredSet.has(normalizeTitle(t))).slice(0, 8)

  return {
    projectId,
    completed: [...new Set(completed)],
    added: addedClean,
    untouched,
    completedTasks: [...new Set(completedTasks)],
    addedTasks: [...new Set(addedTasks)],
    deferred,
    progressNote,
    summary
  }
}

/** AI 整理粘贴回传：粗粒度进展 + 今日目标 + 未实现（不丢） */
export async function summarizeProgressPaste(projectId: string, text: string): Promise<CardDiff> {
  const fallback = parseStatusCard(text, projectId)
  const s = getSettings()
  if (!s.aiEnabled || !s.aiApiKey || !text.trim()) return fallback

  const project = col<Project>('projects').find((p) => p.id === projectId)
  const tasks = listTasks(projectId)
  const taskIds = new Set(tasks.map((t) => t.id))
  /** 与 buildStatusCard 一致：只带本项目显式挂靠项，兴趣/生活不进上下文 */
  const plans = col<PlanItem>('plans').filter((p) => {
    if (p.archived || p.status === 'cancelled') return false
    if (p.category === 'personal' || p.category === 'interest') return false
    if (isJunkFeedbackTitle(p.title || '')) return false
    if (p.projectId === projectId) return true
    if (p.linkedProjectId === projectId) return true
    if (p.projectTaskId && taskIds.has(p.projectTaskId)) return true
    return false
  })
  const deferredExisting = String(project?.attrs?.['未实现'] ?? '')
    .split(/\n/)
    .map((l) => l.replace(/^[·\-*\d.\s]+/, '').trim())
    .filter(Boolean)
    .filter((t) => !isJunkFeedbackTitle(t))
    .slice(0, 16)

  const prompt = [
    `你是 WorkOn 的项目进度整理助手。用户粘贴的是工作总结/开发复盘（可能很长）。请用**粗粒度**提取，并**绝不丢掉未实现项与已有未完成待办**。`,
    ``,
    `目标项目（WorkOn）：${project?.name ?? projectId}`,
    `项目目标：${project?.goal?.trim() || '（未填）'}`,
    `本项目已有待办（不含兴趣/生活）：${JSON.stringify(
      plans
        .map((p) => ({ title: p.title, status: p.status, date: p.date, projectId: p.projectId ?? null }))
        .slice(0, 40)
    )}`,
    `项目任务：${JSON.stringify(tasks.map((t) => ({ title: t.title, status: t.status })).slice(0, 40))}`,
    `已有未实现：${JSON.stringify(deferredExisting)}`,
    ``,
    `用户粘贴：`,
    text.slice(0, 9000),
    ``,
    `只输出一个 JSON 对象（不要代码块包裹，不要解释），字段：`,
    `{`,
    `  "summary": "一句话（<=48字）：做到哪了 + 未实现要点 + 下一步粗目标",`,
    `  "progressNote": "多行（\\n 分隔，<=400字）：今日目的达成/优化了哪些方面/卡点；可含「未实现：」段",`,
    `  "completed": ["应勾完成的今日待办标题，优先复用已有标题"],`,
    `  "added": ["今日粗目标 2~5 条：今日目的：… 或 优化：…；不要文件级细步骤；不要重复已有未完成项"],`,
    `  "deferred": ["文中提到但未做完/未落地/未实现的项 + 上方已有未实现里仍未落地的，全部列出，禁止省略；每条<=40字"],`,
    `  "completedTasks": ["应勾完成的项目任务标题"],`,
    `  "addedTasks": ["跨天粗任务，每条<=40字"]`,
    `}`,
    ``,
    `硬性规则：`,
    `1) 粒度要粗：像「优化待办窗玻璃观感」而不是「改 windows.ts 第 80 行」。`,
    `2) deferred 是重点：凡总结里写了「未实现/未完成/待做/下次/暂未」的点必须进 deferred；已有未实现未落地的也要保留；不得因篇幅省略。`,
    `3) deferred 与 added 不要重复；今日马上要做的进 added，明确没做完的进 deferred。`,
    `4) progressNote 写已发生进展；若有未实现，在末尾加「未实现：」并列点。`,
    `5) added 最多 5 条，deferred 最多 12 条，addedTasks 最多 6 条。`,
    `6) 没有明确完成证据时，不要乱填 completed / completedTasks。`,
    `7) 已有未完成待办/任务不要因为本次总结没提到就当成完成或丢弃。`
  ].join('\n')

  try {
    const raw = await llmChat([{ role: 'user', content: prompt }], 60000, 'standard')
    const parsed = raw ? extractJson<{
      progressNote?: string
      summary?: string
      completed?: string[]
      added?: string[]
      deferred?: string[]
      completedTasks?: string[]
      addedTasks?: string[]
    }>(raw) : null
    if (!parsed) return fallback

    const uniq = (arr?: string[], max = 12): string[] =>
      [...new Set((arr ?? []).map((x) => normalizeTitle(String(x || ''))).filter(Boolean))]
        .map((t) => (t.length > 48 ? t.slice(0, 48) : t))
        .slice(0, max)

    const deferred = uniq(parsed.deferred?.length ? parsed.deferred : fallback.deferred, 12)
    let progressNote = String(parsed.progressNote || fallback.progressNote || '')
      .replace(/\r/g, '')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
      .slice(0, 480)
    if (deferred.length && !/未实现/.test(progressNote)) {
      progressNote = `${progressNote}${progressNote ? '\n' : ''}未实现：\n${deferred.map((t) => `· ${t}`).join('\n')}`.slice(0, 800)
    }
    const summary = String(parsed.summary || '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 56)
      || (progressNote.split(/\n/).map((l) => l.replace(/^[·\-]\s*/, '').trim()).find((l) => l.length >= 6)?.slice(0, 56) ?? '')

    const deferredSet = new Set(deferred.map(normalizeTitle))
    const added = uniq(parsed.added, 5)
      .filter((t) => !deferredSet.has(normalizeTitle(t)))
      .filter((t) => !isJunkFeedbackTitle(t))

    return {
      projectId,
      completed: uniq(parsed.completed, 12),
      added,
      untouched: fallback.untouched,
      completedTasks: uniq(parsed.completedTasks, 10),
      addedTasks: uniq(parsed.addedTasks, 6),
      deferred,
      progressNote: progressNote || fallback.progressNote,
      summary: summary || fallback.summary
    }
  } catch (e) {
    console.warn('[statusCard] summarize failed:', (e as Error).message)
    return fallback
  }
}

/** 应用 diff：今日待办 + 项目任务 + 最近进展 */
export function applyCardDiff(diff: CardDiff): {
  completed: number
  added: number
  completedTasks: number
  addedTasks: number
  deferred: number
  progressUpdated: boolean
} {
  const today = dateKey(Date.now())
  const projectId = diff.projectId
  let completed = 0
  let added = 0
  let completedTasks = 0
  let addedTasks = 0
  let deferred = 0

  const tasksForPool = projectId ? listTasks(projectId) : []
  const taskIdsForPool = new Set(tasksForPool.map((t) => t.id))
  const planPool = (): PlanItem[] =>
    col<PlanItem>('plans').filter((p) => {
      if (p.archived || p.status === 'cancelled') return false
      if (p.category === 'personal' || p.category === 'interest') return false
      if (!projectId) return p.date === today
      if (p.projectId === projectId) return true
      if (p.linkedProjectId === projectId) return true
      if (p.projectTaskId && taskIdsForPool.has(p.projectTaskId)) return true
      return false
    })

  for (const title of diff.completed ?? []) {
    const p = matchByTitle(planPool(), title)
    if (p && p.status !== 'done') {
      updateIn<PlanItem>('plans', p.id, { status: 'done' })
      completed++
    } else if (!p && projectId) {
      // 卡里勾了完成但系统没有 → 记一条已完成待办
      insertInto<PlanItem>('plans', {
        id: genId('pl'),
        date: today,
        title: normalizeTitle(title),
        category: 'other',
        planType: 'task',
        status: 'done',
        source: 'import',
        projectId,
        note: '来自进展回传',
        ts: Date.now()
      } as unknown as PlanItem)
      completed++
    }
  }

  for (const title of diff.added ?? []) {
    const t = normalizeTitle(title)
    if (!t || isJunkFeedbackTitle(t)) continue
    if (matchByTitle(planPool(), t)) continue
    insertInto<PlanItem>('plans', {
      id: genId('pl'),
      date: today,
      title: t,
      category: 'other',
      planType: 'task',
      status: 'planned',
      source: 'import',
      projectId,
      note: '来自反哺·今日目标',
      ts: Date.now()
    } as unknown as PlanItem)
    added++
  }

  if (projectId) {
    const tasks = listTasks(projectId)
    for (const title of diff.completedTasks ?? []) {
      const task = matchByTitle(tasks, title)
      if (task && task.status !== 'done') {
        updateIn<ProjectTask>('projectTasks', task.id, { status: 'done', updatedAt: Date.now() })
        completedTasks++
      }
    }
    const existingTitles = new Set(listTasks(projectId).map((t) => t.title))
    const toCreate = (diff.addedTasks ?? [])
      .map(normalizeTitle)
      .filter((t) => t && !existingTitles.has(t) && !matchByTitle(listTasks(projectId), t))
    if (toCreate.length) {
      createTasksBulk(projectId, toCreate)
      addedTasks = toCreate.length
    }

    // 未实现：写入项目属性 + 落成项目任务（跨天保留，避免总结时丢掉）
    const deferredList = [...new Set((diff.deferred ?? []).map(normalizeTitle).filter(Boolean))].slice(0, 12)
    if (deferredList.length) {
      const afterBulk = listTasks(projectId)
      const missing = deferredList.filter((t) => !matchByTitle(afterBulk, t) && !existingTitles.has(t))
      if (missing.length) {
        createTasksBulk(projectId, missing.map((t) => (t.startsWith('未实现') ? t : `未实现：${t}`)), 'low')
        deferred = missing.length
        addedTasks += missing.length
      } else {
        deferred = deferredList.length
      }
      const project = col<Project>('projects').find((p) => p.id === projectId)
      if (project) {
        const attrs = {
          ...(project.attrs ?? {}),
          未实现: deferredList.map((t) => `· ${t}`).join('\n').slice(0, 800)
        }
        const order = project.attrOrder?.includes('未实现')
          ? project.attrOrder
          : [...(project.attrOrder ?? Object.keys(project.attrs ?? {})), '未实现'].filter((v, i, a) => a.indexOf(v) === i)
        updateIn<Project>('projects', projectId, { attrs, attrOrder: order, updatedAt: Date.now() })
      }
    }
  }

  let progressUpdated = false
  if (projectId && (diff.progressNote || '').trim()) {
    const project = col<Project>('projects').find((p) => p.id === projectId)
    if (project) {
      const attrs = { ...(project.attrs ?? {}), 最近进展: diff.progressNote.trim().slice(0, 800) }
      const order = project.attrOrder?.includes('最近进展')
        ? project.attrOrder
        : ['最近进展', ...(project.attrOrder ?? Object.keys(project.attrs ?? {}).filter((k) => k !== '最近进展'))]
      updateIn<Project>('projects', projectId, { attrs, attrOrder: order, updatedAt: Date.now() })
      progressUpdated = true
    }
  }

  return { completed, added, completedTasks, addedTasks, deferred, progressUpdated }
}

/** 清掉误当成待办的反哺章节标题（勾选更新 / 今日目标 等） */
export function cleanupJunkFeedbackPlans(): number {
  let removed = 0
  for (const p of col<PlanItem>('plans')) {
    if (!isJunkFeedbackTitle(p.title || '')) continue
    if (removeFrom('plans', p.id)) removed++
  }
  if (removed > 0) console.info(`[statusCard] 已清理误导入章节标题待办 ${removed} 条`)
  return removed
}
