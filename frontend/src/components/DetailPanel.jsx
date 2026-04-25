import { useEffect } from 'react'
import { useApi } from '../hooks/useApi'
import axios from 'axios'

function fmtBytes(b) {
  if (!b) return '0 B'
  if (b > 1e9) return `${(b / 1e9).toFixed(2)} GB`
  if (b > 1e6) return `${(b / 1e6).toFixed(1)} MB`
  if (b > 1e3) return `${(b / 1e3).toFixed(1)} KB`
  return `${b} B`
}

function fmtTime(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleString()
}

const STATUS_COLOR = s =>
  s < 300 ? 'text-emerald-400' : s < 400 ? 'text-sky-400' : s < 500 ? 'text-amber-400' : 'text-rose-400'

// ── Panel wrapper ──────────────────────────────────────────────────────────

function Panel({ title, subtitle, onClose, children }) {
  useEffect(() => {
    const handler = e => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-50 flex">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      {/* Drawer */}
      <div className="absolute right-0 top-0 bottom-0 w-full max-w-2xl bg-gray-950 border-l border-gray-800 flex flex-col shadow-2xl">
        <div className="flex items-start justify-between p-5 border-b border-gray-800 shrink-0">
          <div>
            <div className="font-bold text-white text-lg">{title}</div>
            {subtitle && <div className="text-gray-500 text-xs mt-0.5">{subtitle}</div>}
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-white text-xl leading-none ml-4">✕</button>
        </div>
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {children}
        </div>
      </div>
    </div>
  )
}

// ── Errors panel ───────────────────────────────────────────────────────────

function ErrorsPanel({ period, host, onClose }) {
  const { data, loading } = useApi('/errors', { period, ...(host ? { host } : {}) }, 15000)

  return (
    <Panel title="Error Log" subtitle={`4xx and 5xx responses — ${period}`} onClose={onClose}>
      {loading && <div className="text-gray-500 text-sm">Loading…</div>}
      <div className="space-y-1 font-mono text-xs">
        {data?.length === 0 && <div className="text-gray-600 text-center py-8">No errors in this period</div>}
        {data?.map((r, i) => (
          <div key={i} className="flex gap-2 items-start py-1.5 border-b border-gray-800/60 hover:bg-gray-800/30 px-1 rounded">
            <span className="text-gray-600 shrink-0 w-36">{new Date(r.ts).toLocaleString()}</span>
            <span className={`shrink-0 font-bold ${STATUS_COLOR(r.status)}`}>{r.status}</span>
            <span className="text-sky-500 shrink-0 max-w-[120px] truncate" title={r.host}>{r.host}</span>
            <span className="text-gray-300 flex-1 truncate" title={r.path}>{r.path}</span>
            <span className="text-gray-500 shrink-0">{r.ip}</span>
            {r.country && <span className="text-gray-600 shrink-0">{r.country}</span>}
          </div>
        ))}
      </div>
    </Panel>
  )
}

// ── Bots panel ─────────────────────────────────────────────────────────────

function BotsPanel({ period, host, onClose }) {
  const { data, loading, refetch } = useApi('/bots', { period, ...(host ? { host } : {}) }, 15000)

  async function ban(ip) {
    if (!confirm(`Ban ${ip} via fail2ban?`)) return
    try {
      await axios.post('/api/f2b/ban', { jail: 'npm-badbots', ip })
      alert(`${ip} banned.`)
      refetch()
    } catch (e) {
      alert(`Failed: ${e.response?.data?.detail || e.message}`)
    }
  }

  return (
    <Panel title="Bot Traffic" subtitle={`Detected bots — ${period}`} onClose={onClose}>
      {loading && <div className="text-gray-500 text-sm">Loading…</div>}
      {data?.length === 0 && <div className="text-gray-600 text-center py-8">No bots detected</div>}
      <div className="space-y-2">
        {data?.map((bot, i) => (
          <div key={i} className="border border-gray-800 rounded-xl p-3 hover:border-gray-700">
            <div className="flex items-center justify-between gap-2 mb-2">
              <div className="flex items-center gap-2">
                <span className="font-mono text-amber-300 text-sm">{bot.ip}</span>
                {bot.country && <span className="text-gray-500 text-xs">{bot.country}</span>}
              </div>
              <div className="flex items-center gap-3">
                <span className="text-xs text-gray-400">{bot.requests.toLocaleString()} req</span>
                <span className="text-xs text-gray-500">{fmtBytes(bot.bytes)}</span>
                <button
                  onClick={() => ban(bot.ip)}
                  className="text-xs px-2.5 py-1 bg-rose-500/20 text-rose-300 hover:bg-rose-500/40 rounded-lg transition-colors"
                >
                  Block IP
                </button>
              </div>
            </div>
            {bot.user_agents?.map((ua, j) => (
              <div key={j} className="text-xs text-gray-600 truncate font-mono">{ua}</div>
            ))}
            <div className="text-xs text-gray-700 mt-1">Last seen: {fmtTime(bot.last_seen)}</div>
          </div>
        ))}
      </div>
    </Panel>
  )
}

// ── Unique Visitors panel ──────────────────────────────────────────────────

function VisitorsPanel({ period, host, onClose }) {
  const { data, loading } = useApi('/unique_visitors', { period, ...(host ? { host } : {}) }, 30000)

  return (
    <Panel title="Unique Visitors" subtitle={`Human traffic — ${period}`} onClose={onClose}>
      {loading && <div className="text-gray-500 text-sm">Loading…</div>}
      <div className="space-y-1 font-mono text-xs">
        {data?.map((v, i) => (
          <div key={i} className="flex gap-2 items-center py-1.5 border-b border-gray-800/60">
            <span className="text-gray-600 w-5 text-right shrink-0">{i + 1}</span>
            <span className="text-sky-400 shrink-0 w-32 truncate">{v.ip}</span>
            {v.country && <span className="text-gray-500 shrink-0 w-6">{v.country}</span>}
            <span className="text-violet-400 shrink-0 truncate max-w-[100px]">{v.browser}</span>
            <span className="text-gray-600 shrink-0">{v.device}</span>
            <span className="flex-1" />
            <span className="text-gray-300 shrink-0">{v.requests.toLocaleString()} req</span>
            <span className="text-gray-500 shrink-0">{fmtBytes(v.bytes)}</span>
          </div>
        ))}
      </div>
    </Panel>
  )
}

// ── Bandwidth panel ────────────────────────────────────────────────────────

function BandwidthPanel({ period, onClose }) {
  const { data, loading } = useApi('/bandwidth_detail', { period }, 30000)
  const max = data?.[0]?.bytes ?? 1

  return (
    <Panel title="Bandwidth by Host" subtitle={period} onClose={onClose}>
      {loading && <div className="text-gray-500 text-sm">Loading…</div>}
      <div className="space-y-3">
        {data?.map((row, i) => (
          <div key={i}>
            <div className="flex justify-between text-sm mb-1">
              <span className="text-gray-300 truncate">{row.host}</span>
              <div className="flex gap-3 shrink-0 ml-2">
                <span className="text-emerald-400 font-mono">{fmtBytes(row.bytes)}</span>
                <span className="text-gray-500">{row.requests.toLocaleString()} req</span>
              </div>
            </div>
            <div className="w-full bg-gray-800 rounded-full h-2">
              <div className="h-2 rounded-full bg-emerald-500" style={{ width: `${(row.bytes / max) * 100}%` }} />
            </div>
          </div>
        ))}
      </div>
    </Panel>
  )
}

// ── Requests panel ─────────────────────────────────────────────────────────

function RequestsPanel({ period, host, onClose }) {
  const { data } = useApi('/top_paths', { period, ...(host ? { host } : {}), limit: 50 }, 30000)
  const max = data?.[0]?.requests ?? 1

  return (
    <Panel title="Top Requests" subtitle={`By path — ${period}`} onClose={onClose}>
      <div className="space-y-2 font-mono text-xs">
        {data?.map((row, i) => (
          <div key={i}>
            <div className="flex justify-between mb-0.5">
              <span className="text-gray-300 truncate flex-1" title={row.path}>{i + 1}. {row.path}</span>
              <span className="text-sky-400 shrink-0 ml-2">{row.requests.toLocaleString()}</span>
            </div>
            <div className="w-full bg-gray-800 rounded-full h-1.5">
              <div className="h-1.5 rounded-full bg-sky-500" style={{ width: `${(row.requests / max) * 100}%` }} />
            </div>
          </div>
        ))}
      </div>
    </Panel>
  )
}

// ── Hosts panel ────────────────────────────────────────────────────────────

function HostsPanel({ period, onClose }) {
  const { data } = useApi('/top_hosts', { period }, 30000)

  return (
    <Panel title="Proxy Hosts" subtitle={`Traffic breakdown — ${period}`} onClose={onClose}>
      <div className="space-y-3">
        {data?.map((h, i) => (
          <div key={i} className="border border-gray-800 rounded-xl p-4">
            <div className="font-semibold text-sky-400 mb-2">{h.host}</div>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <div><span className="text-gray-500">Requests: </span><span className="text-white">{h.requests?.toLocaleString()}</span></div>
              <div><span className="text-gray-500">Bandwidth: </span><span className="text-white">{fmtBytes(h.bytes)}</span></div>
              <div><span className="text-gray-500">Unique IPs: </span><span className="text-white">{h.unique_visitors?.toLocaleString()}</span></div>
              <div><span className="text-gray-500">Errors: </span><span className={h.errors > 0 ? 'text-rose-400' : 'text-white'}>{h.errors?.toLocaleString()}</span></div>
            </div>
          </div>
        ))}
      </div>
    </Panel>
  )
}

// ── Router ─────────────────────────────────────────────────────────────────

export default function DetailPanel({ type, period, host, onClose }) {
  if (!type) return null
  const props = { period, host, onClose }
  switch (type) {
    case 'errors':    return <ErrorsPanel {...props} />
    case 'bots':      return <BotsPanel {...props} />
    case 'visitors':  return <VisitorsPanel {...props} />
    case 'bandwidth': return <BandwidthPanel {...props} />
    case 'requests':  return <RequestsPanel {...props} />
    case 'hosts':     return <HostsPanel {...props} />
    default:          return null
  }
}
