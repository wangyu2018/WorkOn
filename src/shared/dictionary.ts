/**
 * 产品词典（工作域词汇包）— 显示层，不是数据层。
 *
 * 原则：
 * - 数据库永远存标准概念（Project/Plan/Task）；词典只决定界面「说什么话」。
 * - 每个词汇包只写与父包的差异词（继承链），未定义的词自动回落 generic（人话打底）。
 * - 解析顺序：项目工作域 → 主角色默认域 → generic。
 * - 黑话禁入：任何包里的词必须是该角色日常真实在用的词。
 */

import type { UserType } from './types'

/** 工作域：预置 + 自定义字符串 */
export type WorkDomain =
  | 'generic'
  | 'dev'
  | 'ops'
  | 'impl'
  | 'ai_dev'
  | 'exam'
  | 'finance'
  | 'startup'
  | 'office'
  | 'creative'
  | (string & {})

/** 词条 key：只收高频触点词，控制在 ~20 个；新词先问「用户一天会看到几次」 */
export type TermKey =
  | 'project' // 项目 / 科目 / 账套 / 作品
  | 'projectNew' // 新建项目 / 新建科目
  | 'projectTask' // 项目任务 / 科目任务
  | 'plan' // 计划 / 复习计划 / 排期
  | 'step' // 步骤 / 任务 / 章节 / 凭证 / 事项
  | 'statusCard' // 状态卡 / 站会纪要 / 每日复盘 / 工作底稿
  | 'attrBag' // 属性袋 / 知识点标签
  | 'focusFlow' // 连续工作 / 心流 / 刷题时段
  | 'mainline' // 主线 / 备考主线
  | 'report' // 报表 / 学习报告
  | 'dailyReport' // 日报 / 学习日报
  | 'goal' // 目标
  | 'todayTodo' // 今日待办
  | 'askProjectQ' // 这段操作要挂到哪个项目？（归属提问）
  | 'askStillQ' // 这段操作还是在做项目「{p}」吗？（归属确认）
  | 'askBindHint' // 「{h}」尚未挂到任何项目
  | 'driftWhy' // 你刚才挂在「{p}」，但现在这段操作不在该项目的绑定线索里
  | 'unattrShort' // 未归属 / 未认领
  | 'newPlanPh' // 新建计划占位文案

export interface TermPack {
  /** 父包：未定义的词从这里回落 */
  extends?: WorkDomain
  terms: Partial<Record<TermKey, string>>
}

/** 域元信息（项目编辑里的域选择器 / 主角色映射用） */
export const DOMAIN_META: Record<string, { label: string; emoji: string; desc: string }> = {
  generic: { label: '通用', emoji: '🌐', desc: '中性说法，适合混合工作' },
  dev: { label: '开发', emoji: '🧑‍💻', desc: '写代码、调试、评审' },
  ops: { label: '运维', emoji: '🔧', desc: '部署、巡检、告警处理' },
  impl: { label: '实施', emoji: '🤝', desc: '客户现场、交付验收' },
  ai_dev: { label: 'AI 开发', emoji: '🤖', desc: '训练、微调、评测' },
  exam: { label: '备考', emoji: '📖', desc: '按科目复习、刷题' },
  finance: { label: '财务', emoji: '🧾', desc: '做账、对账、出报表' },
  startup: { label: '创业', emoji: '🚀', desc: '产品、融资、客户' },
  office: { label: '办公', emoji: '💼', desc: '日常事务、会议、周报' },
  creative: { label: '创作', emoji: '✍️', desc: '写作、内容、作品' }
}

/** generic = 人话打底（上一轮术语方案的落地载体），所有包的最终回落 */
const PACKS: Record<string, TermPack> = {
  generic: {
    terms: {
      project: '项目',
      projectNew: '新建项目',
      projectTask: '项目任务',
      plan: '计划',
      step: '步骤',
      statusCard: '状态卡',
      attrBag: '属性袋',
      focusFlow: '连续工作',
      mainline: '主线',
      report: '报表',
      dailyReport: '日报',
      goal: '目标',
      todayTodo: '今日待办',
      askProjectQ: '这段操作要挂到哪个项目？',
      askStillQ: '这段操作还是在做项目「{p}」吗？',
      askBindHint: '「{h}」尚未挂到任何项目',
      driftWhy: '你刚才挂在「{p}」，但现在这段操作不在该项目的绑定线索里',
      unattrShort: '未归属',
      newPlanPh: '新计划，如：周三下午3点组会'
    }
  },
  dev: {
    extends: 'generic',
    terms: {
      step: '任务',
      statusCard: '站会纪要',
      focusFlow: '心流',
      askProjectQ: '这段在写哪个仓库？',
      newPlanPh: '新任务，如：周四前联调登录接口'
    }
  },
  ops: {
    extends: 'dev',
    terms: {
      focusFlow: '在线时段',
      askProjectQ: '这是在处理哪个系统的事？'
    }
  },
  impl: {
    extends: 'dev',
    terms: {
      statusCard: '交付清单',
      focusFlow: '现场时段',
      askProjectQ: '这是哪家客户的活？'
    }
  },
  ai_dev: {
    extends: 'dev',
    terms: {
      statusCard: '实验记录',
      askProjectQ: '这是在调哪个模型/管道？'
    }
  },
  exam: {
    extends: 'generic',
    terms: {
      project: '科目',
      projectNew: '新建科目',
      projectTask: '科目任务',
      plan: '复习计划',
      step: '章节',
      statusCard: '每日复盘',
      attrBag: '知识点标签',
      focusFlow: '刷题时段',
      mainline: '备考主线',
      report: '学习报告',
      dailyReport: '学习日报',
      goal: '提分目标',
      askProjectQ: '刚才在学哪一科？',
      askStillQ: '刚才还是在复习「{p}」吗？',
      newPlanPh: '新计划，如：晚上8点刷英语阅读两篇'
    }
  },
  finance: {
    extends: 'generic',
    terms: {
      project: '账套',
      projectNew: '新建账套',
      plan: '排期',
      step: '凭证',
      statusCard: '工作底稿',
      attrBag: '科目标签',
      focusFlow: '做账时段',
      goal: '节点',
      askProjectQ: '这是在处理哪家的账？',
      newPlanPh: '新计划，如：周五前出月度报表'
    }
  },
  startup: {
    extends: 'generic',
    terms: {
      project: '事项',
      plan: '排期',
      step: '节点',
      statusCard: '进展纪要',
      focusFlow: '冲刺时段',
      askProjectQ: '这是哪条业务线的事？',
      newPlanPh: '新计划，如：下周三见投资人'
    }
  },
  office: {
    extends: 'generic',
    terms: {
      plan: '排期',
      step: '事项',
      statusCard: '周报素材',
      focusFlow: '专注时段',
      askProjectQ: '这是在忙哪项工作？'
    }
  },
  creative: {
    extends: 'generic',
    terms: {
      project: '作品',
      projectNew: '新建作品',
      plan: '创作计划',
      step: '稿',
      statusCard: '进度小记',
      attrBag: '素材标签',
      focusFlow: '心流',
      askProjectQ: '刚才在写哪个作品？',
      newPlanPh: '新计划，如：周六上午写第三章'
    }
  }
}

/** 解析继承链上的词：域包 → … → generic；自定义域直接回落 generic */
export function resolveTerm(domain: string | undefined, key: TermKey): string {
  let d: string | undefined = domain && PACKS[domain] ? domain : 'generic'
  const seen = new Set<string>()
  while (d && !seen.has(d)) {
    seen.add(d)
    const pack: TermPack | undefined = PACKS[d]
    const hit = pack?.terms[key]
    if (hit) return hit
    d = pack?.extends
  }
  const fallback = PACKS.generic.terms[key]
  return fallback ?? key
}

/** 主角色 → 默认域（无项目上下文时用：悬浮窗空闲态、问候语） */
export function defaultDomainOfUserType(userType: string | undefined): WorkDomain {
  switch (userType) {
    case 'developer':
      return 'dev'
    case 'exam_candidate':
    case 'student':
      return 'exam'
    case 'creator':
      return 'creative'
    case 'entrepreneur':
      return 'startup'
    case 'office_worker':
      return 'office'
    default:
      return 'generic'
  }
}

/** 带参数的词条：{p}/{h} 占位替换 */
export function formatTerm(tpl: string, params: Record<string, string>): string {
  return tpl.replace(/\{(\w+)\}/g, (_, k: string) => params[k] ?? '')
}

/** 猜域：从目录名/绑定线索/属性里找行话关键词（一次性建议用，不自动写） */
export function guessDomain(hints: { dirs?: string[]; keywords?: string[]; text?: string }): WorkDomain | null {
  const blob = [...(hints.dirs ?? []), ...(hints.keywords ?? []), hints.text ?? ''].join(' ').toLowerCase()
  if (!blob.trim()) return null
  const RULES: [RegExp, WorkDomain][] = [
    [/docker|k8s|kubernetes|nginx|deploy|部署|运维|jenkins|gitlab-ci/, 'ops'],
    [/训练|微调|finetune|lora|dataset|推理|eval|checkpoint|模型/, 'ai_dev'],
    [/验收|uat|客户现场|交付|实施/, 'impl'],
    [/\.py|\.ts|\.tsx|\.go|\.rs|\.java|src[/\\]|组件|接口|repo|仓库/, 'dev'],
    [/真题|anki|刷题|考研|复试|政治|英语一|数学\d|章节|知识点/, 'exam'],
    [/账套|凭证|对账|报税|总账|底稿/, 'finance'],
    [/bp|路演|融资|pitch|投资人|商业计划/, 'startup'],
    [/初稿|投稿|约稿|公众号|连载|manuscript|章节稿/, 'creative']
  ]
  for (const [re, domain] of RULES) {
    if (re.test(blob)) return domain
  }
  return null
}

/** 域选择器用的预置列表（保持 DOMAIN_META 顺序） */
export const PRESET_DOMAINS: WorkDomain[] = [
  'generic',
  'dev',
  'ops',
  'impl',
  'ai_dev',
  'exam',
  'finance',
  'startup',
  'office',
  'creative'
]
