/**
 * 右栏「表」：活页结构（v10 §3.3）
 * 报头 sticky（唯一永久物）→ 折上（你的版面，栏目三段式）→ 折线 → 折下（TTL 推送区）
 */
import type { PlanItem, TrailSegment, PresenceSnapshot } from '@shared/types'
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

function TimelineBlock(props: { trail: TrailSegment[] }): JSX.Element {
  const segs = props.trail.filter((t) => !t.glance).slice(-14).reverse()
  return (
    <section className="v10-block">
      <div className="v10-block-kick">
        <span>◆ 今日轨迹</span>
        <span>· 最近 {segs.length} 段</span>
        <span className="acts"><button>留住</button><button>×</button></span>
      </div>
      {segs.length === 0 ? (
        <div className="v10-empty">轨迹会随着采集自动长出来（此平台不支持窗口采集时这里保持空白）。</div>
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

export function PaperPane(props: {
  dateLabel: string
  plans: PlanItem[]
  trail: TrailSegment[]
  presence: PresenceSnapshot | null
  onTogglePlan: (p: PlanItem) => void
  onExit?: () => void
}): JSX.Element {
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
            v10 骨架 · 返回旧版 →
          </button>
        </div>
      </header>

      <div className="v10-fold-above">
        <div className="v10-fold-label">折 上 · 你 的 版 面</div>
        <NowBlock presence={props.presence} />
        <TodayPlansBlock plans={props.plans} onToggle={props.onTogglePlan} />
        <TimelineBlock trail={props.trail} />
      </div>

      <div className="v10-foldline">
        <span className="fl-label">折 线 · 新 来 的 不 碰 会 自 己 消</span>
      </div>

      <div className="v10-fold-below">
        <div className="v10-aura-card">
          <div style={{ fontSize: 12.5, color: 'var(--ink)' }}>
            下午的专注比上午长了 18 分钟——继续保持，晚间的今日章会记录这段趋势。
          </div>
          <div className="ttl">
            <span>◇ 观察 · 自动生成</span>
            <span>约 4 分钟后自动收起</span>
          </div>
          <div className="ttl-bar" />
        </div>
      </div>
    </main>
  )
}
