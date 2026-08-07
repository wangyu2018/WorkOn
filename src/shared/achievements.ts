/**
 * 成就徽章定义 —— 通用里程碑 + 类型专属挑战（v2.6 §3.3）
 * 本文件只维护定义；解锁判定由 main 进程按 condition.metric 取数执行
 * 稀有称号（年度限定）依赖平台排行数据，暂不建模
 */
import type { Achievement } from './types'

/** 全部成就定义（初始均未解锁；unlocked/unlockedAt 由判定引擎写回） */
export const ACHIEVEMENT_DEFS: Achievement[] = [
  // ── A. 通用里程碑：连续打卡 ──
  {
    id: 'streak7', name: '初出茅庐', description: '连续 7 天有数据记录',
    type: 'milestone', category: 'streak', rarity: 'common',
    condition: { metric: 'streakDays', operator: '>=', threshold: 7 }, unlocked: false
  },
  {
    id: 'streak30', name: '坚持就是胜利', description: '连续 30 天有数据记录',
    type: 'milestone', category: 'streak', rarity: 'common',
    condition: { metric: 'streakDays', operator: '>=', threshold: 30 }, unlocked: false
  },
  {
    id: 'streak100', name: '百日筑基', description: '连续 100 天有数据记录',
    type: 'milestone', category: 'streak', rarity: 'rare',
    condition: { metric: 'streakDays', operator: '>=', threshold: 100 }, unlocked: false
  },
  {
    id: 'streak365', name: '全年无休', description: '连续 365 天有数据记录',
    type: 'milestone', category: 'streak', rarity: 'epic',
    condition: { metric: 'streakDays', operator: '>=', threshold: 365 }, unlocked: false
  },

  // ── A. 通用里程碑：评分突破 ──
  {
    id: 'score800', name: '首次破800', description: '单日综合评分达到 800 分',
    type: 'milestone', category: 'score', rarity: 'common',
    condition: { metric: 'finalScore', operator: '>=', threshold: 800 }, unlocked: false
  },
  {
    id: 'score950', name: '巅峰时刻', description: '单日综合评分达到 950 分（S+）',
    type: 'milestone', category: 'score', rarity: 'epic',
    condition: { metric: 'finalScore', operator: '>=', threshold: 950 }, unlocked: false
  },
  {
    id: 'steady7', name: '稳如磐石', description: '连续 7 天综合评分不低于 750 分',
    type: 'milestone', category: 'score', rarity: 'rare',
    condition: { metric: 'scoreAbove', operator: 'streak', threshold: 750, duration: 7 }, unlocked: false
  },
  {
    id: 'perfectWeek', name: '完美一周', description: '周均综合评分达到 900 分',
    type: 'milestone', category: 'score', rarity: 'rare',
    condition: { metric: 'weeklyAvg', operator: '>=', threshold: 900 }, unlocked: false
  },

  // ── A. 通用里程碑：五维突破 ──
  {
    id: 'dimDepth', name: '深度大师', description: '深度专注单日达到 95 分',
    type: 'milestone', category: 'dimension', rarity: 'rare',
    condition: { metric: 'dim.depth', operator: '>=', threshold: 95 }, unlocked: false
  },
  {
    id: 'dimSustain', name: '持久战神', description: '持续力单日达到 95 分',
    type: 'milestone', category: 'dimension', rarity: 'rare',
    condition: { metric: 'dim.sustain', operator: '>=', threshold: 95 }, unlocked: false
  },
  {
    id: 'dimResist', name: '心如止水', description: '抗干扰单日达到 95 分',
    type: 'milestone', category: 'dimension', rarity: 'rare',
    condition: { metric: 'dim.resist', operator: '>=', threshold: 95 }, unlocked: false
  },
  {
    id: 'dimRhythm', name: '节奏之王', description: '节奏感单日达到 95 分',
    type: 'milestone', category: 'dimension', rarity: 'rare',
    condition: { metric: 'dim.rhythm', operator: '>=', threshold: 95 }, unlocked: false
  },
  {
    id: 'dimRecover', name: '满血复活', description: '恢复力单日达到 95 分',
    type: 'milestone', category: 'dimension', rarity: 'rare',
    condition: { metric: 'dim.recover', operator: '>=', threshold: 95 }, unlocked: false
  },
  {
    id: 'dimAll90', name: '五维全满', description: '五个维度同日全部达到 90 分',
    type: 'milestone', category: 'dimension', rarity: 'legendary',
    condition: { metric: 'dim.all', operator: '>=', threshold: 90 }, unlocked: false
  },

  // ── B. 类型专属挑战 ──
  {
    id: 'antiSlack', name: '反摸鱼斗士', description: '一周摸鱼总时长不超过 30 分钟',
    type: 'type_specific', category: 'challenge', userType: 'office_worker', rarity: 'rare',
    condition: { metric: 'weeklySlackMin', operator: '<=', threshold: 30 }, unlocked: false
  },
  {
    id: 'deep4h', name: '沉浸之魂', description: '单日深度专注超过 4 小时',
    type: 'type_specific', category: 'challenge', userType: 'exam_candidate', rarity: 'rare',
    condition: { metric: 'deepFocusTotalMin', operator: '>=', threshold: 240 }, unlocked: false
  },
  {
    id: 'balancedWeek', name: '平衡之道', description: '一周内每天工作时长都在 4-8 小时之间',
    type: 'type_specific', category: 'challenge', userType: 'freelancer', rarity: 'rare',
    condition: { metric: 'balancedWeek', operator: '==', threshold: 1 }, unlocked: false
  },
  {
    id: 'nightOwl7', name: '自习室之王', description: '连续 7 天在晚间（19 点后）深度专注超过 2 小时',
    type: 'type_specific', category: 'challenge', userType: 'student', rarity: 'rare',
    condition: { metric: 'eveningDeepStreak', operator: 'streak', threshold: 120, duration: 7 }, unlocked: false
  },
  {
    id: 'flow2h', name: '心流捕手', description: '单次深度创作超过 2 小时无中断',
    type: 'type_specific', category: 'challenge', userType: 'creator', rarity: 'rare',
    condition: { metric: 'deepFocusMaxStreak', operator: '>=', threshold: 120 }, unlocked: false
  },
  {
    id: 'sustainable30', name: '可持续燃烧', description: '连续 30 天综合评分不低于 750 分，且无单日低于 600 分',
    type: 'type_specific', category: 'challenge', userType: 'entrepreneur', rarity: 'epic',
    condition: { metric: 'scoreAbove', operator: 'streak', threshold: 750, duration: 30 }, unlocked: false
  }
]
