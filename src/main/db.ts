/**
 * 本地存储层
 * 说明：PRD 指定 better-sqlite3，但本项目遵循 PRD 自身的"规避原生模块编译失败"原则
 * （winInfo.ts 替代 active-win 的同一理由），采用纯 JS 落盘：
 *   - activities：JSONL 追加写（activities.jsonl），启动时按保留期裁剪（activityRetentionDays，默认 60 天）
 *   - 其余集合：单文件 db.json，防抖落盘
 * 集合口径与 PRD 一致：activities/entries/screenshots/memos/plans/analyses/usages/corrections/rules/feedbacks + qa
 */
import { app, dialog } from 'electron'
import fs from 'fs'
import path from 'path'
import type {
  ActivityRecord, TimeEntry, ScreenshotRecord, MemoRecord, PlanItem,
  UserAnalysis, UsageStat, ActivityCorrection, CorrectionRule, UserFeedback, QAMessage,
  CustomCategory, AttentionScore, Achievement, AccessLog, UserPersona,
  ReportTemplate, OcrSnapshot, CategoryInference, SegmentPlanLink
} from '@shared/types'
import type { ChainDayReport } from '@shared/chain'
import { dateKey } from '@shared/trail'
import { getSettings } from './settings'
import { sendTo } from './windows'

// 活动记录留存天数从设置读取（activityRetentionDays，默认 60 天）

interface JsonData {
  entries: TimeEntry[]
  screenshots: ScreenshotRecord[]
  memos: MemoRecord[]
  plans: PlanItem[]
  analyses: UserAnalysis[]
  usages: UsageStat[]
  corrections: ActivityCorrection[]
  rules: CorrectionRule[]
  feedbacks: UserFeedback[]
  qa: QAMessage[]
  categories: CustomCategory[]
  attentionScores: AttentionScore[] // v2.6 注意力评分（按 date 唯一）
  achievements: Achievement[] // v2.6 已解锁成就（定义见 shared/achievements.ts）
  accessLogs: AccessLog[] // v2.7 AI 访问日志
  personas: UserPersona[] // v2.7 用户画像
  reportTemplates: ReportTemplate[] // v2.9 用户报表模板（预置模板不落库）
  ocrSnapshots: OcrSnapshot[] // v2.9 OCR 结构化快照（不存原文，隐私）
  chains: ChainDayReport[] // v2.6.1 作业链路日报（按 date 唯一，重算覆盖）
  categoryInferences: CategoryInference[] // AI 分类兜底推断（独立表，仅展示）
  segmentPlans: SegmentPlanLink[] // 时间轴段→计划拖拽关联（持久化）
}

const EMPTY: JsonData = {
  entries: [], screenshots: [], memos: [], plans: [], analyses: [],
  usages: [], corrections: [], rules: [], feedbacks: [], qa: [], categories: [],
  attentionScores: [], achievements: [], accessLogs: [], personas: [],
  reportTemplates: [], ocrSnapshots: [], chains: [], categoryInferences: [], segmentPlans: []
}

let dir = ''
let jsonFile = ''
let actFile = ''
let data: JsonData = { ...EMPTY }
let activities: ActivityRecord[] = []
let actIdSeq = 1
let flushTimer: NodeJS.Timeout | null = null
let actDirty = false

export function initDb(): void {
  dir = app.getPath('userData')
  jsonFile = path.join(dir, 'db.json')
  actFile = path.join(dir, 'activities.jsonl')

  // 启动可写性检查：数据目录不可写时明确告知（静默丢失比报错更糟）
  try {
    fs.mkdirSync(dir, { recursive: true })
    fs.accessSync(dir, fs.constants.W_OK)
  } catch (e) {
    console.error('[db] userData 目录不可写:', dir, e)
    dialog.showErrorBox(
      'WorkOn 数据目录不可写',
      `无法写入数据目录：\n${dir}\n\n活动记录将无法保存。请检查磁盘空间或目录权限后重启应用。`
    )
  }

  try {
    if (fs.existsSync(jsonFile)) data = { ...EMPTY, ...JSON.parse(fs.readFileSync(jsonFile, 'utf-8')) }
  } catch (e) {
    console.warn('[db] db.json 读取失败，使用空库', e)
  }

  try {
    if (fs.existsSync(actFile)) {
      const retainDays = Math.max(7, getSettings().activityRetentionDays || 60)
      const cutoff = Date.now() - retainDays * 86400000
      const lines = fs.readFileSync(actFile, 'utf-8').split('\n').filter(Boolean)
      for (const line of lines) {
        try {
          const r = JSON.parse(line) as ActivityRecord
          if (r.ts >= cutoff) {
            activities.push(r)
            if (r.id && r.id >= actIdSeq) actIdSeq = r.id + 1
          }
        } catch { /* 跳过坏行 */ }
      }
      // 裁剪后重写，防膨胀
      fs.writeFileSync(actFile, activities.map((r) => JSON.stringify(r)).join('\n') + (activities.length ? '\n' : ''), 'utf-8')
      console.log(`[db] activities.jsonl: 已加载 ${activities.length} 条（保留 ${retainDays} 天）`)
    } else {
      console.log('[db] activities.jsonl: 首次运行，新建活动日志')
    }
  } catch (e) {
    console.warn('[db] activities.jsonl 读取失败', e)
  }
}

function scheduleFlush(): void {
  actDirty = true
  if (flushTimer) return
  flushTimer = setTimeout(() => {
    flushTimer = null
    flushNow()
  }, 3000)
}

export function flushNow(): void {
  if (!jsonFile) return // initDb 未运行（如单实例锁冲突直接 quit），无需落盘
  try {
    fs.writeFileSync(jsonFile, JSON.stringify(data), 'utf-8')
  } catch (e) {
    console.warn('[db] db.json 落盘失败', e)
  }
  if (actDirty) {
    actDirty = false
    try {
      // activities 已是追加写，这里无需整写；仅确保目录存在
      fs.mkdirSync(dir, { recursive: true })
    } catch { /* ignore */ }
  }
}

// ── activities ──
export function insertActivity(r: Omit<ActivityRecord, 'id'>): ActivityRecord {
  const rec: ActivityRecord = { ...r, id: actIdSeq++ }
  activities.push(rec)
  try {
    fs.appendFileSync(actFile, JSON.stringify(rec) + '\n', 'utf-8')
  } catch (e) {
    // 写入失败不再静默：主窗口弹错误横幅（用户可感知数据丢失风险）
    console.warn('[db] 活动追加失败', e)
    sendTo('main', 'error-banner', `活动记录写入失败：${(e as Error).message}（请检查磁盘空间）`)
  }
  return rec
}

export function listActivities(date: string): ActivityRecord[] {
  return activities.filter((r) => dateKey(r.ts) === date)
}

export function listActivitiesRange(fromTs: number, toTs: number): ActivityRecord[] {
  return activities.filter((r) => r.ts >= fromTs && r.ts <= toTs)
}

/** 按应用删除活动记录（隐私一键清理）：内存过滤后重写 JSONL，返回删除条数 */
export function deleteActivitiesByApp(appName: string): number {
  const before = activities.length
  activities = activities.filter((r) => (r.appName ?? r.app) !== appName)
  const removed = before - activities.length
  if (removed > 0) {
    try {
      fs.writeFileSync(actFile, activities.map((r) => JSON.stringify(r)).join('\n') + (activities.length ? '\n' : ''), 'utf-8')
    } catch (e) {
      console.warn('[db] 清理应用记录重写失败', e)
    }
  }
  return removed
}

/** 按 startTs 更新活动标题（时间轴编辑）：内存更新后重写 JSONL，返回更新后的记录 */
export function updateActivityTitleByStartTs(startTs: number, title: string): ActivityRecord | null {
  const idx = activities.findIndex(a => a.startTs === startTs)
  if (idx < 0) return null
  activities[idx] = { ...activities[idx], title }
  try {
    fs.writeFileSync(actFile, activities.map((r) => JSON.stringify(r)).join('\n') + (activities.length ? '\n' : ''), 'utf-8')
  } catch (e) {
    console.warn('[db] 活动更新重写失败', e)
  }
  return activities[idx]
}

// ── 通用集合 ──
type JsonCollection = keyof JsonData

export function col<T>(name: JsonCollection): T[] {
  return data[name] as T[]
}

export function insertInto<T extends { id?: string; ts?: number }>(name: JsonCollection, item: T): T {
  const arr = data[name] as unknown as T[]
  arr.push(item)
  // qa 消息流防膨胀：只留最近 500 条
  if (name === 'qa' && arr.length > 500) arr.splice(0, arr.length - 500)
  scheduleFlush()
  return item
}

export function updateIn<T extends { id: string }>(name: JsonCollection, id: string, patch: Partial<T>): T | null {
  const arr = data[name] as unknown as T[]
  const idx = arr.findIndex((i) => i.id === id)
  if (idx < 0) return null
  arr[idx] = { ...arr[idx], ...patch }
  scheduleFlush()
  return arr[idx]
}

export function removeFrom(name: JsonCollection, id: string): boolean {
  const arr = data[name] as unknown as { id: string }[]
  const idx = arr.findIndex((i) => i.id === id)
  if (idx < 0) return false
  arr.splice(idx, 1)
  scheduleFlush()
  return true
}
