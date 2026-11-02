/**
 * WorkOn 主进程入口
 * 启动顺序：设置 → 存储 → 窗口 → 监控 → 集成服务 → 托盘 → 快捷键 → 周期任务
 */
import { app, BrowserWindow, Notification, ipcMain, Menu } from 'electron'
import { initSettings, getSettings, setSettings } from './settings'
import { initDb, flushNow, loadActivitiesDeferred } from './db'
import { createMainWindow, createWidgetWindow, createPetWindow, createSplashWindow, closeSplash, sendTo, broadcast, widgetWindow, mainWindow, createTodoWidgetWindow, createWorkbenchWindow, attachWorkbench, isWorkbenchDetached, detachPanes, attachPanes, setPaneIgnore, panesState, snapPanes, collapsePane, expandPane, paneCollapsed, minimizeMain, hideMainToTray, hideWorkbench, setPaneTop } from './windows'
import { createTray } from './tray'
import { registerShortcuts, unregisterShortcuts } from './globalShortcut'
import { registerIpc } from './ipc'
import { startMonitor } from './monitor'
import { startAllWatchers } from './dirWatcher'
import { dedupeSessionBurstPlans } from './devSession'
import { cleanupJunkFeedbackPlans } from './statusCard'
import { disposeModelClient } from './recognition/modelClient'
import { startInputProbe } from './recognition/inputProbe'
import { addPoints } from './motions'
import { pushNotify } from './notify'
import { startIntegration } from './integration'
import { startOnerAutoSync } from './oner'
import { startAgentHookServer } from './agentHook'
import { autoCleanOcrCache } from './ocr'
import { bus } from './state'
import { emitPetIntent } from './petIntent'
import { startAttentionEngine, setPetNotifier } from './attention'
import { refreshPersona, getPersona } from './persona'
import { getWeatherBrief } from './weather'
import { startOcrCollector } from './report/ocrCollector'
import { startFolderWatch } from './folderWatcher'
import { detectHardware } from './hardwareDetect'
import { stopWinInfoServer } from './winInfo'
import { presence } from './presence'
import { genQuestion, analyzeDay, deriveHabits } from './ai'
import { genPersonaGapQuestion } from './qa/questionGenerator'
import { canInterrupt } from './confirmQueue'
import { initReminders, addReminder, listReminders, removeReminder } from './reminders'
import { listApps, openAppSafe } from './appLauncher'
import { generateSandbox } from './sandbox'
import { getDock, addDockItem, removeDockItem, reorderDock, renameDock, launchDockItem, launchDockGroup, createDockWindow, closeDock, dockVisible } from './edgeDock'
import { initMessageWatch, startMessageWatch, stopMessageWatch, recentIncoming } from './messageWatch'
import { musicControl } from './musicWatch'
import { startMusicWatch } from './musicWatch'
import { initLifeGoalJobs } from './lifeGoal'
import { macCheckPermissions } from './winInfoMac'
import { listChatSessions, createChatSession, addChatSessionItem, removeChatSession, renameChatSession, removeChatSessionItem } from './chatSessions'
import { aiDevAdvice } from './projects'
import { listActivities, listActivitiesRange, insertInto, col, updateIn } from './db'
import type { UserHabits, PlanItem } from '@shared/types'
import { WORK_LIKE_STATES } from '@shared/stateMeta'
import { dateKey, buildMergedTrail } from '@shared/trail'
import { genId } from '@shared/types'

let quitting = false
/** 应用启动时间戳（用于周末建议"开机后 1 小时内"判断） */
const appStartTs = Date.now()

// 父进程（npm/electron-vite 外壳）退出后，stdout 管道断开，
// console.log 会抛 EPIPE 未捕获异常弹错误框；这里吞掉该错误，不影响应用运行
process.stdout?.on('error', (e: NodeJS.ErrnoException) => {
  if (e.code !== 'EPIPE') throw e
})
process.stderr?.on('error', (e: NodeJS.ErrnoException) => {
  if (e.code !== 'EPIPE') throw e
})

// 未捕获异常时先关闭 splash，避免遮住错误弹窗
process.on('uncaughtException', (err) => {
  closeSplash()
  console.error('[fatal] uncaughtException:', err)
})

function setupBusForwarding(): void {
  // presence / pet / question 推送到所有窗口
  bus.on('presence', (snap) => {
    sendTo('main', 'presence:update', snap)
    sendTo('widget', 'presence:update', snap)
    sendTo('pet', 'presence:update', snap)
    sendTo('workbench', 'presence:update', snap)

    // F12：持续摸鱼 > slackHideSec 自动隐身（需启用）；回到工作弹欢迎
    const s = getSettings()
    if (widgetWindow && !widgetWindow.isDestroyed() && s.slackAutoHide) {
      if (snap.state === 'slack' && snap.continuousSlackSec > s.slackHideSec) {
        if (widgetWindow.isVisible()) widgetWindow.hide()
      } else if (s.widgetVisible && !widgetWindow.isVisible() && snap.state !== 'slack') {
        widgetWindow.show()
        sendTo('widget', 'welcome-back')
      }
    }
  })
  bus.on('pet', (pet) => {
    sendTo('main', 'pet:update', pet)
    sendTo('pet', 'pet:update', pet)
    sendTo('widget', 'pet:update', pet)
  })
  bus.on('question', (q) => {
    sendTo('widget', 'question:update', q)
    sendTo('main', 'question:update', q)
    sendTo('pet', 'question:update', q)
  })
}

function startPeriodicJobs(): void {
  /** 近 7 天轨迹 → 个人习惯画像（数据不足 3 天返回 null） */
  const habitsOfUser = (): UserHabits | null => {
    const trails = Array.from({ length: 7 }, (_, i) => dateKey(Date.now() - i * 86400000)).map((d) =>
      buildMergedTrail(listActivities(d), d)
    )
    const nonEmpty = trails.filter((t) => t.totalMin > 0)
    return nonEmpty.length >= 3 ? deriveHabits(nonEmpty) : null
  }

  // 轻问诊：每 30 分钟评估一次（AI 启用且已确认情境自动跳过；优先补用户画像缺口）
  setInterval(() => {
    if (!getSettings().aiEnabled) return
    const snap = presence.getSnapshot()
    if (snap.state === 'idle' || snap.state === 'away') return
    if (bus.question) return
    if (!canInterrupt()) return
    const pq = genPersonaGapQuestion(habitsOfUser())
    if (pq) {
      bus.setQuestion({ id: pq.id, ctx: pq.ctx, question: pq.question, ts: Date.now() })
      return
    }
    const q = genQuestion(snap.context)
    if (q) bus.setQuestion({ id: q.id, ctx: q.ctx, question: q.question, ts: Date.now() })
  }, 30 * 60 * 1000)

  // AI 开发实时建议：检测到连续 AI 开发（aidev/coding）时，每 60 分钟推一条针对性建议（桌宠气泡）
  let lastDevAdvice = 0
  setInterval(() => {
    const now = Date.now()
    if (now - lastDevAdvice < 60 * 60_000) return
    const snap = presence.getSnapshot()
    if (!snap || snap.state === 'idle' || snap.state === 'away') return
    const isDev = snap.state === 'aidev' || snap.state === 'coding' || snap.state === 'aiqa'
    if (!isDev) return
    const devSec = snap.continuousFocusSec || 0
    if (devSec < 45 * 60) return
    lastDevAdvice = now
    const currentApp = snap.screens?.find((s) => s.screen === snap.mainScreen)?.appName ?? snap.screens?.[0]?.appName ?? ''
    void aiDevAdvice({ currentApp, devMin: devSec / 60, state: snap.state }).then((r) => {
      if (r?.text) bus.setPet({ message: r.text })
    })
  }, 60 * 1000)

  // 画像自动刷新（间隔可在设置中配置：15/30/60 分钟或关闭；默认 30 分钟，省 token）
  let lastAutoRefresh = 0
  setInterval(() => {
    const s = getSettings()
    const ivMin = s.aiAutoRefreshMin ?? 30
    if (!s.aiAutoRefresh || ivMin <= 0) return
    const now = Date.now()
    if (now - lastAutoRefresh < ivMin * 60_000) return
    const date = dateKey(now)
    const trail = buildMergedTrail(listActivities(date), date)
    if (trail.totalMin < 10) return
    lastAutoRefresh = now
    void analyzeDay(trail).then((ana) => insertInto('analyses', ana))
  }, 60 * 1000)

  // reminder 到点通知：30s 检查一次，5 分钟窗口防重复（触发后标记 fired，不自动置 done）
  setInterval(() => {
    try {
      const now = new Date()
      const d = dateKey(now.getTime())
      const nowMin = now.getHours() * 60 + now.getMinutes()
      const due = col<PlanItem>('plans').filter((p) =>
        p.date === d &&
        (p.planType ?? 'phase') === 'reminder' &&
        p.status === 'planned' &&
        !p.fired &&
        p.startMin != null &&
        p.startMin <= nowMin &&
        p.startMin > nowMin - 5
      )
      for (const r of due) {
        updateIn<PlanItem>('plans', r.id, { fired: true })
        pushNotify('rest', 'WorkOn 提醒', r.title, [{ label: '知道了', action: 'dismiss', primary: true }], 30)
        broadcast('plan-updated')
      }
    } catch (e) {
      console.warn('[reminder] 检查失败', e)
    }
  }, 30 * 1000)

  // ── 天气提醒：下班提醒 + 周末出行建议（30s 检查一次，日期标记防重复）──
  // 下班提醒：工作日到 preferredWorkHours.end 时弹「今晚+明天」；周五提前 30 分钟弹
  // 周末建议：周末开机后 1 小时内弹一次「今天+明天」
  let lastWeatherRemindKey = ''
  setInterval(() => {
    try {
      const s = getSettings()
      if (!s.city) return
      const now = new Date()
      const d = dateKey(now.getTime())
      const nowMin = now.getHours() * 60 + now.getMinutes()
      const day = now.getDay() // 0=周日 6=周六
      const isWeekend = day === 0 || day === 6
      const isFriday = day === 5

      // 下班时间（画像可手动维护）
      const wh = getPersona().preferences.preferredWorkHours
      const endStr = wh?.end
      const endMin = endStr ? parseHHMM(endStr) : null

      // 触发条件：工作日到点 / 周五提前 30 分钟 / 周末开机后 1 小时内
      let shouldFire = false
      let kind: 'offwork' | 'weekend' = 'offwork'
      if (isWeekend) {
        // 周末：开机后 1 小时内弹一次（用启动时间判断）
        const bootMin = Math.floor((Date.now() - appStartTs) / 60000)
        if (bootMin <= 60) {
          shouldFire = true
          kind = 'weekend'
        }
      } else if (endMin != null) {
        const fireMin = isFriday ? endMin - 30 : endMin
        if (nowMin >= fireMin && nowMin < fireMin + 5) {
          shouldFire = true
          kind = 'offwork'
        }
      }

      if (!shouldFire) return
      const key = `${d}:${kind}`
      if (key === lastWeatherRemindKey) return
      lastWeatherRemindKey = key

      void (async () => {
        const brief = await getWeatherBrief(s.city)
        if ('error' in brief) return
        const t = brief.tonight
        const tm = brief.tomorrow
        const tonightTxt = t ? `${t.text} ${t.tempC}°C` : '暂无'
        const msg =
          kind === 'offwork'
            ? isFriday
              ? `周五啦~ 今晚${tonightTxt}，明天${tm.text} ${tm.minC}~${tm.maxC}°C，周末出行记得看天气哦 ☔`
              : `下班啦~ 今晚${tonightTxt}，明天${tm.text} ${tm.minC}~${tm.maxC}°C，路上注意天气哦 🌤`
            : `周末好~ 今天${tonightTxt}，明天${tm.text} ${tm.minC}~${tm.maxC}°C，适合出门走走吗？`
        bus.setPet({ message: msg })
      })()
    } catch (e) {
      console.warn('[weather-remind] 检查失败', e)
    }
  }, 30 * 1000)

  // ── 过程案卷提醒：工作日下班前后，有未沉淀草稿则弱提示一次 ──
  let lastProcessRemindDay = ''
  setInterval(() => {
    try {
      const now = new Date()
      const d = dateKey(now.getTime())
      if (d === lastProcessRemindDay) return
      const day = now.getDay()
      if (day === 0 || day === 6) return
      const nowMin = now.getHours() * 60 + now.getMinutes()
      if (nowMin < 17 * 60 || nowMin > 21 * 60) return
      const { getOpenProcessDraft, buildProcessMergePreview } = require('./processDraft') as typeof import('./processDraft')
      const draft = getOpenProcessDraft()
      if (!draft) return
      const notes = draft.notes?.length ?? 0
      const ais = draft.aiSnippets?.length ?? 0
      const apps = draft.apps?.length ?? 0
      if (notes + ais + apps < 1) return
      const preview = buildProcessMergePreview(draft.id)
      if ('error' in preview) return
      lastProcessRemindDay = d
      pushNotify(
        'rest',
        '过程案卷待沉淀',
        `今日草稿里有 ${notes} 条旁记、${ais} 段 AI、${apps} 个软件痕迹，可去知识库预览合并入库`,
        [{ label: '知道了', action: 'dismiss', primary: true }],
        45
      )
    } catch (e) {
      console.warn('[process-remind] 检查失败', e)
    }
  }, 60 * 1000)
}

/** 解析 "HH:MM" 为分钟数（0-1439），非法返回 null */
function parseHHMM(s: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s.trim())
  if (!m) return null
  const h = Number(m[1])
  const mm = Number(m[2])
  if (h < 0 || h > 23 || mm < 0 || mm > 59) return null
  return h * 60 + mm
}

// 单实例锁必须在 ready 之前申请（官方口径）；放 whenReady 里会导致第二进程/钩子异常时窗口永不出现
const gotSingleInstanceLock = app.requestSingleInstanceLock()
if (!gotSingleInstanceLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (!mainWindow.isVisible()) mainWindow.show()
      mainWindow.focus()
    }
  })
}

app.whenReady().then(() => {
  if (!gotSingleInstanceLock) return

  try {
  initSettings()
  console.log('[startup] settings ok')
  initDb()
  console.log('[startup] db ok')

  // 尽早建窗：后续清理/IPC/探针再慢也不挡首屏
  const showSplash = getSettings().showSplash !== false
  // Windows frameless 窗粘贴修复：无应用菜单时 Ctrl+C/V/X 加速器失效——注册编辑/窗口角色
  if (process.platform !== 'darwin') {
    Menu.setApplicationMenu(Menu.buildFromTemplate([{ role: 'editMenu' }, { role: 'windowMenu' }]))
  }
  const splashAt = Date.now()
  try {
    if (showSplash) createSplashWindow()
    const mw = createMainWindow({ deferShow: showSplash })
    // 亮窗定时器必须在 IPC/重活之前挂上；用本地引用避免打包后 mainWindow 绑定失效
    setTimeout(
      () => {
        closeSplash()
        if (mw && !mw.isDestroyed()) {
          if (mw.isMinimized()) mw.restore()
          mw.show()
          mw.focus()
          try { mw.moveTop() } catch { /* ignore */ }
          console.log('[startup] main window shown')
        }
        // 桌宠延迟创建：让主窗口先加载首页（首页卡顿投诉）。
        // 20s→6s：产品的"脸"不能在第一印象窗口缺席（审计 F4），资源让位保留但缩短
        if (getSettings().petEnabled) {
          setTimeout(() => {
            if (getSettings().petEnabled) createPetWindow()
          }, 6_000)
        }
      },
      showSplash ? Math.max(800, 2000 - (Date.now() - splashAt)) : 0
    )
    // 兜底：再过几秒强制亮一次（防 splash/焦点被抢走）
    setTimeout(() => {
      if (mw && !mw.isDestroyed() && !mw.isVisible()) {
        if (mw.isMinimized()) mw.restore()
        mw.show()
        mw.focus()
        console.log('[startup] main window force-show')
      }
    }, 5000)
    console.log('[startup] main window created')
  } catch (e) {
    console.error('[startup] 创建窗口失败', e)
  }

  try {
    const r = dedupeSessionBurstPlans()
    if (r.removed > 0) {
      console.info(`[startup] 机动开发去重：合并 ${r.groups} 组，删除 ${r.removed} 条`)
    }
    const junk = cleanupJunkFeedbackPlans()
    if (junk > 0) console.info(`[startup] 清理误导入章节待办 ${junk} 条`)
  } catch (e) {
    console.warn('[startup] 计划清理失败', e)
  }
  console.log('[startup] plans cleanup ok')

  try {
    registerIpc()
    console.log('[startup] ipc ok')
  } catch (e) {
    console.error('[startup] ipc 注册失败', e)
  }
  setupBusForwarding()
  autoCleanOcrCache()

  // 硬件分级：异步，不阻塞亮窗
  void detectHardware().catch((e) => console.warn('[hardware] 检测失败:', e))

  const ww = createWidgetWindow()
  if (ww && !ww.isDestroyed() && getSettings().widgetVisible) ww.show()
  if (getSettings().todoWidgetVisible) createTodoWidgetWindow()
  createTray()
  registerShortcuts()
  console.log('[startup] 窗口/托盘已就绪')

  // 延后：先加载活动日志（分块），再启动监控/探针
  // 隐私同意门：未同意（pending/declined）前不启动任何采集类模块（窗口采样/键鼠探针/
  // 目录监控/OCR 收集）；本地处理与外部同步服务不受影响。同意后由 consent:set 补启动。
  let collectionStarted = false
  const startCollection = (): void => {
    if (collectionStarted) return
    collectionStarted = true
    try {
      if (getSettings().inputProbeEnabled) startInputProbe()
      startMonitor()
      startAllWatchers()
      startOcrCollector()
      startFolderWatch()
      console.log('[startup] 采集已启动（隐私同意 granted）')
    } catch (e) {
      console.warn('[startup] 采集启动失败', e)
    }
  }
  ipcMain.handle('consent:set', (_e, v: 'granted' | 'declined') => {
    setSettings({ privacyConsent: v })
    if (v === 'granted') startCollection()
    return true
  })
  // 提醒中心（v10 §5）：应用内呈现，不走 OS 通知；用户自设提醒不受注意力预算扣减
  ipcMain.handle('reminders:list', () => listReminders())
  ipcMain.handle('reminders:add', (_e, input: { title: string; recurring: 'daily' | 'once'; atHHMM?: string; atTs?: number; origin?: 'user' | 'system'; confirmKeywords?: string[] }) =>
    addReminder(input)
  )
  ipcMain.handle('reminders:remove', (_e, id: string) => removeReminder(id))
  // 会话（v10）：消息右键加入会话，可继续追问
  ipcMain.handle('sessions:list', () => listChatSessions())
  // 工作台拆出（v10）：右页独立窗口（吸附+位置记忆）
  // 应用接管 L1（v10）：对话打开/切到本机应用
  ipcMain.handle('apps:list', () => listApps())
  // 沙箱可视化拆件（v10，OpenIntelligentUI 模式）：AI 生成轻量 HTML 可视化
  ipcMain.handle('sandbox:generate', async (_e, srcText: string, ask?: string) => generateSandbox(srcText, ask))
  ipcMain.handle('apps:open', (_e, query: string) => openAppSafe(query))
  // 音乐控制（v10 应用接管·媒体）
  ipcMain.handle('music:control', (_e, action: 'next' | 'prev' | 'toggle') => musicControl(action))
  ipcMain.handle('workbench:detach', () => {
    createWorkbenchWindow()
    return true
  })
  ipcMain.handle('workbench:attach', () => {
    attachWorkbench()
    return true
  })
  ipcMain.handle('workbench:state', () => isWorkbenchDetached())
  // 玻璃双窗（v10）：拆开=两块穿透玻璃片+磁性吸附
  ipcMain.handle('panes:detach', () => {
    detachPanes()
    return true
  })
  ipcMain.handle('panes:attach', () => {
    attachPanes()
    return true
  })
  ipcMain.on('panes:setIgnore', (_e, ignore: boolean) => {
    setPaneIgnore(ignore)
  })
  ipcMain.handle('win:minimize', () => {
    minimizeMain()
    return true
  })
  ipcMain.handle('win:hideMain', () => {
    hideMainToTray()
    return true
  })
  ipcMain.handle('win:hideWorkbench', () => {
    hideWorkbench()
    return true
  })
  ipcMain.handle('panes:state', () => panesState())
  ipcMain.handle('panes:snap', () => snapPanes())
  ipcMain.handle('panes:collapse', (_e, which: 'ask' | 'paper') => collapsePane(which))
  ipcMain.handle('panes:expand', (_e, which: 'ask' | 'paper') => expandPane(which))
  ipcMain.handle('panes:collapsed', (_e, which: 'ask' | 'paper') => paneCollapsed(which))
  ipcMain.handle('messages:recent', () => recentIncoming())
  // EdgeDock 边缘分组（2026-11-02 用户需求）
  ipcMain.handle('edgedock:get', (_e, edge: 'top' | 'left' | 'right') => getDock(edge))
  ipcMain.handle('edgedock:add', (_e, edge: 'top' | 'left' | 'right', appKey: string, label: string, icon: string) => addDockItem(edge, appKey, label, icon))
  ipcMain.handle('edgedock:remove', (_e, edge: 'top' | 'left' | 'right', id: string) => removeDockItem(edge, id))
  ipcMain.handle('edgedock:reorder', (_e, edge: 'top' | 'left' | 'right', ids: string[]) => reorderDock(edge, ids))
  ipcMain.handle('edgedock:rename', (_e, edge: 'top' | 'left' | 'right', title: string) => renameDock(edge, title))
  ipcMain.handle('edgedock:launchItem', (_e, edge: 'top' | 'left' | 'right', id: string) => launchDockItem(edge, id))
  ipcMain.handle('edgedock:launchGroup', (_e, edge: 'top' | 'left' | 'right') => launchDockGroup(edge))
  ipcMain.handle('edgedock:show', (_e, edge: 'top' | 'left' | 'right') => { createDockWindow(edge); return true })
  ipcMain.handle('edgedock:hide', (_e, edge?: 'top' | 'left' | 'right') => { closeDock(edge); return true })
  ipcMain.handle('edgedock:visible', (_e, edge: 'top' | 'left' | 'right') => dockVisible(edge))
  ipcMain.handle('panes:setTop', (_e, which: 'ask' | 'paper', on: boolean) => {
    setPaneTop(which, on)
    return true
  })
  ipcMain.handle('sessions:create', (_e, input: { title?: string; topic?: 'project' | 'life' | 'general'; first?: { role: 'user' | 'ai'; text: string; time: number } }) =>
    createChatSession(input)
  )
  ipcMain.handle('sessions:addItem', (_e, id: string, item: { role: 'user' | 'ai'; text: string; time: number }) =>
    addChatSessionItem(id, item)
  )
  ipcMain.handle('sessions:removeItem', (_e, id: string, index: number) => removeChatSessionItem(id, index))
  ipcMain.handle('sessions:remove', (_e, id: string) => removeChatSession(id))
  ipcMain.handle('sessions:rename', (_e, id: string, title: string) => renameChatSession(id, title))
  // 消息/音乐信号（v10 signals）：默认关，用户在设置里开
  initMessageWatch(
    (p) => {
    sendTo('main', 'message:incoming', p)
    sendTo('workbench', 'message:incoming', p)
    pushNotify('ai', `${p.app} 来了新消息（未读 ${p.unread}）`, p.text.slice(0, 80), [
      { label: '知道了', action: 'dismiss' }
    ], 60)
    },
    (app) => {
    // 可接管提示（一次性）：IM 前台但监控未开
    sendTo('main', 'message:hint', { app })
    pushNotify('ai', `检测到 ${app} 在前台`, '开启消息监控后，新消息会直接出现在对话流里（对它说「开启消息监控」即可）。', [
      { label: '知道了', action: 'dismiss' }
    ], 90)
    }
  )
  startMusicWatch((info: { name: string; artist: string }) => {
    pushNotify('generic', `♪ 正在播放：${info.name}`, info.artist, [], 20)
  })
  initReminders((r) => {
    const payload = { id: r.id, title: r.title, recurring: r.recurring, atHHMM: r.atHHMM, origin: r.origin, confirmed: !!r.confirmedAt }
    sendTo('main', 'reminder:fired', payload)
    sendTo('pet', 'reminder:fired', payload)
    // 桌宠气泡：走近级打扰只留给用户自设的提醒（正是这类）
    emitPetIntent('chat_open', { message: `时间到了：${r.title}`, workState: bus.pet.workState })
  })
  setImmediate(() => {
    void loadActivitiesDeferred()
      .then(() => {
        try {
          if (getSettings().privacyConsent === 'granted') startCollection()
          if (getSettings().messageWatchEnabled) startMessageWatch()
          if (getSettings().musicWatchEnabled) startMusicWatch()
          if (process.platform === 'darwin') {
            // mac 权限引导（审计 F3 同源思想：能力缺失要说话，不静默）
            const perms = macCheckPermissions()
            if (!perms.ax && !perms.screen) {
              pushNotify('generic', '需要一次授权，采集才能开始', '到 系统设置 → 隐私与安全性 → 辅助功能（或屏幕录制），勾选 Electron 后重启应用。没有授权也能用手动功能。', [
                { label: '知道了', action: 'dismiss' }
              ], 120)
              console.warn('[startup] mac 权限未授予：辅助功能/屏幕录制 均未开，窗口标题将缺失')
            } else {
              console.info(`[startup] mac 权限就绪 ax=${perms.ax} screen=${perms.screen}`)
            }
          }
          startAgentHookServer()
          if (getSettings().loadGuardEnabled !== false) {
            void import('./loadGuard').then((m) => m.startLoadGuard())
          }
  startIntegration()
          startOnerAutoSync()
          startPeriodicJobs()
          initLifeGoalJobs()
          setPetNotifier((msg) => bus.setPet({ message: msg }))
          startAttentionEngine()
          // 画像重算会扫全量 activities，放到空闲后再跑，避免堵死主进程 IPC（最小化/点击假死）
          setTimeout(() => {
            try {
              refreshPersona()
            } catch (e) {
              console.warn('[persona] 启动刷新失败', e)
            }
          }, 2500)
          console.log('[startup] 监控/探针等后台已启动')
        } catch (e) {
          console.warn('[startup] 后台启动失败', e)
        }
      })
      .catch((e) => console.warn('[startup] activities 加载失败', e))
  })

  setInterval(
    () => {
      try {
        refreshPersona()
      } catch (e) {
        console.warn('[persona] 定时刷新失败', e)
      }
    },
    24 * 60 * 60 * 1000
  )

  // 欢迎气泡 + 打招呼动作
  setTimeout(() => {
    emitPetIntent('chat_open', { message: '今天也一起加油吧~', workState: bus.pet.workState })
    sendTo('pet', 'pet:update', bus.pet)
  }, 3000)

  // 积分：每 30 分钟按专注/工作分钟数自动加分（1 分钟 = 1 积分，封顶 30/轮）
  setInterval(() => {
    try {
      const end = Date.now()
      const start = end - 30 * 60000
      const recs = listActivitiesRange(start, end).filter(
        (r) => r.active && WORK_LIKE_STATES.includes(r.state)
      )
      let minutes = 0
      const seen = new Set<number>()
      for (const r of recs) {
        const segStart = Math.max(r.startTs ?? r.ts, start)
        const segEnd = Math.min(r.ts, end)
        // 双屏并行只记一次：按起始秒去重
        const secKey = Math.floor(segStart / 1000)
        if (segEnd <= segStart || seen.has(secKey)) continue
        seen.add(secKey)
        minutes += (segEnd - segStart) / 60000
      }
      const pts = Math.min(30, Math.round(minutes))
      if (pts >= 5) addPoints(pts, 'focus')
    } catch (e) {
      console.warn('[points] 结算失败', e)
    }
  }, 30 * 60 * 1000)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow()
  })

  } catch (e) {
    closeSplash()
    console.error('[fatal] 启动失败:', e)
  }
})

app.on('window-all-closed', () => {
  // 托盘常驻：不因窗口全关而退出（退出走托盘菜单）
})

app.on('before-quit', () => {
  quitting = true
  unregisterShortcuts()
  disposeModelClient()
  stopWinInfoServer()
  flushNow()
  void quitting
})
