/**
 * WorkOn 主进程入口
 * 启动顺序：设置 → 存储 → 窗口 → 监控 → 集成服务 → 托盘 → 快捷键 → 周期任务
 */
import { app, BrowserWindow } from 'electron'
import { initSettings, getSettings } from './settings'
import { initDb, flushNow } from './db'
import { createMainWindow, createWidgetWindow, createPetWindow, createSplashWindow, closeSplash, sendTo, widgetWindow, mainWindow } from './windows'
import { createTray } from './tray'
import { registerShortcuts, unregisterShortcuts } from './globalShortcut'
import { registerIpc } from './ipc'
import { startMonitor } from './monitor'
import { startIntegration } from './integration'
import { startOnerAutoSync } from './oner'
import { autoCleanOcrCache } from './ocr'
import { bus } from './state'
import { startAttentionEngine, setPetNotifier } from './attention'
import { refreshPersona } from './persona'
import { startOcrCollector } from './report/ocrCollector'
import { startFolderWatch } from './folderWatcher'
import { presence } from './presence'
import { genQuestion, analyzeDay, deriveHabits } from './ai'
import { genPersonaGapQuestion } from './qa/questionGenerator'
import { listActivities, insertInto } from './db'
import type { UserHabits } from '@shared/types'
import { dateKey, buildMergedTrail } from '@shared/trail'
import { genId } from '@shared/types'

let quitting = false

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
  })
  bus.on('question', (q) => {
    sendTo('widget', 'question:update', q)
    sendTo('main', 'question:update', q)
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

  // 轻问诊：每 3 分钟评估一次（AI 启用且已确认情境自动跳过；优先补用户画像缺口）
  setInterval(() => {
    if (!getSettings().aiEnabled) return
    const snap = presence.getSnapshot()
    if (snap.state === 'idle' || snap.state === 'away') return
    if (bus.question) return
    const pq = genPersonaGapQuestion(habitsOfUser())
    if (pq) {
      bus.setQuestion({ id: pq.id, ctx: pq.ctx, question: pq.question, ts: Date.now() })
      return
    }
    const q = genQuestion(snap.context)
    if (q) bus.setQuestion({ id: q.id, ctx: q.ctx, question: q.question, ts: Date.now() })
  }, 3 * 60 * 1000)

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
}

app.whenReady().then(() => {
  // 单实例锁：防止多个 WorkOn 同时运行（双桌宠窗会导致气泡/角色重叠）
  if (!app.requestSingleInstanceLock()) {
    app.quit()
    return
  }
  app.on('second-instance', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (!mainWindow.isVisible()) mainWindow.show()
      mainWindow.focus()
    }
  })

  try {
  initSettings()
  initDb()
  registerIpc()
  setupBusForwarding()
  autoCleanOcrCache() // 按设置周期清理截屏缓存（0=永不）

  // 开启动画：独立窗口先播 splash（~8s），主窗口后台加载，播完再亮
  const splashAt = Date.now()
  createSplashWindow()
  createMainWindow({ deferShow: true })
  const ww = createWidgetWindow()
  if (ww && !ww.isDestroyed() && getSettings().widgetVisible) ww.show()
  createTray()
  registerShortcuts()

  startMonitor()
  // v2.9 报表 OCR 采集：订阅 ocrWorker 文本产出（deepMode 开启后随 startOcr 生效）
  startOcrCollector()
  startFolderWatch()
  startIntegration()
  startOnerAutoSync()
  startPeriodicJobs()
  // v2.6 注意力评分引擎（桌宠消息经 notifier 注入，避免 attention→state 循环依赖）
  setPetNotifier((msg) => bus.setPet({ message: msg }))
  startAttentionEngine()

  // v2.7 用户画像：启动时自动采集刷新一次，之后每 24h 重刷（refreshPersona 幂等）
  try {
    refreshPersona()
  } catch (e) {
    console.warn('[persona] 启动刷新失败', e)
  }
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

  // splash 播完（≥8s）→ 关启动窗、亮主窗口、再建桌宠窗（避免 CG 被 splash 挡住）
  setTimeout(
    () => {
      closeSplash()
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.show()
        mainWindow.focus()
      }
      if (getSettings().petEnabled) createPetWindow()
    },
    Math.max(800, 8300 - (Date.now() - splashAt))
  )

  // 欢迎气泡
  setTimeout(() => {
    bus.setPet({ message: '今天也一起加油吧~', workState: bus.pet.workState })
    sendTo('pet', 'pet:update', bus.pet)
  }, 3000)

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
  flushNow()
  void quitting
})
