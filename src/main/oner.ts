/**
 * oner 待办双向同步
 * 依据：PRD.md F14「GET {endpoint}/plans 拉取 + PATCH {endpoint}/plans/{id} 回写；
 *       字段兼容识别（id/extId/uid、title/name/task）、类别关键词猜测、按 extId 增量去重」
 */
import type { PlanItem, PlanCategory } from '@shared/types'
import { genId } from '@shared/types'
import { getSettings, setSettings } from './settings'
import { col, insertInto, updateIn } from './db'
import { pushNotify } from './notify'
import type { AppSettings } from '@shared/types'
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

/** 连续 401 计数：≥2 次自动停轮询并通知（Token 失效不再无限打接口）；改设置时清零恢复 */
let authFailStreak = 0
/** 单次拉取导入上限（防首次联动洪水；剩余条目由后续轮询周期继续消化） */
const PULL_CAP = 50
/** 进行中的 refresh 去重：拉取/回写同时 401 时只发一次 refresh */
let refreshInFlight: Promise<string | null> | null = null
/** 上次成功续期时刻：10s 内的再次 401 直接用已存新 Token 重试（防连续 refresh 互相作废的乒乓） */
let lastRefreshAt = 0

/**
 * 401 → 用当前 Token 换发新 JWT（Oner: POST /auth/refresh，旧 Token 立即失效）。
 * 成功 = 新 Token 落盘 settings；失败 = null（调用方走退避/通知）。
 * 并发去重：轮询与回写同时 401 时只发一次 refresh。
 */
async function tryRefresh(): Promise<string | null> {
  const s = getSettings()
  if (!s.onerEndpoint || !s.onerToken) return null
  if (refreshInFlight) return refreshInFlight
  // 冷却期内：上次续期刚成功，已存 Token 就是最新有效的，直接用它重试
  if (Date.now() - lastRefreshAt < 10_000) return s.onerToken
  refreshInFlight = (async () => {
    try {
      const resp = await fetch(`${s.onerEndpoint.replace(/\/$/, '')}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${s.onerToken}` }
      })
      if (!resp.ok) return null
      const raw = (await resp.json()) as { token?: string; accessToken?: string; jwt?: string }
      const token = raw.token ?? raw.accessToken ?? raw.jwt
      if (!token) return null
      setSettings({ onerToken: token } as Partial<AppSettings>)
      lastRefreshAt = Date.now()
      console.log('[oner] Token 已自动续期')
      return token
    } catch {
      return null
    } finally {
      refreshInFlight = null
    }
  })()
  return refreshInFlight
}

/** 带鉴权的请求封装：401 时自动 refresh 一次并重试；refresh 失败返回 401 响应（调用方走退避/通知） */
async function authedFetch(url: string, init: RequestInit = {}): Promise<Response | null> {
  const s = getSettings()
  if (!s.onerToken) return null
  const doFetch = (token: string): Promise<Response> =>
    fetch(url, { ...init, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` } })
  let resp = await doFetch(s.onerToken)
  if (resp.status === 401) {
    const newToken = await tryRefresh()
    if (!newToken) return resp
    resp = await doFetch(newToken)
  }
  return resp
}

export async function onerPull(): Promise<{ pulled: number; error?: string }> {
  const s = getSettings()
  if (!s.onerEndpoint || !s.onerToken) return { pulled: 0, error: '未配置 oner' }
  try {
    const resp = await authedFetch(`${s.onerEndpoint.replace(/\/$/, '')}/plans`)
    if (!resp) return { pulled: 0, error: '未配置 oner' }
    if (resp.status === 401) {
      authFailStreak++
      if (authFailStreak === 2) {
        stopOnerAutoSync()
        pushNotify('generic', 'Oner 同步已暂停', 'Oner Token 已失效（刷新也失败）。到 设置 → Oner 同步 更新 Token 后自动恢复', [
          { label: '知道了', action: 'dismiss' }
        ], 0)
      }
      return { pulled: 0, error: '401 Token 失效' }
    }
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
    authFailStreak = 0
    const raw = (await resp.json()) as OnerRawPlan[] | { plans?: OnerRawPlan[] }
    const list = Array.isArray(raw) ? raw : (raw.plans ?? [])
    const existing = col<PlanItem>('plans')
    let pulled = 0
    for (const p of list) {
      if (pulled >= PULL_CAP) break // 首次联动洪水保护：剩余条目由后续轮询周期消化
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
      // 状态映射：Oner todo|in_progress|done → WorkOn planned|in_progress|done
      const status: PlanItem['status'] =
        p.done || p.status === 'done' ? 'done' : p.status === 'in_progress' ? 'in_progress' : 'planned'
      insertInto<PlanItem>('plans', {
        id: genId('plan'),
        date,
        title,
        category: (p.category as PlanCategory) ?? guessCategory(title),
        status,
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
    const resp = await authedFetch(`${s.onerEndpoint.replace(/\/$/, '')}/plans/${plan.extId}`, {
      method: 'PATCH',
      body: JSON.stringify({
        status: plan.status,
        done: plan.status === 'done',
        ...(plan.completedAt ? { completedAt: plan.completedAt } : {})
      })
    })
    return !!resp && resp.ok
  } catch (e) {
    console.warn('[oner] 回写失败:', (e as Error).message)
    return false
  }
}

let syncTimer: NodeJS.Timeout | null = null

export function startOnerAutoSync(): void {
  stopOnerAutoSync()
  authFailStreak = 0 // 设置变更（换 Token/改频率）即恢复轮询
  const min = getSettings().onerAutoSyncMin
  if (min > 0) {
    syncTimer = setInterval(() => void onerPull(), min * 60000)
  }
}

export function stopOnerAutoSync(): void {
  if (syncTimer) clearInterval(syncTimer)
  syncTimer = null
}
