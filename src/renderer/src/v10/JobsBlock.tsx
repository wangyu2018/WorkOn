/**
 * v10 事务块：把「需要长期跟进的事」交给本地控制面或云作业服务器。
 *
 * 低资源口径：
 * - 本机只负责定义/审批/查看；Agent 步骤必须派发到云节点
 * - shell 步骤在本机执行前需要一次点击确认
 * - 每个事务有预算上限，云端单机默认并发 1
 */
import { useEffect, useMemo, useState } from 'react'
import type { CommitmentRecord, JobRecord, JobSnapshot } from '@shared/job'
import { DEFAULT_JOB_POLICY, JOB_STATE_LABEL, triggerLabel } from '@shared/job'

function fmt(ts?: number): string {
  if (!ts) return '—'
  const d = new Date(ts)
  return d.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  })
}

function stateClass(state: JobRecord['state']): string {
  if (state === 'succeeded') return 'ok'
  if (state === 'failed' || state === 'canceled') return 'bad'
  if (state === 'needs_human') return 'warn'
  return 'run'
}

export function JobsBlock(): JSX.Element {
  const [snap, setSnap] = useState<JobSnapshot>({ commitments: [], jobs: [], nodes: [] })
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [title, setTitle] = useState('')
  const [intent, setIntent] = useState('')
  const [triggerKind, setTriggerKind] = useState<'manual' | 'interval' | 'daily'>('manual')
  const [intervalMin, setIntervalMin] = useState(30)
  const [atHHMM, setAtHHMM] = useState('09:00')
  const [targetKind, setTargetKind] = useState<'local' | 'node'>('local')
  const [nodeId, setNodeId] = useState('')
  const [mode, setMode] = useState<'agent' | 'shell'>('agent')
  const [command, setCommand] = useState('')

  const onlineNodes = useMemo(() => snap.nodes.filter((n) => n.online), [snap.nodes])

  const load = (): void => {
    void window.api
      ?.getJobSnapshot?.()
      .then((s) => {
        const next = s as JobSnapshot
        setSnap(next)
        if (!nodeId && next.nodes.some((n) => n.online)) {
          setNodeId(next.nodes.find((n) => n.online)?.id ?? '')
          setTargetKind('node')
        }
      })
      .catch(() => undefined)
  }

  useEffect(() => {
    load()
    const off = window.api?.onJobChanged?.(() => load())
    const t = setInterval(load, 30_000)
    return () => {
      off?.()
      clearInterval(t)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const resetForm = (): void => {
    setTitle('')
    setIntent('')
    setCommand('')
    setTriggerKind('manual')
    setMode('agent')
    setMsg('')
  }

  const save = async (): Promise<void> => {
    const goal = intent.trim()
    if (!goal) {
      setMsg('先写一句要托管的事')
      return
    }
    if (mode === 'shell' && !command.trim()) {
      setMsg('shell 模式需要一条命令')
      return
    }
    const target = targetKind === 'node' && nodeId
      ? ({ kind: 'node', nodeId, label: onlineNodes.find((n) => n.id === nodeId)?.label ?? nodeId } as const)
      : ({ kind: 'local' } as const)
    if (mode === 'agent' && target.kind === 'local') {
      setMsg('Agent 步骤需要云作业服务器：先选一个在线节点，或把模式改成 shell')
      return
    }
    const trigger =
      triggerKind === 'manual'
        ? ({ kind: 'manual' } as const)
        : triggerKind === 'interval'
          ? ({ kind: 'interval', everyMs: Math.max(1, intervalMin) * 60_000 } as const)
          : ({ kind: 'daily', atHHMM } as const)
    const plan = {
      steps: [
        mode === 'agent'
          ? { id: 's1', kind: 'agent' as const, title: '执行', goal }
          : { id: 's1', kind: 'shell' as const, title: '执行命令', command: command.trim() }
      ]
    }
    setBusy(true)
    setMsg('')
    try {
      await window.api?.saveCommitment?.({
        title: title.trim() || goal.slice(0, 24),
        intent: goal,
        plan,
        trigger,
        policy: DEFAULT_JOB_POLICY,
        target
      })
      resetForm()
      setOpen(false)
      load()
    } catch (e) {
      setMsg((e as Error).message || '保存失败')
    } finally {
      setBusy(false)
    }
  }

  const run = async (c: CommitmentRecord): Promise<void> => {
    setBusy(true)
    try {
      await window.api?.runCommitment?.(c.id, true)
      load()
    } finally {
      setBusy(false)
    }
  }

  const toggle = async (c: CommitmentRecord): Promise<void> => {
    await window.api?.patchCommitment?.(c.id, {
      status: c.status === 'active' ? 'paused' : 'active',
      nextRunAt: Date.now()
    })
    load()
  }

  const remove = async (c: CommitmentRecord): Promise<void> => {
    await window.api?.removeCommitment?.(c.id)
    load()
  }

  return (
    <section className="v10-block v10-jobs">
      <div className="v10-block-kick">
        <span className="aura-mark">◇</span>
        <span>事务</span>
        <span>· {snap.commitments.filter((c) => c.status === 'active').length} 个在管 · 长任务</span>
        <span className="acts">
          <button onClick={() => setOpen((v) => !v)}>{open ? '收起' : '新托管'}</button>
        </span>
      </div>

      <div className="v10-jobs-note">
        本机只做定义、审批和查看；Agent 步骤派发到云作业服务器，退出应用后仍会继续。
        云端单机默认并发 1，适合 2C2G 起步。
      </div>

      {open ? (
        <div className="v10-jobs-form">
          <div className="v10-jobs-row">
            <input
              className="v10-jobs-input"
              placeholder="事务名（可留空）"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
            <select
              className="v10-jobs-select"
              value={targetKind === 'node' ? `node:${nodeId}` : 'local'}
              onChange={(e) => {
                const v = e.target.value
                if (v === 'local') {
                  setTargetKind('local')
                } else {
                  setTargetKind('node')
                  setNodeId(v.slice(5))
                }
              }}
            >
              <option value="local">本机（仅轻步骤）</option>
              {snap.nodes.map((n) => (
                <option key={n.id} value={`node:${n.id}`} disabled={!n.online}>
                  云节点 · {n.label}{n.online ? '' : '（离线）'}
                </option>
              ))}
            </select>
          </div>

          <textarea
            className="v10-jobs-textarea"
            placeholder="要长期托管什么？例如：每天 9 点检查一次项目依赖是否有安全更新，有变化就汇总给我。"
            value={intent}
            onChange={(e) => setIntent(e.target.value)}
            rows={3}
          />

          <div className="v10-jobs-row">
            <select
              className="v10-jobs-select"
              value={triggerKind}
              onChange={(e) => setTriggerKind(e.target.value as typeof triggerKind)}
            >
              <option value="manual">手动运行</option>
              <option value="interval">按间隔</option>
              <option value="daily">每天定时</option>
            </select>
            {triggerKind === 'interval' ? (
              <label className="v10-jobs-inline">
                每
                <input
                  className="v10-jobs-num"
                  type="number"
                  min={1}
                  value={intervalMin}
                  onChange={(e) => setIntervalMin(Number(e.target.value) || 1)}
                />
                分钟
              </label>
            ) : null}
            {triggerKind === 'daily' ? (
              <input
                className="v10-jobs-input"
                style={{ maxWidth: 110 }}
                value={atHHMM}
                onChange={(e) => setAtHHMM(e.target.value)}
                placeholder="09:00"
              />
            ) : null}
            <select
              className="v10-jobs-select"
              value={mode}
              onChange={(e) => setMode(e.target.value as typeof mode)}
            >
              <option value="agent">Agent 执行（云）</option>
              <option value="shell">命令（本机/云）</option>
            </select>
          </div>

          {mode === 'shell' ? (
            <input
              className="v10-jobs-input"
              placeholder="命令，例如：npm audit --json"
              value={command}
              onChange={(e) => setCommand(e.target.value)}
            />
          ) : null}

          <div className="v10-jobs-row v10-jobs-actions">
            <button className="v10-jobs-primary" disabled={busy} onClick={() => void save()}>
              保存托管
            </button>
            <button onClick={resetForm} disabled={busy}>清空</button>
            {msg ? <span className="v10-jobs-msg">{msg}</span> : null}
          </div>
        </div>
      ) : null}

      {snap.commitments.length === 0 ? (
        <div className="v10-jobs-empty">还没有托管事务。点「新托管」把一件需要长期跟进的事交给它。</div>
      ) : (
        <div className="v10-jobs-list">
          {snap.commitments.map((c) => {
            const last = snap.jobs.find((j) => j.commitmentId === c.id)
            return (
              <div className="v10-jobs-item" key={c.id}>
                <div className="v10-jobs-main">
                  <div className="v10-jobs-title">
                    {c.title}
                    <span className={`v10-jobs-badge ${c.status === 'active' ? 'ok' : 'off'}`}>
                      {c.status === 'active' ? '在管' : c.status === 'paused' ? '暂停' : c.status}
                    </span>
                  </div>
                  <div className="v10-jobs-sub">
                    {triggerLabel(c.trigger)} · {c.target.kind === 'node' ? `云 · ${c.target.label}` : '本机'}
                    {c.nextRunAt ? ` · 下次 ${fmt(c.nextRunAt)}` : ''}
                    {last ? ` · 上次 ${JOB_STATE_LABEL[last.state]}` : ''}
                  </div>
                  {last?.lastError ? <div className="v10-jobs-err">{last.lastError}</div> : null}
                  {last?.result ? <div className="v10-jobs-result">{last.result.slice(0, 160)}</div> : null}
                </div>
                <div className="v10-jobs-ops">
                  <button disabled={busy} onClick={() => void run(c)}>运行</button>
                  <button onClick={() => void toggle(c)}>{c.status === 'active' ? '暂停' : '恢复'}</button>
                  <button className="danger" onClick={() => void remove(c)}>删除</button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {snap.jobs.length > 0 ? (
        <div className="v10-jobs-recent">
          <div className="v10-jobs-recent-title">最近作业</div>
          {snap.jobs.slice(0, 5).map((j) => (
            <div className="v10-jobs-job" key={j.id}>
              <span className={`v10-jobs-state ${stateClass(j.state)}`}>{JOB_STATE_LABEL[j.state]}</span>
              <span className="v10-jobs-job-title">{j.title}</span>
              <span className="v10-jobs-job-meta">
                {j.target.kind === 'node' ? j.target.label : '本机'} · {fmt(j.updatedAt)}
              </span>
              {j.state === 'needs_human' ? (
                <button onClick={() => void window.api?.approveJob?.(j.id)}>确认</button>
              ) : null}
              {j.state === 'queued' || j.state === 'leased' || j.state === 'running' || j.state === 'waiting' ? (
                <button className="danger" onClick={() => void window.api?.cancelJob?.(j.id)}>取消</button>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
    </section>
  )
}
