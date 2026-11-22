/**
 * 会话（v10）：气泡/消息右键加入会话，成为可继续追问的 session。
 * 存储 db.json chatSessions 集合；主题三枚举（project/life/general）供归档分组。
 * 标题规则版=首条消息首句截断；AI 总结标题（aiEnabled 时异步替换）留 TODO。
 */
import { col, insertInto, updateIn, removeFrom } from './db'
import { genId } from '@shared/types'
import type { ChatSession, ChatSessionItem, SessionTarget } from '@shared/types'
import { llmChat } from './ai'
import { getSettings } from './settings'
import { aiCredsReady } from '@shared/aiConfig'

/** AI 总结标题（fire-and-forget）：aiEnabled 时把规则标题换成 ≤12 字总结；失败静默保留规则标题 */
function aiSummarizeTitle(sessionId: string, source: string): void {
  const s = getSettings()
  if (!s.aiEnabled || !aiCredsReady(s)) return
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
  target?: SessionTarget
  first?: ChatSessionItem
  participants?: string[]
  parentSessionId?: string
}): ChatSession {
  const now = Date.now()
  const first = input.first
  const parent = input.parentSessionId
    ? col<ChatSession>('chatSessions').find((x) => x.id === input.parentSessionId)
    : undefined
  // 子会话继承上游上下文：快照上游最近 10 条，再追加首条新消息
  const inherited = parent ? parent.items.slice(-10).map((m) => ({ ...m })) : []
  const items = first ? [...inherited, first] : inherited
  // 标题优先用户消息（QA BUG-3：AI 开场白当标题没意义）
  const titleSrc = first && first.role === 'user' ? first.text : (input.title ?? first?.text ?? '')
  const s: ChatSession = {
    id: genId('cs'),
    title: ruleTitle(input.title || titleSrc || (parent ? `${parent.title} · 分支` : '新会话')),
    topic: input.topic ?? parent?.topic ?? 'general',
    projectId: input.projectId ?? parent?.projectId,
    items,
    // 会话目标在创建时确定（文档 §6：之后切换需显式确认并新开会话）
    target: input.target ?? parent?.target ?? { kind: 'local' },
    participants: input.participants?.length ? [...new Set(input.participants)] : parent?.participants,
    parentSessionId: input.parentSessionId,
    createdAt: now,
    updatedAt: now
  }
  insertInto('chatSessions', s)
  if (first?.text) aiSummarizeTitle(s.id, first.text)
  return s
}

/** 会话级群组：加入 / 移除参与 Agent（去重） */
export function addChatSessionParticipant(id: string, agentId: string): ChatSession | null {
  const s = col<ChatSession>('chatSessions').find((x) => x.id === id)
  if (!s) return null
  const participants = [...new Set([...(s.participants ?? []), agentId])]
  return updateIn<ChatSession>('chatSessions', id, { participants, updatedAt: Date.now() })
}

export function removeChatSessionParticipant(id: string, agentId: string): ChatSession | null {
  const s = col<ChatSession>('chatSessions').find((x) => x.id === id)
  if (!s) return null
  const participants = (s.participants ?? []).filter((a) => a !== agentId)
  return updateIn<ChatSession>('chatSessions', id, {
    participants: participants.length ? participants : undefined,
    updatedAt: Date.now()
  })
}

/** 派生子会话：继承上游最近 10 条消息 + 参与 Agent，可指定新加入的 Agent */
export function forkChatSession(id: string, agentId?: string): ChatSession | null {
  const parent = col<ChatSession>('chatSessions').find((x) => x.id === id)
  if (!parent) return null
  const participants = [...new Set([...(parent.participants ?? []), ...(agentId ? [agentId] : [])])]
  return createChatSession({
    title: `${parent.title} · 分支`,
    participants,
    parentSessionId: parent.id
  })
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

export function removeChatSessionItem(id: string, index: number): ChatSession | null {
  const s = col<ChatSession>('chatSessions').find((x) => x.id === id)
  if (!s || index < 0 || index >= s.items.length) return null
  const items = s.items.filter((_, i) => i !== index)
  return updateIn<ChatSession>('chatSessions', id, { items, updatedAt: Date.now() })
}

export function removeChatSession(id: string): boolean {
  return removeFrom('chatSessions', id)
}

/** 归档 / 恢复：归档只标记，不删除消息 */
export function archiveChatSession(id: string, archived: boolean): ChatSession | null {
  const s = col<ChatSession>('chatSessions').find((x) => x.id === id)
  if (!s) return null
  return updateIn<ChatSession>('chatSessions', id, {
    archived: archived || undefined,
    archivedAt: archived ? Date.now() : undefined
  })
}

export function renameChatSession(id: string, title: string): ChatSession | null {
  return updateIn<ChatSession>('chatSessions', id, { title: title.slice(0, 24) })
}
