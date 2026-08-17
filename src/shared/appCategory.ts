// 应用业务分类：把具体应用归到「办公/即时通讯/开发/浏览器/影音/游戏…」等大类，
// 同一分类内的应用时长合并展示（仅 UI 归类，不改底层数据）。
// 匹配键：进程名（小写、去 .exe）、displayApp 中文名。与 appDisplayName 保持一致口径。

export type AppCategory =
  | 'office'   // 办公 · 文档/表格/演示/协同
  | 'im'       // 即时通讯 · 聊天/IM
  | 'dev'      // 开发 · IDE/终端/调试
  | 'browser'  // 浏览器
  | 'design'   // 设计 · 图像/视频制作
  | 'media'    // 影音娱乐 · 视频/音乐
  | 'game'     // 游戏
  | 'system'   // 系统工具 · 资源管理器/安全/压缩
  | 'other'    // 其他

export const CATEGORY_META: Record<AppCategory, { label: string; emoji: string; color: string }> = {
  office:  { label: '办公', emoji: '📄', color: '#10B981' },
  im:      { label: '即时通讯', emoji: '💬', color: '#3B82F6' },
  dev:     { label: '开发', emoji: '👨‍💻', color: '#8B5CF6' },
  browser: { label: '浏览器', emoji: '🌐', color: '#22D3EE' },
  design:  { label: '设计', emoji: '🎨', color: '#EC4899' },
  media:   { label: '影音娱乐', emoji: '🎬', color: '#F59E0B' },
  game:    { label: '游戏', emoji: '🎮', color: '#EF4444' },
  system:  { label: '系统工具', emoji: '⚙️', color: '#94A3B8' },
  other:   { label: '其他', emoji: '📦', color: '#64748B' }
}

/** 进程名/中文名 → 分类 */
const APP_CATEGORY: Record<string, AppCategory> = {
  // 办公
  winword: 'office', word: 'office', excel: 'office', powerpnt: 'office', powerpoint: 'office',
  wps: 'office', et: 'office', wpp: 'office', wpspdf: 'office',
  'wps office': 'office', 'wps 表格': 'office', 'wps 演示': 'office', 'wps pdf': 'office',
  // 即时通讯
  wechat: 'im', weixin: 'im', wechatappex: 'im', wxwork: 'im', '企业微信': 'im',
  feishu: 'im', lark: 'im', '飞书': 'im', dingtalk: 'im', '钉钉': 'im',
  qq: 'im', tim: 'im', '旺旺': 'im', wangwang: 'im', slack: 'im', teams: 'im',
  // 开发
  code: 'dev', 'code - insiders': 'dev', cursor: 'dev', intellij: 'dev', idea: 'dev', idea64: 'dev', ideaIU: 'dev',
  devenv: 'dev', rider64: 'dev', webstorm64: 'dev', pycharm64: 'dev', goland64: 'dev',
  windsurf: 'dev', trae: 'dev', claude: 'dev', chatgpt: 'dev', codex: 'dev', cline: 'dev',
  opencode: 'dev', 'trae cn': 'dev', 'qoderwork': 'dev',
  terminal: 'dev', windowsterminal: 'dev', wt: 'dev', '终端': 'dev', 'windows 终端': 'dev', cmd: 'dev', powershell: 'dev',
  postman: 'dev', apifox: 'dev', datagrip: 'dev', dbeaver: 'dev', navicat: 'dev',
  matlab: 'dev', spss: 'dev',
  // 浏览器
  chrome: 'browser', msedge: 'browser', edge: 'browser', firefox: 'browser', opera: 'browser', brave: 'browser',
  // 设计
  figma: 'design', sketch: 'design', photoshop: 'design', illustrator: 'design', blender: 'design',
  '剪映': 'design', jianying: 'design', capcut: 'design', premiere: 'design',
  // 影音娱乐
  cloudmusic: 'media', qqmusic: 'media', '网易云音乐': 'media', potplayer: 'media', vlc: 'media',
  bilibili: 'media', '哔哩哔哩': 'media', youku: 'media', '腾讯视频': 'media', '爱奇艺': 'media',
  // 游戏
  steam: 'game', 'wegame': 'game', gameviewer: 'game', '游戏盒子': 'game',
  // 系统工具
  explorer: 'system', '文件资源管理器': 'system',
  '360safe': 'system', '360安全卫士': 'system', '360logcenter': 'system', '360zip': 'system', '360压缩': 'system',
  everything: 'system', listary: 'system', utools: 'system',
  'notepad': 'system', '记事本': 'system', 'microsoftedgeupdate': 'system',
  // 会议（办公细分）
  '腾讯会议': 'office', wemeet: 'office', 'voov meeting': 'office', zoom: 'office'
}

export function categoryOf(app?: string): AppCategory {
  if (!app) return 'other'
  const key = app.trim().toLowerCase().replace(/\.exe$/i, '')
  return APP_CATEGORY[key] ?? 'other'
}
