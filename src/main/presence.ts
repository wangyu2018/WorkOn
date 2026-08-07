/**
 * 实时工作状态推断引擎
 * 依据：PRD.md F3
 *  - 各屏独立推断 WorkState
 *  - 媒体类"粘性"：副屏 relax 一旦出现即钉住，不被远程/文档覆盖
 *  - 主屏选择：激活屏优先（排除纯放松/摸鱼/空闲），否则首个工作屏
 *  - 输出 focusLevel(0-100) 与 context（如 dual-aidev-relax）
 */
import { EventEmitter } from 'events'
import type { PresenceSnapshot, ScreenPresence, WorkState } from '@shared/types'
import { WORK_LIKE_STATES, RELAX_STATES, INPUT_REQUIRED_STATES, identifyApp } from '@shared/stateMeta'
import { STATE_FOCUS_BASE } from '@shared/focusMeta'

const STICKY_MAX_MS = 10 * 60 * 1000 // 媒体粘性最长 10 分钟无更新自动解除
const SCREEN_STALE_MS = 35 * 60 * 1000 // 屏 35min 无前台则视为失效（略大于 monitor 30min 停推阈值，缓冲一拍）

export interface PresenceSample {
  ts: number
  app: string
  title: string
  screen: number
  active: boolean
  idleSec: number
  /** 前台窗口矩形（桌宠窗口本地坐标，仅主屏样本携带；桌宠漫游避让用） */
  winRect?: { x: number; y: number; width: number; height: number }
}

/** 无输入预判阈值：超过 60s 无键鼠活动，输入型工作态降级为 idle */
const IDLE_DOWNGRADE_SEC = 60

class PresenceEngine extends EventEmitter {
  private screens = new Map<number, ScreenPresence>()
  private lastActiveScreen = 0
  private slackSince: number | null = null
  private focusSince: number | null = null
  private snapshot: PresenceSnapshot
  private _ocrContext: string | undefined
  private _uiaContext: string | undefined
  /** 最近一次前台窗口矩形（仅主屏样本更新，60s 无更新失效） */
  private winRect: { x: number; y: number; width: number; height: number } | undefined
  private winRectTs = 0
  /** 当前前台应用是否被隐私排除（ocrWorker 据此跳过本轮截屏） */
  excludedActive = false

  constructor() {
    super()
    this.snapshot = this.build(Date.now(), 0)
  }

  /** 设置 OCR 上下文（由 ocrWorker 写入） */
  setOcrContext(ctx: string | undefined): void {
    this._ocrContext = ctx
  }

  /** 设置 UIAutomation 上下文（由 monitor 写入） */
  setUiaContext(ctx: string | undefined): void {
    this._uiaContext = ctx
  }

  /** 推入一轮采样（monitor 调用）。mediaSticky: 该屏样本来自媒体类应用 */
  push(sample: PresenceSample): PresenceSnapshot {
    const { screen, ts } = sample
    const identified = identifyApp(sample.app, sample.title)
    const isMediaApp = /^(Music|Video|VideoSite)$/.test(identified.appName)

    let sp = this.screens.get(screen)
    const changed =
      !sp || sp.app !== sample.app || sp.title !== sample.title || sp.state !== identified.state

    if (!sp || changed) {
      const sticky = sp?.stickyRelax && (isMediaApp || !sample.active) && ts - sp.sinceTs < STICKY_MAX_MS
      sp = {
        screen,
        state: sticky ? 'relax' : identified.state,
        app: sample.app,
        appName: identified.appName,
        title: sample.title,
        sinceTs: changed ? ts : (sp?.sinceTs ?? ts),
        stickyRelax: sticky || (isMediaApp && identified.state === 'relax')
      }
      this.screens.set(screen, sp)
    } else {
      sp.active = sample.active
      // 媒体粘性维持：非媒体应用但该屏非激活时保持 relax
      if (sp.stickyRelax && sample.active && WORK_LIKE_STATES.includes(identified.state)) {
        sp.stickyRelax = false
        sp.state = identified.state
        sp.app = sample.app
        sp.appName = identified.appName
        sp.title = sample.title
        sp.sinceTs = ts
      }
    }
    if (sample.active) this.lastActiveScreen = screen
    // 窗口矩形随样本更新（只记主屏的；monitor 只在主屏样本上携带 winRect）
    if (sample.winRect) {
      this.winRect = sample.winRect
      this.winRectTs = ts
    }

    this.snapshot = this.build(ts, sample.idleSec)
    this.emit('update', this.snapshot)
    return this.snapshot
  }

  getSnapshot(): PresenceSnapshot {
    return this.snapshot
  }

  private build(ts: number, idleSec: number): PresenceSnapshot {
    // 清理过期屏
    for (const [idx, sp] of this.screens) {
      if (ts - sp.sinceTs > SCREEN_STALE_MS) this.screens.delete(idx)
    }
    const list = [...this.screens.values()].sort((a, b) => a.screen - b.screen)

    // 主屏选择：激活屏优先（排除纯放松/摸鱼/空闲），否则首个工作屏
    let main: ScreenPresence | undefined = list.find((s) => s.screen === this.lastActiveScreen)
    if (main && RELAX_STATES.includes(main.state) && main.state !== 'break') {
      const work = list.find((s) => WORK_LIKE_STATES.includes(s.state))
      if (work) main = work
    }
    if (!main) main = list.find((s) => WORK_LIKE_STATES.includes(s.state)) ?? list[0]

    // 状态判定：idleSec 是输入活跃度的核心权重（键鼠不动 ≠ 在工作）
    // - >300s 无输入 → away；但会议/远程协作豁免（听会/看演示不需要键鼠，保持会议态，由 40 分封顶限制）
    // - >60s 无输入且窗口标题是输入型工作态 → 降级为 idle（只是"窗口开着"，人没在操作）
    // - 摸鱼/休息类保持原样
    let state: WorkState
    const meetingLike = main?.state === 'meeting' || main?.state === 'remote'
    if (idleSec > 300 && !meetingLike) {
      state = 'away'
    } else if (idleSec > IDLE_DOWNGRADE_SEC && main && INPUT_REQUIRED_STATES.includes(main.state)) {
      state = 'idle'
    } else {
      state = main?.state ?? 'idle'
    }
    const aux = list.find((s) => s.screen !== main?.screen)

    // context：单屏 single-xxx；双屏 dual-<main>-<aux>
    const context = aux ? `dual-${state}-${aux.state}` : `single-${state}`

    // 连续摸鱼/专注计时（先打点再算分，保证 focusLevel 与 continuousFocusSec 同帧同口径）
    // idle（60-300s 思考停顿）不清 focusSince：思考型工作不应丢失持续奖励；
    // 只有真正离开（away）或主动切到摸鱼/休息类才中断累计
    if (state === 'slack') {
      if (!this.slackSince) this.slackSince = ts
      this.focusSince = null
    } else if (WORK_LIKE_STATES.includes(state)) {
      if (!this.focusSince) this.focusSince = ts
      this.slackSince = null
    } else if (state === 'idle') {
      this.slackSince = null
    } else {
      this.slackSince = null
      this.focusSince = null
    }

    // focusLevel：基础分 + 持续奖励；无输入 >60s 时封顶 40（标题不算数，操作才算数）
    let focus = STATE_FOCUS_BASE[state]
    if (WORK_LIKE_STATES.includes(state)) {
      const contMin = this.focusSince ? (ts - this.focusSince) / 60000 : 0
      focus = Math.min(100, focus + Math.min(15, contMin * 0.5))
    }
    if (idleSec > IDLE_DOWNGRADE_SEC && state !== 'away') focus = Math.min(focus, 40)

    return {
      ts,
      state,
      focusLevel: Math.round(focus),
      context,
      screens: list.map((s) => ({ ...s })),
      mainScreen: main?.screen ?? 0,
      continuousSlackSec: this.slackSince ? Math.round((ts - this.slackSince) / 1000) : 0,
      continuousFocusSec: this.focusSince ? Math.round((ts - this.focusSince) / 1000) : 0,
      idleSec,
      ocrContext: this._ocrContext,
      uiaContext: this._uiaContext,
      winRect: ts - this.winRectTs < 60_000 ? this.winRect : undefined
    }
  }
}

export const presence = new PresenceEngine()
