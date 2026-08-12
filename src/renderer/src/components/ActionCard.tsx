import { useState } from 'react'

export interface ActionCardData {
  id: string
  title: string
  startTs: number
  endTs: number
  app: string
  type: 'focus' | 'plan' | 'switch' | 'meeting'
}

interface ActionCardProps {
  data: ActionCardData
  onUpdate?: (patch: Partial<ActionCardData>) => void
  onDelete?: () => void
}

function fmtTime(ts: number): string { const d = new Date(ts); return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}` }

const typeIcons: Record<string, string> = { focus: '🔵', plan: '📋', switch: '🔄', meeting: '📝' }

export default function ActionCard({ data, onUpdate, onDelete }: ActionCardProps) {
  const [expanded, setExpanded] = useState(false)
  const [editTitle, setEditTitle] = useState(data.title)
  const [editStart, setEditStart] = useState(new Date(data.startTs).toISOString().slice(0, 16))
  const [editEnd, setEditEnd] = useState(new Date(data.endTs).toISOString().slice(0, 16))

  const save = () => {
    const start = new Date(editStart).getTime()
    const end = new Date(editEnd).getTime()
    if (start >= end) return
    onUpdate?.({ title: editTitle, startTs: start, endTs: end })
    setExpanded(false)
  }

  const durMin = Math.round((data.endTs - data.startTs) / 60000)

  if (!expanded) {
    return (
      <div onClick={() => setExpanded(true)} className="shrink-0 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 min-w-[140px] cursor-pointer hover:bg-white/[0.06] transition-colors">
        <div className="flex items-center gap-1.5 text-[11px] text-slate-300 mb-0.5">
          <span>{typeIcons[data.type]}</span><span>{data.app}</span><span className="ml-auto">{fmtTime(data.startTs)}</span>
        </div>
        <p className="text-[12px] text-slate-200 truncate">{data.title || '无标题'}</p>
        <span className="text-[10px] text-slate-300">{durMin}m</span>
      </div>
    )
  }

  return (
    <div className="shrink-0 rounded-xl border border-neon-cyan/20 bg-white/[0.06] px-4 py-3 min-w-[220px]">
      <div className="flex flex-col gap-2">
        <input className="glass-input text-[12px]" value={editTitle} onChange={e => setEditTitle(e.target.value)} placeholder="标题" autoFocus />
        <div className="flex gap-2 items-center text-[11px] text-slate-400">
          <span>起：</span>
          <input type="datetime-local" className="glass-input flex-1 text-[11px]" value={editStart} onChange={e => setEditStart(e.target.value)} />
        </div>
        <div className="flex gap-2 items-center text-[11px] text-slate-400">
          <span>止：</span>
          <input type="datetime-local" className="glass-input flex-1 text-[11px]" value={editEnd} onChange={e => setEditEnd(e.target.value)} />
        </div>
        {new Date(editStart).getTime() >= new Date(editEnd).getTime() && (
          <p className="text-[10px] text-red-400">起始时间不能晚于结束时间</p>
        )}
        <div className="flex justify-end gap-2 mt-1">
          <button className="glass-btn text-[11px]" onClick={() => setExpanded(false)}>取消</button>
          {onDelete && <button className="glass-btn text-[11px] text-red-400 hover:text-red-300" onClick={onDelete}>删除</button>}
          <button className="glass-btn primary text-[11px]" onClick={save}>保存</button>
        </div>
      </div>
    </div>
  )
}
