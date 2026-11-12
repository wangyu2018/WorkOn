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
  ReportTemplate, OcrSnapshot, CategoryInference, SegmentPlanLink,
  Project, ProjectTask, ProjectTimeLink,
  RecognitionLogRecord, OcrShot,
  MotionMeta, PointsEntry, ReportEntryPatch,
  AutomationRule, KnowledgeItem, ProcessDraft,
  LifeGoal, GoalDayState, ChatSession
} from '@shared/types'
import type { ProjectBinding } from './attributions'
import type { DirActivity } from './dirWatcher'
import type { ConfirmMemory } from './attributions'
import type { ReviewIgnore } from './review'
import type { ChainDayReport } from '@shared/chain'
import { dateKey } from '@shared/trail'
import { getSettings } from './settings'
import { sendTo } from './windows'

// 活动记录留存天数从设置读取（activityRetentionDays，默认 60 天）

interface JsonData {
  entries: TimeEntry[]
  screenshots: ScreenshotRecord[]
  memos: MemoRecord[]
  knowledge: KnowledgeItem[]
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
  ocrSnapshots: OcrSnapshot[]
  ocrShots: OcrShot[] // 截图↔OCR 索引（P0）
  motions: MotionMeta[] // 动作库
  pointsLedger: PointsEntry[] // 积分流水
  reportPatches: ReportEntryPatch[] // 报表条目人工修正 // v2.9 OCR 结构化快照（不存原文，隐私）
  chains: ChainDayReport[] // v2.6.1 作业链路日报（按 date 唯一，重算覆盖）
  categoryInferences: CategoryInference[] // AI 分类兜底推断（独立表，仅展示）
  segmentPlans: SegmentPlanLink[] // 时间轴段→计划拖拽关联（持久化）
  projects: Project[] // v3.1 项目 AI 开发管理：项目
  projectTasks: ProjectTask[] // 项目下任务
  projectTimeLinks: ProjectTimeLink[] // 开发时间归类
  automations: AutomationRule[] // v7 MotionLab 自动化链
  projectBindings: ProjectBinding[] // v7 项目软绑定（工具/关键词/目录）
  confirmMemory: ConfirmMemory[] // v7 确认记忆（指纹去重）
  dirActivity: DirActivity[] // v7 目录活动（按 项目:日期 唯一）
  processDrafts: ProcessDraft[] // 过程草稿 → 知识库案卷
  lifeGoals: LifeGoal[] // 人生预期目标（轨迹引擎）
  goalDayStates: GoalDayState[] // 目标每日归因结算（goalId:date 唯一）
  chatSessions: ChatSession[] // v10 会话：消息归档可续问
  reviewIgnores: ReviewIgnore[] // 一分钟校对：按 date+app 忽略「与工作无关」
}

const EMPTY: JsonData = {
  entries: [], screenshots: [], memos: [], knowledge: [], plans: [], analyses: [],
  usages: [], corrections: [], rules: [], feedbacks: [], qa: [], categories: [],
  attentionScores: [], achievements: [], accessLogs: [], personas: [],
  reportTemplates: [], ocrSnapshots: [], chains: [], categoryInferences: [], segmentPlans: [],
  projects: [], projectTasks: [], projectTimeLinks: [], automations: [], projectBindings: [], confirmMemory: [], dirActivity: [], processDrafts: [],
  lifeGoals: [], goalDayStates: [], chatSessions: [],
  reviewIgnores: [],
  ocrShots: [],
  motions: [],
  pointsLedger: []
  ,
  reportPatches: []
  }

let dir = ''
let jsonFile = ''
let actFile = ''
let recogFile = ''
let data: JsonData = { ...EMPTY }
let activities: ActivityRecord[] = []
let actIdSeq = 1
let recogIdSeq = 1
let flushTimer: NodeJS.Timeout | null = null
let actDirty = false

export function initDb(): void {
  dir = app.getPath('userData')
  jsonFile = path.join(dir, 'db.json')
  actFile = path.join(dir, 'activities.jsonl')
  recogFile = path.join(dir, 'recognition_log.jsonl')
  pruneRecogLog()

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
  // 活动 JSONL 可能上十万行：不在此处同步读，避免主进程卡死导致窗口不出现
  console.log('[db] core ready（activities 延后加载）')
}

let activitiesLoading = false
let activitiesReady = false

export function isActivitiesReady(): boolean {
  return activitiesReady
}

/**
 * 分块加载 activities.jsonl，定期把事件循环让给窗口绘制。
 * 应在主窗口创建之后调用；完成后再 startMonitor。
 */
export function loadActivitiesDeferred(): Promise<void> {
  if (activitiesReady || activitiesLoading) return Promise.resolve()
  activitiesLoading = true
  return new Promise((resolve) => {
    try {
      if (!fs.existsSync(actFile)) {
        activitiesReady = true
        activitiesLoading = false
        console.log('[db] activities.jsonl: 首次运行，新建活动日志')
        resolve()
        return
      }
      const retainDays = Math.max(7, getSettings().activityRetentionDays || 60)
      const loadStart = Date.now()
      const cutoff = Date.now() - retainDays * 86400000
      const readline = require('readline') as typeof import('readline')
      const stream = fs.createReadStream(actFile, { encoding: 'utf-8' })
      const rl = readline.createInterface({ input: stream, crlfDelay: Infinity })
      let kept = 0
      let seen = 0
      let pruned = false
      const batch: ActivityRecord[] = []

      const flushBatch = (): void => {
        if (!batch.length) return
        for (const r of batch) {
          activities.push(r)
          if (r.id && r.id >= actIdSeq) actIdSeq = r.id + 1
          kept++
        }
        batch.length = 0
      }

      rl.on('line', (line: string) => {
        if (!line) return
        seen++
        try {
          const r = JSON.parse(line) as ActivityRecord
          if (r.ts >= cutoff) batch.push(r)
          else pruned = true
        } catch {
          /* 跳过坏行 */
        }
        if (batch.length >= 1500) {
          flushBatch()
          rl.pause()
          setImmediate(() => rl.resume())
        } else if (seen % 4000 === 0) {
          rl.pause()
          setImmediate(() => rl.resume())
        }
      })
      rl.on('close', () => {
        flushBatch()
        activitiesReady = true
        activitiesLoading = false
        console.log(`[db] activities 加载耗时 ${Date.now() - loadStart}ms（${kept} 条）`)
        if (pruned) {
          try {
            fs.writeFileSync(
              actFile,
              activities.map((r) => JSON.stringify(r)).join('\n') + (activities.length ? '\n' : ''),
              'utf-8'
            )
            console.log(`[db] activities.jsonl: 已加载 ${kept} 条（已裁剪过期，保留 ${retainDays} 天）`)
          } catch (e) {
            console.warn('[db] activities 裁剪写回失败', e)
            console.log(`[db] activities.jsonl: 已加载 ${kept} 条（保留 ${retainDays} 天）`)
          }
        } else {
          console.log(`[db] activities.jsonl: 已加载 ${kept} 条（保留 ${retainDays} 天）`)
        }
        resolve()
      })
      rl.on('error', (e: Error) => {
        activitiesReady = true
        activitiesLoading = false
        console.warn('[db] activities.jsonl 读取失败', e)
        resolve()
      })
    } catch (e) {
      activitiesReady = true
      activitiesLoading = false
      console.warn('[db] activities.jsonl 读取失败', e)
      resolve()
    }
  })
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
  flushActivityBuffer()
  flushRecogBuffer()
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
// 性能：JSONL 缓冲写入（每 8s 或满 50 条批量落盘），替代每 tick 同步 appendFileSync。
// 代价：崩溃可能丢最后 ≤8s 的活动尾巴（可接受；flushNow 在退出时兜底）
let pendingActLines: string[] = []
let actFlushTimer: ReturnType<typeof setTimeout> | null = null

function flushActivityBuffer(): void {
  if (!pendingActLines.length) return
  const lines = pendingActLines
  pendingActLines = []
  try {
    fs.appendFileSync(actFile, lines.join('\n') + '\n', 'utf-8')
  } catch (e) {
    // 写入失败不再静默：主窗口弹错误横幅（用户可感知数据丢失风险）
    console.warn('[db] 活动批量写入失败', e)
    sendTo('main', 'error-banner', `ERR_DB_WRITE_FAILED · 活动记录写入失败：${(e as Error).message}（请检查磁盘空间；恢复后自动从中断处继续）`)
  }
}

function scheduleActFlush(): void {
  if (actFlushTimer) return
  actFlushTimer = setTimeout(() => {
    actFlushTimer = null
    flushActivityBuffer()
  }, 8000)
}

export function insertActivity(r: Omit<ActivityRecord, 'id'>): ActivityRecord {
  const rec: ActivityRecord = { ...r, id: actIdSeq++ }
  activities.push(rec)
  pendingActLines.push(JSON.stringify(rec))
  if (pendingActLines.length >= 50) flushActivityBuffer()
  else scheduleActFlush()
  return rec
}

// ── recognition_log（影子模式记账；7 天保留，启动裁剪） ──
const RETAIN_RECOG_LOG_DAYS = 7

function pruneRecogLog(): void {
  try {
    if (!fs.existsSync(recogFile)) return
    const cutoff = Date.now() - RETAIN_RECOG_LOG_DAYS * 86400000
    const lines = fs.readFileSync(recogFile, 'utf-8').split('\n').filter(Boolean)
    const kept: string[] = []
    for (const line of lines) {
      try {
        const r = JSON.parse(line) as RecognitionLogRecord
        if (r.ts >= cutoff) {
          kept.push(line)
          if (r.id && r.id >= recogIdSeq) recogIdSeq = r.id + 1
        }
      } catch { /* 跳过坏行 */ }
    }
    if (kept.length !== lines.length) {
      fs.writeFileSync(recogFile, kept.join('\n') + (kept.length ? '\n' : ''), 'utf-8')
    }
  } catch (e) {
    console.warn('[db] recognition_log 裁剪失败', e)
  }
}

let pendingRecog: RecognitionLogRecord[] = []
let recogFlushTimer: ReturnType<typeof setTimeout> | null = null

function flushRecogBuffer(): void {
  if (!pendingRecog.length) return
  const recs = pendingRecog
  pendingRecog = []
  try {
    fs.appendFileSync(recogFile, recs.map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf-8')
  } catch (e) {
    console.warn('[db] 识别日志批量写入失败', e)
  }
}

function scheduleRecogFlush(): void {
  if (recogFlushTimer) return
  recogFlushTimer = setTimeout(() => {
    recogFlushTimer = null
    flushRecogBuffer()
  }, 8000)
}

export function insertRecognitionLog(r: Omit<RecognitionLogRecord, 'id'>): void {
  const rec: RecognitionLogRecord = { ...r, id: recogIdSeq++ }
  pendingRecog.push(rec)
  if (pendingRecog.length >= 50) flushRecogBuffer()
  else scheduleRecogFlush()
}

export function listRecentRecognitionLogs(n = 20): RecognitionLogRecord[] {
  try {
    const pending = pendingRecog.slice(-n)
    const fromFile: RecognitionLogRecord[] = []
    if (fs.existsSync(recogFile)) {
      const lines = fs.readFileSync(recogFile, 'utf-8').split('\n').filter(Boolean)
      for (const line of lines.slice(-n)) {
        try { fromFile.push(JSON.parse(line) as RecognitionLogRecord) } catch { /* 跳过坏行 */ }
      }
    }
    return [...fromFile, ...pending].slice(-n)
  } catch {
    return []
  }
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
