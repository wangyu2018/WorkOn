// 应用名 → 面向用户的中文显示名（仅 UI 渲染用，不改底层数据）
const APP_DISPLAY_CJK: Record<string, string> = {
  wechat: '微信', weixin: '微信', wchar: '微信', wechatappex: '微信',
  wecom: '企业微信', '企业微信': '企业微信', wxwork: '企业微信',
  dingtalk: '钉钉',
  feishu: '飞书', lark: '飞书',
  qq: 'QQ', tim: 'QQ', slack: 'Slack', teams: 'Teams',
  vscode: 'VS Code', cursor: 'Cursor', intellij: 'IntelliJ IDEA',
  chrome: 'Chrome', edge: 'Edge', msedge: 'Edge', meeting: '腾讯会议',
  notepad: '记事本',
  explorer: '文件资源管理器',
  wps: 'WPS Office', et: 'WPS 表格', wpp: 'WPS 演示', wpspdf: 'WPS PDF',
  idea: 'IntelliJ IDEA', idea64: 'IntelliJ IDEA', ideaIU: 'IntelliJ IDEA',
  windowsterminal: '终端', wt: 'Windows 终端',
  '360safe': '360安全卫士', '360logcenter': '360安全卫士', '360zip': '360压缩',
  everything: 'Everything', gameviewer: '游戏盒子', photolaunch: '相机',
}

export function displayApp(raw?: string): string {
  if (!raw) return '（未知）'
  const key = raw.trim().toLowerCase().replace(/\.exe$/i, '')
  return APP_DISPLAY_CJK[key] ?? raw
}
