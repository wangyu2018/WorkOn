/**
 * 会话（v10）：气泡/消息右键加入会话，成为可继续追问的 session。
 * 存储 db.json chatSessions 集合；主题三枚举（project/life/general）供归档分组。
 * 标题规则版=首条消息首句截断；AI 总结标题（aiEnabled 时异步替换）留 TODO。
 */
import { col, insertInto, updateIn, removeFrom } from './db'
import { genId } from '@shared/types'
import type { ChatSession, ChatSessionItem } from '@shared/types'

export function listChatSessions(): ChatSession[] {
  return col<ChatSession>('chatSessions').slice().sort((a, b) => b.updatedAt - a.updatedAt)
}

export function createChatSession(input: {
  title?: string
  topic?: ChatSession['topic']
  projectId?: string
  first?: ChatSessionItem
}): ChatSession {
  const now = Date.now()
  const first = input.first
  const s: ChatSession = {
    id: genId('cs'),
    title: (input.title || first?.text || '新会话').slice(0, 24),
    topic: input.topic ?? 'general',
    projectId: input.projectId,
    items: first ? [first] : [],
    createdAt: now,
    updatedAt: now
  }
  insertInto('chatSessions', s)
  return s
}

export function addChatSessionItem(id: string, item: ChatSessionItem): ChatSession | null {
  const s = col<ChatSession>('chatSessions').find((x) => x.id === id)
  if (!s) return null
  s.items.push(item)
  return updateIn<ChatSession>('chatSessions', id, { items: s.items, updatedAt: Date.now() })
}

export function removeChatSession(id: string): boolean {
  return removeFrom('chatSessions', id)
}

export function renameChatSession(id: string, title: string): ChatSession | null {
  return updateIn<ChatSession>('chatSessions', id, { title: title.slice(0, 24) })
}
