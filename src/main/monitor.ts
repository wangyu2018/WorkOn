/**
 * 前台窗口轮询监控
 * 依据：PRD.md F1/F2
 *  - 按 monitorInterval 轮询（默认 5s）
 *  - 段变化才刷新 startTs
 *  - 双屏并行：鼠标下窗口=激活（时间轴主记录）；其余屏可见顶层=旁路（含后台 AI）
 *  - 空闲用 powerMonitor.getSystemIdleTime 推断
 *  - 应用常驻纠偏规则（宁漏勿误：screen + matchApp + matchTitleContains 全满足）
 */
import { powerMonitor, screen } from 'electron'
import { isLoadGuardEngaged } from './loadGuard'
import { getAttentionWindow } from './winInfo'
import { captureAppVisual } from './appVisuals'
import { presence } from './presence'
import { insertActivity, col, updateIn } from './db'
import { getSettings } from './settings'
import { identifyApp, INPUT_REQUIRED_STATES } from '@shared/stateMeta'
import { recognize } from './recognition/decision'
import { devSessionTick } from './devSession'
import { matchBrowserToPlan } from './ai'

import { sendTo } from './windows'
import { dateKey } from '@shared/trail'
import { startOcr, stopOcr, getLastOcrContext } from './ocrWorker'
import { getFocusedElement, summarizeFocusedElement } from './uia'
import { trackAppSwitch, matchKnownChain, saveWorkChain } from './qa/questionGenerator'
import { focusChainTick } from './focusChain'
import { careTick, reportContinuousWork } from './care'
import { automationMinuteTick, automationOnAppSwitch, automationOnFocusTick } from './automation'
import { aiAssistWatchTick } from './aiAssistWatch'
import { attributionTick, isEntertainmentContext } from './attributions'
import { dirWatcherTick } from './dirWatcher'
import { dispatchConfirmQueue } from './confirmQueue'
import { bus } from './state'
import { genId } from '@shared/types'
import type { CorrectionRule, PlanItem, Project, ProjectTimeLink, SegmentPlanLink, WorkState } from '@shared/types'

/** 浏览器计划匹配：30 分钟内不重复问同一计划 */
const planAskedAt = new Map<string, number>()
const PLAN_ASK_COOLDOWN = 30 * 60_000

/** 会议检测：会议软件消失 60s 判定会议结束 */
const MEETING_APPS = /^(teams|zoom|腾讯会议|wemeet|voov meeting|feishu|lark|dingtalk)\.exe$/i
let meetingSince = 0
let lastMeetingSeen = 0

interface ScreenTrack {
  app: string
  title: string
  startTs: number
  lastTs: number
}

const tracks = new Map<number, ScreenTrack>()
let timer: NodeJS.Timeout | null = null
let running = false
let lastTickAt = 0

/** 后台 AI（副屏/旁路）：不因无键鼠立刻打成 idle——生成时常人在看别的屏 */
function softenAuxState(state: WorkState, idleSec: number): WorkState {
  if (state === 'aidev' || state === 'aiqa') {
    if (idleSec > 8 * 60) return 'idle'
    return state
  }
  if (idleSec > 60 && INPUT_REQUIRED_STATES.includes(state)) return 'idle'
  return state
}

/** 激活窗：AI 生成时允许更长无输入（人在盯流式输出） */
function softenActiveState(state: WorkState, idleSec: number): WorkState {
  if (state === 'aidev' || state === 'aiqa') {
    if (idleSec > 3 * 60) return 'idle'
    return state
  }
  if (idleSec > 60 && INPUT_REQUIRED_STATES.includes(state)) return 'idle'
  return state
}

function applyRules(screen: number, app: string, title: string): { app: string; title: string; stateOverride?: string } {
  // 权重降序：多条命中时高优先级规则先生效
  const rules = col<CorrectionRule>('rules')
    .filter((r) => r.enabled)
    .sort((a, b) => (b.weight ?? 0) - (a.weight ?? 0))
  for (const r of rules) {
    // 宁漏勿误：三个条件全满足才命中
    if (r.screen !== screen) continue
    if (r.matchApp && app.toLowerCase() !== r.matchApp.toLowerCase()) continue
    if (r.matchTitleContains && !title.toLowerCase().includes(r.matchTitleContains.toLowerCase())) continue
    // 命中写回统计（供监控页展示"已应用次数"与排查未生效问题）
    const newCount = (r.hitCount ?? 0) + 1
    updateIn<CorrectionRule>('rules', r.id, { hitCount: newCount, lastHitAt: Date.now() })
    // 连续 3 次命中 → 自动确认生效并通知 UI（用户第一次创建规则后能明确感知"已生效"）
    if (newCount >= 3 && !r.confirmed) {
      updateIn<CorrectionRule>('rules', r.id, { confirmed: true })
      sendTo('main', 'rules:applied', { matchApp: r.matchApp, matchTitleContains: r.matchTitleContains, hitCount: newCount })
    }
    console.info(`[monitor] 纠偏命中 #${newCount}: ${r.matchApp} "${r.matchTitleContains}" → ${r.setState ?? r.setApp ?? '原状态'}`)
    return {
      app: r.setApp ?? app,
      title,
      stateOverride: r.setState
    }
  }
  return { app, title }
}

/** 隐私快标别名：预置应用中文名 → 进程名匹配词 */
export const PRIVACY_ALIASES: Record<string, string[]> = {
  微信: ['wechat', 'weixin'],
  钉钉: ['dingtalk'],
  qq: ['qq', 'tim'],
  飞书: ['feishu', 'lark'],
  旺旺: ['wangwang', 'aliworkbench', 'alimtalk'],
  outlook: ['outlook']
}

/** 隐私快标命中判定：进程名 / 友好名双向匹配（短词精确、长词包含，避免误伤） */
export function isExcludedApp(app: string, appName: string): boolean {
  const list = getSettings().privacyExcludedApps ?? []
  if (list.length === 0) return false
  const base = app.replace(/\.exe$/i, '').toLowerCase()
  const friendly = appName.toLowerCase()
  for (const entry of list) {
    const key = entry.trim()
    if (!key) continue
    const tokens = [key.toLowerCase(), ...(PRIVACY_ALIASES[key] ?? PRIVACY_ALIASES[key.toLowerCase()] ?? [])]
    for (const t of tokens) {
      if (!t) continue
      if (t.length <= 3) {
        if (base === t || friendly === t) return true
      } else if (base.includes(t) || friendly.includes(t)) {
        return true
      }
    }
  }
  return false
}

/** 当前段关联的计划标题（拖拽归类/会话确认产生的关联） */
function currentPlanTitle(segStartTs: number): string | null {
  const links = col<SegmentPlanLink>('segmentPlans').filter((l) => l.segStartTs === segStartTs)
  if (!links.length) return null
  const planId = links[links.length - 1].planId
  return col<PlanItem>('plans').find((pl) => pl.id === planId)?.title ?? null
}

/** 当前应用归属的项目名（projectTimeLinks 按日链接，只取今天） */
function currentProjectName(app: string): string | null {
  const key = app.toLowerCase().replace(/\.exe$/i, '')
  const today = dateKey(Date.now())
  const links = col<ProjectTimeLink>('projectTimeLinks').filter((l) => l.app === key && l.date === today)
  if (!links.length) return null
  const last = links.reduce((a, b) => (b.ts > a.ts ? b : a))
  return col<Project>('projects').find((x) => x.id === last.projectId)?.name ?? null
}

async function tick(): Promise<void> {
  const ts = Date.now()
  // 200ms 防抖：窗口高频切换时避免 tick 抖动
  if (ts - lastTickAt < 200) return
  lastTickAt = ts
  // 手动暂停（托盘勾选）：完全停止采集，恢复后从当前状态继续
  if (getSettings().recordingPaused) return
  const idleSec = powerMonitor.getSystemIdleTime()

  // AI 助手后台名单：节流采样，完成时推闪点
  void aiAssistWatchTick(ts).catch(() => undefined)

  const { attention, fg, tops } = await getAttentionWindow().catch(() => ({
    attention: null,
    fg: null,
    tops: [] as Awaited<ReturnType<typeof getAttentionWindow>>['tops']
  }))
  // 时间轴 / 专注主记录：跟鼠标下的窗口；键盘前台仅作会议检测等辅助
  const win = attention

  // 会议软件检测：看键盘前台或注意力窗（会议常抢焦点）
  const meetingProbe = fg?.app && MEETING_APPS.test(fg.app) ? fg : win
  if (meetingProbe?.app && MEETING_APPS.test(meetingProbe.app)) {
    lastMeetingSeen = ts
    if (!meetingSince) {
      meetingSince = ts
      sendTo('widget', 'meeting-detected', { app: meetingProbe.app, title: meetingProbe.title })
    }
  } else if (meetingSince && ts - lastMeetingSeen > 60_000) {
    sendTo('widget', 'meeting-ended', { durationMin: Math.round((ts - meetingSince) / 60_000), sinceTs: meetingSince })
    meetingSince = 0
  }

  if (win && win.app) {
    // deepMode 时预取 UIA 焦点元素提示（3s 缓存），供 field/text_length 真实化。
    // 性能：UIA 走 PowerShell 冷启动（300-600ms 突发），只在用户停下（idle≥3s）时做——
    // 活跃打字/划鼠标期间跳过，特征由行为探针兜底，杜绝每 2s 一次的系统级卡顿。
    // UIA 只在「鼠标窗 ≈ 键盘前台」时有意义
    let uiaHint: { controlType: string; valueLength: number; selectedLength: number; docLength: number } | null = null
    const sameAsFg = !!(fg && fg.app === win.app && fg.screen === win.screen)
    if (sameAsFg && getSettings().deepMode && !getSettings().performanceMode && !isLoadGuardEngaged() && idleSec >= 8 && !isExcludedApp(win.app, identifyApp(win.app, win.title).appName)) {
      const el = await getFocusedElement().catch(() => null)
      if (el) {
        uiaHint = { controlType: el.controlType, valueLength: el.value.length, selectedLength: el.selectedText.length, docLength: el.docLength }
        presence.setUiaContext(summarizeFocusedElement(el) || undefined)
      }
    }
    // 双管道识别：纠偏规则 → 规则表兜底；shadow/model_first 时 python 小模型并行参与
    const rec = await recognize({ ts, screen: win.screen, app: win.app, title: win.title, active: true, idleSec, uiaHint })
    const corrected = { app: rec.app, title: rec.title }
    const identified = { appName: rec.appName, state: rec.state as WorkState }
    // 隐私快标：标记应用完全停止采集（0 记录）——不截屏、不 OCR、不记标题、不落活动记录
    const excluded = isExcludedApp(corrected.app, identified.appName)
    if (!excluded) devSessionTick(corrected.app, corrected.title, ts, idleSec)
    // 开发会话识别（P0）：dev 工具/localhost 组合 → 机动片段（排除应用不参与）
    presence.excludedActive = excluded
    const safeTitle = corrected.title
    let state: WorkState = softenActiveState(identified.state as WorkState, idleSec)

    let tr = tracks.get(win.screen)
    const changed = !tr || tr.app !== corrected.app || tr.title !== safeTitle
    // 语义标签：当前段关联的计划标题 / 项目名（顶栏与悬浮窗显示）
    const planTitle = currentPlanTitle(tr ? tr.startTs : ts)
    // 摸鱼上下文不挂项目标签——浏览器刷抖音不等于在项目上干活
    const projectName = isEntertainmentContext(corrected.app, safeTitle, state) ? null : currentProjectName(corrected.app)
    if (!excluded) {
      // 提取/补写图标+主题色（captureAppVisual 命中缓存即返回，仅首次真正提取 exe 图标）
      void captureAppVisual(corrected.app, win.exePath, identified.appName)
      if (!tr || changed) {
        tr = { app: corrected.app, title: safeTitle, startTs: ts, lastTs: ts }
        tracks.set(win.screen, tr)
      } else {
        tr.lastTs = ts
      }
      // 仅主屏样本携带窗口矩形（桌宠漫游避让用；桌宠窗口只覆盖主屏）
      const primary = screen.getPrimaryDisplay()
      const onPrimary =
        win.x >= primary.bounds.x - 8 &&
        win.y >= primary.bounds.y - 8 &&
        win.x + win.width <= primary.bounds.x + primary.bounds.width + 8 &&
        win.y + win.height <= primary.bounds.y + primary.bounds.height + 8
      const winRect = onPrimary
        ? {
            // 换算到桌宠窗口本地坐标（桌宠窗口原点在主屏 bounds.x/y）
            x: win.x - primary.bounds.x,
            y: win.y - primary.bounds.y,
            width: win.width,
            height: win.height
          }
        : undefined
      presence.push({ ts, app: corrected.app, title: safeTitle, appName: identified.appName, state: identified.state, planTitle, projectName, screen: win.screen, active: true, idleSec, winRect })
    } else {
      // 已排除：仅推入空信号维持引擎心跳（presence 不显示该应用，activities 不产生记录）
      presence.push({ ts, app: '', title: '', screen: win.screen, active: true, idleSec })
    }

    // 专注链路 v2（链路思维）：链路内切换不切碎；摸鱼/离开达阈值才切断（focusChainV2=false 回退 v1 休眠）
    focusChainTick(
      ts,
      excluded ? '' : identified.appName || corrected.app,
      excluded ? 'idle' : state,
      idleSec,
      getSettings().focusChainV2 !== false && !getSettings().recordingPaused
    )
    // 桌宠关怀调度（内部 60s 节流）：连续工作提醒 / 里程碑庆祝 / 整点问候
    reportContinuousWork(presence.getSnapshot().continuousFocusSec ?? 0)
    careTick()
    // MotionLab 自动化：分钟调度 + 专注时长阈值触发
    automationMinuteTick()
    automationOnFocusTick(presence.getSnapshot().continuousFocusSec ?? 0)
    // 归属引擎 + 目录活动落库（项目循环）；隐私排除应用不参与归属
    attributionTick(excluded ? '' : corrected.app || '', excluded ? '' : safeTitle || '', ts, idleSec, excluded, state)
    if (!excluded) {
      try {
        const { touchProcessDraft } = require('./processDraft') as typeof import('./processDraft')
        touchProcessDraft(corrected.app || '', safeTitle || '', ts)
      } catch {
        /* ignore */
      }
    }
    dirWatcherTick()
    dispatchConfirmQueue()

    // 作业链路：静默学习（不再弹"是常用链路吗"——AI 时代先行动，错了用户会顺手纠正）
    if (!excluded) {
      const switchedApp = identified.appName || corrected.app
      automationOnAppSwitch(switchedApp)
      const candidate = trackAppSwitch(switchedApp, ts)
      if (candidate) saveWorkChain(candidate)
    }

    // OCR 深度模式：将最近一次 OCR 上下文注入 presence
    const ocr = getLastOcrContext()
    if (ocr) presence.setOcrContext(ocr.text)

    // 浏览器行为 → 计划关键词匹配（问题 7：命中则弹确认，30min 不重复；隐私标记应用不参与）
    if (!excluded && /chrome|edge|firefox|opera|brave|arc|msedge/i.test(corrected.app)) {
      const today = dateKey(ts)
      const plans = col<PlanItem>('plans').filter((p) => p.date === today && p.status === 'planned' && !p.confirmedFromQA)
      const match = matchBrowserToPlan(corrected.app, safeTitle, plans)
      if (match) {
        const askedAt = planAskedAt.get(match.plan.id) ?? 0
        if (ts - askedAt > PLAN_ASK_COOLDOWN) {
          planAskedAt.set(match.plan.id, ts)
          sendTo('widget', 'browser-plan-confirm', {
            planId: match.plan.id,
            planTitle: match.plan.title,
            keyword: match.keyword,
            browserTitle: safeTitle,
            app: corrected.app
          })
        }
      }
    }

    // 旁路屏：各屏可见顶层；后台 AI 窗记 active:false，不抢时间轴主行
    const liveByScreen = new Map<number, (typeof tops)[number]>()
    for (const t of tops) {
      if (t.screen === win.screen) continue
      liveByScreen.set(t.screen, t)
    }
    // 键盘前台若在另一屏且未被中心采样到，也并入旁路（例如最小化边缘的 AI IDE）
    if (fg?.app && fg.screen !== win.screen && !liveByScreen.has(fg.screen)) {
      liveByScreen.set(fg.screen, fg)
    }
    // 清掉已无顶层窗口的副屏记忆，防止幽灵残留
    for (const scr of [...tracks.keys()]) {
      if (scr === win.screen) continue
      if (!liveByScreen.has(scr)) tracks.delete(scr)
    }
    for (const [scr, live] of liveByScreen) {
      const id2 = identifyApp(live.app, live.title)
      if (isExcludedApp(live.app, id2.appName)) continue
      let auxTr = tracks.get(scr)
      const auxChanged = !auxTr || auxTr.app !== live.app || auxTr.title !== live.title
      if (!auxTr || auxChanged) {
        auxTr = { app: live.app, title: live.title, startTs: ts, lastTs: ts }
        tracks.set(scr, auxTr)
      } else {
        auxTr.lastTs = ts
      }
      presence.push({ ts, app: live.app, title: live.title, screen: scr, active: false, idleSec })
      const auxState = softenAuxState(id2.state as WorkState, idleSec)
      insertActivity({
        ts, app: live.app, appName: id2.appName, title: live.title,
        state: auxState, screen: scr, startTs: auxTr.startTs, active: false, idleSec
      })
    }

    if (!excluded) {
      insertActivity({
        ts,
        app: corrected.app,
        appName: identified.appName,
        title: safeTitle,
        state,
        screen: win.screen,
        startTs: tr!.startTs,
        active: true,
        idleSec
      })
    }
  } else {
    // 采集失败不中断：仅推入空闲信号
    presence.push({ ts, app: '', title: '', screen: 0, active: true, idleSec })
  }
}

export function startMonitor(): void {
  if (running) return
  running = true
  const s = getSettings()
  // 性能模式：屏幕 OCR 采集是最大 CPU 来源（截屏+推理），开启后停用
  if (s.deepMode && !s.performanceMode) startOcr()
  void tick().finally(scheduleNext)
  console.log(`[monitor] 已启动，基础采样间隔 ${Math.max(2000, s.monitorInterval || 5000)}ms${s.monitorSmart ? '（智能模式）' : ''}`)
}

/** 当前应有采样间隔：智能模式下按状态动态升降频；忙时轻档整体压到 ≥8s */
function currentInterval(): number {
  const iv = baseInterval()
  return isLoadGuardEngaged() ? Math.max(iv, 8000) : iv
}

function baseInterval(): number {
  const s = getSettings()
  const base = Math.max(2000, s.monitorInterval || 5000)
  if (!s.monitorSmart) return base
  const snap = presence.getSnapshot()
  // 深度专注：降频到 10s（打扰少、省电）；摸鱼：升频到 3s（及时捕捉）
  if ((snap.focusLevel ?? 0) >= 80) return 10000
  if (snap.state === 'slack' || snap.state === 'relax') return 3000
  return base
}

function scheduleNext(): void {
  if (!running) return
  timer = setTimeout(() => {
    void tick()
      .catch((e) => console.warn('[monitor] tick 异常:', e))
      .finally(scheduleNext)
  }, currentInterval())
}

export function stopMonitor(): void {
  if (timer) clearTimeout(timer)
  timer = null
  stopOcr()
  running = false
}

export function restartMonitor(): void {
  stopMonitor()
  startMonitor()
}

/** 开发者性能监控：当前监控采样状态 */
export function getMonitorPerf(): { running: boolean; intervalMs: number } {
  return { running, intervalMs: running ? currentInterval() : 0 }
}
