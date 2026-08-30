/**
 * 特征构造：从每轮前台窗口采样构造模型 9 特征（识别二期已真实化）
 *
 * - action_type/has_shortcut：来自 uiohook 行为探针的滑动窗口聚合（真实事件）
 * - field/text_length：deepMode 时来自 UIAutomation 焦点元素（真实控件），否则按应用类别推占位
 * - app_category/hour/day_of_week/duration：窗口采样天然可得
 * - 探针/UIA 不可用时逐特征回退占位值（诚实口径：占位特征训出的模型不具参考性）
 * 类别词表对齐 ml/convert_scene_to_action.py 的 PROCESS_APP_CATEGORY，避免 one-hot 全零。
 */
import type { ActionFeatures, RecognitionInput, UiaHint } from './types'

/** 进程名 → app_category（词表 = 训练数据里的 11 类） */
const PROCESS_APP_CATEGORY: Record<string, string> = {
  // chat / im
  'wechat.exe': 'chat', 'weixin.exe': 'chat', 'qq.exe': 'chat', 'tim.exe': 'chat',
  'dingtalk.exe': 'chat', 'wxwork.exe': 'chat', 'feishu.exe': 'chat', 'lark.exe': 'chat',
  'slack.exe': 'chat', 'discord.exe': 'chat', 'telegram.exe': 'chat', 'teams.exe': 'chat',
  // browser
  'chrome.exe': 'browser', 'msedge.exe': 'browser', 'firefox.exe': 'browser',
  'opera.exe': 'browser', 'brave.exe': 'browser', 'vivaldi.exe': 'browser', 'qqbrowser.exe': 'browser',
  // ide / editor
  'code.exe': 'ide', 'code - insiders.exe': 'ide', 'cursor.exe': 'ide', 'devenv.exe': 'ide',
  'idea64.exe': 'ide', 'idea.exe': 'ide', 'webstorm64.exe': 'ide', 'pycharm64.exe': 'ide',
  'goland64.exe': 'ide', 'clion64.exe': 'ide', 'rider64.exe': 'ide', 'windsurf.exe': 'ide', 'trae.exe': 'ide',
  // terminal
  'windowsterminal.exe': 'terminal', 'wt.exe': 'terminal', 'cmd.exe': 'terminal',
  'powershell.exe': 'terminal', 'pwsh.exe': 'terminal', 'bash.exe': 'terminal',
  'alacritty.exe': 'terminal', 'wezterm.exe': 'terminal', 'conhost.exe': 'terminal',
  // docs / office
  'winword.exe': 'docs', 'notion.exe': 'docs', 'obsidian.exe': 'docs', 'typora.exe': 'docs',
  'siyuan.exe': 'docs', 'yuque.exe': 'docs', 'wps.exe': 'docs', 'wpp.exe': 'docs',
  // spreadsheet
  'excel.exe': 'spreadsheet', 'et.exe': 'spreadsheet', 'google_sheets': 'spreadsheet',
  // email
  'outlook.exe': 'email', 'thunderbird.exe': 'email', 'mailmaster.exe': 'email',
  // meeting
  'zoom.exe': 'meeting', 'wemeetapp.exe': 'meeting', 'wemeet.exe': 'meeting',
  '腾讯会议.exe': 'meeting', 'voovmeeting.exe': 'meeting',
  // file_manager
  'explorer.exe': 'file_manager', 'totalcmd.exe': 'file_manager', 'totalcmd64.exe': 'file_manager',
  // system
  'control_panel': 'system', 'settings': 'system', 'regedit.exe': 'system',
  'taskmgr.exe': 'system', 'applicationframehost.exe': 'system'
}

const CATEGORY_FIELD: Record<string, string> = {
  ide: 'code_editor',
  terminal: 'terminal',
  browser: 'web_page',
  chat: 'chat_input',
  email: 'email_body',
  docs: 'document_body',
  spreadsheet: 'cell',
  meeting: 'meeting_control',
  file_manager: 'file_list',
  system: 'settings'
}

export function getAppCategory(app: string): string {
  const key = app.trim().toLowerCase()
  return PROCESS_APP_CATEGORY[key] ?? 'unknown'
}

/** 每个 screen 的上一次采样时间（duration_ms / time_since_prev_ms） */
const lastSampleAt = new Map<number, number>()

/** UIAutomation ControlType → field（Edit 按应用类别细分） */
function resolveField(category: string, hint: UiaHint | null | undefined): string {
  if (!hint) return CATEGORY_FIELD[category] ?? 'unknown'
  const ct = hint.controlType
  if (/combobox/i.test(ct)) return 'search_box'
  if (/document/i.test(ct)) return 'document_body'
  if (/edit/i.test(ct)) {
    switch (category) {
      case 'chat': return 'chat_input'
      case 'ide': return 'code_editor'
      case 'email': return 'email_body'
      case 'spreadsheet': return 'cell'
      case 'browser': return 'search_box'
      case 'docs': return 'document_body'
      case 'terminal': return 'terminal'
      default: return 'content'
    }
  }
  if (/list|tree|item/i.test(ct)) return 'file_list'
  if (/button|tab|menu/i.test(ct)) return 'settings'
  return CATEGORY_FIELD[category] ?? 'unknown'
}

/** 焦点文本长度：优先编辑框值/选区，长文档截断到 4000（与训练分布对齐） */
function resolveTextLength(hint: UiaHint | null | undefined, title: string): number {
  if (!hint) return title.length
  return hint.valueLength || hint.selectedLength || Math.min(hint.docLength, 4000) || title.length
}

/** 从行为聚合 + UIA 提示推导 action_type（词表 = 训练数据 9 类） */
function resolveActionType(b: RecognitionInput['behavior']): string {
  if (!b) return 'TYPE'
  if (b.pasteHint) return 'PASTE'
  if (b.copyHint) return 'COPY'
  if (b.hasShortcut) return 'SHORTCUT'
  if (b.wheels > b.typeKeys && b.wheels > b.clicks) return 'SCROLL'
  if (b.clicks > b.typeKeys) return 'CLICK'
  return 'TYPE'
}

/**
 * 从窗口采样 + 行为探针 + UIA 提示构造 9 特征。
 * 行为探针/UIA 缺席的特征逐项回退占位值（见文件头诚实口径）。
 */
export function buildFeatures(input: RecognitionInput): ActionFeatures {
  const { ts, screen, app, title, behavior, uiaHint } = input
  const prev = lastSampleAt.get(screen)
  lastSampleAt.set(screen, ts)
  const gap = prev ? Math.min(ts - prev, 10 * 60_000) : 5000

  const category = getAppCategory(app)
  const d = new Date(ts)
  return {
    app_category: category,
    action_type: resolveActionType(behavior),
    field: resolveField(category, uiaHint),
    duration_ms: gap,
    hour: d.getHours(),
    day_of_week: d.getDay(),
    time_since_prev_ms: gap,
    text_length: resolveTextLength(uiaHint, title),
    has_shortcut: behavior?.hasShortcut ?? false
  }
}

export function resetFeatureBuilder(): void {
  lastSampleAt.clear()
}
