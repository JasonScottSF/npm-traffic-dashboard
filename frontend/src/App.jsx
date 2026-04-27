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

function TopIpRow({ row, i }) {
  const [org, setOrg]         = useState(null)
  const [banState, setBanState] = useState('idle') // idle | confirm | banning | done | error

  useEffect(() => {
    if (!row.ip) return
    axios.get(`/api/ip_info/${row.ip}`)
      .then(r => {
        // Strip AS number prefix: "AS15169 Google LLC" → "Google LLC"
        const raw = r.data?.org || ''
        setOrg(raw.replace(/^AS\d+\s*/, '') || null)
      })
      .catch(() => {})
  }, [row.ip])

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
      <span className="text-gray-500 flex-1 truncate min-w-0" title={org ?? ''}>
        {org === null
          ? <span className="text-gray-700">looking up…</span>
          : org || <span className="text-gray-700">—</span>}
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

function Section({ title, children, className = '' }) {
  return (
    <div className={`card ${className}`}>
      <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-widest mb-4">{title}</h2>
      {children}
    </div>
  )
}

const TABS = ['overview', 'traffic', 'visitors', 'geo', 'tech', 'security', 'host']

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
  const { data: topHosts }  = useApi('/top_hosts',    { period }, 30000)
  const { data: topPaths }  = useApi('/top_paths',    p, 30000)
  const { data: statuses }  = useApi('/status_codes', p, 30000)
  const { data: countries } = useApi('/top_countries',p, 30000)
  const { data: referers }  = useApi('/top_referers', p, 30000)
  const { data: browsers }  = useApi('/browsers',     p, 30000)
  const { data: heatmap }   = useApi('/heatmap',      p, 60000)
  const { data: topIps }    = useApi('/top_ips',      p, 30000)

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
            <StatCard label="Requests"        value={summary?.total_requests?.toLocaleString()} color="sky"     icon="📊" onClick={() => setPanel('requests')} />
            <StatCard label="Unique Visitors" value={summary?.unique_visitors?.toLocaleString()} color="violet"  icon="👤" onClick={() => setPanel('visitors')} />
            <StatCard label="Bandwidth"       value={fmtBytes(summary?.total_bytes)}             color="emerald" icon="📦" onClick={() => setPanel('bandwidth')} />
            <StatCard label="Errors"          value={summary?.error_count?.toLocaleString()} sub={errorRate} color="rose"    icon="⚠️" onClick={() => setPanel('errors')} />
            <StatCard label="Bots"            value={summary?.bot_count?.toLocaleString()}   sub={botRate}   color="amber"   icon="🤖" onClick={() => setPanel('bots')} />
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
          </>
        )}

        {tab === 'visitors' && (
          <>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <Section title="Top Referrers">
                <TopTable rows={referers} labelKey="referer" valueKey="requests" color="bg-fuchsia-500" />
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
              <TopTable rows={countries} labelKey="country_code" valueKey="requests" color="bg-sky-500" />
            </Section>
            <Section title="Top Countries by Unique Visitors">
              <TopTable rows={[...(countries ?? [])].sort((a, b) => b.unique_visitors - a.unique_visitors)} labelKey="country_code" valueKey="unique_visitors" color="bg-violet-500" />
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
        {tab === 'host'      && <HostTab />}

      </main>

      <DetailPanel type={activePanel} period={period} host={host} onClose={() => setPanel(null)} />
      {showUsers && <UserManagement onClose={() => setShowUsers(false)} />}
    </div>
  )
}
