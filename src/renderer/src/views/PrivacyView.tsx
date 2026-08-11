import { useCallback, useEffect, useState } from 'react'
import type { AppSettings } from '@shared/types'
import { useSettingsStore } from '../stores/settingsStore'
import { Icon } from '../components/Icon'
import { Toggle } from '../components/Toggle'

/* ── 分组与行（与设置页同风格） ── */
function Section({
  title,
  icon,
  delay = 0,
  children
}: {
  title: string
  icon: Parameters<typeof Icon>[0]['name']
  delay?: number
  children: React.ReactNode
}) {
  return (
    <section className="glass-card hoverable anim-fade-up" style={{ animationDelay: `${delay}ms` }}>
      <h2 className="mb-3 flex items-center gap-2.5 text-[14px] font-semibold text-slate-200">
        <span className="flex h-6 w-6 items-center justify-center rounded-lg border border-neon-cyan/20 bg-neon-cyan/10">
          <Icon name={icon} size={13} className="text-neon-cyan" />
        </span>
        {title}
      </h2>
      <div className="flex flex-col divide-y divide-white/[0.05]">{children}</div>
    </section>
  )
}

function Row({ label, desc, children }: { label: string; desc?: string; children: React.ReactNode }) {
  return (
    <div className="-mx-2 flex items-center gap-4 rounded-lg px-2 py-2.5 transition-colors hover:bg-white/[0.03]">
      <div className="min-w-0 flex-1">
        <div className="text-[13px] text-slate-300">{label}</div>
        {desc ? <div className="mt-0.5 text-[11px] text-slate-500">{desc}</div> : null}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  )
}

function NumberSetting({ value, onCommit, min, max, suffix }: { value: number; onCommit: (v: number) => void; min?: number; max?: number; suffix?: string }) {
  const [v, setV] = useState(String(value))
  useEffect(() => setV(String(value)), [value])
  const commit = () => {
    const n = Number(v)
    if (!Number.isFinite(n)) {
      setV(String(value))
      return
    }
    let c = Math.round(n)
    if (min !== undefined) c = Math.max(min, c)
    if (max !== undefined) c = Math.min(max, c)
    if (c !== value) onCommit(c)
    setV(String(c))
  }
  return (
    <span className="flex items-center gap-1.5">
      <input
        type="number"
        className="glass-input w-24 text-right"
        value={v}
        min={min}
        max={max}
        onChange={(e) => setV(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
        }}
      />
      {suffix ? <span className="text-[11px] text-slate-500">{suffix}</span> : null}
    </span>
  )
}

interface OcrStats {
  shotCount: number
  shotBytes: number
  modelBytes: number
  totalBytes: number
}

function fmtBytes(bytes: number): string {
  if (bytes >= 1073741824) return `${(bytes / 1073741824).toFixed(1)} GB`
  if (bytes >= 1048576) return `${(bytes / 1048576).toFixed(1)} MB`
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${bytes} B`
}

/** 选项胶囊按钮（自动清理周期 / 缓存上限共用样式） */
function pillClass(active: boolean): string {
  return `rounded-lg border px-2.5 py-1.5 text-[12px] transition-all ${
    active
      ? 'border-neon-cyan/40 bg-neon-cyan/10 text-neon-cyan shadow-[0_0_10px_rgba(34,211,238,0.15)]'
      : 'border-white/[0.07] text-slate-400 hover:border-white/20 hover:text-slate-200'
  }`
}

/** 隐私快标预置应用（与主进程别名匹配） */
const PRIVACY_PRESETS = ['微信', '钉钉', 'QQ', '飞书', '旺旺', 'Outlook']

/** 隐私痕迹统计表（近 14 天按应用聚合；每行附一键清理） */
function PrivacyStats({ reloadToken, excludedKey, onCleared }: { reloadToken: number; excludedKey: string; onCleared: () => void }) {
  const [rows, setRows] = useState<{ app: string; count: number; lastTs: number; excluded: boolean }[] | null>(null)
  const [clearing, setClearing] = useState<string | null>(null)
  useEffect(() => {
    window.api
      .getPrivacyStats()
      .then((r) => setRows(r as typeof rows))
      .catch(() => setRows(null))
  }, [reloadToken, excludedKey])
  const clearApp = async (app: string) => {
    if (!window.confirm(`确定清理「${app}」的全部活动记录吗？不可恢复。`)) return
    setClearing(app)
    try {
      await window.api.clearAppPrivacy(app)
      onCleared()
    } finally {
      setClearing(null)
    }
  }
  if (!rows || rows.length === 0)
    return <div className="rounded-lg border border-dashed border-white/10 bg-white/[0.02] py-3 text-center text-[11px] text-slate-500">暂无采集记录</div>
  return (
    <div className="mt-2 overflow-hidden rounded-xl border border-white/[0.06]">
      <table className="w-full text-[11px]">
        <thead>
          <tr className="bg-white/[0.03] text-left text-slate-500">
            <th className="px-2.5 py-2 font-medium">应用</th>
            <th className="px-2.5 py-2 font-medium">监控状态</th>
            <th className="px-2.5 py-2 font-medium">记录条数</th>
            <th className="px-2.5 py-2 font-medium">最后记录</th>
            <th className="px-2.5 py-2" />
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.app} className="border-t border-white/[0.05] text-slate-300 transition-colors hover:bg-white/[0.03]">
              <td className="max-w-[120px] truncate px-2.5 py-1.5">{r.app}</td>
              <td className="px-2.5 py-1.5">
                {r.excluded ? (
                  <span className="inline-flex items-center gap-1 rounded-full border border-neon-green/20 bg-neon-green/10 px-1.5 py-0.5 text-[10px] text-neon-green">
                    <span className="h-1 w-1 rounded-full bg-neon-green" />
                    已排除 · 不再采集
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-slate-400">
                    <span className="pulse-dot h-1 w-1 rounded-full bg-neon-cyan" />
                    监控中
                  </span>
                )}
              </td>
              <td className="px-2.5 py-1.5">{r.count}</td>
              <td className="px-2.5 py-1.5 text-slate-500">
                {r.lastTs ? new Date(r.lastTs).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'}
              </td>
              <td className="px-2 py-1.5 text-right">
                <button
                  className="rounded-md border border-red-500/25 px-1.5 py-0.5 text-[10px] text-red-400 transition-all hover:border-red-500/40 hover:bg-red-500/15"
                  disabled={clearing === r.app}
                  onClick={() => void clearApp(r.app)}
                >
                  {clearing === r.app ? '…' : '清理'}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** 隐私管理：应用排除 + OCR 资源 + 数据留存 + 用户画像（从设置中心独立） */
export default function PrivacyView() {
  const settings = useSettingsStore((s) => s.settings)
  const patch = useSettingsStore((s) => s.patch)
  const [ocrStats, setOcrStats] = useState<OcrStats | null>(null)
  const [clearing, setClearing] = useState(false)
  const [clearNote, setClearNote] = useState<string | null>(null)
  const [customApp, setCustomApp] = useState('')
  const [addingApp, setAddingApp] = useState(false)
  const [statsReload, setStatsReload] = useState(0)
  /** 应用痕迹统计默认收起，展开后才加载/渲染 */
  const [statsOpen, setStatsOpen] = useState(false)

  const p = (patchObj: Partial<AppSettings>) => void patch(patchObj)

  const loadOcrStats = useCallback(async () => {
    try {
      setOcrStats((await window.api.getOcrStats()) as OcrStats)
    } catch {
      setOcrStats(null)
    }
  }, [])

  useEffect(() => {
    void loadOcrStats()
  }, [loadOcrStats])

  const clearCache = async () => {
    if (!window.confirm('⚠️ 将删除所有截屏缓存（保留最近7天），不可恢复。确认清理？')) return
    setClearing(true)
    try {
      const r = (await window.api.clearOcrCache(7)) as OcrStats & { freedBytes: number }
      setOcrStats({ shotCount: r.shotCount, shotBytes: r.shotBytes, modelBytes: r.modelBytes, totalBytes: r.totalBytes })
      setClearNote(`清理完成，释放 ${fmtBytes(r.freedBytes)} 空间`)
    } catch {
      setClearNote('清理失败，请重试')
    } finally {
      setClearing(false)
      window.setTimeout(() => setClearNote(null), 4000)
    }
  }

  const excludedApps = settings.privacyExcludedApps ?? []
  const toggleExcludedApp = (app: string, on: boolean) => {
    const next = on ? [...new Set([...excludedApps, app])] : excludedApps.filter((a) => a !== app)
    p({ privacyExcludedApps: next })
  }
  const allPrivacyApps = [...new Set([...PRIVACY_PRESETS, ...excludedApps])]

  return (
    <div className="view-enter mx-auto flex w-full max-w-[960px] flex-col gap-5">
      {/* 页面标题区 */}
      <header className="flex items-center gap-3.5 px-1">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-neon-cyan/25 bg-neon-cyan/10 text-neon-cyan shadow-glow">
          <Icon name="shield" size={20} />
        </div>
        <div className="min-w-0">
          <h1 className="text-[17px] font-semibold tracking-wide text-slate-100">隐私与数据管理</h1>
          <p className="mt-0.5 text-[12px] text-slate-500">应用级采集控制 · OCR 资源 · 本地数据留存与画像</p>
        </div>
      </header>

      {/* 1. 应用级不采集 */}
      <Section title="隐私保护" icon="shield">
        <div className="py-2.5">
          <div className="mb-2 text-[12px] text-slate-500">应用级不采集（标记后完全停止：不截屏、不 OCR、不记标题、不产生活动记录）</div>
          <div className="grid grid-cols-2 gap-x-4 sm:grid-cols-3">
            {allPrivacyApps.map((app) => (
              <div
                key={app}
                className="-mx-1.5 flex items-center justify-between rounded-lg px-1.5 py-1.5 text-[13px] text-slate-300 transition-colors hover:bg-white/[0.03]"
              >
                {app}
                <Toggle checked={excludedApps.includes(app)} onChange={(v) => toggleExcludedApp(app, v)} />
              </div>
            ))}
          </div>
          {addingApp ? (
            <div className="anim-fade-in mt-2 flex items-center gap-2">
              <input
                className="glass-input !w-52 !py-1 !text-[12px]"
                placeholder="应用名（如 notepad.exe 或 记事本）"
                autoFocus
                value={customApp}
                onChange={(e) => setCustomApp(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && customApp.trim()) {
                    toggleExcludedApp(customApp.trim(), true)
                    setCustomApp('')
                    setAddingApp(false)
                  }
                  if (e.key === 'Escape') setAddingApp(false)
                }}
              />
              <button
                className="glass-btn primary !px-2 !py-1 !text-[11px]"
                disabled={!customApp.trim()}
                onClick={() => {
                  toggleExcludedApp(customApp.trim(), true)
                  setCustomApp('')
                  setAddingApp(false)
                }}
              >
                添加
              </button>
              <button className="glass-btn !px-2 !py-1 !text-[11px]" onClick={() => setAddingApp(false)}>
                取消
              </button>
            </div>
          ) : (
            <button
              className="mt-2 inline-flex items-center gap-1 text-[11px] text-neon-cyan/70 transition-colors hover:text-neon-cyan"
              onClick={() => setAddingApp(true)}
            >
              <Icon name="plus" size={11} /> 添加自定义应用
            </button>
          )}
          {/* 各应用痕迹统计（近 14 天，默认收起，展开后验证隐私标记是否生效） */}
          <div className="mt-3">
            <button
              className="flex items-center gap-1.5 text-[12px] text-slate-500 transition-colors hover:text-slate-300"
              title="展开验证隐私标记"
              onClick={() => setStatsOpen((o) => !o)}
            >
              <Icon name="chevronRight" size={12} className={`transition-transform duration-150 ${statsOpen ? 'rotate-90' : ''}`} />
              应用痕迹统计（近 14 天，验证隐私标记是否生效）
            </button>
            {statsOpen ? (
              <PrivacyStats reloadToken={statsReload} excludedKey={excludedApps.join(',')} onCleared={() => setStatsReload((t) => t + 1)} />
            ) : null}
          </div>
          <div className="mt-3 rounded-xl border border-neon-cyan/10 bg-neon-cyan/[0.03] p-3.5">
            <p className="mb-2 flex items-center gap-1.5 text-[13px] font-medium text-neon-cyan/80">🔒 数据存储声明</p>
            <div className="grid grid-cols-1 gap-x-4 gap-y-1 text-[11px] text-slate-500 sm:grid-cols-2">
              <p className="flex items-center gap-1.5">
                <Icon name="check" size={11} className="shrink-0 text-neon-green/80" /> 所有数据仅存储在本机
              </p>
              <p className="flex items-center gap-1.5">
                <Icon name="check" size={11} className="shrink-0 text-neon-green/80" /> 不上传任何服务器
              </p>
              <p className="flex items-center gap-1.5">
                <Icon name="check" size={11} className="shrink-0 text-neon-green/80" /> 不包含聊天内容/文件内容
              </p>
              <p className="flex items-center gap-1.5">
                <Icon name="check" size={11} className="shrink-0 text-neon-green/80" /> 标记不采集的应用：0 条活动记录（历史可一键清理）
              </p>
            </div>
          </div>
        </div>
      </Section>

      {/* 2. OCR 资源管理 */}
      <Section title="OCR 资源管理" icon="scan" delay={60}>
        <div className="py-2.5">
          <div className="flex flex-col gap-1.5 text-[13px]">
            <div className="flex items-center justify-between">
              <span className="text-slate-500">截屏缓存</span>
              <span className="text-slate-300">{ocrStats ? `${fmtBytes(ocrStats.shotBytes)}（${ocrStats.shotCount} 张）` : '—'}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-500">OCR 模型</span>
              <span className="text-slate-300">{ocrStats ? fmtBytes(ocrStats.modelBytes) : '—'}</span>
            </div>
            <div className="mt-1 flex items-center justify-between border-t border-white/[0.05] pt-2 font-medium">
              <span className="text-neon-cyan">总计占用</span>
              <span className="text-[15px] font-semibold text-neon-cyan">{ocrStats ? fmtBytes(ocrStats.totalBytes) : '—'}</span>
            </div>
          </div>
        </div>
        <Row label="自动清理周期" desc="保留最近 N 天数据，更早的自动删除">
          <div className="flex gap-1.5">
            {(
              [
                [7, '7天'],
                [14, '14天'],
                [30, '30天'],
                [60, '60天'],
                [0, '永不']
              ] as const
            ).map(([days, label]) => (
              <button key={days} className={pillClass(settings.ocrCleanupDays === days)} onClick={() => p({ ocrCleanupDays: days })}>
                {label}
              </button>
            ))}
          </div>
        </Row>
        <Row label="截屏自动压缩" desc="压缩截屏可节省约 50% 存储空间（存为 jpg）">
          <Toggle checked={settings.ocrAutoCompress} onChange={(v) => p({ ocrAutoCompress: v })} />
        </Row>
        <Row label="截屏缓存上限" desc="超出后自动删除最旧的截屏">
          <div className="flex gap-1.5">
            {(
              [
                [100, '100张'],
                [200, '200张'],
                [500, '500张'],
                [1000, '1000张']
              ] as const
            ).map(([n, label]) => (
              <button key={n} className={pillClass(settings.ocrCacheLimit === n)} onClick={() => p({ ocrCacheLimit: n })}>
                {label}
              </button>
            ))}
          </div>
        </Row>
        <div className="py-2.5">
          <button
            className="glass-btn danger w-full !py-2.5 font-medium"
            disabled={clearing}
            onClick={() => void clearCache()}
          >
            <Icon name="trash" size={13} /> {clearing ? '清理中…' : '一键清理全部截屏缓存'}
          </button>
          <p className="mt-1.5 flex items-center gap-1 text-[11px] text-slate-600">⚠️ 清理后不可恢复，仅保留最近7天</p>
          {clearNote ? <div className="anim-fade-in mt-1 text-[11px] text-neon-green">{clearNote}</div> : null}
        </div>
      </Section>

      {/* 3. 数据留存策略 */}
      <Section title="数据留存策略" icon="clock" delay={120}>
        <Row label="活动记录留存" desc="原始轨迹保留天数，更早的启动时自动清理">
          <NumberSetting value={settings.activityRetentionDays} min={7} max={180} suffix="天" onCommit={(v) => p({ activityRetentionDays: v })} />
        </Row>
      </Section>

      <section className="glass-card hoverable mt-4">
        <h3 className="mb-2 text-[14px] font-semibold text-slate-200">📁 工作文件夹</h3>
        <p className="mb-2 text-[12px] text-slate-500">配置后，会议纪要和随手记自动融入智能日报。</p>
        <button className="glass-btn primary text-[12px]" onClick={async () => { const paths = await window.api?.selectFolders?.() as string[]|undefined; if (paths?.length) { await window.api?.setSettings?.({folders:paths}); alert('已添加') } }}>
          📂 选择文件夹
        </button>
      </section>
    </div>
  )
}
