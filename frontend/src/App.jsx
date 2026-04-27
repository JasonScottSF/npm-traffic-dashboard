import { useState, useEffect } from 'react'
import { useApi } from './hooks/useApi'
import axios from 'axios'
import { useTZ, TIMEZONES } from './contexts/TZContext'
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

function pct(a, b) {
  if (!b) return '—'
  return `${((a / b) * 100).toFixed(1)}%`
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

  const [breachCount, setBreachCount] = useState(0)

  useEffect(() => {
    axios.get('/auth/api/me').then(r => setMe(r.data)).catch(() => {})
  }, [])

  useEffect(() => {
    const load = () => axios.get('/api/breach/stats').then(r => setBreachCount(r.data?.total ?? 0)).catch(() => {})
    load()
    const t = setInterval(load, 30000)
    return () => clearInterval(t)
  }, [])

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

        {/* Stat cards — traffic tabs only */}
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
                <div className="space-y-1 max-h-80 overflow-y-auto">
                  {topIps?.map((row, i) => (
                    <div key={i} className="flex items-center gap-2 text-xs py-1 border-b border-gray-800">
                      <span className="text-gray-600 w-4 text-right">{i + 1}</span>
                      <span className="font-mono text-sky-400 flex-1">{row.ip}</span>
                      {row.country_code && <span className="text-gray-500">{row.country_code}</span>}
                      {row.is_bot && <span className="badge bg-amber-500/20 text-amber-300">bot</span>}
                      <span className="text-gray-300 font-mono">{row.requests?.toLocaleString()}</span>
                    </div>
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
