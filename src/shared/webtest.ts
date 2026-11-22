/** Web 测试共享类型（主进程 / 渲染层共用） */

export type WebTestKind = 'flow' | 'inspect' | 'form'

export type WebTestAction = 'goto' | 'click' | 'fill' | 'assert' | 'screenshot' | 'wait'

export interface WebTestInput {
  url: string
  goal?: string
  kinds?: WebTestKind[]
  maxSteps?: number
}

export interface WebTestStep {
  index: number
  action: WebTestAction
  target?: string
  text?: string
  expect?: string
  note?: string
  status: 'pass' | 'fail' | 'skip'
  detail?: string
  shot?: string
  durationMs: number
}

export interface WebTestIssue {
  level: 'high' | 'medium' | 'low'
  title: string
  detail?: string
  step?: number
}

export interface WebTestReport {
  id: string
  url: string
  pageTitle?: string
  goal: string
  kinds: WebTestKind[]
  mode: string
  startedAt: number
  durationMs: number
  steps: WebTestStep[]
  issues: WebTestIssue[]
  summary: { pass: number; fail: number; skip: number }
  screenshots: string[]
  conclusion?: string
  reportPath?: string
}

export interface WebTestProgress {
  phase: 'navigate' | 'inspect' | 'plan' | 'step' | 'done' | 'error'
  message: string
  index?: number
  total?: number
  step?: WebTestStep
  report?: WebTestReport
}
