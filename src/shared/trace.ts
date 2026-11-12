/**
 * AI 处理轨迹（PipelineTrace）类型与裁剪工具
 * 主进程记录、预加载桥、渲染端隧道共用；本文件不引入 electron / node 依赖。
 */

export type TraceSource = 'qa' | 'today' | 'plan' | 'pet'

/** 增量事件阶段：input → route → round → tool → output → end */
export type TracePhase = 'input' | 'route' | 'round' | 'tool' | 'output' | 'end'

export interface TraceToolCall {
  /** 能力插件 id（即 Function Calling 工具名） */
  name: string
  args: Record<string, unknown>
  ok: boolean
  ms: number
  resultPreview: string
  error?: string
}

export interface TraceRound {
  round: number
  model: string
  toolCalls: TraceToolCall[]
}

export interface PipelineTrace {
  id: string
  parentId?: string
  ts: number
  source: TraceSource
  input: { text: string; keywords: string[] }
  route: { decided: 'llm' | 'local'; reason?: string; domain?: string }
  rounds: TraceRound[]
  output: { text: string; tokens?: number; fallback?: boolean }
}

/** main → renderer 的增量推送载荷（每次携带完整快照，渲染端直接替换） */
export interface TraceEvent {
  traceId: string
  phase: TracePhase
  trace: PipelineTrace
}

export const TRACE_PREVIEW_MAX = 200
export const TRACE_ARGS_MAX = 120
export const TRACE_INPUT_MAX = 500
export const TRACE_BUFFER_SIZE = 50

/** 敏感工具：参数只保留字段名与规模，不保留原值 */
const SENSITIVE_TOOLS = new Set(['get_presence', 'get_focused_element'])

export function clipText(v: string, max = TRACE_PREVIEW_MAX): string {
  return v.length <= max ? v : `${v.slice(0, max)}…`
}

/** 参数摘要：字符串截断；敏感工具只留形状 */
export function summarizeArgs(name: string, args: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(args)) {
    if (SENSITIVE_TOOLS.has(name)) {
      out[k] = typeof v === 'string' ? `<${v.length} 字符>` : Array.isArray(v) ? `<${v.length} 项>` : '—'
      continue
    }
    if (typeof v === 'string') out[k] = clipText(v, TRACE_ARGS_MAX)
    else if (Array.isArray(v)) out[k] = v.slice(0, 5).map((x) => (typeof x === 'string' ? clipText(x, TRACE_ARGS_MAX) : x))
    else out[k] = v
  }
  return out
}

const STOP_WORDS = new Set(['的', '了', '和', '与', '在', '是', '我', '你', '他', '这', '那', '有', '吗', '呢', '吧', '请', '帮', '一下'])

/** 领域词表：规则版关键词优先命中这些词，避免把整句问题当成一个关键词 */
const DOMAIN_WORDS = [
  '专注', '摸鱼', '效率', '计划', '项目', '应用', '工作', '回顾', '统计',
  '报表', '时间', '状态', '总结', '安排', '推荐', '天气', '备忘', '注意力',
  '轨迹', '双屏', '番茄', '会议', '日历', '画像'
]

/** 关键词抽取（P0 规则版：拉丁词 + 领域词 + 短中文词组） */
export function extractTraceKeywords(text: string): string[] {
  const latin = text.match(/[A-Za-z][A-Za-z0-9_+-]{1,}/g) ?? []
  const domain = DOMAIN_WORDS.filter((w) => text.includes(w))
  const cleaned = text.replace(/[\[\]【】()（）「」“”]/g, ' ').trim()
  const words = cleaned
    .split(/[\s，,、:：;；!！?？.。/\\-]+/)
    // 超过 6 字的中文片段是句子而非关键词，直接丢弃
    .filter((w) => w.length > 1 && w.length <= 6 && !STOP_WORDS.has(w))
    .filter((w) => /[\u4e00-\u9fa5]/.test(w))
  return [...new Set([...latin, ...domain, ...words])].slice(0, 5)
}
