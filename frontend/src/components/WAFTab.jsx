import { useState } from 'react'
import { useApi } from '../hooks/useApi'

// ── Helpers ────────────────────────────────────────────────────────────────

const regionNames = new Intl.DisplayNames(['en'], { type: 'region' })
const FLAG = cc => {
  if (!cc || cc.length !== 2) return '🌐'
  try { return String.fromCodePoint(...[...cc.toUpperCase()].map(c => 0x1F1E6 + c.charCodeAt(0) - 65)) } catch { return '🌐' }
}
const countryName = cc => {
  if (!cc) return 'Unknown'
  try { return regionNames.of(cc.toUpperCase()) } catch { return cc }
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

// ── Severity badges ────────────────────────────────────────────────────────

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

const RISK_STYLES = {
  CRITICAL: 'bg-rose-500/20 text-rose-300',
  HIGH:     'bg-orange-500/20 text-orange-300',
  MEDIUM:   'bg-amber-500/20 text-amber-300',
  LOW:      'bg-sky-500/20 text-sky-300',
}

function RiskBadge({ risk }) {
  const r = (risk || 'MEDIUM').toUpperCase()
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ${RISK_STYLES[r] || RISK_STYLES.MEDIUM}`}>
      {r} RISK
    </span>
  )
}

// ── Mode badge ─────────────────────────────────────────────────────────────

function ModeBadge({ mode }) {
  if (mode === 'On' || mode === 'on') {
    return (
      <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-rose-500/20 text-rose-300 text-xs font-semibold border border-rose-500/30">
        <span className="w-1.5 h-1.5 rounded-full bg-rose-400" />
        Blocking
      </span>
    )
  }
  if (mode === 'DetectionOnly') {
    return (
      <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-500/20 text-amber-300 text-xs font-semibold border border-amber-500/30">
        <span className="w-1.5 h-1.5 rounded-full bg-amber-400 live-dot" />
        Detection Only
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-gray-700 text-gray-400 text-xs font-semibold">
      <span className="w-1.5 h-1.5 rounded-full bg-gray-500" />
      {mode || 'Unknown'}
    </span>
  )
}

// ── Stat card ──────────────────────────────────────────────────────────────

function Stat({ value, label, color = 'text-white', sub }) {
  return (
    <div className="text-center">
      <div className={`text-2xl font-bold ${color}`}>{value ?? '—'}</div>
      {sub && <div className="text-xs text-gray-600 font-mono">{sub}</div>}
      <div className="text-xs text-gray-500 mt-0.5">{label}</div>
    </div>
  )
}

// ── Slide-in drawer ────────────────────────────────────────────────────────

function Drawer({ title, sub, onClose, children }) {
  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="absolute right-0 top-0 bottom-0 w-full max-w-2xl bg-gray-950 border-l border-gray-800 flex flex-col shadow-2xl">
        <div className="flex items-start justify-between p-5 border-b border-gray-800 shrink-0">
          <div>
            <div className="font-bold text-white text-lg">{title}</div>
            {sub && <div className="text-xs text-gray-500 mt-0.5 font-mono">{sub}</div>}
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-white text-xl leading-none mt-0.5">✕</button>
        </div>
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {children}
        </div>
      </div>
    </div>
  )
}

// ── Rule detail card ───────────────────────────────────────────────────────

function RuleCard({ rule, index }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-800/60 transition-colors text-left"
      >
        <span className="text-gray-600 text-xs font-mono w-4 shrink-0">{index + 1}</span>
        <SevBadge sev={rule.severity} />
        <div className="flex-1 min-w-0">
          <div className="text-white text-sm font-medium truncate">{rule.attack_type}</div>
          <div className="text-gray-500 text-xs font-mono">Rule {rule.rule_id} · {rule.category}</div>
        </div>
        <RiskBadge risk={rule.risk} />
        <span className="text-gray-600 text-xs ml-2 shrink-0">{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div className="border-t border-gray-800 p-4 space-y-4">

          {/* What happened */}
          <div>
            <div className="text-xs text-gray-500 uppercase tracking-widest mb-1">What this rule detected</div>
            <div className="text-sm text-gray-300 leading-relaxed">{rule.description}</div>
          </div>

          {/* Matched data */}
          {rule.matched_data && (
            <div>
              <div className="text-xs text-gray-500 uppercase tracking-widest mb-1">Matched Data</div>
              <div className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 font-mono text-xs text-amber-300 break-all">
                {rule.matched_data}
              </div>
            </div>
          )}

          {/* Tags */}
          {rule.tags?.length > 0 && (
            <div>
              <div className="text-xs text-gray-500 uppercase tracking-widest mb-1.5">Tags</div>
              <div className="flex flex-wrap gap-1.5">
                {rule.tags.map((t, i) => (
                  <span key={i} className="text-xs px-2 py-0.5 bg-gray-800 text-gray-400 rounded-full border border-gray-700">
                    {t.split('/').pop()}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* OWASP category */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className="text-xs text-gray-500 uppercase tracking-widest mb-1">OWASP Category</div>
              <div className="text-sm text-sky-400">{rule.owasp_category}</div>
            </div>
            {rule.owasp_top10 && (
              <div>
                <div className="text-xs text-gray-500 uppercase tracking-widest mb-1">OWASP Top 10</div>
                <a
                  href={rule.owasp_url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-sm text-sky-400 hover:text-sky-300 underline underline-offset-2"
                >
                  {rule.owasp_top10} ↗
                </a>
              </div>
            )}
          </div>

          {/* Remediation */}
          <div>
            <div className="text-xs text-gray-500 uppercase tracking-widest mb-1">Remediation</div>
            <div className="text-sm text-emerald-300 leading-relaxed">{rule.remediation}</div>
          </div>

          {/* Docs link */}
          <div className="flex gap-3 pt-1">
            <a
              href={rule.crs_doc_url}
              target="_blank"
              rel="noreferrer"
              className="text-xs px-3 py-1.5 bg-gray-800 text-gray-400 hover:text-white border border-gray-700 rounded-lg transition-colors"
            >
              OWASP CRS Docs ↗
            </a>
            {rule.owasp_url && (
              <a
                href={rule.owasp_url}
                target="_blank"
                rel="noreferrer"
                className="text-xs px-3 py-1.5 bg-gray-800 text-gray-400 hover:text-white border border-gray-700 rounded-lg transition-colors"
              >
                OWASP Top 10 ↗
              </a>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Event detail drawer ────────────────────────────────────────────────────

function EventDrawer({ event, onClose }) {
  if (!event) return null
  return (
    <Drawer
      title={`${event.method} ${event.uri}`}
      sub={`${event.ip}${event.country ? ` · ${FLAG(event.country)} ${countryName(event.country)}` : ''} · ${fmtTime(event.ts)}`}
      onClose={onClose}
    >
      {/* Transaction summary */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-3 text-center">
          <div className={`text-xl font-bold ${event.blocked ? 'text-rose-400' : 'text-amber-400'}`}>
            {event.response_code || '—'}
          </div>
          <div className="text-xs text-gray-500 mt-0.5">{event.blocked ? 'Blocked' : 'Detected'}</div>
        </div>
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-3 text-center">
          <div className="text-xl font-bold text-white">{event.rule_count}</div>
          <div className="text-xs text-gray-500 mt-0.5">Rules Hit</div>
        </div>
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-3 text-center">
          <SevBadge sev={event.top_severity} />
          <div className="text-xs text-gray-500 mt-1.5">Top Severity</div>
        </div>
      </div>

      {/* Attack summary */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
        <div className="text-xs text-gray-500 uppercase tracking-widest mb-1">Primary Attack Type</div>
        <div className="text-white font-semibold">{event.attack_type}</div>
      </div>

      {event.user_agent && (
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
          <div className="text-xs text-gray-500 uppercase tracking-widest mb-1">User-Agent</div>
          <div className="font-mono text-xs text-gray-400 break-all">{event.user_agent}</div>
        </div>
      )}

      {/* Rule list */}
      <div>
        <div className="text-xs text-gray-500 uppercase tracking-widest mb-3">
          Matched Rules ({event.rules?.length || 0}) — click to expand
        </div>
        <div className="space-y-2">
          {(event.rules || []).map((rule, i) => (
            <RuleCard key={`${rule.rule_id}-${i}`} rule={rule} index={i} />
          ))}
        </div>
      </div>
    </Drawer>
  )
}

// ── Attack type breakdown ──────────────────────────────────────────────────

function AttackBreakdown({ data }) {
  if (!data || Object.keys(data).length === 0) {
    return <div className="text-gray-600 text-sm text-center py-4">No data</div>
  }
  const total = Object.values(data).reduce((s, v) => s + v, 0)
  return (
    <div className="space-y-2">
      {Object.entries(data).map(([type, count]) => (
        <div key={type} className="flex items-center gap-3">
          <div className="text-gray-300 text-xs flex-1 truncate">{type}</div>
          <div className="w-24 h-1.5 bg-gray-800 rounded-full overflow-hidden">
            <div
              className="h-full bg-amber-500 rounded-full"
              style={{ width: `${Math.round((count / total) * 100)}%` }}
            />
          </div>
          <div className="text-gray-400 font-mono text-xs w-8 text-right">{count}</div>
        </div>
      ))}
    </div>
  )
}

// ── Top IPs table ──────────────────────────────────────────────────────────

function TopIPs({ data }) {
  if (!data || Object.keys(data).length === 0) {
    return <div className="text-gray-600 text-sm text-center py-4">No data</div>
  }
  const total = Object.values(data).reduce((s, v) => s + v, 0)
  return (
    <div className="space-y-1.5">
      {Object.entries(data).slice(0, 8).map(([ip, count]) => (
        <div key={ip} className="flex items-center gap-2 text-xs py-1">
          <span className="font-mono text-rose-300 flex-1">{ip}</span>
          <div className="w-16 h-1 bg-gray-800 rounded-full overflow-hidden">
            <div className="h-full bg-rose-500/60 rounded-full" style={{ width: `${Math.round((count / total) * 100)}%` }} />
          </div>
          <span className="text-gray-400 font-mono w-6 text-right">{count}</span>
        </div>
      ))}
    </div>
  )
}

// ── Main ───────────────────────────────────────────────────────────────────

const SINCE_OPTIONS = ['1h', '6h', '12h', '24h', '3d', '7d']

export default function WAFTab({ breachStats, onBreachCollapse }) {
  const [since, setSince]               = useState('24h')
  const [selectedEvent, setEvent]       = useState(null)
  const [attackFilter, setAttackFilter] = useState('')
  const [blockedOnly, setBlockedOnly]   = useState(false)
  const [feedCollapsed, setFeedCollapsed] = useState(false)

  const { data: stats }  = useApi('/waf/stats',  { since }, 15000)
  const { data: events } = useApi('/waf/events', {
    since,
    limit: 200,
    ...(attackFilter ? { attack_type: attackFilter } : {}),
    ...(blockedOnly  ? { blocked_only: true }        : {}),
  }, 10000)

  const mode = stats?.mode || 'DetectionOnly'

  return (
    <div className="space-y-6">
      {selectedEvent && (
        <EventDrawer event={selectedEvent} onClose={() => setEvent(null)} />
      )}

      {/* ── Status bar ─────────────────────────────────────────────────── */}
      <div className="card flex flex-wrap items-center gap-6">
        <div className="flex items-center gap-3">
          <span className="text-2xl">🛡️</span>
          <div>
            <div className="font-bold text-white">Web Application Firewall</div>
            <div className="text-xs text-gray-500">OWASP ModSecurity CRS</div>
          </div>
        </div>
        <ModeBadge mode={mode} />
        <div className="flex-1" />
        <Stat value={stats?.total_events?.toLocaleString()} label="Events" color="text-white" />
        <Stat value={stats?.blocked?.toLocaleString()} label="Blocked" color="text-rose-400" />
        <Stat value={stats?.detected?.toLocaleString()} label="Detected" color="text-amber-400" />
        <Stat value={stats?.unique_ips?.toLocaleString()} label="Unique IPs" color="text-sky-400" />
        <Stat value={stats?.top_attack_type || '—'} label="Top Attack" color="text-orange-400" />
        {breachStats?.total > 0 && (
          <button
            onClick={() => onBreachCollapse?.()}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-purple-500/20 border border-purple-500/40 text-purple-300 text-xs font-semibold animate-pulse hover:animate-none hover:bg-purple-500/30 transition-colors"
            title="Bypass events detected — scroll up to view"
          >
            ⚡ {breachStats.total} bypass{breachStats.total !== 1 ? 'es' : ''}
          </button>
        )}
      </div>

      {/* Mode warning */}
      {mode === 'DetectionOnly' && (
        <div className="card border-amber-800 bg-amber-950/20 text-amber-300 text-sm flex items-start gap-3">
          <span className="text-lg shrink-0">⚠️</span>
          <div>
            <div className="font-semibold">WAF is in Detection-Only mode</div>
            <div className="text-xs text-amber-400/70 mt-0.5">
              Attacks are logged but <strong>not blocked</strong>.
              To enable blocking, set <code className="bg-amber-900/40 px-1 rounded">WAF_MODE=On</code> in
              your <code className="bg-amber-900/40 px-1 rounded">.env</code> and restart the WAF container.
            </div>
          </div>
        </div>
      )}

      {/* ── Analysis grid ──────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="card">
          <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-widest mb-4">Attack Types</h2>
          <AttackBreakdown data={stats?.attack_type_breakdown} />
        </div>
        <div className="card">
          <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-widest mb-4">Top Source IPs</h2>
          <TopIPs data={stats?.ip_breakdown} />
        </div>
      </div>

      {/* ── Event feed ─────────────────────────────────────────────────── */}
      <div className="card">
        <div className="flex flex-wrap items-center gap-3 mb-4">
          <button
            onClick={() => setFeedCollapsed(c => !c)}
            className="flex items-center gap-2 group"
          >
            <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-widest group-hover:text-gray-300 transition-colors">
              WAF Event Feed
            </h2>
            <span className="text-gray-600 text-xs group-hover:text-gray-400 transition-colors">
              {feedCollapsed ? '▼' : '▲'}
            </span>
          </button>

          {!feedCollapsed && (
            <>
              {/* Time window */}
              <div className="flex bg-gray-800 rounded-lg p-0.5 gap-0.5">
                {SINCE_OPTIONS.map(s => (
                  <button
                    key={s}
                    onClick={() => setSince(s)}
                    className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors
                      ${since === s ? 'bg-sky-500 text-white' : 'text-gray-400 hover:text-white'}`}
                  >
                    {s}
                  </button>
                ))}
              </div>

              {/* Blocked-only toggle */}
              <button
                onClick={() => setBlockedOnly(b => !b)}
                className={`text-xs px-3 py-1.5 rounded-lg border transition-colors ${
                  blockedOnly
                    ? 'bg-rose-500/20 text-rose-300 border-rose-500/30'
                    : 'bg-gray-800 text-gray-400 border-gray-700 hover:text-white'
                }`}
              >
                {blockedOnly ? '🚫 Blocked only' : 'All events'}
              </button>

              {/* Attack type filter */}
              {stats?.attack_type_breakdown && Object.keys(stats.attack_type_breakdown).length > 0 && (
                <select
                  value={attackFilter}
                  onChange={e => setAttackFilter(e.target.value)}
                  className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-xs text-gray-200 focus:outline-none focus:border-sky-500"
                >
                  <option value="">All attack types</option>
                  {Object.keys(stats.attack_type_breakdown).map(t => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              )}
            </>
          )}
        </div>

        {/* Table */}
        {!feedCollapsed && (
          !events?.length ? (
            <div className="text-gray-600 text-sm text-center py-10">
              {stats?.total_events === 0
                ? 'No WAF events in this time window — traffic is clean or the WAF container is starting up.'
                : 'No events match the current filters.'}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-gray-600 uppercase tracking-wider text-left border-b border-gray-800">
                    <th className="pb-2 pr-3 font-medium">Time</th>
                    <th className="pb-2 pr-3 font-medium">IP</th>
                    <th className="pb-2 pr-3 font-medium">Method</th>
                    <th className="pb-2 pr-3 font-medium min-w-0 max-w-xs">URI</th>
                    <th className="pb-2 pr-3 font-medium">Code</th>
                    <th className="pb-2 pr-3 font-medium">Attack Type</th>
                    <th className="pb-2 pr-3 font-medium">Severity</th>
                    <th className="pb-2 font-medium">Rules</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-800/50">
                  {events.map((e, i) => (
                    <tr
                      key={e.id || i}
                      onClick={() => setEvent(e)}
                      className="hover:bg-gray-800/40 cursor-pointer transition-colors group"
                    >
                      <td className="py-2 pr-3 text-gray-500 font-mono whitespace-nowrap">{fmtTime(e.ts)}</td>
                      <td className="py-2 pr-3">
                        <div className="flex items-center gap-1.5">
                          {e.country && <span title={countryName(e.country)}>{FLAG(e.country)}</span>}
                          <span className="font-mono text-rose-300">{e.ip}</span>
                        </div>
                      </td>
                      <td className="py-2 pr-3">
                        <span className="font-mono text-sky-400">{e.method}</span>
                      </td>
                      <td className="py-2 pr-3 max-w-xs">
                        <span className="font-mono text-gray-300 truncate block" title={e.uri}>{e.uri}</span>
                      </td>
                      <td className="py-2 pr-3">
                        <span className={`font-mono font-bold ${e.blocked ? 'text-rose-400' : 'text-amber-400'}`}>
                          {e.response_code || '—'}
                        </span>
                      </td>
                      <td className="py-2 pr-3 text-gray-400">{e.attack_type}</td>
                      <td className="py-2 pr-3"><SevBadge sev={e.top_severity} /></td>
                      <td className="py-2">
                        <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-gray-800 text-gray-300 font-mono font-bold text-xs group-hover:bg-sky-500/20 group-hover:text-sky-300 transition-colors">
                          {e.rule_count}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        )}
      </div>

      {/* Legend */}
      <div className="card border-gray-800/50 bg-gray-900/30">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-xs text-gray-500">
          <span className="font-semibold text-gray-400 uppercase tracking-wider">How to read this:</span>
          <span><span className="text-rose-400 font-bold">403</span> = request was blocked by WAF</span>
          <span><span className="text-amber-400 font-bold">2xx/3xx</span> = detected but allowed (Detection Only mode)</span>
          <span>Click any row for full rule details, explanations, and remediation steps</span>
        </div>
      </div>
    </div>
  )
}
