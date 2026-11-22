/**
 * 收藏网址 / 情报流
 * - 真实读取 Chromium 系书签（Chrome / Edge / Brave / Chromium / Tabbit）
 * - 关注站点 → 抓取 → 本地 Ollama 摘要 → 情报流
 * - 入本地知识库 / WeKnora / Memory Hub
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { BookmarkSource, IntelConfig, IntelItem, IntelState, ProviderStatus, VaultSite, VaultStatus } from '@shared/intel'
import { dateKey } from '@shared/trail'
import { PageHeader } from '../components/PageHeader'
import { Icon } from '../components/Icon'

const PROVIDER_LABEL: Record<string, string> = {
  local: '本地知识库',
  weknora: 'WeKnora',
  memoryHub: 'Memory Hub'
}

function statusBadge(status: IntelItem['status']): string {
  if (status === 'new') return 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
  if (status === 'updated') return 'border-amber-500/40 bg-amber-500/10 text-amber-300'
  if (status === 'error') return 'border-rose-500/40 bg-rose-500/10 text-rose-300'
  return 'border-[var(--line)] bg-[var(--surface-2)] text-slate-500'
}

function statusText(status: IntelItem['status']): string {
  return status === 'new' ? 'NEW' : status === 'updated' ? '更新' : status === 'error' ? '失败' : '未变'
}

function fmtTime(ts: number): string {
  const d = new Date(ts)
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

export default function IntelView() {
  const [data, setData] = useState<IntelState | null>(null)
  const [sources, setSources] = useState<BookmarkSource[]>([])
  const [providers, setProviders] = useState<ProviderStatus[]>([])
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')
  const [configOpen, setConfigOpen] = useState(false)
  const [draft, setDraft] = useState<IntelConfig | null>(null)
  const [vault, setVault] = useState<VaultStatus | null>(null)
  const [vaultOpen, setVaultOpen] = useState(false)
  const [vaultSites, setVaultSites] = useState<VaultSite[]>([])
  /** 已转成计划的情报 id：避免重复建计划 */
  const [planned, setPlanned] = useState<Record<string, boolean>>({})
  /** 同步防重入：同一帧连点读到的 state 仍是旧值 */
  const busyRef = useRef(false)

  const api = window.api as {
    getIntelState?: () => Promise<IntelState>
    listBookmarkSources?: () => Promise<BookmarkSource[]>
    importBookmarkSource?: (sourceId: string, limit?: number) => Promise<IntelState>
    addIntelWatch?: (url: string, title?: string) => Promise<IntelState>
    removeIntelWatch?: (id: string) => Promise<IntelState>
    getVaultStatus?: () => Promise<VaultStatus>
    listVaultSites?: () => Promise<VaultSite[]>
    removeVaultSite?: (id: string) => Promise<VaultStatus>
    hideWatchToVault?: (id: string) => Promise<IntelState>
    scanIntel?: () => Promise<{ ok: boolean; result?: { added: number; updated: number; unchanged: number; errors: number }; error?: string }>
    ingestIntel?: (id: string, target: string) => Promise<{ ok: boolean; error?: string }>
    setIntelConfig?: (patch: Partial<IntelConfig>) => Promise<IntelState>
    listIntelProviders?: () => Promise<ProviderStatus[]>
    listPlans?: (date?: string) => Promise<Array<{ id: string; source?: string; note?: string }>>
    savePlan?: (plan: unknown) => Promise<unknown>
  }

  const reload = useCallback(async () => {
    const [st, src, pv, vs, dayPlans] = await Promise.all([
      api.getIntelState?.() ?? null,
      api.listBookmarkSources?.() ?? [],
      api.listIntelProviders?.() ?? [],
      api.getVaultStatus?.() ?? null,
      api.listPlans?.(dateKey(Date.now())) ?? []
    ])
    if (st) {
      setData(st)
      setDraft(st.config)
      // 重启/切页后按今日 source=intel 计划回填「已加入计划」，避免重复转计划
      const intelPlans = (Array.isArray(dayPlans) ? dayPlans : []).filter((p) => p.source === 'intel')
      const next: Record<string, boolean> = {}
      for (const it of st.items ?? []) {
        if (intelPlans.some((p) => (p.note ?? '').includes(it.url))) next[it.id] = true
      }
      setPlanned(next)
    }
    setSources(Array.isArray(src) ? src : [])
    setProviders(Array.isArray(pv) ? pv : [])
    if (vs) setVault(vs)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /** 刷新加密库计数；展开时同步刷新明文列表 */
  const refreshVault = async (): Promise<void> => {
    const st = await api.getVaultStatus?.().catch(() => null)
    if (st) setVault(st)
    if (vaultOpen) {
      const list = await api.listVaultSites?.().catch(() => [])
      setVaultSites(Array.isArray(list) ? list : [])
    }
  }

  const toggleVault = async (): Promise<void> => {
    if (vaultOpen) {
      setVaultOpen(false)
      setVaultSites([])
      return
    }
    const list = await api.listVaultSites?.().catch(() => [])
    setVaultSites(Array.isArray(list) ? list : [])
    setVaultOpen(true)
    void refreshVault()
  }

  const hideWatch = async (id: string): Promise<void> => {
    setBusy(true)
    try {
      const next = await api.hideWatchToVault?.(id)
      if (next) setData(next)
      await refreshVault()
      setStatus('已隐藏到加密库')
    } catch (e) {
      setStatus(`隐藏失败：${(e as Error).message}`)
    } finally {
      setBusy(false)
    }
  }

  const removeVault = async (id: string): Promise<void> => {
    const st = await api.removeVaultSite?.(id)
    if (st) setVault(st)
    setVaultSites((list) => list.filter((s) => s.id !== id))
    setStatus('已从加密库删除')
  }

  /** 情报转计划：把一条情报落成今日待办，正文保留摘要与原链接 */
  const toPlan = async (it: IntelItem): Promise<void> => {
    if (busy || busyRef.current || planned[it.id]) return
    busyRef.current = true
    setBusy(true)
    try {
      await api.savePlan?.({
        date: dateKey(Date.now()),
        title: it.title.trim().slice(0, 60) || '阅读情报',
        category: 'other',
        status: 'planned',
        source: 'intel',
        planType: 'task',
        note: `${it.summary}\n${it.url}`
      })
      setPlanned((prev) => ({ ...prev, [it.id]: true }))
      setStatus(`已加入今日计划：${it.title.slice(0, 20)}`)
    } catch (e) {
      setStatus(`转计划失败：${(e as Error).message}`)
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  useEffect(() => {
    void reload().catch((e) => setStatus(`加载失败：${(e as Error).message}`))
  }, [reload])

  const saveConfig = async (): Promise<void> => {
    if (!draft) return
    setBusy(true)
    try {
      const next = await api.setIntelConfig?.(draft)
      if (next) { setData(next); setDraft(next.config) }
      setStatus('配置已保存')
      setConfigOpen(false)
      void reload()
    } catch (e) {
      setStatus(`保存失败：${(e as Error).message}`)
    } finally {
      setBusy(false)
    }
  }

  const importSource = async (sourceId: string): Promise<void> => {
    setBusy(true)
    const before = vault?.count ?? 0
    try {
      const next = await api.importBookmarkSource?.(sourceId, 20)
      if (next) setData(next)
      const st = await api.getVaultStatus?.().catch(() => null)
      if (st) setVault(st)
      const hidden = (st?.count ?? before) - before
      setStatus(hidden > 0 ? `已导入前 20 个书签站点 · ${hidden} 个私密已进入加密库` : '已导入前 20 个书签站点')
      if (vaultOpen) await refreshVault()
    } finally {
      setBusy(false)
    }
  }

  const addUrl = async (): Promise<void> => {
    const raw = url.trim()
    if (!raw) return
    setBusy(true)
    try {
      const next = await api.addIntelWatch?.(raw)
      if (next) {
        setData(next)
        const inWatch = next.watch.some(
          (w) => w.url === raw || w.url.replace(/\/$/, '') === raw.replace(/\/$/, '')
        )
        setStatus(inWatch ? '已加入关注列表' : '命中私密规则，已收进加密库')
      }
      const st = await api.getVaultStatus?.().catch(() => null)
      if (st) setVault(st)
      setUrl('')
      if (vaultOpen) await refreshVault()
    } catch (e) {
      setStatus(`添加失败：${(e as Error).message}`)
    } finally {
      setBusy(false)
    }
  }

  const removeWatch = async (id: string): Promise<void> => {
    const next = await api.removeIntelWatch?.(id)
    if (next) setData(next)
  }

  const scan = async (): Promise<void> => {
    setBusy(true)
    setStatus('抓取中…（本地模型摘要可能需要一会儿）')
    try {
      const res = await api.scanIntel?.()
      if (res?.ok && res.result) {
        setStatus(`完成：新增 ${res.result.added} · 更新 ${res.result.updated} · 未变 ${res.result.unchanged} · 错误 ${res.result.errors}`)
      } else {
        setStatus(res?.error ?? '抓取失败')
      }
      void reload()
    } catch (e) {
      setStatus(`抓取失败：${(e as Error).message}`)
    } finally {
      setBusy(false)
    }
  }

  const ingest = async (item: IntelItem, target: string): Promise<void> => {
    setBusy(true)
    try {
      const res = await api.ingestIntel?.(item.id, target)
      setStatus(res?.ok ? `已入 ${PROVIDER_LABEL[target] ?? target}` : `入库失败：${res?.error ?? '未知错误'}`)
      void reload()
    } finally {
      setBusy(false)
    }
  }

  const items = data?.items ?? []
  const watch = data?.watch ?? []
  const cfg = draft ?? data?.config
  const providerOk = (id: string): boolean => !!providers.find((p) => p.id === id)?.ok

  return (
    <div className="view-enter flex flex-col gap-4">
      <PageHeader
        icon="book"
        title="收藏网址 · 情报"
        desc="读取 Chrome / Edge 书签，关注站点 → 本地 Ollama 摘要 → 情报入库"
        actions={
          <>
            <button type="button" className="glass-btn" aria-expanded={configOpen} onClick={() => setConfigOpen((v) => !v)}>
              <Icon name="settings" size={13} /> 配置
            </button>
            <button type="button" className="glass-btn" onClick={() => void reload()} disabled={busy}>
              <Icon name="refresh" size={13} /> 刷新
            </button>
            <button type="button" className="glass-btn primary" onClick={() => void scan()} disabled={busy || !watch.length}>
              <Icon name="zap" size={13} /> {busy ? '处理中…' : '立即抓取'}
            </button>
          </>
        }
      />

      <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
        <span className="rounded-full border border-[var(--line)] bg-[var(--surface-2)] px-2.5 py-1">书签源 {sources.length}</span>
        <span className="rounded-full border border-[var(--line)] bg-[var(--surface-2)] px-2.5 py-1">关注 {watch.length}</span>
        <span className="rounded-full border border-[var(--line)] bg-[var(--surface-2)] px-2.5 py-1">加密库 {vault?.count ?? 0}</span>
        <span className="rounded-full border border-[var(--line)] bg-[var(--surface-2)] px-2.5 py-1">情报 {items.length}</span>
        <span className="rounded-full border border-[var(--line)] bg-[var(--surface-2)] px-2.5 py-1">今天 {data?.usage.lastRunDay === (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` })() ? '已抓取' : '未抓取'}</span>
        {providers.map((p) => (
          <span key={p.id} className={`rounded-full border px-2.5 py-1 ${p.ok ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300' : 'border-rose-500/30 bg-rose-500/10 text-rose-300'}`} title={p.detail}>
            {p.name} {p.ok ? '在线' : '离线'}
          </span>
        ))}
        {status ? <span className="text-2xs text-slate-500">{status}</span> : null}
      </div>

      {configOpen && cfg ? (
        <section className="glass-card !p-4">
          <div className="mb-3 flex items-center gap-2">
            <b className="text-sm text-slate-200">情报配置</b>
            <span className="text-2xs text-slate-500">本地模型优先；WeKnora / Memory Hub 需要凭据</span>
            <span className="flex-1" />
            <button type="button" className="glass-btn primary" onClick={() => void saveConfig()} disabled={busy}>保存配置</button>
          </div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <label className="flex flex-col gap-1 text-2xs text-slate-500">
              每天抓取时间
              <input className="glass-input w-full" value={cfg.time} onChange={(e) => setDraft({ ...cfg, time: e.target.value })} placeholder="08:30" />
            </label>
            <label className="flex flex-col gap-1 text-2xs text-slate-500">
              本地模型
              <input className="glass-input w-full" value={cfg.model} onChange={(e) => setDraft({ ...cfg, model: e.target.value })} placeholder="qwen3.5:4b" />
            </label>
            <label className="flex flex-col gap-1 text-2xs text-slate-500">
              Ollama Base URL
              <input className="glass-input w-full" value={cfg.localBaseUrl} onChange={(e) => setDraft({ ...cfg, localBaseUrl: e.target.value })} placeholder="http://127.0.0.1:11435/v1" />
            </label>
          </div>
          <div className="mt-2 text-2xs text-slate-500">
            默认 11435 是情报专用实例，首次抓取时自动启动；主 Ollama（11434）被知识库嵌入占满时，生成请求会一直排队。
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-4 text-xs text-slate-400">
            <label className="flex items-center gap-1.5"><input type="checkbox" checked={cfg.enabled} onChange={(e) => setDraft({ ...cfg, enabled: e.target.checked })} /> 启用每天抓取</label>
            <label className="flex items-center gap-1.5"><input type="checkbox" checked={cfg.autoIngest} onChange={(e) => setDraft({ ...cfg, autoIngest: e.target.checked })} /> 抓取后自动入库</label>
            <label className="flex items-center gap-1.5">每次最多 <input className="glass-input !h-7 !w-16 !px-2 !text-xs" type="number" value={cfg.maxPerScan} onChange={(e) => setDraft({ ...cfg, maxPerScan: Number(e.target.value) || 30 })} /> 个站点</label>
          </div>
          <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-3">
            {(['local', 'weknora', 'memoryHub'] as const).map((p) => (
              <label key={p} className="flex items-center gap-1.5 text-xs text-slate-400">
                <input type="checkbox" checked={cfg.providers[p]} onChange={(e) => setDraft({ ...cfg, providers: { ...cfg.providers, [p]: e.target.checked } })} />
                入库到 {PROVIDER_LABEL[p]}
                {providerOk(p) ? <span className="text-2xs text-emerald-400">在线</span> : <span className="text-2xs text-slate-600">未就绪</span>}
              </label>
            ))}
          </div>
          <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
            <div className="rounded-lg border border-[var(--line)] p-3">
              <div className="mb-2 text-2xs font-medium text-slate-400">WeKnora</div>
              <div className="grid grid-cols-1 gap-2">
                <input className="glass-input w-full" value={cfg.weknora.baseUrl} onChange={(e) => setDraft({ ...cfg, weknora: { ...cfg.weknora, baseUrl: e.target.value } })} placeholder="http://localhost" />
                <input className="glass-input w-full" value={cfg.weknora.email} onChange={(e) => setDraft({ ...cfg, weknora: { ...cfg.weknora, email: e.target.value } })} placeholder="登录邮箱（用于自动续签）" />
                <input className="glass-input w-full" type="password" value={cfg.weknora.password} onChange={(e) => setDraft({ ...cfg, weknora: { ...cfg.weknora, password: e.target.value } })} placeholder="登录密码（留空则保留原值）" />
                <input className="glass-input w-full" type="password" value={cfg.weknora.token} onChange={(e) => setDraft({ ...cfg, weknora: { ...cfg.weknora, token: e.target.value } })} placeholder="Token（可留空，用账号密码续签）" />
                <input className="glass-input w-full" value={cfg.weknora.knowledgeId} onChange={(e) => setDraft({ ...cfg, weknora: { ...cfg.weknora, knowledgeId: e.target.value } })} placeholder="知识库 ID（留空自动选/建 WorkOn 情报）" />
              </div>
            </div>
            <div className="rounded-lg border border-[var(--line)] p-3">
              <div className="mb-2 text-2xs font-medium text-slate-400">Memory Hub</div>
              <div className="grid grid-cols-1 gap-2">
                <input className="glass-input w-full" value={cfg.memoryHub.baseUrl} onChange={(e) => setDraft({ ...cfg, memoryHub: { ...cfg.memoryHub, baseUrl: e.target.value } })} placeholder="http://localhost:8125" />
                <input className="glass-input w-full" value={cfg.memoryHub.instanceId} onChange={(e) => setDraft({ ...cfg, memoryHub: { ...cfg.memoryHub, instanceId: e.target.value } })} placeholder="Instance ID" />
                <input className="glass-input w-full" type="password" value={cfg.memoryHub.userKey} onChange={(e) => setDraft({ ...cfg, memoryHub: { ...cfg.memoryHub, userKey: e.target.value } })} placeholder="User Key（留空则保留原值）" />
                <input className="glass-input w-full" value={cfg.memoryHub.teamId} onChange={(e) => setDraft({ ...cfg, memoryHub: { ...cfg.memoryHub, teamId: e.target.value } })} placeholder="Team ID" />
              </div>
            </div>
          </div>
        </section>
      ) : null}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[300px_minmax(0,1fr)]">
        <div className="flex flex-col gap-3">
          <section className="glass-card !p-3">
            <div className="mb-2 flex items-center gap-2 text-xs font-medium text-slate-400">
              书签源 <span className="text-2xs text-slate-600">{sources.length} 个</span>
            </div>
            {sources.length ? sources.map((s) => (
              <div key={s.id} className="mb-2 rounded-lg border border-[var(--line)] bg-[var(--surface-2)] p-2.5">
                <div className="flex items-center gap-1.5 text-xs text-slate-200">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                  {s.browser} · {s.profile}
                </div>
                <div className="mt-1 text-2xs text-slate-500">{s.count} 个书签 · {s.folders} 个文件夹</div>
                <div className="mt-2 flex gap-1.5">
                  <button type="button" className="glass-btn !px-2 !py-1 !text-2xs" onClick={() => void importSource(s.id)} disabled={busy}>导入前 20</button>
                </div>
              </div>
            )) : (
              <div className="text-2xs leading-relaxed text-slate-600">
                未检测到书签。Chrome 需安装并至少打开一次；Edge 需创建 profile。支持 Chrome / Edge / Brave / Chromium / Tabbit。
              </div>
            )}
          </section>

          <section className="glass-card !p-3">
            <div className="mb-2 text-xs font-medium text-slate-400">手动添加网址</div>
            <div className="flex gap-1.5">
              <input className="glass-input min-w-0 flex-1" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://example.com/article" onKeyDown={(e) => { if (e.key === 'Enter') void addUrl() }} />
              <button type="button" className="glass-btn primary !px-2" onClick={() => void addUrl()} disabled={busy || !url.trim()}>添加</button>
            </div>
            <div className="mt-3 text-xs font-medium text-slate-400">关注列表 <span className="text-2xs text-slate-600">{watch.length}</span></div>
            <div className="mt-2 max-h-64 overflow-auto">
              {watch.length ? watch.map((w) => (
                <div key={w.id} className="mb-1 flex items-center gap-2 rounded border border-[var(--line)] bg-[var(--surface-2)] px-2 py-1.5">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-2xs text-slate-300">{w.title}</div>
                    <div className="truncate text-2xs text-slate-600">{w.url}</div>
                  </div>
                  <button type="button" className="text-2xs text-slate-500 hover:text-[var(--accent)]" title="移到加密库并从关注列表隐藏" onClick={() => void hideWatch(w.id)}>隐藏</button>
                  <button type="button" className="text-2xs text-slate-500 hover:text-rose-400" onClick={() => void removeWatch(w.id)}>移除</button>
                </div>
              )) : <div className="text-2xs text-slate-600">还没有关注站点。</div>}
            </div>
          </section>

          <section className="glass-card !p-3">
            <div className="mb-2 flex items-center gap-2 text-xs font-medium text-slate-400">
              <Icon name="shield" size={13} />
              加密库
              <span className="text-2xs text-slate-600">{vault?.count ?? 0} 条</span>
              <span className="flex-1" />
              <button type="button" className="glass-btn !px-2 !py-0.5 !text-2xs" onClick={() => void toggleVault()}>
                <Icon name={vaultOpen ? 'eyeOff' : 'eye'} size={11} /> {vaultOpen ? '收起' : '查看'}
              </button>
            </div>
            <div className="text-2xs leading-relaxed text-slate-600">
              命中私密规则的收藏会自动隐藏到这里，磁盘只存 safeStorage 密文
              {vault?.encryption === 'plain' ? ' · 本机降级存储' : ''}
            </div>
            {vaultOpen ? (
              <div className="mt-2 max-h-56 overflow-auto">
                {vaultSites.length ? vaultSites.map((s) => (
                  <div key={s.id} className="mb-1 flex items-center gap-2 rounded border border-[var(--line)] bg-[var(--surface-2)] px-2 py-1.5">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-2xs text-slate-300">{s.title}</div>
                      <div className="truncate text-2xs text-slate-600">{s.url}</div>
                      <div className="text-2xs text-slate-600">{s.source}{s.folder ? ` · ${s.folder}` : ''} · {s.reason === 'auto' ? '自动隐藏' : '手动隐藏'}</div>
                    </div>
                    <button type="button" className="shrink-0 text-2xs text-slate-500 hover:text-rose-400" onClick={() => void removeVault(s.id)}>删除</button>
                  </div>
                )) : <div className="text-2xs text-slate-600">加密库为空。</div>}
              </div>
            ) : null}
          </section>
        </div>

        <section className="glass-card flex min-h-[420px] flex-col !p-3">
          <div className="mb-2 flex items-center gap-2 text-xs font-medium text-slate-400">
            情报流 <span className="text-2xs text-slate-600">{items.length} 条</span>
            <span className="flex-1" />
            {data?.usage.lastRunAt ? <span className="text-2xs text-slate-600">上次 {fmtTime(data.usage.lastRunAt)}</span> : null}
          </div>
          <div className="min-h-0 flex-1 overflow-auto">
            {items.length ? items.map((it) => (
              <article key={it.id} className="mb-2 rounded-lg border border-[var(--line)] bg-[var(--surface-2)] p-3">
                <div className="flex flex-wrap items-center gap-1.5">
                  <b className="min-w-0 flex-1 truncate text-xs text-slate-200">{it.title}</b>
                  <span className={`rounded border px-1.5 py-0.5 text-2xs ${statusBadge(it.status)}`}>{statusText(it.status)}</span>
                </div>
                <div className="mt-1 text-2xs leading-relaxed text-slate-400">{it.summary}</div>
                <div className="mt-1 flex flex-wrap items-center gap-1.5 text-2xs text-slate-600">
                  <span>{it.source}</span><span>{fmtTime(it.fetchedAt)}</span>
                  <a className="truncate text-[var(--accent)] hover:underline" href={it.url} target="_blank" rel="noreferrer">{it.url}</a>
                  {it.tags.map((t) => <span key={t} className="rounded border border-[var(--line)] px-1 text-slate-500">{t}</span>)}
                </div>
                {it.error ? <div className="mt-1 text-2xs text-rose-400">{it.error}</div> : null}
                <div className="mt-2 flex flex-wrap gap-1.5">
                  <button type="button" className="glass-btn !px-2 !py-1 !text-2xs" onClick={() => void ingest(it, 'local')} disabled={busy || it.ingested.local}>{it.ingested.local ? '已入本地' : '入本地'}</button>
                  <button type="button" className="glass-btn !px-2 !py-1 !text-2xs" onClick={() => void ingest(it, 'weknora')} disabled={busy || it.ingested.weknora}>{it.ingested.weknora ? '已入 WeKnora' : '入 WeKnora'}</button>
                  <button type="button" className="glass-btn !px-2 !py-1 !text-2xs" onClick={() => void ingest(it, 'memoryHub')} disabled={busy || it.ingested.memoryHub}>{it.ingested.memoryHub ? '已入 Memory Hub' : '入 Memory Hub'}</button>
                  <button type="button" className="glass-btn !px-2 !py-1 !text-2xs" onClick={() => void toPlan(it)} disabled={busy || !!planned[it.id]}>
                    {planned[it.id] ? '已加入计划' : '转今日计划'}
                  </button>
                </div>
              </article>
            )) : (
              <div className="flex h-full min-h-[280px] flex-col items-center justify-center gap-2 text-center">
                <div className="text-sm text-slate-500">还没有情报</div>
                <div className="max-w-sm text-2xs leading-relaxed text-slate-600">先从左侧导入书签或添加网址，再点右上角「立即抓取」。本地模型会生成摘要与标签。</div>
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  )
}
