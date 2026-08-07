/**
 * v2.9 模块 F：预置模板系统 —— 内置 4 种日报格式，开箱即用（无需用户导入/AI 解析）
 * 依据：design-spec-v2.9 §3.F（模板结构照抄；预置模板不落库，用户模板存 db.reportTemplates）
 */
import type { ReportTemplate, WorkState } from '@shared/types'
import { col } from '../db'

// 注：规格中分类日报「文档与写作」筛 writing+design，本项目 WorkState 无 design 态，
// 保留 design 字面量（永不命中，仅占位对齐规格），实际匹配 writing
const DESIGN_STATE = 'design' as WorkState

/** 4 个预置模板（v2.9 §3.F 照抄；repeatable 非条目段补 false 以满足 shared 类型） */
export const PRESET_TEMPLATES: ReportTemplate[] = [
  // 模板1: 标准时间线日报（最通用）
  {
    id: 'preset-timeline',
    name: '时间线日报',
    type: 'daily',
    source: 'preset',
    sections: [
      {
        id: 'overview',
        title: '今日概览',
        type: 'metric_summary',
        fields: [
          { key: 'totalWork', label: '工作时长', required: true },
          { key: 'focusScore', label: '专注度', required: true },
          { key: 'slackTime', label: '摸鱼时长', required: false },
          { key: 'planRate', label: '计划达成率', required: false }
        ],
        repeatable: false
      },
      {
        id: 'morning',
        title: '上午工作',
        type: 'time_block',
        timeRange: { start: '06:00', end: '12:00' },
        groupBy: 'time',
        sortBy: 'chronological',
        fields: [
          { key: 'time', label: '时间', required: true, format: '{start}-{end} ({duration})' },
          { key: 'stateLabel', label: '类型', required: true },
          { key: 'subject', label: '对象', required: false, fallback: '—' },
          { key: 'contentTag', label: '内容', required: true },
          { key: 'project', label: '项目', required: false, fallback: '—' },
          { key: 'output', label: '产出', required: false, fallback: '—' }
        ],
        repeatable: true,
        filter: { minDuration: 5 }
      },
      {
        id: 'afternoon',
        title: '下午工作',
        type: 'time_block',
        timeRange: { start: '12:00', end: '18:00' },
        groupBy: 'time',
        sortBy: 'chronological',
        fields: [
          { key: 'time', label: '时间', required: true, format: '{start}-{end} ({duration})' },
          { key: 'stateLabel', label: '类型', required: true },
          { key: 'subject', label: '对象', required: false, fallback: '—' },
          { key: 'contentTag', label: '内容', required: true },
          { key: 'project', label: '项目', required: false, fallback: '—' },
          { key: 'output', label: '产出', required: false, fallback: '—' }
        ],
        repeatable: true,
        filter: { minDuration: 5 }
      },
      {
        id: 'summary',
        title: '今日小结',
        type: 'free_text',
        fields: [{ key: 'notes', label: '备注', required: false }],
        repeatable: false
      }
    ],
    usageCount: 0,
    userCorrections: 0,
    isDefault: true,
    ts: 0
  },

  // 模板2: 按项目分组日报（适合多项目并行）
  {
    id: 'preset-project',
    name: '项目分组日报',
    type: 'daily',
    source: 'preset',
    sections: [
      {
        id: 'overview',
        title: '今日概览',
        type: 'metric_summary',
        fields: [
          { key: 'totalWork', label: '工作时长', required: true },
          { key: 'focusScore', label: '专注度', required: true }
        ],
        repeatable: false
      },
      {
        id: 'projects',
        title: '项目进展',
        type: 'project_summary',
        groupBy: 'project',
        sortBy: 'duration',
        fields: [
          { key: 'project', label: '项目', required: true },
          { key: 'duration', label: '投入时长', required: true },
          { key: 'contentTag', label: '工作内容', required: true },
          { key: 'output', label: '产出', required: false },
          { key: 'planStatus', label: '计划状态', required: false }
        ],
        repeatable: true
      },
      {
        id: 'meetings',
        title: '会议记录',
        type: 'meeting_log',
        groupBy: 'time',
        filter: { states: ['meeting'] },
        fields: [
          { key: 'time', label: '时间', required: true },
          { key: 'subject', label: '会议主题', required: true },
          { key: 'duration', label: '时长', required: true }
        ],
        repeatable: true
      }
    ],
    usageCount: 0,
    userCorrections: 0,
    isDefault: false,
    ts: 0
  },

  // 模板3: 按状态分类日报（适合汇报型）
  {
    id: 'preset-category',
    name: '分类日报',
    type: 'daily',
    source: 'preset',
    sections: [
      {
        id: 'overview',
        title: '今日数据',
        type: 'metric_summary',
        fields: [
          { key: 'totalWork', label: '总工时', required: true },
          { key: 'focusScore', label: '专注评分', required: true },
          { key: 'slackTime', label: '非工作时长', required: false }
        ],
        repeatable: false
      },
      {
        id: 'meetings',
        title: '会议沟通',
        type: 'category_group',
        filter: { states: ['meeting'] },
        fields: [
          { key: 'time', label: '时间', required: true },
          { key: 'subject', label: '对象', required: true },
          { key: 'contentTag', label: '内容', required: true },
          { key: 'duration', label: '时长', required: true }
        ],
        repeatable: true
      },
      {
        id: 'development',
        title: '开发工作',
        type: 'category_group',
        filter: { states: ['coding', 'aidev'] },
        fields: [
          { key: 'time', label: '时间', required: true },
          { key: 'project', label: '项目', required: true },
          { key: 'contentTag', label: '内容', required: true },
          { key: 'output', label: '产出', required: false },
          { key: 'duration', label: '时长', required: true }
        ],
        repeatable: true
      },
      {
        id: 'documents',
        title: '文档与写作',
        type: 'category_group',
        filter: { states: ['writing', DESIGN_STATE] },
        fields: [
          { key: 'time', label: '时间', required: true },
          { key: 'output', label: '文档', required: true },
          { key: 'duration', label: '时长', required: true }
        ],
        repeatable: true
      },
      {
        id: 'ops',
        title: '运维与部署',
        type: 'category_group',
        filter: { states: ['remote'] },
        fields: [
          { key: 'time', label: '时间', required: true },
          { key: 'location', label: '目标', required: true },
          { key: 'contentTag', label: '操作', required: true },
          { key: 'duration', label: '时长', required: true }
        ],
        repeatable: true
      }
    ],
    usageCount: 0,
    userCorrections: 0,
    isDefault: false,
    ts: 0
  },

  // 模板4: 简版日报（适合快速打卡）
  {
    id: 'preset-simple',
    name: '简版日报',
    type: 'daily',
    source: 'preset',
    sections: [
      {
        id: 'stats',
        title: '',
        type: 'metric_summary',
        fields: [
          { key: 'totalWork', label: '工时', required: true },
          { key: 'focusScore', label: '专注', required: true },
          { key: 'topApp', label: '主要应用', required: false },
          { key: 'topProject', label: '主要项目', required: false }
        ],
        repeatable: false
      },
      {
        id: 'top3',
        title: '今日Top3',
        type: 'achievement',
        // 注：规格原文 groupBy:'duration'，shared 类型 groupBy 无该值；排序由 sortBy 承担
        sortBy: 'duration',
        fields: [
          { key: 'contentTag', label: '工作内容', required: true },
          { key: 'duration', label: '时长', required: true }
        ],
        repeatable: true,
        filter: { minDuration: 15 }
      }
    ],
    usageCount: 0,
    userCorrections: 0,
    isDefault: false,
    ts: 0
  }
]

/** 全部模板 = 预置 + 用户模板（用户模板按 lastUsed 降序） */
export function listTemplates(): ReportTemplate[] {
  const userTemplates = col<ReportTemplate>('reportTemplates')
    .slice()
    .sort((a, b) => (b.lastUsed ?? 0) - (a.lastUsed ?? 0))
  return [...PRESET_TEMPLATES, ...userTemplates]
}

/** 默认模板：isDefault 的用户模板优先，否则 preset-timeline */
export function getDefaultTemplate(): ReportTemplate {
  const userDefault = col<ReportTemplate>('reportTemplates').find((t) => t.isDefault)
  return userDefault ?? PRESET_TEMPLATES[0]
}

/** 按 id 找模板（预置 → 用户） */
export function findTemplate(id: string): ReportTemplate | null {
  return PRESET_TEMPLATES.find((t) => t.id === id) ?? col<ReportTemplate>('reportTemplates').find((t) => t.id === id) ?? null
}
