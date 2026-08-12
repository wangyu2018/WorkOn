import { useCallback, useEffect, useState } from 'react'
import type {
  GeneratedEntry,
  GeneratedReport,
  GeneratedSection,
  ReportEntry,
  ReportTemplate,
  SectionType,
  TemplateSection,
  WeeklyGeneratedReport
} from '@shared/types'
import { WORK_STATES } from '@shared/stateMeta'
import { displayApp } from '@shared/appDisplayName'
import { Icon } from '../components/Icon'
import type { IconName } from '../components/Icon'
import { useSettingsStore } from '../stores/settingsStore'
import { WEEK_LABELS, addDays, clockOf, fmtDateLabel, fmtMin, todayKey } from '../components/utils'

/* ── 常量与小工具 ── */

const SECTION_TYPE_LABELS: Record<SectionType, string> = {
  time_block: '时间段',
  category_group: '分类分组',
  project_summary: '项目汇总',
  achievement: '成果亮点',
  plan_tomorrow: '明日计划',
  metric_summary: '指标概览',
  free_text: '自由文本',
  meeting_log: '会议记录',
  issue_note: '问题备注'
}

const SECTION_TYPE_ICONS: Record<SectionType, IconName> = {
  time_block: 'clock',
  category_group: 'chart',
  project_summary: 'target',
  achievement: 'flame',
  plan_tomorrow: 'calendar',
  metric_summary: 'activity',
  free_text: 'edit',
  meeting_log: 'message',
  issue_note: 'alert'
}

const ACH_META = {
  completed: { mark: '✓', cls: 'text-neon-green', label: '已完成' },
  partial: { mark: '◐', cls: 'text-amber-400', label: '部分完成' },
  missed: { mark: '✗', cls: 'text-neon-red', label: '未完成' },
  overtime: { mark: '⏰', cls: 'text-neon-blue', label: '超时完成' }
} as const

const hhmm = (ts: number): string => {
  const d = new Date(ts)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

const weekLabel = (date: string): string => {
  const d = new Date(`${date}T00:00:00`)
  return `周${WEEK_LABELS[(d.getDay() + 6) % 7]}`
}

/** 生成段 → 模板段（type/fields 渲染依据） */
function metaOf(template: ReportTemplate | undefined, gs: GeneratedSection): TemplateSection | undefined {
  return template?.sections.find((s) => s.id === gs.sectionId)
}

/** 分区标题（与 ReportHub 同风格） */
function SectionTitle({ icon, title, hint }: { icon: IconName; title: string; hint?: string }) {
  return (
    <h3 className="mb-3 flex items-center gap-2 text-[13px] font-semibold text-slate-200">
      <span className="flex h-5 w-5 items-center justify-center rounded-md bg-neon-cyan/15 text-neon-cyan">
        <Icon name={icon} size={12} />
      </span>
      {title}
      {hint ? <span className="ml-auto text-[10px] font-normal text-slate-500">{hint}</span> : null}
    </h3>
  )
}

/** 差值小字：正绿 ↑ / 负红 ↓ / 零灰；invert 用于「越少越好」的指标（摸鱼） */
function Delta({ v, invert, fmt }: { v: number; invert?: boolean; fmt?: (abs: number) => string }) {
  const good = invert ? v < 0 : v > 0
  const bad = invert ? v > 0 : v < 0
  const cls = good ? 'text-neon-green' : bad ? 'text-neon-red' : 'text-slate-500'
  const text = fmt ? fmt(Math.abs(v)) : String(Math.abs(v))
  return (
    <span className={`text-[10px] font-medium ${cls}`}>
      {v > 0 ? '↑+' : v < 0 ? '↓-' : ''}
      {v === 0 ? '—' : text}
    </span>
  )
}

/* ── 导出（v2.9 §4.1：标题行 → 概览 → 各 section → 计划达成 → 模式洞察 → 覆盖率行） ── */

function entryTextLines(ge: GeneratedEntry, meta: TemplateSection | undefined): string[] {
  const e = ge.reportEntry
  const lines = [`${hhmm(e.startTs)}-${hhmm(e.endTs)} (${fmtMin(e.durationMin)}) | ${e.stateLabel}`]
  for (const f of meta?.fields ?? []) {
    if (f.key === 'time' || f.key === 'stateLabel' || f.key === 'duration') continue
    const v = ge.fieldValues[f.key]?.value
    if (v) lines.push(`  ${f.label}: ${v}`)
  }
  return lines
}

function renderText(report: GeneratedReport, template: ReportTemplate | undefined): string {
  const out: string[] = [`📊 WorkOn 日报 · ${report.date} ${weekLabel(report.date)}`, '']
  for (const gs of report.sections) {
    const meta = metaOf(template, gs)
    const type = meta?.type ?? 'time_block'
    if (type === 'metric_summary') {
      const fv = gs.entries[0]?.fieldValues ?? {}
      const parts = (meta?.fields ?? [])
        .map((f) => (fv[f.key]?.value ? `${f.label}: ${fv[f.key].value}` : null))
        .filter((x): x is string => x !== null)
      if (parts.length) out.push(`【${gs.title || '今日概览'}】`, parts.join(' · '), '')
      continue
    }
    if (type === 'free_text') continue // 自由备注区导出时保留占位
    out.push(`【${gs.title || SECTION_TYPE_LABELS[type]}】`)
    if (type === 'plan_tomorrow') {
      for (const ge of gs.entries) out.push(`- ${ge.reportEntry.contentTag ?? ge.reportEntry.stateLabel}`)
    } else {
      for (const ge of gs.entries) out.push(...entryTextLines(ge, meta))
    }
    if (gs.entries.length === 0) out.push('（无）')
    out.push('')
  }
  if (report.achievements.length > 0) {
    out.push('【计划达成】')
    for (const a of report.achievements) {
      out.push(`${ACH_META[a.status].mark} ${a.title} ${fmtMin(a.actualMin)}/${fmtMin(a.plannedMin)} (${Math.round(a.achievementRate * 100)}%)`)
    }
    out.push('')
  }
  if (report.patterns) {
    const p = report.patterns
    out.push('【模式洞察】')
    if (p.patternTags.length) out.push(`标签: ${p.patternTags.join(' / ')}`)
    if (p.peakHours[0]) out.push(`最佳时段: ${p.peakHours[0].slot}`)
    out.push(`碎片化评分: ${p.fragmentationScore}/100`, `作息: ${clockOf(p.workStartAvg)} - ${clockOf(p.workEndAvg)}`, '')
  }
  const need = report.entries.filter((e) => e.needsReview).length
  out.push(`数据覆盖率 ${Math.round(report.coverage * 100)}% · 高置信 ${report.entries.length - need} · 需确认 ${need}`)
  return out.join('\n').replace(/\n{3,}/g, '\n\n')
}

function renderMarkdown(report: GeneratedReport, template: ReportTemplate | undefined): string {
  const out: string[] = [`# WorkOn 日报 · ${report.date} ${weekLabel(report.date)}`, '']
  for (const gs of report.sections) {
    const meta = metaOf(template, gs)
    const type = meta?.type ?? 'time_block'
    if (type === 'metric_summary') {
      const fv = gs.entries[0]?.fieldValues ?? {}
      const parts = (meta?.fields ?? [])
        .map((f) => (fv[f.key]?.value ? `**${f.label}**: ${fv[f.key].value}` : null))
        .filter((x): x is string => x !== null)
      if (parts.length) out.push(`## ${gs.title || '今日概览'}`, '', parts.join(' · '), '')
      continue
    }
    if (type === 'free_text') continue
    out.push(`## ${gs.title || SECTION_TYPE_LABELS[type]}`, '')
    if (type === 'plan_tomorrow') {
      for (const ge of gs.entries) out.push(`- ${ge.reportEntry.contentTag ?? ge.reportEntry.stateLabel}`)
    } else {
      for (const ge of gs.entries) {
        const lines = entryTextLines(ge, meta)
        out.push(`- ${lines[0]}`)
        for (const l of lines.slice(1)) out.push(`  - ${l.trim()}`)
      }
    }
    if (gs.entries.length === 0) out.push('- （无）')
    out.push('')
  }
  if (report.achievements.length > 0) {
    out.push('## 计划达成', '')
    for (const a of report.achievements) {
      out.push(`- ${ACH_META[a.status].mark} ${a.title} ${fmtMin(a.actualMin)}/${fmtMin(a.plannedMin)} (${Math.round(a.achievementRate * 100)}%)`)
    }
    out.push('')
  }
  if (report.patterns) {
    const p = report.patterns
    out.push('## 模式洞察', '')
    if (p.patternTags.length) out.push(`- 标签: ${p.patternTags.join(' / ')}`)
    if (p.peakHours[0]) out.push(`- 最佳时段: ${p.peakHours[0].slot}`)
    out.push(`- 碎片化评分: ${p.fragmentationScore}/100`, `- 作息: ${clockOf(p.workStartAvg)} - ${clockOf(p.workEndAvg)}`, '')
  }
  const need = report.entries.filter((e) => e.needsReview).length
  out.push(`> 数据覆盖率 ${Math.round(report.coverage * 100)}% · 高置信 ${report.entries.length - need} · 需确认 ${need}`)
  return out.join('\n').replace(/\n{3,}/g, '\n\n')
}

/* ── 条目本地更新（确认/编辑后立即反映在视图，无需重新生成） ── */

function patchReportEntry(report: GeneratedReport, entryId: string, patch: Partial<ReportEntry>): GeneratedReport {
  const apply = (e: ReportEntry): ReportEntry => (e.id === entryId ? { ...e, ...patch } : e)
  const EDITABLE = ['subject', 'contentTag', 'project', 'output'] as const
  return {
    ...report,
    entries: report.entries.map(apply),
    pendingReview: report.pendingReview.filter((e) => e.id !== entryId || (patch.needsReview ?? false)).map(apply),
    sections: report.sections.map((s) => ({
      ...s,
      entries: s.entries.map((ge) => {
        if (ge.reportEntry.id !== entryId) return ge
        const re = apply(ge.reportEntry)
        const fv = { ...ge.fieldValues }
        for (const k of EDITABLE) {
          if (patch[k] !== undefined && fv[k]) fv[k] = { ...fv[k], value: String(patch[k] ?? ''), confidence: 1 }
        }
        return { ...ge, reportEntry: re, fieldValues: fv, needsReview: re.needsReview }
      })
    }))
  }
}

/* ── 条目卡片 ── */

interface EntryCardProps {
  ge: GeneratedEntry
  meta: TemplateSection | undefined
  editing: { id: string; subject: string; contentTag: string; project: string; output: string } | null
  onStartEdit: (ge: GeneratedEntry) => void
  onCancelEdit: () => void
  onEditChange: (key: 'subject' | 'contentTag' | 'project' | 'output', value: string) => void
  onConfirm: (entryId: string) => void
  onSaveEdit: () => void
}

function EntryCard({ ge, meta, editing, onStartEdit, onCancelEdit, onEditChange, onConfirm, onSaveEdit }: EntryCardProps) {
  const e = ge.reportEntry
  const color = WORK_STATES[e.state]?.color ?? '#94A3B8'
  const isEditing = editing?.id === e.id
  const displayFields = (meta?.fields ?? []).filter((f) => f.key !== 'time' && f.key !== 'stateLabel')
  return (
    <div
      className={`rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-2 transition-colors hover:bg-white/[0.03] ${
        ge.needsReview ? 'border-l-2 border-l-amber-400/70' : ''
      }`}
    >
      {/* 第一行：时间段 + 状态 chip + 置信度 */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[12px] font-medium text-slate-200">
          {hhmm(e.startTs)}-{hhmm(e.endTs)} <span className="text-slate-500">({fmtMin(e.durationMin)})</span>
        </span>
        <span
          className="rounded-full px-1.5 py-0.5 text-[10px] font-medium"
          style={{ background: `${color}1f`, color }}
        >
          {e.stateLabel}
        </span>
        <span className={`ml-auto text-[10px] ${ge.needsReview ? 'text-amber-400' : 'text-slate-500'}`}>
          ★{e.confidence.toFixed(2)}
          {ge.needsReview ? ' ⚠' : ''}
        </span>
      </div>
      {/* 字段行 */}
      {displayFields.length > 0 ? (
        <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-[11px]">
          {displayFields.map((f) => {
            const v = ge.fieldValues[f.key]?.value ?? ''
            return v ? (
              <span key={f.key} className="text-slate-400">
                <span className="text-slate-500">{f.label}：</span>
                {v}
              </span>
            ) : (
              <span key={f.key} className="text-slate-600">
                {f.label}：{f.fallback ?? '（未记录）'}
              </span>
            )
          })}
        </div>
      ) : null}
      {/* 待确认操作行 */}
      {ge.needsReview && !isEditing ? (
        <div className="mt-1.5 flex items-center gap-2">
          <button className="glass-btn primary !px-2 !py-0.5 !text-[10px]" onClick={() => onConfirm(e.id)}>
            <Icon name="check" size={10} /> 确认
          </button>
          <button className="glass-btn !px-2 !py-0.5 !text-[10px]" onClick={() => onStartEdit(ge)}>
            <Icon name="edit" size={10} /> 编辑
          </button>
        </div>
      ) : null}
      {/* 行内编辑 */}
      {isEditing && editing ? (
        <div className="anim-fade-in mt-2 flex flex-col gap-1.5 rounded-lg border border-white/[0.06] bg-white/[0.02] p-2">
          {(
            [
              ['subject', '对象'],
              ['contentTag', '内容'],
              ['project', '项目'],
              ['output', '产出']
            ] as const
          ).map(([key, label]) => (
            <label key={key} className="flex items-center gap-2 text-[11px] text-slate-500">
              <span className="w-8 shrink-0">{label}</span>
              <input
                className="glass-input flex-1 !py-1 !text-[11px]"
                value={editing[key]}
                onChange={(ev) => onEditChange(key, ev.target.value)}
              />
            </label>
          ))}
          <div className="mt-1 flex justify-end gap-2">
            <button className="glass-btn !px-2 !py-0.5 !text-[10px]" onClick={onCancelEdit}>
              取消
            </button>
            <button className="glass-btn primary !px-2 !py-0.5 !text-[10px]" onClick={onSaveEdit}>
              保存
            </button>
          </div>
        </div>
      ) : null}
    </div>
  )
}

/* ── 导入模板 Modal ── */

interface ImportModalProps {
  presets: ReportTemplate[]
  aiEnabled: boolean
  onClose: () => void
  onSelectPreset: (id: string) => void
  onSaved: (t: ReportTemplate) => void
}

const RAW_PLACEHOLDER = `粘贴你的日报格式，例如：

【上午工作】
09:00-12:00 | 工作内容 | 项目 | 产出

【会议记录】
时间 | 会议主题 | 参会人 | 结论

【今日数据】
工时 / 专注度 / 计划达成率`

function ImportTemplateModal({ presets, aiEnabled, onClose, onSelectPreset, onSaved }: ImportModalProps) {
  const [step, setStep] = useState<1 | 2>(1)
  const [raw, setRaw] = useState('')
  const [parsing, setParsing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [parsed, setParsed] = useState<ReportTemplate | null>(null) // 原始解析结果（字段候选全集）
  const [draft, setDraft] = useState<ReportTemplate | null>(null) // 编辑草稿
  const [saving, setSaving] = useState(false)

  const parse = async () => {
    if (!raw.trim() || parsing) return
    setParsing(true)
    setError(null)
    try {
      const t = (await window.api.parseReportTemplate(raw)) as ReportTemplate | null
      if (!t) {
        setError(aiEnabled ? '解析失败，请检查格式后重试' : '需要开启 AI 模式才能解析自定义格式')
      } else {
        setParsed(t)
        setDraft(t)
        setStep(2)
      }
    } catch {
      setError('解析失败，请检查格式后重试')
    } finally {
      setParsing(false)
    }
  }

  const toggleField = (sectionIdx: number, fieldKey: string, on: boolean) => {
    if (!draft || !parsed) return
    const sections = draft.sections.map((s, i) => {
      if (i !== sectionIdx) return s
      if (on) {
        // 按原始顺序补回字段
        const orig = parsed.sections[sectionIdx]?.fields ?? []
        const keys = new Set([...s.fields.map((f) => f.key), fieldKey])
        return { ...s, fields: orig.filter((f) => keys.has(f.key)) }
      }
      return { ...s, fields: s.fields.filter((f) => f.key !== fieldKey) }
    })
    setDraft({ ...draft, sections })
  }

  const save = async () => {
    if (!draft || saving) return
    setSaving(true)
    try {
      // id 置空让主进程走 insert（解析结果只在前端预览过，库中尚无该 id）
      const saved = (await window.api.saveReportTemplate({ ...draft, id: '', ts: Date.now() })) as ReportTemplate
      onSaved(saved)
    } catch {
      setError('保存失败，请重试')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="anim-fade-in fixed inset-0 z-[70] flex items-center justify-center bg-black/55 backdrop-blur-sm">
      <div className="glass-card anim-scale-in flex max-h-[84vh] w-[680px] max-w-[92vw] flex-col overflow-hidden">
        <div className="mb-3 flex items-center gap-2">
          <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-neon-cyan/15 text-neon-cyan">
            <Icon name="sparkles" size={13} />
          </span>
          <h3 className="text-[14px] font-semibold text-slate-100">导入我的日报格式</h3>
          <button className="ml-auto text-slate-500 transition-colors hover:text-slate-300" onClick={onClose}>
            <Icon name="x" size={15} />
          </button>
        </div>

        {step === 1 ? (
          <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
            <textarea
              className="glass-input h-52 w-full resize-y !text-[12px] leading-relaxed"
              placeholder={RAW_PLACEHOLDER}
              value={raw}
              onChange={(e) => setRaw(e.target.value)}
            />
            {error ? <div className="anim-fade-in text-[11px] text-amber-400">⚠ {error}</div> : null}
            <div className="flex items-center gap-2">
              <button className="glass-btn primary" disabled={!raw.trim() || parsing} onClick={() => void parse()}>
                {parsing ? (
                  <>
                    <span className="pulse-dot inline-block h-1.5 w-1.5 rounded-full bg-current" /> 解析中…
                  </>
                ) : (
                  <>
                    <Icon name="sparkles" size={13} /> AI 解析格式
                  </>
                )}
              </button>
              <span className="text-[10px] text-slate-600">解析后可预览并微调结构再保存</span>
            </div>
            {presets.length > 0 ? (
              <div className="border-t border-white/[0.05] pt-3">
                <div className="mb-1.5 text-[11px] text-slate-500">或选预置模板</div>
                <div className="flex flex-wrap gap-1.5">
                  {presets.map((t) => (
                    <button key={t.id} className="glass-btn !px-2.5 !py-1 !text-[11px]" onClick={() => onSelectPreset(t.id)}>
                      {t.name}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        ) : draft && parsed ? (
          <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden">
            <div className="grid min-h-0 flex-1 gap-3 overflow-hidden sm:grid-cols-2">
              {/* 左：原文 */}
              <pre className="min-h-0 overflow-y-auto rounded-xl border border-white/[0.06] bg-white/[0.02] p-3 text-[11px] leading-relaxed text-slate-400">
                {draft.rawContent ?? raw}
              </pre>
              {/* 右：结构编辑 */}
              <div className="flex min-h-0 flex-col gap-2.5 overflow-y-auto pr-1">
                <label className="flex items-center gap-2 text-[11px] text-slate-500">
                  <span className="w-12 shrink-0">模板名</span>
                  <input
                    className="glass-input flex-1 !py-1 !text-[12px]"
                    value={draft.name}
                    onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                  />
                </label>
                {draft.sections.map((s, si) => (
                  <div key={s.id || si} className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-2.5">
                    <div className="flex items-center gap-2">
                      <input
                        className="glass-input flex-1 !py-1 !text-[11px]"
                        value={s.title}
                        placeholder="段落标题"
                        onChange={(e) =>
                          setDraft({ ...draft, sections: draft.sections.map((x, i) => (i === si ? { ...x, title: e.target.value } : x)) })
                        }
                      />
                      <select
                        className="glass-input w-28 shrink-0 !py-1 !text-[11px]"
                        value={s.type}
                        onChange={(e) =>
                          setDraft({
                            ...draft,
                            sections: draft.sections.map((x, i) => (i === si ? { ...x, type: e.target.value as SectionType } : x))
                          })
                        }
                      >
                        {(Object.keys(SECTION_TYPE_LABELS) as SectionType[]).map((t) => (
                          <option key={t} value={t}>
                            {SECTION_TYPE_LABELS[t]}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1">
                      {(parsed.sections[si]?.fields ?? []).map((f) => {
                        const checked = s.fields.some((x) => x.key === f.key)
                        return (
                          <label key={f.key} className="flex cursor-pointer items-center gap-1 text-[10px] text-slate-400">
                            <input
                              type="checkbox"
                              className="accent-cyan-400"
                              checked={checked}
                              onChange={(e) => toggleField(si, f.key, e.target.checked)}
                            />
                            {f.label}
                            <span className="text-slate-600">({f.key})</span>
                          </label>
                        )
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>
            {error ? <div className="anim-fade-in text-[11px] text-amber-400">⚠ {error}</div> : null}
            <div className="flex justify-end gap-2 border-t border-white/[0.05] pt-3">
              <button className="glass-btn" onClick={() => setStep(1)}>
                返回
              </button>
              <button className="glass-btn primary" disabled={saving || !draft.name.trim()} onClick={() => void save()}>
                <Icon name="check" size={13} /> {saving ? '保存中…' : '保存为我的模板'}
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  )
}

/* ── 智能日报主视图 ── */

function SmartDayReportView({ onSynced }: { onSynced?: () => void }) {
  const settingsAI = useSettingsStore((s) => s.settings.smartReportAI)
  const aiGloballyEnabled = useSettingsStore((s) => s.settings.aiEnabled)
  const patch = useSettingsStore((s) => s.patch)

  const [date, setDate] = useState(todayKey())
  const [templates, setTemplates] = useState<ReportTemplate[]>([])
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null)
  const [report, setReport] = useState<GeneratedReport | null>(null)
  const [loading, setLoading] = useState(false)
  const [aiOn, setAiOn] = useState(settingsAI)
  const [copied, setCopied] = useState<'text' | 'md' | null>(null)
  const [showImport, setShowImport] = useState(false)
  const [editing, setEditing] = useState<EntryCardProps['editing']>(null)

  /* 模板列表 */
  const loadTemplates = useCallback(async () => {
    try {
      const list = (await window.api.listReportTemplates()) as ReportTemplate[]
      setTemplates(list)
      setSelectedTemplateId((cur) => cur ?? list.find((t) => t.isDefault)?.id ?? list[0]?.id ?? null)
    } catch {
      setTemplates([])
    }
  }, [])

  useEffect(() => {
    void loadTemplates()
  }, [loadTemplates])

  /* 报表生成：日期 / 模板 / AI 开关变化时重新生成 */
  useEffect(() => {
    let alive = true
    setLoading(true)
    window.api
      .generateReport(date, selectedTemplateId ?? undefined, aiOn)
      .then((r) => {
        if (alive) { setReport(r as GeneratedReport); onSynced?.() }
      })
      .catch(() => {
        if (alive) setReport(null)
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [date, selectedTemplateId, aiOn])

  const currentTemplate = templates.find((t) => t.id === (report?.templateId ?? selectedTemplateId))
  const isToday = date === todayKey()

  const toggleAI = () => {
    const v = !aiOn
    setAiOn(v)
    void patch({ smartReportAI: v })
  }

  const copy = (kind: 'text' | 'md') => {
    if (!report) return
    const text = kind === 'text' ? renderText(report, currentTemplate) : renderMarkdown(report, currentTemplate)
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(kind)
      window.setTimeout(() => setCopied(null), 1500)
    })
  }

  /* 确认 / 编辑条目 */
  const confirmEntry = (entryId: string, entryPatch?: Partial<ReportEntry>) => {
    void window.api.confirmReportEntry(date, entryId, entryPatch ?? {}, report?.templateId).catch(() => undefined)
    setReport((r) => (r ? patchReportEntry(r, entryId, { ...(entryPatch ?? {}), confidence: 1, needsReview: false }) : r))
  }

  const startEdit = (ge: GeneratedEntry) => {
    const e = ge.reportEntry
    setEditing({ id: e.id, subject: e.subject ?? '', contentTag: e.contentTag ?? '', project: e.project ?? '', output: e.output ?? '' })
  }

  const saveEdit = () => {
    if (!editing) return
    confirmEntry(editing.id, {
      subject: editing.subject.trim() || undefined,
      contentTag: editing.contentTag.trim() || undefined,
      project: editing.project.trim() || undefined,
      output: editing.output.trim() || undefined
    })
    setEditing(null)
  }

  const removeTemplate = async (t: ReportTemplate) => {
    if (!window.confirm(`确定删除模板「${t.name}」吗？`)) return
    try {
      await window.api.removeReportTemplate(t.id)
    } catch {
      /* ignore */
    }
    if (selectedTemplateId === t.id) setSelectedTemplateId(null)
    await loadTemplates()
  }

  /* 派生数据 */
  const stats = report?.stats
  const vs = stats?.vsYesterday
  const needReviewCount = report ? report.entries.filter((e) => e.needsReview).length : 0
  const planRate =
    report && report.achievements.length > 0
      ? Math.round(
          (report.achievements.filter((a) => a.status === 'completed' || a.status === 'partial').length / report.achievements.length) * 100
        )
      : null
  const aiStatusText =
    report?.aiStatus === 'enhanced' ? '已增强' : report?.aiStatus === 'fallback_to_base' ? 'AI 不可用，已用基础数据' : ''

  const presets = templates.filter((t) => t.source === 'preset')
  const userTemplates = templates.filter((t) => t.source !== 'preset')

  const renderTemplateItem = (t: ReportTemplate) => {
    const active = t.id === (report?.templateId ?? selectedTemplateId)
    const isUser = t.source !== 'preset'
    return (
      <div key={t.id} className="group relative">
        <button
          className={`flex w-full items-center gap-1.5 rounded-lg border px-2 py-1.5 text-left text-[12px] transition-all ${
            active
              ? 'border-neon-cyan/40 bg-neon-cyan/10 text-neon-cyan shadow-[0_0_10px_rgba(34,211,238,0.15)]'
              : 'border-transparent text-slate-400 hover:border-white/[0.08] hover:bg-white/[0.03] hover:text-slate-200'
          }`}
          onClick={() => setSelectedTemplateId(t.id)}
        >
          <span className="truncate">{t.name}</span>
          {t.isDefault ? <span className="ml-auto shrink-0 text-[9px] text-slate-500">默认</span> : null}
        </button>
        {isUser ? (
          <button
            className="absolute right-1 top-1/2 -translate-y-1/2 rounded p-0.5 text-slate-600 opacity-0 transition-all hover:text-red-400 group-hover:opacity-100"
            title="删除模板"
            onClick={() => void removeTemplate(t)}
          >
            <Icon name="trash" size={11} />
          </button>
        ) : null}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      {/* ── 顶栏：日期切换 + AI 开关 + 导出 ── */}
      <div className="glass-card hoverable flex flex-wrap items-center gap-2 !p-3">
        <button className="glass-btn !px-1.5 !py-1" title="前一天" onClick={() => setDate(addDays(date, -1))}>
          <Icon name="chevronLeft" size={13} />
        </button>
        <span className="min-w-28 text-center text-[13px] font-medium text-slate-200">{fmtDateLabel(date)}</span>
        <button className="glass-btn !px-1.5 !py-1" title="后一天" disabled={isToday} onClick={() => !isToday && setDate(addDays(date, 1))}>
          <Icon name="chevronRight" size={13} />
        </button>
        {!isToday ? (
          <button className="glass-btn !px-2 !py-1 !text-[11px]" onClick={() => setDate(todayKey())}>
            今天
          </button>
        ) : null}
        <div className="flex-1" />
        {/* AI 开关二态胶囊 */}
        <button
          className="flex items-center gap-1.5 rounded-full border border-white/[0.08] bg-white/[0.03] px-2.5 py-1 text-[11px] text-slate-300 transition-colors hover:border-white/[0.16]"
          onClick={toggleAI}
          title="切换后自动重新生成"
        >
          <span className={`h-1.5 w-1.5 rounded-full ${aiOn ? 'bg-violet-400 shadow-[0_0_6px_rgba(167,139,250,0.8)]' : 'bg-neon-green'}`} />
          {aiOn ? 'AI 增强 · 在线' : '基础能力 · 离线'}
        </button>
        {aiStatusText ? (
          <span className={`text-[10px] ${report?.aiStatus === 'fallback_to_base' ? 'text-amber-400' : 'text-slate-500'}`}>{aiStatusText}</span>
        ) : null}
        <button className={`glass-btn !px-2.5 !py-1 !text-[11px] ${copied === 'text' ? 'primary' : ''}`} disabled={!report} onClick={() => copy('text')}>
          {copied === 'text' ? '已复制 ✓' : '复制文本'}
        </button>
        <button className={`glass-btn !px-2.5 !py-1 !text-[11px] ${copied === 'md' ? 'primary' : ''}`} disabled={!report} onClick={() => copy('md')}>
          {copied === 'md' ? '已复制 ✓' : '复制 MD'}
        </button>
      </div>

      {/* ── 概览 4 卡 ── */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="glass-card anim-fade-up text-center">
          <div className="text-[24px] font-extrabold leading-tight tracking-tight text-neon-green">{stats ? fmtMin(stats.totalWorkMin) : '—'}</div>
          <div className="mt-1 text-[11px] text-slate-500">工作时长</div>
          <div className="mt-1 flex items-center justify-center gap-1">
            {vs ? <Delta v={vs.workMinDelta} fmt={fmtMin} /> : null}
            <span className="text-[10px] text-slate-600">vs 昨日</span>
          </div>
        </div>
        <div className="glass-card anim-fade-up text-center" style={{ animationDelay: '60ms' }}>
          <div className="text-[24px] font-extrabold leading-tight tracking-tight text-neon-cyan">{stats ? stats.focusScore : '—'}</div>
          <div className="mt-1 text-[11px] text-slate-500">专注度</div>
          <div className="mt-1 flex items-center justify-center gap-1">
            {vs ? <Delta v={vs.focusDelta} /> : null}
            <span className="text-[10px] text-slate-600">vs 昨日</span>
          </div>
        </div>
        <div className="glass-card anim-fade-up text-center" style={{ animationDelay: '120ms' }}>
          <div className="text-[24px] font-extrabold leading-tight tracking-tight text-neon-pink">{stats ? fmtMin(stats.totalSlackMin) : '—'}</div>
          <div className="mt-1 text-[11px] text-slate-500">摸鱼</div>
          <div className="mt-1 flex items-center justify-center gap-1">
            {vs ? <Delta v={vs.slackDelta} fmt={fmtMin} invert /> : null}
            <span className="text-[10px] text-slate-600">vs 昨日</span>
          </div>
        </div>
        <div className="glass-card anim-fade-up text-center" style={{ animationDelay: '180ms' }}>
          <div className="text-[24px] font-extrabold leading-tight tracking-tight text-slate-100">{planRate !== null ? `${planRate}%` : '—'}</div>
          <div className="mt-1 text-[11px] text-slate-500">计划达成</div>
          <div className="mt-1 text-[10px] text-slate-600">
            {report && report.achievements.length > 0 ? `${report.achievements.length} 项计划` : '暂无计划'}
          </div>
        </div>
      </div>

      {/* ── 主体：左侧模板栏 + 右侧条目区 ── */}
      <div className="flex items-start gap-4">
        {/* 左侧栏 */}
        <aside className="flex w-52 shrink-0 flex-col gap-3">
          <section className="glass-card hoverable anim-fade-up !p-3">
            <SectionTitle icon="calendar" title="报表模板" />
            <div className="flex flex-col gap-1">
              <div className="mb-0.5 text-[10px] text-slate-600">预置</div>
              {presets.map(renderTemplateItem)}
              {userTemplates.length > 0 ? (
                <>
                  <div className="mb-0.5 mt-2 text-[10px] text-slate-600">我的模板</div>
                  {userTemplates.map(renderTemplateItem)}
                </>
              ) : null}
            </div>
            <button
              className="mt-2.5 flex w-full items-center justify-center gap-1 rounded-lg border border-dashed border-white/[0.12] px-2 py-1.5 text-[11px] text-slate-500 transition-colors hover:border-neon-cyan/40 hover:text-neon-cyan"
              onClick={() => setShowImport(true)}
            >
              <Icon name="plus" size={11} /> 导入我的格式
            </button>
          </section>

          {/* 覆盖率卡 */}
          <section className="glass-card hoverable anim-fade-up !p-3" style={{ animationDelay: '60ms' }}>
            <SectionTitle icon="chart" title="数据质量" />
            <div className="flex items-center justify-between text-[11px]">
              <span className="text-slate-500">字段覆盖率</span>
              <span className="font-medium text-neon-cyan">{report ? `${Math.round(report.coverage * 100)}%` : '—'}</span>
            </div>
            <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
              <div
                className="h-full rounded-full bg-gradient-to-r from-neon-cyan to-neon-blue transition-all"
                style={{ width: `${report ? Math.round(report.coverage * 100) : 0}%` }}
              />
            </div>
            <div className="mt-2 flex items-center justify-between text-[10px] text-slate-500">
              <span>
                高置信 <span className="text-slate-300">{report ? report.entries.length - needReviewCount : 0}</span>
              </span>
              <span>
                需确认 <span className={needReviewCount > 0 ? 'text-amber-400' : 'text-slate-300'}>{needReviewCount}</span>
              </span>
            </div>
          </section>
        </aside>

        {/* 右侧条目区 */}
        <div className="flex min-w-0 flex-1 flex-col gap-4 overflow-y-auto">
          {loading && !report ? (
            <div className="glass-card flex items-center justify-center gap-2 py-10 text-[12px] text-slate-500">
              <span className="pulse-dot inline-block h-1.5 w-1.5 rounded-full bg-neon-cyan" />
              报表生成中…
            </div>
          ) : !report || report.entries.length === 0 ? (
            <div className="glass-card flex flex-col items-center gap-2 py-10 text-center">
              <span className="text-2xl opacity-70">🗓️</span>
              <p className="text-[12px] text-slate-500">这一天还没有足够数据，换个日期看看吧。</p>
            </div>
          ) : (
            report.sections.map((gs, gi) => {
              const meta = metaOf(currentTemplate, gs)
              const type = meta?.type ?? 'time_block'
              const icon = SECTION_TYPE_ICONS[type]

              /* 指标概览段：一行小字统计条 */
              if (type === 'metric_summary') {
                const fv = gs.entries[0]?.fieldValues ?? {}
                const parts = (meta?.fields ?? []).filter((f) => fv[f.key]?.value)
                if (parts.length === 0) return null
                return (
                  <section key={gs.sectionId} className="glass-card hoverable anim-fade-up" style={{ animationDelay: `${gi * 50}ms` }}>
                    {gs.title ? <SectionTitle icon={icon} title={gs.title} /> : null}
                    <div className="flex flex-wrap gap-x-5 gap-y-1 text-[12px]">
                      {parts.map((f) => (
                        <span key={f.key} className="text-slate-400">
                          <span className="text-slate-500">{f.label}</span>{' '}
                          <span className="font-medium text-slate-200">{fv[f.key].value}</span>
                        </span>
                      ))}
                    </div>
                  </section>
                )
              }

              /* 自由备注段 */
              if (type === 'free_text') {
                return (
                  <section key={gs.sectionId} className="glass-card hoverable anim-fade-up" style={{ animationDelay: `${gi * 50}ms` }}>
                    {gs.title ? <SectionTitle icon={icon} title={gs.title} /> : null}
                    <div className="rounded-lg border border-dashed border-white/10 bg-white/[0.02] py-3 text-center text-[11px] text-slate-500">
                      自由备注区（导出时保留）
                    </div>
                  </section>
                )
              }

              /* 明日计划段：只读列表 */
              if (type === 'plan_tomorrow') {
                return (
                  <section key={gs.sectionId} className="glass-card hoverable anim-fade-up" style={{ animationDelay: `${gi * 50}ms` }}>
                    <SectionTitle icon={icon} title={gs.title || '明日计划'} hint="只读" />
                    {gs.entries.length > 0 ? (
                      <div className="flex flex-col gap-1">
                        {gs.entries.map((ge) => (
                          <div key={ge.reportEntry.id} className="flex items-center gap-2 rounded-lg px-1.5 py-1 text-[12px] text-slate-300">
                            <span className="h-1 w-1 shrink-0 rounded-full bg-neon-cyan/70" />
                            <span className="truncate">{ge.reportEntry.contentTag ?? ge.reportEntry.stateLabel}</span>
                            <span className="ml-auto shrink-0 text-[10px] text-slate-600">{ge.reportEntry.stateLabel}</span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-[11px] text-slate-600">暂无计划项</p>
                    )}
                  </section>
                )
              }

              /* 条目段 */
              return (
                <section key={gs.sectionId} className="glass-card hoverable anim-fade-up" style={{ animationDelay: `${gi * 50}ms` }}>
                  <SectionTitle
                    icon={icon}
                    title={gs.title || SECTION_TYPE_LABELS[type]}
                    hint={gs.unfilledFields.length > 0 ? `缺字段：${gs.unfilledFields.join('、')}` : undefined}
                  />
                  {gs.entries.length > 0 ? (
                    <div className="flex flex-col gap-2">
                      {gs.entries.map((ge) => (
                        <EntryCard
                          key={ge.reportEntry.id}
                          ge={ge}
                          meta={meta}
                          editing={editing}
                          onStartEdit={startEdit}
                          onCancelEdit={() => setEditing(null)}
                          onEditChange={(key, value) => setEditing((cur) => (cur ? { ...cur, [key]: value } : cur))}
                          onConfirm={(id) => confirmEntry(id)}
                          onSaveEdit={saveEdit}
                        />
                      ))}
                    </div>
                  ) : (
                    <p className="text-[11px] text-slate-600">本段无匹配条目</p>
                  )}
                </section>
              )
            })
          )}
        </div>
      </div>

      {/* ── 底部：计划达成 + 模式洞察 ── */}
      <div className="grid gap-4 lg:grid-cols-2">
        <section className="glass-card hoverable anim-fade-up" style={{ animationDelay: '60ms' }}>
          <SectionTitle icon="target" title="计划达成" hint={report ? `${report.achievements.length} 项` : undefined} />
          {report && report.achievements.length > 0 ? (
            <div className="flex flex-col gap-1.5">
              {report.achievements.map((a) => {
                const m = ACH_META[a.status]
                return (
                  <div key={a.planId} className="flex items-center gap-2 rounded-lg px-1.5 py-1 text-[12px] transition-colors hover:bg-white/[0.03]">
                    <span className={`w-4 shrink-0 text-center ${m.cls}`}>{m.mark}</span>
                    <span className="min-w-0 truncate text-slate-300">{a.title}</span>
                    <span className="ml-auto shrink-0 text-[11px] text-slate-500">
                      {fmtMin(a.actualMin)}/{fmtMin(a.plannedMin)} <span className={m.cls}>({Math.round(a.achievementRate * 100)}%)</span>
                    </span>
                  </div>
                )
              })}
            </div>
          ) : (
            <p className="py-2 text-center text-[11px] text-slate-600">当日暂无计划项</p>
          )}
        </section>

        <section className="glass-card hoverable anim-fade-up" style={{ animationDelay: '120ms' }}>
          <SectionTitle icon="activity" title="模式洞察" hint="近 14 天" />
          {report?.patterns ? (
            <div className="flex flex-col gap-2.5">
              {report.patterns.patternTags.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {report.patterns.patternTags.map((t) => (
                    <span key={t} className="rounded-full border border-neon-cyan/20 bg-neon-cyan/[0.08] px-2 py-0.5 text-[10px] text-neon-cyan">
                      {t}
                    </span>
                  ))}
                </div>
              ) : null}
              <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-[11px]">
                <div className="flex items-center justify-between">
                  <span className="text-slate-500">最佳时段</span>
                  <span className="font-medium text-slate-300">{report.patterns.peakHours[0]?.slot ?? '—'}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-500">碎片化评分</span>
                  <span className="font-medium text-slate-300">
                    {report.patterns.fragmentationScore}/100
                    <span
                      className={`ml-1 text-[10px] ${
                        report.patterns.fragmentationScore < 25
                          ? 'text-neon-green'
                          : report.patterns.fragmentationScore > 60
                            ? 'text-amber-400'
                            : 'text-slate-500'
                      }`}
                    >
                      {report.patterns.fragmentationScore < 25 ? '良好' : report.patterns.fragmentationScore > 60 ? '偏高' : '适中'}
                    </span>
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-500">平均开工</span>
                  <span className="font-medium text-slate-300">{clockOf(report.patterns.workStartAvg)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-500">平均收工</span>
                  <span className="font-medium text-slate-300">{clockOf(report.patterns.workEndAvg)}</span>
                </div>
              </div>
            </div>
          ) : (
            <p className="py-2 text-center text-[11px] text-slate-600">数据积累中（需≥3天）</p>
          )}
        </section>
      </div>

      {/* ── 导入模板 Modal ── */}
      {showImport ? (
        <ImportTemplateModal
          presets={presets}
          aiEnabled={aiGloballyEnabled}
          onClose={() => setShowImport(false)}
          onSelectPreset={(id) => {
            setSelectedTemplateId(id)
            setShowImport(false)
          }}
          onSaved={(t) => {
            setShowImport(false)
            void loadTemplates().then(() => setSelectedTemplateId(t.id))
          }}
        />
      ) : null}
    </div>
  )
}

/* ── 智能周报视图（mode='week'）：周概览卡 + 按天分组条目（只读） ── */

/** 所在周的周一（WEEK_LABELS 口径：周一为一周起点） */
const mondayOf = (date: string): string => {
  const d = new Date(`${date}T00:00:00`)
  const offset = (d.getDay() + 6) % 7
  return addDays(date, -offset)
}

/** 周视图条目卡：复用单日条目卡视觉，只读（确认/编辑仍走智能日报） */
function WeekEntryCard({ e }: { e: ReportEntry }) {
  const color = WORK_STATES[e.state]?.color ?? '#94A3B8'
  const dims: [string, string | undefined][] = [
    ['应用', displayApp(e.app)],
    ['对象', e.subject],
    ['内容', e.contentTag],
    ['项目', e.project],
    ['产出', e.output]
  ]
  return (
    <div
      className={`rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-2 transition-colors hover:bg-white/[0.03] ${
        e.needsReview ? 'border-l-2 border-l-amber-400/70' : ''
      }`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[12px] font-medium text-slate-200">
          {hhmm(e.startTs)}-{hhmm(e.endTs)} <span className="text-slate-500">({fmtMin(e.durationMin)})</span>
        </span>
        <span className="rounded-full px-1.5 py-0.5 text-[10px] font-medium" style={{ background: `${color}1f`, color }}>
          {e.stateLabel}
        </span>
        <span className={`ml-auto text-[10px] ${e.needsReview ? 'text-amber-400' : 'text-slate-500'}`}>
          ★{e.confidence.toFixed(2)}
          {e.needsReview ? ' ⚠' : ''}
        </span>
      </div>
      <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-[11px]">
        {dims.map(([label, v]) =>
          v ? (
            <span key={label} className="text-slate-400">
              <span className="text-slate-500">{label}：</span>
              {v}
            </span>
          ) : null
        )}
      </div>
    </div>
  )
}

function SmartWeeklyReportView({ onSynced }: { onSynced?: () => void }) {
  const settingsAI = useSettingsStore((s) => s.settings.smartReportAI)
  const patch = useSettingsStore((s) => s.patch)

  const [anchor, setAnchor] = useState(todayKey()) // 周内任意一天，展示其所在周
  const [report, setReport] = useState<WeeklyGeneratedReport | null>(null)
  const [loading, setLoading] = useState(false)
  const [aiOn, setAiOn] = useState(settingsAI)

  const monday = mondayOf(anchor)
  const isCurrentWeek = monday >= mondayOf(todayKey())

  /* 周报表生成：周 / AI 开关变化时重新生成（模板对周报无意义，不传） */
  useEffect(() => {
    let alive = true
    setLoading(true)
    window.api
      .generateWeekReport(monday, undefined, aiOn)
      .then((r) => {
        if (alive) { setReport(r as WeeklyGeneratedReport); onSynced?.() }
      })
      .catch(() => {
        if (alive) setReport(null)
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [monday, aiOn])

  const toggleAI = () => {
    const v = !aiOn
    setAiOn(v)
    void patch({ smartReportAI: v })
  }

  const stats = report?.weekStats
  const aiStatusText =
    report?.aiStatus === 'enhanced' ? '已增强' : report?.aiStatus === 'fallback_to_base' ? 'AI 不可用，已用基础数据' : ''

  return (
    <div className="flex flex-col gap-4">
      {/* ── 顶栏：周切换 + AI 开关 ── */}
      <div className="glass-card hoverable flex flex-wrap items-center gap-2 !p-3">
        <button className="glass-btn !px-1.5 !py-1" title="上一周" onClick={() => setAnchor(addDays(anchor, -7))}>
          <Icon name="chevronLeft" size={13} />
        </button>
        <span className="min-w-40 text-center text-[13px] font-medium text-slate-200">
          {fmtDateLabel(monday)} ~ {fmtDateLabel(addDays(monday, 6))}
        </span>
        <button
          className="glass-btn !px-1.5 !py-1"
          title="下一周"
          disabled={isCurrentWeek}
          onClick={() => !isCurrentWeek && setAnchor(addDays(anchor, 7))}
        >
          <Icon name="chevronRight" size={13} />
        </button>
        {!isCurrentWeek ? (
          <button className="glass-btn !px-2 !py-1 !text-[11px]" onClick={() => setAnchor(todayKey())}>
            本周
          </button>
        ) : null}
        <div className="flex-1" />
        {/* AI 开关二态胶囊（周报 AI 复用单日管线增强） */}
        <button
          className="flex items-center gap-1.5 rounded-full border border-white/[0.08] bg-white/[0.03] px-2.5 py-1 text-[11px] text-slate-300 transition-colors hover:border-white/[0.16]"
          onClick={toggleAI}
          title="切换后自动重新生成"
        >
          <span className={`h-1.5 w-1.5 rounded-full ${aiOn ? 'bg-violet-400 shadow-[0_0_6px_rgba(167,139,250,0.8)]' : 'bg-neon-green'}`} />
          {aiOn ? 'AI 增强 · 在线' : '基础能力 · 离线'}
        </button>
        {aiStatusText ? (
          <span className={`text-[10px] ${report?.aiStatus === 'fallback_to_base' ? 'text-amber-400' : 'text-slate-500'}`}>{aiStatusText}</span>
        ) : null}
      </div>

      {/* ── 周概览 4 卡 ── */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="glass-card anim-fade-up text-center">
          <div className="text-[24px] font-extrabold leading-tight tracking-tight text-slate-100">
            {stats ? fmtMin(stats.totalWorkMin + stats.totalSlackMin) : '—'}
          </div>
          <div className="mt-1 text-[11px] text-slate-500">本周总时长</div>
          <div className="mt-1 text-[10px] text-slate-600">{stats ? `${stats.daysWithData} 天有记录` : ''}</div>
        </div>
        <div className="glass-card anim-fade-up text-center" style={{ animationDelay: '60ms' }}>
          <div className="text-[24px] font-extrabold leading-tight tracking-tight text-neon-green">{stats ? fmtMin(stats.totalWorkMin) : '—'}</div>
          <div className="mt-1 text-[11px] text-slate-500">工作时长</div>
        </div>
        <div className="glass-card anim-fade-up text-center" style={{ animationDelay: '120ms' }}>
          <div className="text-[24px] font-extrabold leading-tight tracking-tight text-neon-pink">{stats ? fmtMin(stats.totalSlackMin) : '—'}</div>
          <div className="mt-1 text-[11px] text-slate-500">摸鱼时长</div>
        </div>
        <div className="glass-card anim-fade-up text-center" style={{ animationDelay: '180ms' }}>
          <div className="text-[24px] font-extrabold leading-tight tracking-tight text-neon-cyan">{stats && stats.daysWithData > 0 ? stats.avgFocusScore : '—'}</div>
          <div className="mt-1 text-[11px] text-slate-500">日均评分</div>
          <div className="mt-1 text-[10px] text-slate-600">有记录天专注度均值</div>
        </div>
      </div>

      {/* ── 按天分组条目 ── */}
      {loading && !report ? (
        <div className="glass-card flex items-center justify-center gap-2 py-10 text-[12px] text-slate-500">
          <span className="pulse-dot inline-block h-1.5 w-1.5 rounded-full bg-neon-cyan" />
          周报生成中…
        </div>
      ) : !report || report.days.every((d) => d.entries.length === 0) ? (
        <div className="glass-card flex flex-col items-center gap-2 py-10 text-center">
          <span className="text-2xl opacity-70">🗓️</span>
          <p className="text-[12px] text-slate-500">这一周还没有足够数据，换一周看看吧。</p>
        </div>
      ) : (
        report.days.map((day, di) => (
          <section key={day.date} className="glass-card hoverable anim-fade-up" style={{ animationDelay: `${di * 50}ms` }}>
            <SectionTitle
              icon="calendar"
              title={fmtDateLabel(day.date)}
              hint={
                day.entries.length > 0
                  ? `工作 ${fmtMin(day.stats.totalWorkMin)} · 摸鱼 ${fmtMin(day.stats.totalSlackMin)} · 专注 ${day.stats.focusScore}分`
                  : '无记录'
              }
            />
            {day.entries.length > 0 ? (
              <div className="flex flex-col gap-2">
                {day.entries.map((e) => (
                  <WeekEntryCard key={`${day.date}:${e.id}`} e={e} />
                ))}
              </div>
            ) : null}
          </section>
        ))
      )}
    </div>
  )
}

/* ── 入口：day=智能日报（默认），week=智能周报 ── */

export default function SmartReportView({ mode = 'day', onSynced }: { mode?: 'day' | 'week'; onSynced?: () => void }) {
  if (mode === 'week') return <SmartWeeklyReportView onSynced={onSynced} />
  return <SmartDayReportView onSynced={onSynced} />
}
