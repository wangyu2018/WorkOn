/**
 * v2.8 AI 增强层 —— LLM 推断引擎（design-spec-v2.8 §3.3）
 * 职责：基础能力层（规则富化）覆盖不了的低置信度/缺摘要条目，交 LLM 做类别级推断
 * 契约：返回 null = AI 不可用或任一批失败（engine 标记 fallback_to_base）
 * 铁律：基础层 confidence ≥ 0.8 的条目字段不被 AI 覆盖；contentSummary 只在缺失时填
 * 调用策略（§3.3 enrichmentStrategy）：on_demand、每批 20 条、1 小时缓存
 */
import type { PlanItem, ReportEntry, ReportStats } from '@shared/types'
import type { IndustryVocabulary } from '@shared/industryVocab'
import { getSettings } from '../settings'
import { llmChat, extractJson } from '../ai'
import { requestPersonaData } from '../desensitize'

export interface AIEnhanceContext {
  date: string
  stats: ReportStats
  plans: PlanItem[]
  industryVocab?: IndustryVocabulary
}

/** LLM 单项推断输出（§3.3 输出格式：每项带 confidence） */
interface AIInferredItem {
  id: string
  subject?: string
  contentTag?: string
  contentSummary?: string
  project?: string
  location?: string
  output?: string
  confidence?: number
}

// ───────────────────────── 缓存（1 小时，§3.3 cacheDuration） ─────────────────────────

const CACHE_TTL = 3600000
const cache = new Map<string, { ts: number; result: ReportEntry[] }>()

/** 条目指纹：id+confidence 拼接的简单 hash（条目内容变化即失效） */
function fingerprint(entries: ReportEntry[]): string {
  const s = entries.map((e) => `${e.id}:${e.confidence}`).join('|')
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0
  return h.toString(36)
}

// ───────────────────────── 待富化条目收集 ─────────────────────────

/** 低置信度或缺摘要/产出的条目才需要 LLM 推断 */
function collectPending(entries: ReportEntry[]): ReportEntry[] {
  return entries.filter((e) => e.confidence < 0.6 || !e.contentSummary || !e.output)
}

const pad2 = (n: number): string => `${n}`.padStart(2, '0')
const hhmm = (ts: number): string => {
  const d = new Date(ts)
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`
}

// ───────────────────────── Prompt 构建（§3.3 原文结构） ─────────────────────────

function buildPrompt(batch: ReportEntry[], ctx: AIEnhanceContext): string {
  // 用户画像：经 v2.7 脱敏网关取 L0/L1/L2，画像不可用时静默跳过
  let persona = '（暂无画像数据）'
  try {
    const { data } = requestPersonaData({
      requester: 'report',
      layers: ['L0', 'L1', 'L2'],
      fields: [],
      intent: 'report_enrich'
    })
    if (data.length) persona = data.map((d) => d.value).join('；')
  } catch { /* 画像缺失不影响 prompt 构建 */ }

  const planLines = ctx.plans.length
    ? ctx.plans.map((p) => `- ${p.title}`).join('\n')
    : '（今日无计划）'

  const vocab = ctx.industryVocab
  const vocabLines = vocab
    ? `行业：${vocab.industryName}\n` +
      `对象词：${vocab.keywords.subjectPatterns.join('、')}\n` +
      `项目词：${vocab.keywords.projectPatterns.join('、')}\n` +
      `位置词：${vocab.keywords.locationPatterns.join('、')}\n` +
      `产出词：${vocab.keywords.outputPatterns.join('、')}`
    : '（无行业词库）'

  const segLines = batch
    .map((e) => {
      const dims = [
        e.subject && `对象=${e.subject}`,
        e.contentTag && `类别=${e.contentTag}`,
        e.contentSummary && `摘要=${e.contentSummary}`,
        e.project && `项目=${e.project}`,
        e.location && `位置=${e.location}`,
        e.output && `产出=${e.output}`
      ].filter(Boolean).join('，')
      return `- id=${e.id}｜时间=${hhmm(e.startTs)}-${hhmm(e.endTs)}（${Math.round(e.durationMin)}分钟）｜应用=${e.app ?? '未知'}｜标题=${e.stateLabel}${dims ? `｜已有：${dims}` : ''}`
    })
    .join('\n')

  return `你是一个办公行为分析助手。根据以下原始监控数据，推断每个时间段的详细信息。

## 用户画像
${persona}

## 今日计划
${planLines}

## 行业词库
${vocabLines}

## 待富化的时间段数据
${segLines}

## 推断规则
1. 从窗口标题中提取对象名（人名/客户名/团队名）
2. 从应用组合推断工作内容类别
3. 从文件路径推断项目名
4. 从终端命令推断操作目标和位置
5. 每个推断标注置信度(0-1)，低于0.6的标记为"需确认"
6. 不要猜测具体内容细节，只做类别级推断

## 输出格式
只输出 JSON 数组，不要任何其他文字。每个元素对应一个时间段：
[{"id":"条目id","subject":"对象","contentTag":"内容类别","contentSummary":"一句话摘要","project":"项目名","location":"位置","output":"产出","confidence":0.0-1.0}]
无法推断的字段省略该键；无法推断的条目整条省略。`
}

// ───────────────────────── 合并（铁律：高置信字段不被覆盖） ─────────────────────────

const FIVE_DIM_KEYS = ['subject', 'contentTag', 'project', 'location', 'output'] as const

function mergeAIItem(entry: ReportEntry, item: AIInferredItem): void {
  // 基础层 confidence ≥ 0.8：字段已有值的绝不覆盖，只补缺（铁律）
  const locked = entry.confidence >= 0.8
  for (const k of FIVE_DIM_KEYS) {
    const v = item[k]
    if (typeof v !== 'string' || !v.trim()) continue
    if (!entry[k]) entry[k] = v.trim()
    else if (!locked) entry[k] = v.trim() // 低置信条目允许 AI 修正
  }
  // contentSummary 只在缺失时填
  if (!entry.contentSummary && typeof item.contentSummary === 'string' && item.contentSummary.trim()) {
    entry.contentSummary = item.contentSummary.trim()
  }
  // 整体置信度取 max，重算待确认标记
  const aiConf = typeof item.confidence === 'number' ? Math.min(1, Math.max(0, item.confidence)) : 0.6
  entry.confidence = Math.max(entry.confidence, aiConf)
  entry.needsReview = entry.confidence < 0.6
  if (!entry.dataSource.includes('ai_inferred')) entry.dataSource.push('ai_inferred')
}

// ───────────────────────── 入口 ─────────────────────────

/** AI 增强报表条目；返回 null 触发 engine 的 fallback_to_base */
export async function enhanceWithAI(entries: ReportEntry[], ctx: AIEnhanceContext): Promise<ReportEntry[] | null> {
  const s = getSettings()
  if (!s.aiEnabled || !s.aiApiKey) return null // AI 不可用

  const pending = collectPending(entries)
  if (pending.length === 0) return entries // 无待富化条目，不调 LLM

  // 缓存命中：同日期 + 同条目指纹，1 小时内直接返回
  const cacheKey = `${ctx.date}:${fingerprint(entries)}`
  const now = Date.now()
  for (const [k, v] of cache) if (now - v.ts >= CACHE_TTL) cache.delete(k)
  const hit = cache.get(cacheKey)
  if (hit && now - hit.ts < CACHE_TTL) {
    return hit.result.map((e) => ({ ...e, dataSource: [...e.dataSource] }))
  }

  // 深拷贝一份再增强，避免污染基础层结果（失败时引擎拿到的仍是原始 entries）
  const working = entries.map((e) => ({ ...e, dataSource: [...e.dataSource] }))
  const byId = new Map(working.map((e) => [e.id, e]))

  // 分批（每批 20 条，§3.3 batchSize）
  for (let i = 0; i < pending.length; i += 20) {
    const batch = pending.slice(i, i + 20)
    const text = await llmChat(
      [{ role: 'user', content: buildPrompt(batch, ctx) }],
      45000
    )
    const parsed = text ? extractJson<AIInferredItem[]>(text) : null
    if (!parsed || !Array.isArray(parsed)) {
      console.warn('[report] AI 增强批次失败（调用或解析），整体降级基础层')
      return null // 任一批失败 → 整体降级
    }
    for (const item of parsed) {
      if (!item || typeof item.id !== 'string') continue
      const entry = byId.get(item.id)
      if (entry) mergeAIItem(entry, item)
    }
  }

  cache.set(cacheKey, { ts: now, result: working })
  return working
}
