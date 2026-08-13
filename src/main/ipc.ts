/**
 * IPC 注册：window.api 的全部通道
 */
import { ipcMain, dialog, app, screen } from 'electron'
import fs from 'fs'
import path from 'path'
import type {
  AppSettings, PlanItem, TimeEntry, UserFeedback, CorrectionRule,
  ActivityCorrection, PetState, PlanStatus
} from '@shared/types'
import { genId } from '@shared/types'
import { dateKey, buildMergedTrail } from '@shared/trail'
import { planVsActual, forecastPlan, BUILTIN_CATEGORIES } from '@shared/planAnalysis'
import { getSettings, setSettings } from './settings'
import {
  col, insertInto, updateIn, removeFrom, listActivities, listActivitiesRange, deleteActivitiesByApp,
  updateActivityTitleByStartTs
} from './db'
import { presence } from './presence'
import { bus } from './state'
import {
  analyzeDay, askWithContext, askWithContextStream, recordFeedback, genQuestion,
  generateTodos, generateTips, testAIConnection, petAskShort, petAskShortStream, confirmToPlan, matchBrowserToPlan, deriveHabits,
  aggregateFacts, buildSystemPrompt, selectModel
} from './ai'
import { onerPull, onerPushStatus, startOnerAutoSync } from './oner'
import { restartMonitor, PRIVACY_ALIASES } from './monitor'
import { startIntegration } from './integration'
import { getOcrStorageStats, clearOcrCache } from './ocr'
import { startFolderWatch, updateFolders, scanFolders, getWatchDirs } from './folderWatcher'
import { saveWorkChain } from './qa/questionGenerator'
import { refreshTray, syncTrayFromSettings } from './tray'
import { todayScore, recentScores, getScoreStrategy } from './attention'
import { todayChains, analyzeDayChains } from './chain/engine'
import {
  getPersona, refreshPersona, updatePersonaField, confirmPersonaField,
  removePersonaTag, setPersonaPrivacy, exportPersona
} from './persona'
import { listAccessLogs, clearAccessLogs } from './desensitize'
import { ACHIEVEMENT_DEFS } from '@shared/achievements'
import {
  mainWindow, widgetWindow, petWindow, toggleWidget, togglePet,
  setPetIgnoreMouse, setPetModal, createMainWindow, createPetWindow, closePetWindow, sendTo
} from './windows'
import type { UserAnalysis, MergedTrail, CustomCategory, UserHabits, Achievement, UserType, ReportTemplate, CategoryInference } from '@shared/types'
import { generateReport, generateWeeklyReport } from './report/engine'
import { listTemplates } from './report/templates'
import { parseUserTemplate } from './report/templateParser'

function todayTrail(): MergedTrail {
  const date = dateKey(Date.now())
  return buildMergedTrail(listActivities(date), date)
}

function latestAnalysis(date: string): UserAnalysis | null {
  const all = col<UserAnalysis>('analyses').filter((a) => a.date === date)
  return all.sort((a, b) => b.ts - a.ts)[0] ?? null
}

/** 近 7 天轨迹 → 个人习惯画像（数据不足 3 天返回 null） */
function habitsOfUser(): UserHabits | null {
  const trails = Array.from({ length: 7 }, (_, i) => dateKey(Date.now() - i * 86400000)).map((d) =>
    buildMergedTrail(listActivities(d), d)
  )
  const nonEmpty = trails.filter((t) => t.totalMin > 0)
  return nonEmpty.length >= 3 ? deriveHabits(nonEmpty) : null
}

export function registerIpc(): void {
  // ── 设置 ──
  ipcMain.handle('settings:get', () => getSettings())
  ipcMain.handle('settings:set', (_e, patch: Partial<AppSettings>) => {
    let next = setSettings(patch)
    // 后端校验：无 API Key 不允许启用 AI（前端提示可能被绕过，这里兜底）
    if (patch.aiEnabled && !next.aiApiKey) {
      next = setSettings({ aiEnabled: false })
    }
    if (patch.monitorInterval || patch.monitorSmart !== undefined) restartMonitor()
    if (patch.deepMode !== undefined) restartMonitor()
    if (patch.wsEnabled !== undefined || patch.wsPort) startIntegration()
    if (patch.onerAutoSyncMin !== undefined) startOnerAutoSync()
    if (patch.petCharacter) bus.setPet({ characterId: patch.petCharacter })
    if (patch.widgetOpacity !== undefined && widgetWindow && !widgetWindow.isDestroyed()) {
      widgetWindow.setOpacity(patch.widgetOpacity)
    }
    if (patch.launchAtLogin !== undefined) {
      import('electron').then(({ app }) => app.setLoginItemSettings({ openAtLogin: patch.launchAtLogin! }))
    }
    // 模块开关影响托盘菜单显示（桌搭/悬浮窗未开启则对应菜单项隐藏）
    if (patch.petEnabled !== undefined) {
      if (patch.petEnabled) createPetWindow()
      else closePetWindow()
    }
    if (patch.petEnabled !== undefined || patch.widgetVisible !== undefined) refreshTray()
    if (patch.widgetVisible !== undefined) {
      syncTrayFromSettings()
      if (widgetWindow && !widgetWindow.isDestroyed()) {
        if (patch.widgetVisible) widgetWindow.show()
        else widgetWindow.hide()
      }
    }
    // 桌宠相关设置实时同步到桌宠窗（缩放 / 游荡开关 / 帧率档位 / 互动开关）
    if (
      patch.petScale !== undefined ||
      patch.petRoam !== undefined ||
      patch.petFpsTier !== undefined ||
      patch.petInteractions !== undefined ||
      patch.petReturnMin !== undefined
    ) {
      sendTo('pet', 'pet:settings', {
        petScale: next.petScale,
        petRoam: next.petRoam,
        petFpsTier: next.petFpsTier,
        petInteractions: next.petInteractions,
        petReturnMin: next.petReturnMin
      })
    }
    return next
  })

  // ── 实时状态 ──
  ipcMain.handle('presence:get', () => presence.getSnapshot())
  ipcMain.handle('desktop:get', () => bus.desktopState())

  // ── 轨迹 ──
  ipcMain.handle('trail:get', (_e, date?: string) => {
    const d = date ?? dateKey(Date.now())
    return buildMergedTrail(listActivities(d), d)
  })
  ipcMain.handle('trail:update', (_e, startTs: number, patch: { title?: string }) => {
    if (patch.title === undefined) return { success: false }
    const updated = updateActivityTitleByStartTs(startTs, patch.title)
    return updated ? { success: true } : { success: false }
  })

  const segmentPlanMap = new Map<number, string>()
  ipcMain.handle('trail:assignPlan', (_e, segStartTs: number, planId: string | null) => {
    if (planId) {
      segmentPlanMap.set(segStartTs, planId)
    } else {
      segmentPlanMap.delete(segStartTs)
    }
    return { success: true }
  })

  // ── 日历条目 ──
  ipcMain.handle('entries:list', (_e, date: string) =>
    col<TimeEntry>('entries').filter((en) => en.date === date))
  ipcMain.handle('entries:save', (_e, entry: Partial<TimeEntry> & { date: string; startMin: number; endMin: number; title: string }) => {
    if (entry.id) return updateIn<TimeEntry>('entries', entry.id, entry)
    return insertInto<TimeEntry>('entries', { source: 'manual', ts: Date.now(), ...entry, id: genId('entry') } as TimeEntry)
  })
  ipcMain.handle('entries:remove', (_e, id: string) => removeFrom('entries', id))

  // ── 计划 ──
  ipcMain.handle('plans:list', (_e, date?: string) => {
    const all = col<PlanItem>('plans')
    return date ? all.filter((p) => p.date === date) : all
  })
  ipcMain.handle('plans:save', (_e, plan: Partial<PlanItem> & { date: string; title: string }) => {
    if (plan.id) return updateIn<PlanItem>('plans', plan.id, plan)
    return insertInto<PlanItem>('plans', {
      category: 'other', status: 'planned', source: 'manual', ts: Date.now(),
      ...plan, id: genId('plan')
    } as PlanItem)
  })
  ipcMain.handle('plans:remove', (_e, id: string) => removeFrom('plans', id))
  ipcMain.handle('plans:setStatus', async (_e, id: string, status: PlanStatus) => {
    const updated = updateIn<PlanItem>('plans', id, { status })
    if (updated && updated.source === 'oner') await onerPushStatus(updated)
    return updated
  })
  ipcMain.handle('plans:vsActual', (_e, date?: string) => {
    const d = date ?? dateKey(Date.now())
    const trail = buildMergedTrail(listActivities(d), d)
    return planVsActual(col<PlanItem>('plans'), trail, col<CustomCategory>('categories'))
  })

  // ── AI 分析 ──
  ipcMain.handle('analysis:get', (_e, date?: string) => latestAnalysis(date ?? dateKey(Date.now())))
  ipcMain.handle('analysis:refresh', async () => {
    const trail = todayTrail()
    const ana = await analyzeDay(trail)
    insertInto('analyses', ana)
    return ana
  })
  ipcMain.handle('analysis:todos', () => {
    const ana = latestAnalysis(dateKey(Date.now()))
    return ana ? generateTodos(ana) : []
  })
  ipcMain.handle('analysis:tips', () => {
    const ana = latestAnalysis(dateKey(Date.now()))
    return ana ? generateTips(ana) : []
  })

  // ── 问答 ──
  ipcMain.handle('qa:ask', async (_e, question: string) => {
    const ana = latestAnalysis(dateKey(Date.now()))
    return askWithContext(question, ana, todayTrail(), habitsOfUser())
  })

  // ── 流式问答 ──
  // 渲染端调用后，主进程通过事件流式推送 chunk
  ipcMain.handle('qa:askStream', async (_e, question: string) => {
    const s = getSettings()
    const ana = latestAnalysis(dateKey(Date.now()))
    if (!s.aiStreaming) {
      // 流式未启用 → 回退普通模式
      const result = await askWithContext(question, ana, todayTrail(), habitsOfUser())
      sendTo('main', 'ai:streamDone', result.content)
      return result
    }
    try {
      const result = await askWithContextStream(
        question,
        ana,
        todayTrail(),
        (delta, full) => sendTo('main', 'ai:streamChunk', { delta, full }),
        (toolName) => sendTo('main', 'ai:streamTool', { tool: toolName }),
        habitsOfUser()
      )
      sendTo('main', 'ai:streamDone', result.content)
      return result
    } catch (e) {
      sendTo('main', 'ai:streamError', { error: (e as Error).message })
      return { content: null, references: [] }
    }
  })

  ipcMain.handle('qa:list', () => col('qa'))

  ipcMain.handle('qa:prune', (_e, keepIds: string[]) => {
    const all = col('qa') as Array<{ id: string }>
    const toRemove = all.filter(q => !keepIds.includes(q.id))
    for (const q of toRemove) removeFrom('qa', q.id)
    return { removed: toRemove.length }
  })

  // ── 备忘 ──
  ipcMain.handle('memos:list', () => col('memos'))
  ipcMain.handle('memos:add', (_e, text: string) =>
    insertInto('memos', { id: genId('memo'), text, source: 'manual', ts: Date.now() }))

  // ── 轻问诊 ──
  ipcMain.handle('feedback:send', (_e, payload: { qid: string; ctx: string; question: string; answer: 'yes' | 'no' }) => {
    const fb = recordFeedback(payload.qid, payload.ctx, payload.question, payload.answer)
    if (bus.question?.id === payload.qid) bus.setQuestion(null)
    return fb
  })
  ipcMain.handle('question:get', () => bus.question)

  // ── 纠错与规则 ──
  ipcMain.handle('corrections:list', () => col('corrections'))
  ipcMain.handle('corrections:add', (_e, c: Omit<ActivityCorrection, 'id' | 'ts'>) =>
    insertInto<ActivityCorrection>('corrections', { ...c, id: genId('corr'), ts: Date.now() }))
  ipcMain.handle('corrections:remove', (_e, id: string) => removeFrom('corrections', id))
  ipcMain.handle('rules:list', () => col('rules'))
  ipcMain.handle('rules:save', (_e, rule: Partial<CorrectionRule> & { screen: number; matchApp: string; matchTitleContains: string }) => {
    if (rule.id) return updateIn<CorrectionRule>('rules', rule.id, rule)
    return insertInto<CorrectionRule>('rules', { enabled: true, ts: Date.now(), ...rule, id: genId('rule') } as CorrectionRule)
  })
  ipcMain.handle('rules:remove', (_e, id: string) => removeFrom('rules', id))

  // ── 用量 ──
  ipcMain.handle('usage:today', () => {
    const d = dateKey(Date.now())
    return col<{ date: string; model: string; tokens: number; qaCount: number; costUsd: number }>('usages')
      .filter((u) => u.date === d)
  })

  // ── 桌宠 ──
  ipcMain.handle('pet:get', () => bus.pet)
  ipcMain.handle('pet:set', (_e, patch: Partial<PetState>) => bus.setPet(patch))
  ipcMain.on('pet:hit', (_e, over: boolean) => setPetIgnoreMouse(!over))
  ipcMain.on('pet:modal', (_e, active: boolean) => setPetModal(active))
  ipcMain.on('pet:hide', () => { if (petWindow) petWindow.hide() })
  ipcMain.on('pet:show', () => { if (petWindow) { createPetWindow(); petWindow.show() } })
  ipcMain.on('pet:restore', () => sendTo('pet', 'pet:restore'))
  ipcMain.on('pet:introReplay', () => sendTo('pet', 'pet:introReplay'))
  ipcMain.handle('ai:test', () => testAIConnection())
  ipcMain.handle('pet:ask', (_e, q: string) => petAskShort(String(q).slice(0, 200), habitsOfUser()))

  // ── 桌宠流式问答 ──
  ipcMain.handle('pet:askStream', async (_e, q: string) => {
    const s = getSettings()
    const question = String(q).slice(0, 200)
    if (!s.aiStreaming) {
      const answer = await petAskShort(question, habitsOfUser())
      sendTo('pet', 'ai:streamDone', answer)
      return answer
    }
    try {
      const answer = await petAskShortStream(
        question,
        (delta, full) => sendTo('pet', 'ai:streamChunk', { delta, full }),
        habitsOfUser()
      )
      sendTo('pet', 'ai:streamDone', answer)
      return answer
    } catch (e) {
      sendTo('pet', 'ai:streamError', { error: (e as Error).message })
      return '出了点小问题，稍后再问我吧~'
    }
  })

  // ── 模型路由信息（设置页展示当前使用的模型） ──
  ipcMain.handle('ai:models', () => {
    const s = getSettings()
    return {
      fast: s.aiModelFast || s.aiModel,
      standard: s.aiModel,
      complex: s.aiModelComplex || s.aiModel,
      streaming: s.aiStreaming
    }
  })

  ipcMain.on('pet:userSay', (_e, text: string) => sendTo('pet', 'pet:userSay', String(text).slice(0, 200)))
  ipcMain.on('pet:stats', (_e, stats: unknown) => sendTo('main', 'pet:stats', stats))

  // ── VRM 角色上传（L1：用户上传自定义 .vrm 文件） ──
  ipcMain.handle('pet:selectVrm', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      title: '选择 VRM 角色文件',
      filters: [
        { name: 'VRM 角色模型', extensions: ['vrm'] },
        { name: 'glTF 模型', extensions: ['gltf', 'glb'] },
        { name: '所有文件', extensions: ['*'] }
      ],
      properties: ['openFile']
    })
    if (canceled || !filePaths.length) return null
    const srcPath = filePaths[0]
    const destDir = path.join(app.getPath('userData'), 'vrm-custom')
    if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true })
    // 拷贝到 userData 避免源文件被删/移动后失效
    const ext = path.extname(srcPath)
    const destPath = path.join(destDir, `custom-${Date.now()}${ext}`)
    fs.copyFileSync(srcPath, destPath)
    // 写入设置
    setSettings({ petVrmPath: destPath } as Partial<AppSettings>)
    // 通知桌宠窗口重新加载
    sendTo('pet', 'pet:reloadVrm', destPath)
    return destPath
  })

  // ── VRM 角色重置为默认 ──
  ipcMain.handle('pet:resetVrm', async () => {
    setSettings({ petVrmPath: '' } as Partial<AppSettings>)
    sendTo('pet', 'pet:reloadVrm', '')
    return true
  })

  // 问答确认 → 记录反馈 + 维护计划（yes 时），通知计划页刷新
  ipcMain.handle(
    'question:confirm',
    (_e, payload: { qid: string; ctx: string; question: string; answer: 'yes' | 'no'; browserInfo?: { app: string; title: string } }) => {
      const fb = recordFeedback(payload.qid, payload.ctx, payload.question, payload.answer)
      let plan = null
      // 作业链路确认：yes → 保存链路（后续自动识别并气泡提醒）
      if (payload.ctx.startsWith('workchain:')) {
        if (payload.answer === 'yes') {
          saveWorkChain(payload.ctx.slice('workchain:'.length).split('>'))
          bus.setPet({ message: '记住啦，这是你的作业链路~' })
        }
        return { feedback: fb, plan: null }
      }
      if (payload.answer === 'yes') {
        plan = confirmToPlan(payload.ctx, payload.question, payload.browserInfo)
        if (plan) {
          updateIn<UserFeedback>('feedbacks', fb.id, { planItemId: plan.id })
          bus.setPet({ message: '好的，已记录到你的计划中 ✓' })
          sendTo('main', 'plan-updated')
        }
      }
      return { feedback: fb, plan }
    }
  )

  // 浏览器计划匹配确认（问题 7）：用户确认后标记计划并广播刷新
  ipcMain.handle('browser-plan:confirm', (_e, planId: string, answer: 'yes' | 'no') => {
    const plan = col<PlanItem>('plans').find((p) => p.id === planId)
    if (!plan) return null
    if (answer === 'yes') {
      updateIn<PlanItem>('plans', planId, {
        confirmedFromQA: true,
        browserDerived: true,
        note: (plan.note ?? '') + '\n[浏览器确认]'
      })
      bus.setPet({ message: '好的，我会帮你记录这段时间~' })
      sendTo('main', 'plan-updated')
    }
    return plan
  })

  // 计划分类 CRUD（内置 + 自定义）
  ipcMain.handle('categories:list', () => {
    const custom = col<CustomCategory>('categories')
    const customIds = new Set(custom.map((c) => c.id))
    return [...BUILTIN_CATEGORIES.filter((b) => !customIds.has(b.id)), ...custom]
  })
  ipcMain.handle('categories:create', (_e, c: Omit<CustomCategory, 'id' | 'isBuiltIn' | 'ts'>) =>
    insertInto<CustomCategory>('categories', { ...c, id: genId('cat'), isBuiltIn: false, ts: Date.now() })
  )
  ipcMain.handle('categories:update', (_e, c: CustomCategory) => {
    if (c.isBuiltIn) {
      // 内置分类只允许改 stateHints
      return updateIn<CustomCategory>('categories', c.id, { stateHints: c.stateHints })
    }
    return updateIn<CustomCategory>('categories', c.id, c)
  })
  ipcMain.handle('categories:delete', (_e, id: string) => {
    // 已用该分类的计划归入 other
    for (const p of col<PlanItem>('plans').filter((x) => x.category === id)) {
      updateIn<PlanItem>('plans', p.id, { category: 'other' })
    }
    return removeFrom('categories', id)
  })
  // 智能建议：聚合近 N 天主态为 other 的高频应用，供分类页引导自建
  ipcMain.handle('categories:suggestOtherApps', (_e, days = 14) => {
    const shift = (date: string, delta: number) => {
      const [y, m, d] = date.split('-').map(Number)
      return dateKey(new Date(y, m - 1, d + delta, 12).getTime())
    }
    const out: Record<string, number> = {}
    for (let i = 0; i < days; i++) {
      const d = shift(dateKey(Date.now()), -i)
      const trail = buildMergedTrail(listActivities(d), d)
      for (const s of trail.segments) {
        if (s.mainState === 'other' && s.mainApp) out[s.mainApp] = (out[s.mainApp] ?? 0) + s.durationMin
      }
    }
    return Object.entries(out).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([app, min]) => ({ app, min }))
  })
  // AI 分类推断结果（独立表，展示层按 segId 关联）
  ipcMain.handle('inferences:get', (_e, date?: string) => {
    const d = date ?? dateKey(Date.now())
    return col<CategoryInference>('categoryInferences').filter((x) => x.date === d)
  })

  // 计划完成/延期预测（规则引擎）
  ipcMain.handle('plans:forecast', (_e, date?: string) => {
    const day = date ?? dateKey(Date.now())
    const plans = col<PlanItem>('plans').filter((p) => p.date === day && (p.status === 'planned' || p.status === 'in_progress'))
    const trail = buildMergedTrail(listActivities(day), day)
    const keys = Array.from({ length: 7 }, (_, i) => dateKey(Date.now() - (i + 1) * 86400000))
    const historical = keys.map((k) => buildMergedTrail(listActivities(k), k))
    const cats = col<CustomCategory>('categories')
    const nowMin = new Date().getHours() * 60 + new Date().getMinutes()
    return plans.map((p) => forecastPlan(p, trail, historical, nowMin, cats))
  })

  // 拖动完成比例：0 → planned；>0 → in_progress；1 → done（oner 计划同步回写）
  ipcMain.handle('plans:updateProgress', async (_e, id: string, ratio: number) => {
    const r = Math.max(0, Math.min(1, ratio))
    const status: PlanStatus = r >= 1 ? 'done' : r > 0 ? 'in_progress' : 'planned'
    const updated = updateIn<PlanItem>('plans', id, { completionRatio: r, status })
    if (updated && updated.source === 'oner') await onerPushStatus(updated)
    return updated
  })

  // 延期到指定日期：原计划标记 delayed，目标日期生成新计划副本
  ipcMain.handle('plans:delay', async (_e, id: string, targetDate: string, reason?: string) => {
    const plan = col<PlanItem>('plans').find((p) => p.id === id)
    if (!plan || !/^\d{4}-\d{2}-\d{2}$/.test(targetDate)) return null
    const newPlan: PlanItem = {
      ...plan,
      id: genId('plan'),
      date: targetDate,
      status: 'planned',
      completionRatio: 0,
      delayToDate: undefined,
      delayReason: undefined,
      // 不继承外部同步与确认标记：副本是全新的本地计划，
      // extId 留给原计划，避免 oner 增量去重/回写歧义
      extId: undefined,
      confirmedFromQA: undefined,
      browserDerived: undefined,
      confirmContext: undefined,
      source: 'manual',
      note: `延期自 ${plan.date}${reason ? `，原因：${reason}` : ''}`,
      ts: Date.now()
    }
    insertInto('plans', newPlan)
    const updated = updateIn<PlanItem>('plans', id, { status: 'delayed', delayToDate: targetDate, delayReason: reason })
    if (updated && updated.source === 'oner') await onerPushStatus(updated)
    sendTo('main', 'plan-updated')
    return { newPlan }
  })
  ipcMain.on('page-switch', () => {
    if (getSettings().suppressTransitionOnPageSwitch) sendTo('pet', 'page-switch')
  })

  // 会议模式应用：stealth 隐藏/恢复窗口；pet 侧同步免打扰/辅助；辅助模式结束自动补一条会议记录
  ipcMain.on('meeting:apply', (_e, payload: { mode: 'stealth' | 'quiet' | 'assist'; active: boolean; sinceTs?: number }) => {
    if (payload.mode === 'stealth') {
      if (payload.active) {
        if (petWindow && !petWindow.isDestroyed()) petWindow.hide()
        if (widgetWindow && !widgetWindow.isDestroyed()) widgetWindow.hide()
      } else {
        if (petWindow && !petWindow.isDestroyed()) petWindow.show()
        if (widgetWindow && !widgetWindow.isDestroyed()) widgetWindow.show()
        bus.setPet({ message: '会议结束啦！辛苦辛苦~' })
      }
    }
    if (!payload.active && payload.mode === 'assist' && payload.sinceTs) {
      const start = new Date(payload.sinceTs)
      const end = new Date()
      const startMin = start.getHours() * 60 + start.getMinutes()
      const endMin = end.getHours() * 60 + end.getMinutes()
      insertInto<TimeEntry>('entries', {
        id: genId('entry'),
        date: dateKey(payload.sinceTs),
        startMin,
        endMin: Math.max(startMin + 5, endMin),
        title: '会议',
        state: 'meeting',
        source: 'monitor',
        ts: Date.now()
      })
      bus.setPet({ message: `会议结束，${Math.round((endMin - startMin))} 分钟。需要我整理纪要吗？` })
    }
    sendTo('pet', 'pet:meeting', payload)
  })
  // 点击桌宠加好感：每 10 次亲密度 +1（上限 5），并小幅提升愉悦度
  let affectionClicks = 0
  ipcMain.handle('pet:affection', () => {
    affectionClicks++
    const patch: Partial<PetState> = {}
    if (affectionClicks >= 10 && bus.pet.intimacy < 5) {
      affectionClicks = 0
      patch.intimacy = bus.pet.intimacy + 1
    }
    const p = bus.pet.emotion.pleasure
    patch.emotion = { ...bus.pet.emotion, pleasure: Math.min(1, p + 0.03) }
    return bus.setPet(patch)
  })

  // ── 窗口 ──
  ipcMain.on('win:minimize', () => mainWindow?.minimize())
  ipcMain.on('win:maximize', () => {
    if (!mainWindow) return
    if (mainWindow.isMaximized()) mainWindow.unmaximize()
    else mainWindow.maximize()
  })
  ipcMain.on('win:close', () => mainWindow?.hide())
  ipcMain.on('win:toggleWidget', () => toggleWidget())
  ipcMain.on('win:togglePet', () => togglePet())
  ipcMain.on('win:openMain', () => createMainWindow())
  ipcMain.on('widget:opacity', (_e, v: number) => {
    if (widgetWindow && !widgetWindow.isDestroyed()) widgetWindow.setOpacity(v)
  })
  ipcMain.on('widget:penetration', (_e, v: boolean) => {
    if (widgetWindow && !widgetWindow.isDestroyed()) {
      widgetWindow.setIgnoreMouseEvents(v, v ? { forward: true } : undefined)
    }
  })
  ipcMain.on('widget:resize', (_e, w: number, h: number) => {
    if (widgetWindow && !widgetWindow.isDestroyed()) {
      const [x, y] = widgetWindow.getPosition()
      const [, curH] = widgetWindow.getSize()
      widgetWindow.setSize(w, h)
      const wa = screen.getPrimaryDisplay().workArea
      const ny = Math.min(Math.max(y + curH - h, wa.y), Math.max(wa.y, wa.y + wa.height - h))
      const nx = Math.min(Math.max(x, wa.x), Math.max(wa.x, wa.x + wa.width - w))
      widgetWindow.setPosition(Math.round(nx), Math.round(ny))
    }
  })
  ipcMain.on('widget:drag', (_e, dx: number, dy: number) => {
    if (widgetWindow && !widgetWindow.isDestroyed()) {
      const [x, y] = widgetWindow.getPosition()
      const [w, h] = widgetWindow.getSize()
      const wa = screen.getPrimaryDisplay().workArea
      const nx = Math.min(Math.max(x + dx, wa.x), Math.max(wa.x, wa.x + wa.width - w))
      const ny = Math.min(Math.max(y + dy, wa.y), Math.max(wa.y, wa.y + wa.height - h))
      widgetWindow.setPosition(Math.round(nx), Math.round(ny))
    }
  })

  // ── OCR 资源管理 ──
  ipcMain.handle('ocr:stats', () => getOcrStorageStats())
  ipcMain.handle('ocr:clear', (_e, keepRecentDays?: number) => clearOcrCache(keepRecentDays ?? 7))

  // ── UIAutomation 深度模式 ──
  ipcMain.handle('uia:getFocused', async () => {
    const { getFocusedElement } = await import('./uia')
    return getFocusedElement()
  })
  ipcMain.handle('uia:getTree', async () => {
    const { getForegroundUITree } = await import('./uia')
    return getForegroundUITree()
  })

  // ── 隐私痕迹统计（近 14 天，按应用聚合） ──
  ipcMain.handle('privacy:stats', () => {
    const excluded = getSettings().privacyExcludedApps ?? []
    // 条目 → 应用匹配：别名（进程名）包含匹配 + 条目名精确匹配（避免条目自指导致全行误判）
    const matchExcluded = (app: string, entry: string): boolean => {
      const key = entry.trim()
      if (!key) return false
      const aliases = PRIVACY_ALIASES[key] ?? PRIVACY_ALIASES[key.toLowerCase()] ?? []
      const base = app.toLowerCase()
      if (base === key.toLowerCase()) return true
      return aliases.some((t) => (t.length <= 3 ? base === t : base.includes(t)))
    }
    const since = Date.now() - 14 * 86400000
    const acts = listActivitiesRange(since, Date.now())
    const byApp = new Map<string, { count: number; lastTs: number }>()
    for (const a of acts) {
      const key = a.appName || a.app
      if (!key) continue
      const cur = byApp.get(key) ?? { count: 0, lastTs: 0 }
      cur.count++
      cur.lastTs = Math.max(cur.lastTs, a.ts)
      byApp.set(key, cur)
    }
    return [...byApp.entries()]
      .map(([app, v]) => ({ app, count: v.count, lastTs: v.lastTs, excluded: excluded.some((e) => matchExcluded(app, e)) }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 20)
  })

  // ── 隐私：按应用清理活动记录（一键清理） ──
  ipcMain.handle('privacy:clearApp', (_e, appName: string) => {
    const removed = deleteActivitiesByApp(String(appName))
    console.log(`[privacy] 已清理应用「${appName}」的 ${removed} 条活动记录`)
    return { removed }
  })

  // ── AI 提示词三层上下文（调试用） ──
  ipcMain.handle('ai:promptLayers', () => {
    const ana = latestAnalysis(dateKey(Date.now()))
    const habits = habitsOfUser()
    return {
      layer1: { title: 'Layer 1 · 每日事实（当日工作数据）', data: aggregateFacts(todayTrail()) },
      layer2: { title: 'Layer 2 · 用户习惯（近 7 天画像）', data: habits ?? { hint: '数据不足 3 天，暂未生成习惯画像' } },
      layer3: { title: 'Layer 3 · 人格适配（System Prompt）', data: buildSystemPrompt(ana, habits, bus.pet.intimacy) }
    }
  })

  // ── 用户画像摘要（近 14 天活动聚合，与报表同源） ──
  ipcMain.handle('profile:get', () => {    const FOCUS_STATES = new Set(['focus', 'coding', 'writing', 'aiqa', 'aidev', 'remote'])
    const SLACK_STATES = new Set(['slack', 'relax'])
    const WEEK = ['日', '一', '二', '三', '四', '五', '六']
    const since = Date.now() - 14 * 86400000
    const acts = listActivitiesRange(since, Date.now())
    const days = [...new Set(acts.map((a) => dateKey(a.ts)))].sort()
    let focusMin = 0
    const focusByWeek: number[] = [0, 0, 0, 0, 0, 0, 0]
    const focusWeekDays: number[] = [0, 0, 0, 0, 0, 0, 0]
    const slackByWeek: number[] = [0, 0, 0, 0, 0, 0, 0]
    const slackWeekDays: number[] = [0, 0, 0, 0, 0, 0, 0]
    const appMin = new Map<string, number>()
    let longestFocusMin = 0
    let longestFocusDate: string | null = null
    let totalSegMin = 0
    for (const d of days) {
      const trail = buildMergedTrail(listActivities(d), d)
      const wd = new Date(`${d}T00:00:00`).getDay()
      let dayFocus = 0
      let daySlack = 0
      for (const [st, min] of Object.entries(trail.stateMinutes)) {
        if (FOCUS_STATES.has(st)) dayFocus += min
        if (SLACK_STATES.has(st)) daySlack += min
      }
      focusMin += dayFocus
      if (dayFocus > 0) {
        focusByWeek[wd] += dayFocus
        focusWeekDays[wd]++
      }
      if (daySlack > 0) {
        slackByWeek[wd] += daySlack
        slackWeekDays[wd]++
      }
      for (const seg of trail.segments) {
        if (!seg.mainApp) continue
        appMin.set(seg.mainApp, (appMin.get(seg.mainApp) ?? 0) + seg.durationMin)
        totalSegMin += seg.durationMin
        if (FOCUS_STATES.has(seg.mainState) && seg.durationMin > longestFocusMin) {
          longestFocusMin = seg.durationMin
          longestFocusDate = d
        }
      }
    }
    const bestWeek = (arr: number[], cnt: number[]): { label: string | null; avg: number } => {
      let best = -1
      let bestAvg = 0
      for (let i = 0; i < 7; i++) {
        const avg = cnt[i] > 0 ? arr[i] / cnt[i] : 0
        if (avg > bestAvg) {
          bestAvg = avg
          best = i
        }
      }
      return best < 0 ? { label: null, avg: 0 } : { label: `周${WEEK[best]}`, avg: bestAvg }
    }
    const bf = bestWeek(focusByWeek, focusWeekDays)
    const bs = bestWeek(slackByWeek, slackWeekDays)
    const topApps = [...appMin.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([name, min]) => ({ name, pct: totalSegMin > 0 ? Math.round((min / totalSegMin) * 100) : 0 }))
    return {
      monitorDays: days.length,
      focusMin: Math.round(focusMin),
      bestFocusDay: bf.label,
      bestFocusDayMin: Math.round(bf.avg),
      topSlackDay: bs.label,
      topSlackDayMin: Math.round(bs.avg),
      longestFocusMin: Math.round(longestFocusMin),
      longestFocusDate,
      topApps
    }
  })

  // ── 用户习惯画像（日历分析背景带等使用） ──
  ipcMain.handle('habits:get', () => habitsOfUser())

  // ── oner ──
  ipcMain.handle('oner:sync', () => onerPull())

  // ── 轻问诊手动触发（调试用） ──
  ipcMain.handle('question:gen', (_e, ctx: string) => {
    const q = genQuestion(ctx)
    if (q) bus.setQuestion({ ...q, ts: Date.now() })
    return q
  })

  // ── 反馈列表 ──
  ipcMain.handle('feedbacks:list', () => col<UserFeedback>('feedbacks'))

  // ── v2.6 注意力评分 ──
  ipcMain.handle('attention:today', () => todayScore())
  ipcMain.handle('attention:range', (_e, days: number) => recentScores(Number(days) || 7))
  ipcMain.handle('attention:setUserType', (_e, type: UserType) => {
    setSettings({ userType: type })
    return todayScore() // 权重随类型变化，重算今日
  })
  ipcMain.handle('attention:strategy', () => getScoreStrategy())

  // ── v2.6.1 作业链路 ──
  ipcMain.handle('chain:today', () => todayChains())
  ipcMain.handle('chain:day', (_e, date: string) => analyzeDayChains(String(date)))

  // ── v2.6 成就（未解锁的定义也返回，前端展示灰锁） ──
  ipcMain.handle('achievements:list', () => {
    const unlocked = col<Achievement>('achievements')
    return ACHIEVEMENT_DEFS.map((d) => unlocked.find((u) => u.id === d.id) ?? d)
  })

  // ── v2.7 用户画像 ──
  ipcMain.handle('persona:get', () => getPersona())
  ipcMain.handle('persona:refresh', () => refreshPersona())
  ipcMain.handle('persona:update', (_e, path: string, value: unknown) => updatePersonaField(String(path), value))
  ipcMain.handle('persona:confirm', (_e, path: string) => confirmPersonaField(String(path)))
  ipcMain.handle('persona:removeTag', (_e, kind: 'interest' | 'skill', name: string) => removePersonaTag(kind, String(name)))
  ipcMain.handle('persona:setPrivacy', (_e, patch: Partial<{ L0: boolean; L1: boolean; L2: boolean; L3: boolean }>) =>
    setPersonaPrivacy(patch))
  ipcMain.handle('persona:export', async () => {
    const { canceled, filePath } = await dialog.showSaveDialog({
      title: '导出用户画像',
      defaultPath: `workon-persona-${dateKey(Date.now()).replace(/-/g, '')}.json`,
      filters: [{ name: 'JSON', extensions: ['json'] }]
    })
    if (canceled || !filePath) return null // 用户取消
    fs.writeFileSync(filePath, JSON.stringify(exportPersona(), null, 2), 'utf-8')
    return filePath
  })

  // ── v2.7 AI 访问日志 ──
  ipcMain.handle('accessLogs:list', (_e, days?: number) => listAccessLogs(days ?? 30))
  ipcMain.handle('accessLogs:clear', () => clearAccessLogs())

  // ── v2.9 报表基础能力层 ──
  ipcMain.handle('report:generate', (_e, date: string, templateId?: string, enableAI?: boolean) =>
    generateReport(date, templateId, enableAI))
  ipcMain.handle('report:generateWeek', (_e, startDate: string, templateId?: string, enableAI?: boolean) =>
    generateWeeklyReport(startDate, templateId, enableAI))
  ipcMain.handle('report:templates', () => listTemplates())
  ipcMain.handle('report:saveTemplate', (_e, t: ReportTemplate) => {
    // 预置模板不落库（内置定义即真相）
    if (t.id && t.id.startsWith('preset-')) return t
    if (t.id) return updateIn<ReportTemplate>('reportTemplates', t.id, t)
    return insertInto<ReportTemplate>('reportTemplates', { ...t, id: genId('tpl') })
  })
  ipcMain.handle('report:removeTemplate', (_e, id: string) => {
    if (String(id).startsWith('preset-')) return false // 预置模板不可删
    return removeFrom('reportTemplates', String(id))
  })
  ipcMain.handle('report:setDefault', (_e, id: string) => {
    // 清其他 isDefault，置该条（预置模板无需落库，前端按 id 记即可）
    for (const t of col<ReportTemplate>('reportTemplates')) {
      if (t.isDefault && t.id !== id) updateIn<ReportTemplate>('reportTemplates', t.id, { isDefault: false })
    }
    if (String(id).startsWith('preset-')) return true
    return updateIn<ReportTemplate>('reportTemplates', String(id), { isDefault: true })
  })
  // 条目确认：条目是即时生成的、不做持久化；确认只在前端当次视图生效。
  // 这里仅累计模板 userCorrections（模板匹配质量学习信号，条目级学习留后续迭代）
  ipcMain.handle('report:confirmEntry', (_e, _date: string, _entryId: string, _patch: unknown, templateId?: string) => {
    if (templateId && !String(templateId).startsWith('preset-')) {
      const t = col<ReportTemplate>('reportTemplates').find((x) => x.id === templateId)
      if (t) return updateIn<ReportTemplate>('reportTemplates', t.id, { userCorrections: t.userCorrections + 1 })
    }
    return null
  })
  // v2.8 AI 模板解析：解析失败/AI 未开启返回 null，前端提示「需要开启 AI 模式」
  ipcMain.handle('report:parseTemplate', (_e, raw: string) => parseUserTemplate(String(raw ?? '')))

  // ── Function Calling：可用工具列表（设置页 / 调试用） ──
  ipcMain.handle('ai:tools', () => {
    // 动态导入避免循环依赖
    return import('./tools').then(({ WORKON_TOOLS }) =>
      WORKON_TOOLS.map((t) => ({ name: t.function.name, description: t.function.description }))
    )
  })

  // ── v3.0 文件夹 ingestion ──
  ipcMain.handle('folders:get', () => getWatchDirs())
  ipcMain.handle('folders:set', (_e, dirs: string[]) => { updateFolders(dirs); return getWatchDirs() })
  ipcMain.handle('folders:scan', async () => {
    const dirs = getWatchDirs()
    if (dirs.length === 0) return []
    return scanFolders(dirs, undefined, (pct, file) => {
      sendTo('main', 'folders:scanProgress', { pct, file })
    })
  })
  ipcMain.handle('folders:select', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory', 'multiSelections']
    })
    return result.canceled ? [] : result.filePaths
  })
}
