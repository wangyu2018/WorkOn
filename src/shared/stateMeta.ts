/**
 * 工作状态元信息 —— 唯一口径（main/renderer 共用，禁止重复定义）
 * 依据：PRD.md F-P0/P2「统一规则口径到 shared/stateMeta.ts」
 */
import type { WorkState, WorkStateMeta } from './types'

export const WORK_STATES: Record<WorkState, WorkStateMeta> = {
  focus: { label: '专注', color: '#10B981', emoji: '🎯' },
  coding: { label: '编程', color: '#3B82F6', emoji: '💻' },
  aidev: { label: 'AI开发', color: '#6366F1', emoji: '🤖' },
  aiqa: { label: 'AI问答', color: '#A78BFA', emoji: '💬' },
  writing: { label: '写文档', color: '#22D3EE', emoji: '📝' },
  meeting: { label: '会议', color: '#F59E0B', emoji: '👥' },
  slack: { label: '摸鱼', color: '#EF4444', emoji: '🐟' },
  relax: { label: '放松', color: '#94A3B8', emoji: '🎵' },
  idle: { label: '空闲', color: '#64748B', emoji: '☁️' },
  break: { label: '休息', color: '#FBBF24', emoji: '☕' },
  lunch: { label: '午休', color: '#FB923C', emoji: '🍚' },
  remote: { label: '远程协作', color: '#38BDF8', emoji: '🔗' },
  away: { label: '离开', color: '#475569', emoji: '🚶' },
  other: { label: '其他', color: '#64748B', emoji: '❓' }
}

export const STATE_LABEL: Record<WorkState, string> = Object.fromEntries(
  Object.entries(WORK_STATES).map(([k, v]) => [k, v.label])
) as Record<WorkState, string>

export const ALL_STATES = Object.keys(WORK_STATES) as WorkState[]

/** 摸鱼类状态 */
export const SLACK_STATES: WorkState[] = ['slack']

/** 空闲/离开类状态 */
export const IDLE_STATES: WorkState[] = ['idle', 'away']

/** 工作类状态（计入实际工作分钟） */
export const WORK_LIKE_STATES: WorkState[] = ['focus', 'coding', 'aidev', 'aiqa', 'writing', 'meeting', 'remote']

/** 放松类（副屏媒体粘性） */
export const RELAX_STATES: WorkState[] = ['relax', 'slack', 'break', 'lunch']

/** 需要持续键鼠输入才能成立的工作态（无输入时降级为 idle；唯一口径，monitor/presence 共用） */
export const INPUT_REQUIRED_STATES: WorkState[] = ['focus', 'coding', 'aidev', 'aiqa', 'writing']

// ───────────────────────── 应用识别规则 ─────────────────────────

interface AppRule {
  match: RegExp // 匹配进程名（小写）
  name: string // 友好名
  state: WorkState // 默认映射态
  titleState?: { match: RegExp; state: WorkState }[] // 标题细化
}

export const APP_RULES: AppRule[] = [
  {
    match: /^(code|code - insiders)\.exe$/,
    name: 'VSCode',
    state: 'coding',
    titleState: [
      { match: /copilot|chatgpt|claude|通义|文心|kim/i, state: 'aidev' },
      { match: /\.md\b|readme/i, state: 'writing' }
    ]
  },
  { match: /^(devenv)\.exe$/i, name: 'Visual Studio', state: 'coding' },
  { match: /^(rider64)\.exe$/i, name: 'Rider', state: 'coding' },
  {
    match: /^(idea64|webstorm64|goland64|pycharm64|clion64|rubymine|phpstorm|studio)\.exe$/i,
    name: 'IntelliJ',
    state: 'coding',
    titleState: [
      { match: /debug|调试/i, state: 'coding' },
      { match: /terminal|console/i, state: 'coding' }
    ]
  },
  {
    match: /^cursor\.exe$/i,
    name: 'Cursor',
    state: 'aidev',
    titleState: [
      { match: /chat|composer/i, state: 'aiqa' },
      { match: /\.md\b|readme/i, state: 'writing' }
    ]
  },
  { match: /^(windsurf)\.exe$/i, name: 'Windsurf', state: 'aidev' },
  { match: /^(trae)\.exe$/i, name: 'Trae', state: 'aidev' },
  { match: /^(claude|claude[\w-]*)\.exe$/i, name: 'Claude', state: 'aidev', titleState: [{ match: /\.md\b|readme|文档|笔记/i, state: 'writing' }] },
  { match: /^(chatgpt|chatgpt[\w-]*)\.exe$/i, name: 'ChatGPT', state: 'aiqa', titleState: [{ match: /(代码|写|实现|函数|bug|修复|重构|开发|编程|调试|code|function|script|项目|需求)/i, state: 'aidev' }] },
  { match: /^(codex|cline|aider|gemini|gemini[\w-]*|kimi|kimichat)\.exe$/i, name: 'AI Dev', state: 'aidev' },
  { match: /^chrome\.exe$/, name: 'Chrome', state: 'other', titleState: [
      // A6 学术/学习：强信号优先；知乎需技术词双命中才升级，避免误伤热榜
      { match: /(知网|cnki|arxiv|pubmed|web of science|万方|维普|学术|论文|thesis|paper|期刊|jstor|scihub|谷歌学术|google scholar)/i, state: 'aiqa' },
      { match: /(中国大学mooc|学习通|超星|学堂在线|coursera|edx|网易云课堂|腾讯课堂|classin|网课|慕课|公开课)/i, state: 'focus' },
      { match: /(知乎|zhihu).*(代码|编程|算法|开发|架构|前端|后端|ai|机器学习|论文|科研|考研|bug|重构)/i, state: 'aiqa' },
      // A7 创作/运营后台：创作者/后台/dashboard 强信号
      { match: /(抖音创作者|抖音创作服务平台|剪映云|创作者中心|creator\.|巨量引擎|巨量百应|千牛|淘宝卖家|生意参谋|阿里妈妈|公众号后台|订阅号助手|小红书创作者|小红书专业号|飞瓜|新榜|数据看板|dashboard|bi后台|神策|growingio|ga4|analytics)/i, state: 'writing' },
      { match: /(抖音|douyin|bilibili|哔哩).*(创作|投稿|剪辑|数据|直播中|直播回放)/i, state: 'focus' },
      { match: /bilibili|youtube|抖音|douyin|腾讯视频|iqiyi|爱奇艺|netflix/i, state: 'relax' },
      { match: /weibo|微博|知乎|zhihu|贴吧|x\.com|twitter|reddit/i, state: 'slack' },
      { match: /(chatgpt|claude|gemini|copilot|kimi|通义|文心|豆包).*(代码|写|实现|函数|bug|修复|重构|开发|编程|调试|code|function|script|项目|需求)/i, state: 'aidev' },
      { match: /chatgpt|claude|gemini|copilot|kimi|通义|文心|豆包/i, state: 'aiqa' },
      { match: /docs\.google|notion|飞书|语雀|confluence/i, state: 'writing' },
      { match: /meet\.google|zoom\.us|teams\.microsoft/i, state: 'meeting' },
      // 堡垒机/远程运维/金融终端/OA 系统 → 工作
      { match: /堡垒机|bastionhost|bastion|rdp|mstsc|远程桌面|citrix|vmware|horizon|ssh|xshell|vpn|ssl vpn|金证|恒生|同花顺|东方财富|wind|choice|oa系统|oa 系统|pansoft|泛微|致远/i, state: 'focus' },
      // 开发类网页 → 编程
      { match: /github|gitlab|gitee|stackoverflow|掘金|juejin|csdn|npmjs|pypi|maven|dockerhub|k8s|jenkins|jira|confluence|postman|swagger|apifox/i, state: 'coding' }
    ]
  },
  { match: /^(msedge|firefox|opera|brave|arc)\.exe$/i, name: 'Browser', state: 'other', titleState: [
      // A6 学术/学习：与 Chrome 对齐
      { match: /(知网|cnki|arxiv|pubmed|web of science|万方|维普|学术|论文|thesis|paper|期刊|jstor|scihub|谷歌学术|google scholar)/i, state: 'aiqa' },
      { match: /(中国大学mooc|学习通|超星|学堂在线|coursera|edx|网易云课堂|腾讯课堂|classin|网课|慕课|公开课)/i, state: 'focus' },
      { match: /(知乎|zhihu).*(代码|编程|算法|开发|架构|前端|后端|ai|机器学习|论文|科研|考研|bug|重构)/i, state: 'aiqa' },
      // A7 创作/运营后台
      { match: /(抖音创作者|抖音创作服务平台|剪映云|创作者中心|creator\.|巨量引擎|巨量百应|千牛|淘宝卖家|生意参谋|阿里妈妈|公众号后台|订阅号助手|小红书创作者|小红书专业号|飞瓜|新榜|数据看板|dashboard|bi后台|神策|growingio|ga4|analytics)/i, state: 'writing' },
      { match: /(抖音|douyin|bilibili|哔哩).*(创作|投稿|剪辑|数据|直播中|直播回放)/i, state: 'focus' },
      { match: /bilibili|youtube|抖音|腾讯视频|爱奇艺|netflix/i, state: 'relax' },
      { match: /weibo|微博|知乎|贴吧|x\.com|twitter|reddit/i, state: 'slack' },
      { match: /(chatgpt|claude|gemini|copilot|kimi|通义|文心|豆包).*(代码|写|实现|函数|bug|修复|重构|开发|编程|调试|code|function|script|项目|需求)/i, state: 'aidev' },
      { match: /chatgpt|claude|gemini|copilot|kimi|通义|文心|豆包/i, state: 'aiqa' },
      { match: /docs\.google|notion|飞书|语雀|confluence/i, state: 'writing' },
      { match: /meet\.google|zoom\.us|teams\.microsoft/i, state: 'meeting' },
      { match: /堡垒机|bastionhost|bastion|rdp|mstsc|远程桌面|citrix|vmware|horizon|ssh|vpn|ssl vpn|金证|恒生|同花顺|东方财富|wind|choice|oa系统|oa 系统|pansoft|泛微|致远/i, state: 'focus' },
      { match: /github|gitlab|gitee|stackoverflow|掘金|juejin|csdn|npmjs|pypi|maven|dockerhub|k8s|jenkins|jira|confluence|postman|swagger|apifox/i, state: 'coding' }
    ]
  },
  { match: /^(wechat|weixin)\.exe$/i, name: 'WeChat', state: 'slack', titleState: [{ match: /会议|meeting/i, state: 'meeting' }] },
  { match: /^(qq|tim)\.exe$/i, name: 'QQ', state: 'slack' },
  { match: /^(dingtalk|钉钉)\.exe$/i, name: 'DingTalk', state: 'remote' },
  { match: /^(feishu|lark)\.exe$/i, name: 'Feishu', state: 'remote', titleState: [{ match: /会议|meeting|视频/i, state: 'meeting' }] },
  { match: /^(teams|zoom|腾讯会议|wemeet|voov meeting)\.exe$/i, name: 'Meeting', state: 'meeting' },
  { match: /^(winword|excel|powerpnt|wps|et|wpp)\.exe$/i, name: 'Office', state: 'writing' },
  { match: /^(notion|obsidian|typora|siyuan|yuque)\.exe$/i, name: 'Notes', state: 'writing' },
  { match: /^(cloudmusic|qqmusic|spotify|foobar2000|netease)\.exe$/i, name: 'Music', state: 'relax' },
  { match: /^(potplayer|vlc|mpv|iina|kmplayer|thunderplayer)\.exe$/i, name: 'Video', state: 'relax' },
  { match: /^(bilibili|acfun|youku|qiyvideo|tencentvideo)\.exe$/i, name: 'VideoSite', state: 'relax' },
  { match: /^(steam|epicgameslauncher|origin|uplay|leagueclient|genshinimpact|hoyoplay)/i, name: 'Game', state: 'slack' },
  {
    match: /^(terminal|windowsterminal|wt|cmd|powershell|pwsh|bash|mingw64|alacritty|wezterm)\.exe$/i,
    name: 'Terminal',
    state: 'coding',
    titleState: [
      // CLI AI 工具 → AI 开发
      { match: /opencode|claude[ -]?code|codex|aider|cursor-agent|kimi|copilot-cli/i, state: 'aidev' },
      // 开发命令 → 编程
      { match: /npm|pnpm|yarn|bun|deno|node|python|pip|poetry|docker|kubectl|helm|git|cargo|mvn|gradle|go\s|make|cmake|pytest|jest|vitest|webpack|vite/i, state: 'coding' },
      // 远程连接 → 远程协作
      { match: /ssh |mstsc|rdp |telnet /i, state: 'remote' }
    ]
  },
  { match: /^(postman|apifox|insomnia|fiddler|charles|wireshark|navicat|datagrip|dbeaver|tableplus|redis|mongodb)/i, name: 'DevTool', state: 'coding' },
  { match: /^(filezilla|winscp|mobaxterm|xshell|securecrt|putty|kitty|windterm)/i, name: 'Transfer/SSH', state: 'coding' },
  { match: /^(everything|listary|utools|wox|powerlauncher)/i, name: 'Launcher', state: 'other' },
  { match: /^(obs64|obs|bandicam|camtasia|screenflow)/i, name: 'Recorder', state: 'other' },
  { match: /^(jmeter|apipost|loadrunner|k6)/i, name: 'PerfTest', state: 'coding' },
  { match: /^(figma|sketch|photoshop|illustrator|blender|ae|pr|canva)\.exe$/i, name: 'Design', state: 'focus' },
  { match: /^(afterfx|premiere|c4d|resolve|davinci|jianying|capcut)\.exe$/i, name: 'Editor', state: 'focus' },
  { match: /^(trados|memoq|abbyy|deepl)\.exe$/i, name: 'Translator', state: 'writing' },
  { match: /^(matlab)\.exe$/i, name: 'Matlab', state: 'coding', titleState: [{ match: /(simulink|仿真|建模|矩阵|脚本)/i, state: 'coding' }] },
  { match: /^(spss)\.exe$/i, name: 'SPSS', state: 'coding', titleState: [{ match: /(分析|回归|问卷|数据|变量)/i, state: 'coding' }] },
  { match: /^(anki|ankiui)\.exe$/i, name: 'Anki', state: 'focus', titleState: [{ match: /(复习|记忆|卡片|deck)/i, state: 'focus' }] },
  { match: /^(explorer)\.exe$/i, name: 'Explorer', state: 'idle' },
  { match: /^(workon)\.exe$/i, name: 'WorkOn', state: 'idle' },
  { match: /^(workbuddy)\.exe$/i, name: 'WorkBuddy', state: 'aiqa', titleState: [{ match: /(代码|写|实现|函数|bug|修复|重构|开发|编程|调试|需求)/i, state: 'aidev' }] }
]

export interface AppIdentifyResult {
  appName: string
  state: WorkState
}

/** 进程名 + 标题 → 友好名 + 工作态 */
export function identifyApp(exe: string, title: string): AppIdentifyResult {
  const key = exe.toLowerCase()
  for (const rule of APP_RULES) {
    if (rule.match.test(key)) {
      let appName = rule.name
      // 终端类：标题含 AI CLI 工具时识别为独立应用（opencode/claude code/kimi…），否则从标题提取工作目录名
      if (rule.name === 'Terminal') {
        const cli = title.match(/(opencode|claude[ -]?code|codex|aider|cursor-agent|kimi|copilot-cli)/i)
        if (cli) return { appName: cli[1].toLowerCase(), state: 'aidev' }
        const pathMatch = title.match(/([A-Za-z]:[\\/][^\s"']+)|((?:~|\/)[^\s"']+)/)
        if (pathMatch) {
          const folder = pathMatch[0].replace(/[\\/]+$/, '').split(/[\\/]/).filter(Boolean).pop()
          if (folder && folder.length > 0 && folder.length <= 30 && !/^[A-Za-z]:$/.test(folder)) {
            appName = `Terminal · ${folder}`
          }
        }
      }
      if (rule.titleState) {
        for (const ts of rule.titleState) {
          if (ts.match.test(title)) return { appName, state: ts.state }
        }
      }
      return { appName, state: rule.state }
    }
  }
  // 未识别应用的开发关键词兜底（中英文）
  if (/开发|代码|编程|调试|bug|jira|需求|review|deploy|debug|coding|commit|merge|branch/i.test(title)) {
    return { appName: exe.replace(/\.exe$/i, ''), state: 'coding' }
  }
  return { appName: exe.replace(/\.exe$/i, ''), state: 'other' }
}

export const MICRO_VOCAB: Partial<Record<WorkState, { tag: string; match: RegExp }[]>> = {
  coding: [
    { tag: '写码',     match: /\.(tsx?|jsx?|py|go|rs|java|cs|cpp?|vue|rb)$/i },
    { tag: '调试',     match: /debug|调试|error|报错|exception|栈/i },
    { tag: 'Code Review', match: /(\bpr\b|pull request|merge request|review|diff|冲突)/i },
    { tag: '查资料',   match: /stackoverflow|掘金|juejin|csdn|mdn|官方文档|docs\./i },
    { tag: '部署',     match: /deploy|ci\/cd|jenkins|docker|k8s|发布|上线|构建/i },
    { tag: '联调',     match: /(接口|api|联调|postman|apifox|mock)/i },
    { tag: '画原型',   match: /(原型|prototype|wireframe|figma|axure|墨刀)/i },
  ],
  aidev: [
    { tag: '写 Prompt', match: /prompt|提示词|system|指令|规则/i },
    { tag: '调 Agent',  match: /agent|composer|自动化|workflow/i },
    { tag: 'Vibe Coding', match: /(vibe\s*coding|vibecoding|一句话生成|ai 生成|生成代码|让 ai|让模型)/i },
    { tag: '改 Bug', match: /(修复|fix|bug|报错|重构|实现|补充)/i },
  ],
  aiqa: [
    { tag: '问问题', match: /(怎么|如何|为什么|what|how|why|\?$)/i },
  ],
  writing: [
    { tag: '写 PRD',   match: /(prd|需求|方案|设计文档|spec)/i },
    { tag: '记笔记',   match: /(笔记|note|obsidian|思源|notion)/i },
    { tag: '写BP',     match: /(bp|商业计划|business plan)/i },
    { tag: '融资',     match: /(融资|路演|投资人|尽调|估值|股权)/i },
    { tag: '写材料',   match: /(材料|汇报|报告|总结|周报)/i },
    { tag: '做表',     match: /(表格|报表|统计|excel)/i },
    { tag: '发文',     match: /(发文|公众号|推文|排版|发布)/i },
    { tag: '翻译',     match: /(翻译|trados|memoq)/i },
    { tag: '校稿',     match: /(校稿|校对|审校|proofread)/i },
    { tag: '写论文',   match: /(论文|paper|thesis|期刊)/i },
  ],
  focus: [
    { tag: '算账',     match: /(账|报税|流水|发票|报销|财务)/i },
    { tag: '录单',     match: /(录单|录入|订单|erp|oa|审批)/i },
    { tag: '看数据',   match: /(数据|报表|看板|bi|指标|转化)/i },
    { tag: '需求对接', match: /(需求|对接|brief|评审|对齐)/i },
    { tag: '客户沟通', match: /(客户|销售|沟通|报价|合同)/i },
    { tag: '社群运营', match: /(社群|运营|粉丝|群聊|私域)/i },
    { tag: '找素材',   match: /(素材|图库|pinterest|behance|花瓣|unsplash)/i },
    { tag: '做图',     match: /(做图|封面|海报|banner|ps|canva)/i },
    { tag: '剪视频',   match: /(剪|剪辑|视频|pr|ae|剪映)/i },
    { tag: '直播',     match: /(直播|obs|推流|带货)/i },
  ],
  meeting: [
    { tag: '开会', match: /(会议|meeting|周会|评审会|站会)/i },
    { tag: '面试', match: /(面试|interview)/i },
  ],
  remote: [
    { tag: '远程运维', match: /(ssh|rdp|堡垒机|运维|线上|vpn)/i },
    { tag: '销售',   match: /(销售|客户|报价|成单|合同)/i },
    { tag: '对接',   match: /(对接|协作|配合|同步)/i },
    { tag: '评审',   match: /(评审|review|对齐|方案)/i },
    { tag: '审批',   match: /(审批|报销|申请|流程)/i },
  ],
  slack: [
    { tag: '刷社交', match: /(weibo|微博|知乎|zhihu|twitter|朋友圈|群聊)/i },
    { tag: '逛电商', match: /(淘宝|京东|tmall|pdd|拼多多|amazon)/i },
  ],
  relax: [
    { tag: '听歌',   match: /(music|音乐|网易云|qq音乐|spotify)/i },
    { tag: '看视频', match: /(bilibili|youtube|抖音|视频|netflix|iqiyi)/i },
    { tag: '游戏',   match: /(steam|game|原神|lol|王者|epic)/i },
  ],
}

export function inferMicroActivity(state: WorkState, title: string): string | null {
  const vocab = MICRO_VOCAB[state]
  if (!vocab) return null
  for (const v of vocab) if (v.match.test(title)) return v.tag
  return null
}
