import { useState } from 'react'
import { useApi } from '../hooks/useApi'
import axios from 'axios'
import JailManager from './JailManager'
import GeoBlock from './GeoBlock'

const regionNames = new Intl.DisplayNames(['en'], { type: 'region' })
const FLAG = cc => {
  if (!cc || cc.length !== 2) return '🌐'
  try { return String.fromCodePoint(...[...cc.toUpperCase()].map(c => 0x1F1E6 + c.charCodeAt(0) - 65)) } catch { return '🌐' }
}
const countryName = cc => {
  if (!cc) return 'Unknown'
  try { return regionNames.of(cc.toUpperCase()) } catch { return cc }
}

const LEVEL_COLOR = {
  NOTICE:  'text-sky-400',
  WARNING: 'text-amber-400',
  ERROR:   'text-rose-400',
  INFO:    'text-gray-400',
  DEBUG:   'text-gray-600',
}

function StatusBadge({ running }) {
  return running
    ? <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500/20 text-emerald-300 text-xs font-semibold"><span className="w-1.5 h-1.5 rounded-full bg-emerald-400 live-dot" />Running</span>
    : <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-rose-500/20 text-rose-300 text-xs font-semibold"><span className="w-1.5 h-1.5 rounded-full bg-rose-400" />Down</span>
}

function BannedByCountry({ bannedIps, onUnban, unbanning }) {
  const [expandedCountry, setExpandedCountry] = useState(null)

  // Group by country
  const byCountry = {}
  for (const entry of bannedIps) {
    const cc = entry.country || ''
    if (!byCountry[cc]) byCountry[cc] = []
    byCountry[cc].push(entry.ip)
  }
  const sorted = Object.entries(byCountry).sort((a, b) => b[1].length - a[1].length)

  return (
    <div className="space-y-2">
      <div className="text-xs text-gray-500 uppercase tracking-widest mb-2">Banned by Country</div>
      {sorted.map(([cc, ips]) => (
        <div key={cc} className="rounded-lg overflow-hidden border border-gray-700/60">
          <button
            onClick={() => setExpandedCountry(expandedCountry === cc ? null : cc)}
            className="w-full flex items-center gap-3 px-3 py-2 bg-gray-800/60 hover:bg-gray-800 transition-colors"
          >
            <span className="text-base">{FLAG(cc)}</span>
            <span className="text-sm text-gray-200 flex-1 text-left">{countryName(cc)}</span>
            <span className="text-xs font-mono text-rose-300">{ips.length} IP{ips.length !== 1 ? 's' : ''}</span>
            <span className="text-gray-600 text-xs">{expandedCountry === cc ? '▲' : '▼'}</span>
          </button>
          {expandedCountry === cc && (
            <div className="divide-y divide-gray-800/60">
              {ips.map(ip => (
                <div key={ip} className="flex items-center justify-between px-3 py-1.5 bg-gray-900/60">
                  <span className="font-mono text-rose-300 text-xs">{ip}</span>
                  <button
                    onClick={() => onUnban(ip)}
                    disabled={unbanning === ip}
                    className="text-xs px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/40 transition-colors disabled:opacity-50"
                  >
                    {unbanning === ip ? '…' : 'Unban'}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

function JailCard({ jail, onUnban }) {
  const [expanded, setExpanded] = useState(false)
  const [unbanning, setUnbanning] = useState(null)

  const totalPct = jail.total_banned > 0 ? Math.min(100, (jail.currently_banned / Math.max(jail.total_banned, 1)) * 100) : 0

  async function handleUnban(ip) {
    setUnbanning(ip)
    try {
      await axios.post('/api/f2b/unban', { jail: jail.name, ip })
      onUnban()
    } catch (e) {
      alert(`Unban failed: ${e.response?.data?.detail || e.message}`)
    } finally {
      setUnbanning(null)
    }
  }

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
      <button
        onClick={() => setExpanded(e => !e)}
        className="w-full flex items-center justify-between p-4 hover:bg-gray-800/50 transition-colors"
      >
        <div className="flex items-center gap-3">
          <span className="text-lg">🔒</span>
          <div className="text-left">
            <div className="font-semibold text-white">{jail.name}</div>
            <div className="text-xs text-gray-500">{jail.file_list || 'no log file'}</div>
          </div>
        </div>
        <div className="flex items-center gap-6 text-sm">
          <div className="text-center">
            <div className="font-bold text-rose-400">{jail.currently_banned}</div>
            <div className="text-gray-600 text-xs">banned</div>
          </div>
          <div className="text-center">
            <div className="font-bold text-amber-400">{jail.currently_failed}</div>
            <div className="text-gray-600 text-xs">failing</div>
          </div>
          <div className="text-center">
            <div className="font-bold text-gray-400">{jail.total_banned}</div>
            <div className="text-gray-600 text-xs">total bans</div>
          </div>
          <span className="text-gray-600">{expanded ? '▲' : '▼'}</span>
        </div>
      </button>

      {expanded && (
        <div className="border-t border-gray-800 p-4">
          {jail.banned_ips.length === 0 ? (
            <div className="text-gray-600 text-sm text-center py-2">No currently banned IPs</div>
          ) : (
            <BannedByCountry bannedIps={jail.banned_ips} onUnban={handleUnban} unbanning={unbanning} />
          )}
        </div>
      )}
    </div>
  )
}

function LogFeed({ selectedJail }) {
  const { data: logs } = useApi('/f2b/log', { lines: 100, ...(selectedJail ? { jail: selectedJail } : {}) }, 5000)

  if (!logs?.length) return (
    <div className="text-gray-600 text-sm text-center py-6">No log entries</div>
  )

  return (
    <div className="space-y-0.5 max-h-80 overflow-y-auto font-mono text-xs pr-1">
      {logs.map((entry, i) => (
        <div key={i} className="flex items-start gap-2 py-1 border-b border-gray-800/50 hover:bg-gray-800/30 px-1 rounded">
          <span className="text-gray-600 shrink-0 w-36">{entry.ts}</span>
          <span className={`shrink-0 w-16 ${LEVEL_COLOR[entry.level] || 'text-gray-400'}`}>{entry.level}</span>
          {entry.jail && <span className="text-sky-500 shrink-0">[{entry.jail}]</span>}
          <span className="text-gray-300">{entry.message}</span>
        </div>
      ))}
    </div>
  )
}

export default function SecurityTab({ period = '24h' }) {
  const [selectedJail, setSelectedJail] = useState('')
  const { data: status, refetch: refetchStatus } = useApi('/f2b/status',       {},         10000)
  const { data: jails, refetch: refetchJails }   = useApi('/f2b/jails',        {},         15000)
  const { data: banned }                          = useApi('/f2b/banned',       {},         15000)
  const { data: countries }                       = useApi('/top_countries',    { period }, 60000)

  const totalBanned  = banned?.length ?? 0
  const totalFailed  = jails?.reduce((s, j) => s + j.currently_failed, 0) ?? 0
  const totalAllTime = jails?.reduce((s, j) => s + j.total_banned, 0) ?? 0

  function refetch() { refetchStatus(); refetchJails() }

  return (
    <div className="space-y-6">
      {/* Status bar */}
      <div className="card flex flex-wrap items-center gap-6">
        <div className="flex items-center gap-3">
          <span className="text-2xl">🛡️</span>
          <div>
            <div className="font-bold text-white">Fail2Ban</div>
            <div className="text-xs text-gray-500">{status?.socket || '/var/run/fail2ban/fail2ban.sock'}</div>
          </div>
        </div>
        <StatusBadge running={status?.running} />
        <div className="flex-1" />
        <div className="flex gap-6 text-center">
          <div><div className="text-xl font-bold text-rose-400">{totalBanned}</div><div className="text-xs text-gray-500">Currently Banned</div></div>
          <div><div className="text-xl font-bold text-amber-400">{totalFailed}</div><div className="text-xs text-gray-500">Currently Failing</div></div>
          <div><div className="text-xl font-bold text-gray-400">{totalAllTime.toLocaleString()}</div><div className="text-xs text-gray-500">All-Time Bans</div></div>
          <div><div className="text-xl font-bold text-sky-400">{status?.jail_count ?? 0}</div><div className="text-xs text-gray-500">Active Jails</div></div>
        </div>
      </div>

      {!status?.running && (
        <div className="card border-rose-800 bg-rose-950/30 text-rose-300 text-sm">
          ⚠️ fail2ban is not responding. Check that it is running on the host and the socket is mounted correctly.
        </div>
      )}

      {/* Country block */}
      <GeoBlock trafficCountries={countries ?? []} />

      {/* Jail manager */}
      <JailManager activeJails={jails?.map(j => j.name) ?? []} onRefresh={refetch} />

      {/* Active Jails */}
      <div>
        <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-widest mb-3">Active Jails</h2>
        <div className="space-y-3">
          {jails?.length
            ? jails.map(jail => <JailCard key={jail.name} jail={jail} onUnban={refetch} />)
            : <div className="card text-gray-600 text-sm text-center py-6">No jails configured or fail2ban unreachable</div>
          }
        </div>
      </div>

      {/* Log feed */}
      <div className="card">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-widest">Live Log Feed</h2>
          {jails?.length > 0 && (
            <select
              value={selectedJail}
              onChange={e => setSelectedJail(e.target.value)}
              className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-1 text-sm text-gray-200 focus:outline-none focus:border-sky-500"
            >
              <option value="">All jails</option>
              {jails.map(j => <option key={j.name} value={j.name}>{j.name}</option>)}
            </select>
          )}
        </div>
        <LogFeed selectedJail={selectedJail} />
      </div>
    </div>
  )
}
