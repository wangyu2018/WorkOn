/**
 * AI 分析引擎
 * 依据：PRD.md F4/F6/F17
 *  - 聚合当日事实 → OpenAI 兼容接口 或 纯本地规则回退 ruleAnalyze
 *  - 轻问诊 genQuestion：已确认（answer='yes'）的情境不再追问
 *  - 用量统计 UsageStat（token / 问答 / 估算 USD）
 */
import type { MergedTrail, PlanItem, UserAnalysis, UserFeedback, UserHabits, QAMessage, UsageStat, ProfileReference, WorkState, CategoryInference } from '@shared/types'
import { bus } from './state'
import { genId } from '@shared/types'
import { WORK_LIKE_STATES, SLACK_STATES, STATE_LABEL, ALL_STATES } from '@shared/stateMeta'
import { dateKey, buildMergedTrail } from '@shared/trail'
import { col, insertInto, updateIn, listActivities } from './db'
import { getSettings } from './settings'
import { genQuestion as genQuestionImpl, recordFeedback as recordFeedbackImpl } from './qa/questionGenerator'
import { requestPersonaData } from './desensitize'
import { WORKON_TOOLS, PET_TOOLS, executeTool, type ToolCall } from './tools'

// ───────────────────────── 用量 ─────────────────────────

const MODEL_COST_PER_1K: Record<string, number> = {
  'gpt-4o-mini': 0.0003,
  'gpt-4o': 0.005,
  'deepseek-chat': 0.001,
  'deepseek-reasoner': 0.002,
  default: 0.001
}

// ───────────────────────── 多模型路由 ─────────────────────────

/** 任务复杂度等级 */
export type TaskComplexity = 'fast' | 'standard' | 'complex'

/**
 * 根据任务复杂度选择模型
 * - fast: 桌宠短回复、连接测试 → aiModelFast（如 gpt-4o-mini）
 * - standard: 普通问答、工具调用 → aiModel（默认模型）
 * - complex: 日报分析、深度问答 → aiModelComplex（如 gpt-4o / deepseek-reasoner）
 */
export function selectModel(complexity: TaskComplexity = 'standard'): string {
  const s = getSettings()
  switch (complexity) {
    case 'fast':
      return s.aiModelFast || s.aiModel
    case 'complex':
      return s.aiModelComplex || s.aiModel
    default:
      return s.aiModel
  }
}

/** 流式回调类型：每次收到文本增量时调用 */
export type StreamCallback = (delta: string, fullText: string) => void

export function trackUsage(model: string, tokens: number, isQA: boolean): void {
  const date = dateKey(Date.now())
  const usages = col<UsageStat>('usages')
  const found = usages.find((u) => u.date === date && u.model === model)
  const cost = (tokens / 1000) * (MODEL_COST_PER_1K[model] ?? MODEL_COST_PER_1K.default)
  if (found) {
    updateIn<UsageStat>('usages', found.id, {
      tokens: found.tokens + tokens,
      qaCount: found.qaCount + (isQA ? 1 : 0),
      costUsd: found.costUsd + cost
    })
  } else {
    insertInto<UsageStat>('usages', { id: genId('usage'), date, model, tokens, qaCount: isQA ? 1 : 0, costUsd: cost })
  }
}

// ───────────────────────── 聚合事实 ─────────────────────────

export function aggregateFacts(trail: MergedTrail): Record<string, unknown> {
  const workMin = WORK_LIKE_STATES.reduce((a, s) => a + (trail.stateMinutes[s] ?? 0), 0)
  const slackMin = SLACK_STATES.reduce((a, s) => a + (trail.stateMinutes[s] ?? 0), 0)
  const appMinutes: Record<string, number> = {}
  for (const seg of trail.segments) {
    appMinutes[seg.mainApp] = (appMinutes[seg.mainApp] ?? 0) + seg.durationMin
  }
  const hourFocus = new Array<number>(24).fill(0)
  for (const seg of trail.segments) {
    if (WORK_LIKE_STATES.includes(seg.mainState)) {
      hourFocus[new Date(seg.startTs).getHours()] += seg.durationMin
    }
  }
  const bestHours = hourFocus
    .map((m, h) => ({ h, m }))
    .filter((x) => x.m > 0)
    .sort((a, b) => b.m - a.m)
    .slice(0, 3)
    .map((x) => x.h)
  return {
    date: trail.date,
    totalMin: Math.round(trail.totalMin),
    workMin: Math.round(workMin),
    slackMin: Math.round(slackMin),
    dualRatio: Math.round(trail.dualRatio * 100),
    dualWorkSlackMin: Math.round(trail.dualWorkSlackMin),
    mainState: trail.mainState,
    auxTopState: trail.auxTopState,
    topApps: Object.entries(appMinutes).sort((a, b) => b[1] - a[1]).slice(0, 5),
    bestHours,
    distractingApps: Object.entries(appMinutes)
      .filter(([app]) => /wechat|qq|music|video|game|bilibili|chrome/i.test(app))
      .map(([app]) => app)
      .slice(0, 3)
  }
}

// ───────────────────────── 规则回退分析 ─────────────────────────

export function ruleAnalyze(trail: MergedTrail): UserAnalysis {
  const f = aggregateFacts(trail) as ReturnType<typeof aggregateFacts> & {
    workMin: number; slackMin: number; totalMin: number; dualRatio: number
    dualWorkSlackMin: number; topApps: [string, number][]; bestHours: number[]; distractingApps: string[]
  }
  const focusScore = f.totalMin > 0 ? Math.round((f.workMin / f.totalMin) * 100) : 0
  const efficiencyScore = Math.max(0, Math.min(100, focusScore - Math.round(f.slackMin / 10) + (f.dualRatio > 20 ? 5 : 0)))

  const suggestions: string[] = []
  if (f.slackMin > 60) suggestions.push(`今日摸鱼 ${f.slackMin} 分钟，试试把娱乐集中到固定时段`)
  if (f.dualWorkSlackMin > 30) suggestions.push(`主工作+副摸鱼并行 ${f.dualWorkSlackMin} 分钟，副屏内容可能正在拖慢你`)
  if (f.bestHours.length) suggestions.push(`你的高效时段在 ${f.bestHours.map((h) => `${h}:00`).join(' / ')}，重要任务排到这里`)
  if (focusScore < 50 && f.totalMin > 60) suggestions.push('专注占比偏低，明天可以先从 1 个 25 分钟番茄钟开始')
  if (!suggestions.length) suggestions.push('节奏不错，继续保持')

  return {
    id: genId('ana'),
    date: trail.date,
    profile: {
      focusScore,
      efficiencyScore,
      topCategories: (f.topApps as [string, number][]).slice(0, 3).map(([a]) => a),
      bestHours: f.bestHours,
      distractingApps: f.distractingApps,
      strengths: focusScore >= 70 ? ['专注占比高', '工作节奏稳定'] : ['有持续使用电脑的习惯'],
      risks: f.slackMin > 60 ? ['摸鱼时间偏长'] : f.dualRatio > 40 ? ['双屏并行易被副屏带偏'] : [],
      dualScreen: {
        isRegularDual: f.dualRatio > 20,
        mainWork: STATE_LABEL[trail.mainState] ?? trail.mainState,
        auxActivity: trail.auxTopState ? (STATE_LABEL[trail.auxTopState] ?? trail.auxTopState) : '无',
        workSlackRatio: f.totalMin > 0 ? f.dualWorkSlackMin / f.totalMin : 0,
        slackWithAiDev: trail.auxTopState === 'slack' && (trail.mainState === 'aidev' || trail.mainState === 'coding')
      }
    },
    daily: `今日墙钟 ${f.totalMin} 分钟：工作 ${f.workMin} 分钟、摸鱼 ${f.slackMin} 分钟` +
      (f.dualRatio > 0 ? `，双屏并行占 ${f.dualRatio}%` : '') + '。',
    patterns: [
      f.bestHours.length ? `高效时段集中在 ${f.bestHours[0]}:00 前后` : '暂无稳定高效时段',
      f.dualRatio > 20 ? '双屏并行是常态' : '以单屏为主'
    ],
    questions: [],
    suggestions,
    source: 'rule',
    ts: Date.now()
  }
}

// ───────────────────────── LLM 调用 ─────────────────────────

interface ChatMsg {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export async function llmChat(
  messages: ChatMsg[],
  timeoutMs = 45000,
  complexity: TaskComplexity = 'standard'
): Promise<string | null> {
  const s = getSettings()
  if (!s.aiEnabled || !s.aiApiKey) return null
  const model = selectModel(complexity)
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const resp = await fetch(`${s.aiBaseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${s.aiApiKey}` },
      body: JSON.stringify({ model, messages, temperature: 0.4 }),
      signal: ctrl.signal
    })
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
    const json = (await resp.json()) as {
      choices?: { message?: { content?: string } }[]
      usage?: { total_tokens?: number }
    }
    trackUsage(model, json.usage?.total_tokens ?? 800, false)
    return json.choices?.[0]?.message?.content?.trim() ?? null
  } catch (e) {
    console.warn('[ai] LLM 调用失败，回退规则分析:', (e as Error).message)
    return null
  } finally {
    clearTimeout(t)
  }
}

// ───────────────────────── Function Calling ─────────────────────────

/** 工具调用扩展消息类型（兼容 OpenAI tool calling 格式） */
type ToolMessage = { role: 'tool'; content: string; tool_call_id: string }
type AssistantWithTools = { role: 'assistant'; content: string | null; tool_calls?: ToolCall[] }
type ChatMessage = ChatMsg | ToolMessage | AssistantWithTools

/** LLM 带工具调用的响应 */
interface LLMToolResponse {
  content: string | null
  toolCalls: ToolCall[] | null
  usageTokens: number
}

/**
 * 带工具定义的 LLM 调用
 * - 向 OpenAI 兼容接口发送 tools 参数
 * - 返回 content 和/或 tool_calls
 */
export async function llmChatWithTools(
  messages: ChatMessage[],
  tools: { type: 'function'; function: { name: string; description: string; parameters: Record<string, unknown> } }[],
  timeoutMs = 60000,
  complexity: TaskComplexity = 'standard'
): Promise<LLMToolResponse | null> {
  const s = getSettings()
  if (!s.aiEnabled || !s.aiApiKey) return null
  const model = selectModel(complexity)
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const resp = await fetch(`${s.aiBaseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${s.aiApiKey}` },
      body: JSON.stringify({
        model,
        messages,
        temperature: 0.4,
        tools,
        tool_choice: 'auto'
      }),
      signal: ctrl.signal
    })
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
    const json = (await resp.json()) as {
      choices?: { message?: { content?: string | null; tool_calls?: ToolCall[] } }[]
      usage?: { total_tokens?: number }
    }
    const msg = json.choices?.[0]?.message
    trackUsage(model, json.usage?.total_tokens ?? 1000, false)
    return {
      content: msg?.content?.trim() || null,
      toolCalls: msg?.tool_calls?.length ? msg.tool_calls : null,
      usageTokens: json.usage?.total_tokens ?? 1000
    }
  } catch (e) {
    console.warn('[ai] LLM 工具调用失败，回退普通模式:', (e as Error).message)
    return null
  } finally {
    clearTimeout(t)
  }
}

/**
 * 工具调用循环：LLM ↔ 工具执行 ↔ LLM，直到获得最终文本回复
 *
 * 流程：
 * 1. 发送 messages + tools → LLM
 * 2. 若 LLM 返回 tool_calls → 逐个执行 → 结果追加为 tool 消息 → 回到步骤 1
 * 3. 若 LLM 返回 content → 直接返回
 * 4. 最多 3 轮工具调用，防止死循环
 *
 * @param initialMessages 初始消息列表（system + context + user）
 * @param tools 可用工具列表
 * @param maxToolRounds 最大工具调用轮次（默认 3）
 * @returns 最终文本回复，失败返回 null
 */
export async function chatWithToolLoop(
  initialMessages: ChatMessage[],
  tools: typeof WORKON_TOOLS,
  maxToolRounds = 3
): Promise<string | null> {
  const messages = [...initialMessages]

  for (let round = 0; round <= maxToolRounds; round++) {
    const resp = await llmChatWithTools(messages, tools)

    // LLM 调用失败 → 回退
    if (!resp) return null

    // 无工具调用 → 返回最终内容
    if (!resp.toolCalls || resp.toolCalls.length === 0) {
      return resp.content
    }

    // 有工具调用 → 执行并追加结果
    // 先把 assistant 的 tool_calls 消息加入对话
    messages.push({
      role: 'assistant',
      content: resp.content,
      tool_calls: resp.toolCalls
    })

    // 逐个执行工具
    for (const tc of resp.toolCalls) {
      let args: Record<string, unknown> = {}
      try {
        args = tc.function.arguments ? JSON.parse(tc.function.arguments) : {}
      } catch {
        console.warn(`[ai] 工具参数解析失败: ${tc.function.name}(${tc.function.arguments})`)
      }
      console.log(`[ai] 执行工具: ${tc.function.name}`, args)
      const result = await executeTool(tc.function.name, args)
      messages.push({
        role: 'tool',
        content: result,
        tool_call_id: tc.id
      })
    }
    // 继续下一轮，让 LLM 根据工具结果生成回复
  }

  // 超过最大轮次，用普通 llmChat 兜底
  console.warn('[ai] 工具调用轮次超限，回退普通对话')
  const fallbackMessages: ChatMsg[] = messages
    .filter((m) => m.role === 'system' || m.role === 'user' || (m.role === 'assistant' && m.content))
    .map((m) => ({ role: m.role as 'system' | 'user' | 'assistant', content: (m.content ?? '') as string }))
  return llmChat(fallbackMessages)
}

// ───────────────────────── 流式输出 ─────────────────────────

/**
 * 解析 SSE 流并提取 delta
 * OpenAI SSE 格式：每行 `data: {json}`，末尾 `data: [DONE]`
 */
async function parseSSEStream(
  resp: Response,
  onChunk: (delta: string, fullText: string) => void,
  onToolCallDelta?: (toolCalls: ToolCall[]) => void
): Promise<{ content: string; toolCalls: ToolCall[] | null }> {
  const reader = resp.body!.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let fullText = ''
  const toolCallMap = new Map<number, { id: string; type: 'function'; function: { name: string; arguments: string } }>()

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })

    const lines = buffer.split('\n')
    buffer = lines.pop() || ''

    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed.startsWith('data: ')) continue
      const data = trimmed.slice(6)
      if (data === '[DONE]') continue

      try {
        const parsed = JSON.parse(data)
        const delta = parsed.choices?.[0]?.delta
        if (!delta) continue

        // 文本内容
        if (delta.content) {
          fullText += delta.content
          onChunk(delta.content, fullText)
        }

        // 工具调用（增量式，需要合并）
        if (delta.tool_calls && onToolCallDelta) {
          for (const tc of delta.tool_calls) {
            const idx = tc.index ?? 0
            if (!toolCallMap.has(idx)) {
              toolCallMap.set(idx, {
                id: tc.id ?? '',
                type: 'function',
                function: { name: tc.function?.name ?? '', arguments: tc.function?.arguments ?? '' }
              })
            } else {
              const existing = toolCallMap.get(idx)!
              if (tc.id) existing.id = tc.id
              if (tc.function?.name) existing.function.name += tc.function.name
              if (tc.function?.arguments) existing.function.arguments += tc.function.arguments
            }
          }
        }
      } catch {
        // JSON 解析失败 — 忽略不完整的 chunk
      }
    }
  }

  const toolCalls = toolCallMap.size > 0
    ? [...toolCallMap.entries()].sort((a, b) => a[0] - b[0]).map(([, v]) => v)
    : null

  return { content: fullText.trim(), toolCalls }
}

/**
 * 流式 LLM 调用（不带工具）
 * - 向 OpenAI 兼容接口发送 stream: true
 * - 逐 chunk 调用 onChunk 回调
 * - 返回完整文本
 */
export async function llmChatStream(
  messages: ChatMsg[],
  onChunk: StreamCallback,
  timeoutMs = 60000,
  complexity: TaskComplexity = 'standard'
): Promise<string | null> {
  const s = getSettings()
  if (!s.aiEnabled || !s.aiApiKey) return null
  const model = selectModel(complexity)
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const resp = await fetch(`${s.aiBaseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${s.aiApiKey}` },
      body: JSON.stringify({ model, messages, temperature: 0.4, stream: true }),
      signal: ctrl.signal
    })
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
    const { content } = await parseSSEStream(resp, onChunk)
    trackUsage(model, Math.ceil(content.length / 4) + 200, false)
    return content || null
  } catch (e) {
    console.warn('[ai] 流式 LLM 调用失败:', (e as Error).message)
    return null
  } finally {
    clearTimeout(t)
  }
}

/**
 * 流式工具调用循环（带工具的流式输出）
 *
 * 流程：
 * 1. 发送 messages + tools + stream:true → LLM
 * 2. 流式接收 content → 实时调用 onChunk
 * 3. 若 LLM 返回 tool_calls → 逐个执行 → 追加结果 → 回到步骤 1（下一轮仍流式）
 * 4. 若 LLM 返回 content → 流式输出完成后返回
 * 5. 最多 3 轮工具调用
 *
 * @param onChunk 文本增量回调（仅最终回复的文本会触发）
 * @param onToolCall 工具调用通知回调（可选，用于 UI 显示"正在查询..."）
 */
export async function chatWithToolLoopStream(
  initialMessages: ChatMessage[],
  tools: typeof WORKON_TOOLS,
  onChunk: StreamCallback,
  onToolCall?: (toolName: string) => void,
  maxToolRounds = 3
): Promise<string | null> {
  const s = getSettings()
  if (!s.aiEnabled || !s.aiApiKey) return null
  const model = selectModel('standard')
  const messages = [...initialMessages]
  let streamedAny = false // 是否已经流式输出了文本

  for (let round = 0; round <= maxToolRounds; round++) {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), 60000)
    try {
      const resp = await fetch(`${s.aiBaseUrl.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${s.aiApiKey}` },
        body: JSON.stringify({
          model,
          messages,
          temperature: 0.4,
          tools,
          tool_choice: 'auto',
          stream: true
        }),
        signal: ctrl.signal
      })
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`)

      // 只有最后一轮（无工具调用）的文本才流式输出
      // 前几轮如果有工具调用，不流式输出 content（通常是空或思考过程）
      const isLastRound = round === maxToolRounds
      const chunkCallback = (delta: string, full: string) => {
        // 如果这一轮有工具调用，不输出文本（等工具执行后再输出最终回复）
        // 但如果已经是最后一轮了，必须输出
        streamedAny = true
        onChunk(delta, full)
      }

      const { content, toolCalls } = await parseSSEStream(resp, chunkCallback)
      trackUsage(model, Math.ceil((content?.length ?? 0) / 4) + 500, false)

      // 无工具调用 → 返回最终内容
      if (!toolCalls || toolCalls.length === 0) {
        return content || null
      }

      // 有工具调用 → 取消已流式的文本（通过发送空 delta 重置）
      // 实际上 OpenAI 在有 tool_calls 时通常不返回 content，所以 streamedAny 通常为 false
      if (streamedAny) {
        // 发送重置信号：让渲染端知道之前的文本是中间过程
        onChunk('\n', content || '')
      }

      // 追加 assistant 消息
      messages.push({
        role: 'assistant',
        content: content || null,
        tool_calls: toolCalls
      })

      // 逐个执行工具
      for (const tc of toolCalls) {
        let args: Record<string, unknown> = {}
        try {
          args = tc.function.arguments ? JSON.parse(tc.function.arguments) : {}
        } catch {
          console.warn(`[ai] 工具参数解析失败: ${tc.function.name}(${tc.function.arguments})`)
        }
        console.log(`[ai] 执行工具 (stream): ${tc.function.name}`, args)
        onToolCall?.(tc.function.name)
        const result = await executeTool(tc.function.name, args)
        messages.push({
          role: 'tool',
          content: result,
          tool_call_id: tc.id
        })
      }
      // 继续下一轮
      streamedAny = false
    } catch (e) {
      console.warn('[ai] 流式工具调用失败:', (e as Error).message)
      if (streamedAny) return null // 已经流式输出了一些文本，不回退
      // 回退到非流式
      return chatWithToolLoop(messages, tools, maxToolRounds - round)
    } finally {
      clearTimeout(t)
    }
  }

  // 超过最大轮次，用普通 llmChat 兜底
  console.warn('[ai] 流式工具调用轮次超限，回退普通对话')
  const fallbackMessages: ChatMsg[] = messages
    .filter((m) => m.role === 'system' || m.role === 'user' || (m.role === 'assistant' && m.content))
    .map((m) => ({ role: m.role as 'system' | 'user' | 'assistant', content: (m.content ?? '') as string }))
  return llmChat(fallbackMessages)
}

/**
 * 从 LLM 输出中提取 JSON（v2.8 报表 AI 层用）
 * 依次尝试：① 直接 parse；② 去 ```json/``` 围栏后 parse；
 * ③ 截取首个 `[`/`{`（按先出现者）到对应末尾再 parse；全失败返回 null
 */
export function extractJson<T>(text: string): T | null {
  const tryParse = (s: string): T | null => {
    try {
      return JSON.parse(s) as T
    } catch {
      return null
    }
  }
  const trimmed = text.trim()
  // ① 直接解析
  const direct = tryParse(trimmed)
  if (direct !== null) return direct
  // ② 去 Markdown 代码围栏后解析
  const unfenced = trimmed.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim()
  if (unfenced !== trimmed) {
    const fenced = tryParse(unfenced)
    if (fenced !== null) return fenced
  }
  // ③ 截取首个 [ 到最后 ] 或首个 { 到最后 }（按先出现者）
  const iArr = trimmed.indexOf('[')
  const iObj = trimmed.indexOf('{')
  if (iArr !== -1 && (iObj === -1 || iArr < iObj)) {
    const j = trimmed.lastIndexOf(']')
    if (j > iArr) return tryParse(trimmed.slice(iArr, j + 1))
  } else if (iObj !== -1) {
    const j = trimmed.lastIndexOf('}')
    if (j > iObj) return tryParse(trimmed.slice(iObj, j + 1))
  }
  return null
}

export function buildSystemPrompt(analysis: UserAnalysis | null, habits?: UserHabits | null, intimacy = 1): string {
  const intimacyDesc =
    intimacy >= 5
      ? '像老朋友一样，可以开玩笑、主动给建议'
      : intimacy >= 3
        ? '温暖一些，可以适当关心用户（比如"你最近挺努力的"）'
        : '简洁理性，像新手助手'
  const base =
    '你是 WorkOn 的效率助手「姵儿」，了解用户的电脑使用数据，用简洁中文给出可执行建议。' +
    '你可以通过工具获取用户的实时桌面状态、今日活动摘要、计划列表、注意力评分，' +
    '也可以帮用户创建计划、完成计划、添加备忘、生成日报、显示桌宠气泡。' +
    '当用户询问"我现在在干嘛""今天怎么样""帮我记一下""创建计划"等问题时，主动调用对应工具。' +
    `语气温柔但不啰嗦，像朋友聊天。你和用户的亲密度等级是 ${intimacy}/5：${intimacyDesc}。`
  const parts: string[] = [base]

  // 第一层：当日事实画像
  if (analysis) {
    const p = analysis.profile
    parts.push(
      `【当日数据】专注力 ${p.focusScore}/100，效率 ${p.efficiencyScore}/100；` +
        `高频类别：${p.topCategories.join('、') || '暂无'}；高效时段：${p.bestHours.map((h) => h + ':00').join('、') || '未知'}；` +
        `双屏：${p.dualScreen.isRegularDual ? `常态双屏（主屏${p.dualScreen.mainWork}、副屏${p.dualScreen.auxActivity}）` : '单屏为主'}。`
    )
  }

  // 第二层：个人习惯画像（近 7 天自动推断）
  if (habits) {
    const lines: string[] = []
    if (habits.lunchTime) lines.push(`通常 ${habits.lunchTime} 左右午休`)
    if (habits.meetingTimes?.length) lines.push(`常见会议时段：${habits.meetingTimes.join('、')}`)
    if (habits.preferredWorkHours) lines.push(`偏好工作时段：${habits.preferredWorkHours}`)
    if (habits.commonBreakApps?.length) lines.push(`休息时常用：${habits.commonBreakApps.join('、')}`)
    if (habits.workStyle) lines.push(`工作风格：${habits.workStyle}`)
    if (lines.length) parts.push(`【个人习惯】${lines.join('；')}。`)
  }

  // 第三层：用户画像（v2.7 脱敏网关：L0 原样 / L1 摘要 / L2 聚合；画像不可用时静默跳过）
  try {
    const { data } = requestPersonaData({ requester: 'companion', layers: ['L0', 'L1', 'L2'], fields: [], intent: 'system_prompt' })
    if (data.length) parts.push(`【用户画像】${data.map((d) => d.value).join('；')}。`)
  } catch { /* 画像缺失不影响 prompt 构建 */ }

  return parts.join('\n')
}

/** 从近 7 天轨迹自动推断个人习惯画像 */
export function deriveHabits(trails: MergedTrail[]): UserHabits {
  const habits: UserHabits = { lastUpdated: Date.now() }
  if (!trails.length) return habits

  const mode = (arr: number[]): number => {
    const freq: Record<number, number> = {}
    for (const v of arr) freq[v] = (freq[v] || 0) + 1
    return +Object.entries(freq).sort((a, b) => b[1] - a[1])[0][0]
  }

  // 午休时段：lunch/break 状态的高频小时
  const lunchHours = trails.flatMap((t) =>
    t.segments.filter((s) => s.mainState === 'lunch' || s.mainState === 'break').map((s) => new Date(s.startTs).getHours())
  )
  if (lunchHours.length >= 3) {
    const peak = mode(lunchHours)
    habits.lunchTime = `${peak}:00-${peak + 1}:00`
  }

  // 会议时段
  const meetingHours = trails.flatMap((t) =>
    t.segments.filter((s) => s.mainState === 'meeting' || s.mainState === 'remote').map((s) => new Date(s.startTs).getHours())
  )
  if (meetingHours.length >= 2) {
    habits.meetingTimes = [...new Set(meetingHours)].sort((a, b) => a - b).map((h) => `${h}:00`)
  }

  // 工作风格
  const avgDualRatio = trails.reduce((a, t) => a + t.dualRatio, 0) / trails.length
  if (avgDualRatio > 0.3) habits.workStyle = '双屏并行型'
  else if (trails.some((t) => (t.stateMinutes.focus ?? 0) > 120)) habits.workStyle = '连续专注型'
  else habits.workStyle = '节奏平衡型'

  // 休息时常用应用
  const breakApps = trails.flatMap((t) =>
    t.segments.filter((s) => SLACK_STATES.includes(s.mainState)).map((s) => s.mainApp)
  )
  habits.commonBreakApps = [...new Set(breakApps)].slice(0, 5)

  // 偏好工作时段（Top3 小时）
  const allWorkHours = trails.flatMap((t) =>
    t.segments.filter((s) => WORK_LIKE_STATES.includes(s.mainState)).map((s) => new Date(s.startTs).getHours())
  )
  const topHours = [...new Set(allWorkHours)]
    .map((h) => ({ h, count: allWorkHours.filter((x) => x === h).length }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 3)
    .map((x) => `${x.h}:00`)
  if (topHours.length) habits.preferredWorkHours = topHours.join(' / ')

  habits.dailyAverageWorkMin = Math.round(
    trails.reduce((a, t) => a + WORK_LIKE_STATES.reduce((b, s) => b + (t.stateMinutes[s] ?? 0), 0), 0) / trails.length
  )
  habits.dailyAverageSlackMin = Math.round(
    trails.reduce((a, t) => a + SLACK_STATES.reduce((b, s) => b + (t.stateMinutes[s] ?? 0), 0), 0) / trails.length
  )
  return habits
}

/** 生成/刷新当日画像：LLM 优先，失败回退规则 */
export async function analyzeDay(trail: MergedTrail): Promise<UserAnalysis> {
  const fallback = ruleAnalyze(trail)
  const facts = aggregateFacts(trail)
  const text = await llmChat([
    { role: 'system', content: '你是效率分析师。根据用户当日电脑使用事实 JSON，输出：1) 100字内小结 2) 3条可执行建议。' },
    { role: 'user', content: JSON.stringify(facts) }
  ], 45000, 'complex')
  if (!text) return fallback
  const lines = text.split('\n').map((l) => l.replace(/^[-*\d.\s]+/, '').trim()).filter(Boolean)
  return {
    ...fallback,
    daily: lines[0] ?? fallback.daily,
    suggestions: lines.slice(1, 4).length ? lines.slice(1, 4) : fallback.suggestions,
    source: 'llm'
  }
}

/** AI 分类兜底：对「other」且标题非通用的段批量推断主态，存独立推断表（不污染热轨迹） */
export async function inferOtherCategories(date: string): Promise<void> {
  const s = getSettings()
  if (!s.aiEnabled || !s.aiApiKey) return
  const trail = buildMergedTrail(listActivities(date), date)
  const cands = trail.segments.filter(
    (sg) => sg.mainState === 'other' && !!sg.mainTitle && sg.mainTitle.length > 3 && !/^(explorer|workon|workbuddy)$/i.test(sg.mainApp)
  )
  if (!cands.length) return
  const prompt =
    `你是分类助手。对以下"其他"态工作段，推断最可能的主态(从 focus/coding/aidev/aiqa/writing/meeting/remote/slack/relax 中选)与微活动标签。返回 JSON 数组，每项 {seg:序号,category,mic,conf}。段：\n` +
    cands.map((c, i) => `${i}. [${c.mainApp}] ${c.mainTitle}`).join('\n')
  const text = await llmChat(
    [{ role: 'system', content: '只返回 JSON 数组，不要解释。' }, { role: 'user', content: prompt }],
    30000, 'fast'
  )
  if (!text) return
  const arr = extractJson<{ seg: number; category: string; mic?: string; conf: number }[]>(text)
  if (!arr) return
  for (const it of arr) {
    const c = cands[it.seg]
    if (!c) continue
    const cat = (ALL_STATES as string[]).includes(it.category) ? (it.category as WorkState) : 'other'
    insertInto<CategoryInference>('categoryInferences', {
      id: `${date}:${c.id ?? 's' + c.startTs}`,
      date,
      segId: c.id ?? 's' + c.startTs,
      app: c.mainApp,
      title: c.mainTitle ?? '',
      category: cat,
      microActivity: it.mic ?? null,
      confidence: Math.max(0, Math.min(1, it.conf ?? 0.5)),
      ts: Date.now()
    })
  }
}

// ───────────────────────── 轻问诊 ─────────────────────────
// 实现已拆分到 qa/questionGenerator.ts（场景模板 + persona_gap + 作业链路检测）

/** 由双屏情境生成一条确认型问题；已确认过的情境不再追问（越用越聪明） */
export function genQuestion(ctx: string): { id: string; ctx: string; question: string } | null {
  // 已拆分到 qa/questionGenerator.ts（含 persona_gap 与作业链路检测）
  return genQuestionImpl(ctx)
}

export function recordFeedback(qid: string, ctx: string, question: string, answer: 'yes' | 'no'): UserFeedback {
  return recordFeedbackImpl(qid, ctx, question, answer)
}

// ───────────────────────── 问答 / 待办 / 提示 ─────────────────────────

/** 本地模式问答（AI 未配置时）：按问题类型返回真实统计，复杂问题给配置引导 */
function localAnswer(question: string, facts: Record<string, unknown> | null, trail: MergedTrail | null): string {
  if (!facts || !trail) return '今日还没有足够数据，晚些再问我吧。'
  const f = facts as {
    totalMin: number; workMin: number; slackMin: number; dualRatio: number
    dualWorkSlackMin: number; topApps: [string, number][]; bestHours: number[]; mainState: string
  }
  const q = question.toLowerCase()
  const topList = f.topApps.slice(0, 5).map(([a, m]) => `${a}（${m}分钟）`).join('、')
  if (/专注|focus|效率/.test(q)) {
    const pct = f.totalMin > 0 ? Math.round((f.workMin / f.totalMin) * 100) : 0
    return `今日工作 ${f.workMin} 分钟 / 墙钟 ${f.totalMin} 分钟（专注占比 ${pct}%）。${f.bestHours.length ? `高效时段：${f.bestHours.map((h) => `${h}:00`).join(' / ')}。` : ''}`
  }
  if (/摸鱼|娱乐|slack|偷懒/.test(q)) {
    return `今日摸鱼 ${f.slackMin} 分钟${f.dualWorkSlackMin > 0 ? `，其中主工作+副摸鱼并行 ${f.dualWorkSlackMin} 分钟` : ''}。${f.slackMin > 60 ? '超过 1 小时了，要不要把娱乐集中到固定时段？' : '控制得不错～'}`
  }
  if (/应用|app|软件|常用|用得最多/.test(q)) {
    return topList ? `今日最常用的应用：${topList}。` : '今日还没有应用使用记录。'
  }
  if (/时段|什么时候|几点|最高效|状态最好/.test(q)) {
    return f.bestHours.length ? `你的高效时段通常在 ${f.bestHours.map((h) => `${h}:00`).join(' / ')}，重要工作建议安排在这些时间。` : '数据还不足，明天就能告诉你高效时段了。'
  }
  if (/双屏|副屏|并行/.test(q)) {
    return `今日双屏并行占比 ${f.dualRatio}%${f.dualWorkSlackMin > 0 ? `，主工作+副摸鱼并行 ${f.dualWorkSlackMin} 分钟` : ''}。`
  }
  if (/计划|plan|目标/.test(q)) {
    return '计划详情可以在「计划」页查看达成率与预测；监控页的时间轴上也能看到计划时段的虚线框哦。'
  }
  return `本地小结：今日墙钟 ${f.totalMin} 分钟，工作 ${f.workMin} 分钟，摸鱼 ${f.slackMin} 分钟。这个问题需要 AI 才能深入回答，去「设置 → AI」配置后即可解锁。`
}

export async function askWithContext(
  question: string,
  analysis: UserAnalysis | null,
  trail: MergedTrail | null,
  habits?: UserHabits | null
): Promise<{ content: string | null; references: ProfileReference[] }> {
  insertInto<QAMessage>('qa', { id: genId('qa'), role: 'user', content: question, ts: Date.now() })
  // v2.7：画像引用经脱敏网关取数；LLM 成功/规则回退都带 references（system prompt 已注入画像）
  let references: ProfileReference[] = []
  try {
    const { data } = requestPersonaData({ requester: 'ai_qa', layers: ['L0', 'L1', 'L2'], fields: [], intent: 'qa' })
    // 剥掉 value：脱敏文本保留在 summary 中，调用方只见 ProfileReference 四字段
    references = data.map(({ layer, field, logId, summary }) => ({ layer, field, logId, summary }))
  } catch { /* 画像不可用不阻塞问答 */ }
  const facts = trail ? aggregateFacts(trail) : null
  const confirmed = col<UserFeedback>('feedbacks').filter((f) => f.answer === 'yes').slice(-5)
  const recentQA = col<QAMessage>('qa').slice(-6)
  const llm = await chatWithToolLoop([
    { role: 'system', content: buildSystemPrompt(analysis, habits, bus.pet.intimacy) },
    ...(facts ? [{ role: 'user' as const, content: `（当日事实）${JSON.stringify(facts)}` }] : []),
    ...(confirmed.length
      ? [{ role: 'user' as const, content: `（已确认偏好）${confirmed.map((f) => `${f.question}→是`).join('；')}` }]
      : []),
    ...recentQA.map((q) => ({ role: q.role as 'user' | 'assistant', content: q.content.slice(0, 80) })),
    { role: 'user', content: question }
  ], WORKON_TOOLS)
  const answer = llm ?? localAnswer(question, facts, trail)
  trackUsage(getSettings().aiModel, Math.ceil((question.length + answer.length) / 4), true)
  insertInto<QAMessage>('qa', { id: genId('qa'), role: 'assistant', content: answer, ts: Date.now() })
  return { content: answer, references }
}

/**
 * 问答（流式版本）— 逐字输出到回调
 * 当 settings.aiStreaming 为 true 时由 IPC 层调用
 */
export async function askWithContextStream(
  question: string,
  analysis: UserAnalysis | null,
  trail: MergedTrail | null,
  onChunk: StreamCallback,
  onToolCall?: (toolName: string) => void,
  habits?: UserHabits | null
): Promise<{ content: string; references: ProfileReference[] }> {
  insertInto<QAMessage>('qa', { id: genId('qa'), role: 'user', content: question, ts: Date.now() })
  let references: ProfileReference[] = []
  try {
    const { data } = requestPersonaData({ requester: 'ai_qa', layers: ['L0', 'L1', 'L2'], fields: [], intent: 'qa' })
    references = data.map(({ layer, field, logId, summary }) => ({ layer, field, logId, summary }))
  } catch { /* 画像不可用不阻塞问答 */ }
  const facts = trail ? aggregateFacts(trail) : null
  const confirmed = col<UserFeedback>('feedbacks').filter((f) => f.answer === 'yes').slice(-5)
  const recentQA = col<QAMessage>('qa').slice(-6)
  const llm = await chatWithToolLoopStream(
    [
      { role: 'system', content: buildSystemPrompt(analysis, habits, bus.pet.intimacy) },
      ...(facts ? [{ role: 'user' as const, content: `（当日事实）${JSON.stringify(facts)}` }] : []),
      ...(confirmed.length
        ? [{ role: 'user' as const, content: `（已确认偏好）${confirmed.map((f) => `${f.question}→是`).join('；')}` }]
        : []),
      ...recentQA.map((q) => ({ role: q.role as 'user' | 'assistant', content: q.content.slice(0, 80) })),
      { role: 'user', content: question }
    ],
    WORKON_TOOLS,
    onChunk,
    onToolCall,
    3
  )
  const answer = llm ?? localAnswer(question, facts, trail)
  trackUsage(getSettings().aiModel, Math.ceil((question.length + answer.length) / 4), true)
  insertInto<QAMessage>('qa', { id: genId('qa'), role: 'assistant', content: answer, ts: Date.now() })
  return { content: answer, references }
}

export function generateTodos(analysis: UserAnalysis): string[] {
  const todos: string[] = []
  if (analysis.profile.focusScore < 60) todos.push('上午先完成 1 个 25 分钟番茄钟再开 IM')
  if (analysis.profile.dualScreen.workSlackRatio > 0.2) todos.push('副屏娱乐集中在午休时段')
  for (const s of analysis.suggestions.slice(0, 2)) todos.push(s)
  return todos.slice(0, 4)
}

export function generateTips(analysis: UserAnalysis): string[] {
  const tips: string[] = []
  if (analysis.profile.bestHours.length) tips.push(`高效时段：${analysis.profile.bestHours.map((h) => `${h}:00`).join(' / ')}`)
  if (analysis.profile.distractingApps.length) tips.push(`易分心应用：${analysis.profile.distractingApps.join('、')}`)
  return tips
}

/** AI 连通性测试（设置页「测试连接」按钮） */
export async function testAIConnection(): Promise<{
  ok: boolean
  latency?: number
  model?: string
  error?: string
  hint?: string
}> {
  const s = getSettings()
  if (!s.aiApiKey) return { ok: false, error: '未配置 API Key' }
  const start = Date.now()
  try {
    const resp = await fetch(`${s.aiBaseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${s.aiApiKey}` },
      body: JSON.stringify({
        model: s.aiModel,
        messages: [{ role: 'user', content: '回复"OK"两个字' }],
        max_tokens: 10,
        temperature: 0
      }),
      signal: AbortSignal.timeout(15000)
    })
    const latency = Date.now() - start
    if (!resp.ok) {
      const errText = await resp.text().catch(() => '')
      const error = `HTTP ${resp.status}: ${errText.slice(0, 100)}`
      const hint =
        resp.status === 401
          ? '请检查 API Key 是否正确'
          : resp.status === 404
            ? '请检查模型名是否存在'
            : undefined
      return { ok: false, latency, error, hint }
    }
    return { ok: true, latency, model: s.aiModel }
  } catch (e) {
    const msg = (e as Error).message
    const hint = /ENOTFOUND|ECONNREFUSED/.test(msg)
      ? '请检查 Base URL 是否正确'
      : /abort|timeout/i.test(msg)
        ? '连接超时，请检查网络或 Base URL'
        : undefined
    return { ok: false, latency: Date.now() - start, error: msg, hint }
  }
}

/** 桌宠短回复问答（Saybox / 悬浮窗折叠态）：姵儿口吻，≤50 字，融入习惯画像/亲密度/近期对话 */
export async function petAskShort(question: string, habits?: UserHabits | null): Promise<string> {
  const s = getSettings()
  if (!s.aiEnabled || !s.aiApiKey) return '还没配置 AI 模型哦~ 去设置里看看吧！'
  insertInto('qa', { id: genId('qa'), role: 'user', content: question, ts: Date.now() })
  const recentQA = col<QAMessage>('qa').slice(-4)
  const answer = await chatWithToolLoop(
    [
      {
        role: 'system',
        content:
          '你是桌宠姵儿，猫耳耳机少女，用可爱简洁的中文回答，控制在 50 字以内，可带少量 emoji。' +
          '工作相关问题给实用建议；闲聊就陪她聊。' +
          '你可以通过工具查看用户当前状态、帮用户添加备忘、显示气泡消息。' +
          '用户问"我在干嘛"时调用 get_presence，说"帮我记"时调用 add_memo。' +
          '天气、新闻、股价等实时问题，可爱地说明"我查不了实时信息哦"。' +
          `你和用户的亲密度 ${bus.pet.intimacy}/5，${bus.pet.intimacy >= 3 ? '可以亲昵一点' : '礼貌一点'}。` +
          (habits?.preferredWorkHours ? `用户偏好工作时段：${habits.preferredWorkHours}。` : '') +
          (habits?.lunchTime ? `通常 ${habits.lunchTime} 午休。` : '') +
          (habits?.workStyle ? `工作风格：${habits.workStyle}。` : '')
      },
      ...recentQA.map((q) => ({ role: q.role as 'user' | 'assistant', content: q.content.slice(0, 60) })),
      { role: 'user', content: question }
    ],
    PET_TOOLS,
    2 // 桌宠场景最多 2 轮工具调用，控制延迟
  )
  // 注意：petAskShort 不使用 complexity 参数因为 chatWithToolLoop 内部使用标准模型
  // 如需使用快速模型，可在 chatWithToolLoop 增加 complexity 参数
  insertInto('qa', {
    id: genId('qa'),
    role: 'assistant',
    content: answer ?? '嗯…让我想想，稍后再问我吧~',
    ts: Date.now()
  })
  return answer ?? '嗯…我想不出来呢，稍后再问我吧~'
}

/** 桌宠短回复问答（流式版本） — 逐字输出到回调 */
export async function petAskShortStream(
  question: string,
  onChunk: StreamCallback,
  habits?: UserHabits | null
): Promise<string> {
  const s = getSettings()
  if (!s.aiEnabled || !s.aiApiKey) {
    onChunk('还没配置 AI 模型哦~ 去设置里看看吧！', '还没配置 AI 模型哦~ 去设置里看看吧！')
    return '还没配置 AI 模型哦~ 去设置里看看吧！'
  }
  insertInto('qa', { id: genId('qa'), role: 'user', content: question, ts: Date.now() })
  const recentQA = col<QAMessage>('qa').slice(-4)
  const answer = await chatWithToolLoopStream(
    [
      {
        role: 'system',
        content:
          '你是桌宠姵儿，猫耳耳机少女，用可爱简洁的中文回答，控制在 50 字以内，可带少量 emoji。' +
          '工作相关问题给实用建议；闲聊就陪她聊。' +
          '你可以通过工具查看用户当前状态、帮用户添加备忘、显示气泡消息。' +
          '用户问"我在干嘛"时调用 get_presence，说"帮我记"时调用 add_memo。' +
          `你和用户的亲密度 ${bus.pet.intimacy}/5，${bus.pet.intimacy >= 3 ? '可以亲昵一点' : '礼貌一点'}。` +
          (habits?.preferredWorkHours ? `用户偏好工作时段：${habits.preferredWorkHours}。` : '') +
          (habits?.lunchTime ? `通常 ${habits.lunchTime} 午休。` : '') +
          (habits?.workStyle ? `工作风格：${habits.workStyle}。` : '')
      },
      ...recentQA.map((q) => ({ role: q.role as 'user' | 'assistant', content: q.content.slice(0, 60) })),
      { role: 'user', content: question }
    ],
    PET_TOOLS,
    onChunk,
    undefined,
    2
  )
  insertInto('qa', {
    id: genId('qa'),
    role: 'assistant',
    content: answer ?? '嗯…让我想想，稍后再问我吧~',
    ts: Date.now()
  })
  return answer ?? '嗯…我想不出来呢，稍后再问我吧~'
}

/** 浏览器标题 → 计划关键词匹配（问题 7：浏览器行为触发计划确认） */
export function extractPlanKeywords(title: string): string[] {
  const cleaned = title.replace(/[\[\]【】()（）]/g, ' ').trim()
  const stopWords = ['的', '了', '和', '与', '在', '进行', '完成', '工作', '任务']
  const words = cleaned.split(/[\s，,、:：-]+/).filter((w) => w.length > 1 && !stopWords.includes(w))
  const english = words.filter((w) => /[a-z]/i.test(w))
  return english.length > 0 ? english : words
}

export function matchBrowserToPlan(
  app: string,
  title: string,
  todayPlans: PlanItem[]
): { plan: PlanItem; confidence: number; keyword: string } | null {
  if (!/chrome|edge|firefox|opera|brave|arc|msedge/i.test(app)) return null
  const active = todayPlans.filter((p) => p.status === 'planned' && !p.confirmedFromQA)
  for (const plan of active) {
    const keywords = extractPlanKeywords(plan.title)
    for (const kw of keywords) {
      if (title.toLowerCase().includes(kw.toLowerCase())) {
        return { plan, confidence: keywords.length === 1 ? 0.9 : 0.7, keyword: kw }
      }
    }
  }
  return null
}

/** 问答确认 → 创建/更新计划（问题 15：区分浏览器确认与手动确认） */
export function confirmToPlan(
  ctx: string,
  question: string,
  browserInfo?: { app: string; title: string }
): PlanItem | null {
  const planInfo = parseContextToPlan(ctx, browserInfo)
  if (!planInfo) return null
  const today = dateKey(Date.now())

  // 已存在同同情境计划 → 更新备注，不重复创建
  const existing = col<PlanItem>('plans').find(
    (p) => p.date === today && p.confirmContext === ctx && p.status !== 'cancelled'
  )
  if (existing) {
    updateIn<PlanItem>('plans', existing.id, {
      note: (existing.note ?? '') + `\n[QA确认] ${new Date().toLocaleTimeString('zh-CN', { hour12: false })}`
    })
    return existing
  }

  const plan: PlanItem = {
    id: genId('plan'),
    date: today,
    title: planInfo.title,
    category: planInfo.category,
    startMin: new Date().getHours() * 60 + new Date().getMinutes(),
    status: 'planned',
    source: 'qa-confirm',
    confirmedFromQA: true,
    confirmContext: ctx,
    browserDerived: !!browserInfo,
    note: browserInfo ? `浏览器确认: ${browserInfo.app} - ${browserInfo.title.slice(0, 60)}` : `手动确认: ${question.slice(0, 40)}`,
    ts: Date.now()
  }
  insertInto('plans', plan)
  return plan
}

function parseContextToPlan(
  ctx: string,
  browserInfo?: { app: string; title: string }
): { title: string; category: string } | null {
  if (browserInfo) {
    const t = browserInfo.title
    if (/deploy|部署|发布|jenkins/i.test(t)) return { title: '部署工作', category: 'ai-dev' }
    if (/jira|ticket|bug|工单/i.test(t)) return { title: '问题处理', category: 'work-customer' }
    if (/doc|文档|wiki|confluence|notion/i.test(t)) return { title: '文档编写', category: 'work-customer' }
    if (/会议|meeting|zoom|teams/i.test(t)) return { title: '会议', category: 'leader' }
    return { title: `浏览器工作: ${t.slice(0, 24)}`, category: 'other' }
  }
  if (ctx.includes('aidev')) return { title: 'AI 开发', category: 'ai-dev' }
  if (ctx.includes('coding')) return { title: '编程开发', category: 'ai-dev' }
  if (ctx.includes('meeting')) return { title: '会议', category: 'leader' }
  if (ctx.includes('writing')) return { title: '文档编写', category: 'work-customer' }
  return null
}
