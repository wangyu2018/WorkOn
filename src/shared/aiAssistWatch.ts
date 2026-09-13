/**
 * AI 编程助手监控：可开关名单 + 忙碌/完成判定（供 main / UI 共用）
 */
export type AiAssistStatus = 'off' | 'idle' | 'busy' | 'done'

export interface AiAssistItem {
  /** 进程名（小写、无 .exe） */
  key: string
  /** 展示名 */
  label: string
  status: AiAssistStatus
  /** 最近窗口标题（有则带上） */
  title?: string
  /** done 状态到期时间戳（前端可本地闪到点） */
  doneUntil?: number
}

/** 默认可选池（未进监控行的候选） */
export const AI_ASSIST_POOL: { key: string; label: string }[] = [
  { key: 'cursor', label: 'Cursor' },
  { key: 'claude', label: 'Claude' },
  { key: 'chatgpt', label: 'ChatGPT' },
  { key: 'windsurf', label: 'Windsurf' },
  { key: 'trae', label: 'Trae' },
  { key: 'zcode', label: 'ZCode' },
  { key: 'codex', label: 'Codex' },
  { key: 'cline', label: 'Cline' },
  { key: 'codebuddy', label: 'CodeBuddy' },
  { key: 'opencode', label: 'OpenCode' },
  { key: 'qoder', label: 'Qoder' },
  { key: 'gemini', label: 'Gemini' },
  { key: 'kimi', label: 'Kimi' },
  { key: 'aider', label: 'Aider' }
]

/** 窗口标题像「正在生成 / Agent 跑着」 */
export const AI_ASSIST_BUSY_TITLE =
  /generat|thinking|running|streaming|compos(er|ing)|agent|in progress|working|processing|生成中|思考中|运行中|处理中|编写中|回复中|正在/i

export function normalizeAssistKey(app: string): string {
  return String(app || '')
    .trim()
    .toLowerCase()
    .replace(/\.exe$/i, '')
}

export function labelOfAssist(key: string): string {
  const k = normalizeAssistKey(key)
  return AI_ASSIST_POOL.find((p) => p.key === k)?.label ?? k
}

export function isAssistBusyTitle(title?: string): boolean {
  const t = (title || '').trim()
  if (!t) return false
  return AI_ASSIST_BUSY_TITLE.test(t)
}
