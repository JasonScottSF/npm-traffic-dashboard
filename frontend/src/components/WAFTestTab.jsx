/**
 * WAFTestTab.jsx
 *
 * UI for the WAF tester + breach detector services.
 * Lets you fire a test suite against the WAF and see which payloads
 * were blocked, passed, false-positived, or breached (WAF returned 403
 * but the payload still arrived at the backend).
 */

import { useState, useEffect, useRef, useCallback } from 'react'
import axios from 'axios'

// ── Helpers ────────────────────────────────────────────────────────────────────

function cls(...args) { return args.filter(Boolean).join(' ') }

function fmtTime(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

function fmtDuration(startIso, endIso) {
  if (!startIso || !endIso) return null
  const ms = new Date(endIso) - new Date(startIso)
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`
}

// ── Verdict badge ──────────────────────────────────────────────────────────────

const VERDICT_STYLES = {
  pass:    'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
  fail:    'bg-rose-500/20    text-rose-300    border-rose-500/30',
  fp:      'bg-amber-500/20   text-amber-300   border-amber-500/30',
  breach:  'bg-purple-500/20  text-purple-300  border-purple-500/30',
}
const VERDICT_LABELS = { pass: 'PASS', fail: 'FAIL', fp: 'FALSE POS', breach: '⚡ BREACH' }

function VerdictBadge({ verdict }) {
  return (
    <span className={cls(
      'inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold border',
      VERDICT_STYLES[verdict] ?? 'bg-gray-700 text-gray-400 border-gray-600'
    )}>
      {VERDICT_LABELS[verdict] ?? verdict?.toUpperCase()}
    </span>
  )
}

// ── Severity badge ─────────────────────────────────────────────────────────────

const SEV_STYLES = {
  CRITICAL: 'bg-red-500/20     text-red-300     border-red-500/30',
  HIGH:     'bg-orange-500/20  text-orange-300  border-orange-500/30',
  MEDIUM:   'bg-amber-500/20   text-amber-300   border-amber-500/30',
  LOW:      'bg-sky-500/20     text-sky-300     border-sky-500/30',
}
function SevBadge({ severity }) {
  return (
    <span className={cls(
      'inline-flex items-center px-1.5 py-0.5 rounded text-xs font-semibold border',
      SEV_STYLES[severity] ?? 'bg-gray-700 text-gray-400 border-gray-600'
    )}>
      {severity}
    </span>
  )
}

// ── Category pill ──────────────────────────────────────────────────────────────

const CAT_COLORS = {
  'SQL Injection':  'text-rose-400',
  'XSS':            'text-orange-400',
  'LFI':            'text-amber-400',
  'RCE':            'text-red-400',
  'Scanner':        'text-blue-400',
  'PHP Injection':  'text-violet-400',
  'Log4Shell':      'text-purple-400',
  'RFI':            'text-pink-400',
  'Protocol Attack':'text-cyan-400',
  'Normal Traffic': 'text-emerald-400',
}
function CatPill({ category }) {
  return <span className={cls('text-xs font-medium', CAT_COLORS[category] ?? 'text-gray-400')}>{category}</span>
}

// ── Progress bar ───────────────────────────────────────────────────────────────

function ProgressBar({ done, total, status }) {
  const pct = total ? Math.round((done / total) * 100) : 0
  const color = status === 'done' ? 'bg-emerald-500' : 'bg-sky-500'
  return (
    <div className="w-full bg-gray-800 rounded-full h-1.5 overflow-hidden">
      <div
        className={cls(color, 'h-full rounded-full transition-all duration-300', status === 'running' && 'animate-pulse')}
        style={{ width: `${pct}%` }}
      />
    </div>
  )
}

// ── Summary stat box ───────────────────────────────────────────────────────────

function StatBox({ label, value, color = 'text-gray-200' }) {
  return (
    <div className="bg-gray-800/60 rounded-lg px-4 py-3 text-center min-w-[90px]">
      <div className={cls('text-2xl font-bold', color)}>{value ?? '—'}</div>
      <div className="text-xs text-gray-500 mt-0.5">{label}</div>
    </div>
  )
}

// ── Result row ─────────────────────────────────────────────────────────────────

function ResultRow({ r, onClick, selected }) {
  return (
    <tr
      onClick={() => onClick(r)}
      className={cls(
        'cursor-pointer text-xs border-b border-gray-800 transition-colors',
        selected ? 'bg-gray-700/60' : 'hover:bg-gray-800/60',
        r.verdict === 'breach' && 'bg-purple-900/20'
      )}
    >
      <td className="py-2 px-3 font-mono text-gray-500">{r.id}</td>
      <td className="py-2 px-3"><CatPill category={r.category} /></td>
      <td className="py-2 px-3 text-gray-200">{r.name}</td>
      <td className="py-2 px-3 font-mono text-gray-400">{r.method}</td>
      <td className="py-2 px-3">
        <span className="font-mono text-xs">
          {r.status === 0 ? 'timeout' : r.status === -1 ? 'error' : r.status}
        </span>
      </td>
      <td className="py-2 px-3">
        <span className={r.blocked ? 'text-emerald-400' : 'text-gray-500'}>
          {r.blocked ? '✓ blocked' : '— passed'}
        </span>
      </td>
      <td className="py-2 px-3">
        <span className={r.arrived ? 'text-purple-400 font-semibold' : 'text-gray-600'}>
          {r.arrived ? '⚡ arrived' : '—'}
        </span>
      </td>
      <td className="py-2 px-3"><VerdictBadge verdict={r.verdict} /></td>
    </tr>
  )
}

// ── Detail drawer ──────────────────────────────────────────────────────────────

function ResultDrawer({ result, onClose }) {
  if (!result) return null
  return (
    <div className="fixed inset-y-0 right-0 w-[420px] bg-gray-900 border-l border-gray-700 z-50 flex flex-col shadow-2xl">
      {/* header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-gray-700">
        <div>
          <div className="text-sm font-semibold text-white">{result.name}</div>
          <div className="text-xs text-gray-500 font-mono mt-0.5">{result.id}</div>
        </div>
        <button onClick={onClose} className="text-gray-500 hover:text-white text-lg">✕</button>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4 text-xs">
        {/* verdict */}
        <div className="flex items-center gap-3">
          <VerdictBadge verdict={result.verdict} />
          <CatPill category={result.category} />
        </div>

        {/* breach callout */}
        {result.verdict === 'breach' && (
          <div className="rounded-lg bg-purple-900/30 border border-purple-500/40 p-3">
            <div className="font-semibold text-purple-300 mb-1">⚡ WAF Bypass Confirmed</div>
            <div className="text-purple-200/80">
              The WAF returned {result.status} but the payload arrived at the backend.
              This indicates a breach — the WAF did not prevent the attack.
            </div>
          </div>
        )}

        {/* fail callout */}
        {result.verdict === 'fail' && (
          <div className="rounded-lg bg-rose-900/30 border border-rose-500/40 p-3">
            <div className="font-semibold text-rose-300 mb-1">Attack not blocked</div>
            <div className="text-rose-200/80">
              The WAF returned {result.status} instead of 403/406.
              This payload was expected to be blocked but passed through.
            </div>
          </div>
        )}

        {/* fp callout */}
        {result.verdict === 'fp' && (
          <div className="rounded-lg bg-amber-900/30 border border-amber-500/40 p-3">
            <div className="font-semibold text-amber-300 mb-1">False Positive</div>
            <div className="text-amber-200/80">
              Legitimate traffic was blocked (status {result.status}).
              Review WAF rules to reduce false positives.
            </div>
          </div>
        )}

        {/* request details */}
        <div className="space-y-2">
          <div className="text-gray-400 font-semibold uppercase tracking-widest text-[10px]">Request</div>
          <div className="bg-gray-800 rounded-lg p-3 space-y-1.5">
            <Row label="Method"   value={result.method} mono />
            <Row label="Path"     value={result.path}   mono />
            <Row label="Expected" value={result.expected} />
            <Row label="Status"   value={result.status === 0 ? 'timeout' : result.status} mono />
            <Row label="Blocked"  value={result.blocked ? 'Yes' : 'No'} />
            <Row label="Arrived"  value={result.arrived ? 'Yes — payload reached backend' : 'No'} />
            <Row label="Test ID"  value={result.test_id} mono truncate />
          </div>
        </div>
      </div>
    </div>
  )
}

function Row({ label, value, mono, truncate }) {
  return (
    <div className="flex items-start gap-2">
      <span className="text-gray-500 shrink-0 w-20">{label}</span>
      <span className={cls(
        'text-gray-200',
        mono && 'font-mono',
        truncate && 'truncate max-w-[250px]'
      )}>
        {value ?? '—'}
      </span>
    </div>
  )
}

// ── Breach events panel ────────────────────────────────────────────────────────

function BreachPanel({ breachStats, breachEvents }) {
  if (!breachStats && !breachEvents) return null

  return (
    <div className="bg-purple-950/30 border border-purple-700/40 rounded-xl p-5">
      <div className="flex items-center gap-2 mb-4">
        <span className="text-lg">⚡</span>
        <h3 className="text-sm font-semibold text-purple-300">Breach Detector — Live Observations</h3>
        <span className="text-xs text-gray-500">
          (payloads that passed the WAF and reached the backend)
        </span>
      </div>

      {/* stats */}
      {breachStats && (
        <div className="flex flex-wrap gap-3 mb-4">
          <StatBox label="Total Breaches" value={breachStats.total} color="text-purple-300" />
          {Object.entries(breachStats.by_category ?? {}).map(([cat, n]) => (
            <StatBox key={cat} label={cat} value={n} color="text-purple-200" />
          ))}
        </div>
      )}

      {/* event list */}
      {breachEvents?.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-gray-500 uppercase text-[10px] tracking-widest border-b border-gray-700">
                <th className="pb-2 text-left px-2">Time</th>
                <th className="pb-2 text-left px-2">IP</th>
                <th className="pb-2 text-left px-2">Method</th>
                <th className="pb-2 text-left px-2">Path</th>
                <th className="pb-2 text-left px-2">Signature</th>
                <th className="pb-2 text-left px-2">Severity</th>
              </tr>
            </thead>
            <tbody>
              {breachEvents.slice(0, 50).map((e, i) => (
                <tr key={i} className="border-b border-gray-800 hover:bg-purple-900/20">
                  <td className="py-1.5 px-2 text-gray-500">{fmtTime(e.ts)}</td>
                  <td className="py-1.5 px-2 font-mono text-sky-400">{e.client_ip}</td>
                  <td className="py-1.5 px-2 font-mono text-gray-400">{e.method}</td>
                  <td className="py-1.5 px-2 font-mono text-gray-300 max-w-[180px] truncate">{e.path}</td>
                  <td className="py-1.5 px-2 text-purple-300">{e.sig_name}</td>
                  <td className="py-1.5 px-2"><SevBadge severity={e.severity} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="text-center py-6 text-gray-600 text-sm">
          No breach events recorded yet. Run a test suite to populate this panel.
        </div>
      )}
    </div>
  )
}

// ── Filter bar ─────────────────────────────────────────────────────────────────

const VERDICT_FILTERS = [
  { label: 'All', value: '' },
  { label: 'Pass', value: 'pass' },
  { label: 'Fail', value: 'fail' },
  { label: 'False Pos', value: 'fp' },
  { label: '⚡ Breach', value: 'breach' },
]

// ── Main component ─────────────────────────────────────────────────────────────

export default function WAFTestTab() {
  const [suites, setSuites]             = useState([])
  const [selectedSuite, setSelectedSuite] = useState('full')
  const [targetUrl, setTargetUrl]       = useState('')
  const [runs, setRuns]                 = useState([])
  const [activeRunId, setActiveRunId]   = useState(null)
  const [activeRun, setActiveRun]       = useState(null)
  const [selectedResult, setSelectedResult] = useState(null)
  const [verdictFilter, setVerdictFilter] = useState('')
  const [catFilter, setCatFilter]       = useState('')
  const [breachEvents, setBreachEvents] = useState([])
  const [breachStats, setBreachStats]   = useState(null)
  const [launching, setLaunching]       = useState(false)
  const [error, setError]               = useState(null)
  const pollRef = useRef(null)

  // Load suites once
  useEffect(() => {
    axios.get('/api/waf-test/suites')
      .then(r => setSuites(r.data))
      .catch(() => {})
  }, [])

  // Load breach data periodically
  const loadBreachData = useCallback(() => {
    axios.get('/api/breach/events').then(r => setBreachEvents(r.data ?? [])).catch(() => {})
    axios.get('/api/breach/stats').then(r => setBreachStats(r.data)).catch(() => {})
  }, [])

  useEffect(() => {
    loadBreachData()
    const t = setInterval(loadBreachData, 5000)
    return () => clearInterval(t)
  }, [loadBreachData])

  // Poll active run
  useEffect(() => {
    if (!activeRunId) return
    const poll = () => {
      axios.get(`/api/waf-test/runs/${activeRunId}`)
        .then(r => {
          setActiveRun(r.data)
          if (r.data.status === 'done') {
            clearInterval(pollRef.current)
            pollRef.current = null
          }
        })
        .catch(() => {})
    }
    poll()
    pollRef.current = setInterval(poll, 1000)
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [activeRunId])

  // Load recent runs on mount
  useEffect(() => {
    axios.get('/api/waf-test/runs').then(r => setRuns(r.data ?? [])).catch(() => {})
  }, [])

  const launchRun = async () => {
    setLaunching(true)
    setError(null)
    setSelectedResult(null)
    try {
      const r = await axios.post('/api/waf-test/run', {
        suite:      selectedSuite,
        target_url: targetUrl.trim() || undefined,
      })
      setActiveRunId(r.data.run_id)
    } catch (e) {
      setError(e?.response?.data?.detail ?? 'Failed to start run')
    } finally {
      setLaunching(false)
    }
  }

  // Filtered results
  const results = activeRun?.results ?? []
  const filtered = results.filter(r => {
    if (verdictFilter && r.verdict !== verdictFilter) return false
    if (catFilter && r.category !== catFilter) return false
    return true
  })

  const categories = [...new Set(results.map(r => r.category))].sort()

  const run = activeRun
  const isRunning = run?.status === 'running'

  return (
    <div className="space-y-6 relative">
      {/* ── Controls ── */}
      <div className="bg-gray-900 border border-gray-700 rounded-xl p-5">
        <div className="flex flex-wrap items-end gap-4">
          <div>
            <label className="text-xs text-gray-400 block mb-1.5">Test Suite</label>
            <select
              value={selectedSuite}
              onChange={e => setSelectedSuite(e.target.value)}
              disabled={isRunning}
              className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200
                         focus:outline-none focus:border-sky-500 disabled:opacity-50"
            >
              {suites.map(s => (
                <option key={s.id} value={s.id}>
                  {s.label} ({s.count} payloads)
                </option>
              ))}
            </select>
          </div>

          <div className="flex-1 min-w-[280px]">
            <label className="text-xs text-gray-400 block mb-1.5">
              Target URL
              <span className="text-gray-600 ml-2 font-normal">
                (leave blank to use internal WAF)
              </span>
            </label>
            <input
              type="url"
              value={targetUrl}
              onChange={e => setTargetUrl(e.target.value)}
              disabled={isRunning}
              placeholder="https://dev.jasonscott.us"
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm
                         text-gray-200 placeholder-gray-600 focus:outline-none focus:border-sky-500
                         disabled:opacity-50"
            />
          </div>

          <button
            onClick={launchRun}
            disabled={isRunning || launching}
            className={cls(
              'px-5 py-2 rounded-lg text-sm font-semibold transition-all',
              isRunning || launching
                ? 'bg-gray-700 text-gray-500 cursor-not-allowed'
                : 'bg-sky-600 hover:bg-sky-500 text-white shadow-lg shadow-sky-900/40'
            )}
          >
            {launching ? 'Starting…' : isRunning ? 'Running…' : '▶ Run Test'}
          </button>

          {error && <div className="text-rose-400 text-sm">{error}</div>}

          <div className="flex-1" />
          <div className="text-xs text-gray-600">
            Results update every second while running
          </div>
        </div>
      </div>

      {/* ── Active run ── */}
      {run && (
        <div className="bg-gray-900 border border-gray-700 rounded-xl p-5 space-y-4">
          {/* header */}
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-3">
              <div className={cls(
                'w-2.5 h-2.5 rounded-full',
                run.status === 'running' ? 'bg-sky-400 animate-pulse' :
                run.status === 'done'    ? 'bg-emerald-400' : 'bg-gray-500'
              )} />
              <span className="text-sm font-semibold text-white capitalize">
                {run.status} — {run.suite}
              </span>
              {run.target_url && (
                <span className="text-xs font-mono text-sky-400 bg-sky-900/30 px-2 py-0.5 rounded">
                  {run.target_url}
                </span>
              )}
              <span className="text-xs text-gray-500">
                {fmtTime(run.started)}
                {run.finished && ` → ${fmtTime(run.finished)} (${fmtDuration(run.started, run.finished)})`}
              </span>
            </div>
            <div className="text-xs text-gray-500 font-mono">{run.id}</div>
          </div>

          {/* progress */}
          <div>
            <div className="flex justify-between text-xs text-gray-500 mb-1">
              <span>{run.done} / {run.total || '?'} payloads</span>
              <span>{run.total ? Math.round((run.done / run.total) * 100) : 0}%</span>
            </div>
            <ProgressBar done={run.done} total={run.total} status={run.status} />
          </div>

          {/* summary stats */}
          <div className="flex flex-wrap gap-3">
            <StatBox label="Passed"       value={run.passed}          color="text-emerald-400" />
            <StatBox label="Failed"       value={run.failed}          color="text-rose-400" />
            <StatBox label="False Pos."   value={run.false_positives} color="text-amber-400" />
            <StatBox label="⚡ Breaches"  value={run.breaches}        color="text-purple-400" />
            <StatBox label="Total"        value={run.total}           color="text-gray-300" />
          </div>

          {/* filter bar */}
          {results.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <div className="flex bg-gray-800 rounded-lg p-0.5 gap-0.5">
                {VERDICT_FILTERS.map(f => (
                  <button
                    key={f.value}
                    onClick={() => setVerdictFilter(v => v === f.value ? '' : f.value)}
                    className={cls(
                      'px-2.5 py-1 rounded-md text-xs font-medium transition-colors',
                      verdictFilter === f.value
                        ? 'bg-sky-600 text-white'
                        : 'text-gray-400 hover:text-white'
                    )}
                  >
                    {f.label}
                  </button>
                ))}
              </div>

              <select
                value={catFilter}
                onChange={e => setCatFilter(e.target.value)}
                className="bg-gray-800 border border-gray-700 rounded-lg px-2.5 py-1 text-xs text-gray-300
                           focus:outline-none focus:border-sky-500"
              >
                <option value="">All categories</option>
                {categories.map(c => <option key={c} value={c}>{c}</option>)}
              </select>

              <span className="text-xs text-gray-600">
                {filtered.length} of {results.length} results
              </span>
            </div>
          )}

          {/* results table */}
          {results.length > 0 && (
            <div className="overflow-x-auto rounded-lg border border-gray-700">
              <table className="w-full">
                <thead>
                  <tr className="text-gray-500 uppercase text-[10px] tracking-widest bg-gray-800/60">
                    <th className="py-2 px-3 text-left">ID</th>
                    <th className="py-2 px-3 text-left">Category</th>
                    <th className="py-2 px-3 text-left">Name</th>
                    <th className="py-2 px-3 text-left">Method</th>
                    <th className="py-2 px-3 text-left">Status</th>
                    <th className="py-2 px-3 text-left">WAF</th>
                    <th className="py-2 px-3 text-left">Backend</th>
                    <th className="py-2 px-3 text-left">Verdict</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(r => (
                    <ResultRow
                      key={r.id}
                      r={r}
                      onClick={setSelectedResult}
                      selected={selectedResult?.id === r.id}
                    />
                  ))}
                  {filtered.length === 0 && (
                    <tr>
                      <td colSpan={8} className="text-center py-8 text-gray-600 text-sm">
                        No results match the current filters
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── Breach detector panel ── */}
      <BreachPanel breachStats={breachStats} breachEvents={breachEvents} />

      {/* ── Drawer ── */}
      {selectedResult && (
        <>
          <div
            className="fixed inset-0 bg-black/40 z-40"
            onClick={() => setSelectedResult(null)}
          />
          <ResultDrawer result={selectedResult} onClose={() => setSelectedResult(null)} />
        </>
      )}
    </div>
  )
}
