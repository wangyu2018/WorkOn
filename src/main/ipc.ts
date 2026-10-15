/**
 * IPC 注册：window.api 的全部通道
 */
import { ipcMain, dialog, app, clipboard } from 'electron'
import { getLoadStatus, startLoadGuard, stopLoadGuard, isLoadGuardEngaged } from './loadGuard'
import { getAiAssistPace } from './aiAssistWatch'
import { getActiveEngine } from './ocrEngine'
import { getWinInfoSleepMs } from './winInfo'
import fs from 'fs'
import path from 'path'
import type {
  AppSettings,
  PlanItem,
  TimeEntry,
  UserFeedback,
  CorrectionRule,
  ActivityCorrection,
  PetState,
  PlanStatus,
  ReportEntryPatch,
  KnowledgeItem,
  KnowledgeLink,
  MemoRecord, ProjectTask } from '@shared/types'
import { genId } from '@shared/types'
import { dateKey, buildMergedTrail } from '@shared/trail'
import { planVsActual, forecastPlan, BUILTIN_CATEGORIES } from '@shared/planAnalysis'
import { getSettings, setSettings } from './settings'
import { getWeather, getWeatherNextHours, getWeatherBrief } from './weather'
import { getAllAppVisuals } from './appVisuals'
import { buildDevDataset, buildDevOcrBatch, buildDevPrompts } from './devOcr'
import {
  listProjects, saveProject, removeProject, listTasks, saveTask, removeTask,
  aiBreakdown, linkAppToProject, projectLinkedApps, projectTimeForTrail, projectLinks, dayProjectLinks,
  aiSchedule, aiReview, aiDevAdvice
} from './projects'
import {
  col, insertInto, updateIn, removeFrom, listActivities, listActivitiesRange, deleteActivitiesByApp,
  listRecentRecognitionLogs,
  updateActivityTitleByStartTs
} from './db'
import { presence } from './presence'
import { getFocusChainState } from './focusChain'
import { registerNotifyIpc, pushNotify } from './notify'
import { listAutomations, saveAutomation, removeAutomation, toggleAutomation, automationMinuteTick } from './automation'
import { starGraphForDays } from './starGraph'
import { attributionTick, getAttribution, listBindings, bindProject, unbindProject, setBinding, answerAttribution } from './attributions'
import { startAllWatchers, getTodayActivity, stalledProjects, dirWatcherTick } from './dirWatcher'
import { buildStatusCard, parseStatusCard, applyCardDiff, summarizeProgressPaste } from './statusCard'
import { classifyPaste } from '@shared/pasteDetect'
import { extractAndPolishPasteTodos } from './pasteTodos'
import { recognizePngBuffer } from './ocrEngine'
import { dedupeSessionBurstPlans } from './devSession'
import {
  getOpenProcessDraft,
  appendProcessNote,
  suggestNoteCategory,
  ensureProjectCategory,
  buildProcessMergePreview,
  confirmProcessSediment
} from './processDraft'
import { listGoalViews, createGoal, updateGoal, removeGoal, decomposeGoal } from './lifeGoal'
import { bus } from './state'
import { emitPetIntent } from './petIntent'
import {
  analyzeDay, askWithContext, askWithContextStream, recordFeedback, genQuestion,
  generateTodos, generateTips, testAIConnection, petAskShort, petAskShortStream, confirmToPlan, matchBrowserToPlan, deriveHabits,
  aggregateFacts, buildSystemPrompt, selectModel
} from './ai'
import { onerPull, onerPushStatus, startOnerAutoSync } from './oner'
import { restartMonitor, PRIVACY_ALIASES, getMonitorPerf } from './monitor'
import { startInputProbe, stopInputProbe } from './recognition/inputProbe'
import { startIntegration } from './integration'
import { getOcrStorageStats, clearOcrCache } from './ocr'
import { startOcr, stopOcr } from './ocrWorker'
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
  mainWindow, widgetWindow, petWindow, toggleWidget, togglePet, setWidgetPenetration,
  setWidgetMode, resizeWidget, resizeWidgetTransient, moveWidgetBy, beginWidgetDrag, endWidgetDrag,
  setWidgetHit, broadcastWidgetSettings, broadcast,
  setPetIgnoreMouse, setPetModal, createMainWindow, createPetWindow, closePetWindow, sendTo,
  toggleTodoWidget, createTodoWidgetWindow, setTodoWidgetLayer, setTodoWidgetPenetration,
  setWidgetOnTop, setPetOpacity, todoWidgetWindow,
  setTodoWidgetCollapsed, applyTodoWidgetGlass, applyTodoWidgetChrome,
  applyTodoDesktopPin, applyWidgetDesktopPin, applyAppearanceToOverlays, applyWidgetOpacity
} from './windows'
import type { UserAnalysis, MergedTrail, CustomCategory, UserHabits, Achievement, UserType, ReportTemplate, CategoryInference, SegmentPlanLink, Project } from '@shared/types'
import { generateReport, generateWeeklyReport } from './report/engine'
import { screenContextForWindow } from './report/ocrCollector'
import {
  listMotions, getMotionData, saveMotion, removeMotion, setMotionCost, redeemMotion,
  getPoints, addPoints
} from './motions'
import { createMotionWindow } from './windows'
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
    // 用户手动改帧率档位 → 硬件分级停止自动接管档位
    if (patch.petFpsTier !== undefined) setSettings({ petFpsTierAuto: false })
    // 信号层开关即时生效（v10）
    if (patch.messageWatchEnabled !== undefined) {
      void import('./messageWatch').then((m) => (patch.messageWatchEnabled ? m.startMessageWatch() : m.stopMessageWatch()))
    }
    if (patch.musicWatchEnabled !== undefined) {
      void import('./musicWatch').then((m) => (patch.musicWatchEnabled ? m.startMusicWatch() : m.stopMusicWatch()))
    }
    // 行为探针开关即时生效
    if (patch.inputProbeEnabled !== undefined) {
      if (patch.inputProbeEnabled) startInputProbe()
      else stopInputProbe()
    }
    // 性能模式开关：即时启停屏幕 OCR 采集（最大 CPU 来源），并重启监控应用门控
    if (patch.performanceMode !== undefined) {
      if (patch.performanceMode) stopOcr()
      else if (getSettings().deepMode) startOcr()
      restartMonitor()
    }
    // 忙时轻档开关：关 = 立即恢复节奏
    if (patch.loadGuardEnabled !== undefined) {
      if (patch.loadGuardEnabled) startLoadGuard()
      else stopLoadGuard()
    }
    if (patch.monitorInterval || patch.monitorSmart !== undefined) restartMonitor()
    if (patch.deepMode !== undefined) restartMonitor()
    if (patch.wsEnabled !== undefined || patch.wsPort) startIntegration()
    if (patch.onerAutoSyncMin !== undefined || patch.onerToken !== undefined || patch.onerEndpoint !== undefined) startOnerAutoSync()
    if (patch.petCharacter) bus.setPet({ characterId: patch.petCharacter })
    if (patch.widgetOpacity !== undefined) applyWidgetOpacity()
    if (patch.widgetPenetration !== undefined) {
      setWidgetPenetration(patch.widgetPenetration)
      refreshTray()
    }
    if (patch.widgetAccent !== undefined) {
      sendTo('widget', 'widget:accent', patch.widgetAccent)
    }
    if (patch.widgetOnTop !== undefined && widgetWindow && !widgetWindow.isDestroyed() && !next.widgetDesktopPin) {
      const docked = next.widgetMode === 'mini' && !!next.widgetDockEdge
      if (!docked) widgetWindow.setAlwaysOnTop(next.widgetOnTop, next.widgetOnTop ? 'screen-saver' : 'floating')
    }
    if (patch.widgetDockOnTop !== undefined && widgetWindow && !widgetWindow.isDestroyed() && !next.widgetDesktopPin) {
      const docked = next.widgetMode === 'mini' && !!next.widgetDockEdge
      if (docked) widgetWindow.setAlwaysOnTop(next.widgetDockOnTop !== false, next.widgetDockOnTop !== false ? 'screen-saver' : 'floating')
    }
    // 浮窗显示项 / 穿透 / 紧凑：热同步到 widget 渲染层
    if (
      patch.widgetDisplay !== undefined ||
      patch.widgetPenetration !== undefined ||
      patch.widgetCompact !== undefined ||
      patch.widgetOpacity !== undefined ||
      patch.widgetDockOnTop !== undefined ||
      patch.widgetDockEdge !== undefined ||
      patch.aiAssistWatchEnabled !== undefined ||
      patch.aiAssistWatchApps !== undefined
    ) {
      broadcastWidgetSettings()
    }
    if (patch.widgetMode !== undefined) {
      setWidgetMode(next.widgetMode === 'compact' ? 'full' : next.widgetMode)
    } else if (patch.widgetDockEdge !== undefined && next.widgetMode === 'mini') {
      // 仅清吸附 / 改边：重走 setWidgetMode(mini) 应用尺寸
      setWidgetMode('mini')
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
      // 主窗/settings 变更广播：v10 表面 aiOn 等状态靠挂载时读一次，跨窗修改后各渲染端状态会僵
      sendTo('main', 'settings:update', { aiEnabled: next.aiEnabled, aiModel: next.aiModel, aiBaseUrl: next.aiBaseUrl })
      if (patch.aiStreaming !== undefined) sendTo('pet', 'pet:settings', { aiStreaming: next.aiStreaming })
      sendTo('pet', 'pet:settings', {
        petScale: next.petScale,
        petRoam: next.petRoam,
        petFpsTier: next.petFpsTier,
        petInteractions: next.petInteractions,
        petReturnMin: next.petReturnMin
      })
    }
    // ── 悬浮面运行时属性（透明度/穿透/顶层）：设置驱动统一应用 ──
    if (patch.widgetOpacity !== undefined) applyWidgetOpacity()
    // widgetOnTop / widgetDockOnTop 已在上方按是否吸附分支处理
    if (patch.todoWidgetOpacity !== undefined && todoWidgetWindow && !todoWidgetWindow.isDestroyed()) {
      todoWidgetWindow.setOpacity(1)
      sendTo('todoWidget', 'todoWidget:content-opacity', next.todoWidgetOpacity)
    }
    if (patch.todoWidgetPenetration !== undefined) setTodoWidgetPenetration(next.todoWidgetPenetration)
    if (patch.todoWidgetOnTop !== undefined && !next.todoWidgetDesktopPin) setTodoWidgetLayer(next.todoWidgetOnTop)
    if (patch.todoWidgetVisible !== undefined) {
      if (next.todoWidgetVisible) {
        const tw = createTodoWidgetWindow()
        if (tw && !tw.isDestroyed()) tw.show()
      } else if (todoWidgetWindow && !todoWidgetWindow.isDestroyed()) {
        todoWidgetWindow.hide()
      }
      refreshTray()
    }
    if (patch.todoWidgetCollapsed !== undefined) setTodoWidgetCollapsed(!!next.todoWidgetCollapsed)
    if (
      patch.overlayGlass !== undefined ||
      patch.todoWidgetOpacity !== undefined
    ) {
      applyTodoWidgetGlass(!!next.overlayGlass)
      applyTodoWidgetChrome()
    }
    if (patch.todoWidgetDesktopPin !== undefined) applyTodoDesktopPin()
    if (patch.widgetDesktopPin !== undefined) applyWidgetDesktopPin()
    if (patch.appearanceMode !== undefined || patch.darkTone !== undefined) {
      applyAppearanceToOverlays()
    }
    if (patch.petOpacity !== undefined && petWindow && !petWindow.isDestroyed()) petWindow.setOpacity(next.petOpacity)
    return next
  })

  // ── 实时状态 ──
  ipcMain.handle('presence:get', () => presence.getSnapshot())
  ipcMain.handle('chain:get', () => getFocusChainState())
  // ── 归属引擎 / 目录监控 / 状态卡（v7 项目循环） ──
  ipcMain.handle('attr:get', () => getAttribution())
  ipcMain.handle('attr:bindings', () => listBindings())
  ipcMain.handle('attr:bind', (_e, projectId: string, patch: { apps?: string[]; keywords?: string[]; dirs?: string[] }) => {
    const r = bindProject(String(projectId), patch ?? {})
    startAllWatchers()
    return r
  })
  ipcMain.handle('attr:unbind', (_e, projectId: string) => {
    unbindProject(String(projectId))
    startAllWatchers()
  })
  ipcMain.handle('attr:bindSet', (_e, projectId: string, next: { apps?: string[]; keywords?: string[]; dirs?: string[] }) => {
    setBinding(String(projectId), next ?? {})
    startAllWatchers()
  })
  ipcMain.handle('attr:answer', (_e, fp: string, answer: string, payload: { projectId?: string; projectName?: string; apps?: string[] }) =>
    answerAttribution(String(fp), String(answer), payload ?? {})
  )
  ipcMain.handle('attr:todayActivity', (_e, projectId: string) => getTodayActivity(String(projectId)))
  ipcMain.handle('attr:stalled', (_e, days: number) => stalledProjects(Number(days) || 3))
  ipcMain.handle('statuscard:build', (_e, projectId: string) => buildStatusCard(String(projectId)))
  ipcMain.handle('statuscard:parse', (_e, md: string) => parseStatusCard(String(md)))
  ipcMain.handle('statuscard:apply', (_e, diff) => applyCardDiff(diff))
  ipcMain.handle('statuscard:summarize', async (_e, projectId: string, text: string) =>
    summarizeProgressPaste(String(projectId), String(text ?? ''))
  )

  // ── 粘贴分拣 / OCR ──
  ipcMain.handle('clipboard:write', (_e, text: string) => {
    clipboard.writeText(String(text ?? ''))
    return true
  })
  ipcMain.handle('clipboard:peek', () => {
    const text = clipboard.readText() ?? ''
    let hasImage = false
    let imagePngBase64: string | null = null
    try {
      const img = clipboard.readImage()
      if (img && !img.isEmpty()) {
        hasImage = true
        imagePngBase64 = img.toPNG().toString('base64')
      }
    } catch { /* ignore */ }
    const kind = classifyPaste(text, { fromImage: hasImage })
    return { text, hasImage, imagePngBase64, kind }
  })
  ipcMain.handle('ocr:recognizePng', async (_e, b64: string) => {
    try {
      const raw = String(b64 ?? '').replace(/^data:image\/\w+;base64,/, '')
      const buf = Buffer.from(raw, 'base64')
      if (!buf.length) return { text: '', ok: false, error: '空图片' }
      const r = await recognizePngBuffer(buf)
      const text = (r.text ?? '').trim()
      return {
        text,
        ok: !!text,
        kind: classifyPaste(text, { fromImage: true }),
        engine: r.engine,
        error: text ? undefined : (r.error || '未识别到文字')
      }
    } catch (e) {
      return { text: '', ok: false, error: (e as Error).message }
    }
  })
  ipcMain.handle('paste:extractTodos', async (_e, text: string) =>
    extractAndPolishPasteTodos(String(text ?? ''))
  )
  ipcMain.handle('plans:dedupeBurst', () => dedupeSessionBurstPlans())

  // ── 待办树小组件 ──
  ipcMain.handle('todoWidget:toggle', () => toggleTodoWidget())
  ipcMain.handle('todoWidget:layer', (_e, onTop: boolean) => setTodoWidgetLayer(!!onTop))
  ipcMain.handle('todoWidget:setCollapsed', (_e, v: boolean) => {
    setTodoWidgetCollapsed(!!v)
    return { ok: true, collapsed: !!v }
  })
  ipcMain.handle('todoWidget:applyPin', () => applyTodoDesktopPin())
  ipcMain.handle('widget:applyPin', () => applyWidgetDesktopPin())
  // ── MotionLab 自动化（v7） ──
  ipcMain.handle('automations:list', () => listAutomations())
  ipcMain.handle('automations:save', (_e, rule) => saveAutomation(rule))
  ipcMain.handle('automations:remove', (_e, id: string) => removeAutomation(String(id)))
  ipcMain.handle('automations:toggle', (_e, id: string, enabled: boolean) => toggleAutomation(String(id), !!enabled))
  // 分钟级调度由 monitor tick 驱动，这里兜底一个独立定时器（设置页测试触发用）
  setInterval(() => automationMinuteTick(), 60_000).unref()
  // ── 星图逻辑层（v6）：应用关系图 ──
  ipcMain.handle('star:graph', (_e, days?: number) => starGraphForDays(Number(days) || 7))
  registerNotifyIpc((view) => {
    createMainWindow()
    if (view) setTimeout(() => sendTo('main', 'nav:view', view), 600)
  })
  ipcMain.handle('recognition:recent', () => listRecentRecognitionLogs(20))
  ipcMain.handle('desktop:get', () => bus.desktopState())

  // ── 天气（wttr.in，按城市名查询，本地维护城市）──
  ipcMain.handle('weather:get', (_e, city?: string) => getWeather(city))
  ipcMain.handle('weather:next', (_e, hours: number, city?: string) => getWeatherNextHours(city, hours))
  ipcMain.handle('weather:exportBrief', async (_e, city?: string) => {
    const target = city || getSettings().city
    const [now, brief, next] = await Promise.all([
      getWeather(target),
      getWeatherBrief(target),
      getWeatherNextHours(target, 12)
    ])
    const payload = {
      exportedAt: Date.now(),
      city: target,
      now,
      brief,
      nextHours: next
    }
    try {
      const dir = app.getPath('userData')
      const file = path.join(dir, 'weather-export.json')
      fs.writeFileSync(file, JSON.stringify(payload, null, 2), 'utf8')
      return { ok: true, file, data: payload }
    } catch (e) {
      return { ok: false, error: (e as Error).message, data: payload }
    }
  })

  // ── 轨迹 ──
  // 统计页逐天拉 trail；过去日期聚合结果不可变 → 会话内永久缓存，今天带 TTL。
  // 172k 条活动下，命中缓存 = 内存返回，未命中才重聚合。
  const trailCache = new Map<string, { data: unknown; ts: number }>()
  const TRAIL_TODAY_TTL_MS = 8000
  const invalidateTrail = (date: string): void => { trailCache.delete(date) }
  ipcMain.handle('trail:get', (_e, date?: string) => {
    const d = date ?? dateKey(Date.now())
    const today = dateKey(Date.now())
    const hit = trailCache.get(d)
    if (hit && (d !== today || Date.now() - hit.ts < TRAIL_TODAY_TTL_MS)) return hit.data
    const aggStart = Date.now()
    const data = buildMergedTrail(listActivities(d), d)
    const aggMs = Date.now() - aggStart
    if (aggMs > 80) console.warn(`[trail] 慢聚合 ${d}: ${aggMs}ms`)
    if (trailCache.size >= 120) trailCache.delete(trailCache.keys().next().value as string)
    trailCache.set(d, { data, ts: Date.now() })
    return data
  })
  ipcMain.handle('appVisuals:get', () => getAllAppVisuals())
  ipcMain.handle('trail:update', (_e, startTs: number, patch: { title?: string }) => {
    if (patch.title === undefined) return { success: false }
    const updated = updateActivityTitleByStartTs(startTs, patch.title)
    if (updated) invalidateTrail(dateKey(startTs))
    return updated ? { success: true } : { success: false }
  })

  ipcMain.handle('trail:assignPlan', (_e, segStartTs: number, planId: string | null, app?: string) => {
    const date = dateKey(segStartTs)
    const id = `${date}:${segStartTs}:${app ?? ''}`
    if (planId) {
      const existing = col<SegmentPlanLink>('segmentPlans').find((x) => x.id === id)
      if (existing) updateIn<SegmentPlanLink>('segmentPlans', id, { planId })
      else insertInto<SegmentPlanLink>('segmentPlans', { id, date, segStartTs, planId, ts: Date.now() })
    } else {
      removeFrom('segmentPlans', id)
    }
    invalidateTrail(date)
    return { success: true }
  })
  ipcMain.handle('trail:getSegmentPlans', (_e, date?: string) => {
    const d = date ?? dateKey(Date.now())
    return col<SegmentPlanLink>('segmentPlans').filter((x) => x.date === d).map((x) => ({ segStartTs: x.segStartTs, planId: x.planId }))
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
    if (!date) return all
    const today = dateKey(Date.now())
    if (date !== today) return all.filter((p) => p.date === date)
    // 今日视图顺延：近 3 天内未完成的待办自动累加进来（带 carried 标记，不落库）
    const cutoff = dateKey(Date.now() - 3 * 86400000)
    const own = all.filter((p) => p.date === today && !p.archived)
    const carried = all
      .filter((p) => p.date < today && p.date >= cutoff)
      .filter((p) => !p.archived && p.status !== 'cancelled' && p.status !== 'done' && p.status !== 'delayed')
      .map((p) => ({ ...p, carried: true, carriedFrom: p.date }))
      .sort((a, b) => (b.carriedFrom ?? '').localeCompare(a.carriedFrom ?? ''))
    return [...own, ...carried]
  })
  ipcMain.handle('plans:save', (_e, plan: Partial<PlanItem> & { date: string; title: string }) => {
    const r = plan.id
      ? updateIn<PlanItem>('plans', plan.id, plan)
      : insertInto<PlanItem>('plans', {
          category: 'other', status: 'planned', source: 'manual', ts: Date.now(),
          ...plan, id: genId('plan')
        } as PlanItem)
    broadcast('plan-updated')
    return r
  })
  ipcMain.handle('plans:remove', (_e, id: string) => {
    // 级联清理段→计划关联：孤儿关联会让时间轴上的活动段凭空消失
    const links = col<SegmentPlanLink>('segmentPlans').filter((x) => x.planId === id)
    for (const l of links) removeFrom('segmentPlans', l.id)
    const r = removeFrom('plans', id)
    broadcast('plan-updated')
    return r
  })
  ipcMain.handle('plans:setStatus', async (_e, id: string, status: PlanStatus) => {
    const updated = updateIn<PlanItem>('plans', id, { status, ...(status === 'done' ? { completedAt: Date.now() } : {}) })
    // 核心闭环：挂了项目任务的待办，完成状态反哺 projectTasks
    if (updated?.projectTaskId) {
      const map: Record<string, ProjectTask['status']> = { done: 'done', in_progress: 'in_progress', partial: 'in_progress', planned: 'todo', delayed: 'blocked', cancelled: 'todo' }
      updateIn<ProjectTask>('projectTasks', updated.projectTaskId, { status: map[status] ?? 'todo' })
    }
    if (updated && updated.source === 'oner') await onerPushStatus(updated)
    return updated
  })
  // ── 人生预期轨迹（v10 人生规划模拟） ──
  ipcMain.handle('goals:list', () => listGoalViews())
  ipcMain.handle('goals:decompose', async (_e, sourceText: string, hint?: string) =>
    decomposeGoal(String(sourceText), hint ? String(hint) : undefined)
  )
  ipcMain.handle('goals:create', (_e, input: Parameters<typeof createGoal>[0]) => createGoal(input))
  ipcMain.handle('goals:update', (_e, id: string, patch: Parameters<typeof updateGoal>[1]) =>
    updateGoal(String(id), patch)
  )
  ipcMain.handle('goals:remove', (_e, id: string) => removeGoal(String(id)))

  ipcMain.handle('plans:vsActual', (_e, date?: string) => {
    const d = date ?? dateKey(Date.now())
    const trail = buildMergedTrail(listActivities(d), d)
    return planVsActual(col<PlanItem>('plans'), trail, col<CustomCategory>('categories'))
  })

  // ── 项目 AI 开发管理 ──
  ipcMain.handle('projects:list', () => listProjects())
  ipcMain.handle('projects:save', (_e, p) => saveProject(p))
  ipcMain.handle('projects:remove', (_e, id: string) => removeProject(String(id)))
  ipcMain.handle('projects:tasks', (_e, projectId: string) => listTasks(String(projectId)))
  ipcMain.handle('projects:saveTask', (_e, t) => saveTask(t))
  ipcMain.handle('projects:removeTask', (_e, id: string) => removeTask(String(id)))
  ipcMain.handle('projects:aiBreakdown', (_e, projectId: string, req: string) => aiBreakdown(String(projectId), String(req ?? '')))
  ipcMain.handle('projects:linkApp', (_e, projectId: string | null, app: string) => linkAppToProject(projectId, String(app ?? '')))
  ipcMain.handle('projects:linkedApps', () => projectLinkedApps())
  ipcMain.handle('projects:dayLinks', (_e, date?: string) => dayProjectLinks(date))
  ipcMain.handle('projects:links', (_e, projectId: string) => projectLinks(String(projectId)))
  ipcMain.handle('projects:timeForTrail', (_e, projectId: string, trail) => projectTimeForTrail(String(projectId), trail))
  ipcMain.handle('projects:aiSchedule', () => aiSchedule())
  ipcMain.handle('projects:aiReview', (_e, projectId: string, trailMinutes: number) => aiReview(String(projectId), Number(trailMinutes) || 0))
  ipcMain.handle('projects:aiDevAdvice', (_e, ctx) => aiDevAdvice(ctx))

  // ── 开发者性能监控 ──
  ipcMain.handle('perf:stats', () => {
    const metrics = app.getAppMetrics().map((m) => ({
      pid: m.pid,
      type: m.type,
      cpu: Math.round(m.cpu.percentCPUUsage),
      memoryMB: Math.round((m.memory.workingSetSize ?? 0) / 1048576),
      privateMB: Math.round((m.memory.privateBytes ?? 0) / 1048576)
    }))
    const s = getSettings()
    return {
      metrics,
      modules: {
        monitor: getMonitorPerf(),
        deepMode: s.deepMode,
        petEnabled: s.petEnabled,
        widgetVisible: s.widgetVisible,
        aiEnabled: s.aiEnabled,
        ocrCleanupDays: s.ocrCleanupDays,
        smartPolling: s.monitorSmart
      },
      totalMemoryMB: metrics.reduce((a, m) => a + m.memoryMB, 0),
      totalCpu: Math.round(metrics.reduce((a, m) => a + m.cpu, 0))
    }
  })

  // ── 开发者 OCR 工具（本地数据处理，数据不上传；仅 devMode 下由本地补丁 UI 调用） ──
  ipcMain.handle('dev:ocrExport', async () => {
    const { canceled, filePath } = await dialog.showSaveDialog({
      title: '导出 OCR 数据集',
      defaultPath: `workon-ocr-${dateKey(Date.now()).replace(/-/g, '')}.json`,
      filters: [{ name: 'JSON', extensions: ['json'] }]
    })
    if (canceled || !filePath) return null
    fs.writeFileSync(filePath, JSON.stringify(buildDevDataset(), null, 2), 'utf-8')
    return filePath
  })
  ipcMain.handle('dev:ocrBatch', async (_e, limit?: number) => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      title: '选择 OCR 标注集输出目录',
      properties: ['openDirectory', 'createDirectory']
    })
    if (canceled || !filePaths?.length) return null
    return buildDevOcrBatch(filePaths[0], limit ?? 0)
  })
  ipcMain.handle('dev:prompts', async () => {
    const { canceled, filePath } = await dialog.showSaveDialog({
      title: '导出 AI 提示词/规则集',
      defaultPath: `workon-ai-prompts-${dateKey(Date.now()).replace(/-/g, '')}.json`,
      filters: [{ name: 'JSON', extensions: ['json'] }]
    })
    if (canceled || !filePath) return null
    fs.writeFileSync(filePath, JSON.stringify(buildDevPrompts(), null, 2), 'utf-8')
    return filePath
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

  // ── 动作库 + 积分（第三批：动作工坊） ──
  ipcMain.handle('motions:list', () => listMotions())
  ipcMain.handle('motions:data', (_e, id: string) => getMotionData(id))
  ipcMain.handle('motions:save', (_e, payload: { name: string; duration: number; fps: number; data: unknown; coverDataUrl?: string; cost?: number }) => {
    const meta = saveMotion(payload as { name: string; duration: number; fps: number; data: never; coverDataUrl?: string; cost?: number })
    return meta
  })
  ipcMain.handle('motions:remove', (_e, id: string) => removeMotion(id))
  ipcMain.handle('motions:setCost', (_e, id: string, cost: number) => setMotionCost(id, cost))
  ipcMain.handle('motions:redeem', (_e, id: string) => redeemMotion(id))
  ipcMain.handle('motions:play', (_e, id: string) => {
    sendTo('pet', 'pet:play-motion', { id })
    return true
  })
  ipcMain.on('motion-studio:open', () => createMotionWindow())
  ipcMain.handle('points:get', () => getPoints())
  ipcMain.handle('points:add', (_e, delta: number, reason: string) => addPoints(delta, reason))

  // P0 截图问答：按时间窗召回 ocrShots/ocrSnapshots 脱敏摘要注入上下文（默认最近 30 分钟）
  ipcMain.handle('qa:askWithShots', async (_e, question: string, windowMin?: number) => {
    const end = Date.now()
    const start = end - Math.max(1, windowMin ?? 30) * 60000
    const screenContext = screenContextForWindow(start, end)
    const ana = latestAnalysis(dateKey(Date.now()))
    return askWithContext(question, ana, todayTrail(), habitsOfUser(), screenContext ?? undefined)
  })

  // ── 流式问答 ──
  // 渲染端调用后，主进程通过事件流式推送 chunk
  ipcMain.handle('qa:askStream', async (_e, question: string) => {
    const s = getSettings()
    const ana = latestAnalysis(dateKey(Date.now()))
    const screenContext = screenContextForWindow(Date.now() - 30 * 60000, Date.now())
    if (!s.aiStreaming) {
      // 流式未启用 → 回退普通模式
      const result = await askWithContext(question, ana, todayTrail(), habitsOfUser(), screenContext ?? undefined)
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

  // ── 本地知识库 / 过程草稿 ──
  ipcMain.handle('knowledge:list', () => col<KnowledgeItem>('knowledge'))
  ipcMain.handle('knowledge:add', (_e, input: Partial<KnowledgeItem>) => {
    const now = Date.now()
    const item: KnowledgeItem = {
      id: genId('kn'),
      title: String(input.title ?? '未命名').trim() || '未命名',
      body: String(input.body ?? ''),
      kind: 'unstructured',
      source: (input.source as KnowledgeItem['source']) || 'manual',
      links: Array.isArray(input.links) ? input.links : [],
      tags: Array.isArray(input.tags) ? input.tags : [],
      fileName: input.fileName,
      categoryId: input.categoryId,
      categoryName: input.categoryName,
      dossierKind: input.dossierKind,
      sedimentedAt: input.sedimentedAt ?? now,
      ts: now
    }
    return insertInto('knowledge', item)
  })
  ipcMain.handle('knowledge:update', (_e, id: string, patch: Partial<KnowledgeItem>) =>
    updateIn<KnowledgeItem>('knowledge', String(id), patch)
  )
  ipcMain.handle('knowledge:remove', (_e, id: string) => removeFrom('knowledge', String(id)))
  ipcMain.handle('knowledge:sedimentMemo', (_e, payload: {
    memoId?: string
    text?: string
    title?: string
    links?: KnowledgeLink[]
  }) => {
    const memoId = payload?.memoId ? String(payload.memoId) : ''
    let memo = memoId ? col<MemoRecord>('memos').find((m) => m.id === memoId) : undefined
    const text = String(payload?.text ?? memo?.text ?? '').trim()
    if (!text) return { ok: false, reason: 'empty' }
    if (memo?.sedimentedAt && memo.knowledgeId) {
      const existing = col<KnowledgeItem>('knowledge').find((k) => k.id === memo!.knowledgeId)
      return { ok: true, already: true, item: existing }
    }
    const now = Date.now()
    const item = insertInto<KnowledgeItem>('knowledge', {
      id: genId('kn'),
      title: String(payload?.title ?? text.slice(0, 40)).trim() || '备忘',
      body: text,
      kind: 'unstructured',
      source: 'memo',
      links: Array.isArray(payload?.links) ? payload.links : (memoId ? [{ type: 'memo', id: memoId }] : []),
      tags: [],
      sedimentedAt: now,
      ts: now
    })
    if (memoId) {
      updateIn<MemoRecord>('memos', memoId, { sedimentedAt: now, knowledgeId: item.id })
    }
    return { ok: true, item }
  })
  ipcMain.handle('knowledge:pickFileContent', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: '文本/文档', extensions: ['txt', 'md', 'markdown', 'json', 'csv', 'log'] },
        { name: '全部', extensions: ['*'] }
      ]
    })
    if (result.canceled || !result.filePaths.length) return { ok: false, files: [] }
    const files = result.filePaths.map((fp) => {
      const fileName = path.basename(fp)
      let body = ''
      try {
        body = fs.readFileSync(fp, 'utf8')
      } catch {
        body = ''
      }
      return {
        fileName,
        title: fileName.replace(/\.[^.]+$/, ''),
        body: body.slice(0, 200_000)
      }
    })
    return { ok: true, files }
  })
  ipcMain.handle('knowledge:importFiles', async (_e, payload?: { links?: KnowledgeLink[] }) => {
    const picked = await dialog.showOpenDialog({
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: '文本/文档', extensions: ['txt', 'md', 'markdown', 'json', 'csv', 'log'] },
        { name: '全部', extensions: ['*'] }
      ]
    })
    if (picked.canceled || !picked.filePaths.length) return { ok: false, items: [] }
    const links = Array.isArray(payload?.links) ? payload!.links! : []
    const items: KnowledgeItem[] = []
    const now = Date.now()
    for (const fp of picked.filePaths) {
      const fileName = path.basename(fp)
      let body = ''
      try { body = fs.readFileSync(fp, 'utf8') } catch { body = '' }
      items.push(insertInto('knowledge', {
        id: genId('kn'),
        title: fileName.replace(/\.[^.]+$/, '') || fileName,
        body: body.slice(0, 200_000),
        kind: 'unstructured',
        source: 'upload',
        links,
        tags: [],
        fileName,
        sedimentedAt: now,
        ts: now
      }))
    }
    return { ok: true, items }
  })

  ipcMain.handle('process:getOpenDraft', () => getOpenProcessDraft())
  ipcMain.handle('process:appendNote', (_e, input) => {
    try {
      const draft = appendProcessNote(input ?? {})
      return { ok: true, draft }
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    }
  })
  ipcMain.handle('process:suggestCategory', (_e, text: string, projectId?: string) => {
    const p = projectId ? col<Project>('projects').find((x) => x.id === projectId) : null
    return suggestNoteCategory(String(text ?? ''), p?.noteCategories ?? [])
  })
  ipcMain.handle('process:ensureCategory', (_e, projectId: string, name: string) =>
    ensureProjectCategory(String(projectId), String(name))
  )
  ipcMain.handle('process:previewMerge', (_e, draftId?: string) => {
    const r = buildProcessMergePreview(draftId)
    if ('error' in r) return { error: r.error }
    return { title: r.title, body: r.body, links: r.links }
  })
  ipcMain.handle('process:confirmSediment', (_e, input) => {
    try {
      return confirmProcessSediment(input ?? {})
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    }
  })

  // ── 轻问诊 ──
  ipcMain.handle('feedback:send', (_e, payload: { qid: string; ctx: string; question: string; answer: 'yes' | 'no' }) => {
    const fb = recordFeedback(payload.qid, payload.ctx, payload.question, payload.answer)
    if (bus.question?.id === payload.qid) bus.setQuestion(null)
    return fb
  })
  ipcMain.handle('question:get', () => bus.question)

  // ── 纠错与规则 ──
  ipcMain.handle('corrections:list', () => col('corrections'))
  ipcMain.handle('corrections:add', (_e, c: Omit<ActivityCorrection, 'id' | 'ts'>) => {
    const saved = insertInto<ActivityCorrection>('corrections', { ...c, id: genId('corr'), ts: Date.now() })
    // v7 修正可撤销流：通知带「改回去」，撤销=删除该修正记录
    pushNotify(
      'correction',
      '时段已修正',
      `${c.date ?? ''} 的时段归类已更新（${String((c as unknown as { toState?: string }).toState ?? '新状态')}）。点「改回去」可撤销。`,
      [{ label: '改回去', action: `undo-correction:${saved.id}` }, { label: '就这样', action: 'dismiss', primary: true }],
      45
    )
    return saved
  })
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
  // 忙时轻档：人话「后台节奏」面板数据
  ipcMain.handle('load:getStatus', () => {
    const s = getLoadStatus()
    const busy = isLoadGuardEngaged()
    const fmtSec = (ms: number): string => (ms >= 1000 ? `每 ${Math.round(ms / 1000)} 秒` : '实时')
    const paces = [
      { key: 'monitor', label: '盯着你在用哪个软件', human: fmtSec(getMonitorPerf().intervalMs) },
      { key: 'wininfo', label: '记录窗口标题和位置', human: fmtSec(getWinInfoSleepMs()) },
      { key: 'ocr', label: '读屏内容做洞察', human: busy ? '暂停（电脑忙）' : getSettings().deepMode && !getSettings().performanceMode ? `开着（${getActiveEngine() === 'system' ? '系统快扫' : getActiveEngine() === 'rapidocr' ? '精细' : '基础'}）` : '关着' },
      { key: 'aiassist', label: '看 AI 编程工具状态', human: fmtSec(getAiAssistPace().minIntervalMs) },
      { key: 'pet', label: '桌宠动画', human: busy ? '省电档' : '正常档' }
    ]
    return { ...s, engaged: busy, paces }
  })
  ipcMain.handle('pet:set', (_e, patch: Partial<PetState>) => bus.setPet(patch))
  ipcMain.on('pet:hit', (_e, over: boolean) => setPetIgnoreMouse(!over))
  ipcMain.on('pet:hide', () => {
    if (petWindow && !petWindow.isDestroyed()) petWindow.hide()
  })
  ipcMain.on('pet:modal', (_e, active: boolean) => setPetModal(active))
  ipcMain.on('pet:show', () => { if (petWindow) { createPetWindow(); petWindow.show() } })
  ipcMain.on('pet:restore', () => sendTo('pet', 'pet:restore'))
  ipcMain.on('pet:introReplay', () => sendTo('pet', 'pet:introReplay'))
  ipcMain.handle('ai:test', (_e, ov?: { aiApiKey?: string; aiBaseUrl?: string; aiModel?: string }) => testAIConnection(ov))
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
        habitsOfUser(),
        (fullSoFar) => sendTo('pet', 'ai:streamReset', { full: fullSoFar })
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

  ipcMain.on('pet:stats', (_e, stats: unknown) => { if (getSettings().devMode) sendTo('main', 'pet:stats', stats) })

  // ── VRM 角色上传（L1：用户上传自定义 .vrm 文件） ──
  // VRM 方案一：选择 → 返回文件缓冲给渲染层体检，确认后再应用
  ipcMain.handle('pet:vrmPickInspect', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      title: '选择 VRM 模型',
      filters: [
        { name: 'VRM 模型', extensions: ['vrm'] },
        { name: 'glTF 模型', extensions: ['gltf', 'glb'] },
        { name: '所有文件', extensions: ['*'] }
      ],
      properties: ['openFile']
    })
    if (canceled || !filePaths.length) return null
    const srcPath = filePaths[0]
    const destDir = path.join(app.getPath('userData'), 'vrm-custom')
    if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true })
    const pendingPath = path.join(destDir, `pending-${Date.now()}${path.extname(srcPath)}`)
    fs.copyFileSync(srcPath, pendingPath)
    const sizeMB = Math.round((fs.statSync(pendingPath).size / 1024 / 1024) * 10) / 10
    const buffer = fs.readFileSync(pendingPath)
    return {
      pendingPath,
      name: path.basename(srcPath),
      sizeMB,
      buffer: buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)
    }
  })

  ipcMain.handle('pet:vrmApply', async (_e, pendingPath: string) => {
    if (!pendingPath || !fs.existsSync(pendingPath)) return false
    setSettings({ petVrmPath: pendingPath } as Partial<AppSettings>)
    sendTo('pet', 'pet:reloadVrm', pendingPath)
    return true
  })

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
          broadcast('plan-updated')
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
      broadcast('plan-updated')
    } else {
      // 用户拒绝：标记已确认，当天不再重复询问该计划
      updateIn<PlanItem>('plans', planId, { confirmedFromQA: true })
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
    broadcast('plan-updated')
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
    broadcast('plan-updated')
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
        emitPetIntent('celebrate', { message: '会议结束啦！辛苦辛苦~' })
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
      emitPetIntent('celebrate', {
        message: `会议结束，${Math.round((endMin - startMin))} 分钟。需要我整理纪要吗？`
      })
    }
    sendTo('pet', 'pet:meeting', payload)
  })
  // 点击桌宠加好感：每 10 次亲密度 +1（上限 5），并小幅提升愉悦度。
  // 计数与亲密度落盘（此前纯内存，重启清零白点）。
  let affectionClicks = getSettings().petAffectionClicks ?? 0
  ipcMain.handle('pet:affection', () => {
    affectionClicks++
    const patch: Partial<PetState> = {}
    if (affectionClicks >= 10 && bus.pet.intimacy < 5) {
      affectionClicks = 0
      patch.intimacy = bus.pet.intimacy + 1
    }
    const p = bus.pet.emotion.pleasure
    patch.emotion = { ...bus.pet.emotion, pleasure: Math.min(1, p + 0.03) }
    setSettings({ petAffectionClicks: affectionClicks })
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
  ipcMain.on('win:openMain', (_e, view?: string) => {
    createMainWindow()
    if (view) setTimeout(() => sendTo('main', 'nav:view', view), 600)
  })
  ipcMain.on('widget:opacity', (_e, v: number) => {
    // 临时透明度（quiet 模式等）：吸附态恒不透明，不写设置
    if (!widgetWindow || widgetWindow.isDestroyed()) return
    const s = getSettings()
    const docked = s.widgetMode === 'mini' && !!s.widgetDockEdge
    widgetWindow.setOpacity(docked ? 1 : Math.min(1, Math.max(0.3, v)))
  })
  ipcMain.on('widget:penetration', (_e, v: boolean) => {
    setWidgetPenetration(v)
  })
  ipcMain.on('widget:resize', (_e, w: number, h: number) => {
    resizeWidget(w, h)
  })
  ipcMain.on('widget:resizeTransient', (_e, w: number, h: number) => {
    resizeWidgetTransient(w, h)
  })
  ipcMain.on('widget:setMode', (_e, mode: 'mini' | 'compact' | 'full') => {
    setWidgetMode(mode)
  })
  ipcMain.on('widget:drag', (_e, dx: number, dy: number) => {
    moveWidgetBy(dx, dy)
  })
  ipcMain.on('widget:dragBegin', () => beginWidgetDrag())
  ipcMain.on('widget:dragEnd', () => endWidgetDrag())
  ipcMain.on('widget:hit', (_e, over: boolean) => setWidgetHit(!!over))

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
  ipcMain.handle('report:confirmEntry', (_e, date: string, entryId: string, patch: Record<string, unknown> | undefined, templateId?: string) => {
    // P0 修复：人工修正持久化（按 date+entryId），重新生成报表时套用
    if (patch && Object.keys(patch).length) {
      const pid = `${date}:${entryId}`
      const existing = col<ReportEntryPatch>('reportPatches').find((x) => x.id === pid)
      if (existing) updateIn<ReportEntryPatch>('reportPatches', pid, { patch, ts: Date.now() })
      else insertInto<ReportEntryPatch>('reportPatches', { id: pid, date, entryId, patch, ts: Date.now() })
    }
    if (templateId && !String(templateId).startsWith('preset-')) {
      const t = col<ReportTemplate>('reportTemplates').find((x) => x.id === templateId)
      if (t) return updateIn<ReportTemplate>('reportTemplates', t.id, { userCorrections: t.userCorrections + 1 })
    }
    return null
  })
  ipcMain.handle('report:patches:list', (_e, date: string) =>
    col<ReportEntryPatch>('reportPatches').filter((x) => x.date === date)
  )
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
