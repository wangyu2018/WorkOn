import { useCallback, useEffect, useState } from 'react'
import type { AppSettings } from '@shared/types'
import { useSettingsStore } from '../stores/settingsStore'
import { Icon } from '../components/Icon'
import { Toggle } from '../components/Toggle'
import { fmtMin } from '../components/utils'

function WatchedFolders() {
  const [dirs, setDirs] = useState<string[]>([])
  useEffect(() => { void window.api?.getSettings?.().then((s) => setDirs((s as AppSettings)?.folders ?? [])) }, [])

  const addFolder = async () => {
    const paths = await window.api?.selectFolders?.() as string[] | undefined
    if (paths?.length) {
      const next = [...new Set([...dirs, ...paths])]
      setDirs(next)
      await window.api?.setSettings?.({ folders: next })
      await window.api?.setFolders?.(next)
    }
  }

  const removeFolder = async (dir: string) => {
    const next = dirs.filter((d) => d !== dir)
    setDirs(next)
    await window.api?.setSettings?.({ folders: next })
    await window.api?.setFolders?.(next)
  }

  return (
    <div className="space-y-2">
      {dirs.length === 0 ? (
        <p className="text-[12px] text-slate-600">尚未添加工作文件夹。点击下方按钮选择目录。</p>
      ) : (
        dirs.map((d) => (
          <div key={d} className="flex items-center justify-between rounded-lg bg-white/5 px-3 py-2 text-[12px]">
            <span className="text-slate-300 truncate">{d}</span>
            <button onClick={() => void removeFolder(d)} className="text-slate-500 hover:text-red-400">✕</button>
          </div>
        ))
      )}
      <button className="glass-btn primary" onClick={() => void addFolder()}>
        <Icon name="folder" size={13} />
        添加文件夹
      </button>
    </div>
  )
}

/* ── 分组与行 ── */
function Section({ title, icon, children }: { title: string; icon: Parameters<typeof Icon>[0]['name']; children: React.ReactNode }) {
  return (
    <section className="glass-card hoverable">
      <h2 className="mb-3 flex items-center gap-2 text-[14px] font-semibold text-slate-200">
        <Icon name={icon} size={15} className="text-neon-cyan" /> {title}
      </h2>
      <div className="flex flex-col divide-y divide-white/[0.05]">{children}</div>
    </section>
  )
}

function Row({ label, desc, children }: { label: string; desc?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-4 py-2.5">
      <div className="min-w-0 flex-1">
        <div className="text-[13px] text-slate-300">{label}</div>
        {desc ? <div className="mt-0.5 text-[11px] text-slate-500">{desc}</div> : null}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  )
}

/** 集成能力区块：能力介绍 + 启用开关 + 折叠详情（关闭时不渲染技术细节） */
function IntegrationSection({
  title,
  icon,
  description,
  enabled,
  onToggle,
  children
}: {
  title: string
  icon: Parameters<typeof Icon>[0]['name']
  description: string
  enabled: boolean
  onToggle: (v: boolean) => void
  children: React.ReactNode
}) {
  return (
    <Section title={title} icon={icon}>
      <div className="py-1">
        <p className="mb-2 text-[12px] leading-relaxed text-slate-500">{description}</p>
        <Row label="启用">
          <Toggle checked={enabled} onChange={onToggle} />
        </Row>
        {enabled ? <div className="anim-fade-in mt-1 flex flex-col divide-y divide-white/[0.05] border-l-2 border-neon-cyan/20 pl-3">{children}</div> : null}
      </div>
    </Section>
  )
}

/** 文本输入：本地编辑，失焦 / 回车即时生效 */
function TextSetting({
  value,
  onCommit,
  placeholder,
  password,
  width = 'w-56'
}: {
  value: string
  onCommit: (v: string) => void
  placeholder?: string
  password?: boolean
  width?: string
}) {
  const [v, setV] = useState(value)
  useEffect(() => setV(value), [value])
  const commit = () => {
    if (v !== value) onCommit(v)
  }
  return (
    <input
      type={password ? 'password' : 'text'}
      className={`glass-input ${width}`}
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

/** 数字输入：失焦 / 回车即时生效 */
function NumberSetting({
  value,
  onCommit,
  min,
  max,
  step,
  suffix
}: {
  value: number
  onCommit: (v: number) => void
  min?: number
  max?: number
  step?: number
  suffix?: string
}) {
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
        step={step}
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
  active: boolean
}

interface UserProfileSummary {
  monitorDays: number
  focusMin: number
  bestFocusDay: string | null
  bestFocusDayMin: number
  topSlackDay: string | null
  topSlackDayMin: number
  longestFocusMin: number
  longestFocusDate: string | null
  topApps: { name: string; pct: number }[]
}

/** AI 提示词三层上下文调试面板（开发者选项开启时显示） */
function PromptLayers() {
  const [layers, setLayers] = useState<{ title: string; data: unknown }[] | null>(null)
  const [open, setOpen] = useState(false)
  const load = () => {
    if (!open) {
      window.api
        .getPromptLayers()
        .then((r) => setLayers([r.layer1, r.layer2, r.layer3] as { title: string; data: unknown }[]))
        .catch(() => setLayers(null))
    }
    setOpen(!open)
  }
  return (
    <div className="py-2.5">
      <button className="text-[11px] text-neon-cyan/70 transition-colors hover:text-neon-cyan" onClick={load}>
        {open ? '▾ 收起提示词三层上下文' : '▸ 查看提示词三层上下文（调试）'}
      </button>
      {open && layers ? (
        <div className="anim-fade-in mt-2 flex flex-col gap-2">
          {layers.map((l, i) => (
            <div key={i} className="rounded-lg border border-white/[0.07] bg-white/[0.02] p-2.5">
              <div className="mb-1 text-[11px] font-medium text-neon-violet">{l.title}</div>
              <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all text-[10px] leading-relaxed text-slate-400">
                {typeof l.data === 'string' ? l.data : JSON.stringify(l.data, null, 2)}
              </pre>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  )
}

/* ── 设置视图（单列垂直布局，修改即生效） ── */
export default function SettingsView() {
  const settings = useSettingsStore((s) => s.settings)
  const patch = useSettingsStore((s) => s.patch)
  const [syncState, setSyncState] = useState<'idle' | 'syncing' | 'ok' | 'fail'>('idle')
  const [aiTest, setAiTest] = useState<{ state: 'idle' | 'testing' | 'ok' | 'fail'; text?: string }>({ state: 'idle' })
  const [aiKeyHint, setAiKeyHint] = useState<string | null>(null)
  /** 配置区展开状态：未配置时默认展开（新用户先填参数再谈开启） */
  const [aiExpanded, setAiExpanded] = useState(!settings.aiEnabled)
  const [aiEnabling, setAiEnabling] = useState(false)
  const p = (patchObj: Partial<AppSettings>) => void patch(patchObj)

  /** 启用/停用 AI：开启前先校验连通性（有 Key 且能连上才允许开启） */
  const toggleAI = async (v: boolean): Promise<void> => {
    if (!v) {
      p({ aiEnabled: false })
      return
    }
    if (!settings.aiApiKey) {
      setAiKeyHint('请先展开配置参数填入 API Key，再启用 AI')
      setAiExpanded(true)
      window.setTimeout(() => setAiKeyHint(null), 5000)
      return
    }
    setAiEnabling(true)
    try {
      const r = (await window.api.testAI()) as { ok: boolean; error?: string; hint?: string }
      if (r.ok) {
        p({ aiEnabled: true })
        setAiKeyHint(null)
      } else {
        setAiKeyHint(`连接失败：${r.error ?? '未知错误'}${r.hint ? `（${r.hint}）` : ''}，请检查 Key 与 Base URL`)
        window.setTimeout(() => setAiKeyHint(null), 8000)
      }
    } catch (e) {
      setAiKeyHint(`连接失败：${(e as Error).message}`)
      window.setTimeout(() => setAiKeyHint(null), 8000)
    } finally {
      setAiEnabling(false)
    }
  }

  const testAI = async () => {
    setAiTest({ state: 'testing' })
    try {
      const r = (await window.api.testAI()) as {
        ok: boolean
        latency?: number
        model?: string
        error?: string
        hint?: string
      }
      if (r.ok) {
        setAiTest({ state: 'ok', text: `连接成功 | 延迟 ${r.latency}ms | 模型 ${r.model}` })
        if (!settings.aiEnabled) p({ aiEnabled: true })
      } else {
        setAiTest({ state: 'fail', text: `连接失败 | ${r.error}${r.hint ? `（${r.hint}）` : ''}` })
      }
    } catch (e) {
      setAiTest({ state: 'fail', text: `连接失败 | ${(e as Error).message}` })
    } finally {
      window.setTimeout(() => setAiTest({ state: 'idle' }), 10000)
    }
  }

  const sync = async () => {
    setSyncState('syncing')
    try {
      await window.api.onerSync()
      setSyncState('ok')
    } catch {
      setSyncState('fail')
    } finally {
      window.setTimeout(() => setSyncState('idle'), 2500)
    }
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      {/* 1. 监控 */}
      <Section title="监控" icon="activity">
        <Row label="采样间隔" desc="基础轮询周期（智能模式下会按状态自动升降频）">
          <div className="flex gap-1.5">
            {(
              [
                [2000, '2s'],
                [5000, '5s'],
                [10000, '10s'],
                [30000, '30s']
              ] as const
            ).map(([ms, label]) => (
              <button
                key={ms}
                className={`rounded-lg border px-2.5 py-1.5 text-[12px] transition-all ${
                  settings.monitorInterval === ms ? 'border-white/30 bg-white/[0.08] text-slate-100' : 'border-white/[0.07] text-slate-400 hover:border-white/20'
                }`}
                onClick={() => p({ monitorInterval: ms })}
              >
                {label}
              </button>
            ))}
          </div>
        </Row>
        <Row label="智能轮询" desc="深度专注≥80 自动降频到 10s（省电少打扰）；摸鱼时升频到 3s（及时捕捉）">
          <Toggle checked={settings.monitorSmart} onChange={(v) => p({ monitorSmart: v })} />
        </Row>
        <Row label="计划完成预测" desc="监控/日历时间轴上按计划完成概率三色标注（绿=可完成 橙=可能延迟 红=高风险）">
          <Toggle checked={settings.planForecastEnabled} onChange={(v) => p({ planForecastEnabled: v })} />
        </Row>
        <Row label="深度模式（OCR）" desc="开启后每30s对屏幕截图做 OCR 文字识别，自动判断浏览/工作内容（抖音/淘宝/GitHub/AI助手等），提升状态推断精度。重启监控后生效。缓存与清理已移至「隐私」模块">
          <Toggle checked={settings.deepMode} onChange={(v) => p({ deepMode: v })} />
        </Row>
        <Row label="会议模式" desc="检测到会议软件时的默认行为">
          <div className="flex gap-2">
            {(
              [
                ['ask', '每次询问'],
                ['stealth', '一键隐身'],
                ['quiet', '免打扰'],
                ['assist', '会议辅助']
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                className={`rounded-lg border px-2.5 py-1.5 text-[12px] transition-all ${
                  settings.meetingMode === id ? 'border-white/30 bg-white/[0.08] text-slate-100' : 'border-white/[0.07] text-slate-400 hover:border-white/20'
                }`}
                onClick={() => p({ meetingMode: id })}
              >
                {label}
              </button>
            ))}
          </div>
        </Row>
        <Row label="纠偏规则" desc="已移至「监控」页面的分类管理与纠偏规则管理">
          <span className="text-[11px] text-slate-500">监控 →</span>
        </Row>
      </Section>

      {/* 3. AI（配置区独立可展开；开启前先测连通，通过才启用） */}
      {aiKeyHint ? (
        <div className="anim-fade-in rounded-xl border border-neon-amber/30 bg-neon-amber/10 px-4 py-2.5 text-[12px] text-neon-amber">
          ⚠️ {aiKeyHint}
        </div>
      ) : null}
      <Section title="AI" icon="brain">
        <div className="py-1">
          <p className="mb-2 text-[12px] leading-relaxed text-slate-500">
            开启后解锁：LLM 深度画像、情境化建议、智能问答、提示词三层上下文。未开启时基础能力仍可用：规则分析（专注/效率指数、最佳时段、分心应用）、本地统计问答、习惯推导。
          </p>
          <div className="flex items-center justify-between gap-3">
            <Row label="启用">
              <div className="flex items-center gap-2">
                {aiEnabling ? <span className="text-[11px] text-slate-500">校验中…</span> : null}
                <Toggle
                  checked={settings.aiEnabled}
                  disabled={aiEnabling}
                  onChange={(v) => void toggleAI(v)}
                />
              </div>
            </Row>
            <button className="shrink-0 text-[11px] text-neon-cyan/70 transition-colors hover:text-neon-cyan" onClick={() => setAiExpanded((e) => !e)}>
              {aiExpanded ? '▾ 收起配置参数' : '▸ 展开配置参数'}
            </button>
          </div>
          {aiExpanded ? (
            <div className="anim-fade-in mt-1 flex flex-col divide-y divide-white/[0.05] border-l-2 border-neon-cyan/20 pl-3">
              <Row label="API Key" desc="OpenAI 兼容接口密钥，仅存本地">
                <TextSetting password value={settings.aiApiKey} placeholder="sk-…" onCommit={(v) => p({ aiApiKey: v })} />
              </Row>
              <Row label="Base URL">
                <TextSetting value={settings.aiBaseUrl} placeholder="https://api.openai.com/v1" onCommit={(v) => p({ aiBaseUrl: v })} />
              </Row>
              <Row label="模型">
                <TextSetting value={settings.aiModel} placeholder="gpt-4o-mini" width="w-40" onCommit={(v) => p({ aiModel: v })} />
              </Row>
              <Row label="固定刷新当日画像" desc="开启后当日画像重复利用，节省 token">
                <Toggle checked={settings.aiAutoRefresh} onChange={(v) => p({ aiAutoRefresh: v })} />
              </Row>
              <Row label="自动刷新间隔" desc="AI 画像自动刷新周期（关闭则只能手动刷新）">
                <div className="flex gap-1.5">
                  {(
                    [
                      [15, '15分钟'],
                      [30, '30分钟'],
                      [60, '60分钟'],
                      [0, '关闭']
                    ] as const
                  ).map(([min, label]) => (
                    <button
                      key={min}
                      className={`rounded-lg border px-2.5 py-1.5 text-[12px] transition-all ${
                        settings.aiAutoRefreshMin === min ? 'border-white/30 bg-white/[0.08] text-slate-100' : 'border-white/[0.07] text-slate-400 hover:border-white/20'
                      }`}
                      onClick={() => p({ aiAutoRefreshMin: min })}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </Row>
              <Row label="连通性测试" desc="发送一条最小请求验证配置">
                <div className="flex flex-col items-end gap-1.5">
                  <button className="glass-btn primary" disabled={aiTest.state === 'testing'} onClick={() => void testAI()}>
                    <Icon name="zap" size={13} className={aiTest.state === 'testing' ? 'animate-pulse' : ''} />
                    {aiTest.state === 'testing' ? '测试中…' : '测试连接'}
                  </button>
                  {aiTest.text ? (
                    <div
                      className={`anim-fade-in max-w-[300px] text-right text-[11px] ${
                        aiTest.state === 'ok' ? 'text-neon-green' : 'text-neon-red'
                      }`}
                    >
                      {aiTest.state === 'ok' ? '✓ ' : aiTest.state === 'fail' ? '✗ ' : ''}
                      {aiTest.text}
                    </div>
                  ) : null}
                </div>
              </Row>
              {/* 提示词三层上下文（开发者选项开启时可见） */}
              {settings.devMode ? <PromptLayers /> : null}
            </div>
          ) : null}
        </div>
      </Section>

      {/* 4. 外观 */}
      <Section title="外观" icon="sparkles">
        <Row label="强调色主题" desc="全局高亮色，切换立即生效">
          <div className="flex gap-2">
            {(
              [
                ['cyan', '#22D3EE', '青'],
                ['violet', '#A78BFA', '紫'],
                ['green', '#34D399', '绿'],
                ['amber', '#FBBF24', '琥珀']
              ] as const
            ).map(([id, color, label]) => (
              <button
                key={id}
                className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[12px] transition-all ${
                  settings.theme === id ? 'border-white/30 bg-white/[0.08] text-slate-100' : 'border-white/[0.07] text-slate-400 hover:border-white/20'
                }`}
                style={settings.theme === id ? { boxShadow: `0 0 10px ${color}44` } : undefined}
                onClick={() => p({ theme: id })}
              >
                <span className="h-3 w-3 rounded-full" style={{ background: color, boxShadow: `0 0 6px ${color}` }} />
                {label}
              </button>
            ))}
          </div>
        </Row>
        <Row label="亮暗模式" desc="跟随系统时随操作系统自动切换">
          <div className="flex gap-2">
            {(
              [
                ['light', '☀️', '亮色'],
                ['dark', '🌙', '暗色'],
                ['auto', '🖥️', '跟随系统']
              ] as const
            ).map(([id, emoji, label]) => (
              <button
                key={id}
                className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[12px] transition-all ${
                  settings.appearanceMode === id ? 'border-white/30 bg-white/[0.08] text-slate-100' : 'border-white/[0.07] text-slate-400 hover:border-white/20'
                }`}
                onClick={() => p({ appearanceMode: id })}
              >
                <span>{emoji}</span>
                {label}
              </button>
            ))}
          </div>
        </Row>
        <Row label="日历分析背景带" desc="日视图叠加你的习惯午休/高效时段底色（数据来自近 7 天习惯画像）">
          <Toggle checked={settings.calAnalysisBands} onChange={(v) => p({ calAnalysisBands: v })} />
        </Row>
      </Section>

      {/* 5. 悬浮窗 */}
      <Section title="悬浮窗" icon="monitor">
        <Row label="启动时显示悬浮窗">
          <Toggle checked={settings.widgetVisible} onChange={(v) => p({ widgetVisible: v })} />
        </Row>
        <Row label="现在显隐一次">
          <button className="glass-btn" onClick={() => window.api.toggleWidget()}>
            <Icon name="eye" size={13} /> 切换显隐
          </button>
        </Row>
        <Row label={`透明度 ${(settings.widgetOpacity * 100).toFixed(0)}%`} desc="20% – 100%，拖动即时生效">
          <input
            type="range"
            className="w-44"
            min={0.2}
            max={1}
            step={0.01}
            value={settings.widgetOpacity}
            onChange={(e) => {
              const v = Number(e.target.value)
              window.api.setWidgetOpacity(v)
              p({ widgetOpacity: v })
            }}
          />
        </Row>
      </Section>

      {/* 8. Oner 数据同步（能力 + 开关 + 折叠详情） */}
      <IntegrationSection
        title="Oner 数据同步"
        icon="refresh"
        description="桌搭可以与 Oner 备忘同步工时数据，实现跨设备效率数据流转。开启后按计划间隔自动拉取待办。"
        enabled={settings.onerAutoSyncMin > 0}
        onToggle={(v) => p({ onerAutoSyncMin: v ? Math.max(5, settings.onerAutoSyncMin || 30) : 0 })}
      >
        <Row label="接口地址" desc="GET {endpoint}/plans 拉取，PATCH 回写状态">
          <TextSetting value={settings.onerEndpoint} placeholder="https://oner.example.com" onCommit={(v) => p({ onerEndpoint: v })} />
        </Row>
        <Row label="Token" desc="Bearer 鉴权">
          <TextSetting password value={settings.onerToken} onCommit={(v) => p({ onerToken: v })} />
        </Row>
        <Row label="自动同步间隔">
          <NumberSetting value={settings.onerAutoSyncMin} min={5} max={1440} suffix="分钟" onCommit={(v) => p({ onerAutoSyncMin: v })} />
        </Row>
        <Row label="手动同步">
          <button className="glass-btn primary" disabled={syncState === 'syncing'} onClick={() => void sync()}>
            <Icon name="refresh" size={13} className={syncState === 'syncing' ? 'animate-spin' : ''} />
            {syncState === 'syncing' ? '同步中…' : syncState === 'ok' ? '已同步 ✓' : syncState === 'fail' ? '同步失败' : '立即同步'}
          </button>
        </Row>
      </IntegrationSection>

      {/* 9. 本地集成（能力 + 开关 + 折叠详情） */}
      <IntegrationSection
        title="本地集成"
        icon="zap"
        description="WorkOn 可将实时状态广播给其他本地工具（如桌搭、外部脚本），支持 WebSocket 广播与 state.json 快照输出。"
        enabled={settings.wsEnabled}
        onToggle={(v) => p({ wsEnabled: v })}
      >
        <Row label="WS 端口" desc="监听 127.0.0.1，对外广播实时桌面状态">
          <NumberSetting value={settings.wsPort} min={1024} max={65535} onCommit={(v) => p({ wsPort: v })} />
        </Row>
        <Row label="写 state.json 快照" desc="供外部程序（如桌搭）读取">
          <Toggle checked={settings.stateSnapshot} onChange={(v) => p({ stateSnapshot: v })} />
        </Row>
      </IntegrationSection>

      {/* 10. 系统 */}
      <Section title="系统" icon="settings">
        <Row label="开机自启">
          <Toggle checked={settings.launchAtLogin} onChange={(v) => p({ launchAtLogin: v })} />
        </Row>
        <Row label="开发者选项" desc="开启后显示桌搭资源占用面板与 AI 提示词三层上下文（调试用）">
          <Toggle checked={settings.devMode} onChange={(v) => p({ devMode: v })} />
        </Row>
      </Section>

      {/* 11. 命令面板 */}
      <Section title="命令面板" icon="command">
        <p className="mb-2 text-[12px] leading-relaxed text-slate-500">
          Ctrl+K 呼出全局命令面板，可快速跳转页面、新建计划、控制桌搭/悬浮窗显隐、刷新AI画像、切换主题等。无需离开键盘即可完成常用操作。
        </p>
        <Row label="启用 Ctrl+K 命令面板">
          <Toggle checked={settings.cmdPaletteEnabled} onChange={(v) => p({ cmdPaletteEnabled: v })} />
        </Row>
        <div className="py-2.5">
          <div className="mb-1 text-[11px] text-slate-500">可用命令一览：</div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[12px] text-slate-400">
            <div>🔍 跳转：监控 / 日历 / 计划 / 报表 / 桌搭 / 问答 / 设置</div>
            <div>➕ 新建计划（今日）</div>
            <div>👁️ 显隐悬浮窗</div>
            <div>🐱 显隐桌搭</div>
            <div>🔄 刷新 AI 画像</div>
            <div>✨ 切换强调色主题</div>
            <div>💬 问 AI…</div>
          </div>
        </div>
      </Section>

      {/* v3.0 文件夹 ingestion */}
      <Section title="工作文件夹" icon="folder">
        <p className="mb-3 text-[12px] text-slate-500">
          添加工作目录后，其中的 随手记(.md) / 会议纪要 / 数据表(.csv) 将自动融入日报周报生成。
        </p>
        <WatchedFolders />
      </Section>

      {/* v3.0 VRM 照片生成（入口占位） */}
      <Section title="VRM 照片生成虚拟人" icon="cat">
        <p className="mb-3 text-[12px] text-slate-500">
          上传本人照片，生成接近 1:1 还原的虚拟角色（发型 / 服装 / 比例与照片一致）。功能后续开放，敬请期待。
        </p>
        <button
          className="glass-btn primary"
          onClick={() => { /* P3 实现 */ }}
          title="功能后续开放"
        >
          📷 上传照片生成虚拟人
        </button>
      </Section>
    </div>
  )
}
