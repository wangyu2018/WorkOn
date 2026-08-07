/**
 * 脱敏网关 —— AI 访问用户画像的唯一入口（v2.7 §2.3 五步管道）
 * 管道：请求拦截 → 权限校验 → 按层脱敏 → 写访问日志 → 返回脱敏数据
 * 脱敏话术照 §5.3：L0 原样 / L1 摘要 / L2 聚合 / L3 策略指令（不暴露数值）/ L4 一律拒绝
 * 日志：每条输出写 AccessLog（output 截断 200 字），保留 30 天，用户可追溯
 */
import type { AccessLog, PrivacyLevel, ProfileField, ProfileReference, UserPersona } from '@shared/types'
import { genId } from '@shared/types'
import { USER_TYPE_META } from '@shared/attention'
import { col, insertInto, removeFrom } from './db'
import { getPersona } from './persona'

const DAY_MS = 86400000

/** 画像分组字段 → 隐私层级 */
const FIELD_LAYER: Record<string, PrivacyLevel> = {
  basicInfo: 'L0',
  identity: 'L1', preferences: 'L1',
  behavioral: 'L2', interests: 'L2', capabilities: 'L2',
  psychological: 'L3', relationship: 'L3'
}

/** 层级 → 分组字段（fields 为空数组时按 layers 全取） */
const LAYER_FIELDS: Record<string, string[]> = {
  L0: ['basicInfo'],
  L1: ['identity', 'preferences'],
  L2: ['behavioral', 'interests', 'capabilities'],
  L3: ['psychological', 'relationship']
}

export interface PersonaDataRequest {
  requester: 'ai_qa' | 'companion' | 'report'
  layers: PrivacyLevel[]
  fields: string[] // 分组粒度（basicInfo/identity/...），空数组 = 按 layers 全取
  intent: string
}

export type PersonaDataEntry = ProfileReference & { value: string }

type Rule = 'raw' | 'summary' | 'aggregation' | 'strategy_directive'

/** ProfileField 输出判定：用户确认过或置信度 ≥0.3 才输出；<0.5 的话术加"可能"限定词 */
function fieldState<T>(f?: ProfileField<T>): 'ok' | 'maybe' | 'skip' {
  if (!f) return 'skip'
  if (f.userConfirmed) return 'ok'
  if (f.confidence < 0.3) return 'skip'
  return f.confidence < 0.5 ? 'maybe' : 'ok'
}

// ── L0 原样返回（§5.3 直接引用模板）──

function buildL0(p: UserPersona): { field: string; value: string }[] {
  return [
    { field: 'basicInfo.userType', value: `你是${USER_TYPE_META[p.basicInfo.userType].label}用户` },
    { field: 'basicInfo.daysActive', value: `你已使用 WorkOn ${p.basicInfo.daysActive} 天` }
  ]
}

// ── L1 摘要化（§5.3 摘要引用模板）──

const EXP_DESC: Record<string, (occ: string) => string> = {
  junior: (o) => `初入行的${o}`,
  mid: (o) => `有几年经验的中级${o}`,
  senior: (o) => `资深${o}`,
  expert: (o) => `专家级${o}`
}
const WORK_MODE_LABEL = { office: '坐班', remote: '远程', hybrid: '混合' } as const
const WORKSTYLE_DESC = { pomodoro: '番茄钟工作法', flow: '心流式深度工作', flexible: '弹性工作节奏', structured: '结构化计划工作' } as const
const COMM_DESC = { direct: '直接简洁', encouraging: '鼓励式', minimal: '少打扰' } as const
const TOLERANCE_DESC = { high: '可以接受较高的干预频率', medium: '希望保持适度的干预', low: '希望尽量少被打扰' } as const

function buildIdentity(p: UserPersona): { field: string; value: string }[] {
  const out: { field: string; value: string }[] = []
  const id = p.identity
  const occ = fieldState(id.occupation)
  const exp = fieldState(id.experienceLevel)
  if (occ !== 'skip' && id.occupation) {
    const maybe = occ === 'maybe' || exp === 'maybe' ? '可能' : ''
    const desc = exp !== 'skip' && id.experienceLevel ? EXP_DESC[id.experienceLevel.value](id.occupation.value) : id.occupation.value
    out.push({ field: 'identity.occupation', value: `你${maybe}是${desc}` })
  }
  const ind = fieldState(id.industry)
  if (ind !== 'skip' && id.industry) {
    out.push({ field: 'identity.industry', value: `你${ind === 'maybe' ? '可能' : ''}在${id.industry.value}行业工作` })
  }
  const wm = fieldState(id.workMode)
  if (wm !== 'skip' && id.workMode) {
    out.push({ field: 'identity.workMode', value: `你的工作模式${wm === 'maybe' ? '可能' : ''}是${WORK_MODE_LABEL[id.workMode.value]}` })
  }
  return out
}

function buildPreferences(p: UserPersona): { field: string; value: string }[] {
  const out: { field: string; value: string }[] = []
  const pref = p.preferences
  const ws = fieldState(pref.workStyle)
  if (ws !== 'skip' && pref.workStyle) {
    out.push({ field: 'preferences.workStyle', value: `你${ws === 'maybe' ? '可能' : ''}偏好${WORKSTYLE_DESC[pref.workStyle.value]}` })
  }
  const cs = fieldState(pref.communicationStyle)
  if (cs !== 'skip' && pref.communicationStyle) {
    out.push({ field: 'preferences.communicationStyle', value: `你的沟通偏好${cs === 'maybe' ? '可能' : ''}是${COMM_DESC[pref.communicationStyle.value]}` })
  }
  const it = fieldState(pref.interventionTolerance)
  if (it !== 'skip' && pref.interventionTolerance) {
    out.push({ field: 'preferences.interventionTolerance', value: `你${it === 'maybe' ? '可能' : ''}${TOLERANCE_DESC[pref.interventionTolerance.value]}` })
  }
  if (pref.preferredWorkHours?.start && pref.preferredWorkHours.end) {
    out.push({ field: 'preferences.preferredWorkHours', value: `你的偏好工作时段是 ${pref.preferredWorkHours.start}-${pref.preferredWorkHours.end}` })
  }
  return out
}

// ── L2 聚合化（§5.3 聚合引用模板；不暴露应用名 / 原始记录）──

function buildBehavioral(p: UserPersona): { field: string; value: string }[] {
  const out: { field: string; value: string }[] = []
  const b = p.behavioral
  if (b.dailyRhythm.peakHours.length) {
    out.push({ field: 'behavioral.peakHours', value: `你的高效时段集中在${b.dailyRhythm.peakHours.join('、')}` })
  }
  if (b.appUsagePattern.primaryApps.length) {
    const focusH = Math.round((b.focusStreakHistory.avgDailyFocusMin / 60) * 10) / 10
    out.push({ field: 'behavioral.appUsage', value: `你主要使用${b.appUsagePattern.primaryApps[0].category}类应用工作，日均专注约${focusH}小时` })
  }
  if (b.dailyRhythm.weekendPattern === 'work') {
    out.push({ field: 'behavioral.weekend', value: '你周末通常也保持工作节奏' })
  }
  return out
}

function buildInterests(p: UserPersona): { field: string; value: string }[] {
  const out: { field: string; value: string }[] = []
  const tags = p.interests.detectedInterests
    .filter((d) => d.userConfirmed || d.confidence >= 0.3)
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 3)
  if (tags.length) {
    // 全部为低置信自动检测值时，整句加"可能"限定词
    const maybe = tags.every((t) => !t.userConfirmed && t.confidence < 0.5) ? '可能' : ''
    out.push({ field: 'interests.tags', value: `你${maybe}对${tags.map((t) => t.tag).join('、')}领域有关注` })
  }
  const learning = p.interests.learningTopics.find((t) => t.progress === 'learning' || t.progress === 'exploring')
  if (learning) out.push({ field: 'interests.learning', value: `你最近在学习${learning.topic}` })
  return out
}

function buildCapabilities(p: UserPersona): { field: string; value: string }[] {
  const skills = p.capabilities.skillTags
    .filter((s) => s.userConfirmed || s.confidence >= 0.3)
    .sort((a, b) => b.proficiency - a.proficiency)
    .slice(0, 3)
  if (!skills.length) return []
  // proficiency ≥60 擅长 / ≥30 有基础 / 以下接触过
  const parts = skills.map((s) => (s.proficiency >= 60 ? `擅长${s.name}` : s.proficiency >= 30 ? `有${s.name}基础` : `接触过${s.name}`))
  const maybe = skills.every((s) => !s.userConfirmed && s.confidence < 0.5) ? '可能' : ''
  return [{ field: 'capabilities.skills', value: `你${maybe}${parts.join('，')}` }]
}

// ── L3 策略指令（§5.3：AI 看不到数值，只看到策略指令）──

function buildPsyStrategy(p: UserPersona): string | null {
  const psy = p.psychological
  if (psy.confidence <= 0) return null // 尚无分析数据
  const d: Record<string, unknown> = {}
  if (psy.burnoutRisk >= 60) { d.suggestBreak = true; d.avoidChallenge = true }
  if (psy.stressTolerance < 40) { d.reduceIntervention = true; d.increaseGentleness = 0.3 }
  return Object.keys(d).length ? JSON.stringify(d) : null
}

function buildRelStrategy(p: UserPersona): string | null {
  const rel = p.relationship
  const d: Record<string, unknown> = { intimacyLevel: rel.intimacyLevel }
  if (rel.interactionPattern.dismissRate > 0.5) d.reduceIntervention = true
  if (rel.emotionalHistory.recentTrend === 'negative') d.recentNegativeTrend = true
  return JSON.stringify(d)
}

// ───────────────────────── 网关入口 ─────────────────────────

/**
 * 画像数据请求（§2.3 五步管道）：
 * ① 拦截请求 ② 校验层级权限（aiAccess 关闭 → 跳过并记 denied；L4 一律拒绝）
 * ③ 按层脱敏 ④ 每条写 AccessLog ⑤ 返回脱敏数据
 */
export function requestPersonaData(req: PersonaDataRequest): { granted: boolean; data: PersonaDataEntry[]; logId: string } {
  const p = getPersona()
  const now = Date.now()
  const fields = req.fields.length ? req.fields : req.layers.flatMap((l) => LAYER_FIELDS[l] ?? [])
  const data: PersonaDataEntry[] = []
  let firstLogId = ''

  const log = (layer: PrivacyLevel, field: string, ruleApplied: string, output: string): string => {
    const id = genId('log')
    insertInto<AccessLog>('accessLogs', {
      id, ts: now, requester: req.requester, layer, fields: [field],
      desensitized: ruleApplied !== 'raw' && ruleApplied !== 'denied',
      ruleApplied,
      output: output.slice(0, 200)
    })
    if (!firstLogId) firstLogId = id
    return id
  }

  // L4 一律拒绝（画像模型不含 L4 数据，仅记录违规尝试日志）
  if (req.layers.includes('L4')) log('L4', req.fields.join(',') || '*', 'denied', '')

  for (const f of new Set(fields)) {
    const layer = FIELD_LAYER[f]
    if (!layer || layer === 'L4') continue
    if (!req.layers.includes(layer)) continue // 请求层级未覆盖该字段
    if (p.privacySettings.aiAccess[layer] === false) { // 用户关闭了该层 AI 访问
      log(layer, f, 'denied', '')
      continue
    }
    let entries: { field: string; value: string }[] = []
    let rule: Rule = 'raw'
    switch (f) {
      case 'basicInfo': entries = buildL0(p); rule = 'raw'; break
      case 'identity': entries = buildIdentity(p); rule = 'summary'; break
      case 'preferences': entries = buildPreferences(p); rule = 'summary'; break
      case 'behavioral': entries = buildBehavioral(p); rule = 'aggregation'; break
      case 'interests': entries = buildInterests(p); rule = 'aggregation'; break
      case 'capabilities': entries = buildCapabilities(p); rule = 'aggregation'; break
      case 'psychological': {
        const s = buildPsyStrategy(p)
        if (s) entries = [{ field: 'psychological.strategy', value: s }]
        rule = 'strategy_directive'
        break
      }
      case 'relationship': {
        const s = buildRelStrategy(p)
        if (s) entries = [{ field: 'relationship.strategy', value: s }]
        rule = 'strategy_directive'
        break
      }
      default: break
    }
    for (const e of entries) {
      const logId = log(layer, e.field, rule, e.value)
      data.push({ layer, field: e.field, logId, summary: e.value, value: e.value })
    }
  }

  // 访问日志保留 30 天（§2.3 STEP4）：写入后裁剪过期记录
  const cutoff = now - 30 * DAY_MS
  const logs = col<AccessLog>('accessLogs')
  for (let i = logs.length - 1; i >= 0; i--) if (logs[i].ts < cutoff) logs.splice(i, 1)

  return { granted: data.length > 0, data, logId: firstLogId }
}

/** 访问日志列表（默认近 30 天，ts 降序） */
export function listAccessLogs(days = 30): AccessLog[] {
  const cutoff = Date.now() - days * DAY_MS
  return col<AccessLog>('accessLogs')
    .filter((l) => l.ts >= cutoff)
    .sort((a, b) => b.ts - a.ts)
}

/** 清空访问日志 */
export function clearAccessLogs(): void {
  for (const l of [...col<AccessLog>('accessLogs')]) removeFrom('accessLogs', l.id)
}
