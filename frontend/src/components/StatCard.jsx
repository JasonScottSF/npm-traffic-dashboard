export default function StatCard({ label, value, sub, color = 'sky', icon }) {
  const colors = {
    sky:    'from-sky-500/20 to-sky-600/5 border-sky-500/30 text-sky-400',
    violet: 'from-violet-500/20 to-violet-600/5 border-violet-500/30 text-violet-400',
    emerald:'from-emerald-500/20 to-emerald-600/5 border-emerald-500/30 text-emerald-400',
    rose:   'from-rose-500/20 to-rose-600/5 border-rose-500/30 text-rose-400',
    amber:  'from-amber-500/20 to-amber-600/5 border-amber-500/30 text-amber-400',
    fuchsia:'from-fuchsia-500/20 to-fuchsia-600/5 border-fuchsia-500/30 text-fuchsia-400',
    cyan:   'from-cyan-500/20 to-cyan-600/5 border-cyan-500/30 text-cyan-400',
    orange: 'from-orange-500/20 to-orange-600/5 border-orange-500/30 text-orange-400',
  }
  const cls = colors[color] || colors.sky

  return (
    <div className={`bg-gradient-to-br ${cls} border rounded-xl p-4 flex flex-col gap-2`}>
      <div className="flex items-center justify-between">
        <span className="text-xs text-gray-400 uppercase tracking-widest font-semibold">{label}</span>
        {icon && <span className="text-lg opacity-70">{icon}</span>}
      </div>
      <div className="text-2xl font-bold text-white">{value ?? '—'}</div>
      {sub && <div className="text-xs text-gray-400">{sub}</div>}
    </div>
  )
}
