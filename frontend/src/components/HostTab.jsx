import { useState, useEffect, useRef } from 'react'
import { useApi } from '../hooks/useApi'
import axios from 'axios'
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, RadialBarChart, RadialBar } from 'recharts'

function fmtTime(iso) {
  if (!iso) return '—'
  try {
    return new Intl.DateTimeFormat('en-US', {
      month: 'short', day: '2-digit',
      hour: '2-digit', minute: '2-digit',
      hour12: false,
    }).format(new Date(iso))
  } catch { return iso }
}

function fmtDur(s) {
  if (s == null) return '—'
  if (s < 60) return `${s}s`
  return `${Math.floor(s / 60)}m ${s % 60}s`
}

function UpgradeChevron({ open }) {
  return (
    <svg className={`w-4 h-4 text-gray-500 shrink-0 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
      fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
    </svg>
  )
}

function SystemUpdates() {
  const { data, error } = useApi('/system/upgrades', {}, 0)
  const [triggering, setTriggering]   = useState(false)
  const [triggerMsg, setTriggerMsg]   = useState(null)
  const [openId, setOpenId]           = useState(null)

  async function handleTrigger() {
    setTriggering(true)
    setTriggerMsg(null)
    try {
      const res = await fetch('/api/system/upgrade', { method: 'POST' })
      if (res.ok) {
        setTriggerMsg('Update queued — check back in a few minutes.')
      } else {
        const body = await res.json().catch(() => ({}))
        setTriggerMsg(`Failed${body.detail ? ': ' + body.detail : ' (HTTP ' + res.status + ')'}`)
      }
    } catch {
      setTriggerMsg('Failed to queue update.')
    } finally {
      setTriggering(false)
    }
  }

  const history = data ?? []

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-widest">System Updates</h2>
        <div className="flex items-center gap-3 flex-wrap">
          {triggerMsg && <span className="text-xs text-gray-500">{triggerMsg}</span>}
          <button
            onClick={handleTrigger}
            disabled={triggering}
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium bg-blue-600/20 text-blue-300 border border-blue-600/30 hover:bg-blue-600/30 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {triggering ? (
              <>
                <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4l3-3-3-3v4a8 8 0 00-8 8h4z"/>
                </svg>
                Queuing…
              </>
            ) : 'Run apt upgrade'}
          </button>
        </div>
      </div>

      {history.length === 0 ? (
        <p className="text-gray-600 text-sm text-center py-4">
          {error ? 'Could not load upgrade history.' : 'No upgrade history yet — runs daily at 3 AM or on demand.'}
        </p>
      ) : (
        <div className="space-y-1.5">
          {history.map(run => {
            const pkgList  = run.packages && run.packages !== '(none)' ? run.packages.split('\n').filter(Boolean) : []
            const isOpen   = openId === run.id
            return (
              <div key={run.id} className="border border-gray-800 rounded-lg overflow-hidden">
                <button
                  onClick={() => setOpenId(isOpen ? null : run.id)}
                  className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-gray-800/30 transition-colors text-left"
                >
                  <span className={`w-2 h-2 rounded-full shrink-0 ${run.exit_code === 0 ? 'bg-emerald-400' : 'bg-rose-400'}`} />
                  <span className="text-xs text-gray-400 whitespace-nowrap font-mono">{fmtTime(run.ts)}</span>
                  <span className="text-xs text-gray-600 flex-1">
                    {pkgList.length > 0
                      ? `${pkgList.length} package${pkgList.length !== 1 ? 's' : ''} upgraded`
                      : 'No packages upgraded'}
                  </span>
                  {run.duration_s != null && (
                    <span className="text-xs text-gray-700 font-mono shrink-0">{fmtDur(run.duration_s)}</span>
                  )}
                  <UpgradeChevron open={isOpen} />
                </button>

                {isOpen && (
                  <div className="border-t border-gray-800 px-3 py-3">
                    {run.exit_code !== 0 ? (
                      <div className="space-y-1">
                        <div className="text-xs text-rose-400 font-medium mb-1">Command failed (exit {run.exit_code})</div>
                        {run.stdout && (
                          <pre className="text-xs text-gray-500 whitespace-pre-wrap font-mono bg-gray-900/60 rounded p-2 max-h-48 overflow-y-auto">
                            {run.stdout.trim().split('\n').slice(-20).join('\n')}
                          </pre>
                        )}
                      </div>
                    ) : pkgList.length > 0 ? (
                      <div className="space-y-0.5">
                        {pkgList.map((p, i) => (
                          <div key={i} className="font-mono text-xs text-gray-400">{p}</div>
                        ))}
                      </div>
                    ) : (
                      <div className="text-xs text-gray-600">System already up to date.</div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}


function fmtBytes(b, decimals = 1) {
  if (!b) return '0 B'
  if (b > 1e12) return `${(b / 1e12).toFixed(decimals)} TB`
  if (b > 1e9)  return `${(b / 1e9).toFixed(decimals)} GB`
  if (b > 1e6)  return `${(b / 1e6).toFixed(decimals)} MB`
  if (b > 1e3)  return `${(b / 1e3).toFixed(decimals)} KB`
  return `${b} B`
}

function GaugeBar({ value, label, color = 'bg-sky-500', warn = 70, crit = 90 }) {
  const cls = value >= crit ? 'bg-rose-500' : value >= warn ? 'bg-amber-500' : color
  return (
    <div>
      <div className="flex justify-between text-sm mb-1">
        <span className="text-gray-400">{label}</span>
        <span className="font-bold text-white">{value?.toFixed(1)}%</span>
      </div>
      <div className="w-full bg-gray-800 rounded-full h-3 overflow-hidden">
        <div
          className={`h-3 rounded-full transition-all duration-500 ${cls}`}
          style={{ width: `${Math.min(value ?? 0, 100)}%` }}
        />
      </div>
    </div>
  )
}

function Sparkline({ data, dataKey, color }) {
  if (!data?.length) return null
  return (
    <ResponsiveContainer width="100%" height={48} minHeight={48}>
      <AreaChart data={data} margin={{ top: 2, right: 0, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id={`sg_${dataKey}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor={color} stopOpacity={0.3} />
            <stop offset="95%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <Area type="monotone" dataKey={dataKey} stroke={color} fill={`url(#sg_${dataKey})`} strokeWidth={1.5} dot={false} />
        <Tooltip
          contentStyle={{ background: '#111827', border: '1px solid #374151', borderRadius: 6, fontSize: 11 }}
          formatter={v => [`${v?.toFixed(1)}%`]}
          labelFormatter={() => ''}
        />
      </AreaChart>
    </ResponsiveContainer>
  )
}

function TempBadge({ reading }) {
  const cls = reading.critical && reading.current >= reading.critical
    ? 'bg-rose-500/20 text-rose-300 border-rose-500/30'
    : reading.high && reading.current >= reading.high
    ? 'bg-amber-500/20 text-amber-300 border-amber-500/30'
    : 'bg-sky-500/10 text-sky-300 border-sky-500/20'

  return (
    <div className={`border rounded-lg p-3 text-center ${cls}`}>
      <div className="text-2xl font-bold">{reading.current?.toFixed(0)}°</div>
      <div className="text-xs mt-0.5 opacity-80 truncate">{reading.label}</div>
      {reading.high && <div className="text-xs opacity-50">high {reading.high}°</div>}
    </div>
  )
}

function fmtBytesHost(b, decimals = 1) {
  if (!b) return '0 B'
  if (b > 1e9)  return `${(b / 1e9).toFixed(decimals)} GB`
  if (b > 1e6)  return `${(b / 1e6).toFixed(decimals)} MB`
  if (b > 1e3)  return `${(b / 1e3).toFixed(decimals)} KB`
  return `${b} B`
}

function ProxyHostActivity() {
  const [data, setData] = useState(null)

  useEffect(() => {
    async function load() {
      try {
        const { data: rows } = await axios.get('/api/host_traffic_now')
        setData(rows)
      } catch {
        setData([])
      }
    }
    load()
    const t = setInterval(load, 15000)
    return () => clearInterval(t)
  }, [])

  const errColor = (errors, rpm) => {
    if (!errors || errors === 0) return 'text-emerald-400'
    if (rpm > 0 && errors / rpm > 0.1) return 'text-rose-400'
    return 'text-amber-400'
  }

  return (
    <div className="card">
      <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-widest mb-3">
        Proxy Host Activity
        <span className="ml-2 text-xs font-normal text-gray-600 normal-case tracking-normal">last 5 min · refreshes every 15s</span>
      </h2>

      {data === null && (
        <div className="text-xs text-gray-600 animate-pulse py-2">Loading…</div>
      )}

      {data !== null && data.length === 0 && (
        <div className="text-gray-600 text-sm text-center py-4">No active hosts in the last 5 minutes</div>
      )}

      {data !== null && data.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-gray-600 border-b border-gray-800 uppercase tracking-wider text-left">
                <th className="pb-2 pr-4 font-medium">Host</th>
                <th className="pb-2 pr-4 font-medium text-right">Req / 5min</th>
                <th className="pb-2 pr-4 font-medium text-right">Bandwidth</th>
                <th className="pb-2 font-medium text-right">Errors</th>
              </tr>
            </thead>
            <tbody>
              {data.map((r, i) => (
                <tr key={i} className="border-b border-gray-800/40 last:border-0 hover:bg-gray-800/20">
                  <td className="py-1.5 pr-4 font-mono text-sky-400 max-w-[220px] truncate" title={r.host}>{r.host}</td>
                  <td className="py-1.5 pr-4 text-right tabular-nums text-gray-300 font-bold">{r.rpm.toLocaleString()}</td>
                  <td className="py-1.5 pr-4 text-right tabular-nums text-gray-400">{fmtBytesHost(r.bytes)}</td>
                  <td className={`py-1.5 text-right tabular-nums font-bold ${errColor(r.errors, r.rpm)}`}>
                    {r.errors > 0 ? r.errors.toLocaleString() : <span className="text-gray-700">0</span>}
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

function UptimeSummary() {
  const [summary, setSummary] = useState(null)
  const [expanded, setExpanded] = useState(null)      // host string | null
  const [historyData, setHistoryData] = useState({})  // { [host]: probe[] }
  const [loadingHistory, setLoadingHistory] = useState({})

  useEffect(() => {
    async function load() {
      try {
        const { data } = await axios.get('/api/uptime/summary')
        setSummary(data)
      } catch {
        setSummary([])
      }
    }
    load()
    const t = setInterval(load, 60000)
    return () => clearInterval(t)
  }, [])

  async function toggleHost(host) {
    if (expanded === host) {
      setExpanded(null)
      return
    }
    setExpanded(host)
    if (historyData[host]) return
    setLoadingHistory(prev => ({ ...prev, [host]: true }))
    try {
      const { data } = await axios.get(`/api/uptime/history?host=${encodeURIComponent(host)}&hours=24`)
      setHistoryData(prev => ({ ...prev, [host]: data }))
    } catch {
      setHistoryData(prev => ({ ...prev, [host]: [] }))
    } finally {
      setLoadingHistory(prev => ({ ...prev, [host]: false }))
    }
  }

  if (!summary) return (
    <div className="card">
      <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-widest mb-3">Proxy Host Uptime</h2>
      <div className="text-gray-600 text-sm text-center py-4 animate-pulse">Loading…</div>
    </div>
  )

  if (!summary.length) return (
    <div className="card">
      <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-widest mb-3">Proxy Host Uptime</h2>
      <div className="text-gray-600 text-sm text-center py-4">No hosts with uptime monitoring enabled</div>
    </div>
  )

  return (
    <div className="card">
      <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-widest mb-3">Proxy Host Uptime</h2>
      <div className="space-y-1.5">
        {summary.map(host => {
          const isOk = host.status === 'up'
          const avail = host.availability_24h
          const isExpanded = expanded === host.host
          const probes = historyData[host.host] ?? []
          const okProbes = probes.filter(p => p.ok).length
          const avgMs = probes.length > 0
            ? Math.round(probes.filter(p => p.response_ms != null).reduce((s, p) => s + p.response_ms, 0) / Math.max(probes.filter(p => p.response_ms != null).length, 1))
            : null

          return (
            <div key={host.host} className="border border-gray-800 rounded-lg overflow-hidden">
              <button
                onClick={() => toggleHost(host.host)}
                className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-gray-800/30 transition-colors text-left"
              >
                <span className={`w-2 h-2 rounded-full shrink-0 ${host.last_outage ? 'bg-rose-400' : 'bg-emerald-400'}`} />
                <span className="font-mono text-sky-400 text-xs flex-1 truncate">{host.host}</span>
                {avail != null && (
                  <span className={`text-xs font-mono shrink-0 ${avail >= 99 ? 'text-emerald-400' : avail >= 95 ? 'text-amber-400' : 'text-rose-400'}`}>
                    {avail}%
                  </span>
                )}
                <svg className={`w-4 h-4 text-gray-500 shrink-0 transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`}
                  fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                </svg>
              </button>

              {isExpanded && (
                <div className="border-t border-gray-800 px-3 py-3 space-y-2">
                  {loadingHistory[host.host] ? (
                    <div className="text-gray-600 text-xs animate-pulse">Loading history…</div>
                  ) : probes.length === 0 ? (
                    <div className="text-gray-600 text-xs">No probe data in the last 24h</div>
                  ) : (
                    <>
                      {/* Timeline bar */}
                      <div className="overflow-x-auto">
                        <div className="flex gap-0.5 min-w-max">
                          {probes.map((p, i) => (
                            <span
                              key={i}
                              title={`${p.ts.slice(0, 16).replace('T', ' ')} — ${p.ok ? `HTTP ${p.status_code}` : 'Error'} ${p.response_ms != null ? `(${Math.round(p.response_ms)}ms)` : ''}`}
                              className={`inline-block w-2 h-4 rounded-sm shrink-0 ${p.ok ? 'bg-emerald-500' : 'bg-rose-500'}`}
                            />
                          ))}
                        </div>
                      </div>
                      <div className="flex gap-4 text-xs text-gray-500">
                        <span>Availability: <span className="text-white">{probes.length ? ((okProbes / probes.length) * 100).toFixed(1) : '—'}%</span></span>
                        {avgMs != null && <span>Avg response: <span className="text-white">{avgMs}ms</span></span>}
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

export default function HostTab() {
  const { data: stats } = useApi('/sys/stats', {}, 5000)
  const historyRef = useRef([])
  const [history, setHistory] = useState([])

  useEffect(() => {
    if (!stats) return
    const point = { t: Date.now(), cpu: stats.cpu.percent, mem: stats.memory.percent }
    historyRef.current = [...historyRef.current.slice(-59), point]
    setHistory([...historyRef.current])
  }, [stats])

  const cpu = stats?.cpu
  const mem = stats?.memory
  const swap = stats?.swap
  const ifaces = stats?.net?.interfaces ?? []
  const temps = stats?.temps ?? {}
  const allTemps = Object.values(temps).flat()
  const procs = stats?.processes ?? []
  const disks = (stats?.disks ?? []).filter(d => d.total > 0)

  return (
    <div className="space-y-6">
      {/* Top stat row */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {[
          { label: 'Uptime',    value: stats?.uptime ?? '—',            color: 'sky',     icon: '⏱️' },
          { label: 'CPU',       value: cpu ? `${cpu.percent.toFixed(1)}%` : '—', color: cpu?.percent > 90 ? 'rose' : cpu?.percent > 70 ? 'amber' : 'emerald', icon: '⚙️' },
          { label: 'Memory',    value: mem ? `${mem.percent.toFixed(1)}%` : '—', color: mem?.percent > 90 ? 'rose' : mem?.percent > 70 ? 'amber' : 'violet', icon: '🧠' },
        ].map(({ label, value, color, icon }) => (
          <div key={label} className={`bg-gradient-to-br border rounded-xl p-4 flex flex-col gap-2
            ${color === 'sky' ? 'from-sky-500/20 to-sky-600/5 border-sky-500/30' :
              color === 'emerald' ? 'from-emerald-500/20 to-emerald-600/5 border-emerald-500/30' :
              color === 'violet' ? 'from-violet-500/20 to-violet-600/5 border-violet-500/30' :
              color === 'rose' ? 'from-rose-500/20 to-rose-600/5 border-rose-500/30' :
              color === 'amber' ? 'from-amber-500/20 to-amber-600/5 border-amber-500/30' :
              'from-fuchsia-500/20 to-fuchsia-600/5 border-fuchsia-500/30'}`}>
            <div className="flex justify-between"><span className="text-xs text-gray-400 uppercase tracking-widest">{label}</span><span>{icon}</span></div>
            <div className="text-2xl font-bold text-white">{value}</div>
          </div>
        ))}
      </div>

      {/* Proxy Host Activity */}
      <ProxyHostActivity />

      {/* Proxy Host Uptime History */}
      <UptimeSummary />

      {/* CPU + Memory charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="card">
          <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-widest mb-3">CPU</h2>
          <GaugeBar value={cpu?.percent} label={`${cpu?.freq_mhz ?? '—'} MHz`} color="bg-sky-500" />
          {cpu && <div className="flex gap-4 mt-3 text-xs text-gray-500">
            <span>Load 1m: <span className="text-gray-300">{cpu.load_1?.toFixed(2)}</span></span>
            <span>5m: <span className="text-gray-300">{cpu.load_5?.toFixed(2)}</span></span>
            <span>15m: <span className="text-gray-300">{cpu.load_15?.toFixed(2)}</span></span>
          </div>}
          <div className="mt-3">
            <Sparkline data={history} dataKey="cpu" color="#38bdf8" />
          </div>
        </div>

        <div className="card">
          <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-widest mb-3">Memory</h2>
          <GaugeBar value={mem?.percent} label={`${fmtBytes(mem?.used)} / ${fmtBytes(mem?.total)}`} color="bg-violet-500" />
          {swap?.total > 0 && (
            <div className="mt-3">
              <GaugeBar value={swap.percent} label={`Swap ${fmtBytes(swap.used)} / ${fmtBytes(swap.total)}`} color="bg-fuchsia-500" />
            </div>
          )}
          <div className="mt-3">
            <Sparkline data={history} dataKey="mem" color="#a78bfa" />
          </div>
        </div>
      </div>

      {/* Disk */}
      {disks.length > 0 && (
        <div className="card">
          <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-widest mb-3">Disk</h2>
          <div className="space-y-3">
            {disks.map(d => {
              const color = d.percent >= 90 ? 'bg-rose-500' : d.percent >= 70 ? 'bg-amber-500' : 'bg-emerald-500'
              const usedGB = (d.used / 1e9).toFixed(1)
              const totalGB = (d.total / 1e9).toFixed(1)
              return (
                <div key={d.mountpoint}>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="text-gray-400 font-mono">{d.mountpoint}</span>
                    <span className="font-bold text-white">{usedGB} GB of {totalGB} GB ({d.percent.toFixed(1)}%)</span>
                  </div>
                  <div className="w-full bg-gray-800 rounded-full h-3 overflow-hidden">
                    <div
                      className={`h-3 rounded-full transition-all duration-500 ${color}`}
                      style={{ width: `${Math.min(d.percent, 100)}%` }}
                    />
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Network */}
      <div className="grid grid-cols-1 gap-4">
        <div className="card">
          <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-widest mb-3">Network Interfaces</h2>
          <div className="space-y-3">
            {ifaces.filter(i => i.bytes_recv > 0 || i.bytes_sent > 0).map(iface => (
              <div key={iface.name} className="border border-gray-800 rounded-lg p-3">
                <div className="flex justify-between items-center mb-1">
                  <span className="font-mono text-sky-400 text-sm">{iface.name}</span>
                  {iface.ip && <span className="font-mono text-gray-500 text-xs">{iface.ip}</span>}
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="text-gray-500">↓ <span className="text-emerald-400">{fmtBytes(iface.bytes_recv)}</span></div>
                  <div className="text-gray-500">↑ <span className="text-sky-400">{fmtBytes(iface.bytes_sent)}</span></div>
                  {(iface.errin > 0 || iface.errout > 0) && (
                    <div className="col-span-2 text-rose-400">Errors in: {iface.errin} out: {iface.errout}</div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Temps */}
      {allTemps.length > 0 && (
        <div className="card">
          <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-widest mb-3">Temperatures</h2>
          <div className="grid grid-cols-3 sm:grid-cols-6 lg:grid-cols-8 gap-2">
            {allTemps.map((r, i) => <TempBadge key={i} reading={r} />)}
          </div>
        </div>
      )}

      {/* System updates */}
      <SystemUpdates />

      {/* Top processes */}
      <div className="card">
        <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-widest mb-3">Top Processes by CPU</h2>
        <div className="overflow-x-auto">
          <div className="space-y-1 min-w-[400px]">
            {procs.map(p => (
              <div key={p.pid} className="flex items-center gap-3 text-sm py-1 border-b border-gray-800/50">
                <span className="text-gray-600 w-12 text-right font-mono text-xs">{p.pid}</span>
                <span className="text-gray-300 flex-1 truncate">{p.name}</span>
                <span className={`font-mono text-xs w-14 text-right ${p.cpu > 50 ? 'text-rose-400' : p.cpu > 20 ? 'text-amber-400' : 'text-sky-400'}`}>{p.cpu.toFixed(1)}%</span>
                <span className="text-gray-500 font-mono text-xs w-16 text-right">{p.mem_mb} MB</span>
                <span className="text-gray-700 text-xs w-16">{p.status}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
