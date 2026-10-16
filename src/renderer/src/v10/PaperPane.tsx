/**
 * 右栏「表」：活页结构（v10 §3.3）
 * 报头 sticky（唯一永久物）→ 折上（你的版面，栏目三段式）→ 折线 → 折下（TTL 推送区）
 */
import { useState } from 'react'
import type { PlanItem, TrailSegment, PresenceSnapshot, GoalView } from '@shared/types'
import type { BlockParams } from './V10Surface'
import type { ObjectChipData } from './AskPane'
import { FlowMap } from './FlowMap'
import { Shrinkable } from './Shrinkable'
import { MindMap } from './mindmap'
import { useEffect } from 'react'

/** 折下数据流：真实 notify 卡 + 提醒事件（v10 §5 消息总线的 v10 侧呈现） */
export interface FeedItem {
  kind: 'notify'
  id: string
  title: string
  body: string
  time: number
  ttlSec: number
  /** 重要性：keep=报表/修正类（到期转归档不消失）；fade=一般通知（到期消亡）——v10 拍板 */
  keep?: boolean
  /** 主题归档（v10）：项目/生活/通用 */
  topic?: 'project' | 'life' | 'general'
}
import { WORK_STATES, STATE_LABEL } from '@shared/stateMeta'
import { displayApp } from '@shared/appDisplayName'

function hhmm(ts: number): string {
  const d = new Date(ts)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function TodayPlansBlock(props: { plans: PlanItem[]; onToggle: (p: PlanItem) => void; kick?: (p: { blockKey: string; extra?: JSX.Element }) => JSX.Element; pinned?: boolean; hidden?: boolean; onContextAsk?: (key: 'plans', q: string) => void }): JSX.Element | null {
  const today = new Date()
  const [expanded, setExpanded] = useState(false)
  if (props.hidden) return null
  const [showSrc, setShowSrc] = useState(false)
  const key = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
  // 对齐 plans:list 今日视图语义：今日项 + 近 3 天未完成自动顺延（不这么算列表会因全是旧日期而空藏）
  const carriedCutoff = new Date(today.getTime() - 3 * 86400000)
  const cutoffKey = `${carriedCutoff.getFullYear()}-${String(carriedCutoff.getMonth() + 1).padStart(2, '0')}-${String(carriedCutoff.getDate()).padStart(2, '0')}`
  const list = props.plans.filter(
    (p) =>
      !p.archived &&
      p.status !== 'cancelled' &&
      (p.date === key || (p.date < key && p.date >= cutoffKey && p.status !== 'done' && p.status !== 'delayed'))
  )
  const done = list.filter((p) => p.status === 'done').length
  const backlog = props.plans.filter(
    (p) => !p.archived && p.status !== 'cancelled' && p.status !== 'done' && p.status !== 'delayed' && p.date < cutoffKey
  )
  const sortedAll = [...list].sort((a, b) => (a.startMin ?? 1e9) - (b.startMin ?? 1e9))
  // 固定过的块不自动藏——显示空态+积压数，比整块消失更能交代「今天确实没排」
  if (props.hidden || (sortedAll.length === 0 && backlog.length === 0 && !props.pinned)) return null // 空自动隐藏
  const sorted = expanded ? sortedAll : sortedAll.slice(0, 8)
  return (
    <section
      className="v10-block"
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData('application/x-workon-block', JSON.stringify({ blockKey: 'plans', label: '今日计划', current: `${done}/${list.length}` }))
      }}
    >
      <div className="v10-block-kick">
        <span>◆ 今日计划</span>
        <span>· {done}/{list.length}</span>
        <span className="acts">
          {props.kick ? props.kick({ blockKey: 'plans', extra: <button onClick={() => setShowSrc(!showSrc)} title="数据源">源</button> }) : null}
          <button className="blk-chat" title="就这块开个会话" onClick={() => props.onContextAsk?.('plans', '今天的计划排得怎么样')}>对话</button>
        </span>
      </div>
      {showSrc ? (
        <div className="v10-srcnote">数据源：plans 表（单一事实源）· 手动/来件拆路/Oner 同步/AI 生成 四类 source 同库</div>
      ) : null}
      {!expanded && sortedAll.length > 8 ? (
        <button className="v10-foldmore" onClick={() => setExpanded(true)}>展开其余 {sortedAll.length - 8} 件 ▾</button>
      ) : null}
      {sortedAll.length === 0 ? <div className="v10-empty">今天还没排计划——说「计划 xxx」我来建</div> : null}
      {(
        sorted.map((p) => (
          <div className="v10-plan-row" key={p.id}>
            <button
              className={`v10-plan-check${p.status === 'done' ? ' done' : ''}`}
              onClick={() => props.onToggle(p)}
              title={p.status === 'done' ? '点一下取消完成' : '点一下完成'}
            />
            <span className={`v10-plan-title${p.status === 'done' ? ' done' : ''}`}>{p.title}</span>
            {p.startMin !== undefined ? (
              <span className="v10-plan-time">
                {String(Math.floor(p.startMin / 60)).padStart(2, '0')}:{String(p.startMin % 60).padStart(2, '0')}
              </span>
            ) : null}
          </div>
        ))
      )}
      {backlog.length > 0 ? (
        <>
          <div className="v10-srcnote">更早积压的待办 · {backlog.length} 项（点圈勾掉，或说过期的我来清）</div>
          {(expanded ? backlog : backlog.slice(0, 5)).map((p) => (
            <div className="v10-plan-row" key={p.id}>
              <button
                className="v10-plan-check"
                onClick={() => props.onToggle(p)}
                title="点一下完成"
              />
              <span className="v10-plan-title" style={{ opacity: 0.6 }}>{p.title}</span>
              <span className="v10-plan-time">{p.date.slice(5)}</span>
            </div>
          ))}
        </>
      ) : null}
    </section>
  )
}

function NowBlock(props: { presence: PresenceSnapshot | null; kick?: (p: { blockKey: string; extra?: JSX.Element }) => JSX.Element; pinned?: boolean; hidden?: boolean }): JSX.Element | null {
  const [showSrc, setShowSrc] = useState(false)
  if (props.hidden) return null
  const s = props.presence?.state
  if (!s) return null // 空自动隐藏（v10 拍板：置顶块为空不占位）
  const main = props.presence?.screens?.find((x) => x.screen === props.presence?.mainScreen)
  const focusSec = props.presence?.continuousFocusSec ?? 0
  const slackSec = props.presence?.continuousSlackSec ?? 0
  const focusSub = !props.presence
    ? '等待采集开始'
    : focusSec > 0
      ? `连续专注 ${Math.max(1, Math.round(focusSec / 60))} 分钟`
      : slackSec > 0
        ? `连续摸鱼 ${Math.max(1, Math.round(slackSec / 60))} 分钟`
        : '采集中 · 还没进入工作状态'
  return (
    <section
      className="v10-block"
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData('application/x-workon-block', JSON.stringify({ blockKey: 'now', label: '此刻', current: s ? STATE_LABEL[s] : '—' }))
      }}
    >
      <div className="v10-block-kick">
        <span>◆ 此刻{props.pinned ? ' · ◆' : ''}</span>
        <span className="acts">
          {props.kick ? props.kick({ blockKey: 'now', extra: <button onClick={() => setShowSrc(!showSrc)} title="数据源">源</button> }) : null}
        </span>
      </div>
      {showSrc ? (
        <div className="v10-srcnote">数据源：presence 引擎（窗口采样 5s + winInfo/winInfoMac）· 状态判定 13 态</div>
      ) : null}
      <div className="v10-block-hero">
        {s ? (s === 'other' ? displayApp(main?.app ?? '') || STATE_LABEL[s] : STATE_LABEL[s]) : '—'}
        <small>{focusSub}</small>
      </div>
      <div className="v10-block-meta">
        {s ? `${WORK_STATES[s].emoji} ${main?.title || displayApp(main?.app ?? '') || '无前台应用'}` : '等待采集开始'}
      </div>
    </section>
  )
}

function TimelineBlock(props: { trail: TrailSegment[]; days: number; kick?: (p: { blockKey: string; extra?: JSX.Element }) => JSX.Element; pinned?: boolean; hidden?: boolean; onContextAsk?: (key: 'timeline', q: string) => void }): JSX.Element | null {
  const days = props.days
  const [expanded, setExpanded] = useState(false)
  const [showSrc, setShowSrc] = useState(false)
  if (props.hidden) return null
  const cutoff = Date.now() - days * 24 * 3600_000
  const all = props.trail.filter((t) => !t.glance && t.startTs >= cutoff)
  if (props.hidden || all.length === 0) return null // 空自动隐藏
  const segs = (expanded ? all : all.slice(-8)).reverse()
  return (
    <section
      className="v10-block"
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData(
          'application/x-workon-block',
          JSON.stringify({ blockKey: 'timeline', label: '今日轨迹', current: days === 1 ? '今天' : `最近 ${days} 天` } as ObjectChipData)
        )
      }}
    >
      <div className="v10-block-kick">
        <span>◆ {days === 1 ? '今日轨迹' : `近 ${days} 天轨迹`}</span>
        <span>· 最近 {segs.length} 段</span>
        {days !== 1 ? <span className="aura-mark">◇ 已调</span> : null}
        <span className="acts">
          <span className="acts">
            {props.kick ? props.kick({ blockKey: 'timeline', extra: <button onClick={() => setShowSrc(!showSrc)} title="数据源">源</button> }) : null}
            <button className="blk-chat" title="就这块开个会话" onClick={() => props.onContextAsk?.('timeline', '最近我的轨迹怎么样，有什么规律')}>对话</button>
          </span>
        </span>
      </div>
      {showSrc ? (
        <div className="v10-srcnote">数据源：activities.jsonl → buildMergedTrail 聚合 · 窗口采集 winInfo/winInfoMac</div>
      ) : null}
      {!expanded && all.length > 8 ? (
        <button className="v10-foldmore" onClick={() => setExpanded(true)}>展开更早的 {all.length - 8} 段 ▾</button>
      ) : null}
      {days === 1 && all.length ? <TimelineBand segs={all} /> : null}
      {(
        segs.map((t, i) => (
          <div className={`v10-tl-row${t.glance ? ' glance' : ''}`} key={`${t.startTs}-${i}`}>
            <span className="v10-tl-time">{hhmm(t.startTs)}</span>
            <span className="v10-tl-dot" style={{ background: WORK_STATES[t.mainState]?.color ?? '#64748B' }} />
            <span className="v10-tl-app">{WORK_STATES[t.mainState]?.label ?? '—'}</span>
            <span className="v10-tl-title">{t.mainTitle || displayApp(t.mainApp)}</span>
          </div>
        ))
      )}
    </section>
  )
}

/** 24h 时间带（v10 轨迹可视化升级）：横带按段时长画色块，hover 看详情 */
function TimelineBand(props: { segs: TrailSegment[] }): JSX.Element {
  const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0)
  const total = 24 * 3600_000
  return (
    <div className="v10-tband">
      <div className="tb-track">
        {props.segs.map((t, i) => {
          const left = ((t.startTs - dayStart.getTime()) / total) * 100
          const width = Math.max(0.6, ((t.endTs - t.startTs) / total) * 100)
          return (
            <span
              key={i}
              className="tb-seg"
              style={{ left: `${Math.min(99, left)}%`, width: `${Math.min(100 - left, width)}%`, background: WORK_STATES[t.mainState]?.color ?? '#64748B' }}
              title={`${hhmm(t.startTs)}–${hhmm(t.endTs)} ${STATE_LABEL[t.mainState]} · ${displayApp(t.mainApp)} · ${Math.round(t.durationMin)} 分钟`}
            />
          )
        })}
        <span className="tb-now" style={{ left: `${((Date.now() - dayStart.getTime()) / total) * 100}%` }} />
      </div>
      <div className="tb-scale">
        <span>0时</span><span>6时</span><span>12时</span><span>18时</span><span>24时</span>
      </div>
    </div>
  )
}

/** 提醒块（v10）：两类提醒列表，空自动隐藏（置顶可），行内删除 */
function RemindersBlock(props: {
  reminders: Array<{ id: string; title: string; atHHMM?: string; recurring?: string; origin?: string; enabled?: boolean }>
  kick?: (p: { blockKey: string; extra?: JSX.Element }) => JSX.Element
  pinned?: boolean
  hidden?: boolean
  onRemove?: (id: string) => void
}): JSX.Element | null {
  const list = props.reminders.filter((r) => r.enabled !== false)
  if (props.hidden || list.length === 0) return null // 空自动隐藏
  return (
    <section
      className="v10-block"
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData('application/x-workon-block', JSON.stringify({ blockKey: 'reminders', label: '提醒', current: `${list.length} 条` }))
      }}
    >
      <div className="v10-block-kick">
        <span>◆ 提醒</span>
        <span>· {list.length} 条</span>
        <span className="acts">
          {props.kick ? props.kick({ blockKey: 'reminders' }) : null}
        </span>
      </div>
      {list.map((r) => (
        <div className="v10-plan-row" key={r.id}>
          <span className="v10-plan-time">{r.atHHMM ?? (r.recurring === 'daily' ? '每天' : '定时')}</span>
          <span className="v10-plan-title">{(r.origin === 'system' ? '⚙ ' : '') + r.title}</span>
          <button className="v10-unhide" title="删除这条提醒" onClick={() => props.onRemove?.(r.id)}>×</button>
        </div>
      ))}
    </section>
  )
}

/** 里程碑轴（人生预期美化）：起点→锚点（按日期定位）→截止，「你在这里」aura 标记 */
function GoalAxis(props: {
  v: GoalView
  onMark: (goalId: string, anchorId: string, status: 'hit' | 'pending') => void
  onRemove: (anchorId: string) => void
}): JSX.Element {
  const { v } = props
  const startTs = new Date(v.goal.deadline).getTime() - v.remainingDays * 86_400_000
  const endTs = new Date(v.goal.deadline).getTime()
  const nowPct = Math.min(100, Math.max(0, ((Date.now() - startTs) / (endTs - startTs)) * 100))
  const pctOf = (d: string): number => {
    const t = new Date(d).getTime()
    if (Number.isNaN(t)) return 0
    return Math.min(100, Math.max(0, ((t - startTs) / (endTs - startTs)) * 100))
  }
  return (
    <div className="v10-goal-axis">
      <div className="ax-line" />
      <span className="ax-start">始</span>
      {v.goal.anchors.map((a) => {
        const p = pctOf(a.targetDate)
        const cls = a.status === 'hit' ? 'hit' : a.status === 'missed' ? 'missed' : new Date(a.targetDate).getTime() < Date.now() ? 'due' : ''
        return (
          <button
            key={a.id}
            className={`ax-node ${cls}`}
            style={{ left: `${p}%` }}
            title={`${a.targetDate} ${a.title} — 点一下标达成/还原`}
            onClick={() => props.onMark(v.goal.id, a.id, a.status === 'hit' ? 'pending' : 'hit')}
          >
            <i className="ax-dot" />
            <em className="ax-label">{a.title.slice(0, 6)}</em>
          </button>
        )
      })}
      <span className="ax-now" style={{ left: `${nowPct}%` }} title="你在这里">
        <i />
        <em>现在</em>
      </span>
      <span className="ax-end">{v.goal.deadline.slice(5)}</span>
    </div>
  )
}

/** 人生预期轨迹块（v10 人生规划模拟）：计划 vs 实际投入 + 锚点轴 + 高度预估 */
function GoalCard(props: {
  v: GoalView
  onMarkAnchor: (goalId: string, anchorId: string, status: 'hit' | 'pending') => void
  onGoalPatch: (goalId: string, patch: unknown) => void
}): JSX.Element {
  const { v } = props
  const [adding, setAdding] = useState(false)
  const [aTitle, setATitle] = useState('')
  const [aDate, setADate] = useState('')
  const pct = Math.min(100, Math.round((v.cumMin / Math.max(1, v.totalTargetMin)) * 100))
  const planPct = Math.min(100, Math.round((v.plannedCumMin / Math.max(1, v.totalTargetMin)) * 100))
  const behind = v.paceRatio < 0.6
  const f = v.forecast

  const submitAnchor = (): void => {
    if (!aTitle.trim() || !/^\d{4}-\d{2}-\d{2}$/.test(aDate)) return
    props.onGoalPatch(v.goal.id, { addAnchor: { title: aTitle.trim(), targetDate: aDate } })
    setATitle('')
    setADate('')
    setAdding(false)
  }

  return (
    <div className="v10-goal">
      <div className="v10-goal-head">
        <span className="v10-goal-title">{v.goal.event}</span>
        <span className="v10-goal-dday">D-{v.remainingDays}</span>
      </div>
      {/* 双层进度带：灰底=总预算 · 青瓷填充=实际投入 · 白刻线=计划应达位置 */}
      <div className="v10-goal-bar2" title={`已投 ${Math.round(v.cumMin)} 分钟 / 预算 ${Math.round(v.totalTargetMin)} 分钟 · 计划应达 ${planPct}%`}>
        <i className="gb-fill" style={{ width: `${pct}%` }} />
        <i className="gb-plan" style={{ left: `${planPct}%` }} />
        <b className="gb-num">{pct}%</b>
      </div>
      {/* 里程碑轴：锚点按日期比例落在 时间轴 上，你在 aura 点位置 */}
      <GoalAxis v={v} onMark={props.onMarkAnchor} onRemove={(aid) => props.onGoalPatch(v.goal.id, { removeAnchorId: aid })} />
      <div className="v10-goal-anchors">
        {v.goal.anchors.map((a) => (
          <span key={a.id} className="v10-goal-anchor-wrap">
            <button
              className={`v10-goal-anchor ${a.status}`}
              title={`${a.targetDate} · 点一下标记达成/还原`}
              onClick={() => props.onMarkAnchor(v.goal.id, a.id, a.status === 'hit' ? 'pending' : 'hit')}
            >
              {a.status === 'hit' ? '●' : a.status === 'missed' ? '✕' : '○'} {a.title}
            </button>
            <button
              className="v10-goal-anchor-x"
              title="删除锚点"
              onClick={() => props.onGoalPatch(v.goal.id, { removeAnchorId: a.id })}
            >
              ×
            </button>
          </span>
        ))}
        <button className="v10-goal-anchor-add" title="手动加锚点" onClick={() => setAdding(!adding)}>
          + 锚点
        </button>
      </div>
      {adding ? (
        <div className="v10-goal-addrow">
          <input
            type="date"
            value={aDate}
            onChange={(e) => setADate(e.target.value)}
            min={new Date().toISOString().slice(0, 10)}
            max={v.goal.deadline}
          />
          <input
            type="text"
            value={aTitle}
            placeholder="锚点名（如 MVP 原型跑通）"
            onChange={(e) => setATitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submitAnchor()
            }}
          />
          <button onClick={submitAnchor}>加</button>
        </div>
      ) : null}
      <div className="v10-goal-meta">
        <span>{behind ? '⚠ 偏离' : '在轨'} · 今日 +{Math.round(v.investedTodayMin)} 分钟</span>
        {v.alerts.length ? <span className="v10-goal-alert">{v.alerts[0]}</span> : null}
      </div>
      {f ? (
        <div className="v10-goal-forecast">
          按近 14 天节奏到期预计 <b>{Math.round(f.completionPct * 100)}%</b>
          {f.projectedAnchorTitle ? ` · 落点「${f.projectedAnchorTitle}」` : ''}
          {f.levers[0] ? ` · 若${f.levers[0].label} → ${Math.round(f.levers[0].newCompletionPct * 100)}%` : ''}
        </div>
      ) : null}
    </div>
  )
}

function GoalsBlock(props: {
  goals: GoalView[]
  onMarkAnchor: (goalId: string, anchorId: string, status: 'hit' | 'pending') => void
  onGoalPatch: (goalId: string, patch: unknown) => void
  kick?: (p: { blockKey: string; extra?: JSX.Element }) => JSX.Element
  pinned?: boolean
  hidden?: boolean
  onContextAsk?: (key: 'goals', q: string) => void
}): JSX.Element | null {
  const actives = props.goals.filter((v) => v.goal.status === 'active')
  if (props.hidden || actives.length === 0) return null // 空自动隐藏
  return (
    <section
      className="v10-block"
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData('application/x-workon-block', JSON.stringify({ blockKey: 'goals', label: '人生预期', current: actives.map((a) => a.goal.event).join('/') || '—' }))
      }}
    >
      <div className="v10-block-kick">
        <span>◆ 人生预期</span>
        <span>· {actives.length} 条在轨</span>
        <span className="acts">
          {props.kick ? props.kick({ blockKey: 'goals' }) : null}
          <button className="blk-chat" title="就这个目标开个会话" onClick={() => props.onContextAsk?.('goals', '我的目标现在进展如何')}>对话</button>
        </span>
      </div>
      {actives.length === 0 ? (
        <div className="v10-empty">还没有预期——去左栏说一句「我想在年底前把 X 做到 Y」，我拆成锚点轨迹替你盯。</div>
      ) : (
        actives.map((v) => <GoalCard key={v.goal.id} v={v} onMarkAnchor={props.onMarkAnchor} onGoalPatch={props.onGoalPatch} />)
      )}
    </section>
  )
}

/** AI 配置块（v10）：内联配 Key/BaseURL/模型——不跳旧版（v10 表面会遮挡） */
function AiConfigBlock(props: { onClose: () => void; onSaved: () => void }): JSX.Element {
  const [base, setBase] = useState('https://api.deepseek.com/v1')
  const [key, setKey] = useState('')
  const [model, setModel] = useState('deepseek-chat')
  const [saved, setSaved] = useState(false)
  const [hasKey, setHasKey] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<string>('')
  useEffect(() => {
    void window.api?.getSettings?.().then((st) => {
      const s2 = st as { aiBaseUrl?: string; aiModel?: string; aiApiKey?: string }
      if (s2.aiBaseUrl) setBase(s2.aiBaseUrl)
      if (s2.aiModel) setModel(s2.aiModel)
      if (s2.aiApiKey) setHasKey(true)
    })
  }, [])
  const doTest = (): void => {
    setTesting(true)
    setTestResult('')
    const api = window.api as { testAI?: (ov?: { aiApiKey?: string; aiBaseUrl?: string; aiModel?: string }) => Promise<{ ok?: boolean; latency?: number; model?: string; error?: string; hint?: string }> } | undefined
    void Promise.resolve(api?.testAI?.({ aiApiKey: key.trim() || undefined, aiBaseUrl: base.trim(), aiModel: model.trim() }))
      .then((r) => setTestResult(r?.ok ? `✓ 连通（${r.latency ?? '?'}ms · ${r.model ?? model}）` : `✗ ${r?.error ?? '连接失败'}${r?.hint ? `（${r.hint}）` : ''}`))
      .catch((e) => setTestResult(`✗ ${String(e).slice(0, 80)}`))
      .finally(() => setTesting(false))
  }
  return (
    <section className="v10-block">
      <div className="v10-block-kick">
        <span className="aura-mark">◇</span>
        <span>接入 AI</span>
        <span className="acts"><button onClick={props.onClose}>×</button></span>
      </div>
      <div className="v10-aicfg">
        <label>API BaseURL（OpenAI 兼容端点）
          <input value={base} onChange={(e) => setBase(e.target.value)} placeholder="https://api.deepseek.com/v1" />
        </label>
        <label>API Key{hasKey && !key ? '（已配置，留空保持不变）' : ''}
          <input type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder={hasKey ? '已保存·输入以更换' : 'sk-…'} />
        </label>
        <label>模型
          <input value={model} onChange={(e) => setModel(e.target.value)} placeholder="deepseek-chat" />
        </label>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            className="dc-btn"
            title="保存配置并启用"
            disabled={!key.trim() && !hasKey}
            style={{ opacity: key.trim() || hasKey ? 1 : 0.5, flex: 1 }}
            onClick={() => {
              const patch: Record<string, unknown> = { aiEnabled: true, aiBaseUrl: base.trim(), aiModel: model.trim() }
              // 剥离非 ASCII/空白字符（复制带格式文本常混入中文标点/不可见符，fetch 会 ByteString 报错）
              if (key.trim()) patch.aiApiKey = key.replace(/[^\x21-\x7e]/g, '').trim()
              void window.api?.setSettings?.(patch as never)
              setSaved(true)
              setHasKey(true)
              props.onSaved()
            }}
          >
            {saved ? '✓ 已保存' : '✔ 保存并启用'}
          </button>
          <button className="dc-btn" title="用当前配置发一个测试请求" onClick={doTest} disabled={testing}>
            {testing ? '…' : '⚡ 测连通'}
          </button>
        </div>
        {testResult ? <div className="ob-hint" style={{ marginTop: 6 }}>{testResult}</div> : null}
        <div className="ob-hint">Key 只存本机 settings.json；国内可用 DeepSeek / Kimi / GLM 的兼容端点。</div>
      </div>
    </section>
  )
}

/** 沙箱可视化块（OpenIntelligentUI 模式）：AI 生成 HTML 进隔离 iframe；按钮 postMessage 回宿主追问 */
/** 后台监控块（FEAT-6）：一眼看到「它正在为我盯什么」——load:getStatus 人话清单 */
function BackendWatchBlock(): JSX.Element | null {
  const [rows, setRows] = useState<Array<{ label: string; human: string }> | null>(null)
  useEffect(() => {
    const pull = (): void => {
      void (window.api as unknown as { getLoadStatus?: () => Promise<{ monitors?: Array<{ label: string; human: string }> }> })?.getLoadStatus?.()
        .then((r) => {
          const list = (r as { monitors?: Array<{ label: string; human: string }> })?.monitors
          if (Array.isArray(list)) setRows(list)
        })
        .catch(() => { /* ignore */ })
    }
    pull()
    const t = window.setInterval(pull, 30_000)
    return () => window.clearInterval(t)
  }, [])
  if (!rows?.length) return null
  return (
    <section className="v10-block">
      <div className="v10-block-kick">
        <span>◇ 后台正在盯</span>
        <span>· {rows.length} 项</span>
      </div>
      {rows.map((r, i) => (
        <div className="v10-plan-row" key={i}>
          <span className="v10-plan-title" style={{ color: 'var(--ink-2)' }}>{r.label}</span>
          <span className="v10-plan-time">{r.human}</span>
        </div>
      ))}
    </section>
  )
}

function SandboxView(props: {
  piece: { id: string; title: string; html: string; css: string }
  onClose: () => void
  onAsk: (q: string) => void
}): JSX.Element {
  // 桥：沙箱内按钮 postMessage {type:'workon-ask', text} → 宿主回填追问
  useEffect(() => {
    const onMsg = (e: MessageEvent): void => {
      const d = e.data as { type?: string; text?: string } | null
      if (d?.type === 'workon-ask' && d.text) props.onAsk(d.text)
    }
    window.addEventListener('message', onMsg)
    return () => window.removeEventListener('message', onMsg)
  }, [props.onAsk])
  // 桥脚本：data-ask 按钮点击 → postMessage 回宿主（LLM 只需输出 <button data-ask="问题">，不用自己写 JS）
  const bridge = `<script>document.addEventListener('click',function(e){var t=e.target.closest('[data-ask]');if(t&&t.dataset.ask)parent.postMessage({type:'workon-ask',text:t.dataset.ask},'*')})<\/script>`
  const doc = `<!DOCTYPE html><html><head><style>body{margin:0;background:#F7F4EE;font-family:sans-serif;color:#2B2B28;}${props.piece.css}</style></head><body>${props.piece.html}${bridge}</body></html>`
  return (
    <section className="v10-block">
      <div className="v10-block-kick">
        <span className="aura-mark">◇</span>
        <span>{props.piece.title}</span>
        <span>· AI 可视化 · 沙箱隔离</span>
        <span className="acts"><button onClick={props.onClose}>×</button></span>
      </div>
      <iframe
        className="v10-sandbox"
        sandbox="allow-scripts"
        srcDoc={doc}
        title={props.piece.title}
      />
    </section>
  )
}

/** 归档抽屉（v10 §5）：重要通知到期后落这里，标题=内容总结（首句截断），可展开 */
function FoldArchive(props: { items: FeedItem[] }): JSX.Element {
  const [open, setOpen] = useState(false)
  const [topic, setTopic] = useState<'all' | 'project' | 'life' | 'general'>('all')
  const summarize = (b: string): string => (b.length > 22 ? `${b.slice(0, 22)}…` : b)
  const TOPIC_LABEL: Record<string, string> = { project: '项目', life: '生活', general: '通用' }
  const shown = topic === 'all' ? props.items : props.items.filter((x) => (x.topic ?? 'general') === topic)
  const counts = props.items.reduce<Record<string, number>>((m, x) => {
    const k = x.topic ?? 'general'
    m[k] = (m[k] ?? 0) + 1
    return m
  }, {})
  return (
    <div className="v10-archive">
      <button className="ar-head" onClick={() => setOpen(!open)}>
        归档 · {props.items.length} 条重要件 {open ? '▾' : '▸'}
      </button>
      {open ? (
        <>
          <div className="ar-tabs">
            {(['all', 'project', 'life', 'general'] as const).map((t) => (
              <button key={t} className={`ar-tab${topic === t ? ' on' : ''}`} onClick={() => setTopic(t)}>
                {t === 'all' ? `全部 ${props.items.length}` : `${TOPIC_LABEL[t]} ${counts[t] ?? 0}`}
              </button>
            ))}
          </div>
          {shown.map((f) => (
            <div className="ar-row" key={f.id}>
              <span className="ar-title">{summarize(f.title === f.body ? f.body : `${f.title}｜${f.body}`)}</span>
              <span className="ar-time">{new Date(f.time).getHours()}:{String(new Date(f.time).getMinutes()).padStart(2, '0')}</span>
            </div>
          ))}
        </>
      ) : null}
    </div>
  )
}

/** 首启三步卡（v10 §2 指引式首启）：工作类型 → 提醒意愿+协议启蒙 */
function OnboardCard(props: {
  step: 0 | 1 | 2
  onFinish: (payload: { evening?: boolean }) => void
}): JSX.Element {
  const [occ, setOcc] = useState<string | null>(null)
  if (props.step === 0) {
    const pick = (o: string): void => {
      setOcc(o)
      try { window.localStorage.setItem('v10occupation', o) } catch { /* ignore */ }
    }
    return (
      <div className="v10-onboard">
        <div className="ob-title">开始之前，一句就好——你主要做什么工作？</div>
        <div className="ob-row">
          {['开发', '创作', '学生', '管理', '其他'].map((o) => (
            <button key={o} className={`ob-pick${occ === o ? ' picked' : ''}`} onClick={() => pick(o)}>{o}</button>
          ))}
        </div>
        <button className="ob-next" onClick={() => props.onFinish({})}>下一步 →</button>
      </div>
    )
  }
  if (props.step === 1) {
    return (
      <div className="v10-onboard">
        <div className="ob-title">右页就是你的版面。折上三块已备好；生活块（毒鸡汤/黄历/打卡）要吗？</div>
        <div className="ob-row">
          <button className="ob-pick" onClick={() => { try { window.localStorage.setItem('v10lifeblocks','1') } catch { /* ignore */ } window.dispatchEvent(new CustomEvent('v10:lifeblocks', { detail: true })) }}>要，加点生活气</button>
          <button className="ob-pick" onClick={() => { try { window.localStorage.setItem('v10lifeblocks','0') } catch { /* ignore */ } }}>先不用，保持干净</button>
        </div>
        <button className="ob-next" onClick={() => props.onFinish({})}>下一步 →</button>
      </div>
    )
  }
  return (
    <div className="v10-onboard">
      <div className="ob-title">要每晚 21:00 送一份今日章吗？（应用内提醒，不打扰预算）</div>
      <div className="ob-row">
        <button className="ob-pick" onClick={() => props.onFinish({ evening: true })}>要，每晚 21:00</button>
        <button className="ob-pick" onClick={() => props.onFinish({})}>不用了</button>
      </div>
      <div className="ob-hint">这也是快捷回复的演示——以后我说话带 ①②，回数字就行。</div>
    </div>
  )
}

export function PaperPane(props: {
  dateLabel: string
  plans: PlanItem[]
  goals?: GoalView[]
  onMarkAnchor?: (goalId: string, anchorId: string, status: 'hit' | 'pending') => void
  onGoalPatch?: (goalId: string, patch: unknown) => void
  trail: TrailSegment[]
  presence: PresenceSnapshot | null
  onTogglePlan: (p: PlanItem) => void
  onExit?: () => void
  onboardStep?: 0 | 1 | 2
  onOnboardFinish?: (payload: { evening?: boolean }) => void
  feed?: FeedItem[]
  archived?: FeedItem[]
  blockParams?: BlockParams
  onDropBlock?: (b: ObjectChipData) => void
  now?: number
  aiOn?: boolean | null
  showFlowMap?: boolean
  mindMapText?: string | null
  onCloseMindMap?: () => void
  sandboxBlock?: { id: string; title: string; html: string; css: string } | null
  onCloseSandbox?: () => void
  onSandboxAsk?: (q: string) => void
  theme?: 'light' | 'dark' | 'auto'
  onToggleTheme?: () => void
  onMinimize?: () => void
  onHideToTray?: () => void
  reminders?: Array<{ id: string; title: string; atHHMM?: string; recurring?: string; origin?: string; enabled?: boolean }>
  onReminderRemoved?: (id: string) => void
  /** FEAT-1：窗格换装——切换这片窗格装的内容页 */
  onSwapContent?: () => void
  /** 框即会话（v10 简化模型）：块→左栏切换上下文并预填 */
  onContextAsk?: (key: 'timeline' | 'plans' | 'goals' | 'reminders', q: string) => void
  aiConfigOpen?: boolean
  onCloseAiConfig?: () => void
  onAiConfigSaved?: () => void
  onFeedReorder?: (from: number, to: number) => void
  onQuoteFeed?: (text: string) => void
  /** main=主窗右栏（可拆出）· paper=拆出独立窗（可合回，报头即拖拽区）· detached=已拆出主窗占位 */
  pane?: 'main' | 'paper' | 'detached'
  onAttach?: () => void
  onDetach?: () => void
}): JSX.Element {
  const feed = props.feed ?? []
  const archived = props.archived ?? []
  const days = props.blockParams?.timelineDays ?? 1
  const pane = props.pane ?? 'main'
  const [aiCfg, setAiCfg] = useState(false)
  // 块管理（v10 拍板：「留住/固定」真实化——置顶排序；「×」隐藏可恢复；localStorage 持久）
  const [blockState, setBlockState] = useState<{ pinned: string[]; hidden: string[] }>(() => {
    try {
      return JSON.parse(window.localStorage.getItem('v10blocks') ?? '') ?? { pinned: [], hidden: [] }
    } catch {
      return { pinned: [], hidden: [] }
    }
  })
  const setBlocks = (next: { pinned: string[]; hidden: string[] }): void => {
    setBlockState(next)
    try { window.localStorage.setItem('v10blocks', JSON.stringify(next)) } catch { /* ignore */ }
  }
  const togglePin = (key: string): void => {
    const pinned = blockState.pinned.includes(key)
      ? blockState.pinned.filter((x) => x !== key)
      : [...blockState.pinned, key]
    setBlocks({ ...blockState, pinned })
  }
  const toggleHide = (key: string): void => {
    const hidden = blockState.hidden.includes(key)
      ? blockState.hidden.filter((x) => x !== key)
      : [...blockState.hidden, key]
    setBlocks({ ...blockState, hidden })
  }
  const BLOCK_LABEL: Record<string, string> = { now: '此刻', plans: '今日计划', timeline: '今日轨迹', goals: '人生预期', reminders: '提醒' }
  const isPinned = (key: string): boolean => blockState.pinned.includes(key)
  const isHidden = (key: string): boolean => blockState.hidden.includes(key)
  /** kick 行真实动作组（留住=置顶固定 · ×=隐藏），pinned 时锚实心 */
  const Kick = (props2: { blockKey: string; extra?: JSX.Element }): JSX.Element => (
    <span className="acts">
      {props2.extra}
      <button
        className={`blk-pin${isPinned(props2.blockKey) ? ' on' : ''}`}
        title={isPinned(props2.blockKey) ? '取消固定' : '固定到版面顶部'}
        onClick={() => togglePin(props2.blockKey)}
      >
        {isPinned(props2.blockKey) ? '◆ 已固定' : '◇ 留住'}
      </button>
      <button className="blk-hide" title="隐藏（可在下方恢复）" onClick={() => toggleHide(props2.blockKey)}>×</button>
    </span>
  )
  if (pane === 'detached') {
    // 已拆出：主窗右栏位置显示占位+合回（真实内容在独立工作台窗）
    return (
      <main className="v10-paper" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div className="v10-detached-card">
          <div className="dc-title">右页已拆出</div>
          <div className="dc-sub">它在自己的窗口里活着——数据实时同步，拖到屏幕边缘可吸附停靠。</div>
          <button className="dc-btn" onClick={() => props.onAttach?.()}>⇲ 合回主窗</button>
        </div>
      </main>
    )
  }
  return (
    <main className="v10-paper">
      <header className="v10-masthead draggable">
        <div className="mh-row">
          <div className="mh-title">WorkOn · 一面</div>
          <span className="mh-statepill">
            <span className="mh-dot" />
            {(() => {
              const st = props.presence?.state
              const main = props.presence?.screens?.find((x) => x.screen === props.presence?.mainScreen)
              return st ? `${WORK_STATES[st].emoji} ${STATE_LABEL[st]} · ${main?.app ?? ''}` : '等待采集'
            })()}
          </span>
          <span className="mh-focus">专注 {Math.round((props.presence?.continuousFocusSec ?? 0) / 60)} 分钟</span>
          <span style={{ marginLeft: 'auto' }} className="mh-clock">
            {props.now !== undefined ? new Date(props.now).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) : ''}
          </span>
          <button className="mh-act" onClick={() => props.onToggleTheme?.()} title="主题：浅/暗/跟随系统">{props.theme === 'dark' ? '☾' : props.theme === 'auto' ? 'A' : '◐'}</button>
          <span
            className={`mh-ai ${props.aiOn ? 'on' : ''}`}
            title={props.aiOn ? 'AI 已接入——点击改配置/看状态' : 'AI 未接入——点击接入（填 Key 即可）'}
            style={{ cursor: 'pointer' }}
            onClick={() => setAiCfg(true)}
          >
            {props.aiOn ? 'AI ✓' : 'AI 未接入'}
          </span>
          {pane !== 'main' ? (
            <>
              <button className="mh-act" onClick={() => { void window.api?.snapPanes?.() }} title="两块玻璃片贴合固定（上下/左右按当前方位）">⎯ 吸附</button>
              <button className="mh-act" onClick={() => props.onSwapContent?.()} title="这片窗格换装：对话 ⇄ 看板">⇄ 换页</button>
            </>
          ) : null}
          <button className="mh-act" onClick={() => setAiCfg(true)} title="设置（AI Key/端点/模型）">⚙ 设置</button>
          {pane === 'main' ? (
            <>
              <button className="mh-act" onClick={() => props.onDetach?.()} title="拆出：右页独立窗口（吸附+位置记忆）">⇱</button>
              <button className="mh-act" onClick={() => { void window.api?.detachPanes?.() }} title="玻璃拆开：两块穿透玻璃片，磁性吸附">◫</button>
            </>
          ) : pane === 'paper' ? (
            <>
              <button className="mh-act" onClick={() => { void window.api?.winHideWorkbench?.() }} title="缩小到任务栏">—</button>
              <button className="mh-act" onClick={() => props.onAttach?.()} title="合回主窗一面">⇲</button>
            </>
          ) : null}
          <span className="mh-winsep" />
          {pane === 'main' ? (
            <>
              <button className="mh-winbtn" onClick={() => props.onMinimize?.()} title="最小化">—</button>
              <button className="mh-winbtn close" onClick={() => props.onHideToTray?.()} title="收进托盘（点托盘图标唤回）">✕</button>
            </>
          ) : pane === 'paper' ? (
            <button className="mh-winbtn close" onClick={() => { void window.api?.winHideWorkbench?.() }} title="收起右页（任务栏/托盘唤回）">✕</button>
          ) : (
            <button className="mh-winbtn close" onClick={() => { void window.api?.collapsePane?.('paper') }} title="收起这块玻璃片（托盘玻璃模式唤回）">✕</button>
          )}
        </div>
        <div className="mh-sub">
          <span className="mh-dot" />
          <span>{props.dateLabel}</span>
          <span>·</span>
          <span>{props.plans.filter((p) => p.status === 'done').length} 件已完成</span>
          <span>·</span>
          <span>剩余 {props.plans.filter((p) => p.status === 'planned' || p.status === 'in_progress').length} 件待办</span>
        </div>
      </header>

      {props.onboardStep !== undefined && props.onboardStep < 3 && props.onOnboardFinish ? (
        <div className="v10-fold-above" style={{ paddingBottom: 0 }}>
          <OnboardCard step={props.onboardStep} onFinish={props.onOnboardFinish} />
        </div>
      ) : null}

      <div className="v10-fold-above">
        <div className="v10-fold-label">折 上 · 你 的 版 面{blockState.pinned.length ? ` · ◆ 已固定 ${blockState.pinned.length}` : ''}</div>
        {blockState.hidden.length ? (
          <div className="v10-hiddenrow">
            已隐藏：{blockState.hidden.map((h) => (
              <button key={h} className="v10-unhide" onClick={() => toggleHide(h)}>{BLOCK_LABEL[h] ?? h} ↩</button>
            ))}
          </div>
        ) : null}
        
        {(props.aiConfigOpen || aiCfg) ? (
          <AiConfigBlock
            onClose={() => { props.onCloseAiConfig?.(); setAiCfg(false) }}
            onSaved={() => { props.onAiConfigSaved?.(); setAiCfg(false) }}
          />
        ) : null}
        {props.sandboxBlock ? (
          <SandboxView
            piece={props.sandboxBlock}
            onClose={() => props.onCloseSandbox?.()}
            onAsk={(q) => props.onSandboxAsk?.(q)}
          />
        ) : null}
        {props.mindMapText ? (
          <section className="v10-block">
            <div className="v10-block-kick">
              <span className="aura-mark">◇</span>
              <span>思维导图</span>
              <span>· 回答的再结构化</span>
              <span className="acts"><button onClick={() => props.onCloseMindMap?.()}>×</button></span>
            </div>
            <MindMap text={props.mindMapText} rootLabel="回答" width={860} />
          </section>
        ) : null}
        {props.showFlowMap ? (
          <section className="v10-block">
            <div className="v10-block-kick">
              <span className="aura-mark">◇</span>
              <span>状态导图</span>
              <span>· 实线=实际 · 虚线=建议</span>
              <span className="acts"><button onClick={() => props.onExit?.()}>×</button></span>
            </div>
            <Shrinkable scale={0.7} hint="状态导图 · 移过放大">
              <FlowMap trail={props.trail} plans={props.plans} goals={props.goals ?? []} />
            </Shrinkable>
          </section>
        ) : null}
        {/* 置顶排序（v10 拍板）：留住（固定）的块自动排最前 */}
        {([
          { key: 'now', pinned: isPinned('now'), node: (<NowBlock presence={props.presence} kick={Kick} pinned={isPinned('now')} hidden={isHidden('now')} />) },
          { key: 'plans', pinned: isPinned('plans'), node: (<TodayPlansBlock plans={props.plans} onToggle={props.onTogglePlan} kick={Kick} pinned={isPinned('plans')} hidden={isHidden('plans')} onContextAsk={props.onContextAsk} />) },
          { key: 'timeline', pinned: isPinned('timeline'), node: (<TimelineBlock trail={props.trail} days={days} kick={Kick} pinned={isPinned('timeline')} hidden={isHidden('timeline')} onContextAsk={props.onContextAsk} />) },
          { key: 'goals', pinned: isPinned('goals'), node: (props.onMarkAnchor ? (
          <GoalsBlock goals={props.goals ?? []} onMarkAnchor={props.onMarkAnchor} onGoalPatch={props.onGoalPatch ?? (() => {})} onContextAsk={props.onContextAsk} />
        ) : null) },
          { key: 'reminders', pinned: isPinned('reminders'), node: (
          <RemindersBlock
            reminders={props.reminders ?? []}
            kick={Kick}
            pinned={isPinned('reminders')}
            hidden={isHidden('reminders')}
            onRemove={(id) => { void window.api?.removeReminder?.(id); props.onReminderRemoved?.(id) }}
          />
        ) },
        ] as Array<{ key: string; pinned: boolean; node: JSX.Element }>)
          .sort((a, b) => Number(b.pinned) - Number(a.pinned))
          .map(({ node }) => node)}

      </div>

      <div className="v10-foldline">
        <span className="fl-label">折 线 · 新 来 的 不 碰 会 自 己 消</span>
      </div>

      <div className="v10-fold-below">
        {archived.length > 0 ? <FoldArchive items={archived} /> : null}
        {feed.length === 0 ? (
          <div className="v10-aura-card">
            <div style={{ fontSize: 12.5, color: 'var(--ink)' }}>
              新来的会落在这里——报表、观察、提醒到点。不碰会自己消，拖到折线上归你。
            </div>
            <div className="ttl">
              <span>◇ 折下 · 推送区</span>
              <span>等待新来件</span>
            </div>
          </div>
        ) : (
          feed.map((f, fi) => (
            <div
              className="v10-aura-card"
              key={f.id}
              draggable
              onDragStart={(e) => e.dataTransfer.setData('application/x-workon-feed', String(fi))}
              onDragOver={(e) => {
                if (e.dataTransfer.types.includes('application/x-workon-feed')) e.preventDefault()
              }}
              onDrop={(e) => {
                const from = e.dataTransfer.getData('application/x-workon-feed')
                if (from !== '') props.onFeedReorder?.(Number(from), fi)
              }}
            >
              <div style={{ fontSize: 12.5, color: 'var(--ink)' }}>
                <strong style={{ marginRight: 6 }}>{f.title}</strong>
                {f.body}
              </div>
              <div className="ttl">
                <span>◇ {f.keep ? '重要 · 到期转归档' : '通知'} · {new Date(f.time).getHours()}:{String(new Date(f.time).getMinutes()).padStart(2, '0')}</span>
                <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <button
                    style={{ border: 'none', background: 'none', color: 'var(--teal-ink)', cursor: 'pointer', fontSize: 10.5, padding: 0, fontFamily: 'var(--font-ui)' }}
                    onClick={() => props.onQuoteFeed?.(`${f.title}——${f.body}`)}
                  >
                    引用到对话
                  </button>
                  <span>{Math.max(0, Math.ceil((f.time + f.ttlSec * 1000 - (props.now ?? Date.now())) / 1000))}s 后自动收起</span>
                </span>
              </div>
              <div className="ttl-bar" />
            </div>
          ))
        )}
      </div>
    </main>
  )
}
