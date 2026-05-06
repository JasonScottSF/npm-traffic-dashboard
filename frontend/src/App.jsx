import { useState, useEffect } from 'react'
import { useApi } from './hooks/useApi'
import axios from 'axios'
import { useTZ, TIMEZONES } from './contexts/TZContext'
import { useTheme } from './contexts/ThemeContext'
import StatCard from './components/StatCard'
import TrafficChart from './components/TrafficChart'
import StatusChart from './components/StatusChart'
import HeatMap from './components/HeatMap'
import TopTable from './components/TopTable'
import LiveFeed from './components/LiveFeed'
import BrowserDonut from './components/BrowserDonut'
import SecurityTab from './components/SecurityTab'
import WAFTab from './components/WAFTab'
import WAFTestTab from './components/WAFTestTab'
import HostTab from './components/HostTab'
import OpsTab from './components/OpsTab'
import DetailPanel from './components/DetailPanel'
import UserManagement from './components/UserManagement'

const PERIODS = [
  { label: '24h', value: '24h' },
  { label: '3d',  value: '3d' },
  { label: '7d',  value: '7d' },
  { label: '30d', value: '30d' },
  { label: '90d', value: '90d' },
  { label: '180d',value: '180d' },
  { label: '360d',value: '360d' },
]

function fmtBytes(b) {
  if (!b) return '0 B'
  if (b > 1e12) return `${(b / 1e12).toFixed(2)} TB`
  if (b > 1e9)  return `${(b / 1e9).toFixed(2)} GB`
  if (b > 1e6)  return `${(b / 1e6).toFixed(1)} MB`
  if (b > 1e3)  return `${(b / 1e3).toFixed(1)} KB`
  return `${b} B`
}

function downloadUrl(url, filename) {
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
}

function pct(a, b) {
  if (!b) return '—'
  return `${((a / b) * 100).toFixed(1)}%`
}

function fmtMs(ms) {
  if (ms == null) return '—'
  if (ms >= 1000) return `${(ms / 1000).toFixed(1)}s`
  return `${Math.round(ms)}ms`
}

function latencyColor(ms) {
  if (ms == null) return 'text-gray-600'
  if (ms > 2000)  return 'text-rose-400'
  if (ms > 500)   return 'text-amber-400'
  return 'text-emerald-400'
}

function TopIpRow({ row, i }) {
  const [banState, setBanState] = useState('idle') // idle | confirm | banning | done | error
  const org = row.org ?? ''

  async function doBan() {
    setBanState('banning')
    try {
      await axios.post('/api/f2b/manual/ban', { ip: row.ip })
      setBanState('done')
    } catch {
      setBanState('error')
    }
  }

  return (
    <div className="flex items-center gap-2 text-xs py-1.5 border-b border-gray-800 last:border-0">
      <span className="text-gray-600 w-4 text-right shrink-0">{i + 1}</span>
      <span className="font-mono text-sky-400 w-28 shrink-0">{row.ip}</span>
      <span className="text-gray-500 flex-1 truncate min-w-0" title={org}>
        {org || <span className="text-gray-700">—</span>}
      </span>
      {row.country_code && <span className="text-gray-600 shrink-0">{row.country_code}</span>}
      {row.is_bot && <span className="badge bg-amber-500/20 text-amber-300 shrink-0 text-[10px]">bot</span>}
      <span className="text-gray-300 font-mono shrink-0 w-12 text-right">{row.requests?.toLocaleString()}</span>

      {/* 2-click ban */}
      {banState === 'idle' && (
        <button
          onClick={() => setBanState('confirm')}
          title="Block this IP"
          className="text-gray-700 hover:text-rose-400 transition-colors shrink-0 text-base leading-none"
        >🚫</button>
      )}
      {banState === 'confirm' && (
        <span className="flex items-center gap-1 shrink-0">
          <button onClick={doBan} className="text-rose-400 hover:text-rose-300 font-bold px-1 rounded bg-rose-500/10 border border-rose-500/30 text-[10px]">Ban ✓</button>
          <button onClick={() => setBanState('idle')} className="text-gray-500 hover:text-gray-300 text-[10px]">✕</button>
        </span>
      )}
      {banState === 'banning' && <span className="text-gray-500 text-[10px] shrink-0">banning…</span>}
      {banState === 'done'    && <span className="text-emerald-400 text-[10px] shrink-0">✓ banned</span>}
      {banState === 'error'   && <span className="text-rose-400 text-[10px] shrink-0">failed</span>}
    </div>
  )
}

const STATUS_COLOR = s => s >= 500 ? 'text-rose-400' : s >= 400 ? 'text-amber-400' : s >= 300 ? 'text-sky-400' : 'text-emerald-400'

function IpErrorTable({ rows, period }) {
  const [openIp,    setOpenIp]    = useState(null)
  const [errors,    setErrors]    = useState(null)
  const [loadingIp, setLoadingIp] = useState(null)

  async function drillErrors(ip) {
    if (openIp === ip) { setOpenIp(null); setErrors(null); return }
    setOpenIp(ip)
    setLoadingIp(ip)
    try {
      const { data } = await axios.get('/api/ip_errors', { params: { ip, period } })
      setErrors(data)
    } catch { setErrors([]) }
    finally { setLoadingIp(null) }
  }

  return (
    <table className="w-full text-[11px]">
      <thead className="sticky top-0 bg-gray-900">
        <tr className="text-gray-600 border-b border-gray-800 uppercase tracking-wider text-left">
          <th className="px-2 py-1.5 font-medium">IP</th>
          <th className="px-2 py-1.5 font-medium text-right">Reqs</th>
          <th className="px-2 py-1.5 font-medium text-right">Errors</th>
          <th className="px-2 py-1.5 font-medium text-right">Paths</th>
          <th className="px-2 py-1.5 font-medium">Last Seen</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((d, j) => (
          <>
          <tr key={j} className={`border-b border-gray-800/40 last:border-0 hover:bg-gray-800/20 ${openIp === d.ip ? 'bg-rose-900/10' : ''}`}>
            <td className="px-2 py-1.5 font-mono text-gray-300">{d.ip}</td>
            <td className="px-2 py-1.5 text-right tabular-nums text-gray-400">{d.requests.toLocaleString()}</td>
            <td className="px-2 py-1.5 text-right tabular-nums">
              {d.errors > 0 ? (
                <button
                  onClick={() => drillErrors(d.ip)}
                  className={`tabular-nums rounded px-1.5 py-0.5 transition-colors ${
                    openIp === d.ip
                      ? 'bg-rose-500/30 text-rose-300 ring-1 ring-rose-500/40'
                      : 'text-rose-400 hover:bg-rose-500/20'
                  }`}
                >
                  {loadingIp === d.ip ? '…' : d.errors}
                </button>
              ) : (
                <span className="text-gray-700">0</span>
              )}
            </td>
            <td className="px-2 py-1.5 text-right tabular-nums text-gray-500">{d.paths}</td>
            <td className="px-2 py-1.5 text-gray-600 whitespace-nowrap">{new Date(d.last_seen).toLocaleTimeString()}</td>
          </tr>
          {openIp === d.ip && (
            <tr key={`${j}-errors`}>
              <td colSpan={5} className="px-0 pb-2">
                {!errors?.length ? (
                  <div className="text-xs text-gray-600 text-center py-2">No errors found</div>
                ) : (
                  <div className="max-h-48 overflow-y-auto mx-2 rounded-lg border border-rose-900/30">
                    <table className="w-full text-[10px]">
                      <thead className="sticky top-0 bg-gray-950">
                        <tr className="text-gray-600 border-b border-gray-800 uppercase tracking-wider text-left">
                          <th className="px-2 py-1 font-medium">Time</th>
                          <th className="px-2 py-1 font-medium">Site</th>
                          <th className="px-2 py-1 font-medium">Method</th>
                          <th className="px-2 py-1 font-medium">Path</th>
                          <th className="px-2 py-1 font-medium">Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {errors.map((e, k) => (
                          <tr key={k} className="border-b border-gray-800/40 last:border-0 hover:bg-gray-800/20">
                            <td className="px-2 py-1 text-gray-600 whitespace-nowrap">{new Date(e.ts).toLocaleTimeString()}</td>
                            <td className="px-2 py-1 font-mono text-sky-400 max-w-[100px] truncate" title={e.host}>{e.host}</td>
                            <td className="px-2 py-1 text-gray-500">{e.method}</td>
                            <td className="px-2 py-1 font-mono text-gray-300 max-w-[180px] truncate" title={e.path}>{e.path}</td>
                            <td className={`px-2 py-1 font-mono font-bold ${STATUS_COLOR(e.status)}`}>{e.status}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </td>
            </tr>
          )}
          </>
        ))}
      </tbody>
    </table>
  )
}

const FLAG = cc => cc && cc !== 'XX'
  ? String.fromCodePoint(...[...cc.toUpperCase()].map(c => 0x1F1E6 - 65 + c.charCodeAt(0)))
  : '🌐'

function CountryTable({ rows, valueKey = 'requests', color = 'bg-sky-500', period }) {
  const [selected, setSelected] = useState(null)
  const [detail,   setDetail]   = useState(null)
  const [loading,  setLoading]  = useState(false)

  async function drill(cc) {
    if (selected === cc) { setSelected(null); setDetail(null); return }
    setSelected(cc)
    setLoading(true)
    try {
      const { data } = await axios.get('/api/country_detail', { params: { country: cc, period } })
      setDetail(data)
    } catch { setDetail([]) }
    finally { setLoading(false) }
  }

  return (
    <div className="space-y-1">
      {(rows ?? []).map((r, i) => {
        const cc    = r.country_code
        const val   = r[valueKey] ?? 0
        const max   = rows[0]?.[valueKey] || 1
        const pct   = Math.round((val / max) * 100)
        const isOpen = selected === cc
        return (
          <div key={cc}>
            <button
              onClick={() => drill(cc)}
              className={`w-full text-left rounded-lg px-2 py-1.5 transition-colors ${isOpen ? 'bg-sky-900/20 ring-1 ring-sky-500/30' : 'hover:bg-gray-800/50'}`}
            >
              <div className="flex items-center gap-2 text-xs">
                <span className="text-gray-500 w-4 shrink-0 text-right">{i + 1}</span>
                <span className="text-base shrink-0">{FLAG(cc)}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-gray-300">{cc}</span>
                    <span className="tabular-nums text-gray-400 shrink-0">{val.toLocaleString()}</span>
                  </div>
                  <div className="mt-1 h-0.5 bg-gray-800 rounded-full overflow-hidden">
                    <div className={`h-full ${color} rounded-full`} style={{ width: `${pct}%` }} />
                  </div>
                </div>
                <span className={`text-gray-600 text-[10px] shrink-0 transition-transform ${isOpen ? 'rotate-180' : ''}`}>▾</span>
              </div>
            </button>

            {isOpen && (
              <div className="mt-1 mb-2 ml-6 rounded-lg border border-sky-900/30 overflow-hidden">
                {loading ? (
                  <div className="text-xs text-gray-600 text-center py-3">Loading…</div>
                ) : !detail?.length ? (
                  <div className="text-xs text-gray-600 text-center py-3">No IPs found</div>
                ) : (
                  <div className="max-h-64 overflow-y-auto">
                    <IpErrorTable rows={detail} period={period} />
                  </div>
                )}
              </div>
            )}
          </div>
        )
      })}
      {!rows?.length && <div className="text-gray-600 text-sm text-center py-4">No country data</div>}
    </div>
  )
}

function RefererTable({ rows, period, color = 'bg-fuchsia-500' }) {
  const [selected, setSelected] = useState(null)
  const [detail,   setDetail]   = useState(null)
  const [loading,  setLoading]  = useState(false)

  async function drill(referer) {
    if (selected === referer) { setSelected(null); setDetail(null); return }
    setSelected(referer)
    setLoading(true)
    try {
      const { data } = await axios.get('/api/referer_detail', { params: { referer, period } })
      setDetail(data)
    } catch { setDetail([]) }
    finally { setLoading(false) }
  }

  const STATUS_COLOR = s => s >= 500 ? 'text-rose-400' : s >= 400 ? 'text-amber-400' : s >= 300 ? 'text-sky-400' : 'text-emerald-400'

  return (
    <div className="space-y-1">
      {(rows ?? []).map((r, i) => {
        const max = rows[0]?.requests || 1
        const pct = Math.round((r.requests / max) * 100)
        const isOpen = selected === r.referer
        return (
          <div key={i}>
            <button
              onClick={() => drill(r.referer)}
              className={`w-full text-left rounded-lg px-2 py-1.5 transition-colors group ${isOpen ? 'bg-fuchsia-900/20 ring-1 ring-fuchsia-500/30' : 'hover:bg-gray-800/50'}`}
            >
              <div className="flex items-center gap-2 text-xs">
                <span className="text-gray-500 w-4 shrink-0 text-right">{i + 1}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-gray-300 truncate text-[11px]" title={r.referer}>{r.referer}</span>
                    <span className="tabular-nums text-gray-400 shrink-0">{r.requests.toLocaleString()}</span>
                  </div>
                  <div className="mt-1 h-0.5 bg-gray-800 rounded-full overflow-hidden">
                    <div className={`h-full ${color} rounded-full`} style={{ width: `${pct}%` }} />
                  </div>
                </div>
                <span className={`text-gray-600 text-[10px] shrink-0 transition-transform ${isOpen ? 'rotate-180' : ''}`}>▾</span>
              </div>
            </button>

            {isOpen && (
              <div className="mt-1 mb-2 ml-6 rounded-lg border border-fuchsia-900/30 overflow-hidden">
                {loading ? (
                  <div className="text-xs text-gray-600 text-center py-3">Loading…</div>
                ) : !detail?.length ? (
                  <div className="text-xs text-gray-600 text-center py-3">No requests found</div>
                ) : (
                  <div className="overflow-x-auto max-h-64 overflow-y-auto">
                    <table className="w-full text-[11px]">
                      <thead className="sticky top-0 bg-gray-900">
                        <tr className="text-gray-600 border-b border-gray-800 uppercase tracking-wider text-left">
                          <th className="px-2 py-1.5 font-medium">Time</th>
                          <th className="px-2 py-1.5 font-medium">Site</th>
                          <th className="px-2 py-1.5 font-medium">Path</th>
                          <th className="px-2 py-1.5 font-medium">IP</th>
                          <th className="px-2 py-1.5 font-medium">Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {detail.map((d, j) => (
                          <tr key={j} className="border-b border-gray-800/40 last:border-0 hover:bg-gray-800/20">
                            <td className="px-2 py-1.5 text-gray-600 whitespace-nowrap">{new Date(d.ts).toLocaleTimeString()}</td>
                            <td className="px-2 py-1.5 font-mono text-sky-400 max-w-[120px] truncate" title={d.host}>{d.host}</td>
                            <td className="px-2 py-1.5 font-mono text-gray-300 max-w-[200px] truncate" title={d.path}>{d.path}</td>
                            <td className="px-2 py-1.5 font-mono text-gray-400 whitespace-nowrap">{d.ip}</td>
                            <td className={`px-2 py-1.5 font-mono ${STATUS_COLOR(d.status)}`}>{d.status}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
          </div>
        )
      })}
      {!rows?.length && <div className="text-gray-600 text-sm text-center py-4">No referrer data</div>}
    </div>
  )
}

function Section({ title, children, className = '' }) {
  return (
    <div className={`card ${className}`}>
      <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-widest mb-4">{title}</h2>
      {children}
    </div>
  )
}

const TABS = ['overview', 'traffic', 'visitors', 'geo', 'tech', 'security', 'ops']

export default function App() {
  const [period, setPeriod]       = useState('24h')
  const [host, setHost]           = useState('')
  const [tab, setTab]             = useState('overview')
  const [activePanel, setPanel]   = useState(null)
  const [showUsers, setShowUsers] = useState(false)
  const [me, setMe] = useState(null)
  const { tz, setTz } = useTZ()
  const { theme, toggle: toggleTheme } = useTheme()

  const [breachCount, setBreachCount] = useState(0)
  const [newHosts, setNewHosts]       = useState([])

  useEffect(() => {
    axios.get('/auth/api/me').then(r => setMe(r.data)).catch(() => {})
  }, [])

  useEffect(() => {
    const load = () => axios.get('/api/breach/stats').then(r => setBreachCount(r.data?.total ?? 0)).catch(() => {})
    load()
    const t = setInterval(load, 30000)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    const load = () => axios.get('/api/new_hosts').then(r => setNewHosts(r.data ?? [])).catch(() => {})
    load()
    const t = setInterval(load, 120000)
    return () => clearInterval(t)
  }, [])

  function dismissHost(host) {
    axios.post(`/api/new_hosts/${encodeURIComponent(host)}/dismiss`).catch(() => {})
    setNewHosts(h => h.filter(x => x.host !== host))
  }

  const p = { period, ...(host ? { host } : {}) }

  const { data: summary }   = useApi('/summary',      p, 15000)
  const { data: timeseries }= useApi('/timeseries',   p, 30000)
  const { data: hosts }     = useApi('/hosts',        {}, 60000)
  const { data: topHosts }       = useApi('/top_hosts',          { period }, 30000)
  const { data: topPaths }       = useApi('/top_paths',          p, 30000)
  const { data: topPathsByHost } = useApi('/top_paths_by_host',  { period }, 30000)
  const { data: statuses }  = useApi('/status_codes', p, 30000)
  const { data: countries } = useApi('/top_countries',p, 30000)
  const { data: referers }  = useApi('/top_referers', p, 30000)
  const { data: browsers }  = useApi('/browsers',     p, 30000)
  const { data: heatmap }   = useApi('/heatmap',      p, 60000)
  const { data: topIps }    = useApi('/top_ips',      p, 30000)
  const { data: latency }   = useApi('/latency',      p, 60000)
  const { data: slowReqs }  = useApi('/slow_requests', p, 60000)

  const errorRate = summary ? pct(summary.error_count, summary.total_requests) : '—'
  const botRate   = summary ? pct(summary.bot_count, summary.total_requests) : '—'

  const isTrafficTab = !['security', 'host'].includes(tab)

  return (
    <div className="min-h-screen bg-gray-950">
      <header className="border-b border-gray-800 bg-gray-900/80 backdrop-blur sticky top-0 z-20">
        <div className="max-w-screen-2xl mx-auto px-4 py-3 flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 mr-4">
            <span className="text-xl">📡</span>
            <span className="font-bold text-white">NPM Dashboard</span>
          </div>
          <div className="flex items-center gap-1.5 text-xs text-emerald-400">
            <span className="w-2 h-2 rounded-full bg-emerald-400 live-dot" />
            Live
          </div>
          <div className="flex-1" />

          <button
            onClick={toggleTheme}
            className="text-lg leading-none p-1.5 rounded-lg bg-gray-800 hover:bg-gray-700 transition-colors"
            title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          >
            {theme === 'dark' ? '☀️' : '🌙'}
          </button>

          <select
            value={tz}
            onChange={e => setTz(e.target.value)}
            className="hidden sm:block bg-gray-800 border border-gray-700 rounded-lg px-2.5 py-1.5 text-xs text-gray-300 focus:outline-none focus:border-sky-500"
            title="Display timezone"
          >
            {TIMEZONES.map(t => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>

          {me && (
            <div className="flex items-center gap-2">
              {me.role === 'admin' && (
                <button
                  onClick={() => setShowUsers(true)}
                  className="text-xs px-2.5 py-1.5 bg-gray-800 text-gray-400 hover:text-white hover:bg-gray-700 rounded-lg transition-colors"
                  title="Manage users"
                >
                  👥 Users
                </button>
              )}
              <span className="hidden sm:inline text-xs text-gray-500">{me.username}</span>
              <a
                href="/auth/logout"
                className="text-xs px-2.5 py-1.5 bg-gray-800 text-gray-400 hover:text-white hover:bg-gray-700 rounded-lg transition-colors"
              >
                Sign out
              </a>
            </div>
          )}

          {isTrafficTab && hosts?.length > 0 && (
            <select
              value={host}
              onChange={e => setHost(e.target.value)}
              className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-gray-200 focus:outline-none focus:border-sky-500"
            >
              <option value="">All hosts</option>
              {hosts.map(h => <option key={h} value={h}>{h}</option>)}
            </select>
          )}

          {isTrafficTab && (
            <div className="flex bg-gray-800 rounded-lg p-0.5 gap-0.5">
              {PERIODS.map(p => (
                <button
                  key={p.value}
                  onClick={() => setPeriod(p.value)}
                  className={`px-1.5 sm:px-2.5 py-1 rounded-md text-xs font-medium transition-colors
                    ${period === p.value ? 'bg-sky-500 text-white' : 'text-gray-400 hover:text-white'}`}
                >
                  {p.label}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="max-w-screen-2xl mx-auto border-t border-gray-800/60">
          <div className="flex gap-0.5 overflow-x-auto scrollbar-hide px-3 sm:px-4">
            {TABS.map(t => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`relative shrink-0 px-3 sm:px-4 py-2 text-sm font-medium capitalize transition-colors border-b-2 whitespace-nowrap
                  ${tab === t ? 'border-sky-500 text-sky-400' : 'border-transparent text-gray-500 hover:text-gray-300'}`}
              >
                {t === 'security' ? 'Security' : t === 'host' ? 'Host' : t}
                {t === 'security' && breachCount > 0 && (
                  <span className="absolute -top-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-purple-500 text-white text-[9px] font-bold leading-none">
                    {breachCount > 9 ? '9+' : breachCount}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
      </header>

      <main className="max-w-screen-2xl mx-auto px-3 sm:px-4 py-4 sm:py-6 space-y-4 sm:space-y-6">

        {/* New host alert banner */}
        {newHosts.length > 0 && (
          <div className="bg-sky-500/10 border border-sky-500/30 rounded-xl px-4 py-3 space-y-2">
            <div className="flex items-center gap-2">
              <span className="text-sky-400 font-semibold text-sm">🆕 New proxy host{newHosts.length > 1 ? 's' : ''} detected</span>
              <span className="text-xs text-gray-500">— first time appearing in traffic logs</span>
            </div>
            <div className="flex flex-wrap gap-2">
              {newHosts.map(h => (
                <span key={h.host} className="inline-flex items-center gap-2 px-3 py-1.5 bg-gray-900 border border-sky-500/20 rounded-lg text-xs">
                  <span className="font-mono text-sky-300">{h.host}</span>
                  <span className="text-gray-600">{new Date(h.first_seen).toLocaleDateString()}</span>
                  <button
                    onClick={() => dismissHost(h.host)}
                    className="text-gray-600 hover:text-gray-300 transition-colors leading-none"
                    title="Dismiss"
                  >✕</button>
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Stat cards + export — traffic tabs only */}
        {isTrafficTab && (
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2 sm:gap-3">
            <StatCard label="Requests"        value={summary?.total_requests?.toLocaleString()} delta={summary?.delta_requests} color="sky"     icon="📊" onClick={() => setPanel('requests')} />
            <StatCard label="Unique Visitors" value={summary?.unique_visitors?.toLocaleString()}                               color="violet"  icon="👤" onClick={() => setPanel('visitors')} />
            <StatCard label="Bandwidth"       value={fmtBytes(summary?.total_bytes)}           delta={summary?.delta_bytes}    color="emerald" icon="📦" onClick={() => setPanel('bandwidth')} />
            <StatCard label="Errors"          value={summary?.error_count?.toLocaleString()} sub={errorRate} delta={summary?.delta_errors != null ? -summary.delta_errors : null} color="rose"    icon="⚠️" onClick={() => setPanel('errors')} />
            <StatCard label="Bots"            value={summary?.bot_count?.toLocaleString()}   sub={botRate}   delta={summary?.delta_bots   != null ? -summary.delta_bots   : null} color="amber"   icon="🤖" onClick={() => setPanel('bots')} />
            <StatCard label="Hosts"           value={summary?.host_count?.toLocaleString()}                  color="fuchsia" icon="🌐" onClick={() => setPanel('hosts')} />
            <StatCard label="Avg Size"        value={fmtBytes(summary?.avg_bytes)}                           color="cyan"    icon="📏" />
            <StatCard label="Period"          value={period}                                                  color="orange"  icon="🕐" />
          </div>
        )}

        {/* Traffic export */}
        {isTrafficTab && (
          <div className="flex justify-end">
            <button
              onClick={() => downloadUrl(`/api/export/traffic.csv?period=${period}${host ? `&host=${encodeURIComponent(host)}` : ''}`, `traffic-${period}.csv`)}
              className="text-xs px-3 py-1.5 bg-gray-800 text-gray-400 hover:text-white hover:bg-gray-700 border border-gray-700 rounded-lg transition-colors flex items-center gap-1.5"
            >
              ⬇ Export CSV
            </button>
          </div>
        )}

        {tab === 'overview' && (
          <>
            <Section title="Traffic Over Time">
              <TrafficChart data={timeseries} period={period} />
            </Section>
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              <Section title="Status Codes">
                <StatusChart data={statuses} />
              </Section>
              <Section title="Top Hosts" className="lg:col-span-2">
                <TopTable rows={topHosts} labelKey="host" valueKey="requests" color="bg-sky-500" />
              </Section>
            </div>
            <Section title="Live Request Feed">
              <LiveFeed />
            </Section>
          </>
        )}

        {tab === 'traffic' && (
          <>
            <Section title="Traffic Over Time">
              <TrafficChart data={timeseries} period={period} />
            </Section>
            <Section title="Top Paths by Site">
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-gray-500 border-b border-gray-800 uppercase tracking-wider text-left">
                      <th className="pb-2 pr-4 font-medium">Site</th>
                      <th className="pb-2 pr-4 font-medium">Path</th>
                      <th className="pb-2 text-right font-medium">Requests</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(topPathsByHost ?? []).map((r, i) => (
                      <tr key={i} className="border-b border-gray-800/40 last:border-0 hover:bg-gray-800/20">
                        <td className="py-1.5 pr-4 font-mono text-sky-400 whitespace-nowrap max-w-[160px] truncate" title={r.host}>{r.host}</td>
                        <td className="py-1.5 pr-4 text-gray-300 max-w-[320px] truncate font-mono" title={r.path}>{r.path}</td>
                        <td className="py-1.5 text-right tabular-nums text-gray-400">{r.requests.toLocaleString()}</td>
                      </tr>
                    ))}
                    {!topPathsByHost?.length && (
                      <tr><td colSpan={3} className="py-4 text-center text-gray-600">No data</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </Section>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <Section title="Top Paths">
                <TopTable rows={topPaths} labelKey="path" valueKey="requests" color="bg-violet-500" />
              </Section>
              <Section title="Top Hosts by Requests">
                <TopTable rows={topHosts} labelKey="host" valueKey="requests" color="bg-sky-500" />
              </Section>
              <Section title="Top Hosts by Bandwidth">
                <TopTable rows={[...(topHosts ?? [])].sort((a, b) => b.bytes - a.bytes)} labelKey="host" valueKey="bytes" color="bg-emerald-500" />
              </Section>
              <Section title="Status Code Distribution">
                <StatusChart data={statuses} />
              </Section>
            </div>

            {/* Latency by host */}
            {latency?.length > 0 && (
              <Section title="Response Latency by Host">
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-gray-500 border-b border-gray-800 text-right">
                        <th className="text-left py-2 pr-4 font-medium">Host</th>
                        <th className="py-2 pr-4 font-medium">Requests</th>
                        <th className="py-2 pr-4 font-medium">Avg</th>
                        <th className="py-2 pr-4 font-medium">p50</th>
                        <th className="py-2 pr-4 font-medium">p95</th>
                        <th className="py-2 font-medium">p99</th>
                      </tr>
                    </thead>
                    <tbody>
                      {latency.map(r => (
                        <tr key={r.host} className="border-b border-gray-800/40 last:border-0 hover:bg-gray-800/20">
                          <td className="py-2 pr-4 font-mono text-sky-400 max-w-[200px] truncate">{r.host}</td>
                          <td className="py-2 pr-4 text-right text-gray-500">{r.requests?.toLocaleString()}</td>
                          <td className={`py-2 pr-4 text-right font-mono ${latencyColor(r.avg_ms)}`}>{fmtMs(r.avg_ms)}</td>
                          <td className={`py-2 pr-4 text-right font-mono ${latencyColor(r.p50)}`}>{fmtMs(r.p50)}</td>
                          <td className={`py-2 pr-4 text-right font-mono ${latencyColor(r.p95)}`}>{fmtMs(r.p95)}</td>
                          <td className={`py-2 text-right font-mono ${latencyColor(r.p99)}`}>{fmtMs(r.p99)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="text-[10px] text-gray-600 mt-2">Populated once NPM's $upstream_response_time appears in logs</p>
              </Section>
            )}

            {/* Slow requests */}
            {slowReqs?.length > 0 && (
              <Section title="Slow Requests (>2s)">
                <div className="space-y-0.5 max-h-72 overflow-y-auto">
                  {slowReqs.map((r, i) => (
                    <div key={i} className="flex items-center gap-2 text-xs py-1.5 border-b border-gray-800/40 last:border-0">
                      <span className={`font-mono w-16 text-right shrink-0 ${r.response_ms > 5000 ? 'text-rose-400' : 'text-amber-400'}`}>
                        {fmtMs(r.response_ms)}
                      </span>
                      <span className="text-gray-600 shrink-0 w-10">{r.method}</span>
                      <span className="font-mono text-sky-400 shrink-0 max-w-[140px] truncate">{r.host}</span>
                      <span className="text-gray-400 flex-1 truncate min-w-0">{r.path}</span>
                      <span className={`shrink-0 font-mono w-8 text-right ${r.status >= 500 ? 'text-rose-400' : r.status >= 400 ? 'text-amber-400' : 'text-gray-500'}`}>
                        {r.status}
                      </span>
                    </div>
                  ))}
                </div>
              </Section>
            )}
          </>
        )}

        {tab === 'visitors' && (
          <>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <Section title="Top Referrers">
                <RefererTable rows={referers} period={period} />
              </Section>
              <Section title="Top IP Addresses">
                <div className="max-h-80 overflow-y-auto">
                  {topIps?.map((row, i) => (
                    <TopIpRow key={row.ip} row={row} i={i} />
                  ))}
                </div>
              </Section>
            </div>
            <Section title="Peak Traffic Hours (UTC)">
              <HeatMap data={heatmap} />
            </Section>
            <Section title="Live Feed"><LiveFeed /></Section>
          </>
        )}

        {tab === 'geo' && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Section title="Top Countries by Requests">
              <CountryTable rows={countries} valueKey="requests" color="bg-sky-500" period={period} />
            </Section>
            <Section title="Top Countries by Unique Visitors">
              <CountryTable rows={[...(countries ?? [])].sort((a, b) => b.unique_visitors - a.unique_visitors)} valueKey="unique_visitors" color="bg-violet-500" period={period} />
            </Section>
            <Section title="Top Referrers" className="lg:col-span-2">
              <TopTable rows={referers} labelKey="referer" valueKey="requests" color="bg-fuchsia-500" />
            </Section>
          </div>
        )}

        {tab === 'tech' && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <Section title="Browsers"><BrowserDonut data={browsers} groupKey="browser" /></Section>
            <Section title="Device Types"><BrowserDonut data={browsers} groupKey="device_type" /></Section>
            <Section title="Status Codes"><StatusChart data={statuses} /></Section>
            <Section title="Top Paths" className="lg:col-span-3">
              <TopTable rows={topPaths} labelKey="path" valueKey="requests" color="bg-violet-500" maxRows={20} />
            </Section>
          </div>
        )}

        {tab === 'security'  && <SecurityTab period={period} />}
        {tab === 'ops'       && <OpsTab />}

      </main>

      <DetailPanel type={activePanel} period={period} host={host} onClose={() => setPanel(null)} />
      {showUsers && <UserManagement onClose={() => setShowUsers(false)} />}
    </div>
  )
}
