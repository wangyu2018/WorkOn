/**
 * 能力插件的渲染元数据（L2 隧道用）
 *
 * 隧道只认 toolName，不查询插件实现；未登记的插件降级显示原始 name。
 * 新增能力插件只要在 WORKON_TOOLS 注册，trace 里就有 name，这里补元数据即可获得显示名。
 */

export interface ToolUiMeta {
  label: string
  group: 'read' | 'write' | 'net' | 'other'
}

const TOOL_UI: Record<string, ToolUiMeta> = {
  get_presence: { label: '当前状态', group: 'read' },
  get_focused_element: { label: '焦点元素', group: 'read' },
  get_today_summary: { label: '今日轨迹', group: 'read' },
  get_plans: { label: '读取计划', group: 'read' },
  create_plan: { label: '写入计划', group: 'write' },
  complete_plan: { label: '完成计划', group: 'write' },
  add_memo: { label: '记备忘', group: 'write' },
  get_attention_score: { label: '注意力评分', group: 'read' },
  generate_report: { label: '生成报表', group: 'write' },
  set_pet_message: { label: '桌宠发言', group: 'write' },
  get_weekly_summary: { label: '本周小结', group: 'read' },
  quick_recommend: { label: '快捷推荐', group: 'read' },
  get_weather: { label: '天气', group: 'net' },
  // 节点模式（P0 只读）：远端能力在隧道里与本地插件同构展示
  remote_sys_info: { label: '远端系统信息', group: 'read' },
  remote_fs_list: { label: '远端列目录', group: 'read' },
  'agent:data': { label: '数据 Agent', group: 'read' },
  'agent:knowledge': { label: '知识库 Agent', group: 'read' },
  'agent:web': { label: '抓取 Agent', group: 'net' }
}

const GROUP_LABEL: Record<ToolUiMeta['group'], string> = {
  read: '读取',
  write: '写入',
  net: '联网',
  other: '其他'
}

export function toolMeta(name: string): ToolUiMeta {
  return TOOL_UI[name] ?? { label: name, group: 'other' }
}

export function toolGroupLabel(name: string): string {
  return GROUP_LABEL[toolMeta(name).group]
}
