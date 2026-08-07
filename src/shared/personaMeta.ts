/**
 * 用户画像元信息 —— 八层结构 / 五级隐私 / 完整度计算（v2.7）
 * 依据：workon-design-spec-v2.7 §1.2 八层画像、§2.1 五级隐私、§6.2 完整度公式
 */
import type { PrivacyLevel, ProfileField, UserPersona } from './types'

// ───────────────────────── 八层画像 ─────────────────────────

export interface PersonaLayerMeta {
  key: 'basicInfo' | 'identity' | 'preferences' | 'behavioral' | 'interests' | 'capabilities' | 'psychological' | 'relationship'
  label: string
  level: PrivacyLevel
  emoji: string
  desc: string
  aiUsage: string // AI 访问方式说明（照 v2.7 §1.2 各层"AI 访问"）
}

/** 八层画像结构（v2.7 §1.2；L4 核心隐私层不落画像模型，仅在隐私等级中体现） */
export const PERSONA_LAYERS: PersonaLayerMeta[] = [
  {
    key: 'basicInfo', label: '基础信息', level: 'L0', emoji: '🪪',
    desc: '昵称、用户类型、头像、时区、语言、活跃天数',
    aiUsage: 'AI 可直接引用，如"你是办公族用户，已使用 WorkOn 42 天"'
  },
  {
    key: 'identity', label: '身份画像', level: 'L1', emoji: '💼',
    desc: '职业、行业、经验等级、工作模式',
    aiUsage: 'AI 摘要引用，如"作为有几年经验的中级开发者"，不透露具体公司'
  },
  {
    key: 'preferences', label: '偏好设定', level: 'L1', emoji: '⚙️',
    desc: '工作风格、沟通偏好、干预容忍度、偏好工作时段',
    aiUsage: 'AI 摘要引用，如"你偏好番茄钟工作法"'
  },
  {
    key: 'behavioral', label: '行为模式', level: 'L2', emoji: '📊',
    desc: '日作息、高效时段、应用使用模式、专注历史',
    aiUsage: 'AI 聚合统计引用，如"你的高效时段是上午 9-11 点"，不暴露具体应用列表'
  },
  {
    key: 'interests', label: '兴趣爱好', level: 'L2', emoji: '🎯',
    desc: '检测兴趣、学习主题、非工作爱好',
    aiUsage: 'AI 聚合引用，如"你对机器学习感兴趣"，不暴露具体搜索记录'
  },
  {
    key: 'capabilities', label: '能力技能', level: 'L2', emoji: '🛠',
    desc: '技能标签、熟练度、学习目标',
    aiUsage: 'AI 聚合引用，如"你擅长 React 和 Python"，不暴露具体代码内容'
  },
  {
    key: 'psychological', label: '心理画像', level: 'L3', emoji: '🧠',
    desc: '压力耐受、动机类型、注意力风格、精力周期、倦怠风险',
    aiUsage: 'AI 策略内化：据此调整虚拟人交互策略，不在回复中提及具体数值'
  },
  {
    key: 'relationship', label: '关系数据', level: 'L3', emoji: '💞',
    desc: '亲密度、交互模式、情感历史',
    aiUsage: 'AI 策略内化：据此调整干预频率与语气，不在回复中直接引用'
  }
]

// ───────────────────────── 五级隐私 ─────────────────────────

/** 隐私等级元信息（v2.7 §2.1） */
export const PRIVACY_LEVEL_META: Record<PrivacyLevel, { label: string; color: string; desc: string }> = {
  L0: { label: '公开', color: '#10B981', desc: '昵称/类型/头像等，AI 可直接引用' }, // 绿
  L1: { label: '低敏', color: '#22D3EE', desc: '职业/经验/偏好，AI 摘要引用' }, // 青
  L2: { label: '中敏', color: '#3B82F6', desc: '行为/兴趣/技能，AI 聚合统计引用' }, // 蓝
  L3: { label: '高敏', color: '#F59E0B', desc: '心理/关系数据，AI 策略内化不直接引用' }, // 橙
  L4: { label: '核心', color: '#EF4444', desc: '真实身份/联系方式，AI 永久禁止访问（锁定）' } // 红
}

// ───────────────────────── 完整度计算（v2.7 §6.2） ─────────────────────────

/** ProfileField 有效填充：字段存在且（用户确认过 或 置信度 ≥0.3） */
function fieldFilled<T>(f?: ProfileField<T>): boolean {
  return !!f && (f.userConfirmed || f.confidence >= 0.3)
}

/**
 * 画像完整度 0-100：各字段权重照 v2.7 §6.2（合计 1.0），命中累加后 ×100 取整
 * 行为模式需 7 天数据、心理画像需 14 天数据（由采集侧保证，公式只判有无）
 */
export function completenessOf(p: UserPersona): number {
  let score = 0
  // L0 基础信息（15%）：昵称/类型/时区
  if (p.basicInfo.nickname) score += 0.05
  if (p.basicInfo.userType) score += 0.05
  if (p.basicInfo.timezone) score += 0.05
  // L1 身份画像（15%）：职业/行业/经验/工作模式
  if (fieldFilled(p.identity.occupation)) score += 0.04
  if (fieldFilled(p.identity.industry)) score += 0.04
  if (fieldFilled(p.identity.experienceLevel)) score += 0.04
  if (fieldFilled(p.identity.workMode)) score += 0.03
  // L1 偏好设定（10%）：工作风格/沟通偏好/干预容忍度
  if (fieldFilled(p.preferences.workStyle)) score += 0.03
  if (fieldFilled(p.preferences.communicationStyle)) score += 0.03
  if (fieldFilled(p.preferences.interventionTolerance)) score += 0.04
  // L2 行为模式（20%）：高效时段/应用模式
  if (p.behavioral.dailyRhythm.peakHours.length > 0) score += 0.10
  if (p.behavioral.appUsagePattern.primaryApps.length > 0) score += 0.10
  // L2 兴趣爱好（10%）：检测兴趣/爱好或学习主题
  if (p.interests.detectedInterests.length > 0) score += 0.05
  if (p.interests.hobbies.length > 0 || p.interests.learningTopics.length > 0) score += 0.05
  // L2 能力技能（10%）
  if (p.capabilities.skillTags.length > 0) score += 0.10
  // L3 心理画像（10%，置信度 >0.5 才算有效）
  if (p.psychological.confidence > 0.5) score += 0.10
  // L3 关系数据（10%，需交互历史）
  if (p.relationship.totalInteractions > 10) score += 0.10
  return Math.round(score * 100)
}

/** 完整度等级文案（v2.7 §6.2 分档） */
export function completenessLabel(score: number): string {
  if (score >= 90) return '画像完整'
  if (score >= 70) return '较完整'
  if (score >= 50) return '基本完整'
  return '不完整'
}
