/**
 * 粘贴/截图 → 待办：双方内容都采，AI 抽取并润色
 */
import { getSettings } from './settings'
import { llmChat, extractJson } from './ai'
import { extractTodoTitlesHeuristic } from '@shared/pasteDetect'

function cleanTitle(t: string): string {
  return String(t ?? '')
    .replace(/^[-*\u2022\d.、)\]\s]+/, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80)
}

/** 启发式兜底 +（有 AI 时）全量双方对话抽取并润色为今日可执行待办 */
export async function extractAndPolishPasteTodos(text: string): Promise<string[]> {
  const raw = String(text ?? '').trim()
  if (!raw) return []

  const heuristic = extractTodoTitlesHeuristic(raw, 40).map(cleanTitle).filter((t) => t.length >= 2)

  const s = getSettings()
  if (!s.aiEnabled || !s.aiApiKey) return heuristic

  const prompt = [
    `你是 WorkOn 的待办整理助手。下面是用户粘贴/截图 OCR 的文本（可能是聊天记录、会议纪要、清单）。`,
    ``,
    `硬性要求：`,
    `1) 【双方都要看】聊天里「我/自己」和「对方/同事/客户」说的话都可能含计划；禁止只抽对方、丢掉用户自己说的承诺/安排。`,
    `2) 抽可执行的今日/近期计划项：要做什么、改什么、约什么、交付什么。`,
    `3) 润色成短标题：动词开头、一句一事、去掉语气词/表情/重复寒暄；每条 8～36 字为宜，最多 40 字。`,
    `4) 不要闲聊、不要纯情绪、不要已完成的回顾（除非明确「还要补做」）。`,
    `5) 去重合并同义项；最多 40 条，宁多勿漏。`,
    `6) 只输出 JSON 数组，不要代码块、不要解释。格式示例：["修好登录页白屏","约产品对齐需求"]`,
    ``,
    `原文：`,
    raw.slice(0, 8000)
  ].join('\n')

  try {
    const reply = await llmChat([{ role: 'user', content: prompt }], 45000, 'standard')
    if (!reply) return heuristic
    const parsed = extractJson<string[] | { items?: string[]; todos?: string[] }>(reply)
    let list: string[] = []
    if (Array.isArray(parsed)) list = parsed
    else if (parsed && Array.isArray(parsed.items)) list = parsed.items
    else if (parsed && Array.isArray(parsed.todos)) list = parsed.todos

    list = [...new Set(list.map(cleanTitle).filter((t) => t.length >= 2))].slice(0, 40)
    if (!list.length) return heuristic

    // 若 AI 明显漏掉启发式里「我/承诺」类短句，补几条未覆盖的
    const lowerJoined = list.join('\n').toLowerCase()
    for (const h of heuristic) {
      if (list.length >= 40) break
      const key = h.slice(0, 10).toLowerCase()
      if (key && !lowerJoined.includes(key)) {
        list.push(h)
      }
    }
    return [...new Set(list)].slice(0, 40)
  } catch (e) {
    console.warn('[pasteTodos] AI 抽取失败，用启发式', e)
    return heuristic
  }
}
