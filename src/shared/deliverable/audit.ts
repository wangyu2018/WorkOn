/**
 * 生成协议：风险分级 + 双闸门审计的类型契约
 */
import type { DeliverableFormat, DeliverableSpec, DraftSpec } from './spec'

export type AuditGate = 'draft' | 'spec'
export type AuditCategory = 'fact' | 'consistency' | 'privacy' | 'compliance' | 'layout' | 'semantic'
export type AuditLevel = 'high' | 'medium' | 'low'

export interface AuditIssue {
  id: string
  level: AuditLevel
  category: AuditCategory
  blockId?: string
  message: string
  evidence?: string
  fixHint?: string
  autoFixable: boolean
}

export interface AuditResult {
  id: string
  ts: number
  jobId: string
  revision: number
  gate: AuditGate
  pass: boolean
  issues: AuditIssue[]
  checkedAt: number
}

export interface RiskAssessment {
  level: 'high' | 'normal'
  needsAstConfirm: boolean
  reasons: string[]
}

export type DeliverableJobStage =
  | 'draft'
  | 'draft_audited'
  | 'draft_confirmed'
  | 'bound'
  | 'spec_audited'
  | 'spec_confirmed'
  | 'rendering'
  | 'done'
  | 'escalated'
  | 'cancelled'

export interface DeliverableOutput {
  format: DeliverableFormat
  path: string
  bytes: number
  revision: number
  createdAt: number
}

export interface DeliverableJob {
  id: string
  stage: DeliverableJobStage
  draft: DraftSpec
  spec?: DeliverableSpec
  revision: number
  risk: RiskAssessment
  draftIssues: AuditIssue[]
  specIssues: AuditIssue[]
  autoFixed: boolean
  outputs: DeliverableOutput[]
  history?: Array<{ revision: number; spec: DeliverableSpec; at: number }>
  approvedSpecId?: string
  feedback?: string
  error?: string
  createdAt: number
  updatedAt: number
}

/** 生成阶段进度事件 */
export interface DeliverableProgress {
  jobId: string
  stage: DeliverableJobStage
  revision: number
  issueCount: number
  highIssueCount: number
  message?: string
}
