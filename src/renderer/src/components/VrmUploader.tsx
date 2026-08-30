/**
 * VRM 角色管理（方案一）：上传 → 模型体检报告 → 确认应用；一键恢复默认
 */
import { useEffect, useState } from 'react'
import type { VrmReport } from '../vrm/inspect'

interface Picked {
  pendingPath: string
  name: string
  sizeMB: number
  buffer: ArrayBuffer
}

const LEVEL_ICON: Record<string, string> = { ok: '✅', warn: '⚠️', fail: '❌' }
const LEVEL_COLOR: Record<string, string> = {
  ok: 'text-emerald-300',
  warn: 'text-amber-300',
  fail: 'text-red-400'
}

export function VrmUploader({ petVrmPath }: { petVrmPath?: string }) {
  const [inspecting, setInspecting] = useState(false)
  const [report, setReport] = useState<VrmReport | null>(null)
  const [pendingPath, setPendingPath] = useState('')
  const [pickedName, setPickedName] = useState('')
  const [tip, setTip] = useState('')
  const [applying, setApplying] = useState(false)

  useEffect(() => {
    if (!tip) return
    const t = window.setTimeout(() => setTip(''), 3000)
    return () => window.clearTimeout(t)
  }, [tip])

  const pick = async (): Promise<void> => {
    setInspecting(true)
    setReport(null)
    setPendingPath('')
    try {
      const picked = (await window.api?.vrmPickInspect?.()) as Picked | null
      if (!picked) return
      setPickedName(picked.name)
      const { inspectVrmBuffer } = await import('../vrm/inspect')
      const rep = await inspectVrmBuffer(picked.buffer, picked.sizeMB)
      setReport(rep)
      if (rep.ok) setPendingPath(picked.pendingPath)
      setTip('')
    } catch (e) {
      setTip('体检失败：' + (e as Error).message + '（文件可能不是 VRM 格式）')
    } finally {
      setInspecting(false)
    }
  }

  const apply = async (): Promise<void> => {
    if (!pendingPath) return
    setApplying(true)
    try {
      const ok = await window.api?.vrmApply?.(pendingPath)
      setTip(ok ? '已应用，桌宠换装中…' : '应用失败')
      if (ok) setReport(null)
    } finally {
      setApplying(false)
    }
  }

  const reset = async (): Promise<void> => {
    await window.api?.resetVrm?.()
    setReport(null)
    setPendingPath('')
    setTip('已恢复默认姵儿')
  }

  return (
    <div className="flex flex-col items-end gap-1.5">
      <div className="flex items-center gap-2">
        <select
          className="glass-input w-32"
          value={petVrmPath ? 'custom' : 'ling'}
          onChange={(e) => {
            if (e.target.value === 'ling') void window.api?.resetVrm?.()
          }}
        >
          <option value="ling">姵儿（默认）</option>
          {petVrmPath && <option value="custom">自定义角色</option>}
        </select>
        <button
          disabled={inspecting}
          className="rounded-lg border border-neon-cyan/30 bg-neon-cyan/10 px-3 py-1 text-[11px] text-neon-cyan transition-all hover:bg-neon-cyan/20 disabled:opacity-40"
          onClick={() => void pick()}
        >
          {inspecting ? '体检中…' : '上传 VRM'}
        </button>
        {petVrmPath ? (
          <button className="text-[10px] text-slate-500 hover:text-slate-300" onClick={() => void reset()}>
            恢复默认
          </button>
        ) : null}
      </div>

      {report ? (
        <div className="mt-1 w-64 rounded-xl border border-white/10 bg-[#101a30] p-3 text-left shadow-lg">
          <div className="mb-1.5 flex items-center justify-between">
            <span className="truncate text-[11px] text-slate-400">{pickedName}</span>
            <span className={`text-[11px] font-bold ${report.ok ? 'text-emerald-300' : 'text-red-400'}`}>
              {report.ok ? '✓ 可用' : '✗ 不建议'}
            </span>
          </div>
          <div className="flex flex-col gap-1">
            {report.items.map((it) => (
              <div key={it.key} className="flex gap-1.5 text-[11px] leading-snug">
                <span className={LEVEL_COLOR[it.level] ?? ''}>{LEVEL_ICON[it.level]}</span>
                <span className="text-slate-300">{it.label}</span>
                <span className="flex-1 text-slate-500">{it.detail}</span>
              </div>
            ))}
          </div>
          {report.ok ? (
            <button
              disabled={applying}
              className="mt-2 w-full rounded-lg bg-neon-violet/20 py-1.5 text-[11px] text-neon-violet hover:bg-neon-violet/30 disabled:opacity-40"
              onClick={() => void apply()}
            >
              {applying ? '应用中…' : '应用这个模型'}
            </button>
          ) : (
            <div className="mt-2 text-[10px] text-red-400">该模型无法用于桌宠（缺人形骨骼），请换一个 VRM 文件</div>
          )}
        </div>
      ) : null}

      {tip ? <div className="text-[10px] text-neon-cyan">{tip}</div> : null}
    </div>
  )
}
