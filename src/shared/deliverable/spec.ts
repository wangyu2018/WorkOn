/**
 * 交付物版式 AST（单一事实源）
 * Writer 只描述内容，不写 HTML/CSS；渲染层与导出层共用同一份 spec。
 */
import type { ChartKind } from '@shared/viz/svg'

export type DeliverableTemplate = 'brief' | 'report' | 'deck' | 'poster'
export type DeliverableFormat = 'md' | 'html' | 'pdf' | 'png' | 'docx' | 'xlsx' | 'pptx'

/** 数据来源：审计要求每个数值/图表都能追溯到一次工具调用 */
export interface DataSourceRef {
  tool: string
  queryId: string
  ts: number
  label?: string
}

interface BlockBase {
  id: string
  source?: DataSourceRef
  redacted?: boolean
}

export interface CoverBlock extends BlockBase {
  type: 'cover'
  title: string
  subtitle?: string
  date?: string
  author?: string
}

export interface HeadingBlock extends BlockBase {
  type: 'heading'
  level: 1 | 2 | 3
  text: string
}

export interface ParagraphBlock extends BlockBase {
  type: 'paragraph'
  text: string
}

export interface MetricItem {
  label: string
  value: string | number
  unit?: string
  delta?: string
}

export interface MetricsBlock extends BlockBase {
  type: 'metrics'
  items: MetricItem[]
}

export interface TableBlock extends BlockBase {
  type: 'table'
  title?: string
  columns: string[]
  rows: Array<Array<string | number | null>>
  align?: Array<'left' | 'right'>
}

export interface ChartPoint {
  label: string
  value: number
  color?: string
}

export interface ChartBlock extends BlockBase {
  type: 'chart'
  kind: ChartKind
  title?: string
  points?: ChartPoint[]
  matrix?: number[][]
  rowLabels?: string[]
  colLabels?: string[]
  caption?: string
  max?: number
}

export interface FlowDiagramBlock extends BlockBase {
  type: 'flow'
  title?: string
  nodes: Array<{ id: string; label: string; kind?: string }>
  edges: Array<{ from: string; to: string; label?: string }>
}

export interface TimelineBlock extends BlockBase {
  type: 'timeline'
  title?: string
  items: Array<{ time: string; title: string; detail?: string; state?: string }>
}

export interface CalloutBlock extends BlockBase {
  type: 'callout'
  kind: 'info' | 'warn' | 'success'
  title?: string
  text: string
}

export interface ImageBlock extends BlockBase {
  type: 'image'
  src: string
  alt?: string
  caption?: string
}

export interface FooterBlock extends BlockBase {
  type: 'footer'
  text: string
}

export type DeliverableBlock =
  | CoverBlock
  | HeadingBlock
  | ParagraphBlock
  | MetricsBlock
  | TableBlock
  | ChartBlock
  | FlowDiagramBlock
  | TimelineBlock
  | CalloutBlock
  | ImageBlock
  | FooterBlock

export interface DeliverableSpec {
  template: DeliverableTemplate
  title: string
  subtitle?: string
  date?: string
  author?: string
  theme?: 'dark' | 'light'
  blocks: DeliverableBlock[]
  meta?: {
    jobId?: string
    revision?: number
    specHash?: string
    shareTo?: string
    privacyReviewed?: boolean
    hasExternalData?: boolean
    dataSnapshotTs?: number
  }
}

/* ── 草案（生成前，只有文字） ── */

export interface DraftChartRef {
  id: string
  kind: ChartKind
  title: string
  sourceTool?: string
  note?: string
}

export interface DraftSection {
  id: string
  title: string
  points: string[]
  charts?: DraftChartRef[]
}

export interface DraftSpec {
  template: DeliverableTemplate
  title: string
  subtitle?: string
  date?: string
  audience?: string
  sections: DraftSection[]
  estimatedPages: number
  riskHints?: string[]
}

export const TEMPLATE_LABEL: Record<DeliverableTemplate, string> = {
  brief: '一页纸简报',
  report: '日报 / 周报',
  deck: '演示文稿',
  poster: '长图'
}

export const TEMPLATE_MAX_PAGES: Record<DeliverableTemplate, number> = {
  brief: 1,
  report: 6,
  deck: 20,
  poster: 1
}
