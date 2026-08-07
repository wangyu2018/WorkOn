/**
 * v2.9 模块 B：规则富化引擎 —— 正则 + 静态字典提取五维信息（对象/内容/项目/位置/产出）
 * 依据：design-spec-v2.9 §3.B（规则表全量照抄；独立化为可单独运行的引擎，非 LLM 前置步骤）
 * 三步流水线：appContentMap 静态映射 → 规则按 priority first-wins 合并 → 计划交叉匹配（置信度 0.9）
 */
import type { EnrichmentResult, PlanItem, TrailSegment, WorkState, OutputType } from '@shared/types'
import type { IndustryVocabulary } from '@shared/industryVocab'
import { matchPlanByTime } from './planMatcher'

// === 规则定义 ===
export interface EnrichmentRule {
  id: string
  pattern: RegExp
  appFilter?: string[] // 只在某些应用下生效
  extract: (match: RegExpMatchArray, context: RuleContext) => Partial<EnrichmentResult>
  priority: number // 规则优先级，高优先级先跑
  enabled: boolean
}

export interface RuleContext {
  recentPlans: PlanItem[] // 最近的计划项（用于交叉匹配）
  industryVocab?: IndustryVocabulary // 行业词库（静态数据，非AI）
}

// === 规则集（内置，v2.9 §3.B 照抄）===
export const builtinRules: EnrichmentRule[] = [
  // ─── 文档类 ───
  {
    id: 'doc-with-subject',
    pattern: /(.+?)[\-—_\s]+(.+?)\.(docx?|pdf|xlsx?|pptx?|md|txt)/i,
    extract: (m) => ({
      subject: { name: m[1], type: 'client', confidence: 0.85 },
      output: { type: 'document', name: m[0], confidence: 0.9 }
    }),
    priority: 10,
    enabled: true
  },
  {
    id: 'doc-generic',
    pattern: /(.+?)\.(docx?|pdf|xlsx?|pptx?|md|txt)/i,
    extract: (m) => ({
      output: { type: 'document', name: m[0], confidence: 0.7 }
    }),
    priority: 5,
    enabled: true
  },

  // ─── 通信类 ───
  {
    id: 'meeting-app',
    pattern: /(.+?)\s*[—\-]\s*(腾讯会议|Zoom|Teams|钉钉|飞书|Google Meet)/,
    extract: (m) => ({
      subject: { name: m[1], type: 'team', confidence: 0.7 },
      location: { target: m[2], type: 'system', confidence: 0.9 },
      contentTag: { category: '视频会议', confidence: 0.85 }
    }),
    priority: 10,
    enabled: true
  },
  {
    id: 'chat-with-person',
    pattern: /与(.+?)[的]?(微信|电话|视频|会议|邮件)/,
    extract: (m) => ({
      subject: { name: m[1], type: 'person', confidence: 0.85 },
      contentTag: { category: m[2] + '沟通', confidence: 0.8 }
    }),
    priority: 8,
    enabled: true
  },
  {
    id: 'wechat-contact',
    appFilter: ['WeChat', '微信'],
    pattern: /^(.+?)$/,
    extract: (m) => {
      // 微信窗口标题通常就是聊天对象名
      const title = m[0].trim()
      if (title.length > 1 && title.length < 20 && !title.includes('-')) {
        return {
          subject: { name: title, type: 'person', confidence: 0.6 },
          contentTag: { category: '微信沟通', confidence: 0.7 }
        }
      }
      return {}
    },
    priority: 3,
    enabled: true
  },

  // ─── IDE/编辑器类 ───
  {
    id: 'ide-workspace',
    appFilter: ['Code', 'VSCode', 'Cursor', 'WebStorm', 'Sublime', 'Vim', 'Visual Studio', 'Rider', 'IntelliJ', 'Windsurf', 'Trae'],
    pattern: /^(.+?)\s*[—\-]\s*(.+)$/,
    extract: (m) => ({
      // 注：规格中 project 带 source:'workspace' 标记，shared 类型无该字段，故略去
      project: { name: m[1], confidence: 0.75 },
      output: { type: 'code', name: m[2], confidence: 0.7 }
    }),
    priority: 8,
    enabled: true
  },
  {
    id: 'cursor-aidev',
    appFilter: ['Cursor', 'Windsurf', 'Trae'],
    pattern: /.*/,
    extract: () => ({
      contentTag: { category: 'AI辅助开发', confidence: 0.8 }
    }),
    priority: 2,
    enabled: true
  },

  // ─── 终端/SSH类 ───
  {
    id: 'ssh-target',
    appFilter: ['Terminal', 'iTerm', 'Windows Terminal', 'PuTTY', 'Tabby', 'Transfer/SSH'],
    pattern: /(.+?)@([\w\-.]+):/,
    extract: (m) => ({
      location: { target: m[2], type: 'server', confidence: 0.9 },
      subject: { name: m[1], type: 'unknown', confidence: 0.7 }
    }),
    priority: 10,
    enabled: true
  },
  {
    id: 'ssh-command',
    appFilter: ['Terminal', 'iTerm', 'Windows Terminal', 'Transfer/SSH'],
    pattern: /(ssh|scp|rsync)\s+.*@([\w\-.]+)/,
    extract: (m) => ({
      location: { target: m[2], type: 'server', confidence: 0.95 },
      contentTag: { category: '远程部署', confidence: 0.85 }
    }),
    priority: 12,
    enabled: true
  },
  {
    id: 'docker-command',
    appFilter: ['Terminal', 'iTerm', 'Windows Terminal'],
    pattern: /docker\s+(build|run|push|pull|compose)/,
    extract: () => ({
      contentTag: { category: '容器管理', confidence: 0.85 },
      output: { type: 'config', name: 'docker', confidence: 0.7 }
    }),
    priority: 8,
    enabled: true
  },

  // ─── 浏览器类 ───
  {
    id: 'jira-ticket',
    appFilter: ['Chrome', 'Edge', 'Firefox', 'Safari', 'Browser'],
    pattern: /([A-Z]+[-]\d+)/,
    extract: (m) => ({
      project: { name: m[1], confidence: 0.6 },
      contentTag: { category: '任务跟踪', confidence: 0.7 }
    }),
    priority: 6,
    enabled: true
  },
  {
    id: 'github-repo',
    appFilter: ['Chrome', 'Edge', 'Firefox', 'Safari', 'Browser'],
    pattern: /github\.com[\/:]([\w\-]+)\/([\w\-]+)/,
    extract: (m) => ({
      project: { name: m[2], confidence: 0.8 },
      location: { target: 'GitHub', type: 'repository', confidence: 0.9 }
    }),
    priority: 8,
    enabled: true
  },

  // ─── 项目关键词匹配 ───
  {
    id: 'project-keyword',
    pattern: /([一-龥]+)[\-—_\s]*项目/,
    extract: (m) => ({
      project: { name: m[1] + '项目', confidence: 0.8 }
    }),
    priority: 7,
    enabled: true
  }
]

// === 应用→内容静态映射（无需AI，v2.9 §3.B 照抄）===
export const appContentMap: Record<string, { state: WorkState; contentTag: string; outputType?: OutputType }> = {
  Cursor: { state: 'aidev', contentTag: 'AI辅助开发', outputType: 'code' },
  Code: { state: 'coding', contentTag: '代码开发', outputType: 'code' },
  VSCode: { state: 'coding', contentTag: '代码开发', outputType: 'code' },
  WebStorm: { state: 'coding', contentTag: '代码开发', outputType: 'code' },
  Word: { state: 'writing', contentTag: '文档撰写', outputType: 'document' },
  WPS: { state: 'writing', contentTag: '文档撰写', outputType: 'document' },
  Office: { state: 'writing', contentTag: '文档撰写', outputType: 'document' },
  Excel: { state: 'writing', contentTag: '表格处理', outputType: 'data' },
  PowerPoint: { state: 'writing', contentTag: 'PPT制作', outputType: 'document' },
  // 注：规格原文设计类应用状态为 design，本项目 WorkState 无该态，就近映射为 focus
  Figma: { state: 'focus', contentTag: 'UI设计', outputType: 'design' },
  Design: { state: 'focus', contentTag: 'UI设计', outputType: 'design' },
  Photoshop: { state: 'focus', contentTag: '图像处理', outputType: 'design' },
  Postman: { state: 'coding', contentTag: '接口测试', outputType: 'other' },
  Docker: { state: 'remote', contentTag: '容器管理', outputType: 'config' },
  腾讯会议: { state: 'meeting', contentTag: '视频会议', outputType: 'communication' },
  Zoom: { state: 'meeting', contentTag: '视频会议', outputType: 'communication' },
  Meeting: { state: 'meeting', contentTag: '视频会议', outputType: 'communication' },
  WeChat: { state: 'meeting', contentTag: '即时通讯', outputType: 'communication' },
  微信: { state: 'meeting', contentTag: '即时通讯', outputType: 'communication' },
  钉钉: { state: 'meeting', contentTag: '即时通讯', outputType: 'communication' },
  DingTalk: { state: 'meeting', contentTag: '即时通讯', outputType: 'communication' },
  飞书: { state: 'meeting', contentTag: '即时通讯', outputType: 'communication' },
  Feishu: { state: 'meeting', contentTag: '即时通讯', outputType: 'communication' },
  Outlook: { state: 'meeting', contentTag: '邮件处理', outputType: 'communication' },
  Foxmail: { state: 'meeting', contentTag: '邮件处理', outputType: 'communication' },
  Terminal: { state: 'remote', contentTag: '命令行操作', outputType: 'config' },
  'Windows Terminal': { state: 'remote', contentTag: '命令行操作', outputType: 'config' },
  Notion: { state: 'writing', contentTag: '文档编辑', outputType: 'document' },
  Notes: { state: 'writing', contentTag: '文档编辑', outputType: 'document' },
  Obsidian: { state: 'writing', contentTag: '笔记整理', outputType: 'document' },
  // 注：规格原文 Chrome 状态为 research，本项目 WorkState 无该态，就近映射为 focus
  Chrome: { state: 'focus', contentTag: '信息检索', outputType: 'other' },
  Browser: { state: 'focus', contentTag: '信息检索', outputType: 'other' },
  // ── 以下为对齐本项目 identifyApp 实际友好名的补充（stateMeta APP_RULES）──
  QQ: { state: 'meeting', contentTag: '即时通讯', outputType: 'communication' },
  'Visual Studio': { state: 'coding', contentTag: '代码开发', outputType: 'code' },
  Rider: { state: 'coding', contentTag: '代码开发', outputType: 'code' },
  IntelliJ: { state: 'coding', contentTag: '代码开发', outputType: 'code' },
  Windsurf: { state: 'aidev', contentTag: 'AI辅助开发', outputType: 'code' },
  Trae: { state: 'aidev', contentTag: 'AI辅助开发', outputType: 'code' },
  DevTool: { state: 'coding', contentTag: '开发工具', outputType: 'other' },
  'Transfer/SSH': { state: 'remote', contentTag: '远程操作', outputType: 'config' },
  PerfTest: { state: 'coding', contentTag: '性能测试', outputType: 'other' },
  Launcher: { state: 'focus', contentTag: '工具使用', outputType: 'other' },
  Recorder: { state: 'focus', contentTag: '屏幕录制', outputType: 'other' }
}

/**
 * 段富化三步流水线（v2.9 §3.B）
 * Step 1: 应用静态映射（最高优先级，确定性）
 * Step 2: 规则按 priority 降序执行，first-wins 合并（已有字段不被低优先级覆盖）
 * Step 3: 行业词库命中补缺失字段 → 计划交叉匹配（置信度 0.9，直接覆盖 project）
 */
export function enrichSegment(segment: TrailSegment, context: RuleContext): EnrichmentResult {
  const result: EnrichmentResult = {}
  const app = segment.mainApp ?? ''
  const title = segment.mainTitle ?? ''

  // Step 1: 应用静态映射（mainApp 可能是 "Terminal · workon" 复合名，取前缀匹配）
  const appMapping = appContentMap[app] ?? appContentMap[app.split(' · ')[0]]
  if (appMapping) {
    result.contentTag = { category: appMapping.contentTag, confidence: 0.9 }
  }

  // Step 2: 按优先级执行匹配的规则
  const applicableRules = builtinRules
    .filter((r) => r.enabled)
    .filter((r) => !r.appFilter || r.appFilter.some((a) => app.includes(a)))
    .sort((a, b) => b.priority - a.priority)

  for (const rule of applicableRules) {
    const match = title.match(rule.pattern)
    if (match) {
      const extracted = rule.extract(match, context)
      mergeEnrichment(result, extracted)
    }
  }

  // Step 2.5: 行业词库命中（不覆盖已有字段）
  // title 命中 projectPatterns → project 0.75；命中 outputPatterns → contentTag 0.7
  const vocab = context.industryVocab
  if (vocab && title) {
    if (!result.project) {
      const hit = vocab.keywords.projectPatterns.find((p) => title.includes(p))
      if (hit) result.project = { name: hit, confidence: 0.75 }
    }
    if (!result.contentTag) {
      const hit = vocab.keywords.outputPatterns.find((p) => title.includes(p))
      if (hit) result.contentTag = { category: hit, confidence: 0.7 }
    }
  }

  // Step 3: 计划项交叉匹配（最高置信度 0.9，直接覆盖 project）
  if (context.recentPlans.length > 0) {
    const matchedPlan = matchPlanByTime(segment, context.recentPlans)
    if (matchedPlan) {
      result.project = { name: matchedPlan.title, confidence: 0.9 }
    }
  }

  return result
}

/** 合并富化结果：只填充 base 中缺失的字段 */
export function mergeEnrichment(base: EnrichmentResult, addon: Partial<EnrichmentResult>): void {
  if (!base.subject && addon.subject) base.subject = addon.subject
  if (!base.contentTag && addon.contentTag) base.contentTag = addon.contentTag
  if (!base.project && addon.project) base.project = addon.project
  if (!base.location && addon.location) base.location = addon.location
  if (!base.output && addon.output) base.output = addon.output
}
