/**
 * 用户画像管理页（v2.7）：顶部摘要卡 + 左导航（八层/隐私/日志）+ 中间内容 + 右侧 AI 访问概览
 * 依据：workon-design-spec-v2.7 §1.2 八层画像、§2 五级隐私、§4 可追溯访问日志
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { AccessLog, MergedTrail, PrivacyLevel, ProfileField, UserPersona, UserType } from '@shared/types'
import { PERSONA_LAYERS, PRIVACY_LEVEL_META, completenessLabel, completenessOf, type PersonaLayerMeta } from '@shared/personaMeta'
import { USER_TYPE_META } from '@shared/attention'
import { WORK_LIKE_STATES } from '@shared/stateMeta'
import { Icon } from '../components/Icon'
import { Toggle } from '../components/Toggle'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { fmtMin } from '../components/utils'
import { useSettingsStore } from '../stores/settingsStore'

type PersonaLayerKey = PersonaLayerMeta['key']
type NavKey = PersonaLayerKey | 'score' | 'privacy' | 'logs'

// ───────────────────────── 枚举中文映射 ─────────────────────────

const EXP_LABEL = { junior: '初级', mid: '中级', senior: '资深', expert: '专家' } as const
const WORKMODE_LABEL = { office: '坐班', remote: '远程', hybrid: '混合' } as const
const WORKSTYLE_LABEL = { pomodoro: '番茄钟', flow: '心流', flexible: '弹性', structured: '结构化' } as const
const COMM_LABEL = { direct: '直接', encouraging: '鼓励', minimal: '简洁' } as const
const TOLERANCE_LABEL = { high: '高', medium: '中', low: '低' } as const
const PROGRESS_LABEL = { exploring: '探索中', learning: '学习中', practicing: '实践中', mastered: '已掌握' } as const
const WEEKEND_LABEL = { work: '工作为主', rest: '休息为主', mixed: '混合' } as const
const TREND_LABEL = { improving: '上升', stable: '平稳', declining: '下降' } as const
const MOTIVATION_LABEL = { intrinsic: '内在驱动', extrinsic: '外在驱动', mixed: '内外混合' } as const
const ATTENTION_LABEL = { sustained: '持续型', selective: '选择型', divided: '分散型' } as const
const ENERGY_LABEL = { morning: '早晨型', afternoon: '下午型', evening: '傍晚型', night: '夜间型' } as const
const EMOTION_TREND_LABEL = { positive: '向好', neutral: '平稳', negative: '走低' } as const

/** 日志引用方中文 */
const REQUESTER_LABEL: Record<string, string> = { ai_qa: 'AI问答', companion: '桌宠', report: '报表' }
/** 日志脱敏规则中文 */
const RULE_LABEL: Record<string, string> = {
  raw: '原文引用',
  summary: '摘要',
  aggregation: '聚合',
  strategy_directive: '策略内化',
  denied: '已拒绝'
}
/** 日志按等级显示的层名（同一等级可能覆盖多个画像层） */
const LEVEL_LAYER_LABEL: Record<string, string> = { L0: '基础信息', L1: '身份/偏好', L2: '行为/兴趣', L3: '心理/关系', L4: '核心隐私' }

// ───────────────────────── 时间格式化 ─────────────────────────

const fmtTime = (ts: number) => new Date(ts).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })
const fmtDate = (ts: number) => (ts ? new Date(ts).toLocaleDateString('zh-CN') : '—')

function dayGroupLabel(ts: number): string {
  const startOf = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  const diff = Math.round((startOf(new Date()) - startOf(new Date(ts))) / 86400000)
  if (diff <= 0) return '今天'
  if (diff === 1) return '昨天'
  const d = new Date(ts)
  return `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// ───────────────────────── 通用小组件 ─────────────────────────

/** 只读信息行 */
function InfoRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="-mx-2 flex items-center gap-4 rounded-lg px-2 py-2 transition-colors hover:bg-white/[0.03]">
      <span className="w-28 shrink-0 text-xs text-slate-500">{label}</span>
      <div className="min-w-0 flex-1 text-sm text-slate-300">{children}</div>
    </div>
  )
}

/** 0-100 进度条 */
function MeterBar({ value, color }: { value: number; color: string }) {
  const pct = Math.max(0, Math.min(100, Math.round(value)))
  return (
    <span className="flex items-center gap-2">
      <span className="h-1.5 w-28 overflow-hidden rounded-full bg-white/[0.06]">
        <span className="block h-full rounded-full transition-all duration-300" style={{ width: `${pct}%`, background: color, boxShadow: `0 0 6px ${color}66` }} />
      </span>
      <span className="tabular-nums text-xs text-slate-500">{pct}</span>
    </span>
  )
}

/** 来源 chip：[手动] / [自动 0.82] */
function SourceChip({ field }: { field: ProfileField<unknown> }) {
  if (field.source === 'manual') {
    return <span className="rounded border border-neon-green/25 bg-neon-green/10 px-1.5 py-0.5 text-2xs text-neon-green">手动</span>
  }
  return (
    <span className="rounded border border-white/[0.08] bg-white/[0.04] px-1.5 py-0.5 text-2xs tabular-nums text-slate-500" title={`自动采集 · 置信度 ${field.confidence.toFixed(2)}`}>
      自动 {field.confidence.toFixed(2)}
    </span>
  )
}

/** 设置行：左标签/描述 + 右侧控件（注意力与评分页用） */
function SettingRow({ label, desc, children }: { label: string; desc?: string; children: React.ReactNode }) {
  return (
    <div className="-mx-2 flex flex-col gap-2 rounded-lg px-2 py-2 transition-colors hover:bg-white/[0.03]">
      <div className="min-w-0">
        <div className="text-sm text-slate-300">{label}</div>
        {desc ? <div className="mt-0.5 text-xs leading-relaxed text-slate-500">{desc}</div> : null}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  )
}

/** 数字输入：失焦 / 回车即时生效（与设置页同逻辑） */
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
      {suffix ? <span className="text-xs text-slate-500">{suffix}</span> : null}
    </span>
  )
}

/** 可编辑画像字段行（值 + 来源 chip + 编辑/确认；空值显示「+ 填写」） */
function FieldRow<T extends string>({
  label,
  field,
  options,
  display,
  onCommit,
  onConfirm
}: {
  label: string
  field?: ProfileField<T>
  options?: readonly { value: T; label: string }[]
  /** 自定义值显示（无 options 时默认显示原始值） */
  display?: (v: T) => string
  onCommit: (v: T) => void
  onConfirm: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const valueLabel = field ? (options?.find((o) => o.value === field.value)?.label ?? (display ? display(field.value) : String(field.value))) : ''
  const startEdit = () => {
    setDraft(field ? String(field.value) : '')
    setEditing(true)
  }
  const commit = () => {
    const v = draft.trim()
    if (v && v !== String(field?.value ?? '')) onCommit(v as T)
    setEditing(false)
  }
  return (
    <div className="-mx-2 flex items-center gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-white/[0.03]">
      <span className="w-28 shrink-0 text-xs text-slate-500">{label}</span>
      <div className="min-w-0 flex-1">
        {editing ? (
          options ? (
            <select
              className="glass-input !w-40 !py-1 !text-xs"
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={commit}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commit()
                if (e.key === 'Escape') setEditing(false)
              }}
            >
              <option value="">请选择…</option>
              {options.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          ) : (
            <input
              className="glass-input !w-48 !py-1 !text-xs"
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={commit}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commit()
                if (e.key === 'Escape') setEditing(false)
              }}
            />
          )
        ) : field ? (
          <span className="flex flex-wrap items-center gap-2 text-sm text-slate-300">
            {valueLabel}
            <SourceChip field={field} />
          </span>
        ) : (
          <button className="inline-flex items-center gap-1 text-xs text-neon-cyan/70 transition-colors hover:text-neon-cyan" onClick={startEdit}>
            <Icon name="plus" size={11} /> 填写
          </button>
        )}
      </div>
      {!editing && (
        <span className="flex shrink-0 items-center gap-1.5">
          {field && !field.userConfirmed && field.source !== 'manual' ? (
            <button
              className="rounded-md border border-neon-green/25 px-1.5 py-0.5 text-2xs text-neon-green transition-all hover:border-neon-green/50 hover:bg-neon-green/10"
              title="确认该自动采集的值（置信度置为 1）"
              onClick={onConfirm}
            >
              确认
            </button>
          ) : null}
          {field ? (
            <button
              className="rounded-md border border-white/[0.08] px-1.5 py-0.5 text-2xs text-slate-400 transition-all hover:border-neon-cyan/40 hover:text-neon-cyan"
              onClick={startEdit}
            >
              编辑
            </button>
          ) : null}
        </span>
      )}
    </div>
  )
}

/** 层内容头部：层级 chip + AI 访问方式说明 */
function LayerBanner({ layerKey }: { layerKey: PersonaLayerKey }) {
  const meta = PERSONA_LAYERS.find((l) => l.key === layerKey)!
  const pm = PRIVACY_LEVEL_META[meta.level]
  return (
    <div className="mb-3 flex items-start gap-2.5 rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-2.5">
      <span
        className="mt-0.5 shrink-0 rounded-md border px-1.5 py-0.5 text-2xs font-medium"
        style={{ color: pm.color, borderColor: `${pm.color}44`, background: `${pm.color}14` }}
      >
        {meta.level} {pm.label}
      </span>
      <div className="min-w-0 text-xs leading-relaxed text-slate-500">
        <span className="text-slate-400">{meta.desc}。</span> AI 访问方式：{meta.aiUsage}
      </div>
    </div>
  )
}

// ───────────────────────── 注意力节律卡 ─────────────────────────

/** 热力矩阵列：8~22 点共 15 列 */
const RHYTHM_HOURS = Array.from({ length: 15 }, (_, i) => i + 8)
/** var(--teal) 的 RGB 通道（五档透明度直接派生，深浅模式通用） */
const TEAL_RGB = '15, 181, 164'

interface RhythmData {
  /** [工作日, 周末] 各小时平均工作分钟（index = 小时 - 8） */
  avg: [number[], number[]]
  /** 参与均值的 [工作日, 周末] 天数 */
  dayCount: [number, number]
  /** 最热 2 小时窗；weekend=true 表示周末均值更高 */
  peak: { startHour: number; weekend: boolean } | null
}

/** 近 14 天轨迹 → (是否周末, 小时) 工作分钟均值矩阵 + 峰值 2 小时窗（复用现有 getTrail，无新 IPC） */
function useAttentionRhythm(): RhythmData | null {
  const [data, setData] = useState<RhythmData | null>(null)
  useEffect(() => {
    let alive = true
    const dates: string[] = []
    for (let i = 0; i < 14; i++) {
      const d = new Date()
      d.setDate(d.getDate() - i)
      dates.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`)
    }
    void (async () => {
      const sums: [number[], number[]] = [Array<number>(15).fill(0), Array<number>(15).fill(0)]
      const dayCount: [number, number] = [0, 0]
      await Promise.all(
        dates.map(async (date) => {
          const d = new Date(`${date}T00:00:00`)
          const row = d.getDay() === 0 || d.getDay() === 6 ? 1 : 0
          dayCount[row]++
          let trail: MergedTrail | null = null
          try {
            trail = (await window.api.getTrail(date)) as MergedTrail | null
          } catch {
            /* 单日失败忽略 */
          }
          if (!trail?.segments?.length) return
          const dayStart = d.getTime()
          const dayEnd = dayStart + 86400000
          for (const seg of trail.segments) {
            if (seg.glance || !WORK_LIKE_STATES.includes(seg.mainState)) continue
            // 跨小时段按小时边界切分归属
            let t = Math.max(seg.startTs, dayStart)
            const end = Math.min(seg.endTs, dayEnd)
            while (t < end) {
              const cur = new Date(t)
              const hourEnd = new Date(cur.getFullYear(), cur.getMonth(), cur.getDate(), cur.getHours() + 1).getTime()
              const pieceEnd = Math.min(end, hourEnd)
              const idx = cur.getHours() - 8
              if (idx >= 0 && idx < 15) sums[row][idx] += (pieceEnd - t) / 60000
              t = pieceEnd
            }
          }
        })
      )
      if (!alive) return
      const avg: [number[], number[]] = [
        sums[0].map((v) => (dayCount[0] ? v / dayCount[0] : 0)),
        sums[1].map((v) => (dayCount[1] ? v / dayCount[1] : 0))
      ]
      // 最热 2 小时窗：两行合计最高；并判断哪一行更活跃
      let best = 0
      let peak: RhythmData['peak'] = null
      for (let i = 0; i < 14; i++) {
        const wd = avg[0][i] + avg[0][i + 1]
        const we = avg[1][i] + avg[1][i + 1]
        if (wd + we > best) {
          best = wd + we
          peak = { startHour: 8 + i, weekend: we > wd }
        }
      }
      setData({ avg, dayCount, peak })
    })()
    return () => {
      alive = false
    }
  }, [])
  return data
}

/** 注意力节律卡：工作日/周末 × 8~22 点热力矩阵（teal 五档）+ 峰值结论 + 图例 */
function RhythmSection() {
  const data = useAttentionRhythm()
  const max = data ? Math.max(1, ...data.avg[0], ...data.avg[1]) : 1
  /** 五档：0=底色 1~4=teal .25/.5/.75/1 */
  const tierOf = (v: number) => (v <= 0 ? 0 : Math.max(1, Math.min(4, Math.ceil((v / max) * 4))))
  const cellBg = (tier: number) => (tier === 0 ? 'var(--surface-3)' : `rgba(${TEAL_RGB}, ${tier * 0.25})`)
  const hh = (h: number) => String(h).padStart(2, '0')
  return (
    <section className="glass-card hoverable">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h3 className="text-base font-semibold text-slate-200">⏱ 注意力节律</h3>
        <span className="text-xs text-slate-500">近 14 天工作时段分布 · 越亮代表该小时平均投入越深</span>
        {/* 图例：少 → 多 */}
        <span className="ml-auto flex items-center gap-1 text-2xs text-slate-500">
          少
          {[0, 1, 2, 3, 4].map((t) => (
            <span key={t} className="h-3 w-3 rounded-[4px]" style={{ background: cellBg(t), border: '1px solid var(--line)' }} />
          ))}
          多
        </span>
      </div>
      {!data ? (
        <div className="flex h-16 items-center justify-center text-xs text-slate-500">
          <span className="pulse-dot mr-2 h-1.5 w-1.5 rounded-full" style={{ background: 'var(--teal)' }} /> 节律计算中…
        </div>
      ) : (
        <>
          <div className="flex flex-col gap-1.5">
            {(['工作日', '周末'] as const).map((rowLabel, row) => (
              <div key={rowLabel} className="flex items-center gap-2">
                <span className="w-11 shrink-0 text-right text-xs text-slate-500">{rowLabel}</span>
                <div className="grid min-w-0 flex-1 gap-1" style={{ gridTemplateColumns: 'repeat(15, minmax(0, 1fr))' }}>
                  {RHYTHM_HOURS.map((h, i) => {
                    const v = data.avg[row][i]
                    return (
                      <span
                        key={h}
                        title={`${rowLabel} ${hh(h)}:00 · 平均 ${fmtMin(Math.round(v))}`}
                        className="h-6 rounded-md transition-transform duration-150 hover:scale-110"
                        style={{ background: cellBg(tierOf(v)) }}
                      />
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
          {/* 小时刻度（偶数列标注） */}
          <div className="mt-1 flex items-center gap-2">
            <span className="w-11 shrink-0" />
            <div className="grid min-w-0 flex-1" style={{ gridTemplateColumns: 'repeat(15, minmax(0, 1fr))' }}>
              {RHYTHM_HOURS.map((h) => (
                <span key={h} className="text-center text-2xs tabular-nums text-slate-600">
                  {h % 2 === 0 ? h : ''}
                </span>
              ))}
            </div>
          </div>
          {/* 结论行 */}
          <div className="mt-2.5 rounded-lg border px-3 py-2 text-xs text-slate-300" style={{ borderColor: 'var(--line)', background: 'var(--surface-2)' }}>
            {data.peak ? (
              <>
                ⭐ 你的节律峰值{' '}
                <span className="font-semibold" style={{ color: 'var(--teal)' }}>
                  {hh(data.peak.startHour)}:00–{hh(data.peak.startHour + 2)}:00
                </span>
                <span className="text-slate-500"> · {data.peak.weekend ? '周末也相当活跃' : '工作日尤其稳定'}</span>
              </>
            ) : (
              <span className="text-slate-500">数据积累中 · 产生活动记录后即可解读你的节律峰值</span>
            )}
          </div>
        </>
      )}
    </section>
  )
}

// ───────────────────────── 主组件 ─────────────────────────

export default function ProfileView() {
  const settings = useSettingsStore((s) => s.settings)
  const patchSettings = useSettingsStore((s) => s.patch)
  const [persona, setPersona] = useState<UserPersona | null>(null)
  const [logs, setLogs] = useState<AccessLog[]>([])
  const [sel, setSel] = useState<NavKey>('basicInfo')
  const [nick, setNick] = useState('')
  const [hobbiesDraft, setHobbiesDraft] = useState<string | null>(null)
  const [city, setCity] = useState(settings.city ?? '')
  const [weather, setWeather] = useState<{ text: string; tempC: number; feelsC: number; humidity: number; windKph: number; maxC: number; minC: number } | null>(null)
  const [weatherErr, setWeatherErr] = useState<string | null>(null)
  const [exportNote, setExportNote] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [confirmClearLogs, setConfirmClearLogs] = useState(false)
  /** 左栏：按隐私级折叠的人物层组（收起在底部，点开再展开子项） */
  const [openNavLevel, setOpenNavLevel] = useState<PrivacyLevel | null>('L0')
  /** 隐私页：L0–L4 手风琴，默认收起细节，点行展开说明 */
  const [openPrivacyLevel, setOpenPrivacyLevel] = useState<PrivacyLevel | null>(null)

  const reload = useCallback(async () => {
    try {
      setPersona((await window.api.getPersona()) as UserPersona)
    } catch {
      /* 忽略：保持旧数据 */
    }
  }, [])
  const reloadLogs = useCallback(async () => {
    try {
      setLogs(((await window.api.listAccessLogs(30)) as AccessLog[]) ?? [])
    } catch {
      /* 忽略 */
    }
  }, [])

  useEffect(() => {
    void reload()
    void reloadLogs()
  }, [reload, reloadLogs])

  useEffect(() => {
    if (persona) setNick(persona.basicInfo.nickname)
  }, [persona])

  // 选中某人物层时，自动展开对应 L 组
  useEffect(() => {
    const meta = PERSONA_LAYERS.find((l) => l.key === sel)
    if (meta) setOpenNavLevel(meta.level)
  }, [sel])

  // ── 集中操作函数（每次变更后重新拉取画像） ──
  const handleUpdate = async (path: string, value: unknown) => {
    await window.api.updatePersonaField(path, value)
    await reload()
  }
  const handleConfirm = async (path: string) => {
    await window.api.confirmPersonaField(path)
    await reload()
  }
  const handleRemove = async (kind: 'interest' | 'skill', name: string) => {
    await window.api.removePersonaTag(kind, name)
    await reload()
  }
  const handlePrivacy = async (patch: { L0?: boolean; L1?: boolean; L2?: boolean; L3?: boolean }) => {
    await window.api.setPersonaPrivacy(patch)
    await reload()
  }

  /** 计分基准用的当前类型：手动选择优先，未选时用默认类型兜底显示 */
  const curType: UserType = settings.userType ?? 'office_worker'

  /** 手动选择用户类型：主进程落盘 + 本地 settingsStore 同步 */
  const chooseType = async (t: UserType) => {
    try {
      await window.api.setUserType(t)
    } catch {
      /* ignore */
    }
    void patchSettings({ userType: t })
  }

  const doRefresh = async () => {
    setRefreshing(true)
    try {
      setPersona((await window.api.refreshPersona()) as UserPersona)
    } finally {
      setRefreshing(false)
    }
  }

  // 城市变化时拉取天气预览（wttr.in，按城市名查询）
  useEffect(() => {
    const c = city.trim()
    if (!c) {
      setWeather(null)
      setWeatherErr(null)
      return
    }
    let alive = true
    setWeatherErr(null)
    window.api.getWeather(c).then((res) => {
      if (!alive) return
      if ('error' in res) {
        setWeather(null)
        setWeatherErr(res.error)
      } else {
        setWeather(res)
        setWeatherErr(null)
      }
    })
    return () => {
      alive = false
    }
  }, [city])

  const doExport = async () => {
    const path = (await window.api.exportPersona()) as string | null
    setExportNote(path ? `已导出：${path}` : '已取消导出')
    window.setTimeout(() => setExportNote(null), 8000)
  }

  const doClearLogs = async () => {
    await window.api.clearAccessLogs()
    await reloadLogs()
  }

  // 日志统计与分组
  const logGroups = useMemo(() => {
    const sorted = [...logs].sort((a, b) => b.ts - a.ts)
    const groups: { label: string; items: AccessLog[] }[] = []
    for (const log of sorted) {
      const label = dayGroupLabel(log.ts)
      const g = groups[groups.length - 1]
      if (g && g.label === label) g.items.push(log)
      else groups.push({ label, items: [log] })
    }
    return groups
  }, [logs])

  const logStats = useMemo(() => {
    if (logs.length === 0) return null
    const count: Partial<Record<PrivacyLevel, number>> = {}
    for (const l of logs) count[l.layer] = (count[l.layer] ?? 0) + 1
    const top = (Object.entries(count) as [PrivacyLevel, number][]).sort((a, b) => b[1] - a[1])[0]
    return { total: logs.length, topLayer: top?.[0] ?? 'L0' }
  }, [logs])

  /** 最近 5 条日志（按时间倒序，右侧面板用） */
  const recentLogs = useMemo(() => [...logs].sort((a, b) => b.ts - a.ts).slice(0, 5), [logs])

  if (!persona) {
    return (
      <div className="flex h-full items-center justify-center text-xs text-slate-500">
        <span className="pulse-dot mr-2 h-1.5 w-1.5 rounded-full bg-neon-cyan" /> 画像加载中…
      </div>
    )
  }

  const completeness = completenessOf(persona)
  const ut = USER_TYPE_META[persona.basicInfo.userType]
  const aiAccess = persona.privacySettings.aiAccess

  // ──────────────────────── 各层内容渲染 ────────────────────────

  const renderBasicInfo = () => (
    <>
      <LayerBanner layerKey="basicInfo" />
      <div className="flex flex-col divide-y divide-white/[0.05]">
        <div className="-mx-2 flex items-center gap-4 rounded-lg px-2 py-2 transition-colors hover:bg-white/[0.03]">
          <span className="w-28 shrink-0 text-xs text-slate-500">昵称</span>
          <input
            className="glass-input !w-48 !py-1 !text-xs"
            value={nick}
            maxLength={20}
            onChange={(e) => setNick(e.target.value)}
            onBlur={() => {
              const v = nick.trim()
              if (v && v !== persona.basicInfo.nickname) void handleUpdate('basicInfo.nickname', v)
              else setNick(persona.basicInfo.nickname)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
            }}
          />
        </div>
        <InfoRow label="用户类型">
          <span className="flex flex-wrap items-center gap-2">
            <span className="chip">{ut?.emoji} {ut?.label ?? persona.basicInfo.userType}</span>
            <button className="text-xs text-neon-cyan/70 transition-colors hover:text-neon-cyan" onClick={() => setSel('score')}>
              去「注意力与评分」修改 →
            </button>
          </span>
        </InfoRow>
        <InfoRow label="时区">{persona.basicInfo.timezone || '—'}</InfoRow>
        <InfoRow label="语言">{persona.basicInfo.language || '—'}</InfoRow>
        <InfoRow label="注册日期">{fmtDate(persona.basicInfo.registrationTs)}</InfoRow>
        <InfoRow label="使用天数">{persona.basicInfo.daysActive} 天</InfoRow>
      </div>
    </>
  )

  const renderIdentity = () => (
    <>
      <LayerBanner layerKey="identity" />
      <div className="flex flex-col divide-y divide-white/[0.05]">
        <FieldRow label="职业" field={persona.identity.occupation} onCommit={(v) => void handleUpdate('identity.occupation', v)} onConfirm={() => void handleConfirm('identity.occupation')} />
        <FieldRow label="行业" field={persona.identity.industry} onCommit={(v) => void handleUpdate('identity.industry', v)} onConfirm={() => void handleConfirm('identity.industry')} />
        <FieldRow
          label="经验等级"
          field={persona.identity.experienceLevel}
          options={[
            { value: 'junior', label: '初级' },
            { value: 'mid', label: '中级' },
            { value: 'senior', label: '资深' },
            { value: 'expert', label: '专家' }
          ]}
          onCommit={(v) => void handleUpdate('identity.experienceLevel', v)}
          onConfirm={() => void handleConfirm('identity.experienceLevel')}
        />
        <FieldRow
          label="工作模式"
          field={persona.identity.workMode}
          options={[
            { value: 'office', label: '坐班' },
            { value: 'remote', label: '远程' },
            { value: 'hybrid', label: '混合' }
          ]}
          onCommit={(v) => void handleUpdate('identity.workMode', v)}
          onConfirm={() => void handleConfirm('identity.workMode')}
        />
      </div>
    </>
  )

  const renderPreferences = () => {
    const hours = persona.preferences.preferredWorkHours
    const commitHours = (start: string, end: string) => void handleUpdate('preferences.preferredWorkHours', { start, end })
    return (
      <>
        <LayerBanner layerKey="preferences" />
        <div className="flex flex-col divide-y divide-white/[0.05]">
          <FieldRow
            label="工作风格"
            field={persona.preferences.workStyle}
            options={[
              { value: 'pomodoro', label: '番茄钟' },
              { value: 'flow', label: '心流' },
              { value: 'flexible', label: '弹性' },
              { value: 'structured', label: '结构化' }
            ]}
            onCommit={(v) => void handleUpdate('preferences.workStyle', v)}
            onConfirm={() => void handleConfirm('preferences.workStyle')}
          />
          <FieldRow
            label="沟通偏好"
            field={persona.preferences.communicationStyle}
            options={[
              { value: 'direct', label: '直接' },
              { value: 'encouraging', label: '鼓励' },
              { value: 'minimal', label: '简洁' }
            ]}
            onCommit={(v) => void handleUpdate('preferences.communicationStyle', v)}
            onConfirm={() => void handleConfirm('preferences.communicationStyle')}
          />
          <FieldRow
            label="干预容忍度"
            field={persona.preferences.interventionTolerance}
            options={[
              { value: 'high', label: '高' },
              { value: 'medium', label: '中' },
              { value: 'low', label: '低' }
            ]}
            onCommit={(v) => void handleUpdate('preferences.interventionTolerance', v)}
            onConfirm={() => void handleConfirm('preferences.interventionTolerance')}
          />
          <div className="-mx-2 flex items-center gap-4 rounded-lg px-2 py-2 transition-colors hover:bg-white/[0.03]">
            <span className="w-28 shrink-0 text-xs text-slate-500">偏好工作时段</span>
            <span className="flex items-center gap-2 text-xs text-slate-400">
              <input
                type="time"
                className="glass-input !w-28 !py-1 !text-xs"
                value={hours?.start ?? ''}
                onChange={(e) => commitHours(e.target.value, hours?.end ?? '')}
              />
              至
              <input
                type="time"
                className="glass-input !w-28 !py-1 !text-xs"
                value={hours?.end ?? ''}
                onChange={(e) => commitHours(hours?.start ?? '', e.target.value)}
              />
            </span>
          </div>
        </div>
      </>
    )
  }

  const renderBehavioral = () => {
    const b = persona.behavioral
    const maxMin = Math.max(1, ...b.appUsagePattern.primaryApps.map((a) => a.avgDailyMin))
    return (
      <>
        <LayerBanner layerKey="behavioral" />
        <div className="flex flex-col divide-y divide-white/[0.05]">
          <InfoRow label="高效时段">{b.dailyRhythm.peakHours.length > 0 ? b.dailyRhythm.peakHours.join('、') : '—'}</InfoRow>
          <InfoRow label="低精力时段">{b.dailyRhythm.lowEnergyHours.length > 0 ? b.dailyRhythm.lowEnergyHours.join('、') : '—'}</InfoRow>
          <InfoRow label="平均开工 / 收工">{b.dailyRhythm.averageStart || '—'} / {b.dailyRhythm.averageEnd || '—'}</InfoRow>
          <InfoRow label="周末模式">{WEEKEND_LABEL[b.dailyRhythm.weekendPattern] ?? b.dailyRhythm.weekendPattern}</InfoRow>
          <InfoRow label="应用切换频率">{b.appUsagePattern.appSwitchFrequency ? `${b.appUsagePattern.appSwitchFrequency} 次/小时` : '—'}</InfoRow>
          <div className="-mx-2 rounded-lg px-2 py-2 transition-colors hover:bg-white/[0.03]">
            <div className="mb-1.5 text-xs text-slate-500">主要应用（日均时长）</div>
            {b.appUsagePattern.primaryApps.length > 0 ? (
              <div className="flex flex-col gap-1.5">
                {b.appUsagePattern.primaryApps.map((a) => (
                  <div key={a.category} className="flex items-center gap-2 text-xs">
                    <span className="w-20 shrink-0 truncate text-slate-400">{a.category}</span>
                    <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/[0.06]">
                      <span
                        className="block h-full rounded-full bg-gradient-to-r from-neon-cyan/60 to-neon-cyan/30"
                        style={{ width: `${Math.round((a.avgDailyMin / maxMin) * 100)}%` }}
                      />
                    </span>
                    <span className="w-20 shrink-0 text-right tabular-nums text-slate-500">{fmtMin(Math.round(a.avgDailyMin))}/天</span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-xs text-slate-600">暂无数据</div>
            )}
          </div>
          <InfoRow label="最佳连续专注">{b.focusStreakHistory.bestStreak ? `${b.focusStreakHistory.bestStreak} 天` : '—'}</InfoRow>
          <InfoRow label="日均专注">{b.focusStreakHistory.avgDailyFocusMin ? fmtMin(Math.round(b.focusStreakHistory.avgDailyFocusMin)) : '—'}</InfoRow>
          <InfoRow label="专注趋势">{TREND_LABEL[b.focusStreakHistory.focusTrend] ?? b.focusStreakHistory.focusTrend}</InfoRow>
        </div>
        <p className="mt-3 text-xs text-slate-600">行为数据由系统自动采集，每日更新</p>
      </>
    )
  }

  const renderInterests = () => {
    const it = persona.interests
    return (
      <>
        <LayerBanner layerKey="interests" />
        <div className="mb-1.5 text-xs text-slate-500">检测到的兴趣（点击确认后不再被自动清理）</div>
        {it.detectedInterests.length > 0 ? (
          <div className="mb-4 flex flex-wrap gap-2">
            {it.detectedInterests.map((d) => (
              <span
                key={d.tag}
                className={`inline-flex items-center gap-1.5 rounded-lg border px-2 py-1 text-xs ${
                  d.userConfirmed ? 'border-neon-green/25 bg-neon-green/[0.06] text-slate-200' : 'border-white/[0.08] bg-white/[0.03] text-slate-300'
                }`}
              >
                {d.tag}
                <span className="text-2xs tabular-nums text-slate-500">{d.confidence.toFixed(2)}</span>
                {!d.userConfirmed ? (
                  <button
                    className="rounded border border-neon-green/25 px-1 py-px text-2xs text-neon-green transition-all hover:bg-neon-green/10"
                    title="确认该兴趣"
                    onClick={() => void handleConfirm(`interests.tag:${d.tag}`)}
                  >
                    确认
                  </button>
                ) : null}
                <button
                  className="text-slate-500 transition-colors hover:text-red-400"
                  title="删除该标签"
                  onClick={() => void handleRemove('interest', d.tag)}
                >
                  <Icon name="x" size={11} />
                </button>
              </span>
            ))}
          </div>
        ) : (
          <div className="mb-4 rounded-lg border border-dashed border-white/10 bg-white/[0.02] py-3 text-center text-xs text-slate-500">暂无检测到的兴趣</div>
        )}

        <div className="mb-1.5 text-xs text-slate-500">学习主题</div>
        {it.learningTopics.length > 0 ? (
          <div className="mb-4 flex flex-col divide-y divide-white/[0.05] rounded-xl border border-white/[0.06] px-3">
            {it.learningTopics.map((t) => (
              <div key={t.topic} className="flex items-center justify-between py-2 text-xs">
                <span className="text-slate-300">{t.topic}</span>
                <span className="chip !text-2xs">{PROGRESS_LABEL[t.progress] ?? t.progress}</span>
              </div>
            ))}
          </div>
        ) : (
          <div className="mb-4 rounded-lg border border-dashed border-white/10 bg-white/[0.02] py-3 text-center text-xs text-slate-500">暂无学习主题</div>
        )}

        <div className="mb-1.5 text-xs text-slate-500">非工作爱好（逗号分隔，可编辑）</div>
        <input
          className="glass-input !text-xs"
          placeholder="如：摄影, 跑步, 吉他"
          value={hobbiesDraft ?? it.hobbies.join(', ')}
          onFocus={() => setHobbiesDraft(it.hobbies.join(', '))}
          onChange={(e) => setHobbiesDraft(e.target.value)}
          onBlur={() => {
            const arr = (hobbiesDraft ?? '')
              .split(/[,，]/)
              .map((s) => s.trim())
              .filter(Boolean)
            void handleUpdate('interests.hobbies', arr)
            setHobbiesDraft(null)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
          }}
        />
      </>
    )
  }

  const renderCapabilities = () => {
    const cap = persona.capabilities
    return (
      <>
        <LayerBanner layerKey="capabilities" />
        <div className="mb-1.5 text-xs text-slate-500">技能标签</div>
        {cap.skillTags.length > 0 ? (
          <div className="mb-4 flex flex-col divide-y divide-white/[0.05] rounded-xl border border-white/[0.06] px-3">
            {cap.skillTags.map((s) => (
              <div key={s.name} className="flex items-center gap-3 py-2.5">
                <span className="w-28 shrink-0 truncate text-xs text-slate-300">{s.name}</span>
                <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/[0.06]">
                  <span
                    className="block h-full rounded-full bg-gradient-to-r from-neon-cyan/70 to-neon-violet/50"
                    style={{ width: `${Math.max(0, Math.min(100, Math.round(s.proficiency)))}%` }}
                  />
                </span>
                <span className="w-8 shrink-0 text-right text-xs tabular-nums text-slate-500">{Math.round(s.proficiency)}</span>
                <span
                  className={`shrink-0 text-xs ${s.trend === 'growing' ? 'text-neon-green' : s.trend === 'declining' ? 'text-red-400' : 'text-slate-500'}`}
                  title={s.trend === 'growing' ? '上升中' : s.trend === 'declining' ? '下降中' : '稳定'}
                >
                  {s.trend === 'growing' ? '↑' : s.trend === 'declining' ? '↓' : '→'}
                </span>
                <span className="flex shrink-0 items-center gap-1">
                  {!s.userConfirmed ? (
                    <button
                      className="rounded border border-neon-green/25 px-1 py-px text-2xs text-neon-green transition-all hover:bg-neon-green/10"
                      title="确认该技能"
                      onClick={() => void handleConfirm(`capabilities.skill:${s.name}`)}
                    >
                      确认
                    </button>
                  ) : null}
                  <button className="text-slate-500 transition-colors hover:text-red-400" title="删除该技能" onClick={() => void handleRemove('skill', s.name)}>
                    <Icon name="x" size={11} />
                  </button>
                </span>
              </div>
            ))}
          </div>
        ) : (
          <div className="mb-4 rounded-lg border border-dashed border-white/10 bg-white/[0.02] py-3 text-center text-xs text-slate-500">暂无技能标签</div>
        )}

        <div className="mb-1.5 text-xs text-slate-500">学习目标</div>
        {cap.learningGoals.length > 0 ? (
          <div className="flex flex-col divide-y divide-white/[0.05] rounded-xl border border-white/[0.06] px-3">
            {cap.learningGoals.map((g) => (
              <div key={g.goal} className="flex items-center gap-3 py-2.5 text-xs">
                <span className="min-w-0 flex-1 truncate text-slate-300">{g.goal}</span>
                <MeterBar value={g.currentProgress} color="#22D3EE" />
                <span className="shrink-0 text-2xs text-slate-500">目标 {fmtDate(g.targetTs)}</span>
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded-lg border border-dashed border-white/10 bg-white/[0.02] py-3 text-center text-xs text-slate-500">暂无学习目标</div>
        )}
      </>
    )
  }

  const renderPsychological = () => {
    const psy = persona.psychological
    return (
      <>
        <LayerBanner layerKey="psychological" />
        <div className="flex flex-col divide-y divide-white/[0.05]">
          <InfoRow label="压力耐受"><MeterBar value={psy.stressTolerance} color="var(--teal)" /></InfoRow>
          <InfoRow label="倦怠风险"><MeterBar value={psy.burnoutRisk} color="#F59E0B" /></InfoRow>
          <InfoRow label="心理韧性"><MeterBar value={psy.resilienceScore} color="#8B5CF6" /></InfoRow>
          <InfoRow label="动机类型">{MOTIVATION_LABEL[psy.motivationType] ?? psy.motivationType}</InfoRow>
          <InfoRow label="注意力风格">{ATTENTION_LABEL[psy.attentionStyle] ?? psy.attentionStyle}</InfoRow>
          <InfoRow label="精力周期">{ENERGY_LABEL[psy.energyCycle] ?? psy.energyCycle}</InfoRow>
        </div>
        <p className="mt-3 text-xs text-slate-600">
          分析置信度 {Math.round(psy.confidence * 100)}%{psy.lastAnalyzed ? ` · 最近分析 ${fmtDate(psy.lastAnalyzed)}` : ''}
        </p>
        <p className="mt-1.5 rounded-lg border border-neon-amber/15 bg-neon-amber/[0.04] px-3 py-2 text-xs leading-relaxed text-slate-500">
          AI 不会直接引用这些数值，仅用于调整交互策略
        </p>
      </>
    )
  }

  const renderRelationship = () => {
    const r = persona.relationship
    return (
      <>
        <LayerBanner layerKey="relationship" />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {(
            [
              ['💞', '亲密度', `Lv.${r.intimacyLevel}`],
              ['📅', '相伴天数', `${r.daysTogether} 天`],
              ['💬', '累计交互', `${r.totalInteractions}`],
              ['📈', '日均交互', `${r.interactionPattern.avgDailyInteractions}`]
            ] as const
          ).map(([emoji, label, value]) => (
            <div key={label} className="rounded-xl border border-white/[0.06] bg-white/[0.03] p-3 transition-all hover:border-neon-cyan/25 hover:bg-white/[0.05]">
              <div className="text-lg leading-none">{emoji}</div>
              <div className="mt-1.5 text-xs text-slate-500">{label}</div>
              <div className="mt-0.5 text-base font-semibold text-neon-cyan">{value}</div>
            </div>
          ))}
        </div>
        <div className="mt-3 flex flex-col divide-y divide-white/[0.05]">
          <InfoRow label="主导情绪">{r.emotionalHistory.dominantEmotions.length > 0 ? r.emotionalHistory.dominantEmotions.join('、') : '—'}</InfoRow>
          <InfoRow label="情绪稳定度"><MeterBar value={Math.round(r.emotionalHistory.emotionStability * 100)} color="#22D3EE" /></InfoRow>
          <InfoRow label="近期趋势">{EMOTION_TREND_LABEL[r.emotionalHistory.recentTrend] ?? r.emotionalHistory.recentTrend}</InfoRow>
        </div>
        <p className="mt-3 text-xs text-slate-600">关系数据由系统记录，不可编辑</p>
      </>
    )
  }

  /** 注意力与评分（v2.6：用户类型决定五维权重与默认目标；从设置页迁入） */
  const renderScore = () => (
    <>
      <div className="mb-3 text-xs leading-relaxed text-slate-500">
        用户类型决定五维权重与默认目标，是专注/效率评分的计分基准；也可交给自动识别。
      </div>
      <div className="flex flex-col divide-y divide-white/[0.05]">
        <SettingRow label="用户类型" desc={settings.userType ? USER_TYPE_META[settings.userType].desc : '选择你的角色，决定五维权重与计分基准；也可交给自动识别'}>
          <div className="flex flex-wrap items-center gap-1.5">
            {(Object.keys(USER_TYPE_META) as UserType[]).map((t) => {
              const m = USER_TYPE_META[t]
              const active = settings.userType === t
              return (
                <button
                  key={t}
                  title={m.desc}
                  className={`rounded-lg border px-2.5 py-1.5 text-xs transition-all ${
                    active ? 'border-white/30 bg-white/[0.08] text-slate-100' : 'border-white/[0.07] text-slate-400 hover:border-white/20'
                  }`}
                  onClick={() => void chooseType(t)}
                >
                  {m.emoji} {m.label}
                </button>
              )
            })}
            {settings.userTypeAuto && !settings.userType ? (
              <span className="rounded-full border border-neon-cyan/30 bg-neon-cyan/10 px-2 py-0.5 text-2xs text-neon-cyan">自动识别</span>
            ) : null}
          </div>
        </SettingRow>
        <SettingRow label="自动识别类型" desc="根据应用组合、作息与计划关键词自动判断用户类型">
          <Toggle checked={settings.userTypeAuto} onChange={(v) => void patchSettings({ userTypeAuto: v })} />
        </SettingRow>
        <SettingRow label="就业状态" desc="全职按类型默认目标；兼职/兼读自动下调目标基线">
          <div className="flex gap-1.5">
            {([['full', '全职'], ['part', '兼职'], ['student', '兼读']] as const).map(([v, l]) => (
              <button
                key={v}
                onClick={() => void patchSettings({ employmentMode: v })}
                className={`rounded-lg border px-2.5 py-1.5 text-xs transition-all ${
                  settings.employmentMode === v ? 'border-white/30 bg-white/[0.08] text-slate-100' : 'border-white/[0.07] text-slate-400 hover:border-white/20'
                }`}
              >
                {l}
              </button>
            ))}
          </div>
        </SettingRow>
        <SettingRow label="每日目标工作时长" desc="影响持续力与节奏感的计分基准">
          <NumberSetting
            value={Math.round((settings.targetWorkMin ?? USER_TYPE_META[curType].targetWorkMin) / 60)}
            min={1}
            max={12}
            suffix="小时"
            onCommit={(v) => void patchSettings({ targetWorkMin: v * 60 })}
          />
        </SettingRow>
        <SettingRow label="每日目标番茄钟" desc="节奏感维度的完成目标（25-45 分钟连续工作计 1 个）">
          <NumberSetting
            value={settings.targetPomodoros ?? USER_TYPE_META[curType].targetPomodoros}
            min={4}
            max={20}
            suffix="个"
            onCommit={(v) => void patchSettings({ targetPomodoros: v })}
          />
        </SettingRow>
        <SettingRow label="桌宠评分策略" desc="根据评分调整桌宠情感与提醒频率">
          <Toggle checked={settings.scorePetAdapt} onChange={(v) => void patchSettings({ scorePetAdapt: v })} />
        </SettingRow>
      </div>
    </>
  )

  const renderPrivacy = () => {
    const cards: { level: PrivacyLevel; includes: string; example: string; locked?: boolean }[] = [
      { level: 'L0', includes: '包含：昵称、用户类型、时区、使用天数等基础信息', example: '示例：「你是办公族用户，已使用 WorkOn 42 天」' },
      { level: 'L1', includes: '包含：职业、行业、经验等级、工作模式与偏好设定', example: '示例：「作为中级开发者，你偏好番茄钟工作法」（摘要引用）' },
      { level: 'L2', includes: '包含：行为模式、兴趣爱好、能力技能', example: '示例：「你的高效时段是上午 9-11 点」（聚合统计引用）' },
      { level: 'L3', includes: '包含：心理画像、关系数据', example: '示例：AI 据此调整语气与干预频率，不在回复中提及数值（策略内化）' },
      {
        level: 'L4',
        locked: true,
        includes: '包含：真实姓名、联系方式等核心身份信息 — WorkOn 不采集此类数据，AI 永久禁止访问。',
        example: '该层始终锁定，不可开启 AI 访问。'
      }
    ]
    return (
      <>
        {/* 画像完整度 + 重新分析（自设置页「用户画像」合并而来） */}
        <div className="mb-3 rounded-xl border border-white/[0.06] bg-white/[0.02] p-3.5">
          <div className="mb-1.5 flex items-center gap-2 text-xs text-slate-400">
            <span>画像完整度</span>
            <span className="font-semibold tabular-nums text-neon-cyan">{completeness}%</span>
            <span className="text-2xs text-slate-500">{completenessLabel(completeness)}</span>
            <button className="glass-btn ml-auto !px-2.5 !py-1 !text-xs" disabled={refreshing} onClick={() => void doRefresh()} title="基于最新行为数据重新分析画像">
              <Icon name="refresh" size={12} className={refreshing ? 'animate-spin' : ''} /> {refreshing ? '分析中…' : '重新分析画像'}
            </button>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/[0.06]">
            <div
              className="h-full rounded-full bg-gradient-to-r from-neon-cyan/70 to-neon-green/60 transition-all duration-500"
              style={{ width: `${completeness}%` }}
            />
          </div>
        </div>
        <div className="mb-3 text-xs leading-relaxed text-slate-500">
          逐层控制 AI 对你画像数据的访问。关闭后对应层数据不再进入 AI 上下文（历史访问记录见「AI 访问日志」）。点击下方层级可展开说明。
        </div>

        <div className="mb-4 border-t border-white/[0.06] pt-3">
          <div className="mb-2 text-xs text-slate-500">数据</div>
          <div className="flex flex-col gap-2">
            <button className="glass-btn w-full !py-2 font-medium" onClick={() => void doExport()}>
              <Icon name="send" size={13} /> 导出我的全部画像数据
            </button>
            {exportNote ? <div className="anim-fade-in break-all text-xs text-neon-green">{exportNote}</div> : null}
            <button className="glass-btn danger w-full !py-2 font-medium" onClick={() => setConfirmClearLogs(true)}>
              <Icon name="trash" size={13} /> 清除 AI 访问日志
            </button>
          </div>
        </div>

        {/* L0–L4：收起在页面底部，点行展开细节 */}
        <div className="mt-auto flex flex-col gap-1.5 border-t border-white/[0.06] pt-3">
          <div className="mb-1 text-xs text-slate-500">隐私层级 L0–L4 · 点击展开</div>
          {cards.map(({ level, includes, example, locked }) => {
            const pm = PRIVACY_LEVEL_META[level]
            const open = openPrivacyLevel === level
            return (
              <div
                key={level}
                className={`overflow-hidden rounded-xl border transition-colors ${
                  locked ? 'border-white/[0.05] bg-white/[0.01] opacity-70' : 'border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.04]'
                } ${open ? 'border-white/10 bg-white/[0.04]' : ''}`}
              >
                <div className="flex items-center gap-2 px-3 py-2.5">
                  <button
                    type="button"
                    className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
                    onClick={() => setOpenPrivacyLevel((cur) => (cur === level ? null : level))}
                    aria-expanded={open}
                  >
                    <Icon
                      name="chevronRight"
                      size={12}
                      className={`shrink-0 text-slate-500 transition-transform duration-300 ease-out ${open ? 'rotate-90 text-slate-300' : ''}`}
                    />
                    <span
                      className="shrink-0 rounded-md border px-1.5 py-0.5 text-2xs font-medium"
                      style={{ color: pm.color, borderColor: `${pm.color}44`, background: `${pm.color}14` }}
                    >
                      {level} {pm.label}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-xs text-slate-500">{pm.desc}</span>
                  </button>
                  {locked ? (
                    <span className="shrink-0 text-xs text-slate-500">🔒 已锁定</span>
                  ) : (
                    <span
                      className="shrink-0"
                      onClick={(e) => e.stopPropagation()}
                      onKeyDown={(e) => e.stopPropagation()}
                    >
                      <Toggle checked={aiAccess[level as 'L0' | 'L1' | 'L2' | 'L3']} onChange={(v) => void handlePrivacy({ [level]: v })} />
                    </span>
                  )}
                </div>
                <div className={`profile-accord ${open ? 'is-open' : ''}`}>
                  <div className="profile-accord-inner">
                    <div className="profile-accord-body border-t border-white/[0.05] px-3 pb-3 pt-2">
                      <div className="text-xs leading-relaxed text-slate-500">{includes}</div>
                      <div className="mt-1 text-xs leading-relaxed text-slate-600">{example}</div>
                      {level !== 'L4' ? (
                        <div className="mt-2 flex flex-wrap gap-1">
                          {PERSONA_LAYERS.filter((l) => l.level === level).map((l) => (
                            <button
                              key={l.key}
                              type="button"
                              className="rounded-md border border-white/[0.08] bg-white/[0.03] px-1.5 py-0.5 text-2xs text-slate-400 transition-colors hover:border-neon-cyan/40 hover:text-neon-cyan"
                              onClick={() => setSel(l.key)}
                            >
                              {l.emoji} {l.label}
                            </button>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </>
    )
  }

  const renderLogs = () => (
    <>
      <div className="mb-3 flex items-center justify-between">
        <div className="text-xs text-slate-500">
          {logStats ? (
            <>
              近 30 天共 <span className="font-medium text-neon-cyan">{logStats.total}</span> 次引用 · 最常引用{' '}
              <span className="font-medium" style={{ color: PRIVACY_LEVEL_META[logStats.topLayer].color }}>
                {logStats.topLayer}
              </span>
            </>
          ) : (
            '近 30 天暂无 AI 引用记录'
          )}
        </div>
        {logs.length > 0 ? (
          <button className="glass-btn !px-2.5 !py-1 !text-xs" onClick={() => setConfirmClearLogs(true)}>
            <Icon name="trash" size={12} /> 清除日志
          </button>
        ) : null}
      </div>
      {logGroups.length === 0 ? (
        <div className="rounded-lg border border-dashed border-white/10 bg-white/[0.02] py-6 text-center text-xs text-slate-500">
          当 AI 问答 / 桌宠 / 报表引用你的画像数据时，会在这里留下可追溯记录
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {logGroups.map((g) => (
            <div key={g.label}>
              <div className="mb-1.5 text-xs font-medium text-slate-500">{g.label}</div>
              <div className="flex flex-col divide-y divide-white/[0.05] rounded-xl border border-white/[0.06]">
                {g.items.map((log) => {
                  const pm = PRIVACY_LEVEL_META[log.layer] ?? PRIVACY_LEVEL_META.L0
                  return (
                    <div key={log.id} className="flex items-center gap-2 px-3 py-2 text-xs transition-colors hover:bg-white/[0.03]">
                      <span className="shrink-0 tabular-nums text-slate-500">{fmtTime(log.ts)}</span>
                      <span
                        className="shrink-0 rounded border px-1 py-px text-2xs"
                        style={{ color: pm.color, borderColor: `${pm.color}44`, background: `${pm.color}14` }}
                      >
                        {log.layer}
                      </span>
                      <span className="shrink-0 text-slate-400">{LEVEL_LAYER_LABEL[log.layer] ?? log.layer}</span>
                      <span className="shrink-0 text-slate-600">→</span>
                      <span className="shrink-0 text-slate-300">{REQUESTER_LABEL[log.requester] ?? log.requester}</span>
                      <span className="chip shrink-0 !px-1.5 !py-px !text-2xs">{RULE_LABEL[log.ruleApplied] ?? log.ruleApplied}</span>
                      <span className="min-w-0 flex-1 truncate text-slate-500" title={log.output}>
                        {log.output.length > 40 ? `${log.output.slice(0, 40)}…` : log.output}
                      </span>
                    </div>
                  )
                })}
      </div>
    </div>
          ))}
        </div>
      )}
    </>
  )

  const layerRenderers: Record<PersonaLayerKey, () => JSX.Element> = {
    basicInfo: renderBasicInfo,
    identity: renderIdentity,
    preferences: renderPreferences,
    behavioral: renderBehavioral,
    interests: renderInterests,
    capabilities: renderCapabilities,
    psychological: renderPsychological,
    relationship: renderRelationship
  }

  const selMeta = PERSONA_LAYERS.find((l) => l.key === sel)

  return (
    <div className="view-enter flex min-h-full flex-col gap-4 overflow-y-auto">
      {/* 顶部摘要卡 */}
      <header className="glass-card hoverable anim-fade-up shrink-0">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-neon-cyan/25 bg-neon-cyan/10 text-xl shadow-glow">
              {ut?.emoji ?? '🪪'}
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h1 className="truncate text-lg font-semibold text-slate-100">{persona.basicInfo.nickname || '未设置昵称'}</h1>
                <span className="chip shrink-0 !text-2xs">{ut?.emoji} {ut?.label ?? ''}</span>
              </div>
              <p className="mt-0.5 text-xs text-slate-500">
                已使用 {persona.relationship.daysTogether} 天 · 亲密度 Lv.{persona.relationship.intimacyLevel}
              </p>
            </div>
          </div>
          <div className="min-w-[220px] flex-1">
            <div className="mb-1 flex items-center justify-between text-xs text-slate-500">
              <span>画像完整度</span>
              <span>
                <span className="font-semibold tabular-nums text-neon-cyan">{completeness}%</span> · {completenessLabel(completeness)}
              </span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-white/[0.06]">
              <div
                className="h-full rounded-full bg-gradient-to-r from-neon-cyan/70 to-neon-green/60 transition-all duration-500"
                style={{ width: `${completeness}%`, boxShadow: '0 0 8px rgba(34,211,238,0.4)' }}
              />
            </div>
          </div>
          <button className="glass-btn shrink-0 !px-2.5 !py-1.5 !text-xs" disabled={refreshing} onClick={() => void doRefresh()} title="重新采集并计算画像">
            <Icon name="refresh" size={12} /> {refreshing ? '刷新中…' : '刷新画像'}
          </button>
        </div>
      </header>

      {/* 三栏主体 */}
      <div className="flex min-h-0 flex-1 gap-4">
        {/* 左导航：人物 L0–L3 可折叠；评分/隐私/日志仍在最下 */}
        <aside className="glass-card anim-fade-up flex w-44 shrink-0 flex-col overflow-y-auto !p-2" style={{ animationDelay: '60ms' }}>
          <div className="mb-1 px-2 text-2xs uppercase tracking-wide text-slate-600">人物层级</div>

          {(['L0', 'L1', 'L2', 'L3'] as const).map((lv) => {
            const pm = PRIVACY_LEVEL_META[lv]
            const layers = PERSONA_LAYERS.filter((l) => l.level === lv)
            const open = openNavLevel === lv
            const groupActive = layers.some((l) => l.key === sel)
            return (
              <div key={lv} className="mb-0.5">
                <button
                  type="button"
                  className={`flex w-full items-center gap-1.5 rounded-lg px-2 py-1.5 text-left text-xs transition-colors ${
                    groupActive || open ? 'bg-white/[0.04] text-slate-200' : 'text-slate-500 hover:bg-white/[0.03] hover:text-slate-300'
                  }`}
                  onClick={() => setOpenNavLevel((cur) => (cur === lv ? null : lv))}
                  aria-expanded={open}
                >
                  <Icon
                    name="chevronRight"
                    size={11}
                    className={`shrink-0 transition-transform duration-300 ease-out ${open ? 'rotate-90' : ''}`}
                  />
                  <span className="rounded border px-1 py-px text-2xs" style={{ color: pm.color, borderColor: `${pm.color}44` }}>
                    {lv}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{pm.label}</span>
                  <span className="tabular-nums text-2xs text-slate-600">{layers.length}</span>
                </button>
                <div className={`profile-accord ${open ? 'is-open' : ''}`}>
                  <div className="profile-accord-inner">
                    <div className="profile-accord-body flex flex-col gap-0.5 pb-1 pl-1 pt-0.5">
                      {layers.map((l) => {
                        const active = sel === l.key
                        return (
                          <button
                            key={l.key}
                            className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs transition-all duration-150 ${
                              active ? 'bg-neon-cyan/15 text-neon-cyan shadow-glow' : 'text-slate-400 hover:bg-white/5 hover:text-slate-200'
                            }`}
                            onClick={() => setSel(l.key)}
                          >
                            <span className="text-sm leading-none">{l.emoji}</span>
                            <span className="min-w-0 flex-1 truncate">{l.label}</span>
                          </button>
                        )
                      })}
                    </div>
                  </div>
                </div>
              </div>
            )
          })}

          <div className="my-2 mt-auto border-t border-white/[0.06]" />
          {(
            [
              ['score', '注意力与评分', 'zap'],
              ['privacy', '隐私控制', 'shield'],
              ['logs', 'AI 访问日志', 'activity']
            ] as const
          ).map(([key, label, icon]) => {
            const active = sel === key
            return (
              <button
                key={key}
                className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs transition-all duration-150 ${
                  active ? 'bg-neon-cyan/15 text-neon-cyan shadow-glow' : 'text-slate-400 hover:bg-white/5 hover:text-slate-200'
                }`}
                onClick={() => setSel(key)}
              >
                <Icon name={icon} size={13} />
                <span className="min-w-0 flex-1 truncate">{label}</span>
              </button>
            )
          })}
        </aside>

        {/* 中间内容区 */}
        <main
          className={`glass-card anim-fade-up min-w-0 flex-1 overflow-y-auto ${sel === 'privacy' ? 'flex flex-col' : ''}`}
          style={{ animationDelay: '120ms' }}
          key={sel}
        >
          <h2 className="mb-3 flex items-center gap-2 text-base font-semibold text-slate-200">
            {selMeta ? (
              <>
                <span>{selMeta.emoji}</span> {selMeta.label}
              </>
            ) : sel === 'score' ? (
              <>
                <Icon name="zap" size={14} className="text-neon-cyan" /> 注意力与评分
              </>
            ) : sel === 'privacy' ? (
              <>
                <Icon name="shield" size={14} className="text-neon-cyan" /> 隐私控制
              </>
            ) : (
              <>
                <Icon name="activity" size={14} className="text-neon-cyan" /> AI 访问日志
              </>
            )}
          </h2>
          {selMeta ? layerRenderers[selMeta.key]() : sel === 'score' ? renderScore() : sel === 'privacy' ? (
            <div className="flex min-h-0 flex-1 flex-col">{renderPrivacy()}</div>
          ) : (
            renderLogs()
          )}
        </main>

        {/* 右侧 AI 访问概览：L0–L3 可点开看覆盖层 */}
        <aside className="glass-card anim-fade-up hidden w-[240px] shrink-0 overflow-y-auto lg:block" style={{ animationDelay: '180ms' }}>
          <h3 className="mb-2.5 flex items-center gap-2 text-sm font-semibold text-slate-200">
            <Icon name="eye" size={13} className="text-neon-cyan" /> AI 访问概览
          </h3>
          <div className="mb-3 flex flex-col gap-1.5">
            {(['L0', 'L1', 'L2', 'L3'] as const).map((lv) => {
              const pm = PRIVACY_LEVEL_META[lv]
              const on = aiAccess[lv]
              const open = openPrivacyLevel === lv
              const layers = PERSONA_LAYERS.filter((l) => l.level === lv)
              return (
                <div
                  key={lv}
                  className={`overflow-hidden rounded-lg border transition-colors ${
                    open ? 'border-white/10 bg-white/[0.04]' : 'border-white/[0.05] bg-white/[0.02]'
                  }`}
                >
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-xs"
                    onClick={() => setOpenPrivacyLevel((cur) => (cur === lv ? null : lv))}
                    aria-expanded={open}
                  >
                    <Icon
                      name="chevronRight"
                      size={10}
                      className={`shrink-0 text-slate-500 transition-transform duration-300 ease-out ${open ? 'rotate-90' : ''}`}
                    />
                    <span className="rounded border px-1 py-px text-2xs" style={{ color: pm.color, borderColor: `${pm.color}44` }}>
                      {lv}
                    </span>
                    <span className="min-w-0 flex-1 text-slate-400">{pm.label}</span>
                    <span className={`inline-flex items-center gap-1 ${on ? 'text-neon-green' : 'text-slate-600'}`}>
                      <span className={`h-1.5 w-1.5 rounded-full ${on ? 'bg-neon-green' : 'bg-slate-600'}`} />
                      {on ? '允许' : '关闭'}
                    </span>
                  </button>
                  <div className={`profile-accord ${open ? 'is-open' : ''}`}>
                    <div className="profile-accord-inner">
                      <div className="profile-accord-body space-y-1 border-t border-white/[0.05] px-2.5 pb-2 pt-1.5">
                        <div className="text-2xs leading-relaxed text-slate-500">{pm.desc}</div>
                        <div className="flex flex-wrap gap-1">
                          {layers.map((l) => (
                            <button
                              key={l.key}
                              type="button"
                              className="rounded border border-white/[0.08] px-1.5 py-0.5 text-2xs text-slate-400 transition-colors hover:border-neon-cyan/40 hover:text-neon-cyan"
                              onClick={() => setSel(l.key)}
                            >
                              {l.emoji} {l.label}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
          <div className="border-t border-white/[0.06] pt-2.5">
            <div className="mb-1.5 text-xs text-slate-500">最近 AI 引用</div>
            {recentLogs.length > 0 ? (
              <div className="flex flex-col gap-1.5">
                {recentLogs.map((log) => {
                  const pm = PRIVACY_LEVEL_META[log.layer] ?? PRIVACY_LEVEL_META.L0
                  return (
                    <div key={log.id} className="rounded-lg border border-white/[0.04] bg-white/[0.02] px-2 py-1.5 text-2xs">
                      <div className="flex items-center gap-1.5">
                        <span className="tabular-nums text-slate-500">{fmtTime(log.ts)}</span>
                        <span className="rounded border px-1 py-px text-2xs" style={{ color: pm.color, borderColor: `${pm.color}44` }}>
                          {log.layer}
                        </span>
                        <span className="min-w-0 flex-1 truncate text-slate-400">{REQUESTER_LABEL[log.requester] ?? log.requester}</span>
                      </div>
                      <div className="mt-0.5 truncate text-slate-600" title={log.output}>
                        {log.output}
                      </div>
                    </div>
                  )
                })}
              </div>
            ) : (
              <div className="text-2xs text-slate-600">暂无引用记录</div>
            )}
          </div>
        </aside>
      </div>

      {/* 注意力节律（近 14 天 工作日/周末 × 8~22 点热力矩阵） */}
      <RhythmSection />

      <section className="glass-card hoverable">
        <h3 className="mb-3 text-base font-semibold text-slate-200">📍 我的位置</h3>
        <SettingRow label="城市" desc="用于下班天气提醒、周末出行建议">
          <input
            className="glass-input !w-36 !py-1 !text-xs"
            placeholder="例：北京"
            value={city}
            onChange={(e) => setCity(e.target.value)}
            onBlur={() => {
              const v = city.trim()
              void patchSettings({ city: v })
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
            }}
          />
        </SettingRow>
        {weather && (
          <div className="mt-2 flex items-center gap-3 rounded-lg border border-white/[0.05] bg-white/[0.02] px-3 py-2 text-xs">
            <span className="text-xl leading-none">{weather.text}</span>
            <div className="flex flex-col">
              <span className="text-lg font-semibold text-slate-100">{weather.tempC}°C</span>
              <span className="text-2xs text-slate-500">体感 {weather.feelsC}°C · {weather.minC}~{weather.maxC}°C</span>
            </div>
            <div className="ml-auto flex flex-col items-end gap-0.5 text-2xs text-slate-500">
              <span>湿度 {weather.humidity}%</span>
              <span>风速 {weather.windKph} km/h</span>
            </div>
          </div>
        )}
        {weatherErr && (
          <div className="mt-2 rounded-lg border border-red-500/20 bg-red-500/[0.06] px-3 py-1.5 text-xs text-red-400">
            {weatherErr}
          </div>
        )}
      </section>

      {/* 页面最底部：L0–L4 收起条，点选向上展开说明与开关 */}
      <section className="glass-card shrink-0 !p-2.5">
        <div className="mb-1.5 flex items-center justify-between px-0.5">
          <span className="text-xs text-slate-500">人物隐私层级 L0–L4</span>
          <button
            type="button"
            className="text-2xs text-slate-500 transition-colors hover:text-neon-cyan"
            onClick={() => {
              setSel('privacy')
              setOpenPrivacyLevel(null)
            }}
          >
            隐私控制
          </button>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {(['L0', 'L1', 'L2', 'L3', 'L4'] as const).map((lv) => {
            const pm = PRIVACY_LEVEL_META[lv]
            const open = openPrivacyLevel === lv
            const locked = lv === 'L4'
            const on = locked ? false : aiAccess[lv]
            return (
              <button
                key={lv}
                type="button"
                className={`inline-flex items-center gap-1.5 rounded-lg border px-2 py-1.5 text-xs transition-all duration-200 ${
                  open
                    ? 'border-white/20 bg-white/[0.08] text-slate-100'
                    : 'border-white/[0.06] bg-white/[0.02] text-slate-400 hover:border-white/15 hover:text-slate-200'
                }`}
                style={open ? { boxShadow: `0 0 0 1px ${pm.color}33` } : undefined}
                onClick={() => setOpenPrivacyLevel((cur) => (cur === lv ? null : lv))}
                aria-expanded={open}
              >
                <span className="rounded border px-1 py-px text-2xs" style={{ color: pm.color, borderColor: `${pm.color}55` }}>
                  {lv}
                </span>
                <span>{pm.label}</span>
                {locked ? (
                  <span className="text-2xs text-slate-600">锁</span>
                ) : (
                  <span className={`h-1.5 w-1.5 rounded-full ${on ? 'bg-neon-green' : 'bg-slate-600'}`} />
                )}
              </button>
            )
          })}
        </div>
        <div className={`profile-accord mt-0 ${openPrivacyLevel ? 'is-open' : ''}`}>
          <div className="profile-accord-inner">
            <div className="profile-accord-body">
              {openPrivacyLevel ? (() => {
                const lv = openPrivacyLevel
                const pm = PRIVACY_LEVEL_META[lv]
                const locked = lv === 'L4'
                const layers = PERSONA_LAYERS.filter((l) => l.level === lv)
                return (
                  <div className="mt-2 rounded-xl border border-white/[0.08] bg-white/[0.03] px-3 py-2.5">
                    <div className="flex items-start gap-2.5">
                      <span
                        className="mt-0.5 shrink-0 rounded-md border px-1.5 py-0.5 text-2xs font-medium"
                        style={{ color: pm.color, borderColor: `${pm.color}44`, background: `${pm.color}14` }}
                      >
                        {lv} {pm.label}
                      </span>
                      <div className="min-w-0 flex-1 text-xs leading-relaxed text-slate-500">{pm.desc}</div>
                      {locked ? (
                        <span className="shrink-0 text-xs text-slate-500">🔒 已锁定</span>
                      ) : (
                        <Toggle checked={aiAccess[lv]} onChange={(v) => void handlePrivacy({ [lv]: v })} />
                      )}
                    </div>
                    {layers.length > 0 ? (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {layers.map((l) => (
                          <button
                            key={l.key}
                            type="button"
                            className="rounded-md border border-white/[0.08] bg-black/20 px-2 py-1 text-xs text-slate-300 transition-colors hover:border-neon-cyan/40 hover:text-neon-cyan"
                            onClick={() => setSel(l.key)}
                          >
                            {l.emoji} {l.label}
                          </button>
                        ))}
                      </div>
                    ) : (
                      <div className="mt-2 text-xs text-slate-600">核心身份信息不采集，AI 永久禁止访问。</div>
                    )}
                  </div>
                )
              })() : (
                <div className="h-0" />
              )}
            </div>
          </div>
        </div>
      </section>

      {/* 清除 AI 访问日志确认弹窗 */}
      <ConfirmDialog
        open={confirmClearLogs}
        title="清除全部 AI 访问日志？"
        message="清除后不可追溯。"
        confirmLabel="清除"
        danger
        onConfirm={() => { setConfirmClearLogs(false); void doClearLogs() }}
        onCancel={() => setConfirmClearLogs(false)}
      />
    </div>
  )
}
