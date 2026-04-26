import { useState, useEffect, useCallback } from 'react'
import { useApi } from '../hooks/useApi'
import axios from 'axios'
import JailManager from './JailManager'
import GeoBlock from './GeoBlock'
import ManualBan from './ManualBan'
import WAFTab from './WAFTab'
import WAFTestTab from './WAFTestTab'

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

function fmtTime(iso) {
  if (!iso) return '—'
  try {
    return new Intl.DateTimeFormat('en-US', {
      month: 'short', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hour12: false,
    }).format(new Date(iso))
  } catch { return iso }
}

const SEV_STYLES = {
  CRITICAL: 'bg-rose-500/20 text-rose-300 border border-rose-500/30',
  ERROR:    'bg-orange-500/20 text-orange-300 border border-orange-500/30',
  WARNING:  'bg-amber-500/20 text-amber-300 border border-amber-500/30',
  NOTICE:   'bg-sky-500/20 text-sky-300 border border-sky-500/30',
  INFO:     'bg-gray-700/50 text-gray-400 border border-gray-700',
}

function SevBadge({ sev }) {
  const s = (sev || 'INFO').toUpperCase()
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold uppercase tracking-wide ${SEV_STYLES[s] || SEV_STYLES.INFO}`}>
      {s}
    </span>
  )
}

// ── Slide-in drawer ────────────────────────────────────────────────────────

function Drawer({ title, onClose, children }) {
  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="absolute right-0 top-0 bottom-0 w-full max-w-xl bg-gray-950 border-l border-gray-800 flex flex-col shadow-2xl">
        <div className="flex items-center justify-between p-5 border-b border-gray-800 shrink-0">
          <div className="font-bold text-white text-lg">{title}</div>
          <button onClick={onClose} className="text-gray-500 hover:text-white text-xl leading-none">✕</button>
        </div>
        <div className="flex-1 overflow-y-auto p-5 space-y-2">
          {children}
        </div>
      </div>
    </div>
  )
}

// ── Countries blocked panel ────────────────────────────────────────────────

function CountriesPanel({ onClose, onRefetch }) {
  const { data: blocked, refetch } = useApi('/f2b/geo/blocked', {}, 10000)
  const [unbanning, setUnbanning] = useState(null)
  const [clearing, setClearing] = useState(false)

  async function unblock(cc) {
    setUnbanning(cc)
    try {
      await axios.delete(`/api/f2b/geo/block/${cc}`)
      refetch(); onRefetch()
    } catch (e) {
      alert(e.response?.data?.detail || e.message)
    } finally { setUnbanning(null) }
  }

  async function clearAll() {
    if (!confirm('Remove all country blocks?')) return
    setClearing(true)
    try {
      await axios.delete('/api/f2b/geo/block')
      refetch(); onRefetch()
    } catch (e) {
      alert(e.response?.data?.detail || e.message)
    } finally { setClearing(false) }
  }

  return (
    <Drawer title="Blocked Countries" onClose={onClose}>
      {blocked?.length > 0 && (
        <div className="flex justify-end pb-2 border-b border-gray-800">
          <button
            onClick={clearAll}
            disabled={clearing}
            className="text-xs px-3 py-1.5 bg-gray-800 text-rose-400 hover:bg-rose-500/20 border border-gray-700 rounded-lg transition-colors disabled:opacity-50"
          >
            {clearing ? 'Clearing…' : 'Clear All Blocks'}
          </button>
        </div>
      )}
      {!blocked?.length && <div className="text-gray-600 text-sm text-center py-8">No countries blocked</div>}
      {blocked?.map(b => (
        <div key={b.country_code} className="flex items-center gap-3 bg-gray-900 border border-gray-800 rounded-xl px-4 py-3">
          <span className="text-2xl">{FLAG(b.country_code)}</span>
          <div className="flex-1">
            <div className="text-white font-medium">{countryName(b.country_code)}</div>
            <div className="text-xs text-gray-500">{b.cidr_count.toLocaleString()} CIDRs blocked</div>
          </div>
          <button
            onClick={() => unblock(b.country_code)}
            disabled={unbanning === b.country_code}
            className="text-xs px-3 py-1.5 bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/40 rounded-lg transition-colors disabled:opacity-50"
          >
            {unbanning === b.country_code ? 'Removing…' : 'Unblock'}
          </button>
        </div>
      ))}
    </Drawer>
  )
}

// ── Individual IPs panel ───────────────────────────────────────────────────

function IPsPanel({ jails, onRefetch, onClose }) {
  const [unbanning, setUnbanning] = useState(null)
  const [expandedCountry, setExpandedCountry] = useState(null)

  const nonGeoJails = (jails ?? []).filter(j => j.name !== 'geoblock')

  // Flatten all banned IPs across non-geo jails
  const allIps = nonGeoJails.flatMap(j => (j.banned_ips ?? []).map(entry => ({ ...entry, jail: j.name })))

  // Group by country
  const byCountry = {}
  for (const entry of allIps) {
    const cc = entry.country || ''
    if (!byCountry[cc]) byCountry[cc] = []
    byCountry[cc].push(entry)
  }
  const sorted = Object.entries(byCountry).sort((a, b) => b[1].length - a[1].length)

  async function unban(jail, ip) {
    setUnbanning(ip)
    try {
      await axios.post('/api/f2b/unban', { jail, ip })
      onRefetch()
    } catch (e) {
      alert(e.response?.data?.detail || e.message)
    } finally { setUnbanning(null) }
  }

  return (
    <Drawer title={`Banned IPs — ${allIps.length} total`} onClose={onClose}>
      {allIps.length === 0 && <div className="text-gray-600 text-sm text-center py-8">No IPs currently banned</div>}
      {sorted.map(([cc, entries]) => (
        <div key={cc} className="rounded-xl overflow-hidden border border-gray-800">
          <button
            onClick={() => setExpandedCountry(expandedCountry === cc ? null : cc)}
            className="w-full flex items-center gap-3 px-4 py-3 bg-gray-900 hover:bg-gray-800/80 transition-colors"
          >
            <span className="text-xl">{FLAG(cc)}</span>
            <span className="text-white font-medium flex-1 text-left">{countryName(cc)}</span>
            <span className="text-xs text-rose-300 font-mono">{entries.length} IP{entries.length !== 1 ? 's' : ''}</span>
            <span className="text-gray-600 text-xs ml-2">{expandedCountry === cc ? '▲' : '▼'}</span>
          </button>
          {expandedCountry === cc && (
            <div className="divide-y divide-gray-800/60 border-t border-gray-800">
              {entries.map((e, i) => (
                <div key={i} className="flex items-center justify-between px-4 py-2 bg-gray-950">
                  <div>
                    <span className="font-mono text-rose-300 text-xs">{e.ip}</span>
                    <span className="text-gray-600 text-xs ml-2">[{e.jail}]</span>
                  </div>
                  <button
                    onClick={() => unban(e.jail, e.ip)}
                    disabled={unbanning === e.ip}
                    className="text-xs px-2.5 py-1 bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/40 rounded-lg transition-colors disabled:opacity-50"
                  >
                    {unbanning === e.ip ? '…' : 'Unban'}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </Drawer>
  )
}

// ── Manual bans panel ──────────────────────────────────────────────────────

function ManualPanel({ onClose, banned }) {
  const [unbanning, setUnbanning] = useState(null)
  const [list, setList] = useState(banned ?? [])

  async function unban(ip) {
    setUnbanning(ip)
    try {
      await axios.delete('/api/f2b/manual/ban', { params: { ip } })
      setList(l => l.filter(x => x !== ip))
    } catch (e) {
      alert(e.response?.data?.detail || e.message)
    } finally { setUnbanning(null) }
  }

  return (
    <Drawer title={`Manual Blocks — ${list.length} total`} onClose={onClose}>
      {list.length === 0 && <div className="text-gray-600 text-sm text-center py-8">No manual blocks</div>}
      {list.map(ip => (
        <div key={ip} className="flex items-center justify-between bg-gray-900 border border-gray-800 rounded-xl px-4 py-3">
          <span className="font-mono text-orange-300 text-sm">{ip}</span>
          <button
            onClick={() => unban(ip)}
            disabled={unbanning === ip}
            className="text-xs px-3 py-1.5 bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/40 rounded-lg transition-colors disabled:opacity-50"
          >
            {unbanning === ip ? 'Removing…' : 'Unban'}
          </button>
        </div>
      ))}
    </Drawer>
  )
}

// ── Jail card ──────────────────────────────────────────────────────────────

function JailCard({ jail, onUnban, geoData }) {
  const [expanded, setExpanded] = useState(false)
  const [unbanning, setUnbanning] = useState(null)

  const isGeo = jail.name === 'geoblock'

  async function handleUnban(ip) {
    setUnbanning(ip)
    try {
      await axios.post('/api/f2b/unban', { jail: jail.name, ip })
      onUnban()
    } catch (e) {
      alert(`Unban failed: ${e.response?.data?.detail || e.message}`)
    } finally { setUnbanning(null) }
  }

  async function handleUnblockCountry(cc) {
    setUnbanning(cc)
    try {
      await axios.delete(`/api/f2b/geo/block/${cc}`)
      onUnban()
    } catch (e) {
      alert(`Unblock failed: ${e.response?.data?.detail || e.message}`)
    } finally { setUnbanning(null) }
  }

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
      <button
        onClick={() => setExpanded(e => !e)}
        className="w-full flex items-center justify-between p-4 hover:bg-gray-800/50 transition-colors"
      >
        <div className="flex items-center gap-3">
          <span className="text-lg">{isGeo ? '🌍' : '🔒'}</span>
          <div className="text-left">
            <div className="font-semibold text-white">{jail.name}</div>
            <div className="text-xs text-gray-500">
              {isGeo ? 'country / CIDR block jail' : jail.file_list || 'no log file'}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-6 text-sm">
          <div className="text-center">
            <div className="font-bold text-rose-400">
              {isGeo ? (geoData?.length ?? jail.currently_banned) : jail.currently_banned}
            </div>
            <div className="text-gray-600 text-xs">{isGeo ? 'countries' : 'banned'}</div>
          </div>
          {!isGeo && (
            <>
              <div className="text-center">
                <div className="font-bold text-amber-400">{jail.currently_failed}</div>
                <div className="text-gray-600 text-xs">failing</div>
              </div>
              <div className="text-center">
                <div className="font-bold text-gray-400">{jail.total_banned}</div>
                <div className="text-gray-600 text-xs">total bans</div>
              </div>
            </>
          )}
          {isGeo && (
            <div className="text-center">
              <div className="font-bold text-gray-400">{jail.currently_banned}</div>
              <div className="text-gray-600 text-xs">CIDRs</div>
            </div>
          )}
          <span className="text-gray-600">{expanded ? '▲' : '▼'}</span>
        </div>
      </button>
      {expanded && (
        <div className="border-t border-gray-800 p-4">
          {isGeo ? (
            /* Country-grouped view for geoblock */
            !geoData?.length
              ? <div className="text-gray-600 text-sm text-center py-2">No countries blocked</div>
              : <div className="space-y-1">
                  {geoData.map(b => (
                    <div key={b.country_code} className="flex items-center justify-between bg-gray-800/60 rounded-lg px-3 py-2">
                      <div className="flex items-center gap-2">
                        <span className="text-base">{FLAG(b.country_code)}</span>
                        <span className="text-white text-sm">{countryName(b.country_code)}</span>
                        <span className="text-xs text-gray-500 font-mono">{b.cidr_count.toLocaleString()} CIDRs</span>
                      </div>
                      <button
                        onClick={() => handleUnblockCountry(b.country_code)}
                        disabled={unbanning === b.country_code}
                        className="text-xs px-2.5 py-1 rounded-md bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/40 transition-colors disabled:opacity-50"
                      >
                        {unbanning === b.country_code ? '…' : 'Unblock'}
                      </button>
                    </div>
                  ))}
                </div>
          ) : (
            /* Normal IP list for other jails */
            !jail.banned_ips?.length
              ? <div className="text-gray-600 text-sm text-center py-2">No currently banned IPs</div>
              : <div className="space-y-1">
                  {jail.banned_ips.map((entry, i) => (
                    <div key={i} className="flex items-center justify-between bg-gray-800/60 rounded-lg px-3 py-2">
                      <div className="flex items-center gap-2">
                        {entry.country && <span className="text-sm">{FLAG(entry.country)}</span>}
                        <span className="font-mono text-rose-300 text-sm">{entry.ip}</span>
                        {entry.country && <span className="text-xs text-gray-500">{countryName(entry.country)}</span>}
                      </div>
                      <button
                        onClick={() => handleUnban(entry.ip)}
                        disabled={unbanning === entry.ip}
                        className="text-xs px-2.5 py-1 rounded-md bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/40 transition-colors disabled:opacity-50"
                      >
                        {unbanning === entry.ip ? '…' : 'Unban'}
                      </button>
                    </div>
                  ))}
                </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Breach detector panel ──────────────────────────────────────────────────

function BreachPanel({ stats, events, collapsed, onToggle, onAckOne, onAckAll, ackingId, ackingAll }) {
  if (!stats && !events?.length) return null
  const hasData = stats?.total > 0 || events?.length > 0

  return (
    <div className="card border-purple-800/40 bg-purple-950/10">
      <div className="flex items-center gap-2 mb-1">
        <span className="text-lg">⚡</span>
        <button onClick={onToggle} className="flex items-center gap-2 group flex-1">
          <h2 className="text-sm font-semibold text-purple-300 uppercase tracking-widest group-hover:text-purple-200 transition-colors">
            Breach Detector
          </h2>
          <span className="text-gray-600 text-xs group-hover:text-gray-400 transition-colors">
            {collapsed ? '▼ show' : '▲ hide'}
          </span>
        </button>
        {!collapsed && hasData && (
          <button
            onClick={onAckAll}
            disabled={ackingAll}
            className="text-xs px-3 py-1.5 bg-gray-800 text-gray-400 hover:text-white hover:bg-gray-700 border border-gray-700 rounded-lg transition-colors disabled:opacity-50"
          >
            {ackingAll ? 'Clearing…' : 'Acknowledge All'}
          </button>
        )}
      </div>

      {!collapsed && (
        <>
          {!hasData ? (
            <div className="text-gray-600 text-sm text-center py-6 mt-3">
              No bypass events — the WAF is blocking everything or no attacks have been observed.
            </div>
          ) : (
            <>
              {stats && (
                <div className="flex flex-wrap gap-3 mb-4 mt-3">
                  <div className="bg-gray-800/60 rounded-lg px-4 py-3 text-center min-w-[90px]">
                    <div className="text-2xl font-bold text-purple-300">{stats.total ?? 0}</div>
                    <div className="text-xs text-gray-500 mt-0.5">Total Bypasses</div>
                  </div>
                  {Object.entries(stats.by_category ?? {}).map(([cat, n]) => (
                    <div key={cat} className="bg-gray-800/60 rounded-lg px-4 py-3 text-center min-w-[90px]">
                      <div className="text-2xl font-bold text-purple-200">{n}</div>
                      <div className="text-xs text-gray-500 mt-0.5">{cat}</div>
                    </div>
                  ))}
                </div>
              )}

              {events?.length > 0 && (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-gray-600 uppercase tracking-wider text-left border-b border-gray-800">
                        <th className="pb-2 pr-3 font-medium">Time</th>
                        <th className="pb-2 pr-3 font-medium">IP</th>
                        <th className="pb-2 pr-3 font-medium">Method</th>
                        <th className="pb-2 pr-3 font-medium">Path</th>
                        <th className="pb-2 pr-3 font-medium">Signature</th>
                        <th className="pb-2 pr-3 font-medium">Severity</th>
                        <th className="pb-2 font-medium" />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-800/50">
                      {events.slice(0, 50).map((e) => (
                        <tr key={e.id ?? e.ts} className="hover:bg-purple-900/20 transition-colors">
                          <td className="py-1.5 pr-3 text-gray-500 font-mono whitespace-nowrap">{fmtTime(e.ts)}</td>
                          <td className="py-1.5 pr-3 font-mono text-sky-400">{e.client_ip}</td>
                          <td className="py-1.5 pr-3 font-mono text-gray-400">{e.method}</td>
                          <td className="py-1.5 pr-3 font-mono text-gray-300 max-w-[180px] truncate" title={e.path}>{e.path}</td>
                          <td className="py-1.5 pr-3 text-purple-300">{e.sig_name}</td>
                          <td className="py-1.5 pr-3"><SevBadge sev={e.severity} /></td>
                          <td className="py-1.5">
                            <button
                              onClick={() => onAckOne(e.id)}
                              disabled={ackingId === e.id}
                              className="text-xs px-2 py-0.5 rounded bg-gray-800 text-gray-500 hover:text-white hover:bg-gray-700 transition-colors disabled:opacity-40"
                              title="Acknowledge this event"
                            >
                              {ackingId === e.id ? '…' : 'Ack'}
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  )
}

// ── Log feed ───────────────────────────────────────────────────────────────

function LogFeed({ selectedJail }) {
  const { data: logs } = useApi('/f2b/log', { lines: 100, ...(selectedJail ? { jail: selectedJail } : {}) }, 5000)
  if (!logs?.length) return <div className="text-gray-600 text-sm text-center py-6">No log entries</div>
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

// ── Main ───────────────────────────────────────────────────────────────────

function StatBtn({ value, label, color, onClick }) {
  return (
    <button onClick={onClick} className="text-center group">
      <div className={`text-xl font-bold ${color} group-hover:brightness-125 transition-all`}>{value}</div>
      <div className="text-xs text-gray-500 group-hover:text-gray-400 transition-colors">{label} ↗</div>
    </button>
  )
}

export default function SecurityTab({ period = '24h' }) {
  const [selectedJail, setSelectedJail] = useState('')
  const [activePanel, setPanel] = useState(null)
  const [showWAFTest, setShowWAFTest] = useState(false)
  const [jailsCollapsed, setJailsCollapsed] = useState(false)
  const [breachCollapsed, setBreachCollapsed] = useState(false)
  const [wafTesterAvailable, setWafTesterAvailable] = useState(null) // null=checking

  // Breach state
  const [breachEvents, setBreachEvents] = useState([])
  const [breachStats, setBreachStats]   = useState(null)
  const [ackingId, setAckingId]         = useState(null)
  const [ackingAll, setAckingAll]       = useState(false)

  useEffect(() => {
    axios.get('/api/waf-test/suites')
      .then(() => setWafTesterAvailable(true))
      .catch(() => setWafTesterAvailable(false))
  }, [])

  const loadBreachData = useCallback(() => {
    axios.get('/api/breach/events').then(r => setBreachEvents(r.data ?? [])).catch(() => {})
    axios.get('/api/breach/stats').then(r => setBreachStats(r.data)).catch(() => {})
  }, [])

  useEffect(() => {
    loadBreachData()
    const t = setInterval(loadBreachData, 10000)
    return () => clearInterval(t)
  }, [loadBreachData])

  async function ackOne(id) {
    if (id == null) return
    setAckingId(id)
    try {
      await axios.delete(`/api/breach/events/${id}`)
      loadBreachData()
    } catch (e) {
      alert(e.response?.data?.error || e.message)
    } finally { setAckingId(null) }
  }

  async function ackAll() {
    if (!confirm('Acknowledge all breach events?')) return
    setAckingAll(true)
    try {
      await axios.delete('/api/breach/events')
      loadBreachData()
    } catch (e) {
      alert(e.response?.data?.error || e.message)
    } finally { setAckingAll(false) }
  }

  const { data: status, refetch: refetchStatus }   = useApi('/f2b/status',       {},         10000)
  const { data: jails, refetch: refetchJails }     = useApi('/f2b/jails',        {},         15000)
  const { data: geoBlocked, refetch: refetchGeo }  = useApi('/f2b/geo/blocked',  {},         15000)
  const { data: manualBanned }                     = useApi('/f2b/manual/banned',{},         15000)
  const { data: trafficCountries }                 = useApi('/top_countries',    { period }, 60000)

  // manual-ban is shown via the Manual Blocks panel; exclude it from the jail card list.
  // geoblock IS shown — it's a real running jail and its ban count reflects active country blocks.
  const displayJails = (jails ?? []).filter(j => j.name !== 'manual-ban')
  const nonGeoJails  = (jails ?? []).filter(j => j.name !== 'geoblock' && j.name !== 'manual-ban')
  const ipBannedCount = nonGeoJails.reduce((s, j) => s + (j.banned_ips?.length ?? 0), 0)
  const countriesBlockedCount = geoBlocked?.length ?? 0
  const manualBannedCount = manualBanned?.length ?? 0
  const totalFailed  = nonGeoJails.reduce((s, j) => s + j.currently_failed, 0)
  const totalAllTime = nonGeoJails.reduce((s, j) => s + j.total_banned, 0)

  function refetch() { refetchStatus(); refetchJails() }

  return (
    <div className="space-y-6">

      {activePanel === 'countries' && (
        <CountriesPanel onClose={() => setPanel(null)} onRefetch={refetchGeo} />
      )}
      {activePanel === 'ips' && (
        <IPsPanel jails={jails} onRefetch={refetch} onClose={() => setPanel(null)} />
      )}
      {activePanel === 'manual' && (
        <ManualPanel onClose={() => setPanel(null)} banned={manualBanned} />
      )}

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
        <div className="flex gap-6 text-center items-center">
          <StatBtn value={countriesBlockedCount} label="Countries Blocked" color="text-violet-400" onClick={() => setPanel('countries')} />
          <StatBtn value={ipBannedCount} label="IPs Banned" color="text-rose-400" onClick={() => setPanel('ips')} />
          <StatBtn value={manualBannedCount} label="Manual Blocks" color="text-orange-400" onClick={() => setPanel('manual')} />
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
      <GeoBlock trafficCountries={trafficCountries ?? []} onBlock={refetchGeo} />

      {/* Manual IP/CIDR block */}
      <ManualBan />

      {/* Jail manager */}
      <JailManager activeJails={jails?.map(j => j.name) ?? []} onRefresh={refetch} />

      {/* Breach detector — live WAF bypass telemetry */}
      <BreachPanel
        stats={breachStats}
        events={breachEvents}
        collapsed={breachCollapsed}
        onToggle={() => setBreachCollapsed(c => !c)}
        onAckOne={ackOne}
        onAckAll={ackAll}
        ackingId={ackingId}
        ackingAll={ackingAll}
      />

      {/* Active Jails */}
      <div>
        <button
          onClick={() => setJailsCollapsed(c => !c)}
          className="w-full flex items-center justify-between mb-3 group"
        >
          <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-widest group-hover:text-gray-300 transition-colors">
            Active Jails
          </h2>
          <span className="text-gray-600 text-xs group-hover:text-gray-400 transition-colors">
            {jailsCollapsed ? '▼ show' : '▲ hide'}
          </span>
        </button>
        {!jailsCollapsed && (
          <div className="space-y-3">
            {displayJails.length
              ? displayJails.map(jail => (
                  <JailCard
                    key={jail.name}
                    jail={jail}
                    onUnban={refetch}
                    geoData={jail.name === 'geoblock' ? geoBlocked : undefined}
                  />
                ))
              : <div className="card text-gray-600 text-sm text-center py-6">No jails configured or fail2ban unreachable</div>
            }
          </div>
        )}
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

      {/* ── WAF ──────────────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-widest">WAF — ModSecurity</h2>
        {wafTesterAvailable === true && (
          <button
            onClick={() => setShowWAFTest(true)}
            className="flex items-center gap-2 px-4 py-2 bg-sky-600 hover:bg-sky-500 text-white text-sm font-semibold rounded-lg transition-colors shadow-lg shadow-sky-900/30"
          >
            <span>🧪</span> Run WAF Test
          </button>
        )}
        {wafTesterAvailable === false && (
          <span className="text-xs text-gray-600 italic">WAF tester not available in this environment</span>
        )}
      </div>
      <WAFTab
        breachStats={breachStats}
        onBreachCollapse={() => {
          setBreachCollapsed(false)
          window.scrollTo({ top: 0, behavior: 'smooth' })
        }}
      />

      {/* WAF Test full-screen drawer */}
      {showWAFTest && (
        <>
          <div
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40"
            onClick={() => setShowWAFTest(false)}
          />
          <div className="fixed inset-y-0 right-0 w-full max-w-5xl bg-gray-950 border-l border-gray-800 z-50 flex flex-col shadow-2xl">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-800 shrink-0">
              <div>
                <div className="font-bold text-white text-lg">WAF Test</div>
                <div className="text-xs text-gray-500 mt-0.5">Fire attack payloads and verify WAF blocking behaviour</div>
              </div>
              <button
                onClick={() => setShowWAFTest(false)}
                className="text-gray-500 hover:text-white text-xl leading-none"
              >✕</button>
            </div>
            <div className="flex-1 overflow-y-auto px-6 py-5">
              <WAFTestTab />
            </div>
          </div>
        </>
      )}
    </div>
  )
}

function StatusBadge({ running }) {
  return running
    ? <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500/20 text-emerald-300 text-xs font-semibold"><span className="w-1.5 h-1.5 rounded-full bg-emerald-400 live-dot" />Running</span>
    : <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-rose-500/20 text-rose-300 text-xs font-semibold"><span className="w-1.5 h-1.5 rounded-full bg-rose-400" />Down</span>
}
