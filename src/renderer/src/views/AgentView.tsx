/**
 * Agent 页：动态连接器注册表 + 本机 Agent
 * - 列表完全来自主进程 agents.json，不写死厂商
 * - 支持探测、编辑、删除、派发；额度按“本机计量 / 手动”展示
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { AgentInput, AgentListResult, AgentRunRecord, AgentView } from '@shared/agents'
import { PageHeader } from '../components/PageHeader'
import { Icon } from '../components/Icon'
import { Modal } from '../components/ui/Modal'
import { useAgentWizardStore } from '../stores/agentWizardStore'

const STATUS_LABEL: Record<string, string> = {
  online: '在线',
  offline: '离线',
  error: '异常',
  unknown: '未探测',
  unavailable: '不可用'
}

const PROTOCOL_LABEL: Record<string, string> = {
  cli: 'CLI',
  mcp: 'MCP',
  acp: 'ACP',
  http: 'HTTP',
  process: '进程',
  manual: '手动'
}

function statusDot(status: string): string {
  if (status === 'online') return 'bg-emerald-400'
  if (status === 'error') return 'bg-rose-400'
  if (status === 'unavailable') return 'bg-slate-600'
  return 'bg-amber-400'
}

function toInput(a: AgentView, patch: Partial<AgentInput> = {}): AgentInput {
  return {
    id: a.id,
    name: a.name,
    protocol: a.protocol,
    endpoint: a.endpoint,
    args: a.args,
    cwd: a.cwd,
    auth: a.auth,
    capabilities: a.capabilities,
    quotaMode: a.quotaMode,
    quotaValue: a.quotaValue,
    probePath: a.probePath,
    dispatchArgs: a.dispatchArgs,
    allowTools: a.allowTools,
    env: a.env,
    enabled: a.enabled,
    ...patch
  }
}

export default function AgentView() {
  const [data, setData] = useState<AgentListResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')
  const [quotaEdits, setQuotaEdits] = useState<Record<string, string>>({})
  const [dispatchFor, setDispatchFor] = useState<AgentView | null>(null)
  const [prompt, setPrompt] = useState('')
  const [cwd, setCwd] = useState('')
  const [confirm, setConfirm] = useState(false)
  const [running, setRunning] = useState(false)
  const [output, setOutput] = useState('')
  const [runsFor, setRunsFor] = useState<AgentView | null>(null)
  const [runs, setRuns] = useState<AgentRunRecord[]>([])
  const [runsBusy, setRunsBusy] = useState(false)
  const openWizard = useAgentWizardStore((s) => s.openWizard)

  const api = window.api as {
    listAgents?: () => Promise<AgentListResult>
    updateAgent?: (id: string, input: AgentInput) => Promise<{ ok: boolean; error?: string }>
    removeAgent?: (id: string) => Promise<boolean>
    probeAgent?: (id: string) => Promise<{ status: string; detail: string } | null>
    dispatchAgent?: (id: string, prompt: string, cwd?: string, confirm?: boolean) => Promise<{ ok: boolean; output: string; error?: string; durationMs: number }>
    listAgentRuns?: (agentId?: string) => Promise<AgentRunRecord[]>
    setAgentRunReference?: (runId: string, reference: boolean) => Promise<AgentRunRecord | null>
    setAgentQuota?: (agentId: string, value: number) => Promise<unknown>
  }

  const reload = useCallback(async () => {
    if (!api.listAgents) return
    setBusy(true)
    try {
      const res = await api.listAgents()
      setData(res)
      setCwd((prev) => prev || res.homeDir)
    } catch (e) {
      setStatus(`加载失败：${(e as Error).message}`)
    } finally {
      setBusy(false)
    }
  }, [api.listAgents])

  useEffect(() => {
    void reload()
    const handler = (): void => { void reload() }
    window.addEventListener('workon:agents-changed', handler)
    return () => window.removeEventListener('workon:agents-changed', handler)
  }, [reload])

  const agents = data?.agents ?? []
  const suggestions = data?.suggestions ?? []
  const builtins = useMemo(() => agents.filter((a) => a.builtin), [agents])
  const dynamic = useMemo(() => agents.filter((a) => !a.builtin), [agents])
  const onlineCount = agents.filter((a) => a.status === 'online').length

  const setQuota = async (a: AgentView): Promise<void> => {
    const value = Number(quotaEdits[a.id] ?? a.quotaValue ?? 0)
    if (a.builtin) {
      await api.setAgentQuota?.(a.id, value)
    } else {
      const res = await api.updateAgent?.(a.id, toInput(a, { quotaMode: 'manual', quotaValue: value }))
      if (res && !res.ok) { setStatus(res.error ?? '额度保存失败'); return }
    }
    setStatus(`已更新 ${a.name} 额度：${value}`)
    void reload()
  }

  const probe = async (a: AgentView): Promise<void> => {
    setStatus(`探测 ${a.name}…`)
    const res = await api.probeAgent?.(a.id)
    setStatus(res ? `${a.name} · ${STATUS_LABEL[res.status] ?? res.status} · ${res.detail}` : '探测失败')
    void reload()
  }

  const remove = async (a: AgentView): Promise<void> => {
    if (!window.confirm(`确认从注册表删除「${a.name}」？`)) return
    await api.removeAgent?.(a.id)
    setStatus(`已删除 ${a.name}`)
    void reload()
  }

  const edit = (a: AgentView): void => {
    openWizard({
      id: a.id,
      name: a.name,
      protocol: a.protocol,
      endpoint: a.endpoint,
      args: a.args,
      cwd: a.cwd,
      auth: a.auth,
      capabilities: a.capabilities,
      quotaMode: a.quotaMode,
      quotaValue: a.quotaValue,
      probePath: a.probePath,
      dispatchArgs: a.dispatchArgs,
      allowTools: a.allowTools,
      env: a.env,
      enabled: a.enabled
    })
  }

  const runDispatch = async (): Promise<void> => {
    if (!dispatchFor || !api.dispatchAgent) return
    if (!prompt.trim() || !confirm) return
    setRunning(true)
    setOutput('')
    try {
      const res = await api.dispatchAgent(dispatchFor.id, prompt.trim(), cwd, confirm)
      setOutput(res.ok ? res.output || '(无输出)' : `失败：${res.error ?? '未知错误'}\n\n${res.output}`)
    } catch (e) {
      setOutput(`失败：${(e as Error).message}`)
    } finally {
      setRunning(false)
      void reload()
    }
  }

  /** 查看某个 Agent 的调用留痕：它实际收到的输入与返回的输出 */
  const showRuns = async (a: AgentView): Promise<void> => {
    setRunsFor(a)
    setRunsBusy(true)
    try {
      setRuns((await api.listAgentRuns?.(a.id)) ?? [])
    } catch (e) {
      setRuns([])
      setStatus(`读取调用记录失败：${(e as Error).message}`)
    } finally {
      setRunsBusy(false)
    }
  }

  /** 标记 / 取消参考：生成工作流时会把标记过的真实输出作为参考样本 */
  const toggleReference = async (run: AgentRunRecord): Promise<void> => {
    try {
      const next = await api.setAgentRunReference?.(run.id, !run.reference)
      if (!next) {
        setStatus('这条记录已不存在，刷新后再试')
        return
      }
      setRuns((prev) => prev.map((r) => (r.id === next.id ? next : r)))
      setStatus(next.reference ? '已标记为工作流参考样本' : '已取消参考')
    } catch (e) {
      setStatus(`参考标记失败：${(e as Error).message}`)
    }
  }

  const card = (a: AgentView): JSX.Element => (
    <section key={a.id} className="glass-card flex flex-col gap-2 !p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className={`h-2 w-2 rounded-full ${statusDot(a.status)}`} />
        <b className="text-sm text-slate-200">{a.name}</b>
        {a.builtin ? <span className="rounded-full border border-[var(--line)] px-1.5 py-0.5 text-2xs text-slate-500">本机</span> : null}
        <span className="rounded-full border border-[var(--line)] px-1.5 py-0.5 text-2xs text-slate-500">{PROTOCOL_LABEL[a.protocol] ?? a.protocol}</span>
        <span className="ml-auto text-2xs text-slate-500">{STATUS_LABEL[a.status] ?? a.status}</span>
      </div>
      <div className="text-xs leading-relaxed text-slate-400">{a.detail}</div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-2xs text-slate-500">
        {a.version ? <span>版本 {a.version}</span> : null}
        <span>调用 {a.calls} 次</span>
        <span>Token {a.tokens}</span>
        <span>额度 {a.quotaValue || 0} · {a.quotaMode === 'manual' ? '手动' : a.quotaMode === 'vendor' ? '厂商' : '本机'}</span>
        {a.hasToken ? <span>已存 Token</span> : null}
      </div>
      {a.capabilities.length ? (
        <div className="flex flex-wrap gap-1">
          {a.capabilities.map((c) => (
            <span key={c} className="rounded border border-[var(--line)] bg-[var(--surface-2)] px-1.5 py-0.5 text-2xs text-slate-400">{c}</span>
          ))}
        </div>
      ) : null}
      <div className="mt-auto flex flex-wrap items-center gap-1.5 pt-1">
        <input
          className="glass-input !h-7 !w-20 !px-2 !text-xs"
          type="number"
          min={0}
          value={quotaEdits[a.id] ?? String(a.quotaValue ?? 0)}
          onChange={(e) => setQuotaEdits((m) => ({ ...m, [a.id]: e.target.value }))}
          title="手动额度"
        />
        <button type="button" className="glass-btn !px-2 !py-1 !text-2xs" onClick={() => void setQuota(a)}>存额度</button>
        {!a.builtin ? (
          <>
            <button type="button" className="glass-btn !px-2 !py-1 !text-2xs" onClick={() => void probe(a)}>探测</button>
            <button type="button" className="glass-btn !px-2 !py-1 !text-2xs" onClick={() => void showRuns(a)}>记录</button>
            <button type="button" className="glass-btn !px-2 !py-1 !text-2xs" onClick={() => edit(a)}>编辑</button>
            <button type="button" className="glass-btn danger !px-2 !py-1 !text-2xs" onClick={() => void remove(a)}>删除</button>
          </>
        ) : null}
        {a.dispatchable ? (
          <button
            type="button"
            className="glass-btn primary !px-2 !py-1 !text-2xs"
            onClick={() => { setDispatchFor(a); setPrompt(''); setCwd(data?.homeDir ?? ''); setConfirm(false); setOutput('') }}
          >
            派发
          </button>
        ) : null}
      </div>
    </section>
  )

  return (
    <div className="view-enter flex flex-col gap-4">
      <PageHeader
        icon="zap"
        title="Agent"
        desc="动态连接器：在窗口说“增加一个 Agent”，我会逐项问你信息，保存后立即可用"
        actions={
          <>
            <button type="button" className="glass-btn" onClick={() => void reload()} disabled={busy}>
              <Icon name="refresh" size={13} /> {busy ? '探测中…' : '重新探测'}
            </button>
            <button type="button" className="glass-btn primary" onClick={() => openWizard()}>
              <Icon name="plus" size={13} /> 接入 Agent
            </button>
          </>
        }
      />

      <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
        <span className="rounded-full border border-[var(--line)] bg-[var(--surface-2)] px-2.5 py-1">共 {agents.length} 个</span>
        <span className="rounded-full border border-[var(--line)] bg-[var(--surface-2)] px-2.5 py-1">在线 {onlineCount}</span>
        <span className="rounded-full border border-[var(--line)] bg-[var(--surface-2)] px-2.5 py-1">本机 {builtins.length}</span>
        <span className="rounded-full border border-[var(--line)] bg-[var(--surface-2)] px-2.5 py-1">已接入 {dynamic.length}</span>
        {status ? <span className="text-2xs text-slate-500">{status}</span> : null}
      </div>

      {suggestions.length ? (
        <section className="glass-card !p-3">
          <div className="mb-2 text-2xs text-slate-500">本机检测到这些，可一键接入（不是固定清单，未安装就不会出现）：</div>
          <div className="flex flex-wrap gap-1.5">
            {suggestions.map((s) => (
              <button
                key={s.id}
                type="button"
                className="rounded-full border border-[var(--line)] bg-[var(--surface-2)] px-2.5 py-1 text-2xs text-slate-400 hover:border-[var(--accent)] hover:text-slate-200"
                title={s.detail}
                onClick={() => openWizard({
                  name: s.name,
                  protocol: s.protocol,
                  endpoint: s.endpoint,
                  args: s.args,
                  auth: s.auth,
                  capabilities: s.capabilities,
                  ...(s.preset ?? {})
                })}
              >
                ＋ {s.name}
              </button>
            ))}
          </div>
        </section>
      ) : null}

      {builtins.length ? (
        <section className="flex flex-col gap-2">
          <h2 className="text-xs font-medium text-slate-500">本机 Agent</h2>
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2 xl:grid-cols-3">{builtins.map(card)}</div>
        </section>
      ) : null}

      <section className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <h2 className="text-xs font-medium text-slate-500">动态连接器</h2>
          {!dynamic.length ? <span className="text-2xs text-slate-600">还没有接入，点右上角「接入 Agent」或直接对我说</span> : null}
        </div>
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2 xl:grid-cols-3">{dynamic.map(card)}</div>
      </section>

      <Modal
        open={!!dispatchFor}
        onClose={() => { if (!running) setDispatchFor(null) }}
        title={`派发任务 · ${dispatchFor?.name ?? ''}`}
        size="md"
        footer={
          <div className="flex w-full items-center gap-2">
            <label className="flex items-center gap-1.5 text-2xs text-slate-500">
              <input type="checkbox" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} />
              确认在该 Agent 上执行
            </label>
            <span className="flex-1" />
            <button type="button" className="glass-btn" onClick={() => setDispatchFor(null)} disabled={running}>关闭</button>
            <button type="button" className="glass-btn primary" onClick={() => void runDispatch()} disabled={running || !prompt.trim() || !confirm}>
              {running ? '执行中…' : '开始派发'}
            </button>
          </div>
        }
      >
        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1.5 text-2xs text-slate-500">
            任务内容
            <textarea className="glass-input w-full !text-sm" rows={5} value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="例如：把这条情报对应的导出逻辑改成流式，先给计划不要直接改文件" autoFocus />
          </label>
          <label className="flex flex-col gap-1.5 text-2xs text-slate-500">
            工作目录
            <input className="glass-input w-full" value={cwd} onChange={(e) => setCwd(e.target.value)} placeholder={data?.homeDir ?? '~'} />
          </label>
          <div className="text-2xs text-slate-600">工作目录必须在用户主目录内；默认使用安全权限模式，不使用 bypass。</div>
          {output ? (
            <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-lg border border-[var(--line)] bg-[var(--surface-2)] p-3 text-2xs text-slate-300">{output}</pre>
          ) : null}
        </div>
      </Modal>

      <Modal
        open={!!runsFor}
        onClose={() => setRunsFor(null)}
        title={`调用记录 · ${runsFor?.name ?? ''}`}
        size="lg"
        footer={<button type="button" className="glass-btn" onClick={() => setRunsFor(null)}>关闭</button>}
      >
        {runsBusy ? (
          <div className="py-6 text-center text-xs text-slate-500">读取中…</div>
        ) : runs.length === 0 ? (
          <div className="py-6 text-center text-xs text-slate-500">还没有调用记录。派发一次后，这里会保留它实际收到的输入与返回的输出。</div>
        ) : (
          <div className="flex flex-col gap-2">
            <div className="text-2xs text-slate-500">共 {runs.length} 条 · 仅保留最近 200 条，按时间倒序</div>
            <div className="text-2xs text-slate-600">
              标为「参考」的真实输出，会在下一次一句话生成工作流时作为参考样本（最多取 3 条），只借鉴结构，不直接执行。
            </div>
            {runs.map((r) => (
              <details key={r.id} className="rounded-lg border border-[var(--line)]" style={{ background: 'var(--surface-2)' }}>
                <summary className="flex cursor-pointer flex-wrap items-center gap-2 px-3 py-2 text-xs text-slate-300">
                  <span
                    className="inline-block h-1.5 w-1.5 rounded-full"
                    style={{ background: r.ok ? '#34d399' : '#f87171' }}
                  />
                  <span>{new Date(r.startedAt).toLocaleString('zh-CN', { hour12: false })}</span>
                  <span className="text-2xs text-slate-500">{r.protocol.toUpperCase()}</span>
                  {r.reference ? (
                    <span className="rounded-full border border-[var(--accent)] px-1.5 py-0.5 text-2xs text-[var(--accent)]">参考</span>
                  ) : null}
                  <span className="ml-auto text-2xs text-slate-500">
                    {r.ok ? '成功' : '失败'} · {r.durationMs}ms · 输入 {r.input.length} 字 / 输出 {r.output.length} 字
                  </span>
                </summary>
                <div className="px-3 pb-3">
                  <div className="mt-1 text-2xs text-slate-600">实际输入</div>
                  <pre className="max-h-40 overflow-auto whitespace-pre-wrap text-2xs text-slate-400">{r.input || '（空）'}</pre>
                  <div className="mt-2 text-2xs text-slate-600">返回输出</div>
                  <pre className="max-h-52 overflow-auto whitespace-pre-wrap text-2xs text-slate-300">{r.output || '（空）'}</pre>
                  {r.error ? <div className="mt-1 text-2xs text-rose-400">{r.error}</div> : null}
                  <div className="mt-2 flex justify-end">
                    <button
                      type="button"
                      className={`glass-btn !px-2 !py-1 !text-2xs ${r.reference ? 'primary' : ''}`}
                      onClick={() => void toggleReference(r)}
                    >
                      {r.reference ? '取消参考' : '设为参考'}
                    </button>
                  </div>
                </div>
              </details>
            ))}
          </div>
        )}
      </Modal>
    </div>
  )
}
