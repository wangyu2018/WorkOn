/**
 * Function Calling 工具定义与调度器
 * 让 LLM 能直接调用 WorkOn 的核心能力（获取状态、管理计划、写备忘、生成报表等）
 *
 * 设计原则：
 *  - tools.ts 不 import ai.ts（避免循环依赖）
 *  - 每个工具返回 JSON 字符串，LLM 可直接解读
 *  - 工具执行有 try-catch 兜底，单工具失败不阻塞整轮对话
 */

// ───────────────────────── 类型 ─────────────────────────

import { clipText, summarizeArgs } from '@shared/trace'
import { recordToolCall } from './trace'

/** OpenAI Function Calling 工具定义 */
export interface ToolDef {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: {
      type: 'object'
      properties: Record<string, unknown>
      required?: string[]
    }
  }
}

/** LLM 返回的工具调用 */
export interface ToolCall {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

// ───────────────────────── 工具定义 ─────────────────────────

/** 全量工具集（askWithContext 主问答路径使用） */
export const WORKON_TOOLS: ToolDef[] = [
  {
    type: 'function',
    function: {
      name: 'get_presence',
      description: '获取当前桌面实时状态：活跃应用、窗口标题、工作状态、专注等级',
      parameters: { type: 'object', properties: {}, required: [] }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_focused_element',
      description: '获取当前焦点 UI 元素：控件类型、名称、值、选中文本（如"正在搜索框输入xxx"）',
      parameters: { type: 'object', properties: {}, required: [] }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_today_summary',
      description: '获取今日活动摘要：工作/摸鱼分钟数、专注占比、高频应用 Top5、高效时段',
      parameters: { type: 'object', properties: {}, required: [] }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_plans',
      description: '获取今日计划列表（含状态、完成进度、分类）',
      parameters: {
        type: 'object',
        properties: {
          date: { type: 'string', description: '日期 YYYY-MM-DD，默认今天' }
        },
        required: []
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'create_plan',
      description: '创建一条新计划',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: '计划标题' },
          category: {
            type: 'string',
            description: '计划分类',
            enum: ['ai-dev', 'coding', 'writing', 'meeting', 'leader', 'work-customer', 'other']
          },
          startMin: { type: 'number', description: '开始时间（分钟，0=0:00，720=12:00），默认当前时间' }
        },
        required: ['title']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'complete_plan',
      description: '将指定计划标记为已完成',
      parameters: {
        type: 'object',
        properties: {
          planId: { type: 'string', description: '计划 ID' }
        },
        required: ['planId']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'add_memo',
      description: '添加一条快速备忘',
      parameters: {
        type: 'object',
        properties: {
          text: { type: 'string', description: '备忘内容' }
        },
        required: ['text']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_attention_score',
      description: '获取今日注意力评分：5 维度（深度/持久/抗扰/节奏/恢复）各 0-100',
      parameters: { type: 'object', properties: {}, required: [] }
    }
  },
  {
    type: 'function',
    function: {
      name: 'generate_report',
      description: '生成日报（含工作/摸鱼统计、专注趋势、应用排名）。返回摘要供用户参考',
      parameters: {
        type: 'object',
        properties: {
          date: { type: 'string', description: '报告日期 YYYY-MM-DD，默认今天' }
        },
        required: []
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'set_pet_message',
      description: '让桌宠显示一条气泡消息（用于主动提醒、鼓励等）',
      parameters: {
        type: 'object',
        properties: {
          message: { type: 'string', description: '气泡内容，控制在 50 字以内' }
        },
        required: ['message']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_weekly_summary',
      description: '获取近 7 天趋势（周曲线）：每天专注分钟数与迷你曲线、最高/日均、今日对比、周内 Top3 应用、工作 vs 摸鱼占比、本周计划完成度。用户问「周曲线/本周怎么样/最近趋势/一周总结」时调用',
      parameters: { type: 'object', properties: {}, required: [] }
    }
  },
  {
    type: 'function',
    function: {
      name: 'quick_recommend',
      description: '基于当前工作模式推荐快捷操作或工作流建议',
      parameters: {
        type: 'object',
        properties: {
          context: { type: 'string', description: '当前工作上下文（由 AI 从对话/监控中推断）' }
        },
        required: []
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_weather',
      description: '查询指定城市（默认设置中的城市）的实时天气与今日/明日预报，含温度、天气现象、湿度、风速',
      parameters: {
        type: 'object',
        properties: {
          city: { type: 'string', description: '城市名，如「北京」，缺省用设置中的城市' }
        },
        required: []
      }
    }
  }
]

/** 桌宠轻量工具子集（petAskShort 路径使用，避免高延迟） */
export const PET_TOOLS: ToolDef[] = [
  WORKON_TOOLS[0],  // get_presence
  WORKON_TOOLS[1],  // get_focused_element
  WORKON_TOOLS[5],  // add_memo
  WORKON_TOOLS[9],  // set_pet_message
  WORKON_TOOLS[13]  // get_weather
]

// ───────────────────────── 工具调度器 ─────────────────────────

/**
 * 工具执行器（内部实现）
 * @param name 工具函数名
 * @param args 参数对象（已从 JSON 字符串解析）
 * @returns JSON 字符串结果
 */
async function executeToolInner(name: string, args: Record<string, unknown>): Promise<string> {
  try {
    switch (name) {

      case 'get_presence': {
        // 延迟导入避免循环依赖
        const { presence } = await import('./presence')
        const { bus } = await import('./state')
        const snap = presence.getSnapshot()
        const main = snap.screens.find((s) => s.screen === snap.mainScreen) ?? snap.screens[0]
        return JSON.stringify({
          state: snap.state,
          focusLevel: snap.focusLevel,
          context: snap.context,
          continuousFocusSec: snap.continuousFocusSec,
          continuousSlackSec: snap.continuousSlackSec,
          idleSec: snap.idleSec,
          mainScreen: {
            app: main?.appName ?? main?.app ?? 'unknown',
            title: main?.title ?? '',
            state: main?.state ?? snap.state
          },
          screenCount: snap.screens.length,
          uiaContext: snap.uiaContext ?? '',
          petEmotion: bus.pet.emotion,
          petIntimacy: bus.pet.intimacy
        })
      }

      case 'get_focused_element': {
        const { getFocusedElement, summarizeFocusedElement } = await import('./uia')
        const el = await getFocusedElement()
        if (!el) return JSON.stringify({ error: '无法获取焦点元素（可能桌面无活动窗口）' })
        return JSON.stringify({
          ...el,
          summary: summarizeFocusedElement(el)
        })
      }

      case 'get_today_summary': {
        const { dateKey, buildMergedTrail } = await import('@shared/trail')
        const { listActivities } = await import('./db')
        const { WORK_LIKE_STATES, SLACK_STATES } = await import('@shared/stateMeta')
        const date = dateKey(Date.now())
        const trail = buildMergedTrail(listActivities(date), date)
        const workMin = WORK_LIKE_STATES.reduce((a, s) => a + (trail.stateMinutes[s] ?? 0), 0)
        const slackMin = SLACK_STATES.reduce((a, s) => a + (trail.stateMinutes[s] ?? 0), 0)
        const appMinutes: Record<string, number> = {}
        for (const seg of trail.segments) {
          appMinutes[seg.mainApp] = (appMinutes[seg.mainApp] ?? 0) + seg.durationMin
        }
        const topApps = Object.entries(appMinutes).sort((a, b) => b[1] - a[1]).slice(0, 5)
        return JSON.stringify({
          date,
          totalMin: Math.round(trail.totalMin),
          workMin: Math.round(workMin),
          slackMin: Math.round(slackMin),
          focusPct: trail.totalMin > 0 ? Math.round((workMin / trail.totalMin) * 100) : 0,
          mainState: trail.mainState,
          dualRatio: Math.round(trail.dualRatio * 100),
          topApps: topApps.map(([app, min]) => ({ app, minutes: Math.round(min) })),
          segmentCount: trail.segments.length
        })
      }

      case 'get_plans': {
        const { col } = await import('./db')
        const { dateKey } = await import('@shared/trail')
        const date = (args.date as string) || dateKey(Date.now())
        const plans = col<import('@shared/types').PlanItem>('plans').filter((p) => p.date === date)
        return JSON.stringify(plans.map((p) => ({
          id: p.id,
          title: p.title,
          category: p.category,
          status: p.status,
          completionRatio: p.completionRatio ?? 0,
          startMin: p.startMin,
          source: p.source
        })))
      }

      case 'create_plan': {
        const { insertInto } = await import('./db')
        const { genId } = await import('@shared/types')
        const { dateKey } = await import('@shared/trail')
        const date = dateKey(Date.now())
        const title = args.title as string
        const now = new Date()
        const plan = {
          id: genId('plan'),
          date,
          title,
          category: (args.category as string) || 'other',
          startMin: (args.startMin as number) ?? (now.getHours() * 60 + now.getMinutes()),
          status: 'planned' as const,
          source: 'ai-tool',
          completionRatio: 0,
          ts: Date.now()
        }
        insertInto('plans', plan)
        // 通知前端刷新
        const { broadcast } = await import('./windows')
        broadcast('plan-updated')
        return JSON.stringify({ success: true, planId: plan.id, message: `已创建计划：${title}` })
      }

      case 'complete_plan': {
        const { updateIn, col } = await import('./db')
        const planId = args.planId as string
        const plans = col<import('@shared/types').PlanItem>('plans')
        const plan = plans.find((p) => p.id === planId)
        if (!plan) return JSON.stringify({ success: false, error: '计划不存在' })
        updateIn<import('@shared/types').PlanItem>('plans', planId, { status: 'done', completionRatio: 1 })
        const { broadcast } = await import('./windows')
        broadcast('plan-updated')
        return JSON.stringify({ success: true, message: `已完成计划：${plan.title}` })
      }

      case 'add_memo': {
        const { insertInto } = await import('./db')
        const { genId } = await import('@shared/types')
        const text = args.text as string
        insertInto('memos', { id: genId('memo'), text, source: 'ai-tool', ts: Date.now() })
        return JSON.stringify({ success: true, message: `已添加备忘：${text.slice(0, 40)}` })
      }

      case 'get_attention_score': {
        const { todayScore } = await import('./attention')
        const score = todayScore()
        return JSON.stringify({
          date: score.date,
          userType: score.userType,
          dimensions: score.dimensions,
          composite: Math.round(
            Object.values(score.dimensions).reduce((a, b) => a + b, 0) / 5
          )
        })
      }

      case 'generate_report': {
        const { dateKey } = await import('@shared/trail')
        const { generateReport } = await import('./report/engine')
        const date = (args.date as string) || dateKey(Date.now())
        const report = await generateReport(date, undefined, true)
        return JSON.stringify({
          success: true,
          date: report.date,
          aiStatus: report.aiStatus,
          coverage: Math.round(report.coverage * 100) + '%',
          stats: {
            totalWorkMin: report.stats.totalWorkMin,
            totalSlackMin: report.stats.totalSlackMin,
            focusScore: report.stats.focusScore,
            workSlackRatio: report.stats.workSlackRatio,
            topApps: report.stats.appRanking.slice(0, 5).map((a) => ({
              app: a.app, minutes: a.minutes, pct: a.percentage
            })),
            vsYesterday: report.stats.vsYesterday ?? null
          },
          entryCount: report.entries.length,
          pendingReview: report.pendingReview.length
        })
      }

      case 'set_pet_message': {
        const { bus } = await import('./state')
        const message = (args.message as string).slice(0, 50)
        bus.setPet({ message })
        return JSON.stringify({ success: true, message: `桌宠已显示：${message}` })
      }

      case 'get_weekly_summary': {
        const { dateKey } = await import('@shared/trail')
        const { listActivitiesRange, col: colFn } = await import('./db')
        const { buildMergedTrail } = await import('@shared/trail')
        const { WORK_LIKE_STATES } = await import('@shared/stateMeta')
        const days: { date: string; label: string; focusMin: number; slackMin: number }[] = []
        const appMin = new Map<string, number>()
        for (let i = 6; i >= 0; i--) {
          const d = new Date()
          d.setDate(d.getDate() - i)
          const key = dateKey(d.getTime())
          const trail = buildMergedTrail(listActivitiesRange(d.getTime() - 86400000, d.getTime()), key)
          const focusMin = Math.round(WORK_LIKE_STATES.reduce((a, s) => a + (trail.stateMinutes[s] ?? 0), 0))
          const slackMin = Math.round((trail.stateMinutes['slack'] ?? 0) + (trail.stateMinutes['relax'] ?? 0))
          days.push({ date: key, label: `${d.getMonth() + 1}/${d.getDate()}`, focusMin, slackMin })
          for (const seg of trail.segments) {
            if (seg.glance || seg.durationMin <= 0) continue
            appMin.set(seg.mainApp, (appMin.get(seg.mainApp) ?? 0) + seg.durationMin)
          }
        }
        // 迷你曲线（7 格）：▁▂▃▄▅▆█
        const bars = '▁▂▃▄▅▆█'
        const max = Math.max(1, ...days.map((d) => d.focusMin))
        const spark = days.map((d) => bars[Math.min(7, Math.max(1, Math.ceil((d.focusMin / max) * 7))) - 1]).join('')
        const focusArr = days.map((d) => d.focusMin)
        const best = days[focusArr.indexOf(Math.max(...focusArr))]
        const avg = Math.round(focusArr.reduce((a, b) => a + b, 0) / 7)
        const todayFocus = focusArr[6]
        const weekStart = Date.now() - 6 * 86400000
        const weekPlans = colFn<{ status: string; date: string; ts: number }>('plans').filter((p) => new Date(p.date + 'T23:59:59').getTime() >= weekStart - 86400000)
        const weekDone = weekPlans.filter((p) => p.status === 'done').length
        const topApps = [...appMin.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([app, min]) => ({ app, hours: +(min / 60).toFixed(1) }))
        const totalFocus = focusArr.reduce((a, b) => a + b, 0)
        const totalSlack = days.reduce((a, d) => a + d.slackMin, 0)
        return JSON.stringify({
          days,
          sparkline: spark,
          bestDay: { label: best.label, focusMin: best.focusMin },
          avgPerDay: avg,
          todayVsAvg: avg > 0 ? `${todayFocus >= avg ? '+' : ''}${Math.round(((todayFocus - avg) / avg) * 100)}%` : '—',
          workVsSlack: totalFocus + totalSlack > 0 ? `工作 ${Math.round((totalFocus / (totalFocus + totalSlack)) * 100)}% / 摸鱼 ${Math.round((totalSlack / (totalFocus + totalSlack)) * 100)}%` : '暂无数据',
          topApps,
          weekPlans: { done: weekDone, total: weekPlans.length },
          hint: '回答时把 sparkline 当作周曲线展示（7 格从左到右=7 天前到今天），数字保持精确，给一句可执行建议'
        })
      }

      case 'quick_recommend': {
        const ctx = (args.context as string) || ''
        const suggestions: string[] = []
        suggestions.push('检测到工作时段，建议打开首页图谱查看今日工作分布')
        suggestions.push('在问答中说"帮我生成周报"可一键导出')
        if (ctx) suggestions.push(`基于"${ctx.slice(0, 60)}"推荐：尝试用番茄钟聚焦当前任务`)
        return JSON.stringify({ suggestions })
      }

      case 'get_weather': {
        const { getWeather } = await import('./weather')
        const city = (args.city as string) || undefined
        const res = await getWeather(city)
        if ('error' in res) return JSON.stringify({ error: res.error })
        return JSON.stringify({
          city: res.city,
          text: res.text,
          tempC: res.tempC,
          feelsC: res.feelsC,
          humidity: res.humidity,
          windKph: res.windKph,
          maxC: res.maxC,
          minC: res.minC
        })
      }

      default:
        return JSON.stringify({ error: `未知工具：${name}` })
    }
  } catch (e) {
    console.warn(`[tools] 工具 ${name} 执行失败:`, (e as Error).message)
    return JSON.stringify({ error: `工具执行失败：${(e as Error).message}` })
  }
}

/**
 * 执行工具（带 trace 埋点）
 *
 * 这里是能力插件与 L2 隧道之间唯一的耦合面：
 * 传入 traceCtx 时记录 name / 参数摘要 / 耗时 / 成败，隧道只读这份记录。
 * 未传 traceCtx 时行为与埋点前完全一致。
 */
export async function executeTool(
  name: string,
  args: Record<string, unknown>,
  traceCtx?: { traceId: string }
): Promise<string> {
  if (!traceCtx) return executeToolInner(name, args)
  const started = Date.now()
  const result = await executeToolInner(name, args)
  const failed = result.startsWith('{"error"')
  let error: string | undefined
  if (failed) {
    try {
      error = (JSON.parse(result) as { error?: string }).error
    } catch {
      error = result
    }
  }
  recordToolCall(traceCtx.traceId, {
    name,
    args: summarizeArgs(name, args),
    ok: !failed,
    ms: Date.now() - started,
    resultPreview: clipText(result),
    error
  })
  return result
}
