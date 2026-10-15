/**
 * 会话（v10）：气泡/消息右键加入会话，成为可继续追问的 session。
 * 存储 db.json chatSessions 集合；主题三枚举（project/life/general）供归档分组。
 * 标题规则版=首条消息首句截断；AI 总结标题（aiEnabled 时异步替换）留 TODO。
 */
import { col, insertInto, updateIn, removeFrom } from './db'
import { genId } from '@shared/types'
import type { ChatSession, ChatSessionItem } from '@shared/types'
import { llmChat } from './ai'
import { getSettings } from './settings'

/** AI 总结标题（fire-and-forget）：aiEnabled 时把规则标题换成 ≤12 字总结；失败静默保留规则标题 */
function aiSummarizeTitle(sessionId: string, source: string): void {
  const s = getSettings()
  if (!s.aiEnabled || !s.aiApiKey) return
  void llmChat(
    [{ role: 'user', content: `把下面这句话总结成一个不超过 12 个字的会话标题，直接回标题本身，不要引号不要句号：\n${source.slice(0, 120)}` }],
    20_000,
    'fast'
  )
    .then((t) => {
      const title = (t ?? '').trim().replace(/^["'「『]|["'」』]$/g, '')
      if (title && title.length <= 20) {
        updateIn<ChatSession>('chatSessions', sessionId, { title })
        console.info(`[sessions] AI 标题: ${title}`)
      }
    })
    .catch(() => { /* 静默 */ })
}

export function listChatSessions(): ChatSession[] {
  return col<ChatSession>('chatSessions').slice().sort((a, b) => b.updatedAt - a.updatedAt)
}

function ruleTitle(text: string): string {
  const clean = text.replace(/\s+/g, ' ').trim()
  if (clean.length <= 20) return clean
  const cut = clean.slice(0, 20)
  const at = Math.max(cut.lastIndexOf(' '), cut.lastIndexOf('，'), cut.lastIndexOf('、'), cut.lastIndexOf('。'))
  return (at >= 8 ? cut.slice(0, at) : cut) + '…'
}

export function createChatSession(input: {
  title?: string
  topic?: ChatSession['topic']
  projectId?: string
  first?: ChatSessionItem
}): ChatSession {
  const now = Date.now()
  const first = input.first
  // 标题优先用户消息（QA BUG-3：AI 开场白当标题没意义）
  const titleSrc = first && first.role === 'user' ? first.text : (input.title ?? first?.text ?? '')
  const s: ChatSession = {
    id: genId('cs'),
    title: ruleTitle(input.title || titleSrc || '新会话'),
    topic: input.topic ?? 'general',
    projectId: input.projectId,
    items: first ? [first] : [],
    createdAt: now,
    updatedAt: now
  }
  insertInto('chatSessions', s)
  if (first?.text) aiSummarizeTitle(s.id, first.text)
  return s
}

export function addChatSessionItem(id: string, item: ChatSessionItem): ChatSession | null {
  const s = col<ChatSession>('chatSessions').find((x) => x.id === id)
  if (!s) return null
  // 首条用户消息到达且标题还是默认「新会话」时补一次 AI 总结
  // 标题规则化：首条 user 消息到达时，若标题还是 AI 文本截断（>20 字或含句号）则替换
  const shouldTitle = item.role === 'user' && (s.title === '新会话' || !s.title || s.title.length > 20 || /[。！？]/.test(s.title))
  s.items.push(item)
  const r = updateIn<ChatSession>('chatSessions', id, { items: s.items, updatedAt: Date.now() })
  if (shouldTitle) {
    updateIn<ChatSession>('chatSessions', id, { title: ruleTitle(item.text) })
    aiSummarizeTitle(id, item.text)
  }
  return r
}

export function removeChatSession(id: string): boolean {
  return removeFrom('chatSessions', id)
}

export function renameChatSession(id: string, title: string): ChatSession | null {
  return updateIn<ChatSession>('chatSessions', id, { title: title.slice(0, 24) })
}
