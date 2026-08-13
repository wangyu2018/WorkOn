/**
 * v2.6.1 作业链路模板库 + 窗口标题语义表（纯本地规则，无 LLM）
 * 依据：design-spec-v2.6.1 §3 六类用户链路模板库 / §4.3 窗口标题语义匹配规则
 * 应用名一律对齐 shared/stateMeta.ts APP_RULES 的友好名口径
 * （VSCode / Cursor / WeChat / QQ / DingTalk / Feishu / Meeting / Office / Notes /
 *   Chrome / Browser / Terminal（可能带 "Terminal · 目录" 后缀）/ Design /
 *   VideoSite / Video / Music / Game / DevTool / Transfer/SSH …）
 * 未识别应用兜底为进程名（如 anki / matlab / OUTLOOK），正则均大小写不敏感
 */
import type { ChainRole, ChainTemplate, UserChainConfig } from '@shared/chain'
import type { UserType } from '@shared/types'

// ───────────────────────── 窗口标题语义匹配（spec §4.3） ─────────────────────────

interface TitlePatternEntry {
  regex: RegExp
  context: string
  role: ChainRole | null
}

interface TitlePatternGroup {
  app: string // 应用名正则（友好名口径）
  patterns: TitlePatternEntry[]
}

export const TITLE_PATTERNS: Record<string, TitlePatternGroup> = {
  // 沟通工具上下文判定
  COMMUNICATION_CONTEXT: {
    app: '^(WeChat|QQ|DingTalk|Feishu)$|微信|钉钉|飞书|企业微信|Slack|Teams',
    patterns: [
      // 工作上下文
      { regex: /(总|经理|主管|老板|领导|主任|老师|教授)/i, context: 'work', role: 'intake' },
      { regex: /(项目|需求|任务|方案|报告|评审|会议)/i, context: 'work', role: 'communication' },
      { regex: /(工作群|项目群|部门|团队)/i, context: 'work', role: 'communication' },
      // 摸鱼上下文
      { regex: /(水群|摸鱼|快乐|闲聊|吹水|八卦)/i, context: 'slacking', role: null },
      { regex: /(朋友圈|视频号|看一看)/i, context: 'slacking', role: null }
    ]
  },

  // 浏览器上下文判定
  BROWSER_CONTEXT: {
    app: '^(Chrome|Browser)$|Edge|Firefox|Safari|浏览器',
    patterns: [
      // 工作搜索
      { regex: /(google|baidu|bing).*[?&](q|wd|search)=(.+)/i, context: 'search', role: 'intake' },
      { regex: /(stackoverflow|github|掘金|csdn|知乎.*技术)/i, context: 'work', role: 'intake' },
      { regex: /(mdn|文档|docs|api)/i, context: 'work', role: 'intake' },
      // 学习搜索
      { regex: /(考研|真题|复习|课程|教程|网课)/i, context: 'study', role: 'intake' },
      // 创作素材
      { regex: /(pinterest|behance|dribbble|unsplash|花瓣)/i, context: 'creative', role: 'intake' },
      // 摸鱼
      { regex: /(微博|抖音|快手|小红书|bilibili.*娱乐|淘宝|京东)/i, context: 'slacking', role: null },
      { regex: /(游戏|直播|视频.*娱乐)/i, context: 'slacking', role: null }
    ]
  },

  // 会议软件上下文判定
  MEETING_CONTEXT: {
    app: '^Meeting$|腾讯会议|Zoom|Teams|飞书会议|钉钉会议',
    patterns: [
      { regex: /(会议|Meeting|周会|评审|站会|standup|review)/i, context: 'meeting', role: 'communication' },
      { regex: /(闲聊|聊天)/i, context: 'slacking', role: null }
    ]
  },

  // 终端上下文判定（友好名可能带 "Terminal · 目录" 后缀）
  TERMINAL_CONTEXT: {
    app: '^Terminal|PowerShell|CMD|iTerm|Windows Terminal',
    patterns: [
      { regex: /(root|ssh|deploy|build|test|git|docker|kubectl)/i, context: 'devops', role: 'process' },
      { regex: /(.+)@(.+):/i, context: 'remote', role: 'process' } // SSH 远程
    ]
  },

  // B站特殊判定（独立客户端友好名 VideoSite；网页版由 BROWSER_CONTEXT 覆盖）
  BILIBILI_CONTEXT: {
    app: '^VideoSite$|bilibili|B站',
    patterns: [
      { regex: /(教程|课程|讲解|教学|lecture|tutorial)/i, context: 'study', role: 'intake' },
      { regex: /(搞笑|娱乐|综艺|鬼畜)/i, context: 'slacking', role: null }
    ]
  }
}

/** 解析窗口标题上下文（正则 + 关键词，不需要 LLM；spec §4.3 parseWindowTitle 移植） */
export function parseWindowTitle(
  appName: string,
  windowTitle: string
): { context: string; role: ChainRole | null; isSlacking: boolean } {
  for (const config of Object.values(TITLE_PATTERNS)) {
    if (new RegExp(config.app, 'i').test(appName)) {
      for (const pattern of config.patterns) {
        if (pattern.regex.test(windowTitle)) {
          return { context: pattern.context, role: pattern.role, isSlacking: pattern.context === 'slacking' }
        }
      }
    }
  }
  // 默认：无法判定上下文
  return { context: 'unknown', role: null, isSlacking: false }
}

// ───────────────────────── 应用名模式常量（对齐 APP_RULES 友好名） ─────────────────────────

/** 即时沟通工具 */
const COMM = '^(WeChat|QQ|DingTalk|Feishu)$'
/** 办公套件（Word/Excel/PPT/WPS 统一友好名 Office） */
const OFFICE = '^Office$'
/** 笔记/文档工具（Notion/Obsidian/Typora/语雀/思源 统一友好名 Notes） */
const NOTES = '^Notes$'
/** IDE / AI IDE */
const IDE = '^(VSCode|Visual Studio|Rider|IntelliJ|Cursor|Windsurf|Trae)$'
/** AI 助手（AI IDE；网页版 AI 问答混在浏览器里无法按应用区分，P0 不拆） */
const AI_IDE = '^(Cursor|Windsurf|Trae)$'
/** 终端（含 "Terminal · 目录" 复合名）与远程工具 */
const TERMINAL = '^Terminal|Transfer/SSH'
/** 会议软件（Teams/Zoom/腾讯会议 统一友好名 Meeting） */
const MEETING = '^Meeting$'
/** 浏览器 */
const BROWSER = '^(Chrome|Browser)$'
/** 设计/创作工具（Figma/PS/AI/PR/AE/Canva 统一友好名 Design） */
const DESIGN = '^Design$'
/** 邮件客户端（未识别进程兜底名） */
const MAIL = 'outlook|foxmail|mail|邮件'
/** 记忆软件（未识别进程兜底名） */
const ANKI = 'anki|记忆'
/** 沟通工具标题排除词（水群/闲聊上下文） */
const CHAT_EXCLUDE = ['水群', '摸鱼', '闲聊', '吹水', '八卦', '朋友圈', '视频号', '看一看']

// ───────────────────────── 六类用户链路模板库（spec §3） ─────────────────────────

const OFFICE_WORKER_TEMPLATES: ChainTemplate[] = [
  {
    id: 'office-leader-task',
    name: '领导任务执行链',
    type: 'task_assigned',
    userType: 'office_worker',
    requireOutput: true,
    steps: [
      { appPattern: COMM, role: 'intake', titleExclude: CHAT_EXCLUDE },
      { appPattern: `${OFFICE}|${NOTES}`, role: 'process' },
      { appPattern: AI_IDE, role: 'process' },
      { appPattern: `${OFFICE}|${NOTES}`, role: 'output' },
      { appPattern: COMM, role: 'output', titleExclude: CHAT_EXCLUDE }
    ]
  },
  {
    id: 'office-meeting-exec',
    name: '会议执行链',
    type: 'meeting',
    userType: 'office_worker',
    requireOutput: false,
    steps: [
      { appPattern: MEETING, role: 'communication', minDurationMin: 15 },
      { appPattern: `${NOTES}|${OFFICE}`, role: 'process' },
      { appPattern: `${IDE}|${OFFICE}|DevTool`, role: 'process' }
    ]
  },
  {
    id: 'office-doc-solo',
    name: '文档独立产出链',
    type: 'self_driven',
    userType: 'office_worker',
    requireOutput: false,
    steps: [
      { appPattern: OFFICE, role: 'process', minDurationMin: 20 },
      { appPattern: `${MAIL}|${COMM}`, role: 'output' }
    ]
  },
  {
    id: 'office-dev',
    name: '代码开发链',
    type: 'self_driven',
    userType: 'office_worker',
    requireOutput: false,
    steps: [
      { appPattern: IDE, role: 'process' },
      { appPattern: TERMINAL, role: 'process' },
      { appPattern: TERMINAL, role: 'output', titleKeywords: ['git', 'push', 'deploy', 'build', 'commit'] }
    ]
  }
]

const EXAM_CANDIDATE_TEMPLATES: ChainTemplate[] = [
  {
    id: 'exam-course',
    name: '网课学习链',
    type: 'learning',
    userType: 'exam_candidate',
    requireOutput: false,
    steps: [
      { appPattern: `${BROWSER}|^VideoSite$`, role: 'intake', titleKeywords: ['课程', '教程', '网课', '考研', '讲解', '教学', 'lecture', 'tutorial'] },
      { appPattern: `${NOTES}|${OFFICE}`, role: 'process' },
      { appPattern: ANKI, role: 'process' }
    ]
  },
  {
    id: 'exam-practice',
    name: '刷题链',
    type: 'learning',
    userType: 'exam_candidate',
    requireOutput: false,
    steps: [
      { appPattern: BROWSER, role: 'intake', titleKeywords: ['真题', '试题', '模拟', '题库', '.pdf'] },
      { appPattern: `${NOTES}|${OFFICE}`, role: 'process' },
      { appPattern: `${NOTES}|${OFFICE}`, role: 'review', titleKeywords: ['错题', '笔记'] }
    ]
  },
  {
    id: 'exam-memorize',
    name: '背诵记忆链',
    type: 'learning',
    userType: 'exam_candidate',
    requireOutput: false,
    steps: [
      { appPattern: ANKI, role: 'process', minDurationMin: 15 },
      { appPattern: NOTES, role: 'review' }
    ]
  },
  {
    id: 'exam-review',
    name: '复习整理链',
    type: 'learning',
    userType: 'exam_candidate',
    requireOutput: false,
    steps: [
      { appPattern: NOTES, role: 'process', minDurationMin: 20 },
      { appPattern: BROWSER, role: 'review', titleKeywords: ['.pdf', 'pdf', '教材', '讲义'] },
      { appPattern: NOTES, role: 'output' }
    ]
  }
]

const FREELANCER_TEMPLATES: ChainTemplate[] = [
  {
    id: 'free-design-deliver',
    name: '设计交付链',
    type: 'creative',
    userType: 'freelancer',
    requireOutput: false,
    steps: [
      { appPattern: DESIGN, role: 'process' },
      { appPattern: COMM, role: 'communication', titleExclude: CHAT_EXCLUDE },
      { appPattern: BROWSER, role: 'output', titleKeywords: ['交付', '上传', '发布', 'upload', 'behance', '站酷'] }
    ]
  },
  {
    id: 'free-dev-deliver',
    name: '开发交付链',
    type: 'self_driven',
    userType: 'freelancer',
    requireOutput: false,
    steps: [
      { appPattern: IDE, role: 'process' },
      { appPattern: TERMINAL, role: 'process' },
      { appPattern: TERMINAL, role: 'output', titleKeywords: ['git', 'push', 'deploy'] },
      { appPattern: COMM, role: 'output', titleExclude: CHAT_EXCLUDE }
    ]
  },
  {
    id: 'free-client-comm',
    name: '客户沟通链',
    type: 'task_assigned',
    userType: 'freelancer',
    requireOutput: true,
    steps: [
      { appPattern: COMM, role: 'intake', titleExclude: CHAT_EXCLUDE },
      { appPattern: `${IDE}|${OFFICE}|${NOTES}|${DESIGN}`, role: 'process' },
      { appPattern: COMM, role: 'output', titleExclude: CHAT_EXCLUDE }
    ]
  }
]

const STUDENT_TEMPLATES: ChainTemplate[] = [
  {
    id: 'stu-homework',
    name: '课程作业链',
    type: 'task_assigned',
    userType: 'student',
    requireOutput: false,
    steps: [
      { appPattern: `${BROWSER}|^VideoSite$`, role: 'intake', titleKeywords: ['课程', '课件', '网课', '教程', 'mooc', '慕课'] },
      { appPattern: OFFICE, role: 'process' },
      { appPattern: BROWSER, role: 'output', titleKeywords: ['提交', '上传', 'submit', 'upload', '作业'] }
    ]
  },
  {
    id: 'stu-self-study',
    name: '自习复习链',
    type: 'learning',
    userType: 'student',
    requireOutput: false,
    steps: [
      { appPattern: BROWSER, role: 'intake', titleKeywords: ['.pdf', 'pdf', '教材', '讲义', '课件'] },
      { appPattern: `${NOTES}|${OFFICE}`, role: 'process' },
      { appPattern: BROWSER, role: 'process', titleKeywords: ['练习', '题库', '试题'] }
    ]
  },
  {
    id: 'stu-lab-report',
    name: '实验报告链',
    type: 'self_driven',
    userType: 'student',
    requireOutput: false,
    steps: [
      { appPattern: 'matlab|spss|python|^VSCode$|^IntelliJ$', role: 'process' },
      { appPattern: OFFICE, role: 'process', titleKeywords: ['实验报告', '报告', '实验'] },
      { appPattern: BROWSER, role: 'output', titleKeywords: ['提交', '上传', 'submit'] }
    ]
  }
]

const CREATOR_TEMPLATES: ChainTemplate[] = [
  {
    id: 'creator-video',
    name: '视频创作链',
    type: 'creative',
    userType: 'creator',
    requireOutput: false,
    steps: [
      { appPattern: BROWSER, role: 'intake', titleKeywords: ['pinterest', 'behance', 'dribbble', 'unsplash', '花瓣', '素材', 'bilibili', 'youtube'] },
      { appPattern: DESIGN, role: 'process' },
      { appPattern: `${BROWSER}|^VideoSite$`, role: 'output', titleKeywords: ['发布', '上传', 'upload', 'publish', '投稿'] }
    ]
  },
  {
    id: 'creator-design',
    name: '平面设计链',
    type: 'creative',
    userType: 'creator',
    requireOutput: false,
    steps: [
      { appPattern: BROWSER, role: 'intake', titleKeywords: ['pinterest', 'behance', 'dribbble', 'unsplash', '花瓣', '素材'] },
      { appPattern: DESIGN, role: 'process' },
      { appPattern: BROWSER, role: 'output', titleKeywords: ['发布', '上传', 'upload', '导出'] }
    ]
  },
  {
    id: 'creator-writing',
    name: '文字创作链',
    type: 'creative',
    userType: 'creator',
    requireOutput: false,
    steps: [
      { appPattern: BROWSER, role: 'intake' },
      { appPattern: `${NOTES}|${OFFICE}`, role: 'process', minDurationMin: 20 },
      { appPattern: BROWSER, role: 'output', titleKeywords: ['发布', '公众号', '知乎', '投稿', 'upload'] }
    ]
  }
]

const ENTREPRENEUR_TEMPLATES: ChainTemplate[] = [
  {
    id: 'ent-decision',
    name: '决策执行链',
    type: 'self_driven',
    userType: 'entrepreneur',
    requireOutput: false,
    steps: [
      { appPattern: OFFICE, role: 'process' },
      { appPattern: `${NOTES}|${OFFICE}`, role: 'process' },
      { appPattern: COMM, role: 'output', titleExclude: CHAT_EXCLUDE }
    ]
  },
  {
    id: 'ent-multi-project',
    name: '多项目并行链',
    type: 'self_driven',
    userType: 'entrepreneur',
    requireOutput: false,
    steps: [
      { appPattern: '^(Claude|ChatGPT|AI Dev)$', role: 'process', minDurationMin: 10 },
      { appPattern: BROWSER, role: 'process', titleKeywords: ['chatgpt', 'claude', 'copilot', '代码', '实现', '重构', 'vibe', 'vibecoding', '需求', '项目'] },
      { appPattern: `${IDE}|${OFFICE}|${NOTES}|${DESIGN}|DevTool`, role: 'process', minDurationMin: 15 },
      { appPattern: `${IDE}|${OFFICE}|${NOTES}|${DESIGN}|DevTool`, role: 'process' },
      { appPattern: COMM, role: 'communication', titleExclude: CHAT_EXCLUDE }
    ]
  },
  {
    id: 'ent-roadshow',
    name: '融资/路演链',
    type: 'task_assigned',
    userType: 'entrepreneur',
    requireOutput: false,
    steps: [
      { appPattern: OFFICE, role: 'process', titleKeywords: ['路演', 'BP', '融资', '商业计划'] },
      { appPattern: COMM, role: 'communication', titleExclude: CHAT_EXCLUDE },
      { appPattern: MEETING, role: 'output' }
    ]
  }
]

// ───────────────────────── 分心应用集（spec §3 各用户类型） ─────────────────────────
// TODO：spec 的 has_active_project（有活跃项目时素材站算链路）/ time_range（非工作时段闲聊）
//       两种条件 P0 不实现，此处只保留 title_contains / in_chain 两种可判定条件

const SLACK_TITLE_KEYWORDS = ['微博', 'weibo', '抖音', 'douyin', '快手', '小红书', '淘宝', '京东', '天猫', '爱奇艺', '腾讯视频', '优酷', '综艺', '娱乐', '搞笑', '直播']

export const USER_CHAIN_CONFIGS: Record<UserType, UserChainConfig> = {
  office_worker: {
    userType: 'office_worker',
    templates: OFFICE_WORKER_TEMPLATES,
    primaryDistractions: ['^VideoSite$', '^Video$', '^Music$', '^Game$'],
    conditionalDistractions: [
      { appPattern: BROWSER, condition: 'title_contains', slackingKeywords: SLACK_TITLE_KEYWORDS },
      { appPattern: '^(WeChat|QQ)$', condition: 'title_contains', slackingKeywords: CHAT_EXCLUDE },
      { appPattern: '^(DingTalk|Feishu)$', condition: 'title_contains', slackingKeywords: ['闲聊', '摸鱼', '水群', '八卦'] }
    ]
  },
  exam_candidate: {
    userType: 'exam_candidate',
    templates: EXAM_CANDIDATE_TEMPLATES,
    primaryDistractions: ['^Game$', '^Video$', '^Music$', '^(WeChat|QQ)$'],
    conditionalDistractions: [
      { appPattern: '^VideoSite$', condition: 'title_contains', slackingKeywords: ['搞笑', '娱乐', '综艺', '鬼畜', '游戏', '直播'] },
      { appPattern: BROWSER, condition: 'title_contains', slackingKeywords: SLACK_TITLE_KEYWORDS }
    ]
  },
  freelancer: {
    userType: 'freelancer',
    templates: FREELANCER_TEMPLATES,
    primaryDistractions: ['^Video$', '^VideoSite$', '^Music$', '^Game$'],
    conditionalDistractions: [
      { appPattern: COMM, condition: 'title_contains', slackingKeywords: CHAT_EXCLUDE },
      { appPattern: BROWSER, condition: 'title_contains', slackingKeywords: SLACK_TITLE_KEYWORDS }
    ]
  },
  student: {
    userType: 'student',
    templates: STUDENT_TEMPLATES,
    primaryDistractions: ['^Game$', '^Video$', '^Music$', '^(WeChat|QQ)$'],
    conditionalDistractions: [
      { appPattern: '^VideoSite$', condition: 'title_contains', slackingKeywords: ['搞笑', '综艺', '娱乐', '鬼畜', '游戏'] },
      { appPattern: BROWSER, condition: 'title_contains', slackingKeywords: SLACK_TITLE_KEYWORDS }
    ]
  },
  creator: {
    userType: 'creator',
    templates: CREATOR_TEMPLATES,
    primaryDistractions: ['^Game$', '^Video$', '^Music$'],
    conditionalDistractions: [
      { appPattern: '^(WeChat|QQ)$', condition: 'title_contains', slackingKeywords: CHAT_EXCLUDE },
      { appPattern: BROWSER, condition: 'title_contains', slackingKeywords: SLACK_TITLE_KEYWORDS }
    ]
  },
  entrepreneur: {
    userType: 'entrepreneur',
    templates: ENTREPRENEUR_TEMPLATES,
    primaryDistractions: ['^Game$', '^Video$', '^VideoSite$', '^Music$'],
    conditionalDistractions: [
      { appPattern: BROWSER, condition: 'title_contains', slackingKeywords: SLACK_TITLE_KEYWORDS },
      { appPattern: COMM, condition: 'title_contains', slackingKeywords: CHAT_EXCLUDE }
    ]
  }
}
