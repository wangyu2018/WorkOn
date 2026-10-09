/**
 * 右栏「表」：活页结构（v10 §3.3）
 * 报头 sticky（唯一永久物）→ 折上（你的版面，栏目三段式）→ 折线 → 折下（TTL 推送区）
 */
import { useState } from 'react'
import type { PlanItem, TrailSegment, PresenceSnapshot } from '@shared/types'
import type { BlockParams } from './V10Surface'
import type { ObjectChipData } from './AskPane'

/** 折下数据流：真实 notify 卡 + 提醒事件（v10 §5 消息总线的 v10 侧呈现） */
export interface FeedItem {
  kind: 'notify'
  id: string
  title: string
  body: string
  time: number
  ttlSec: number
}
import { WORK_STATES, STATE_LABEL } from '@shared/stateMeta'
import { displayApp } from '@shared/appDisplayName'

function hhmm(ts: number): string {
  const d = new Date(ts)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function TodayPlansBlock(props: { plans: PlanItem[]; onToggle: (p: PlanItem) => void }): JSX.Element {
  const today = new Date()
  const key = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
  const list = props.plans.filter((p) => p.date === key && p.status !== 'cancelled')
  const done = list.filter((p) => p.status === 'done').length
  const sorted = [...list].sort((a, b) => (a.startMin ?? 1e9) - (b.startMin ?? 1e9))
  return (
    <section className="v10-block">
      <div className="v10-block-kick">
        <span>◆ 今日计划</span>
        <span>· {done}/{list.length}</span>
        <span className="acts"><button>留住</button><button>×</button></span>
      </div>
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
  const s = props.presence?.state
  const main = props.presence?.screens?.find((x) => x.screen === props.presence?.mainScreen)
  const focusMin = Math.round((props.presence?.continuousFocusSec ?? 0) / 60)
  return (
    <section className="v10-block">
      <div className="v10-block-kick">
        <span>◆ 此刻</span>
        <span className="acts"><button>留住</button><button>×</button></span>
      </div>
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
  const cutoff = Date.now() - days * 24 * 3600_000
  const segs = props.trail.filter((t) => !t.glance && t.startTs >= cutoff).slice(-20).reverse()
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
        <span className="acts"><button>留住</button><button>×</button></span>
      </div>
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
  trail: TrailSegment[]
  presence: PresenceSnapshot | null
  onTogglePlan: (p: PlanItem) => void
  onExit?: () => void
  onboardStep?: 0 | 1 | 2
  onOnboardFinish?: (payload: { evening?: boolean }) => void
  feed?: FeedItem[]
  blockParams?: BlockParams
  onDropBlock?: (b: ObjectChipData) => void
}): JSX.Element {
  const feed = props.feed ?? []
  const days = props.blockParams?.timelineDays ?? 1
  return (
    <main className="v10-paper">
      <header className="v10-masthead">
        <div className="mh-title">WorkOn · 一面</div>
        <div className="mh-sub">
          <span className="mh-dot" />
          <span>{props.dateLabel}</span>
          <span>·</span>
          <span>{props.plans.filter((p) => p.status === 'done').length} 件已完成</span>
          <span>·</span>
          <button
            style={{ marginLeft: 'auto', fontSize: 10.5, color: 'var(--ink-3)', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'var(--font-ui)', padding: 0 }}
            onClick={() => props.onExit?.()}
            title="回到旧版界面（数据完全互通）"
          >
            v10 · 返回旧版 →
          </button>
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
        <TodayPlansBlock plans={props.plans} onToggle={props.onTogglePlan} />
        <TimelineBlock trail={props.trail} days={days} />
      </div>

      <div className="v10-foldline">
        <span className="fl-label">折 线 · 新 来 的 不 碰 会 自 己 消</span>
      </div>

      <div className="v10-fold-below">
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
          feed.map((f) => (
            <div className="v10-aura-card" key={f.id}>
              <div style={{ fontSize: 12.5, color: 'var(--ink)' }}>
                <strong style={{ marginRight: 6 }}>{f.title}</strong>
                {f.body}
              </div>
              <div className="ttl">
                <span>◇ 通知 · {new Date(f.time).getHours()}:{String(new Date(f.time).getMinutes()).padStart(2, '0')}</span>
                <span>{f.ttlSec}s 后自动收起</span>
              </div>
              <div className="ttl-bar" />
            </div>
          ))
        )}
      </div>
    </main>
  )
}
