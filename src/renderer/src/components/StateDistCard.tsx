export default function StateDistCard({ stateMinutes }: { stateMinutes: Record<string, number> }) {
  const sorted = Object.entries(stateMinutes ?? {}).sort((a,b) => b[1] - a[1]).slice(0, 5)
  return <div className="glass-card hoverable p-3 text-[11px]">{sorted.map(([s,m]) => <div key={s} className="flex justify-between text-slate-300"><span>{s}</span><span>{Math.round(m)}m</span></div>)}</div>
}
