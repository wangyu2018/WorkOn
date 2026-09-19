/**
 * Widget Kit（v7）：监控浮窗 × 待办小组件共用零件
 * 极简、无品牌、token 驱动、明暗自适应
 */

/** 状态圆点：13px 状态色 + 呼吸光（替代大圆环） */
export function StateDot({ color, size = 13, pulsing = true }: { color: string; size?: number; pulsing?: boolean }) {
  return (
    <span
      className="inline-block shrink-0 rounded-full"
      style={{
        width: size,
        height: size,
        background: color,
        boxShadow: pulsing ? `0 0 8px ${color}88` : 'none',
        animation: pulsing ? 'wkd-breath 2.4s ease-in-out infinite' : undefined
      }}
    />
  )
}

/** ⚡链路芯片：teal-soft 底 */
export function ChainChip({ sec, interruptions }: { sec: number; interruptions?: number }) {
  const m = Math.max(1, Math.round(sec / 60))
  return (
    <span className="shrink-0 rounded-full bg-[var(--teal-soft)] px-1.5 py-0.5 text-[9px] font-bold tabular-nums text-[var(--teal-deep)]">
      ⚡ {m}m{interruptions ? ` · 断${interruptions}` : ''}
    </span>
  )
}

/** 归属颗粒：「项目 · 任务」+ 实时时长 */
export function GrainChip({ projectName, taskTitle, sec }: { projectName: string; taskTitle?: string; sec?: number }) {
  return (
    <span className="flex min-w-0 items-center gap-1">
      <span className="shrink-0 text-[var(--violet)]">◈</span>
      <span className="min-w-0 truncate text-[11px] text-slate-200">
        {projectName}
        {taskTitle ? <span className="text-slate-400"> · {taskTitle}</span> : null}
      </span>
      {sec && sec > 30 ? <span className="shrink-0 text-[10px] tabular-nums text-slate-500">{Math.max(1, Math.round(sec / 60))}m</span> : null}
    </span>
  )
}

/** 分区细线（待办组件三分区同款） */
export function SectionDivider({ label }: { label?: string }) {
  return (
    <div className="my-1.5 border-t border-[var(--line)] pt-1.5 text-[10px] uppercase tracking-wider text-slate-600">
      {label}
    </div>
  )
}

/** 萤火虫光晕包裹层：有待确认信息时 violet 缓脉（3s 周期，不刺眼） */
export function Firefly({ active, children }: { active: boolean; children: React.ReactNode }) {
  if (!active) return <>{children}</>
  // 不用外扩 box-shadow：Windows 透明窗上阴影的矩形包围盒会变成半透明底框
  return (
    <div className="wkd-firefly relative h-full w-full min-h-0">
      {children}
      <style>{`
        .wkd-firefly { animation: wkd-fire 6s ease-in-out infinite; border-radius: inherit; }
        @keyframes wkd-fire {
          0%, 100% { filter: brightness(1); }
          42%, 58% { filter: brightness(1.12); }
        }
      `}</style>
    </div>
  )
}

// 呼吸动效注入（一次）
if (typeof document !== 'undefined' && !document.getElementById('wkd-breath-style')) {
  const el = document.createElement('style')
  el.id = 'wkd-breath-style'
  el.textContent = `@keyframes wkd-breath { 0%,100% { opacity: 1; } 50% { opacity: .55; } }`
  document.head.appendChild(el)
}
