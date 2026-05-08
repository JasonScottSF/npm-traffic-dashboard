import { useState, useEffect, useRef } from 'react'
import axios from 'axios'

const PERIODS = [
  { label: '24h',  value: '24h' },
  { label: '3d',   value: '3d' },
  { label: '7d',   value: '7d' },
  { label: '30d',  value: '30d' },
  { label: '90d',  value: '90d' },
  { label: '180d', value: '180d' },
  { label: '360d', value: '360d' },
]

const STATUS_COLOR = s =>
  s >= 500 ? 'text-rose-400' :
  s >= 400 ? 'text-amber-400' :
  s >= 300 ? 'text-sky-400' :
             'text-emerald-400'

const METHOD_COLOR = m =>
  m === 'GET'    ? 'bg-sky-500/20 text-sky-300' :
  m === 'POST'   ? 'bg-emerald-500/20 text-emerald-300' :
  m === 'PUT'    ? 'bg-amber-500/20 text-amber-300' :
  m === 'DELETE' ? 'bg-rose-500/20 text-rose-300' :
  m === 'PATCH'  ? 'bg-violet-500/20 text-violet-300' :
                   'bg-gray-700 text-gray-300'

function fmtBytes(b) {
  if (!b) return '0 B'
  if (b > 1e9)  return `${(b / 1e9).toFixed(2)} GB`
  if (b > 1e6)  return `${(b / 1e6).toFixed(1)} MB`
  if (b > 1e3)  return `${(b / 1e3).toFixed(1)} KB`
  return `${b} B`
}

function fmtMs(ms) {
  if (ms == null) return '—'
  if (ms >= 1000) return `${(ms / 1000).toFixed(1)}s`
  return `${Math.round(ms)}ms`
}

export default function SearchTab() {
  const [query,   setQuery]   = useState('')
  const [period,  setPeriod]  = useState('24h')
  const [results, setResults] = useState(null)   // null = untouched
  const [loading, setLoading] = useState(false)
  const debounceRef = useRef(null)

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)

    if (query.length < 3) {
      setResults(null)
      return
    }

    debounceRef.current = setTimeout(async () => {
      setLoading(true)
      try {
        const { data } = await axios.get('/api/search', {
          params: { q: query, period, limit: 200 },
        })
        setResults(data)
      } catch {
        setResults([])
      } finally {
        setLoading(false)
      }
    }, 400)

    return () => clearTimeout(debounceRef.current)
  }, [query, period])

  const placeholder = results === null
    ? 'Type to search…'
    : results.length === 0
    ? 'No results'
    : null

  return (
    <div className="space-y-4">
      {/* Search controls */}
      <div className="card flex flex-wrap items-center gap-3">
        <span className="text-lg">🔍</span>
        <input
          type="text"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Search path, IP, host, user-agent…"
          className="flex-1 min-w-[200px] bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-sky-500 transition-colors"
          autoFocus
        />

        {/* Period selector */}
        <div className="flex bg-gray-800 rounded-lg p-0.5 gap-0.5">
          {PERIODS.map(p => (
            <button
              key={p.value}
              onClick={() => setPeriod(p.value)}
              className={`px-2 py-1 rounded-md text-xs font-medium transition-colors
                ${period === p.value ? 'bg-sky-500 text-white' : 'text-gray-400 hover:text-white'}`}
            >
              {p.label}
            </button>
          ))}
        </div>

        {/* Result count / spinner */}
        <div className="text-xs text-gray-600 shrink-0 w-24 text-right">
          {loading ? (
            <span className="animate-pulse text-sky-400">Searching…</span>
          ) : results !== null ? (
            <span>{results.length} result{results.length !== 1 ? 's' : ''}</span>
          ) : query.length > 0 && query.length < 3 ? (
            <span className="text-amber-500">3 chars min</span>
          ) : null}
        </div>
      </div>

      {/* Placeholder states */}
      {!loading && results === null && (
        <div className="card text-center text-gray-600 py-12 text-sm">
          {query.length === 0
            ? 'Enter at least 3 characters to search traffic logs'
            : 'Keep typing…'}
        </div>
      )}

      {!loading && results !== null && results.length === 0 && (
        <div className="card text-center text-gray-600 py-12 text-sm">
          No results for <span className="font-mono text-gray-400">{query}</span> in the last {period}
        </div>
      )}

      {/* Results table */}
      {results !== null && results.length > 0 && (
        <div className="card overflow-hidden p-0">
          <div className="px-4 py-3 border-b border-gray-800 flex items-center gap-2">
            <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-widest">Results</h2>
            <span className="text-xs text-gray-600">{results.length} rows</span>
          </div>
          <div className="overflow-x-auto max-h-[70vh] overflow-y-auto">
            <table className="w-full text-[11px]">
              <thead className="sticky top-0 bg-gray-900 z-10">
                <tr className="text-gray-600 border-b border-gray-800 uppercase tracking-wider text-left">
                  <th className="px-3 py-2 font-medium whitespace-nowrap">Time</th>
                  <th className="px-3 py-2 font-medium">Host</th>
                  <th className="px-3 py-2 font-medium">Method</th>
                  <th className="px-3 py-2 font-medium">IP</th>
                  <th className="px-3 py-2 font-medium">Path</th>
                  <th className="px-3 py-2 font-medium text-right">Status</th>
                  <th className="px-3 py-2 font-medium text-right">Time</th>
                </tr>
              </thead>
              <tbody>
                {results.map((r, i) => (
                  <tr key={i} className="border-b border-gray-800/40 last:border-0 hover:bg-gray-800/20">
                    <td className="px-3 py-2 text-gray-600 whitespace-nowrap font-mono">
                      {new Date(r.ts).toLocaleString('en-US', {
                        month: 'short', day: '2-digit',
                        hour: '2-digit', minute: '2-digit', second: '2-digit',
                        hour12: false,
                      })}
                    </td>
                    <td className="px-3 py-2">
                      <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-sky-500/15 text-sky-300 font-mono text-[10px] max-w-[150px] truncate" title={r.host}>
                        {r.host ?? '—'}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold ${METHOD_COLOR(r.method)}`}>
                        {r.method}
                      </span>
                    </td>
                    <td className="px-3 py-2 font-mono text-gray-400 whitespace-nowrap">
                      {r.client_ip}
                      {r.country_code && (
                        <span className="ml-1 text-gray-600">{r.country_code}</span>
                      )}
                    </td>
                    <td className="px-3 py-2 font-mono text-gray-300 max-w-[300px] truncate" title={r.path}>
                      {r.path}
                    </td>
                    <td className={`px-3 py-2 text-right font-mono font-bold ${STATUS_COLOR(r.status_code)}`}>
                      {r.status_code}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-gray-500 whitespace-nowrap">
                      {fmtMs(r.response_time_ms)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
