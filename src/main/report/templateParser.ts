/**
 * v2.8 模板解析引擎 —— AI 解析用户粘贴的日报/周报文本为 ReportTemplate（§4.2）
 * 契约：AI 不可用或解析失败返回 null（前端提示「需要开启 AI 模式」）
 * 注意：本模块只解析不落库 —— 前端预览编辑确认后才经 report:saveTemplate 保存
 */
import type { ReportTemplate, SectionType, TemplateField, TemplateSection } from '@shared/types'
import { genId } from '@shared/types'
import { getSettings } from '../settings'
import { llmChat, extractJson } from '../ai'

/** LLM 解析输出（§4.2 输出格式 + detectedFormat/industry/confidence） */
interface ParsedTemplate {
  name?: string
  detectedFormat?: string
  industry?: string
  confidence?: number
  sections?: {
    title?: string
    type?: string
    timeRange?: { start: string; end: string }
    groupBy?: TemplateSection['groupBy']
    sortBy?: TemplateSection['sortBy']
    fields?: { key?: string; label?: string; required?: boolean; format?: string }[]
    repeatable?: boolean
    filter?: TemplateSection['filter']
  }[]
}

const SECTION_TYPES: SectionType[] = [
  'time_block', 'category_group', 'project_summary', 'achievement',
  'plan_tomorrow', 'metric_summary', 'free_text', 'meeting_log', 'issue_note'
]

/** Prompt 照 §4.2：解析步骤 1-7 + 输出格式 */
function buildPrompt(rawContent: string): string {
  return `你是一个日报/周报模板解析引擎。用户会粘贴一段他们平时写的日报或周报格式，
你需要分析出其中的结构，生成一个可复用的模板 schema。

## 解析步骤
1. 识别文档结构：段落 / 列表 / 表格 / 标题层级
2. 提取字段名：如"工作内容"、"会议记录"、"项目进展"、"明日计划"等
3. 推断每个字段需要的数据维度：
   - 时间信息（startMin, endMin, durationMin, timeSlot）
   - 对象信息（subject, subjectType）
   - 内容信息（contentTag, contentSummary）
   - 项目信息（project）
   - 位置信息（location）
   - 产出信息（output, outputType）
4. 推断分组方式：按时间 / 按项目 / 按类别 / 按对象
5. 推断排序方式：时间顺序 / 时长优先 / 优先级
6. 识别是否为 repeatable 区域（如多个会议记录）
7. 检测行业特征词，匹配行业词库

## 用户粘贴的模板内容
${rawContent}

## 输出格式
只输出 JSON，不要任何其他文字。包含 name（模板名）、detectedFormat（markdown/plain_text/table/mixed/excel_paste）、industry、confidence、sections 数组，每个 section 包含:
- title: 段落标题
- type: SectionType（time_block/category_group/project_summary/achievement/plan_tomorrow/metric_summary/free_text/meeting_log/issue_note 之一）
- timeRange: 时间范围 {"start":"09:00","end":"12:00"}（如有）
- groupBy: 分组方式（time/project/subject/state/location）
- sortBy: 排序方式（chronological/duration/priority）
- fields: 字段列表 [{"key":"subject","label":"沟通对象","required":true,"format":"{subject}"}]
- repeatable: 是否多条目
- filter: 筛选条件（如有）`
}

/** 校验并规范化 LLM 输出的 sections；sections 非空数组才有效，非法 type 改 'free_text' */
function normalizeSections(parsed: ParsedTemplate): TemplateSection[] | null {
  if (!Array.isArray(parsed.sections) || parsed.sections.length === 0) return null
  const sections: TemplateSection[] = []
  for (const s of parsed.sections) {
    if (!s || typeof s !== 'object') continue
    const fields: TemplateField[] = (Array.isArray(s.fields) ? s.fields : [])
      .filter((f): f is NonNullable<typeof f> & { key: string } => !!f && typeof f.key === 'string' && f.key.length > 0)
      .map((f) => ({
        key: f.key,
        label: typeof f.label === 'string' && f.label ? f.label : f.key,
        required: !!f.required,
        ...(typeof f.format === 'string' ? { format: f.format } : {})
      }))
    const type = SECTION_TYPES.includes(s.type as SectionType) ? (s.type as SectionType) : 'free_text'
    sections.push({
      id: genId('sec'),
      title: typeof s.title === 'string' && s.title ? s.title : '未命名段落',
      type,
      ...(s.timeRange && typeof s.timeRange.start === 'string' && typeof s.timeRange.end === 'string'
        ? { timeRange: { start: s.timeRange.start, end: s.timeRange.end } }
        : {}),
      ...(s.groupBy ? { groupBy: s.groupBy } : {}),
      ...(s.sortBy ? { sortBy: s.sortBy } : {}),
      fields,
      repeatable: !!s.repeatable,
      ...(s.filter && typeof s.filter === 'object' ? { filter: s.filter } : {})
    })
  }
  return sections.length ? sections : null
}

/** AI 解析用户粘贴的模板文本；AI 不可用/解析失败返回 null（不落库） */
export async function parseUserTemplate(rawContent: string): Promise<ReportTemplate | null> {
  const s = getSettings()
  if (!s.aiEnabled || !s.aiApiKey) return null // AI 不可用
  const raw = rawContent.trim()
  if (!raw) return null

  const text = await llmChat([{ role: 'user', content: buildPrompt(raw) }], 45000)
  const parsed = text ? extractJson<ParsedTemplate>(text) : null
  if (!parsed || typeof parsed !== 'object') return null

  const sections = normalizeSections(parsed)
  if (!sections) return null

  // 解析质量信号只记录日志，不进模板模型（前端预览后可自行修正）
  console.log(
    `[report] 模板解析完成：format=${parsed.detectedFormat ?? 'unknown'} industry=${parsed.industry ?? 'unknown'} confidence=${parsed.confidence ?? '-'} sections=${sections.length}`
  )

  return {
    id: genId('tpl'),
    name: typeof parsed.name === 'string' && parsed.name.trim() ? parsed.name.trim() : '我的模板',
    type: 'daily',
    source: 'user_paste',
    rawContent: raw,
    sections,
    usageCount: 0,
    userCorrections: 0,
    isDefault: false,
    ts: Date.now()
  }
}
