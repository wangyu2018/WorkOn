/**
 * 动作工坊入口 + 动作库 + 积分（桌搭页区块，第三批）
 */
import { useEffect, useState } from 'react'
import type { MotionMeta, PointsEntry } from '@shared/types'

interface PointsState {
  balance: number
  ledger: PointsEntry[]
}

export function MotionLab() {
  const [motions, setMotions] = useState<MotionMeta[]>([])
  const [points, setPoints] = useState<PointsState>({ balance: 0, ledger: [] })
  const [busy, setBusy] = useState(false)
  const [tip, setTip] = useState('')

  const refresh = async (): Promise<void> => {
    try {
      const [m, p] = await Promise.all([
        window.api?.motionsList?.() ?? [],
        window.api?.pointsGet?.() ?? { balance: 0, ledger: [] }
      ])
      setMotions((m as MotionMeta[]) ?? [])
      setPoints((p as PointsState) ?? { balance: 0, ledger: [] })
    } catch { /* ignore */ }
  }

  useEffect(() => {
    void refresh()
  }, [])

  const act = async (fn: () => Promise<unknown>, okMsg?: string): Promise<void> => {
    if (busy) return
    setBusy(true)
    try {
      await fn()
      if (okMsg) setTip(okMsg)
      await refresh()
    } catch (e) {
      setTip('操作失败：' + (e as Error).message)
    } finally {
      setBusy(false)
      window.setTimeout(() => setTip(''), 2500)
    }
  }

  return (
    <div className="mt-4 border-t border-white/[0.06] pt-3">
      <div className="flex items-center justify-between">
        <div className="text-2xs uppercase text-slate-600">动作工坊</div>
        <div className="text-xs text-amber-300/90">⭐ 积分 {points.balance}</div>
      </div>
      <div className="mt-2 flex items-center gap-2">
        <button
          className="rounded-lg border border-neon-violet/30 bg-neon-violet/10 px-3 py-1 text-xs text-neon-violet transition-all hover:bg-neon-violet/20"
          onClick={() => window.api?.motionStudioOpen?.()}
        >
          🎬 打开动作工坊
        </button>
        <span className="text-2xs text-slate-500">视频/摄像头录制 → 动作 → 桌宠播放</span>
      </div>

      {motions.length > 0 ? (
        <div className="mt-3 flex flex-col gap-1.5">
          {motions.map((m) => {
            const locked = m.cost > 0 && !m.owned
            return (
              <div key={m.id} className="flex items-center justify-between gap-2 rounded-lg bg-white/[0.03] px-2.5 py-1.5">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-xs text-slate-200">
                    {locked ? '🔒 ' : '🎬 '}{m.name}
                  </div>
                  <div className="text-2xs text-slate-500">
                    {m.duration.toFixed(1)}s · {m.fps}fps{m.cost > 0 ? ` · ${m.cost} 积分` : ' · 免费'}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  {locked ? (
                    <button
                      disabled={busy}
                      className="rounded-lg border border-amber-300/30 bg-amber-300/10 px-2.5 py-1 text-xs text-amber-300 hover:bg-amber-300/20 disabled:opacity-40"
                      onClick={() => void act(() => window.api?.motionsRedeem?.(m.id), `已解锁「${m.name}」✓`)}
                    >
                      ⭐ {m.cost} 兑换
                    </button>
                  ) : (
                    <button
                      disabled={busy}
                      className="rounded-lg border border-neon-cyan/30 bg-neon-cyan/10 px-2.5 py-1 text-xs text-neon-cyan hover:bg-neon-cyan/20 disabled:opacity-40"
                      onClick={() => void act(() => window.api?.motionsPlay?.(m.id))}
                    >
                      ▶ 播放
                    </button>
                  )}
                  {m.cost === 0 ? (
                    <button
                      disabled={busy}
                      className="rounded-lg border border-white/10 px-2 py-1 text-xs text-slate-500 hover:bg-white/5 disabled:opacity-40"
                      onClick={() => void act(() => window.api?.motionsRemove?.(m.id), '已删除')}
                    >
                      ✕
                    </button>
                  ) : null}
                </div>
              </div>
            )
          })}
          {points.ledger.length > 0 ? (
            <div className="mt-1 border-t border-white/[0.06] pt-2 text-2xs text-slate-500">
              最近流水：{points.ledger.slice(0, 3).map((e) => `${e.delta > 0 ? '+' : ''}${e.delta}(${e.reason === 'focus' ? '专注' : e.reason.split(':')[0]})`).join(' · ')}
            </div>
          ) : null}
        </div>
      ) : (
        <div className="mt-2 text-2xs leading-relaxed text-slate-500">
          还没有自定义动作。打开工坊，录一段 10 秒的舞蹈/手势，保存后桌宠就能做这个动作。专注工作会自动累积积分（1 分钟 = 1 积分）。
        </div>
      )}
      {tip ? <div className="mt-2 rounded-lg bg-neon-cyan/10 px-2.5 py-1.5 text-xs text-neon-cyan">{tip}</div> : null}
    </div>
  )
}
