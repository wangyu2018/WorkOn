export default function TopAppsCard({ apps }: { apps: Array<{app:string, minutes:number}> }) {
  return <div className="glass-card hoverable p-3 text-[11px]">{apps.slice(0,5).map(a => <div key={a.app} className="flex justify-between text-slate-300"><span>{a.app}</span><span>{Math.round(a.minutes)}m</span></div>)}</div>
}
