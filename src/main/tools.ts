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
import { getNodeLabel } from './nodes'
import type { DraftSpec } from '@shared/deliverable/spec'

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
      description: '准备一条新计划：先向用户展示预览卡，用户确认后才真正创建',
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
  },
  // ── 节点模式（P0 只读）：外部电脑包装成普通能力插件，LLM 无感 ──
  {
    type: 'function',
    function: {
      name: 'remote_sys_info',
      description: '查看已配对的远程电脑节点的系统信息（主机名、OS、架构、白名单根目录）',
      parameters: {
        type: 'object',
        properties: {
          nodeId: { type: 'string', description: '节点 ID（见上下文「远程节点」中的 nodeId）' }
        },
        required: ['nodeId']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'remote_fs_list',
      description: '列出远程电脑节点上指定目录的内容（只读，受节点白名单根目录限制）',
      parameters: {
        type: 'object',
        properties: {
          nodeId: { type: 'string', description: '节点 ID' },
          path: { type: 'string', description: '目录绝对路径，缺省为节点白名单第一个根目录' }
        },
        required: ['nodeId']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'browser_navigate',
      description: '在 WorkOn 内置浏览器中打开网址（应用内网页，登录态持久）。支持域名自动补 https，普通文字会走搜索',
      parameters: {
        type: 'object',
        properties: { url: { type: 'string', description: '网址或搜索词' } },
        required: ['url']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'browser_read',
      description: '读取内置浏览器当前页面的标题、正文和可交互元素（按钮/链接/输入框，带选择器）',
      parameters: { type: 'object', properties: {}, required: [] }
    }
  },
  {
    type: 'function',
    function: {
      name: 'browser_click',
      description: '在内置浏览器里点击元素：可传 CSS 选择器，或按钮/链接文字',
      parameters: {
        type: 'object',
        properties: { target: { type: 'string', description: 'CSS 选择器或元素文字' } },
        required: ['target']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'browser_fill',
      description: '在内置浏览器里填写输入框（选择器 + 文本），会触发 input/change 事件',
      parameters: {
        type: 'object',
        properties: {
          selector: { type: 'string', description: '输入框 CSS 选择器' },
          text: { type: 'string', description: '要填入的文本' }
        },
        required: ['selector', 'text']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'browser_screenshot',
      description: '截取内置浏览器当前页面并保存到本地，返回文件路径',
      parameters: { type: 'object', properties: {}, required: [] }
    }
  },
  {
    type: 'function',
    function: {
      name: 'web_test',
      description:
        '对网页做自动化测试：页面巡检（空白页/坏图/错误文案/控制台报错/横向溢出）、核心流程回归、表单边界；返回步骤结果、问题清单、结论与报告路径',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: '要测试的网址（http/https）' },
          goal: { type: 'string', description: '测试目标或要走的流程，例如：登录后进入个人中心并检查昵称；留空只做页面巡检' },
          kinds: {
            type: 'array',
            items: { type: 'string' },
            description: '测试类型：inspect=页面巡检 / flow=流程回归 / form=表单边界，默认全部'
          },
          maxSteps: { type: 'number', description: '流程步骤上限（3-15，默认 8）' }
        },
        required: ['url']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'list_projects',
      description: '列出 WorkOn 本地项目（「计划 → 项目」里的项目，不是计划、不是远程节点仓库）：名称、状态、优先级、目标、任务数',
      parameters: { type: 'object', properties: {}, required: [] }
    }
  },
  {
    type: 'function',
    function: {
      name: 'create_project',
      description: '新建 WorkOn 本地项目。用户说「增加/新建/创建 XXX 项目」时用这个，不要把项目建成计划',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: '项目名称，例如「Trae 大赛」' },
          goal: { type: 'string', description: '项目目标（可选）' },
          priority: { type: 'string', enum: ['high', 'medium', 'low'], description: '优先级，默认 medium' }
        },
        required: ['name']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'add_project_task',
      description: '给本地项目加一条任务（按项目名或项目 ID 定位；项目不存在时提示先 create_project）',
      parameters: {
        type: 'object',
        properties: {
          project: { type: 'string', description: '项目名称或 projectId' },
          title: { type: 'string', description: '任务标题' },
          priority: { type: 'string', enum: ['high', 'medium', 'low'], description: '优先级，默认 medium' }
        },
        required: ['project', 'title']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'search_memory',
      description: '检索本地记忆：屏幕 OCR、截图索引、知识库、应用活动。用户问「我在哪看过/上次那个/之前提到」时用',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: '关键词' },
          startTs: { type: 'number', description: '起始时间戳（可选，默认 7 天前）' },
          endTs: { type: 'number', description: '结束时间戳（可选，默认现在）' },
          limit: { type: 'number', description: '返回条数（默认 10）' }
        },
        required: ['query']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'draft_deliverable',
      description: '起草交付物（报告/简报/演示/长图）：只生成文字草案，不渲染任何文件。必须等用户确认草案后才能继续',
      parameters: {
        type: 'object',
        properties: {
          template: { type: 'string', enum: ['brief', 'report', 'deck', 'poster'], description: '模板，默认 report' },
          title: { type: 'string', description: '标题（可选）' },
          date: { type: 'string', description: '日期 YYYY-MM-DD（可选，默认今天）' },
          goal: { type: 'string', description: '受众与目的（可选）' }
        },
        required: []
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'revise_deliverable',
      description: '按用户反馈修订交付物草案（仍不渲染）。仅用于草案阶段',
      parameters: {
        type: 'object',
        properties: {
          jobId: { type: 'string', description: '任务 id' },
          title: { type: 'string', description: '新标题（可选）' },
          feedback: { type: 'string', description: '用户修改意见（可选）' }
        },
        required: ['jobId']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'render_deliverable',
      description: '把已确认的任务渲染成文件。未确认会被闸门拒绝（GATE_NOT_CONFIRMED）；禁止跳过确认',
      parameters: {
        type: 'object',
        properties: {
          jobId: { type: 'string', description: '任务 id' },
          format: { type: 'string', enum: ['md', 'html', 'pdf', 'png', 'docx', 'xlsx', 'pptx'], description: '输出格式' }
        },
        required: ['jobId', 'format']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'export_report',
      description: '直接导出某日报告为文件（md/html/pdf/png）。适合用户明确说「导出今天的报告」',
      parameters: {
        type: 'object',
        properties: {
          date: { type: 'string', description: '日期 YYYY-MM-DD，默认今天' },
          format: { type: 'string', enum: ['md', 'html', 'pdf', 'png'], description: '格式，默认 html' },
          template: { type: 'string', enum: ['brief', 'report', 'deck', 'poster'], description: '模板，默认 report' }
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
        const { genId } = await import('@shared/types')
        const { dateKey } = await import('@shared/trail')
        const title = String(args.title ?? '').trim()
        if (!title) return JSON.stringify({ success: false, error: '计划标题为空' })
        const hasTime = typeof args.startMin === 'number'
        // 不直接落库：先广播预览卡，用户在卡片上确认后才写入
        const proposal = {
          token: genId('planproposal'),
          date: dateKey(Date.now()),
          title,
          category: (args.category as string) || 'other',
          planType: hasTime ? ('reminder' as const) : ('task' as const),
          startMin: hasTime ? (args.startMin as number) : undefined
        }
        const { broadcast } = await import('./windows')
        broadcast('plan:proposal', proposal)
        return JSON.stringify({
          success: true,
          status: 'pending_user_confirmation',
          proposal,
          message: '已向用户展示计划预览卡，尚未创建；请提示用户点卡片确认，不要声称已创建。'
        })
      }

      case 'list_projects': {
        const { listProjects, listTasks } = await import('./projects')
        return JSON.stringify({
          projects: listProjects().map((p) => ({
            id: p.id,
            name: p.name,
            status: p.status,
            priority: p.priority,
            goal: p.goal ?? '',
            tasks: listTasks(p.id).length
          }))
        })
      }

      case 'create_project': {
        const name = String(args.name ?? '').trim().slice(0, 40)
        if (!name) return JSON.stringify({ success: false, error: '项目名称为空' })
        const { listProjects, saveProject } = await import('./projects')
        const dup = listProjects().find((p) => p.name === name)
        if (dup) {
          return JSON.stringify({
            success: true,
            existing: true,
            project: { id: dup.id, name: dup.name },
            message: `项目「${dup.name}」已存在，未重复创建。`
          })
        }
        const priorityRaw = String(args.priority ?? 'medium')
        const priority = priorityRaw === 'high' || priorityRaw === 'low' ? priorityRaw : 'medium'
        const project = saveProject({
          name,
          goal: typeof args.goal === 'string' ? args.goal.slice(0, 200) : undefined,
          priority
        })
        return JSON.stringify({
          success: true,
          project: { id: project.id, name: project.name, priority: project.priority },
          message: `已在「计划 → 项目」中创建项目「${project.name}」，还没创建任何计划。`
        })
      }

      case 'add_project_task': {
        const key = String(args.project ?? '').trim()
        const title = String(args.title ?? '').trim().slice(0, 80)
        if (!key || !title) return JSON.stringify({ success: false, error: '缺少项目或任务标题' })
        const { listProjects, saveTask } = await import('./projects')
        const project = listProjects().find((p) => p.id === key || p.name === key) ??
          listProjects().find((p) => p.name.includes(key))
        if (!project) {
          return JSON.stringify({ success: false, error: `没有找到项目「${key}」，请先用 create_project 新建` })
        }
        const priorityRaw = String(args.priority ?? 'medium')
        const priority = priorityRaw === 'high' || priorityRaw === 'low' ? priorityRaw : 'medium'
        const task = saveTask({ projectId: project.id, title, priority })
        return JSON.stringify({
          success: true,
          project: project.name,
          task: { id: task.id, title: task.title },
          message: `已给项目「${project.name}」加任务「${task.title}」。`
        })
      }

      case 'search_memory': {
        const { search } = await import('./memory')
        const query = String(args.query ?? '').trim()
        if (!query) return JSON.stringify({ success: false, error: '缺少关键词' })
        const hits = search(query, {
          start: typeof args.startTs === 'number' ? args.startTs : undefined,
          end: typeof args.endTs === 'number' ? args.endTs : undefined,
          limit: typeof args.limit === 'number' ? args.limit : 10
        })
        return JSON.stringify({ success: true, count: hits.length, hits: hits.slice(0, 10) })
      }

      case 'draft_deliverable': {
        const { startDraft } = await import('./deliverable/orchestrator')
        const templateRaw = String(args.template ?? 'report')
        const template = ['brief', 'report', 'deck', 'poster'].includes(templateRaw) ? templateRaw : 'report'
        const job = await startDraft({
          template: template as 'brief' | 'report' | 'deck' | 'poster',
          title: args.title ? String(args.title).slice(0, 60) : undefined,
          date: args.date ? String(args.date).slice(0, 10) : undefined,
          goal: args.goal ? String(args.goal).slice(0, 120) : undefined
        })
        return JSON.stringify({
          success: true,
          jobId: job.id,
          stage: job.stage,
          draft: job.draft,
          issues: job.draftIssues,
          message: '文字草案已生成。请让用户确认或修改后再渲染，不要直接渲染。'
        })
      }

      case 'revise_deliverable': {
        const { getJob, reviseDraft } = await import('./deliverable/orchestrator')
        const jobId = String(args.jobId ?? '')
        const job = getJob(jobId)
        if (!job) return JSON.stringify({ success: false, error: '任务不存在' })
        if (job.stage !== 'draft' && job.stage !== 'draft_audited') {
          return JSON.stringify({ success: false, error: `当前阶段不能修改草案：${job.stage}` })
        }
        const patch: Partial<DraftSpec> = {}
        if (args.title) patch.title = String(args.title).slice(0, 60)
        const feedback = String(args.feedback ?? '').trim()
        if (feedback) patch.riskHints = [...(job.draft.riskHints ?? []), feedback.slice(0, 160)]
        const next = reviseDraft(jobId, patch)
        return JSON.stringify({ success: true, jobId: next.id, draft: next.draft, issues: next.draftIssues })
      }

      case 'render_deliverable': {
        const { renderJob } = await import('./deliverable/orchestrator')
        const jobId = String(args.jobId ?? '')
        const formatRaw = String(args.format ?? 'html')
        const allowed = ['md', 'html', 'pdf', 'png', 'docx', 'xlsx', 'pptx']
        const format = (allowed.includes(formatRaw) ? formatRaw : 'html') as
          | 'md'
          | 'html'
          | 'pdf'
          | 'png'
          | 'docx'
          | 'xlsx'
          | 'pptx'
        try {
          const r = await renderJob(jobId, format)
          return JSON.stringify({ success: true, path: r.path, bytes: r.bytes })
        } catch (e) {
          const err = e as Error & { code?: string }
          return JSON.stringify({
            success: false,
            error: err.code === 'GATE_NOT_CONFIRMED' ? 'GATE_NOT_CONFIRMED' : err.message,
            message: '必须先让用户确认草案与 AST，才能渲染'
          })
        }
      }

      case 'export_report': {
        const { exportReport } = await import('./report/engine')
        const { dateKey } = await import('@shared/trail')
        const date = String(args.date ?? dateKey(Date.now())).slice(0, 10)
        const formatRaw = String(args.format ?? 'html')
        const format = (['md', 'html', 'pdf', 'png'].includes(formatRaw) ? formatRaw : 'html') as
          | 'md'
          | 'html'
          | 'pdf'
          | 'png'
        const templateRaw = String(args.template ?? 'report')
        const template = (['brief', 'report', 'deck', 'poster'].includes(templateRaw) ? templateRaw : 'report') as
          | 'brief'
          | 'report'
          | 'deck'
          | 'poster'
        const r = await exportReport(date, format, template)
        return JSON.stringify({ success: true, path: r.path, bytes: r.bytes })
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

      // ── 节点模式（P0 只读）：统一走 nodeManager，返回值仍是 JSON 字符串 ──
      case 'remote_sys_info': {
        const { callNode } = await import('./nodes')
        const nodeId = typeof args.nodeId === 'string' ? args.nodeId : ''
        if (!nodeId) return JSON.stringify({ error: '缺少 nodeId（可用节点见上下文「远程节点」）' })
        return await callNode(nodeId, 'sys.info', {})
      }

      case 'remote_fs_list': {
        const { callNode } = await import('./nodes')
        const nodeId = typeof args.nodeId === 'string' ? args.nodeId : ''
        if (!nodeId) return JSON.stringify({ error: '缺少 nodeId（可用节点见上下文「远程节点」）' })
        return await callNode(nodeId, 'fs.list', {
          path: typeof args.path === 'string' ? args.path : undefined
        })
      }

      // ── 应用内浏览器（Qoder 式：Agent 直接看网页 / 操作网页） ──
      case 'browser_navigate': {
        const { browserNavigate, browserRead } = await import('./browser')
        const res = await browserNavigate(String(args.url ?? ''))
        if (!res.ok) return JSON.stringify({ error: res.error })
        const read = await browserRead().catch(() => ({ ok: false as const, error: '页面读取失败' }))
        return JSON.stringify({
          ok: true,
          url: res.detail,
          title: read.ok ? read.title : '',
          text: read.ok ? read.text : '',
          items: read.ok ? read.items?.slice(0, 40) : [],
          factGrounding:
            '本工具已返回当前页面 title/url/text/items。只能依据这些字段总结；页面未出现的语言、用途、限制、作者、交互能力或建议不要补充，不确定就明确说页面未提供。',
          nextStep: read.ok ? '页面正文已在本结果中，可直接总结；如需刷新页面内容可再调用 browser_read。' : '页面已打开但正文读取失败，可重试 browser_read。'
        })
      }

      case 'browser_read': {
        const { browserRead } = await import('./browser')
        const res = await browserRead()
        if (!res.ok) return JSON.stringify({ error: res.error })
        return JSON.stringify({
          title: res.title,
          url: res.url,
          text: res.text,
          items: res.items?.slice(0, 40),
          factGrounding: '只能依据本工具返回的 title/url/text/items 总结；页面未出现的语言、用途、限制、作者、交互能力或建议不要补充，不确定就明确说页面未提供。'
        })
      }

      case 'browser_click': {
        const { browserClick } = await import('./browser')
        const res = await browserClick(String(args.target ?? ''))
        return JSON.stringify(res.ok ? { ok: true, detail: res.detail } : { error: res.error })
      }

      case 'browser_fill': {
        const { browserFill } = await import('./browser')
        const res = await browserFill(String(args.selector ?? ''), String(args.text ?? ''))
        return JSON.stringify(res.ok ? { ok: true, detail: res.detail } : { error: res.error })
      }

      case 'browser_screenshot': {
        const { browserScreenshot } = await import('./browser')
        const res = await browserScreenshot()
        return JSON.stringify(res.ok ? { ok: true, path: res.path } : { error: res.error })
      }

      case 'web_test': {
        const { runWebTest } = await import('./webTest')
        const report = await runWebTest({
          url: String(args.url ?? ''),
          goal: args.goal ? String(args.goal) : '',
          kinds: Array.isArray(args.kinds) ? (args.kinds as import('@shared/webtest').WebTestKind[]) : undefined,
          maxSteps: args.maxSteps ? Number(args.maxSteps) : undefined
        })
        return JSON.stringify({
          pageTitle: report.pageTitle,
          summary: report.summary,
          issues: report.issues.slice(0, 10),
          steps: report.steps.map((s) => ({
            index: s.index,
            action: s.action,
            target: s.target,
            status: s.status,
            detail: s.detail
          })),
          conclusion: report.conclusion,
          reportPath: report.reportPath
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
    error,
    // 远端调用在隧道里标明目标机器；本机调用保持缺省
    target:
      name.startsWith('remote_') && typeof args.nodeId === 'string'
        ? { kind: 'node', nodeId: args.nodeId, label: getNodeLabel(args.nodeId) }
        : undefined
  })
  return result
}
