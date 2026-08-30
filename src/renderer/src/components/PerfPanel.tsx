import { useEffect, useState } from 'react'

interface PerfData {
  metrics: { pid: number; type: string; cpu: number; memoryMB: number; privateMB: number }[]
  modules: Record<string, unknown>
  totalMemoryMB: number
  totalCpu: number
}

const TYPE_LABEL: Record<string, string> = {
  Browser: '渲染',
  GPU: 'GPU',
  Utility: '工具',
  Zygote: 'Zygote',
  'GPU Process': 'GPU',
  'Network Service': '网络'
}

/** 开发者性能监控：各进程 CPU/内存 + 模块状态 */
export function PerfPanel() {
  const [data, setData] = useState<PerfData | null>(null)
  useEffect(() => {
    let alive = true
    const load = async () => {
      try {
        const d = (await window.api.getPerfStats()) as PerfData
        if (alive) setData(d)
      } catch { /* ignore */ }
    }
    void load()
    const t = setInterval(load, 2500)
    return () => { alive = false; clearInterval(t) }
  }, [])

  return (
    <div className="anim-fade-in mt-1 rounded-lg border border-white/[0.07] bg-white/[0.02] p-2.5">
      <div className="mb-2 flex items-center justify-between text-[11px]">
        <span className="font-medium text-slate-200">性能监控</span>
        <span className="text-slate-500 tabular-nums">
          总内存 <b className="text-neon-cyan">{data?.totalMemoryMB ?? '—'} MB</b> · 总 CPU <b className="text-neon-cyan">{data?.totalCpu ?? '—'}%</b>
        </span>
      </div>
      {data ? (
        <>
          <div className="flex flex-col gap-1">
            {data.metrics.map((m) => (
              <div key={m.pid} className="flex items-center gap-2 text-[10px]">
                <span className="w-14 shrink-0 text-slate-400">{TYPE_LABEL[m.type] ?? m.type}</span>
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/[0.06]">
                  <div className="h-full rounded-full" style={{ width: `${Math.min(100, m.cpu)}%`, background: m.cpu > 60 ? '#f43f5e' : m.cpu > 30 ? '#f59e0b' : '#22d3ee' }} />
                </div>
                <span className="w-16 shrink-0 text-right tabular-nums text-slate-400">CPU {m.cpu}%</span>
                <span className="w-14 shrink-0 text-right tabular-nums text-slate-500">{m.memoryMB}MB</span>
              </div>
            ))}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-white/[0.05] pt-1.5 text-[10px] text-slate-500">
            <span>监控：<b className="text-slate-300">{(data.modules.monitor as { running?: boolean; intervalMs?: number })?.running ? `开 · ${Math.round(((data.modules.monitor as { intervalMs?: number })?.intervalMs ?? 0) / 1000)}s` : '关'}</b></span>
            <span>深度OCR：<b className="text-slate-300">{data.modules.deepMode ? '开' : '关'}</b></span>
            <span>桌宠：<b className="text-slate-300">{data.modules.petEnabled ? '开' : '关'}</b></span>
            <span>悬浮窗：<b className="text-slate-300">{data.modules.widgetVisible ? '开' : '关'}</b></span>
            <span>AI：<b className="text-slate-300">{data.modules.aiEnabled ? '开' : '关'}</b></span>
          </div>
        </>
      ) : (
        <p className="text-[11px] text-slate-500">加载中…</p>
      )}
    </div>
  )
}
