/**
 * 前台窗口轮询监控
 * 依据：PRD.md F1/F2
 *  - 按 monitorInterval 轮询（默认 5s）
 *  - 段变化才刷新 startTs
 *  - 双屏并行：前台窗口为激活屏，其余屏沿用最后已知窗口（active=false）
 *  - 空闲用 powerMonitor.getSystemIdleTime 推断
 *  - 应用常驻纠偏规则（宁漏勿误：screen + matchApp + matchTitleContains 全满足）
 */
import { powerMonitor, screen } from 'electron'
import { getForegroundWindow } from './winInfo'
import { presence } from './presence'
import { insertActivity, col, updateIn } from './db'
import { getSettings } from './settings'
import { identifyApp, INPUT_REQUIRED_STATES } from '@shared/stateMeta'
import { matchBrowserToPlan } from './ai'

import { sendTo } from './windows'
import { dateKey } from '@shared/trail'
import { startOcr, stopOcr, getLastOcrContext } from './ocrWorker'
import { getFocusedElement, summarizeFocusedElement } from './uia'
import { trackAppSwitch, matchKnownChain } from './qa/questionGenerator'
import { bus } from './state'
import { genId } from '@shared/types'
import type { CorrectionRule, PlanItem, WorkState } from '@shared/types'

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

async function tick(): Promise<void> {
  const ts = Date.now()
  // 200ms 防抖：窗口高频切换时避免 tick 抖动
  if (ts - lastTickAt < 200) return
  lastTickAt = ts
  const idleSec = powerMonitor.getSystemIdleTime()

  const fg = await getForegroundWindow().catch(() => null)

  // 会议软件检测：首次激活弹选项，消失 60s 判定结束（与状态识别并行）
  if (fg?.app && MEETING_APPS.test(fg.app)) {
    lastMeetingSeen = ts
    if (!meetingSince) {
      meetingSince = ts
      sendTo('widget', 'meeting-detected', { app: fg.app, title: fg.title })
    }
  } else if (meetingSince && ts - lastMeetingSeen > 60_000) {
    sendTo('widget', 'meeting-ended', { durationMin: Math.round((ts - meetingSince) / 60_000), sinceTs: meetingSince })
    meetingSince = 0
  }

  if (fg && fg.app) {
    const corrected = applyRules(fg.screen, fg.app, fg.title)
    const identified = identifyApp(corrected.app, corrected.title)
    // 隐私快标：标记应用完全停止采集（0 记录）——不截屏、不 OCR、不记标题、不落活动记录
    const excluded = isExcludedApp(corrected.app, identified.appName)
    presence.excludedActive = excluded
    const safeTitle = corrected.title
    let state: WorkState = (corrected.stateOverride as never) ?? identified.state
    // 输入活跃度校验：>60s 无键鼠操作时，输入型工作态降级为 idle（与 presence 引擎同口径）
    if (idleSec > 60 && INPUT_REQUIRED_STATES.includes(state as WorkState)) state = 'idle'

    let tr = tracks.get(fg.screen)
    const changed = !tr || tr.app !== corrected.app || tr.title !== safeTitle
    if (!excluded) {
      if (!tr || changed) {
        tr = { app: corrected.app, title: safeTitle, startTs: ts, lastTs: ts }
        tracks.set(fg.screen, tr)
      } else {
        tr.lastTs = ts
      }
      // 仅主屏样本携带窗口矩形（桌宠漫游避让用；桌宠窗口只覆盖主屏）
      const primary = screen.getPrimaryDisplay()
      const onPrimary =
        fg.x >= primary.bounds.x - 8 &&
        fg.y >= primary.bounds.y - 8 &&
        fg.x + fg.width <= primary.bounds.x + primary.bounds.width + 8 &&
        fg.y + fg.height <= primary.bounds.y + primary.bounds.height + 8
      const winRect = onPrimary
        ? {
            // 换算到桌宠窗口本地坐标（桌宠窗口原点在主屏 bounds.x/y）
            x: fg.x - primary.bounds.x,
            y: fg.y - primary.bounds.y,
            width: fg.width,
            height: fg.height
          }
        : undefined
      presence.push({ ts, app: corrected.app, title: safeTitle, screen: fg.screen, active: true, idleSec, winRect })
    } else {
      // 已排除：仅推入空信号维持引擎心跳（presence 不显示该应用，activities 不产生记录）
      presence.push({ ts, app: '', title: '', screen: fg.screen, active: true, idleSec })
    }

    // 作业链路检测：应用切换序列跟踪 → 候选链路弹确认 / 已知链路气泡提醒
    if (!excluded) {
      const candidate = trackAppSwitch(identified.appName || corrected.app, ts)
      if (candidate) {
        bus.setQuestion({
          id: genId('q'),
          ctx: `workchain:${candidate.join('>')}`,
          question: `检测到你反复走这个流程：${candidate.join(' → ')}，这是你的常用作业链路吗？`,
          ts
        })
      }
      const known = matchKnownChain()
      if (known) {
        bus.setPet({ message: `又在走「${known.join('→')}」流程啦，加油~` })
      }
    }

    // OCR 深度模式：将最近一次 OCR 上下文注入 presence
    const ocr = getLastOcrContext()
    if (ocr) presence.setOcrContext(ocr.text)

    // UIAutomation 深度模式：将焦点元素摘要注入 presence（3s 缓存，不阻塞 tick）
    if (getSettings().deepMode && !excluded) {
      getFocusedElement()
        .then((el) => presence.setUiaContext(summarizeFocusedElement(el) || undefined))
        .catch(() => { /* UIA 失败不影响监控 */ })
    }

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

    // 其余屏：沿用最后已知窗口做背景采样（双屏并行追踪）
    for (const [scr, t] of tracks) {
      if (scr === fg.screen) continue
      if (ts - t.lastTs > 30 * 60 * 1000) continue // 30 分钟未见前台则不再当作并行屏
      const id2 = identifyApp(t.app, t.title)
      // 已排除应用同样不记录（副屏背景采样也遵守隐私标记）
      if (isExcludedApp(t.app, id2.appName)) continue
      presence.push({ ts, app: t.app, title: t.title, screen: scr, active: false, idleSec })
      // 输入活跃度校验（与主屏同口径）
      const auxState = idleSec > 60 && INPUT_REQUIRED_STATES.includes(id2.state as WorkState) ? 'idle' : id2.state
      insertActivity({
        ts, app: t.app, appName: id2.appName, title: t.title,
        state: auxState, screen: scr, startTs: t.startTs, active: false, idleSec
      })
    }

    if (!excluded) {
      insertActivity({
        ts,
        app: corrected.app,
        appName: identified.appName,
        title: safeTitle,
        state,
        screen: fg.screen,
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
  if (s.deepMode) startOcr()
  void tick().finally(scheduleNext)
  console.log(`[monitor] 已启动，基础采样间隔 ${Math.max(2000, s.monitorInterval || 5000)}ms${s.monitorSmart ? '（智能模式）' : ''}`)
}

/** 当前应有采样间隔：智能模式下按状态动态升降频 */
function currentInterval(): number {
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
