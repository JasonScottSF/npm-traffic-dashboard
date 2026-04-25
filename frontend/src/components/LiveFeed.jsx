import { useApi } from '../hooks/useApi'
import { formatDistanceToNow, parseISO } from 'date-fns'

const STATUS_COLOR = (s) => {
  if (s < 300) return 'bg-emerald-500/20 text-emerald-300'
  if (s < 400) return 'bg-sky-500/20 text-sky-300'
  if (s < 500) return 'bg-amber-500/20 text-amber-300'
  return 'bg-rose-500/20 text-rose-300'
}

const METHOD_COLOR = (m) => {
  const map = { GET: 'text-sky-400', POST: 'text-violet-400', PUT: 'text-amber-400', DELETE: 'text-rose-400', PATCH: 'text-emerald-400' }
  return map[m] || 'text-gray-400'
}

export default function LiveFeed() {
  const { data } = useApi('/live', {}, 3000)

  const summary = data?.summary
  const recent = data?.recent ?? []

  return (
    <div className="space-y-3">
      {summary && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center">
          {[
            { label: 'Req/min', value: (summary.requests_last_60s ?? 0).toLocaleString(), color: 'text-sky-400' },
            { label: 'Unique IPs', value: (summary.unique_ips ?? 0).toLocaleString(), color: 'text-violet-400' },
            { label: 'Bytes/min', value: fmtBytes(summary.bytes_last_60s), color: 'text-emerald-400' },
            { label: 'Errors/min', value: (summary.errors_last_60s ?? 0).toLocaleString(), color: 'text-rose-400' },
          ].map(({ label, value, color }) => (
            <div key={label} className="bg-gray-800/50 rounded-lg p-2">
              <div className={`text-lg font-bold ${color}`}>{value}</div>
              <div className="text-gray-500 text-xs">{label}</div>
            </div>
          ))}
        </div>
      )}

      <div className="space-y-1 max-h-64 overflow-y-auto pr-1">
        {recent.length === 0 ? (
          <div className="text-gray-600 text-sm text-center py-6">Waiting for traffic…</div>
        ) : recent.map((r, i) => (
          <div key={i} className="flex items-center gap-2 text-xs font-mono bg-gray-800/40 rounded px-2 py-1 hover:bg-gray-800/70 transition-colors">
            <span className={`shrink-0 font-bold ${METHOD_COLOR(r.method)}`}>{r.method}</span>
            <span className={`shrink-0 badge ${STATUS_COLOR(r.status)} px-1.5 py-0.5 rounded text-[10px]`}>{r.status}</span>
            <span className="text-sky-500 shrink-0">{r.host}</span>
            <span className="text-gray-400 truncate flex-1">{r.path}</span>
            <span className="text-gray-600 shrink-0">{r.ip}</span>
            {r.country && <span className="text-gray-500 shrink-0">{r.country}</span>}
            <span className="text-gray-700 shrink-0">{fmtBytes(r.bytes)}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function fmtBytes(b) {
  if (!b) return '0 B'
  if (b > 1e9) return `${(b / 1e9).toFixed(1)}G`
  if (b > 1e6) return `${(b / 1e6).toFixed(1)}M`
  if (b > 1e3) return `${(b / 1e3).toFixed(1)}K`
  return `${b}B`
}
