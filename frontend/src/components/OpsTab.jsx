import { useState } from 'react'
import { useApi } from '../hooks/useApi'
import AlertsConfig from './AlertsConfig'

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

function fmtDur(s) {
  if (s == null) return '—'
  if (s < 60) return `${s}s`
  return `${Math.floor(s / 60)}m ${s % 60}s`
}

function Chevron({ open }) {
  return (
    <svg className={`w-4 h-4 text-gray-500 shrink-0 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
      fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
    </svg>
  )
}

function SectionShell({ icon, title, sub, badge, collapsed, onToggle, children }) {
  return (
    <div className="card p-0 overflow-hidden">
      <button onClick={onToggle}
        className="w-full flex items-center gap-3 px-4 sm:px-5 py-4 hover:bg-gray-800/30 transition-colors group text-left">
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

// ── Container Health ───────────────────────────────────────────────────────

function stateColor(state, health) {
  if (state !== 'running') return 'bg-rose-400'
  if (health === 'unhealthy') return 'bg-rose-400'
  if (health === 'starting') return 'bg-amber-400'
  if (health === 'healthy' || health == null) return 'bg-emerald-400'
  return 'bg-gray-500'
}

function stateLabel(state, health, status) {
  if (state !== 'running') return state
  if (health === 'unhealthy') return 'unhealthy'
  if (health === 'starting')  return 'starting'
  return status || 'running'
}

function ContainerHealth() {
  const { data, error } = useApi('/sys/containers', {}, 30000)

  if (error || data?.error) {
    return (
      <div className="text-xs text-rose-400 bg-rose-500/10 border border-rose-500/20 rounded-xl px-4 py-3">
        {data?.error || 'Cannot reach Docker socket — ensure /var/run/docker.sock is mounted to the sysmon service.'}
      </div>
    )
  }

  const containers = data?.containers
  if (!containers) return <div className="text-gray-600 text-sm text-center py-4">Loading…</div>
  if (!containers.length) return <div className="text-gray-600 text-sm text-center py-4">No containers found</div>

  const upCount   = containers.filter(c => c.state === 'running').length
  const downCount = containers.length - upCount

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-4 text-xs text-gray-500">
        <span><span className="text-emerald-400 font-mono">{upCount}</span> running</span>
        {downCount > 0 && <span><span className="text-rose-400 font-mono">{downCount}</span> stopped</span>}
        <span className="text-gray-700">{containers.length} total</span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {containers.map(c => {
          const dot = stateColor(c.state, c.health)
          const label = stateLabel(c.state, c.health, c.status)
          const isOk  = c.state === 'running' && c.health !== 'unhealthy'
          return (
            <div key={c.name}
              className={`flex items-center gap-3 bg-gray-900/60 border rounded-xl px-4 py-2.5 ${isOk ? 'border-gray-800' : 'border-rose-800/40'}`}>
              <span className={`w-2 h-2 rounded-full shrink-0 ${dot} ${isOk ? '' : ''}`} />
              <div className="flex-1 min-w-0">
                <div className="text-white text-xs font-mono truncate">{c.name}</div>
                <div className="text-gray-600 text-[10px] truncate">{c.image}</div>
              </div>
              <span className={`text-[10px] font-mono shrink-0 ${isOk ? 'text-gray-600' : 'text-rose-400'}`}>
                {label}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Backup Status ──────────────────────────────────────────────────────────

const BACKUP_STATUS_COLOR = {
  success:    'text-emerald-400',
  no_changes: 'text-gray-400',
  failed:     'text-rose-400',
}

function TriggerButton({ triggering, msg, onTrigger }) {
  return (
    <div className="flex items-center gap-3 flex-wrap">
      <button
        onClick={onTrigger}
        disabled={triggering}
        className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium bg-blue-600/20 text-blue-300 border border-blue-600/30 hover:bg-blue-600/30 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        {triggering ? (
          <>
            <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4l3-3-3-3v4a8 8 0 00-8 8h4z" />
            </svg>
            Queuing…
          </>
        ) : (
          <>
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
            </svg>
            Run backup now
          </>
        )}
      </button>
      {msg && <span className="text-xs text-gray-500">{msg}</span>}
    </div>
  )
}

const BACKUP_STATUS_DOT = {
  success:    'bg-emerald-400',
  no_changes: 'bg-gray-500',
  failed:     'bg-rose-400',
}

const BACKUP_STATUS_LABEL = {
  success:    'Success',
  no_changes: 'No changes',
  failed:     'Failed',
}

function BackupStatus() {
  const { data } = useApi('/backup/status', {}, 120000)
  const [triggering, setTriggering] = useState(false)
  const [triggerMsg, setTriggerMsg] = useState(null)

  async function handleTrigger() {
    setTriggering(true)
    setTriggerMsg(null)
    try {
      const res = await fetch('/api/backup/trigger', { method: 'POST' })
      if (res.ok) {
        setTriggerMsg('Backup queued — results will appear within a few minutes.')
      } else {
        setTriggerMsg('Failed to queue backup.')
      }
    } catch {
      setTriggerMsg('Failed to queue backup.')
    } finally {
      setTriggering(false)
    }
  }

  if (!data) return <div className="text-gray-600 text-sm text-center py-4">Loading…</div>

  if (!data.length) return (
    <div className="space-y-3">
      <div className="text-gray-600 text-sm text-center py-4">
        No backup records yet — the backup container writes status after each run.
      </div>
      <TriggerButton triggering={triggering} msg={triggerMsg} onTrigger={handleTrigger} />
    </div>
  )

  const latest = data[0]
  const latestOk = latest.status !== 'failed'

  return (
    <div className="space-y-3">
      {/* Latest run summary */}
      <div className={`flex items-start gap-3 bg-gray-900/60 border rounded-xl px-4 py-3 ${latestOk ? 'border-gray-800' : 'border-rose-800/40'}`}>
        <span className={`w-2.5 h-2.5 rounded-full mt-0.5 shrink-0 ${BACKUP_STATUS_DOT[latest.status] || 'bg-gray-500'}`} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`font-medium text-sm ${BACKUP_STATUS_COLOR[latest.status] || 'text-gray-300'}`}>
              {BACKUP_STATUS_LABEL[latest.status] || latest.status}
            </span>
            {latest.commit_sha && (
              <span className="text-xs font-mono text-gray-600 bg-gray-800 px-1.5 py-0.5 rounded">
                {latest.commit_sha}
              </span>
            )}
          </div>
          <div className="text-xs text-gray-500 mt-0.5">{latest.message}</div>
        </div>
        <div className="text-right shrink-0">
          <div className="text-xs text-gray-500">{fmtTime(latest.ts)}</div>
          {latest.duration_s != null && (
            <div className="text-xs text-gray-700">{fmtDur(latest.duration_s)}</div>
          )}
        </div>
      </div>

      {/* History */}
      {data.length > 1 && (
        <div className="rounded-xl border border-gray-800 overflow-hidden">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-gray-900/80 text-gray-500 uppercase tracking-wider border-b border-gray-800">
                <th className="px-3 py-2 text-left font-medium">Time</th>
                <th className="px-3 py-2 text-left font-medium">Status</th>
                <th className="px-3 py-2 text-left font-medium hidden sm:table-cell">Message</th>
                <th className="px-3 py-2 text-right font-medium hidden sm:table-cell">Duration</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800/50">
              {data.slice(1).map((r, i) => (
                <tr key={i} className="hover:bg-gray-800/20">
                  <td className="px-3 py-1.5 text-gray-500 whitespace-nowrap">{fmtTime(r.ts)}</td>
                  <td className={`px-3 py-1.5 ${BACKUP_STATUS_COLOR[r.status] || 'text-gray-400'}`}>
                    {BACKUP_STATUS_LABEL[r.status] || r.status}
                  </td>
                  <td className="px-3 py-1.5 text-gray-600 max-w-[200px] truncate hidden sm:table-cell">{r.message}</td>
                  <td className="px-3 py-1.5 text-gray-600 text-right font-mono hidden sm:table-cell">{fmtDur(r.duration_s)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <TriggerButton triggering={triggering} msg={triggerMsg} onTrigger={handleTrigger} />
    </div>
  )
}

// ── Main OpsTab ────────────────────────────────────────────────────────────

export default function OpsTab() {
  const [containersCollapsed, setContainersCollapsed] = useState(false)
  const [backupCollapsed,     setBackupCollapsed]     = useState(false)
  const [alertsCollapsed,     setAlertsCollapsed]     = useState(false)

  const { data: containers } = useApi('/sys/containers', {}, 30000)
  const { data: backup }     = useApi('/backup/status',  {}, 120000)
  const { data: alertRules } = useApi('/alerts/rules',   {}, 60000)

  // Badges
  const containerDown = (containers?.containers ?? []).filter(c => c.state !== 'running').length
  const lastBackup    = backup?.[0]
  const enabledRules  = (alertRules ?? []).filter(r => r.enabled).length

  return (
    <div className="space-y-4">

      {/* ── Containers ─────────────────────────────────────────────────── */}
      <SectionShell
        icon="🐳"
        title="Container Health"
        sub="Docker container state — refreshes every 30s"
        badge={
          containerDown > 0
            ? <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-rose-500/20 text-rose-300 text-xs font-semibold border border-rose-500/20 animate-pulse">
                <span className="w-1.5 h-1.5 rounded-full bg-rose-400" />{containerDown} down
              </span>
            : containers?.containers
              ? <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 text-xs font-semibold border border-emerald-500/20">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 live-dot" />All running
                </span>
              : null
        }
        collapsed={containersCollapsed}
        onToggle={() => setContainersCollapsed(c => !c)}
      >
        <ContainerHealth />
      </SectionShell>

      {/* ── Backup ─────────────────────────────────────────────────────── */}
      <SectionShell
        icon="💾"
        title="Backup Status"
        sub="GitHub backup history — runs every 60 minutes"
        badge={
          lastBackup && (
            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-mono border ${
              lastBackup.status === 'success'    ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/20' :
              lastBackup.status === 'no_changes' ? 'bg-gray-700/60 text-gray-400 border-gray-700' :
              'bg-rose-500/10 text-rose-300 border-rose-500/20'
            }`}>
              {BACKUP_STATUS_LABEL[lastBackup.status] || lastBackup.status}
            </span>
          )
        }
        collapsed={backupCollapsed}
        onToggle={() => setBackupCollapsed(c => !c)}
      >
        <BackupStatus />
      </SectionShell>

      {/* ── Alerts ─────────────────────────────────────────────────────── */}
      <SectionShell
        icon="🔔"
        title="Alerts"
        sub="Configurable alert rules with email, webhook, and Slack delivery"
        badge={
          enabledRules > 0
            ? <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-violet-500/10 text-violet-300 text-xs font-mono border border-violet-500/20">
                {enabledRules} active rule{enabledRules !== 1 ? 's' : ''}
              </span>
            : null
        }
        collapsed={alertsCollapsed}
        onToggle={() => setAlertsCollapsed(c => !c)}
      >
        <AlertsConfig />
      </SectionShell>

    </div>
  )
}
