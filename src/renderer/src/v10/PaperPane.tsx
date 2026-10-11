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

function TodayPlansBlock(props: { plans: PlanItem[]; onToggle: (p: PlanItem) => void }): JSX.Element {
  const today = new Date()
  const [expanded, setExpanded] = useState(false)
  const [showSrc, setShowSrc] = useState(false)
  const key = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
  const list = props.plans.filter((p) => p.date === key && p.status !== 'cancelled')
  const done = list.filter((p) => p.status === 'done').length
  const sortedAll = [...list].sort((a, b) => (a.startMin ?? 1e9) - (b.startMin ?? 1e9))
  const sorted = expanded ? sortedAll : sortedAll.slice(0, 8)
  return (
    <section className="v10-block">
      <div className="v10-block-kick">
        <span>◆ 今日计划</span>
        <span>· {done}/{list.length}</span>
        <span className="acts">
          <button onClick={() => setShowSrc(!showSrc)} title="数据源">源</button>
          <button>留住</button><button>×</button>
        </span>
      </div>
      {showSrc ? (
        <div className="v10-srcnote">数据源：plans 表（单一事实源）· 手动/来件拆路/Oner 同步/AI 生成 四类 source 同库</div>
      ) : null}
      {!expanded && sortedAll.length > 8 ? (
        <button className="v10-foldmore" onClick={() => setExpanded(true)}>展开其余 {sortedAll.length - 8} 件 ▾</button>
      ) : null}
      {sorted.length === 0 ? (
        <div className="v10-empty">今天还没有计划——去左栏说一句「帮我排一下今天」。</div>
      ) : (
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
    </section>
  )
}

function NowBlock(props: { presence: PresenceSnapshot | null }): JSX.Element {
  const [showSrc, setShowSrc] = useState(false)
  const s = props.presence?.state
  const main = props.presence?.screens?.find((x) => x.screen === props.presence?.mainScreen)
  const focusMin = Math.round((props.presence?.continuousFocusSec ?? 0) / 60)
  return (
    <section className="v10-block">
      <div className="v10-block-kick">
        <span>◆ 此刻</span>
        <span className="acts">
          <button onClick={() => setShowSrc(!showSrc)} title="数据源">源</button>
          <button>留住</button><button>×</button>
        </span>
      </div>
      {showSrc ? (
        <div className="v10-srcnote">数据源：presence 引擎（窗口采样 5s + winInfo/winInfoMac）· 状态判定 13 态</div>
      ) : null}
      <div className="v10-block-hero">
        {s ? `${STATE_LABEL[s]}` : '—'}
        <small>{focusMin > 0 ? `今日专注 ${Math.round(focusMin)} 分钟` : '还没有采集到活动'}</small>
      </div>
      <div className="v10-block-meta">
        {s ? `${WORK_STATES[s].emoji} ${main?.title || displayApp(main?.app ?? '') || '无前台应用'}` : '等待采集开始'}
      </div>
    </section>
  )
}

function TimelineBlock(props: { trail: TrailSegment[]; days: number }): JSX.Element {
  const days = props.days
  const [expanded, setExpanded] = useState(false)
  const [showSrc, setShowSrc] = useState(false)
  const cutoff = Date.now() - days * 24 * 3600_000
  const all = props.trail.filter((t) => !t.glance && t.startTs >= cutoff)
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
          <button onClick={() => setShowSrc(!showSrc)} title="数据源">源</button>
          <button>留住</button><button>×</button>
        </span>
      </div>
      {showSrc ? (
        <div className="v10-srcnote">数据源：activities.jsonl → buildMergedTrail 聚合 · 窗口采集 winInfo/winInfoMac</div>
      ) : null}
      {!expanded && all.length > 8 ? (
        <button className="v10-foldmore" onClick={() => setExpanded(true)}>展开更早的 {all.length - 8} 段 ▾</button>
      ) : null}
      {segs.length === 0 ? (
        <div className="v10-empty">{days === 1 ? '轨迹会随着采集自动长出来（此平台不支持窗口采集时这里保持空白）。' : `${days} 天内没有轨迹记录。`}</div>
      ) : (
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
        <span className="v10-goal-dday">D-{v.remainingDays} · {v.goal.deadline.slice(5)}</span>
      </div>
      <div className="v10-goal-bar" title={`已投 ${Math.round(v.cumMin)} 分钟 / 预算 ${Math.round(v.totalTargetMin)} 分钟`}>
        <i style={{ width: `${pct}%` }} />
        <em className="v10-goal-plan" style={{ left: `${planPct}%` }} />
      </div>
      <div className="v10-goal-anchors">
        {v.goal.anchors.map((a) => (
          <span key={a.id} className="v10-goal-anchor-wrap">
            <button
              className={`v10-goal-anchor ${a.status}`}
              title={`${a.targetDate} · 累计刻度 ${Math.round(a.cumTargetMin / 60)}h — 点一下标记达成/还原，长按×删除`}
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
}): JSX.Element {
  const actives = props.goals.filter((v) => v.goal.status === 'active')
  return (
    <section className="v10-block">
      <div className="v10-block-kick">
        <span>◆ 人生预期</span>
        <span>· {actives.length} 条在轨</span>
        <span className="acts"><button>留住</button><button>×</button></span>
      </div>
      {actives.length === 0 ? (
        <div className="v10-empty">还没有预期——去左栏说一句「我想在年底前把 X 做到 Y」，我拆成锚点轨迹替你盯。</div>
      ) : (
        actives.map((v) => <GoalCard key={v.goal.id} v={v} onMarkAnchor={props.onMarkAnchor} onGoalPatch={props.onGoalPatch} />)
      )}
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
  onFeedReorder?: (from: number, to: number) => void
}): JSX.Element {
  const feed = props.feed ?? []
  const archived = props.archived ?? []
  const days = props.blockParams?.timelineDays ?? 1
  return (
    <main className="v10-paper">
      <header className="v10-masthead">
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
          <span className={`mh-ai ${props.aiOn ? 'on' : ''}`} title={props.aiOn ? 'AI 已配置' : 'AI 未配置（设置里填 Key）'}>
            AI
          </span>
          <button className="mh-act" onClick={() => { try { window.api?.openMain?.() } catch { /* ignore */ } }} title="镜：设置/例程/习惯/隐私">镜</button>
          <button className="mh-act" onClick={() => props.onExit?.()} title="回到旧版界面（数据完全互通）">旧版 →</button>
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
        <div className="v10-fold-label">折 上 · 你 的 版 面</div>
        <NowBlock presence={props.presence} />
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
        <TodayPlansBlock plans={props.plans} onToggle={props.onTogglePlan} />
        {props.onMarkAnchor ? (
          <GoalsBlock goals={props.goals ?? []} onMarkAnchor={props.onMarkAnchor} onGoalPatch={props.onGoalPatch ?? (() => {})} />
        ) : null}
        <TimelineBlock trail={props.trail} days={days} />
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
                <span>{Math.max(0, Math.ceil((f.time + f.ttlSec * 1000 - (props.now ?? Date.now())) / 1000))}s 后自动收起</span>
              </div>
              <div className="ttl-bar" />
            </div>
          ))
        )}
      </div>
    </main>
  )
}
