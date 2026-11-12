import { useCallback, useEffect, useMemo, useState } from 'react'
import { displayApp } from '@shared/appDisplayName'
import { Modal } from './ui/Modal'
import { Icon } from './Icon'

interface ReviewItem {
  app: string
  label: string
  min: number
  projectId: string | null
  projectName?: string
  suggestedProjectId?: string
  suggestedProjectName?: string
  reason?: string
}

interface ReviewProject {
  id: string
  name: string
  color?: string
  status: string
}

interface ReviewSheetProps {
  open: boolean
  onClose: () => void
  /** 每次确认/忽略后回调，用于刷新首屏结论 */
  onChanged?: () => void
}

const fmtMin = (min: number): string => {
  const m = Math.round(min)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  const rest = m % 60
  return rest > 0 ? `${h}h${rest}m` : `${h}h`
}

/**
 * 一分钟校对：把「今天这些应用算哪个项目」变成一屏可处理完的队列。
 * 一个应用一行，默认给出建议项目 —— 点一下即确认，不用打开任何二级页面。
 */
export function ReviewSheet({ open, onClose, onChanged }: ReviewSheetProps) {
  const [items, setItems] = useState<ReviewItem[]>([])
  const [projects, setProjects] = useState<ReviewProject[]>([])
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [pending, list] = await Promise.all([
        window.api.reviewPending() as Promise<ReviewItem[]>,
        window.api.reviewProjects() as Promise<ReviewProject[]>
      ])
      setItems(pending ?? [])
      setProjects(list ?? [])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (open) void load()
  }, [open, load])

  const confirm = async (item: ReviewItem, projectId: string | null): Promise<void> => {
    setBusy(item.app)
    try {
      await window.api.reviewConfirm(item.app, projectId)
      setItems((prev) => prev.filter((i) => i.app !== item.app))
      onChanged?.()
    } finally {
      setBusy(null)
    }
  }

  const ignore = async (item: ReviewItem): Promise<void> => {
    setBusy(item.app)
    try {
      await window.api.reviewIgnore(item.app)
      setItems((prev) => prev.filter((i) => i.app !== item.app))
      onChanged?.()
    } finally {
      setBusy(null)
    }
  }

  const totalMin = useMemo(() => items.reduce((s, i) => s + i.min, 0), [items])
  const suggestedItems = useMemo(() => items.filter((i) => i.suggestedProjectId), [items])

  const confirmAllSuggested = async (): Promise<void> => {
    for (const item of suggestedItems) {
      if (item.suggestedProjectId) await confirm(item, item.suggestedProjectId)
    }
  }

  return (
    <Modal
      open={open}
      title="今天的时间，算在哪个项目？"
      size="md"
      onClose={onClose}
      footer={
        <>
          <span className="mr-auto text-xs text-slate-500">
            {items.length > 0 ? `还剩 ${items.length} 条 · ${fmtMin(totalMin)}` : '全部处理完了'}
          </span>
          {suggestedItems.length > 1 ? (
            <button className="glass-btn primary" onClick={() => void confirmAllSuggested()}>
              确认全部建议（{suggestedItems.length}）
            </button>
          ) : null}
          <button className="glass-btn" onClick={onClose}>
            完成
          </button>
        </>
      }
    >
      {loading ? (
        <div className="py-8 text-center text-xs text-slate-500">读取中…</div>
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center gap-1 py-8 text-center">
          <Icon name="check" size={20} className="text-slate-500" />
          <div className="text-sm text-slate-300">今天的时间都归好类了</div>
          <div className="text-xs text-slate-500">明天再来看一眼就行</div>
        </div>
      ) : (
        <div className="flex flex-col">
          {items.map((item) => (
            <div
              key={item.app}
              className="flex flex-wrap items-center gap-2 border-b py-2.5 last:border-b-0"
              style={{ borderColor: 'var(--line)' }}
            >
              <span className="min-w-0 flex-1 truncate text-sm text-slate-200" title={item.label}>
                {displayApp(item.label)}
              </span>
              <span className="w-12 shrink-0 text-right text-xs tabular-nums text-slate-500">{fmtMin(item.min)}</span>
              {item.suggestedProjectId ? (
                <button
                  className="glass-btn shrink-0 bg-[var(--surface-2)] text-slate-200"
                  disabled={busy === item.app}
                  onClick={() => void confirm(item, item.suggestedProjectId!)}
                  title={item.reason ?? '已按绑定关系推断'}
                >
                  归到 {item.suggestedProjectName}
                </button>
              ) : (
                <select
                  className="glass-input shrink-0"
                  style={{ width: 112 }}
                  value={item.projectId ?? ''}
                  disabled={busy === item.app}
                  onChange={(e) => {
                    const pid = e.target.value
                    if (pid) void confirm(item, pid)
                  }}
                  aria-label={`为 ${item.label} 选择项目`}
                >
                  <option value="">选项目…</option>
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              )}
              <button
                className="shrink-0 rounded-md px-2 py-1 text-xs text-slate-500 hover:bg-[var(--surface-2)] hover:text-slate-300"
                disabled={busy === item.app}
                onClick={() => void ignore(item)}
                title="不算工作，今天不再出现"
              >
                无关
              </button>
            </div>
          ))}
        </div>
      )}
    </Modal>
  )
}
