import { useCallback, useEffect, useState } from 'react'
import type { AppSettings } from '@shared/types'
import { useSettingsStore } from '../stores/settingsStore'
import { Icon } from '../components/Icon'
import { PageHeader } from '../components/PageHeader'
import { Toggle } from '../components/Toggle'
import { ConfirmDialog } from '../components/ConfirmDialog'

function monitorAccuracyOf(intervalMs: number) {
  if (intervalMs <= 2000) return { tier: '高', err: '±2s', note: '能捕捉秒级切窗，时长几乎无误差' }
  if (intervalMs <= 5000) return { tier: '标准', err: '±5s', note: '偶发 <3s 极短聚焦可能漏记' }
  return { tier: '粗', err: '±10s', note: '时长按 10s 粒度四舍五入，<8s 切窗易漏' }
}

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
      <h2 className="mb-3 flex items-center gap-2.5 text-base font-semibold text-slate-200">
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
        <div className="text-sm text-slate-300">{label}</div>
        {desc ? <div className="mt-0.5 text-xs text-slate-500">{desc}</div> : null}
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
      {suffix ? <span className="text-xs text-slate-500">{suffix}</span> : null}
    </span>
  )
}

function TextSetting({ value, onCommit, placeholder }: { value: string; onCommit: (v: string) => void; placeholder?: string }) {
  const [v, setV] = useState(value)
  useEffect(() => setV(value), [value])
  const commit = () => {
    if (v !== value) onCommit(v)
  }
  return (
    <input
      type="text"
      className="glass-input w-32"
      value={v}
      placeholder={placeholder}
      onChange={(e) => setV(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
      }}
    />
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
  return `pill-btn${active ? ' active' : ''}`
}

/** 隐私快标预置应用（与主进程别名匹配） */
const PRIVACY_PRESETS = ['微信', '钉钉', 'QQ', '飞书', '旺旺', 'Outlook']

/** 隐私痕迹统计表（近 14 天按应用聚合；每行附一键清理） */
function PrivacyStats({ reloadToken, excludedKey, onCleared }: { reloadToken: number; excludedKey: string; onCleared: () => void }) {
  const [rows, setRows] = useState<{ app: string; count: number; lastTs: number; excluded: boolean }[] | null>(null)
  const [clearing, setClearing] = useState<string | null>(null)
  const [confirmApp, setConfirmApp] = useState<string | null>(null)
  useEffect(() => {
    window.api
      .getPrivacyStats()
      .then((r) => setRows(r as typeof rows))
      .catch(() => setRows(null))
  }, [reloadToken, excludedKey])
  const clearApp = async (app: string) => {
    setConfirmApp(app)
  }
  if (!rows || rows.length === 0)
    return <div className="rounded-lg border border-dashed border-white/10 bg-white/[0.02] py-3 text-center text-xs text-slate-500">暂无采集记录</div>
  return (
    <div className="mt-2 overflow-hidden rounded-xl border border-white/[0.06]">
      <table className="w-full text-xs">
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
                  <span className="inline-flex items-center gap-1 rounded-full border border-neon-green/20 bg-neon-green/10 px-1.5 py-0.5 text-2xs text-neon-green">
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
                  className="rounded-md border border-red-500/25 px-1.5 py-0.5 text-2xs text-red-400 transition-all hover:border-red-500/40 hover:bg-red-500/15"
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
      <ConfirmDialog
        open={!!confirmApp}
        title={`清理「${confirmApp ?? ''}」的活动记录？`}
        message="将删除该应用近 14 天的全部活动记录，不可恢复。"
        confirmLabel="清理"
        danger
        onConfirm={() => {
          if (confirmApp) {
            setClearing(confirmApp)
            window.api.clearAppPrivacy(confirmApp).then(() => onCleared()).catch(() => undefined).finally(() => setClearing(null))
          }
          setConfirmApp(null)
        }}
        onCancel={() => setConfirmApp(null)}
      />
    </div>
  )
}

/** 「不采集」类别名单：静态五项，开关增删 privacyExcludedApps 关键词（别名包含式匹配） */
const DO_NOT_COLLECT_ITEMS = [
  { emoji: '💬', label: '微信 / 聊天', keyword: '微信', desc: '聊天应用不截屏、不记标题' },
  { emoji: '🏦', label: '银行 / 支付', keyword: '银行', desc: '含「银行」字样的应用与页面' },
  { emoji: '💊', label: '健康 / 医疗', keyword: '健康', desc: '健康类应用不进入任何分析' },
  { emoji: '🖼️', label: '相册 / 照片', keyword: '相册', desc: '照片类应用跳过 OCR 与记录' },
  { emoji: '🔑', label: '密码管理器', keyword: '密码', desc: '1Password / Bitwarden 等不记录' }
] as const

/** 不采集名单网格：两列卡（emoji + 名称 + 开关），绑定 settings.privacyExcludedApps 字符串数组 */
function DoNotCollectGrid({ excluded, onToggle }: { excluded: string[]; onToggle: (keyword: string, on: boolean) => void }) {
  return (
    <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
      {DO_NOT_COLLECT_ITEMS.map(({ emoji, label, keyword, desc }) => {
        const on = excluded.includes(keyword)
        return (
          <div
            key={keyword}
            className={`flex items-center gap-2.5 rounded-xl border px-3 py-2.5 transition-colors ${
              on ? '' : 'opacity-70'
            }`}
            style={{
              borderColor: on ? 'rgba(16,185,129,.35)' : 'var(--line)',
              background: on ? 'rgba(16,185,129,.06)' : 'var(--surface-2)'
            }}
            title={desc}
          >
            <span
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-base"
              style={{ background: 'var(--surface-3)', border: '1px solid var(--line)' }}
            >
              {emoji}
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium text-slate-200">{label}</div>
              <div className="mt-0.5 truncate text-2xs text-slate-500">{desc}</div>
            </div>
            <Toggle checked={on} onChange={(v) => onToggle(keyword, v)} />
          </div>
        )
      })}
    </div>
  )
}

interface PrivacyStatRow {
  app: string
  count: number
  lastTs: number
  excluded: boolean
}

/** 存储占用条：活动记录（真实条数，体积即将支持）/ AI 上下文缓存（OCR 实测字节）/ 报表附件（即将支持） */
function StorageBars() {
  const [ocr, setOcr] = useState<OcrStats | null>(null)
  const [recordCount, setRecordCount] = useState<number | null>(null)
  useEffect(() => {
    window.api
      .getOcrStats()
      .then((r) => setOcr(r as OcrStats))
      .catch(() => setOcr(null))
    window.api
      .getPrivacyStats()
      .then((r) => {
        const rows = (r as PrivacyStatRow[] | null) ?? []
        setRecordCount(rows.reduce((a, b) => a + (b.count || 0), 0))
      })
      .catch(() => setRecordCount(null))
  }, [])
  /** 满格基准：200MB */
  const REF = 200 * 1024 * 1024
  const rows: { emoji: string; label: string; gradient: string; width: number; value: string; pending?: boolean }[] = [
    {
      emoji: '📝',
      label: '活动记录',
      gradient: 'linear-gradient(90deg, var(--teal), var(--teal-border))',
      width: 26,
      value: recordCount != null ? `${recordCount.toLocaleString()} 条 · 体积统计即将支持` : '统计中…'
    },
    {
      emoji: '🤖',
      label: 'AI 上下文缓存',
      gradient: 'var(--aura)',
      width: ocr ? Math.max(4, Math.min(100, Math.round((ocr.totalBytes / REF) * 100))) : 3,
      value: ocr ? `${fmtBytes(ocr.totalBytes)}（截屏 ${ocr.shotCount} 张 + 模型）` : '统计中…'
    },
    {
      emoji: '📎',
      label: '报表附件',
      gradient: 'linear-gradient(90deg, rgba(139,92,246,.8), rgba(6,182,212,.45))',
      width: 12,
      value: '即将支持',
      pending: true
    }
  ]
  return (
    <div className="flex flex-col gap-3 py-1">
      {rows.map(({ emoji, label, gradient, width, value, pending }) => (
        <div key={label} className="flex items-center gap-3">
          <span className="w-28 shrink-0 truncate text-xs text-slate-400">
            {emoji} {label}
          </span>
          <span className="h-2 min-w-0 flex-1 overflow-hidden rounded-full" style={{ background: 'var(--surface-3)' }}>
            <span
              className={`block h-full rounded-full ${pending ? 'opacity-40' : ''}`}
              style={{ width: `${width}%`, background: gradient, transition: 'width .5s var(--ease-soft)' }}
            />
          </span>
          <span className={`w-44 shrink-0 text-right text-xs tabular-nums ${pending ? 'text-slate-600' : 'text-slate-500'}`}>{value}</span>
        </div>
      ))}
      <p className="text-2xs text-slate-600">数据全部存储在本机 userData 目录；清空方式见上方「一键清空」与下方留存策略。</p>
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
  /** 清理截屏缓存确认弹窗 */
  const [confirmClear, setConfirmClear] = useState(false)

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
    setClearing(true)
    try {
      const r = (await window.api.clearOcrCache(settings.ocrCleanupDays || 14)) as OcrStats & { freedBytes: number }
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
      <PageHeader icon="shield" title="隐私与数据管理" desc="应用级采集控制 · OCR 资源 · 本地数据留存与画像" />

      {/* 0.1 绿盾声明：本地优先 */}
      <div
        className="anim-fade-up glass-card hoverable flex flex-wrap items-center gap-3.5 !p-4"
        style={{
          background: 'var(--teal-wash)',
          border: '1px solid rgba(16,185,129,.35)'
        }}
      >
        <span
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl"
          style={{ background: 'linear-gradient(135deg, var(--teal), var(--teal-border))', boxShadow: '0 4px 14px var(--teal-glow)' }}
        >
          <Icon name="shield" size={20} className="text-white" />
        </span>
        <div className="min-w-[220px] flex-1">
          <div className="flex flex-wrap items-center gap-2 text-base font-semibold text-slate-100">
            本地优先 · 0 云端上传
            <span className="rounded-full border px-1.5 py-0.5 text-2xs font-medium" style={{ borderColor: 'rgba(16,185,129,.4)', background: 'rgba(16,185,129,.12)', color: '#34d399' }}>
              已验证
            </span>
          </div>
          <p className="mt-0.5 text-xs leading-relaxed text-slate-500">
            活动记录、画像与报表只写本机数据库；联网仅限天气查询与 AI（默认关闭），且不包含任何窗口正文内容。
          </p>
        </div>
        <button className="glass-btn primary shrink-0" onClick={() => setConfirmClear(true)} title="清空本机缓存数据（截屏缓存等）">
          <Icon name="trash" size={13} /> 一键清空
        </button>
      </div>

      {/* 0.2 不采集名单 */}
      <Section title="不采集名单" icon="eye" delay={30}>
        <div className="py-2.5">
          <p className="mb-2.5 text-xs text-slate-500">打开开关的类别完全停止采集：不截屏、不 OCR、不记标题、不产生活动记录。</p>
          <p className="mb-2.5 text-xs text-slate-600">未标记的聊天应用（微信 / QQ / 钉钉 / 飞书等）按<b className="text-slate-400">会话对象</b>细分记录：窗口标题每换一个联系人或群，时间轴与报表都会切成独立时段。</p>
          <DoNotCollectGrid excluded={excludedApps} onToggle={(k, v) => toggleExcludedApp(k, v)} />
        </div>
      </Section>

      {/* 0.3 存储占用 */}
      <Section title="存储占用" icon="chart" delay={60}>
        <StorageBars />
      </Section>

      {/* 1. 应用级不采集 */}
      <Section title="隐私保护" icon="shield">
        <div className="py-2.5">
          <div className="mb-2 text-xs text-slate-500">应用级不采集（标记后完全停止：不截屏、不 OCR、不记标题、不产生活动记录）</div>
          <div className="grid grid-cols-2 gap-x-4 sm:grid-cols-3">
            {allPrivacyApps.map((app) => (
              <div
                key={app}
                className="-mx-1.5 flex items-center justify-between rounded-lg px-1.5 py-1.5 text-sm text-slate-300 transition-colors hover:bg-white/[0.03]"
              >
                {app}
                <Toggle checked={excludedApps.includes(app)} onChange={(v) => toggleExcludedApp(app, v)} />
              </div>
            ))}
          </div>
          {addingApp ? (
            <div className="anim-fade-in mt-2 flex items-center gap-2">
              <input
                className="glass-input !w-52 !py-1 !text-xs"
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
                className="glass-btn primary !px-2 !py-1 !text-xs"
                disabled={!customApp.trim()}
                onClick={() => {
                  toggleExcludedApp(customApp.trim(), true)
                  setCustomApp('')
                  setAddingApp(false)
                }}
              >
                添加
              </button>
              <button className="glass-btn !px-2 !py-1 !text-xs" onClick={() => setAddingApp(false)}>
                取消
              </button>
            </div>
          ) : (
            <button
              className="mt-2 inline-flex items-center gap-1 text-xs text-neon-cyan/70 transition-colors hover:text-neon-cyan"
              onClick={() => setAddingApp(true)}
            >
              <Icon name="plus" size={11} /> 添加自定义应用
            </button>
          )}
          {/* 各应用痕迹统计（近 14 天，默认收起，展开后验证隐私标记是否生效） */}
          <div className="mt-3">
            <button
              className="flex items-center gap-1.5 text-xs text-slate-500 transition-colors hover:text-slate-300"
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
            <p className="mb-2 flex items-center gap-1.5 text-sm font-medium text-neon-cyan/80">🔒 数据存储声明</p>
            <div className="grid grid-cols-1 gap-x-4 gap-y-1 text-xs text-slate-500 sm:grid-cols-2">
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
              <p className="flex items-center gap-1.5">
                <Icon name="check" size={11} className="shrink-0 text-neon-green/80" /> 你填写的城市仅用于本地天气/通勤提醒，不上传
              </p>
            </div>
          </div>
        </div>
      </Section>

      {/* 1.5 数据采集频率（从设置页监控区迁入） */}
      <Section title="数据采集频率" icon="activity" delay={60}>
        <Row label="采样间隔" desc="采集基础周期，越短越准、占用略升">
          <div className="flex gap-1.5">
            {([2000, 5000, 10000, 30000] as const).map((ms) => (
              <button
                key={ms}
                className={pillClass(settings.monitorInterval === ms)}
                onClick={() => p({ monitorInterval: ms })}
              >
                {ms / 1000}s
              </button>
            ))}
          </div>
        </Row>
        <div className="-mx-2 px-2 py-0.5">
          {(() => {
            const acc = monitorAccuracyOf(settings.monitorInterval)
            return (
              <p className="text-xs leading-relaxed text-slate-500">
                当前精度：<span className="text-slate-300">{acc.tier}</span>（时长误差约 {acc.err}）· {acc.note}
              </p>
            )
          })()}
        </div>
        <Row label="智能轮询" desc="深度专注时自动降频省电，摸鱼时升频捕捉细节">
          <Toggle checked={settings.monitorSmart} onChange={(v) => p({ monitorSmart: v })} />
        </Row>
        <Row label="深度模式（OCR）" desc="空闲/干活都会采：仅「正在动手」那 1～2 秒跳过截屏防卡鼠标；干活中约每 45 秒可采一次">
          <Toggle checked={settings.deepMode} onChange={(v) => p({ deepMode: v })} />
        </Row>
        <Row label="性能优先" desc="停用屏幕 OCR 截屏（卡鼠标的主因之一），并降低后台采集负担。日常卡顿建议打开">
          <Toggle checked={!!settings.performanceMode} onChange={(v) => p({ performanceMode: v })} />
        </Row>
        <details className="-mx-2 px-2 py-1.5">
          <summary className="cursor-pointer text-xs text-slate-500 hover:text-slate-300">记录分层说明</summary>
          <p className="mt-1 text-xs leading-relaxed text-slate-500">
            记录分两层：<span className="text-slate-300">时长 / 应用 / 类目 / 当前会话对象</span> 为精确记录；「刷了 N 条」等细颗粒内容属<span className="text-slate-300">估算</span>（需开启深度模式，带置信度标注），非精确事实。
          </p>
        </details>
      </Section>

      {/* 2. OCR 资源管理 */}
      <Section title="OCR 资源管理" icon="scan" delay={60}>
        <div className="py-2.5">
          <div className="flex flex-col gap-1.5 text-sm">
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
              <span className="text-lg font-semibold text-neon-cyan">{ocrStats ? fmtBytes(ocrStats.totalBytes) : '—'}</span>
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
            onClick={() => setConfirmClear(true)}
          >
            <Icon name="trash" size={13} /> {clearing ? '清理中…' : '一键清理全部截屏缓存'}
          </button>
          <p className="mt-1.5 flex items-center gap-1 text-xs text-slate-600">⚠️ 清理后不可恢复，仅保留最近7天</p>
          {clearNote ? <div className="anim-fade-in mt-1 text-xs text-neon-green">{clearNote}</div> : null}
        </div>
      </Section>

      {/* 3. 数据留存策略 */}
      <Section title="数据留存策略" icon="clock" delay={120}>
        <Row label="活动记录留存" desc="原始轨迹保留天数，更早的启动时自动清理">
          <NumberSetting value={settings.activityRetentionDays} min={7} max={180} suffix="天" onCommit={(v) => p({ activityRetentionDays: v })} />
        </Row>
        <Row label="我所在的位置" desc="城市名，用于天气与通勤提醒（如 天津）。留空则不展示天气（需填写城市）。">
          <TextSetting value={settings.city ?? ''} placeholder="如 天津" onCommit={(v: string) => p({ city: v.trim() })} />
        </Row>
      </Section>

      {/* 清理截屏缓存确认弹窗 */}
      <ConfirmDialog
        open={confirmClear}
        title="清理全部截屏缓存？"
        message="将删除所有截屏缓存（保留最近 7 天），不可恢复。"
        confirmLabel="清理"
        danger
        onConfirm={() => { setConfirmClear(false); void clearCache() }}
        onCancel={() => setConfirmClear(false)}
      />

    </div>
  )
}
