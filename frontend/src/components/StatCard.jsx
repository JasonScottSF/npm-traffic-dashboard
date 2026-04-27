export default function StatCard({ label, value, sub, delta, color = 'sky', icon, onClick }) {
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
    <div
      className={`bg-gradient-to-br ${cls} border rounded-xl p-3 sm:p-4 flex flex-col gap-1.5 sm:gap-2 ${onClick ? 'cursor-pointer hover:brightness-125 transition-all' : ''}`}
      onClick={onClick}
    >
      <div className="flex items-center justify-between">
        <span className="text-[10px] sm:text-xs text-gray-400 uppercase tracking-widest font-semibold leading-tight">{label}</span>
        <div className="flex items-center gap-1">
          {icon && <span className="text-base sm:text-lg opacity-70">{icon}</span>}
          {onClick && <span className="text-gray-600 text-xs">↗</span>}
        </div>
      </div>
      <div className="text-xl sm:text-2xl font-bold text-white">{value ?? '—'}</div>
      <div className="flex items-center gap-2 flex-wrap">
        {sub   && <div className="text-[10px] sm:text-xs text-gray-400">{sub}</div>}
        {delta != null && (
          <div className={`text-[10px] font-mono font-semibold ${
            delta > 0 ? 'text-rose-400' : delta < 0 ? 'text-emerald-400' : 'text-gray-500'
          }`}>
            {delta > 0 ? `↑${delta.toFixed(1)}%` : delta < 0 ? `↓${Math.abs(delta).toFixed(1)}%` : '→'}
          </div>
        )}
      </div>
    </div>
  )
}
