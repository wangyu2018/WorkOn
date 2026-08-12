// 应用名 → 面向用户的中文显示名（仅 UI 渲染用，不改底层数据）
const APP_DISPLAY_CJK: Record<string, string> = {
  wechat: '微信', weixin: '微信', wchar: '微信',
  wecom: '企业微信', '企业微信': '企业微信',
  dingtalk: '钉钉',
  feishu: '飞书', lark: '飞书',
  qq: 'QQ', slack: 'Slack', teams: 'Teams',
  vscode: 'VS Code', cursor: 'Cursor', intellij: 'IntelliJ IDEA',
  chrome: 'Chrome', edge: 'Edge', meeting: '腾讯会议',
}

export function displayApp(raw?: string): string {
  if (!raw) return '（未知）'
  const key = raw.trim().toLowerCase().replace(/\.exe$/i, '')
  return APP_DISPLAY_CJK[key] ?? raw
}
