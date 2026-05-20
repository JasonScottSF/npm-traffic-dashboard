import { useState, useEffect, useCallback } from 'react'
import axios from 'axios'
import { useApi } from '../hooks/useApi'
import StatCard from './StatCard'

// ── helpers ────────────────────────────────────────────────────────────────
function fmtBytes(b) {
  if (b == null) return '—'
  if (b >= 1e9) return (b / 1e9).toFixed(1) + ' GB'
  if (b >= 1e6) return (b / 1e6).toFixed(1) + ' MB'
  if (b >= 1e3) return (b / 1e3).toFixed(1) + ' KB'
  return b + ' B'
}

function pct(a, b) {
  if (!b) return '—'
  return (a / b * 100).toFixed(1) + '%'
}

// ── status dot ─────────────────────────────────────────────────────────────
const STATUS = {
  online:   { dot: 'bg-emerald-400', text: 'text-emerald-400', label: 'Online' },
  offline:  { dot: 'bg-red-400',     text: 'text-red-400',     label: 'Offline' },
  checking: { dot: 'bg-gray-500 animate-pulse', text: 'text-gray-500', label: 'Checking' },
}

function StatusDot({ status }) {
  const s = STATUS[status] ?? STATUS.checking
  return (
    <span className="flex items-center gap-1.5">
      <span className={`inline-block w-2 h-2 rounded-full ${s.dot}`} />
      <span className={`text-xs ${s.text}`}>{s.label}</span>
    </span>
  )
}

// ── host row ───────────────────────────────────────────────────────────────
function HostRow({ host, onDelete, onLabelSave, onToggleVisibility }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(host.label ?? '')

  const save = async () => {
    await onLabelSave(host.domain, draft)
    setEditing(false)
  }

  return (
    <tr className={`border-t border-gray-800 group ${host.hidden ? 'opacity-50' : ''}`}>
      <td className="px-4 py-2.5 whitespace-nowrap">
        <StatusDot status={host.status} />
      </td>
      <td className="px-4 py-2.5">
        <div className="flex items-center gap-2">
          <a
            href={host.url}
            target="_blank"
            rel="noopener noreferrer"
            className="font-mono text-sm text-sky-400 hover:text-sky-300 hover:underline"
          >
            {host.domain}
          </a>
          {host.hidden && (
            <span className="text-[10px] bg-gray-700/60 text-gray-500 px-1.5 py-0.5 rounded uppercase tracking-wider">hidden</span>
          )}
        </div>
      </td>
      <td className="px-4 py-2.5 min-w-[180px]">
        {editing ? (
          <div className="flex items-center gap-2">
            <input
              autoFocus
              className="bg-gray-800 border border-gray-600 rounded px-2 py-0.5 text-sm text-white w-full outline-none focus:border-sky-500"
              value={draft}
              onChange={e => setDraft(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') setEditing(false) }}
            />
            <button onClick={save} className="text-xs text-sky-400 hover:text-sky-300 shrink-0">Save</button>
            <button onClick={() => setEditing(false)} className="text-xs text-gray-500 hover:text-gray-300 shrink-0">✕</button>
          </div>
        ) : (
          <button
            onClick={() => { setDraft(host.label ?? ''); setEditing(true) }}
            className="text-sm text-gray-400 hover:text-white text-left w-full truncate group-hover:text-gray-300 transition-colors"
            title="Click to edit label"
          >
            {host.label || <span className="text-gray-700 italic">add label…</span>}
          </button>
        )}
      </td>
      <td className="px-4 py-2.5 hidden sm:table-cell">
        <span className={`inline-block text-[10px] font-medium uppercase tracking-wider px-1.5 py-0.5 rounded
          ${host.source === 'npm' ? 'bg-sky-500/15 text-sky-400' : 'bg-gray-700/60 text-gray-400'}`}>
          {host.source}
        </span>
      </td>
      <td className="px-4 py-2.5 text-right">
        <div className="flex items-center justify-end gap-3 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            onClick={() => onToggleVisibility(host.domain, !host.hidden)}
            className={`text-[11px] transition-colors ${host.hidden ? 'text-sky-500 hover:text-sky-300' : 'text-gray-600 hover:text-gray-300'}`}
          >
            {host.hidden ? 'Show' : 'Hide'}
          </button>
          {host.source === 'manual' && (
            <button
              onClick={() => onDelete(host.domain)}
              className="text-[11px] text-gray-600 hover:text-red-400 transition-colors"
            >
              Remove
            </button>
          )}
        </div>
      </td>
    </tr>
  )
}

// ── stats section ─────────────────────────────────────────────────────────
function LandingStats({ hosts, onNavigate }) {
  const [statsHost, setStatsHost] = useState('')

  // Pre-select www if present
  useEffect(() => {
    if (!statsHost && hosts.length > 0) {
      const www = hosts.find(h => h.domain.startsWith('www.'))
      setStatsHost(www?.domain ?? hosts[0]?.domain ?? '')
    }
  }, [hosts])

  const p = statsHost ? { period: '24h', host: statsHost } : { period: '24h' }
  const { data: summary } = useApi('/summary', p, 30000)
  const { data: jails }   = useApi('/f2b/jails', {}, 30000)

  const activeBans  = (jails ?? [])
    .filter(j => !['geoblock', 'manual-ban'].includes(j.name))
    .reduce((s, j) => s + (j.currently_banned ?? 0), 0)
  const geoBans     = (jails ?? []).find(j => j.name === 'geoblock')?.currently_banned ?? 0
  const errorRate   = summary ? pct(summary.error_count, summary.total_requests) : null

  const go = (tab, host) => {
    onNavigate({ tab, host: host ?? statsHost })
  }

  return (
    <div className="space-y-3">
      {/* Host selector */}
      <div className="flex items-center gap-3">
        <span className="text-xs text-gray-500 font-medium uppercase tracking-wider shrink-0">Stats for</span>
        <select
          className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-sm text-white outline-none focus:border-sky-500"
          value={statsHost}
          onChange={e => setStatsHost(e.target.value)}
        >
          <option value="">All hosts</option>
          {hosts.filter(h => !h.hidden).map(h => (
            <option key={h.domain} value={h.domain}>{h.domain}</option>
          ))}
        </select>
        <span className="text-xs text-gray-600">— last 24 h</span>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <StatCard
          label="Requests"
          value={summary?.total_requests?.toLocaleString()}
          delta={summary?.delta_requests}
          color="sky"
          icon="📊"
          onClick={() => go('overview')}
        />
        <StatCard
          label="Unique Visitors"
          value={summary?.unique_visitors?.toLocaleString()}
          color="violet"
          icon="👤"
          onClick={() => go('visitors')}
        />
        <StatCard
          label="Bandwidth"
          value={fmtBytes(summary?.total_bytes)}
          delta={summary?.delta_bytes}
          color="emerald"
          icon="📦"
          onClick={() => go('overview')}
        />
        <StatCard
          label="Errors"
          value={summary?.error_count?.toLocaleString()}
          sub={errorRate}
          delta={summary?.delta_errors != null ? -summary.delta_errors : null}
          color="rose"
          icon="⚠️"
          onClick={() => go('overview')}
        />
        <StatCard
          label="Bots"
          value={summary?.bot_count?.toLocaleString()}
          sub={summary ? pct(summary.bot_count, summary.total_requests) : null}
          color="amber"
          icon="🤖"
          onClick={() => go('tech')}
        />
        <StatCard
          label="Active Bans"
          value={activeBans.toLocaleString()}
          sub={geoBans ? `+${geoBans.toLocaleString()} geo` : null}
          color="fuchsia"
          icon="🚫"
          onClick={() => go('security', '')}
        />
      </div>
    </div>
  )
}

// ── main component ─────────────────────────────────────────────────────────
export default function LandingTab({ onNavigate }) {
  const [hosts,   setHosts]   = useState([])
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [error,   setError]   = useState(null)

  // Add-host form
  const [showForm, setShowForm] = useState(false)
  const [domain,   setDomain]   = useState('')
  const [label,    setLabel]    = useState('')
  const [url,      setUrl]      = useState('')
  const [saving,   setSaving]   = useState(false)

  const load = useCallback(async () => {
    try {
      const { data } = await axios.get('/api/landing/hosts/all')
      setHosts(data)
      setError(null)
    } catch {
      setError('Could not reach landing service')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
    const t = setInterval(load, 30000)
    return () => clearInterval(t)
  }, [load])

  const forceSync = async () => {
    setSyncing(true)
    try { await axios.post('/api/landing/sync') } catch {}
    await load()
    setSyncing(false)
  }

  const addHost = async () => {
    if (!domain.trim()) return
    setSaving(true)
    try {
      await axios.post('/api/landing/hosts/manual', {
        domain: domain.trim(),
        label:  label.trim(),
        url:    url.trim(),
      })
      setDomain(''); setLabel(''); setUrl('')
      setShowForm(false)
      await load()
    } catch {
      setError('Failed to add host')
    } finally {
      setSaving(false)
    }
  }

  const deleteHost = async (d) => {
    if (!confirm(`Remove "${d}" from manual hosts?`)) return
    await axios.delete(`/api/landing/hosts/manual/${encodeURIComponent(d)}`)
    await load()
  }

  const saveLabel = async (d, lbl) => {
    await axios.post(`/api/landing/hosts/${encodeURIComponent(d)}/label`, { label: lbl })
    await load()
  }

  const toggleVisibility = async (d, hidden) => {
    await axios.post(`/api/landing/hosts/${encodeURIComponent(d)}/visibility`, { hidden })
    await load()
  }

  const online  = hosts.filter(h => h.status === 'online').length
  const offline = hosts.filter(h => h.status === 'offline').length

  return (
    <div className="space-y-6">

      {/* ── Stats ─────────────────────────────────────────────────────────── */}
      {!loading && hosts.length > 0 && (
        <LandingStats hosts={hosts} onNavigate={onNavigate} />
      )}

      {/* ── Hosts header ──────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-4">
          <h2 className="text-sm font-semibold text-gray-200">Landing Page Hosts</h2>
          {!loading && (
            <div className="flex items-center gap-3 text-xs text-gray-500">
              <span><span className="text-emerald-400 font-medium">{online}</span> online</span>
              <span><span className="text-red-400 font-medium">{offline}</span> offline</span>
              <span className="text-gray-700">{hosts.length} total</span>
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={forceSync}
            disabled={syncing}
            className="px-3 py-1.5 text-xs rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-300 border border-gray-700 transition-colors disabled:opacity-50"
          >
            {syncing ? 'Syncing…' : '↻ Sync NPM'}
          </button>
          <button
            onClick={() => setShowForm(v => !v)}
            className="px-3 py-1.5 text-xs rounded-lg bg-sky-600 hover:bg-sky-500 text-white border border-sky-500/50 transition-colors"
          >
            {showForm ? 'Cancel' : '+ Add Host'}
          </button>
        </div>
      </div>

      {error && (
        <div className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-4 py-3">
          {error}
        </div>
      )}

      {/* ── Add host form ──────────────────────────────────────────────────── */}
      {showForm && (
        <div className="card p-4 space-y-3">
          <p className="text-xs text-gray-500 font-medium uppercase tracking-wider">Add Manual Host</p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Domain *</label>
              <input
                autoFocus
                className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-sm text-white outline-none focus:border-sky-500"
                placeholder="app.example.com"
                value={domain}
                onChange={e => setDomain(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && addHost()}
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Label</label>
              <input
                className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-sm text-white outline-none focus:border-sky-500"
                placeholder="My App"
                value={label}
                onChange={e => setLabel(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && addHost()}
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">URL override</label>
              <input
                className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-sm text-white outline-none focus:border-sky-500"
                placeholder="https://… (optional)"
                value={url}
                onChange={e => setUrl(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && addHost()}
              />
            </div>
          </div>
          <div className="flex gap-2">
            <button
              onClick={addHost}
              disabled={saving || !domain.trim()}
              className="px-4 py-1.5 text-xs rounded-lg bg-sky-600 hover:bg-sky-500 text-white transition-colors disabled:opacity-50"
            >
              {saving ? 'Adding…' : 'Add Host'}
            </button>
            <button
              onClick={() => setShowForm(false)}
              className="px-4 py-1.5 text-xs rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-300 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* ── Hosts table ───────────────────────────────────────────────────── */}
      <div className="card p-0 overflow-hidden">
        {loading ? (
          <div className="py-12 text-center text-sm text-gray-600">Loading…</div>
        ) : hosts.length === 0 ? (
          <div className="py-12 text-center text-sm text-gray-600">No hosts configured</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-gray-500 uppercase tracking-wider">
                  <th className="px-4 py-2.5 font-medium">Status</th>
                  <th className="px-4 py-2.5 font-medium">Domain</th>
                  <th className="px-4 py-2.5 font-medium">Label</th>
                  <th className="px-4 py-2.5 font-medium hidden sm:table-cell">Source</th>
                  <th className="px-4 py-2.5 font-medium text-right"></th>
                </tr>
              </thead>
              <tbody>
                {hosts.map(h => (
                  <HostRow
                    key={h.domain}
                    host={h}
                    onDelete={deleteHost}
                    onLabelSave={saveLabel}
                    onToggleVisibility={toggleVisibility}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <p className="text-xs text-gray-700">
        NPM-synced hosts are managed in Nginx Proxy Manager. Labels can be edited inline for any host.
      </p>
    </div>
  )
}
