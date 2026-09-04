/**
 * 自动化工坊（v7 MotionLab）：触发器 → 条件 → 动作
 * - 积木库选块组链，模板一键创建，启用/删除，main automation.ts 调度执行
 * - 与现有「动作工坊」（MotionLab 录制动作+积分）并列，互不影响
 */
import { useEffect, useState } from 'react'
import type { AutomationRule } from '@shared/types'

type TriggerKind = AutomationRule['trigger']['kind']
type ActionKind = AutomationRule['actions'][number]['kind']

const TRIGGER_LABEL: Record<TriggerKind, string> = {
  daily: '⏰ 每天定时',
  appSwitch: '🖥 应用切换',
  focusReached: '📊 专注满 N 小时'
}
const ACTION_LABEL: Record<ActionKind, string> = {
  genReport: '📝 生成日报',
  petCelebrate: '🐱 桌宠庆祝',
  notify: '🔔 发通知',
  addTodo: '➕ 建待办'
}
/** 积木三色：触发器 teal / 条件 amber / 动作 violet */
const TAG_CLS: Record<'trg' | 'cnd' | 'act', string> = {
  trg: 'bg-[var(--teal-soft)] text-[var(--teal-deep)]',
  cnd: 'bg-[rgba(245,158,11,0.12)] text-[#fbbf24]',
  act: 'bg-[rgba(139,92,246,0.12)] text-[var(--violet)]'
}

interface Draft {
  name: string
  triggerKind: TriggerKind
  time: string
  app: string
  focusHours: number
  workdayOnly: boolean
  minFocusHours: number
  actions: ActionKind[]
}

const EMPTY_DRAFT: Draft = {
  name: '',
  triggerKind: 'daily',
  time: '18:00',
  app: '',
  focusHours: 2,
  workdayOnly: true,
  minFocusHours: 0,
  actions: ['genReport']
}

const TEMPLATES: { name: string; desc: string; rule: Draft }[] = [
  {
    name: '每天 18:00 生成日报',
    desc: '工作日 18:00 自动生成今日日报，桌宠递上',
    rule: { name: '每天 18:00 生成日报', triggerKind: 'daily', time: '18:00', app: '', focusHours: 2, workdayOnly: true, minFocusHours: 0, actions: ['genReport', 'petCelebrate'] }
  },
  {
    name: '专注满 2h 提醒休息',
    desc: '连续专注达 2 小时 → 通知休息',
    rule: { name: '专注满 2h 提醒休息', triggerKind: 'focusReached', time: '18:00', app: '', focusHours: 2, workdayOnly: false, minFocusHours: 0, actions: ['notify'] }
  },
  {
    name: '切到 B 站提醒',
    desc: '切到 Bilibili 时桌宠提醒你 🐟',
    rule: { name: '切到 B 站提醒', triggerKind: 'appSwitch', time: '18:00', app: 'Bili', focusHours: 2, workdayOnly: false, minFocusHours: 0, actions: ['notify'] }
  }
]

function toApiRule(d: Draft): Partial<AutomationRule> & { name: string; trigger: AutomationRule['trigger']; actions: AutomationRule['actions'] } {
  return {
    name: d.name.trim() || '未命名自动化',
    enabled: true,
    trigger: {
      kind: d.triggerKind,
      time: d.triggerKind === 'daily' ? d.time : undefined,
      app: d.triggerKind === 'appSwitch' ? d.app : undefined,
      focusHours: d.triggerKind === 'focusReached' ? d.focusHours : undefined,
      workdayOnly: d.workdayOnly
    },
    minFocusHours: d.minFocusHours > 0 ? d.minFocusHours : undefined,
    actions: d.actions.map((kind) => ({
      kind,
      text:
        kind === 'notify' && d.triggerKind === 'appSwitch'
          ? `检测到你切到了 ${d.app || '目标应用'}，注意节奏哦 🐟`
          : kind === 'petCelebrate'
            ? `自动化「${d.name || '未命名'}」完成啦 🎉`
            : undefined
    }))
  }
}

function triggerSummary(r: AutomationRule): string {
  const t = r.trigger
  const base =
    t.kind === 'daily'
      ? `每天 ${t.time ?? '--:--'}`
      : t.kind === 'appSwitch'
        ? `切到 ${t.app ?? '?'}`
        : `专注满 ${t.focusHours ?? '?'}h`
  return t.workdayOnly ? `${base}（工作日）` : base
}

function actionsSummary(r: AutomationRule): string {
  return r.actions.map((a) => ACTION_LABEL[a.kind] ?? a.kind).join(' → ')
}

export function AutomationLab() {
  const [rules, setRules] = useState<AutomationRule[]>([])
  const [draft, setDraft] = useState<Draft | null>(null)
  const [busy, setBusy] = useState(false)
  const [tip, setTip] = useState('')

  const refresh = async (): Promise<void> => {
    try {
      const list = (await window.api?.listAutomations?.()) as AutomationRule[] | undefined
      setRules(list ?? [])
    } catch { /* ignore */ }
  }

  useEffect(() => {
    void refresh()
  }, [])

  const flash = (msg: string): void => {
    setTip(msg)
    window.setTimeout(() => setTip(''), 2500)
  }

  const save = async (): Promise<void> => {
    if (!draft || busy) return
    setBusy(true)
    try {
      await window.api?.saveAutomation?.(toApiRule(draft))
      setDraft(null)
      flash('自动化已保存 ✓')
      await refresh()
    } catch (e) {
      flash('保存失败：' + (e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const toggle = async (r: AutomationRule): Promise<void> => {
    await window.api?.toggleAutomation?.(r.id, !r.enabled)
    await refresh()
  }

  const remove = async (r: AutomationRule): Promise<void> => {
    await window.api?.removeAutomation?.(r.id)
    flash('已删除')
    await refresh()
  }

  const set = (patch: Partial<Draft>): void => setDraft((d) => (d ? { ...d, ...patch } : d))

  return (
    <div className="mt-4 border-t border-white/[0.06] pt-3">
      <div className="flex items-center justify-between">
        <div className="text-[10px] uppercase text-slate-600">自动化工坊 · 触发器 → 条件 → 动作</div>
        <button
          className="rounded-lg border px-2.5 py-1 text-[11px] transition-all hover:-translate-y-px"
          style={{ background: 'var(--aura)', borderColor: 'transparent', color: '#fff' }}
          onClick={() => setDraft({ ...EMPTY_DRAFT })}
        >
          ✦ 新建自动化
        </button>
      </div>

      {/* 模板 */}
      {rules.length === 0 && !draft ? (
        <div className="mt-2 flex flex-col gap-1.5">
          <div className="text-[10px] text-slate-500">从模板开始：</div>
          {TEMPLATES.map((t) => (
            <button
              key={t.name}
              className="flex items-center gap-2 rounded-lg border border-[var(--line)] bg-[var(--surface-2)] px-2.5 py-1.5 text-left transition-all hover:border-[rgba(15,181,164,0.4)]"
              onClick={() => setDraft({ ...(t.rule as unknown as Draft), name: t.name })}
            >
              <span className="rounded bg-[var(--teal-soft)] px-1.5 py-0.5 text-[9px] font-bold text-[var(--teal-deep)]">模板</span>
              <span className="min-w-0 flex-1">
                <b className="block truncate text-[11.5px] text-slate-200">{t.name}</b>
                <span className="block truncate text-[10px] text-slate-500">{t.desc}</span>
              </span>
            </button>
          ))}
        </div>
      ) : null}

      {/* 已有链列表 */}
      {rules.length > 0 ? (
        <div className="mt-2 flex flex-col gap-1.5">
          {rules.map((r) => (
            <div key={r.id} className="flex items-center gap-2 rounded-lg bg-white/[0.03] px-2.5 py-1.5">
              <span className={`shrink-0 rounded px-1.5 py-0.5 text-[9px] font-bold ${TAG_CLS.trg}`}>{TRIGGER_LABEL[r.trigger.kind]}</span>
              <div className="min-w-0 flex-1">
                <b className="block truncate text-[12px] text-slate-200">{r.name}</b>
                <div className="truncate text-[10px] text-slate-500">{triggerSummary(r)} → {actionsSummary(r)}</div>
              </div>
              <button
                className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ${r.enabled ? 'bg-[var(--teal-soft)] text-[var(--teal-deep)]' : 'bg-white/10 text-slate-500'}`}
                onClick={() => void toggle(r)}
              >
                {r.enabled ? '已启用' : '已停用'}
              </button>
              <button className="shrink-0 text-slate-500 transition-colors hover:text-slate-200" title="删除" onClick={() => void remove(r)}>✕</button>
            </div>
          ))}
        </div>
      ) : null}

      {/* 链编辑器 */}
      {draft ? (
        <div className="mt-2 rounded-xl border border-[var(--line)] bg-[var(--surface-2)] p-2.5">
          <input
            className="w-full rounded-lg border border-[var(--line)] bg-[var(--bg-surface)] px-2.5 py-1.5 text-[12px] text-slate-200 outline-none focus:border-[var(--border-active)]"
            placeholder="自动化名称（如：每天 18:00 生成日报）"
            value={draft.name}
            onChange={(e) => set({ name: e.target.value })}
          />
          {/* 触发器积木 */}
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <span className="rounded px-1.5 py-0.5 text-[9px] font-bold ${TAG_CLS.trg} bg-[var(--teal-soft)] text-[var(--teal-deep)]">触发器</span>
            {(Object.keys(TRIGGER_LABEL) as TriggerKind[]).map((k) => (
              <button
                key={k}
                className={`rounded-md border px-2 py-1 text-[10.5px] transition-all ${
                  draft.triggerKind === k
                    ? 'border-[rgba(15,181,164,0.5)] bg-[var(--teal-soft)] text-[var(--teal-deep)]'
                    : 'border-[var(--line)] text-slate-400 hover:text-slate-200'
                }`}
                onClick={() => set({ triggerKind: k })}
              >
                {TRIGGER_LABEL[k]}
              </button>
            ))}
          </div>
          {/* 触发参数 */}
          <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[11px] text-slate-400">
            {draft.triggerKind === 'daily' ? (
              <label>
                时间 <input type="time" className="rounded border border-[var(--line)] bg-[var(--bg-surface)] px-1.5 py-0.5 text-slate-200" value={draft.time} onChange={(e) => set({ time: e.target.value })} />
              </label>
            ) : null}
            {draft.triggerKind === 'appSwitch' ? (
              <label>
                应用包含 <input className="w-24 rounded border border-[var(--line)] bg-[var(--bg-surface)] px-1.5 py-0.5 text-slate-200" value={draft.app} onChange={(e) => set({ app: e.target.value })} placeholder="如 Bili" />
              </label>
            ) : null}
            {draft.triggerKind === 'focusReached' ? (
              <label>
                专注小时 <input type="number" min={1} max={8} className="w-14 rounded border border-[var(--line)] bg-[var(--bg-surface)] px-1.5 py-0.5 text-slate-200" value={draft.focusHours} onChange={(e) => set({ focusHours: Number(e.target.value) || 1 })} />
              </label>
            ) : null}
            <label className="flex items-center gap-1">
              <input type="checkbox" checked={draft.workdayOnly} onChange={(e) => set({ workdayOnly: e.target.checked })} /> 仅工作日
            </label>
            <label className="flex items-center gap-1">
              今日专注≥ <input type="number" min={0} max={12} className="w-12 rounded border border-[var(--line)] bg-[var(--bg-surface)] px-1.5 py-0.5 text-slate-200" value={draft.minFocusHours} onChange={(e) => set({ minFocusHours: Number(e.target.value) || 0 })} /> h（0=不限）
            </label>
          </div>
          {/* 动作积木 */}
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <span className="rounded bg-[rgba(139,92,246,0.12)] px-1.5 py-0.5 text-[9px] font-bold text-[var(--violet)]">动作</span>
            {(Object.keys(ACTION_LABEL) as ActionKind[]).map((k) => {
              const on = draft.actions.includes(k)
              return (
                <button
                  key={k}
                  className={`rounded-md border px-2 py-1 text-[10.5px] transition-all ${
                    on
                      ? 'border-[rgba(139,92,246,0.5)] bg-[rgba(139,92,246,0.12)] text-[var(--violet)]'
                      : 'border-[var(--line)] text-slate-400 hover:text-slate-200'
                  }`}
                  onClick={() => set({ actions: on ? draft.actions.filter((a) => a !== k) : [...draft.actions, k] })}
                >
                  {ACTION_LABEL[k]}
                </button>
              )
            })}
          </div>
          <div className="mt-2.5 flex justify-end gap-2">
            <button className="glass-btn !py-1 text-[11px]" onClick={() => setDraft(null)}>取消</button>
            <button className="glass-btn primary !py-1 text-[11px]" disabled={busy || !draft.actions.length} onClick={() => void save()}>
              保存自动化
            </button>
          </div>
        </div>
      ) : null}

      {tip ? <div className="mt-2 rounded-lg bg-[var(--teal-soft)] px-2.5 py-1.5 text-[11px] text-[var(--teal-deep)]">{tip}</div> : null}
    </div>
  )
}
