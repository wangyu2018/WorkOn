/**
 * 本地助手意图：这些问句的数据都在本机，不必走 LLM。
 * 主进程执行 → 返回结构化卡片，渲染端用原生组件画，保持与全站视觉一致。
 */
import type { PlanStatus, PlanType } from './types'

/** AI 建计划的预览草稿：先给用户看卡片，确认后才落库 */
export interface PlanProposal {
  token: string
  date: string
  title: string
  category: string
  planType: PlanType
  startMin?: number
  endMin?: number
  durationMin?: number
  note?: string
}

export interface AssistantTodoSuggestion {
  id: string
  title: string
  status: PlanStatus
  date?: string
  ageDays: number
  /** 处置建议依据（轨迹关键词命中 / 积压天数） */
  evidence: string
  suggestion: 'auto_done' | 'keep' | 'cancel'
  confidence: number
}

export interface AssistantListRow {
  id: string
  title: string
  meta: string
  status?: string
}

export type AssistantCard =
  | {
      kind: 'todo_cleanup'
      items: AssistantTodoSuggestion[]
      stats: { total: number; autoDone: number; keep: number; cancel: number }
    }
  | {
      kind: 'list'
      title: string
      source: 'plans' | 'reminders'
      rows: AssistantListRow[]
    }
  | {
      kind: 'weather'
      city: string
      now: {
        text: string
        tempC: number
        feelsC: number
        humidity: number
        windKph: number
        maxC: number
        minC: number
      }
      hours: { hour: number; text: string; tempC: number; chanceOfRain: number }[]
      tomorrow: { text: string; maxC: number; minC: number }
    }
  | {
      kind: 'app'
      app: string
      display: string
      minutes: number
      segments: number
      lastHM: string
      stateLabel: string
      category: string
      im: boolean
      actions: string[]
    }

export interface AssistantIntentResult {
  matched: boolean
  text?: string
  card?: AssistantCard
}
