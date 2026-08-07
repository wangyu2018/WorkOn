/**
 * oner 待办双向同步
 * 依据：PRD.md F14「GET {endpoint}/plans 拉取 + PATCH {endpoint}/plans/{id} 回写；
 *       字段兼容识别（id/extId/uid、title/name/task）、类别关键词猜测、按 extId 增量去重」
 */
import type { PlanItem, PlanCategory } from '@shared/types'
import { genId } from '@shared/types'
import { getSettings } from './settings'
import { col, insertInto, updateIn } from './db'
import { dateKey } from '@shared/trail'

interface OnerRawPlan {
  id?: string | number
  extId?: string | number
  uid?: string | number
  title?: string
  name?: string
  task?: string
  date?: string
  done?: boolean
  status?: string
  category?: string
  [k: string]: unknown
}

const CATEGORY_KEYWORDS: [RegExp, PlanCategory][] = [
  [/ai|模型|算法|训练|prompt/i, 'ai-dev'],
  [/客户|customer|交付|演示/i, 'work-customer'],
  [/汇报|领导|leader|周报/i, 'leader'],
  [/个人|生活|学习|锻炼/i, 'personal']
]

function guessCategory(title: string): PlanCategory {
  for (const [re, cat] of CATEGORY_KEYWORDS) if (re.test(title)) return cat
  return 'other'
}

function extIdOf(p: OnerRawPlan): string | null {
  const v = p.extId ?? p.id ?? p.uid
  return v == null ? null : String(v)
}

export async function onerPull(): Promise<{ pulled: number; error?: string }> {
  const s = getSettings()
  if (!s.onerEndpoint || !s.onerToken) return { pulled: 0, error: '未配置 oner' }
  try {
    const resp = await fetch(`${s.onerEndpoint.replace(/\/$/, '')}/plans`, {
      headers: { Authorization: `Bearer ${s.onerToken}` }
    })
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
    const raw = (await resp.json()) as OnerRawPlan[] | { plans?: OnerRawPlan[] }
    const list = Array.isArray(raw) ? raw : (raw.plans ?? [])
    const existing = col<PlanItem>('plans')
    let pulled = 0
    for (const p of list) {
      const extId = extIdOf(p)
      if (!extId) continue
      if (existing.some((e) => e.extId === extId)) continue // 增量去重，保留本地状态
      const title = String(p.title ?? p.name ?? p.task ?? '未命名任务')
      // 日期格式校验：非法日期会让计划在任何视图都加载不出（等值过滤永不匹配）
      const date = p.date ?? dateKey(Date.now())
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        console.warn(`[oner] 跳过非法日期计划「${title}」: ${date}`)
        continue
      }
      insertInto<PlanItem>('plans', {
        id: genId('plan'),
        date,
        title,
        category: (p.category as PlanCategory) ?? guessCategory(title),
        status: p.done || p.status === 'done' ? 'done' : 'planned',
        source: 'oner',
        extId,
        ts: Date.now()
      })
      pulled++
    }
    return { pulled }
  } catch (e) {
    console.warn('[oner] 拉取失败:', (e as Error).message)
    return { pulled: 0, error: (e as Error).message }
  }
}

export async function onerPushStatus(plan: PlanItem): Promise<boolean> {
  const s = getSettings()
  if (!s.onerEndpoint || !s.onerToken || !plan.extId) return false
  try {
    const resp = await fetch(`${s.onerEndpoint.replace(/\/$/, '')}/plans/${plan.extId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${s.onerToken}` },
      body: JSON.stringify({ status: plan.status, done: plan.status === 'done' })
    })
    return resp.ok
  } catch (e) {
    console.warn('[oner] 回写失败:', (e as Error).message)
    return false
  }
}

let syncTimer: NodeJS.Timeout | null = null

export function startOnerAutoSync(): void {
  stopOnerAutoSync()
  const min = getSettings().onerAutoSyncMin
  if (min > 0) {
    syncTimer = setInterval(() => void onerPull(), min * 60000)
  }
}

export function stopOnerAutoSync(): void {
  if (syncTimer) clearInterval(syncTimer)
  syncTimer = null
}
