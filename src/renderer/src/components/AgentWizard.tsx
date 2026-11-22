/**
 * 接入 Agent 向导：聊天里说“增加一个 Agent”或 Agent 页点＋都会打开
 * 逐步问：名称 → 协议 → 地址/命令 → 认证/能力 → 额度/确认
 * 保存后写主进程动态注册表，不需要改代码或发版
 */
import { useEffect, useMemo, useState } from 'react'
import type { AgentAuth, AgentInput, AgentProtocol, AgentSuggestion } from '@shared/agents'
import { Modal } from './ui/Modal'
import { Icon } from './Icon'
import { useAgentWizardStore } from '../stores/agentWizardStore'

const PROTOCOLS: { value: AgentProtocol; label: string; hint: string }[] = [
  { value: 'cli', label: 'CLI / 命令', hint: '可执行文件或脚本，支持 --prompt 参数' },
  { value: 'mcp', label: 'MCP', hint: 'HTTP 或 stdio 的 MCP Server' },
  { value: 'acp', label: 'ACP', hint: 'Agent Client Protocol 服务' },
  { value: 'http', label: 'HTTP', hint: 'POST JSON 的 Webhook / Agent 服务' },
  { value: 'process', label: '进程', hint: '只观察本机进程是否运行' },
  { value: 'manual', label: '手动', hint: '只登记，不做自动探测' }
]

const AUTH: { value: AgentAuth; label: string }[] = [
  { value: 'none', label: '不需要' },
  { value: 'token', label: 'Token / API Key' },
  { value: 'login', label: '账号登录' },
  { value: 'oauth', label: 'OAuth' }
]

const STEPS = ['这个 Agent 叫什么？', '它通过什么方式接入？', '地址或命令是什么？', '怎么认证、它能做什么？', '额度怎么记？确认接入']

function splitLines(text: string): string[] {
  return text.split('\n').map((s) => s.trim()).filter(Boolean)
}

function splitCaps(text: string): string[] {
  return text.split(/[,，、\s]+/).map((s) => s.trim()).filter(Boolean)
}

export function AgentWizard() {
  const { open, session, initial, closeWizard } = useAgentWizardStore()
  const [step, setStep] = useState(0)
  const [name, setName] = useState('')
  const [protocol, setProtocol] = useState<AgentProtocol>('http')
  const [endpoint, setEndpoint] = useState('')
  const [argsText, setArgsText] = useState('')
  const [dispatchArgsText, setDispatchArgsText] = useState('')
  const [allowToolsText, setAllowToolsText] = useState('')
  const [probePath, setProbePath] = useState('')
  const [cwd, setCwd] = useState('')
  const [auth, setAuth] = useState<AgentAuth>('none')
  const [token, setToken] = useState('')
  const [capsText, setCapsText] = useState('')
  const [quotaMode, setQuotaMode] = useState<'observed' | 'manual' | 'vendor'>('observed')
  const [quotaValue, setQuotaValue] = useState('0')
  const [enabled, setEnabled] = useState(true)
  const [suggestions, setSuggestions] = useState<AgentSuggestion[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [editingId, setEditingId] = useState<string | undefined>(undefined)

  const api = window.api as {
    listAgents?: () => Promise<{ suggestions?: AgentSuggestion[] }>
    addAgent?: (input: AgentInput) => Promise<{ ok: boolean; error?: string }>
  }

  const reset = (patch?: Partial<AgentInput> | null): void => {
    setStep(0)
    setError('')
    setBusy(false)
    setEditingId(patch?.id)
    setName(patch?.name ?? '')
    setProtocol(patch?.protocol ?? 'http')
    setEndpoint(patch?.endpoint ?? '')
    setArgsText((patch?.args ?? []).join('\n'))
    setDispatchArgsText((patch?.dispatchArgs ?? []).join('\n'))
    setAllowToolsText((patch?.allowTools ?? []).join('\n'))
    setProbePath(patch?.probePath ?? '')
    setCwd(patch?.cwd ?? '')
    setAuth(patch?.auth ?? 'none')
    setToken('')
    setCapsText((patch?.capabilities ?? []).join('、'))
    setQuotaMode(patch?.quotaMode ?? 'observed')
    setQuotaValue(String(patch?.quotaValue ?? 0))
    setEnabled(patch?.enabled ?? true)
  }

  useEffect(() => {
    if (!open) return
    reset(initial)
    let cancelled = false
    void api.listAgents?.().then((res) => {
      if (!cancelled) setSuggestions(Array.isArray(res?.suggestions) ? res!.suggestions! : [])
    }).catch(() => undefined)
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, session, initial])

  const currentProtocol = useMemo(() => PROTOCOLS.find((p) => p.value === protocol), [protocol])
  const needsEndpoint = protocol !== 'manual'
  const canNext = step === 0
    ? !!name.trim()
    : step === 2
      ? (!needsEndpoint || !!endpoint.trim())
      : true

  const applySuggestion = (s: AgentSuggestion): void => {
    setName(s.name)
    setProtocol(s.protocol)
    setEndpoint(s.endpoint)
    setArgsText(s.args.join('\n'))
    setDispatchArgsText((s.preset?.dispatchArgs ?? []).join('\n'))
    setAllowToolsText((s.preset?.allowTools ?? []).join('\n'))
    setProbePath(s.preset?.probePath ?? '')
    setAuth(s.auth)
    setCapsText(s.capabilities.join('、'))
    setQuotaMode(s.preset?.quotaMode ?? 'manual')
    setQuotaValue(String(s.preset?.quotaValue ?? 0))
    setStep(2)
  }

  const save = async (): Promise<void> => {
    if (!canNext) return
    if (!api.addAgent) { setError('当前版本不支持动态 Agent'); return }
    setBusy(true)
    setError('')
    try {
      const payload: AgentInput = {
        id: editingId,
        name: name.trim(),
        protocol,
        endpoint: endpoint.trim(),
        args: splitLines(argsText),
        dispatchArgs: splitLines(dispatchArgsText),
        allowTools: splitLines(allowToolsText),
        probePath: probePath.trim(),
        cwd: cwd.trim(),
        auth,
        token: auth === 'none' ? '' : token.trim(),
        capabilities: splitCaps(capsText),
        quotaMode,
        quotaValue: Number(quotaValue) || 0,
        enabled
      }
      const res = await api.addAgent(payload)
      if (!res?.ok) {
        setError(res?.error ?? '保存失败')
        return
      }
      window.dispatchEvent(new CustomEvent('workon:agents-changed'))
      closeWizard()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const footer = (
    <div className="flex w-full items-center gap-2">
      {step > 0 ? (
        <button type="button" className="glass-btn" onClick={() => setStep((s) => Math.max(0, s - 1))}>
          上一步
        </button>
      ) : null}
      <span className="flex-1 text-2xs text-slate-500">步骤 {step + 1} / {STEPS.length}</span>
      {step < STEPS.length - 1 ? (
        <button
          type="button"
          className="glass-btn primary"
          disabled={!canNext}
          onClick={() => setStep((s) => Math.min(STEPS.length - 1, s + 1))}
        >
          下一步
        </button>
      ) : (
        <button type="button" className="glass-btn primary" disabled={busy || !canNext} onClick={() => void save()}>
          {busy ? '接入中…' : editingId ? '保存修改' : '保存并接入'}
        </button>
      )}
    </div>
  )

  return (
    <Modal open={open} onClose={closeWizard} title={`接入 Agent · ${STEPS[step]}`} size="lg" footer={footer}>
      <div className="flex flex-col gap-4">
        {step === 0 ? (
          <>
            <div className="rounded-lg border border-[var(--line)] bg-[var(--surface-2)] p-3 text-xs leading-relaxed text-slate-400">
              不用改代码。填完这几项就写入 Agent 注册表，之后可以随时探测、编辑、删除、派发。
            </div>
            <label className="flex flex-col gap-1.5 text-2xs text-slate-500">
              Agent 名称
              <input className="glass-input w-full" value={name} onChange={(e) => setName(e.target.value)} placeholder="例如：我的 Cursor Agent / 公司内网 Codex" autoFocus />
            </label>
            {suggestions.length ? (
              <div className="flex flex-col gap-2">
                <div className="text-2xs text-slate-500">检测到本机已有这些，点一下自动填好：</div>
                <div className="flex flex-wrap gap-1.5">
                  {suggestions.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      className="rounded-full border border-[var(--line)] bg-[var(--surface-2)] px-2.5 py-1 text-2xs text-slate-400 hover:border-[var(--accent)] hover:text-slate-200"
                      onClick={() => applySuggestion(s)}
                      title={s.detail}
                    >
                      {s.name}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
          </>
        ) : null}

        {step === 1 ? (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {PROTOCOLS.map((p) => (
              <button
                key={p.value}
                type="button"
                onClick={() => setProtocol(p.value)}
                className={`rounded-xl border p-3 text-left transition-colors ${protocol === p.value ? 'border-[var(--accent)] bg-[var(--accent-soft)]' : 'border-[var(--line)] bg-[var(--surface-2)] hover:border-[var(--line-strong)]'}`}
              >
                <div className="text-sm font-medium text-slate-200">{p.label}</div>
                <div className="mt-0.5 text-2xs text-slate-500">{p.hint}</div>
              </button>
            ))}
          </div>
        ) : null}

        {step === 2 ? (
          <>
            <div className="text-xs text-slate-400">{currentProtocol?.hint}</div>
            <label className="flex flex-col gap-1.5 text-2xs text-slate-500">
              {protocol === 'http' || protocol === 'mcp' ? '地址 / Endpoint' : '可执行文件 / 命令'}
              <input
                className="glass-input w-full"
                value={endpoint}
                onChange={(e) => setEndpoint(e.target.value)}
                placeholder={protocol === 'http' || protocol === 'mcp' ? 'http://127.0.0.1:3000/agent' : '/Applications/YourAgent.app/Contents/MacOS/agent'}
                autoFocus
              />
            </label>
            {protocol === 'http' || protocol === 'mcp' ? (
              <label className="flex flex-col gap-1.5 text-2xs text-slate-500">
                健康检查路径（可选）
                <input className="glass-input w-full" value={probePath} onChange={(e) => setProbePath(e.target.value)} placeholder="留空则直接请求上面的地址；例如 /health" />
              </label>
            ) : (
              <>
                <label className="flex flex-col gap-1.5 text-2xs text-slate-500">
                  版本 / 探测参数（每行一个）
                  <textarea className="glass-input w-full font-mono !text-xs" rows={2} value={argsText} onChange={(e) => setArgsText(e.target.value)} placeholder={'--version'} />
                </label>
                <label className="flex flex-col gap-1.5 text-2xs text-slate-500">
                  派发参数模板（每行一个，支持 {'{prompt}'} / {'{cwd}'}）
                  <textarea className="glass-input w-full font-mono !text-xs" rows={4} value={dispatchArgsText} onChange={(e) => setDispatchArgsText(e.target.value)} placeholder={'--prompt\n{prompt}\n--cwd\n{cwd}'} />
                </label>
              </>
            )}
            {protocol === 'mcp' ? (
              <label className="flex flex-col gap-1.5 text-2xs text-slate-500">
                允许调用的 MCP 工具（每行一个，命中白名单才可派发）
                <textarea className="glass-input w-full font-mono !text-xs" rows={3} value={allowToolsText} onChange={(e) => setAllowToolsText(e.target.value)} placeholder={'memory.search\nplan.list\nreport.export'} />
              </label>
            ) : null}
            <label className="flex flex-col gap-1.5 text-2xs text-slate-500">
              默认工作目录（可选）
              <input className="glass-input w-full" value={cwd} onChange={(e) => setCwd(e.target.value)} placeholder="留空使用主目录；派发时必须位于主目录内" />
            </label>
          </>
        ) : null}

        {step === 3 ? (
          <>
            <label className="flex flex-col gap-1.5 text-2xs text-slate-500">
              认证方式
              <select className="glass-input w-full" value={auth} onChange={(e) => setAuth(e.target.value as AgentAuth)}>
                {AUTH.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}
              </select>
            </label>
            {auth === 'token' ? (
              <label className="flex flex-col gap-1.5 text-2xs text-slate-500">
                Token / API Key
                <input className="glass-input w-full" type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder={editingId ? '留空则保留原 Token' : '只保存在主进程，不进入模型上下文'} />
              </label>
            ) : null}
            <label className="flex flex-col gap-1.5 text-2xs text-slate-500">
              能力（用逗号或空格分隔）
              <input className="glass-input w-full" value={capsText} onChange={(e) => setCapsText(e.target.value)} placeholder="代码修改、终端、代码审查" />
            </label>
          </>
        ) : null}

        {step === 4 ? (
          <>
            <div className="rounded-lg border border-[var(--line)] bg-[var(--surface-2)] p-3 text-xs leading-relaxed text-slate-400">
              <div><b className="text-slate-200">{name || '未命名'}</b> · {currentProtocol?.label}</div>
              <div className="mt-1 break-all">{endpoint || '—'}</div>
              <div className="mt-1">认证：{AUTH.find((a) => a.value === auth)?.label} · 能力：{splitCaps(capsText).join(' / ') || '—'}</div>
            </div>
            <label className="flex flex-col gap-1.5 text-2xs text-slate-500">
              额度口径
              <select className="glass-input w-full" value={quotaMode} onChange={(e) => setQuotaMode(e.target.value as 'observed' | 'manual' | 'vendor')}>
                <option value="observed">本机计量（调用次数 / Token）</option>
                <option value="manual">手动额度</option>
                <option value="vendor">厂商 API</option>
              </select>
            </label>
            {quotaMode === 'manual' ? (
              <label className="flex flex-col gap-1.5 text-2xs text-slate-500">
                当前额度
                <input className="glass-input w-full" type="number" min={0} value={quotaValue} onChange={(e) => setQuotaValue(e.target.value)} placeholder="0" />
              </label>
            ) : null}
            <label className="flex items-center gap-2 text-xs text-slate-400">
              <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
              启用这个 Agent（关闭后不探测、不派发）
            </label>
            {error ? <div className="text-xs text-rose-400">{error}</div> : null}
          </>
        ) : null}

        {step < 4 && error ? <div className="text-xs text-rose-400">{error}</div> : null}
        {step === 0 && initial?.id ? (
          <div className="flex items-center gap-1.5 text-2xs text-amber-400">
            <Icon name="edit" size={12} /> 正在编辑已有 Agent；Token 留空表示保留原值
          </div>
        ) : null}
      </div>
    </Modal>
  )
}
