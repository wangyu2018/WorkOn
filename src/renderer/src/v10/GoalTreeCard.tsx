/** 目标树确认卡：编排节点、边上数据标签与只读节点详情。 */
import { useState } from 'react'
import type { GoalTreeDraft } from '@shared/types'

function hhmm(min: number): string {
  return `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`
}

function dayLabel(date: string): string {
  const d = new Date(`${date}T12:00:00`)
  return `${d.getMonth() + 1}/${d.getDate()} 周${'日一二三四五六'[d.getDay()]}`
}

export function GoalTreeCard({ draft }: { draft: GoalTreeDraft }): JSX.Element {
  const [detail, setDetail] = useState<{ title: string; lines: string[] } | null>(null)
  const milestones = draft.paths.flatMap((p) => p.milestones)
  const milestoneTitle = (id: string): string => milestones.find((m) => m.id === id)?.title ?? '目标推进'
  return (
    <div className="v10-goal-tree" data-source={draft.source}>
      <button
        className="v10-gt-node v10-gt-goal"
        onClick={() => setDetail({ title: draft.event, lines: [`截止 ${draft.deadline}`, `建议日均 ${draft.dailyTargetMin} 分钟`, `归因词：${draft.keywords.join('、') || '待补充'}`] })}
      >
        <span className="v10-gt-kind">目标</span>
        <strong>{draft.event}</strong>
        <span className="v10-gt-meta">{draft.deadline} · 日均 {draft.dailyTargetMin} 分钟</span>
      </button>
      <div className="v10-gt-edge"><i /><span>{draft.paths.length} 条路径 · {milestones.length} 个里程碑</span></div>

      <div className="v10-gt-paths">
        {draft.paths.map((path, pi) => (
          <section className="v10-gt-path" key={path.id}>
            <button
              className="v10-gt-node v10-gt-path-node"
              onClick={() => setDetail({ title: path.title, lines: [path.rationale || '这条路径用于支撑总目标', `需要能力：${path.skills.join('、') || '待补充'}`, `投入占比 ${Math.round(path.weight * 100)}%`] })}
            >
              <span className="v10-gt-kind">路径 {pi + 1}</span>
              <strong>{path.title}</strong>
              <span className="v10-gt-weight">{Math.round(path.weight * 100)}%</span>
            </button>
            <div className="v10-gt-edge v10-gt-edge-small"><i /><span>投入 {Math.round(path.weight * 100)}% · 排期 {path.milestones.length} 个</span></div>
            <div className="v10-gt-milestones">
              {path.milestones.map((m, mi) => (
                <button
                  className="v10-gt-node v10-gt-milestone"
                  key={m.id}
                  onClick={() => setDetail({ title: m.title, lines: [`日期 ${m.targetDate}`, `产出：${m.deliverables.join('；') || '待明确'}`, `项目：${m.bindProjectId ? '绑定已有项目' : (m.projectName || path.title)}`] })}
                >
                  <span className="v10-gt-index">{mi + 1}</span>
                  <span><strong>{m.title}</strong><small>{m.targetDate}</small></span>
                  {mi === 0 && path.milestones.length > 1 ? <em>还有 {path.milestones.length - 1} 个</em> : null}
                </button>
              ))}
            </div>
          </section>
        ))}
      </div>

      <div className="v10-gt-edge"><i /><span>本周 {draft.weekBlocks.length} 块 · 每块都有归属里程碑</span></div>
      <div className="v10-gt-week">
        {draft.weekBlocks.map((b, i) => (
          <button
            className="v10-gt-node v10-gt-block"
            key={`${b.date}-${b.startMin}-${i}`}
            onClick={() => setDetail({ title: b.title, lines: [`${dayLabel(b.date)} ${hhmm(b.startMin)}–${hhmm(b.startMin + b.durationMin)}`, `服务里程碑：${milestoneTitle(b.milestoneId)}`, i === 0 ? '确认后作为第一块执行' : '确认后进入本周计划'] })}
          >
            <span className="v10-gt-block-day">{i === 0 ? '先做' : dayLabel(b.date)}</span>
            <strong>{b.title}</strong>
            <small>{dayLabel(b.date)} · {hhmm(b.startMin)} · {b.durationMin} 分</small>
          </button>
        ))}
      </div>

      {detail ? (
        <div className="v10-gt-detail">
          <div><strong>{detail.title}</strong><button onClick={() => setDetail(null)} aria-label="关闭节点详情">×</button></div>
          {detail.lines.map((line) => <p key={line}>{line}</p>)}
        </div>
      ) : null}
      <div className="v10-gt-foot">
        {draft.source === 'local' ? '本地粗略版 · 建议检查后确认' : 'AI 拆解'} · 点节点看详情 · 整树一次确认
      </div>
    </div>
  )
}
