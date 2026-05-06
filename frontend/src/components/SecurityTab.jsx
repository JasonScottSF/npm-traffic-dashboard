import { useState, useEffect, useCallback } from 'react'
import { useApi } from '../hooks/useApi'
import axios from 'axios'
import JailManager from './JailManager'
import GeoBlock from './GeoBlock'
import ManualBan from './ManualBan'
import WAFTab from './WAFTab'
import WAFTestTab from './WAFTestTab'
import IPRepBadge from './IPRepBadge'
import CAPanel from './CATab'

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

// ── Chevron icon ───────────────────────────────────────────────────────────

function Chevron({ open }) {
  return (
    <svg
      className={`w-4 h-4 text-gray-500 shrink-0 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
      fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
    </svg>
  )
}

// ── Sub-section divider ────────────────────────────────────────────────────

function Divider({ title }) {
  return (
    <div className="flex items-center gap-3 pt-1">
      <div className="h-px flex-1 bg-gray-800" />
      <span className="text-xs font-semibold text-gray-600 uppercase tracking-widest whitespace-nowrap">{title}</span>
      <div className="h-px flex-1 bg-gray-800" />
    </div>
  )
}

// ── Slide-in drawer ────────────────────────────────────────────────────────

function Drawer({ title, onClose, children }) {
  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="absolute right-0 top-0 bottom-0 w-full sm:max-w-xl bg-gray-950 border-l border-gray-800 flex flex-col shadow-2xl">
        <div className="flex items-center justify-between p-5 border-b border-gray-800 shrink-0">
          <div className="font-semibold text-white text-base">{title}</div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg text-gray-500 hover:text-white hover:bg-gray-800 transition-colors">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
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
  const { data: blocked, refetch } = useApi('/f2b/geo/blocked', {}, 30000)
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

  const countries     = blocked?.countries ?? []
  const lastRefreshed = blocked?.last_refreshed

  return (
    <Drawer title="Blocked Countries" onClose={onClose}>
      {countries.length > 0 && (
        <div className="flex items-center justify-between pb-3 border-b border-gray-800 mb-1">
          {lastRefreshed && (
            <span className="text-xs text-gray-600">CIDRs refreshed {new Date(lastRefreshed).toLocaleDateString()}</span>
          )}
          <button
            onClick={clearAll}
            disabled={clearing}
            className="text-xs px-3 py-1.5 bg-gray-800 text-rose-400 hover:bg-rose-500/20 border border-gray-700 rounded-lg transition-colors disabled:opacity-50 ml-auto"
          >
            {clearing ? 'Clearing…' : 'Clear All'}
          </button>
        </div>
      )}
      {!countries.length && <div className="text-gray-600 text-sm text-center py-8">No countries blocked</div>}
      {countries.map(b => (
        <div key={b.country_code} className="flex items-center gap-3 bg-gray-900 border border-gray-800 rounded-xl px-4 py-3">
          <span className="text-2xl">{FLAG(b.country_code)}</span>
          <div className="flex-1">
            <div className="text-white font-medium text-sm">{countryName(b.country_code)}</div>
            <div className="text-xs text-gray-500 mt-0.5">{b.cidr_count.toLocaleString()} CIDRs blocked</div>
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
  const allIps = nonGeoJails.flatMap(j => (j.banned_ips ?? []).map(entry => ({ ...entry, jail: j.name })))

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
            <span className="text-white font-medium flex-1 text-left text-sm">{countryName(cc)}</span>
            <span className="text-xs text-rose-300 font-mono">{entries.length} IP{entries.length !== 1 ? 's' : ''}</span>
            <Chevron open={expandedCountry === cc} />
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

// ── All-time ban history panel ─────────────────────────────────────────────

function BanHistoryPanel({ jails, onClose }) {
  const [rows, setRows]       = useState(null)
  const [loading, setLoading] = useState(true)
  const [filter, setFilter]   = useState('all') // 'all' | 'banned' | 'expired'

  useEffect(() => {
    async function load() {
      try {
        const names = (jails ?? []).filter(j => j.name !== 'geoblock').map(j => j.name)
        const results = await Promise.all(
          names.map(n => axios.get(`/api/f2b/jails/${encodeURIComponent(n)}/ban_history`)
            .then(r => r.data.map(e => ({ ...e, jail: n })))
            .catch(() => [])
          )
        )
        // Merge and sort newest-first
        const merged = results.flat().sort((a, b) => b.ts.localeCompare(a.ts))
        setRows(merged)
      } finally { setLoading(false) }
    }
    load()
  }, [])

  const visible = !rows ? [] : filter === 'all' ? rows
    : rows.filter(e => filter === 'banned' ? e.status !== 'unban' : e.status === 'unban')

  return (
    <Drawer title={`All-Time Bans${rows ? ` — ${rows.length} events` : ''}`} onClose={onClose}>
      {/* Filter pills */}
      <div className="flex gap-2 pb-1 shrink-0">
        {[['all','All'],['banned','Active'],['expired','Expired']].map(([v,l]) => (
          <button key={v} onClick={() => setFilter(v)}
            className={`text-xs px-3 py-1 rounded-full transition-colors ${filter === v ? 'bg-rose-500/20 text-rose-300 ring-1 ring-rose-500/40' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'}`}>
            {l}
          </button>
        ))}
      </div>
      {loading && <div className="text-xs text-gray-600 text-center py-8">Loading…</div>}
      {!loading && visible.length === 0 && <div className="text-xs text-gray-600 text-center py-8">No events found</div>}
      {visible.map((e, i) => (
        <div key={i} className={`flex items-center gap-2 text-xs rounded-lg px-3 py-2 ${
          e.status === 'unban' ? 'bg-gray-800/50' : 'bg-rose-900/15'
        }`}>
          <span className={e.status === 'unban' ? 'text-gray-500' : 'text-rose-400'}>
            {e.status === 'unban' ? '↑' : '⛔'}
          </span>
          {e.country && <span className="shrink-0">{FLAG(e.country)}</span>}
          <span className={`font-mono flex-1 truncate ${e.status === 'unban' ? 'text-gray-400' : 'text-gray-200'}`}>{e.ip}</span>
          <span className="text-gray-400 shrink-0 hidden sm:block">{e.jail}</span>
          <span className={`text-[10px] px-1.5 py-0.5 rounded-full shrink-0 ${
            e.status === 'unban' ? 'bg-gray-700 text-gray-300' : 'bg-rose-500/20 text-rose-400'
          }`}>{e.status === 'unban' ? 'expired' : 'banned'}</span>
          <span className="text-gray-400 shrink-0 whitespace-nowrap">{e.ts}</span>
        </div>
      ))}
    </Drawer>
  )
}

// ── Stat card (clickable or plain) ─────────────────────────────────────────

function StatCard({ value, label, color, onClick }) {
  const base = 'rounded-xl border px-4 py-3 text-left transition-all'
  const interactive = onClick
    ? 'bg-gray-900/60 border-gray-800 hover:border-gray-600 hover:bg-gray-800/60 cursor-pointer group'
    : 'bg-gray-900/60 border-gray-800'

  return (
    <div className={`${base} ${interactive}`} onClick={onClick} role={onClick ? 'button' : undefined} tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? e => (e.key === 'Enter' || e.key === ' ') && onClick() : undefined}>
      <div className={`text-2xl font-bold tabular-nums ${color}`}>{value}</div>
      <div className={`text-xs mt-1 flex items-center gap-1 ${onClick ? 'text-gray-500 group-hover:text-gray-400' : 'text-gray-600'}`}>
        {label}
        {onClick && <span className="opacity-0 group-hover:opacity-60 transition-opacity text-gray-400">↗</span>}
      </div>
    </div>
  )
}

// ── Jail card ──────────────────────────────────────────────────────────────

function JailCard({ jail, onUnban, geoData }) {
  const [expanded,    setExpanded]    = useState(false)
  const [unbanning,   setUnbanning]   = useState(null)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [history,     setHistory]     = useState(null)
  const [histLoading, setHistLoading] = useState(false)

  const isGeo = jail.name === 'geoblock'

  async function loadHistory(e) {
    e.stopPropagation()
    if (historyOpen) { setHistoryOpen(false); return }
    setHistoryOpen(true)
    if (history !== null) return   // already loaded
    setHistLoading(true)
    try {
      const r = await axios.get(`/api/f2b/jails/${encodeURIComponent(jail.name)}/ban_history`)
      setHistory(r.data)
    } catch { setHistory([]) }
    finally { setHistLoading(false) }
  }

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
    <div className="bg-gray-900/60 border border-gray-800 rounded-xl overflow-hidden">
      <button
        onClick={() => setExpanded(e => !e)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-800/40 transition-colors"
      >
        <div className="flex items-center gap-3 min-w-0">
          <span className="text-base shrink-0">{isGeo ? '🌍' : '🔒'}</span>
          <div className="text-left min-w-0">
            <div className="font-medium text-white text-sm">{jail.name}</div>
            <div className="text-xs text-gray-600 truncate hidden sm:block">
              {isGeo ? 'country / CIDR block jail' : jail.file_list || 'no log file'}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-4 sm:gap-6 shrink-0">
          <div className="text-center">
            <div className="text-sm font-bold text-rose-400 tabular-nums">
              {isGeo ? (geoData?.length ?? jail.currently_banned) : jail.currently_banned}
            </div>
            <div className="text-xs text-gray-600">{isGeo ? 'countries' : 'banned'}</div>
          </div>
          {!isGeo && (
            <>
              <div className="text-center hidden sm:block">
                <div className="text-sm font-bold text-amber-400 tabular-nums">{jail.currently_failed}</div>
                <div className="text-xs text-gray-600">failing</div>
              </div>
              <button
                onClick={loadHistory}
                className={`text-center hidden sm:block rounded-lg px-2 py-1 transition-colors ${historyOpen ? 'bg-gray-700/60 ring-1 ring-gray-600' : 'hover:bg-gray-800/60'}`}
                title="View full ban history"
              >
                <div className="text-sm font-bold text-gray-400 tabular-nums">{jail.total_banned}</div>
                <div className="text-xs text-gray-600">total ↗</div>
              </button>
            </>
          )}
          {isGeo && (
            <div className="text-center hidden sm:block">
              <div className="text-sm font-bold text-gray-400 tabular-nums">{jail.currently_banned}</div>
              <div className="text-xs text-gray-600">CIDRs</div>
            </div>
          )}
          <Chevron open={expanded} />
        </div>
      </button>
      {historyOpen && (
        <div className="border-t border-gray-800 p-4 space-y-2">
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Ban History</span>
            <span className="text-xs text-gray-600">{history?.length ?? '…'} events in log</span>
          </div>
          {histLoading ? (
            <div className="text-xs text-gray-600 text-center py-4">Loading…</div>
          ) : !history?.length ? (
            <div className="text-xs text-gray-600 text-center py-4">No ban events found in log</div>
          ) : (
            <div className="max-h-64 overflow-y-auto space-y-1">
              {history.map((e, i) => (
                <div key={i} className={`flex items-center gap-2 text-xs rounded-lg px-3 py-1.5 ${
                  e.status === 'unban' ? 'bg-gray-800/50' : 'bg-rose-900/15'
                }`}>
                  <span className={e.status === 'unban' ? 'text-gray-500' : 'text-rose-400'}>
                    {e.status === 'unban' ? '↑' : '⛔'}
                  </span>
                  {e.country && <span className="shrink-0">{FLAG(e.country)}</span>}
                  <span className={`font-mono flex-1 ${e.status === 'unban' ? 'text-gray-400' : 'text-gray-200'}`}>{e.ip}</span>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full shrink-0 ${
                    e.status === 'unban'
                      ? 'bg-gray-700 text-gray-300'
                      : 'bg-rose-500/20 text-rose-400'
                  }`}>{e.status === 'unban' ? 'expired' : 'banned'}</span>
                  <span className="text-gray-400 shrink-0 whitespace-nowrap">{e.ts}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {expanded && (
        <div className="border-t border-gray-800 p-4">
          {isGeo ? (
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
                        className="text-xs px-2.5 py-1 rounded-lg bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/40 transition-colors disabled:opacity-50"
                      >
                        {unbanning === b.country_code ? '…' : 'Unblock'}
                      </button>
                    </div>
                  ))}
                </div>
          ) : (
            <div className="space-y-4">
              {/* ── Currently Failing — only render if data is available ── */}
              {!!jail.failing_ips?.length && (
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-xs font-semibold text-amber-400 uppercase tracking-wider">Currently Failing</span>
                    <span className="text-xs bg-amber-500/20 text-amber-300 rounded-full px-2 py-0.5">{jail.failing_ips.length}</span>
                  </div>
                  <div className="space-y-1">
                    {jail.failing_ips.map((entry, i) => {
                      const maxFail = jail.maxretry || 5
                      const pct     = Math.min(100, Math.round((entry.failures / maxFail) * 100))
                      return (
                        <div key={i} className="bg-amber-900/15 border border-amber-900/30 rounded-lg px-3 py-2">
                          <div className="flex items-center justify-between mb-1">
                            <div className="flex items-center gap-2">
                              {entry.country && <span className="text-sm">{FLAG(entry.country)}</span>}
                              <span className="font-mono text-amber-300 text-sm">{entry.ip}</span>
                              {entry.country && <span className="text-xs text-gray-500">{countryName(entry.country)}</span>}
                            </div>
                            <span className="text-xs text-amber-400 tabular-nums font-medium">
                              {entry.failures} / {maxFail} failures
                            </span>
                          </div>
                          <div className="w-full bg-gray-800 rounded-full h-1">
                            <div
                              className={`h-1 rounded-full transition-all ${pct >= 80 ? 'bg-rose-500' : pct >= 50 ? 'bg-amber-500' : 'bg-amber-400/60'}`}
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}

              {/* ── Banned IPs ── */}
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-xs font-semibold text-rose-400 uppercase tracking-wider">Banned IPs</span>
                  {!!jail.banned_ips?.length && (
                    <span className="text-xs bg-rose-500/20 text-rose-300 rounded-full px-2 py-0.5">{jail.banned_ips.length}</span>
                  )}
                </div>
                {!jail.banned_ips?.length
                  ? <div className="text-gray-600 text-sm text-center py-2">No currently banned IPs</div>
                  : <div className="space-y-1">
                      {jail.banned_ips.map((entry, i) => (
                        <div key={i} className="bg-gray-800/60 rounded-lg px-3 py-2 space-y-0.5">
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-2 min-w-0">
                              {entry.country && <span className="text-sm shrink-0">{FLAG(entry.country)}</span>}
                              <span className="font-mono text-rose-300 text-sm">{entry.ip}</span>
                              {entry.country && <span className="text-xs text-gray-500 truncate">{countryName(entry.country)}</span>}
                              {entry.ban_count > 1 && (
                                <span className="text-[10px] bg-rose-500/20 text-rose-400 rounded-full px-1.5 py-0.5 shrink-0" title={`Banned ${entry.ban_count} times`}>
                                  ×{entry.ban_count}
                                </span>
                              )}
                            </div>
                            <button
                              onClick={() => handleUnban(entry.ip)}
                              disabled={unbanning === entry.ip}
                              className="text-xs px-2.5 py-1 rounded-lg bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/40 transition-colors disabled:opacity-50 shrink-0"
                            >
                              {unbanning === entry.ip ? '…' : 'Unban'}
                            </button>
                          </div>
                          {entry.banned_at && (
                            <div className="text-[10px] text-gray-600 pl-0.5">
                              Banned {new Date(entry.banned_at).toLocaleString()}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                }
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Breach detector panel ──────────────────────────────────────────────────

function BreachPanel({ stats, events, onAckOne, onAckAll, ackingId, ackingAll }) {
  const hasData = (stats?.total ?? 0) > 0 || events?.length > 0

  if (!hasData) {
    return (
      <div className="flex items-center gap-3 text-sm text-gray-500 py-3">
        <span className="w-2 h-2 rounded-full bg-emerald-400 shrink-0" />
        No bypass events detected — the WAF is blocking everything.
      </div>
    )
  }

  return (
    <div className="space-y-5">
      {/* Summary row */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-wrap gap-3">
          <div className="bg-gray-900/60 border border-gray-800 rounded-xl px-4 py-3">
            <div className="text-2xl font-bold text-purple-300 tabular-nums">{stats?.total ?? 0}</div>
            <div className="text-xs text-gray-600 mt-1">Total Bypasses</div>
          </div>
          {Object.entries(stats?.by_category ?? {}).map(([cat, n]) => (
            <div key={cat} className="bg-gray-900/60 border border-gray-800 rounded-xl px-4 py-3">
              <div className="text-2xl font-bold text-purple-200 tabular-nums">{n}</div>
              <div className="text-xs text-gray-600 mt-1">{cat}</div>
            </div>
          ))}
        </div>
        <button
          onClick={onAckAll}
          disabled={ackingAll}
          className="text-xs px-3 py-1.5 bg-gray-800 text-gray-400 hover:text-white hover:bg-gray-700 border border-gray-700 rounded-lg transition-colors disabled:opacity-50 shrink-0 mt-1"
        >
          {ackingAll ? 'Clearing…' : 'Acknowledge All'}
        </button>
      </div>

      {events?.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-gray-800">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-gray-900/80 text-gray-500 uppercase tracking-wider text-left border-b border-gray-800">
                <th className="px-3 py-2.5 font-medium">Time</th>
                <th className="px-3 py-2.5 font-medium">IP</th>
                <th className="px-3 py-2.5 font-medium hidden sm:table-cell">Method</th>
                <th className="px-3 py-2.5 font-medium">Path</th>
                <th className="px-3 py-2.5 font-medium hidden md:table-cell">Signature</th>
                <th className="px-3 py-2.5 font-medium">Severity</th>
                <th className="px-3 py-2.5 font-medium" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800/50">
              {events.slice(0, 50).map((e) => (
                <tr key={e.id ?? e.ts} className="hover:bg-purple-900/10 transition-colors">
                  <td className="px-3 py-2 text-gray-500 font-mono whitespace-nowrap">{fmtTime(e.ts)}</td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="font-mono text-sky-400">{e.client_ip}</span>
                      {e.client_ip && <IPRepBadge ip={e.client_ip} />}
                    </div>
                  </td>
                  <td className="px-3 py-2 font-mono text-gray-400 hidden sm:table-cell">{e.method}</td>
                  <td className="px-3 py-2 font-mono text-gray-300 max-w-[160px] truncate" title={e.path}>{e.path}</td>
                  <td className="px-3 py-2 text-purple-300 hidden md:table-cell">{e.sig_name}</td>
                  <td className="px-3 py-2"><SevBadge sev={e.severity} /></td>
                  <td className="px-3 py-2">
                    <button
                      onClick={() => onAckOne(e.id)}
                      disabled={ackingId === e.id}
                      className="text-xs px-2 py-0.5 rounded-md bg-gray-800 text-gray-500 hover:text-white hover:bg-gray-700 transition-colors disabled:opacity-40"
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
    </div>
  )
}

// ── Log feed ───────────────────────────────────────────────────────────────

function LogFeed({ selectedJail }) {
  const { data: logs } = useApi('/f2b/log', { lines: 100, ...(selectedJail ? { jail: selectedJail } : {}) }, 15000)
  if (!logs?.length) return <div className="text-gray-600 text-sm text-center py-6">No log entries</div>
  return (
    <div className="space-y-px max-h-72 overflow-y-auto font-mono text-xs rounded-xl border border-gray-800 bg-gray-950 p-2">
      {logs.map((entry, i) => (
        <div key={i} className="flex items-start gap-2 py-1 px-1.5 rounded hover:bg-gray-800/40 transition-colors">
          <span className="text-gray-600 shrink-0 w-36">{entry.ts}</span>
          <span className={`shrink-0 w-16 ${LEVEL_COLOR[entry.level] || 'text-gray-400'}`}>{entry.level}</span>
          {entry.jail && <span className="text-sky-500 shrink-0">[{entry.jail}]</span>}
          <span className="text-gray-300">{entry.message}</span>
        </div>
      ))}
    </div>
  )
}

// ── Section shell ──────────────────────────────────────────────────────────

function SectionShell({ icon, title, sub, badge, collapsed, onToggle, children }) {
  return (
    <div className="card p-0 overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-3 px-4 sm:px-5 py-4 hover:bg-gray-800/30 transition-colors group text-left"
      >
        {icon && <span className="text-lg sm:text-xl shrink-0">{icon}</span>}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2.5 flex-wrap">
            <span className="font-semibold text-white text-sm sm:text-base">{title}</span>
            {badge}
          </div>
          {sub && <div className="text-xs text-gray-500 mt-0.5 hidden sm:block">{sub}</div>}
        </div>
        <Chevron open={!collapsed} />
      </button>
      {!collapsed && (
        <div className="border-t border-gray-800 px-4 sm:px-5 py-5 space-y-5">
          {children}
        </div>
      )}
    </div>
  )
}

// ── Status badge ───────────────────────────────────────────────────────────

function StatusBadge({ running }) {
  return running
    ? <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500/20 text-emerald-300 text-xs font-semibold border border-emerald-500/20">
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 live-dot" />Running
      </span>
    : <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-rose-500/20 text-rose-300 text-xs font-semibold border border-rose-500/20">
        <span className="w-1.5 h-1.5 rounded-full bg-rose-400" />Down
      </span>
}

// ── Main ───────────────────────────────────────────────────────────────────

export default function SecurityTab({ period = '24h' }) {
  const [selectedJail, setSelectedJail] = useState('')
  const [activePanel, setPanel]         = useState(null)
  const [wafTesterAvailable, setWafTesterAvailable] = useState(null)

  const [f2bCollapsed,     setF2bCollapsed]     = useState(true)
  const [breachCollapsed,  setBreachCollapsed]  = useState(true)
  const [wafCollapsed,     setWafCollapsed]     = useState(true)
  const [wafTestCollapsed, setWafTestCollapsed] = useState(true)
  const [caCollapsed,      setCaCollapsed]      = useState(true)

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

  const { data: status, refetch: refetchStatus }  = useApi('/f2b/status',        {},         30000)
  const { data: jails,  refetch: refetchJails }   = useApi('/f2b/jails',         {},         30000)
  const { data: geoBlocked, refetch: refetchGeo } = useApi('/f2b/geo/blocked',   {},         30000)
  const { data: manualBanned }                    = useApi('/f2b/manual/banned', {},         30000)
  const { data: trafficCountries }                = useApi('/top_countries',     { period }, 60000)
  const { data: wafMode }                         = useApi('/waf/mode',          {},         60000)
  const { data: wafStats }                        = useApi('/waf/stats',         { since: '24h' }, 30000)
  const { data: wafRuns }                         = useApi('/waf-test/runs',     {},         30000)

  const displayJails = (jails ?? []).filter(j => j.name !== 'manual-ban')
  const nonGeoJails  = (jails ?? []).filter(j => j.name !== 'geoblock' && j.name !== 'manual-ban')
  const ipBannedCount         = nonGeoJails.reduce((s, j) => s + (j.banned_ips?.length ?? 0), 0)
  const countriesBlockedCount = geoBlocked?.countries?.length ?? 0
  const manualBannedCount     = manualBanned?.length ?? 0
  const totalFailed           = nonGeoJails.reduce((s, j) => s + j.currently_failed, 0)
  const totalAllTime          = nonGeoJails.reduce((s, j) => s + j.total_banned, 0)

  function refetch() { refetchStatus(); refetchJails() }

  // ── WAF header badge ─────────────────────────────────────────────────────
  const isBlocking = wafMode?.mode === 'On'
  const wafModeBadge = wafMode ? (
    isBlocking
      ? <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-rose-500/20 text-rose-300 text-xs font-semibold border border-rose-500/20">
          <span className="w-1.5 h-1.5 rounded-full bg-rose-400" />Blocking
        </span>
      : <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 text-xs font-semibold border border-amber-500/20">
          <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />Detection Only
        </span>
  ) : null

  // ── Breach header badge ──────────────────────────────────────────────────
  const breachCount = breachStats?.total ?? 0
  const breachBadge = (
    <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold border ${
      breachCount === 0
        ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/20'
        : 'bg-rose-500/20 text-rose-300 border-rose-500/20 animate-pulse'
    }`}>
      <span className={`w-1.5 h-1.5 rounded-full ${breachCount === 0 ? 'bg-emerald-400' : 'bg-rose-400'}`} />
      {breachCount} {breachCount === 1 ? 'bypass' : 'bypasses'}
    </span>
  )

  return (
    <div className="space-y-4">

      {/* Slide-in drawers */}
      {activePanel === 'countries' && (
        <CountriesPanel onClose={() => setPanel(null)} onRefetch={refetchGeo} />
      )}
      {activePanel === 'ips' && (
        <IPsPanel jails={jails} onRefetch={refetch} onClose={() => setPanel(null)} />
      )}
      {activePanel === 'manual' && (
        <ManualPanel onClose={() => setPanel(null)} banned={manualBanned} />
      )}
      {activePanel === 'history' && (
        <BanHistoryPanel jails={jails} onClose={() => setPanel(null)} />
      )}

      {/* ── 1. Fail2Ban ─────────────────────────────────────────────────────── */}
      <SectionShell
        icon="🛡️"
        title="Fail2Ban"
        sub={status?.socket || '/var/run/fail2ban/fail2ban.sock'}
        badge={
          <div className="flex items-center gap-2 flex-wrap">
            <StatusBadge running={status?.running} />
            {ipBannedCount > 0 && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-rose-500/10 text-rose-300 text-xs font-mono border border-rose-500/20">
                {ipBannedCount} IPs banned
              </span>
            )}
            {countriesBlockedCount > 0 && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-violet-500/10 text-violet-300 text-xs font-mono border border-violet-500/20">
                {countriesBlockedCount} countries
              </span>
            )}
          </div>
        }
        collapsed={f2bCollapsed}
        onToggle={() => setF2bCollapsed(c => !c)}
      >

        {!status?.running && (
          <div className="border border-rose-800 bg-rose-950/30 text-rose-300 text-sm rounded-xl px-4 py-3">
            ⚠️ fail2ban is not responding. Check that the daemon is running and the socket is mounted correctly.
          </div>
        )}

        {/* Stat grid — click-to-open drawers */}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <StatCard value={countriesBlockedCount} label="Countries Blocked" color="text-violet-400" onClick={() => setPanel('countries')} />
          <StatCard value={ipBannedCount}         label="IPs Banned"        color="text-rose-400"   onClick={() => setPanel('ips')} />
          <StatCard value={manualBannedCount}     label="Manual Blocks"     color="text-orange-400" onClick={() => setPanel('manual')} />
          <StatCard value={totalFailed}           label="Currently Failing" color="text-amber-400" />
          <StatCard value={totalAllTime.toLocaleString()} label="All-Time Bans"    color="text-gray-400" onClick={() => setPanel('history')} />
          <StatCard value={status?.jail_count ?? 0}       label="Active Jails"     color="text-sky-400" />
        </div>

        <Divider title="Geo Blocking" />
        <GeoBlock trafficCountries={trafficCountries ?? []} onBlock={refetchGeo} />

        <Divider title="Manual Block" />
        <ManualBan />

        <Divider title="Jail Config" />
        <JailManager activeJails={jails?.map(j => j.name) ?? []} onRefresh={refetch} />

        <Divider title="Active Jails" />
        <div className="space-y-2">
          {displayJails.length
            ? displayJails.map(jail => (
                <JailCard
                  key={jail.name}
                  jail={jail}
                  onUnban={refetch}
                  geoData={jail.name === 'geoblock' ? (geoBlocked?.countries ?? []) : undefined}
                />
              ))
            : <div className="text-gray-600 text-sm text-center py-4">No jails configured or fail2ban unreachable</div>
          }
        </div>

        <Divider title="Live Log" />
        <div>
          {jails?.length > 0 && (
            <div className="flex justify-end mb-2">
              <select
                value={selectedJail}
                onChange={e => setSelectedJail(e.target.value)}
                className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-xs text-gray-200 focus:outline-none focus:border-sky-500"
              >
                <option value="">All jails</option>
                {jails.map(j => <option key={j.name} value={j.name}>{j.name}</option>)}
              </select>
            </div>
          )}
          <LogFeed selectedJail={selectedJail} />
        </div>
      </SectionShell>

      {/* ── 2. WAF ──────────────────────────────────────────────────────────── */}
      <SectionShell
        icon="🔥"
        title="WAF — ModSecurity"
        sub="OWASP CRS — rule engine and event feed"
        badge={
          <div className="flex items-center gap-2 flex-wrap">
            {wafModeBadge}
            {wafStats && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-gray-700/60 text-gray-400 text-xs font-mono border border-gray-700">
                {(wafStats.total_events ?? 0).toLocaleString()} events
              </span>
            )}
            <a href="/api/waf/export.csv?since=24h" download
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-gray-800/60 text-gray-500 hover:text-gray-300 border border-gray-700 transition-colors"
              onClick={e => e.stopPropagation()}>
              ⬇ CSV
            </a>
          </div>
        }
        collapsed={wafCollapsed}
        onToggle={() => setWafCollapsed(c => !c)}
      >
        <WAFTab
          breachStats={breachStats}
          onBreachCollapse={() => {
            setBreachCollapsed(false)
            window.scrollTo({ top: 0, behavior: 'smooth' })
          }}
        />
      </SectionShell>

      {/* ── 3. Breach Detector ──────────────────────────────────────────────── */}
      <SectionShell
        icon="⚡"
        title="Breach Detector"
        sub="Attacks that bypassed the WAF and reached the backend"
        badge={
          <div className="flex items-center gap-2">
            {breachBadge}
            <a href="/api/breach/export.csv" download
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-gray-800/60 text-gray-500 hover:text-gray-300 border border-gray-700 transition-colors"
              onClick={e => e.stopPropagation()}>
              ⬇ CSV
            </a>
          </div>
        }
        collapsed={breachCollapsed}
        onToggle={() => setBreachCollapsed(c => !c)}
      >
        <BreachPanel
          stats={breachStats}
          events={breachEvents}
          onAckOne={ackOne}
          onAckAll={ackAll}
          ackingId={ackingId}
          ackingAll={ackingAll}
        />
      </SectionShell>

      {/* ── 4. WAF Test ─────────────────────────────────────────────────────── */}
      {wafTesterAvailable !== false && (
        <SectionShell

          icon="🧪"
          title="WAF Test"
          sub="Fire attack payloads and verify blocking behaviour"
          badge={(() => {
            const last = wafRuns?.[0]
            if (!last) return null
            return (
              <div className="flex items-center flex-wrap gap-2">
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-gray-700/60 text-gray-400 text-xs border border-gray-700">
                  {last.finished ? `last run ${fmtTime(last.finished)}` : '⏳ running…'}
                </span>
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-300 text-xs font-mono border border-emerald-500/20">
                  {last.passed ?? 0} pass
                </span>
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-rose-500/10 text-rose-300 text-xs font-mono border border-rose-500/20">
                  {last.failed ?? 0} fail
                </span>
              </div>
            )
          })()}
          collapsed={wafTestCollapsed}
          onToggle={() => setWafTestCollapsed(c => !c)}
        >
          {wafTesterAvailable === null
            ? <div className="text-gray-600 text-sm text-center py-4">Checking WAF tester…</div>
            : <WAFTestTab />
          }
        </SectionShell>
      )}

      {/* ── 5. Internal CA ──────────────────────────────────────────────────── */}
      <SectionShell
        icon="🔐"
        title="Internal CA"
        sub="Issue and manage TLS certificates for proxy hosts and containers"
        collapsed={caCollapsed}
        onToggle={() => setCaCollapsed(c => !c)}
      >
        <CAPanel />
      </SectionShell>

    </div>
  )
}
