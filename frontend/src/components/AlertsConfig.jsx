import { useState, useEffect, useCallback } from 'react'
import axios from 'axios'

// ── Helpers ────────────────────────────────────────────────────────────────

const CONDITIONS = [
  { value: 'cert_expiry',    label: 'SSL Cert Expiry',    desc: 'Fire when any host cert expires within N days' },
  { value: 'container_down', label: 'Container Down',     desc: 'Fire when any Docker container is not running' },
  { value: 'breach_events',  label: 'WAF Breach Events',  desc: 'Fire when N+ WAF bypass events are unacknowledged' },
  { value: 'error_rate',     label: 'High Error Rate',    desc: 'Fire when 5xx rate exceeds threshold % in a window' },
  { value: 'host_down',      label: 'Host Down',          desc: 'Fire when a proxy host fails its health check' },
  { value: 'ban_spike',      label: 'Ban Spike',          desc: 'Fire when total fail2ban banned IPs exceed threshold' },
]

const CHANNEL_TYPES = [
  { value: 'email',   label: '📧 Email',          desc: 'Send via SMTP' },
  { value: 'webhook', label: '🔗 Webhook',        desc: 'POST JSON to a URL' },
  { value: 'slack',   label: '💬 Slack',          desc: 'Slack incoming webhook' },
]

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

// ── Param editors per condition ────────────────────────────────────────────

function ParamFields({ condition, params, onChange }) {
  const set = (k, v) => onChange({ ...params, [k]: v })

  if (condition === 'cert_expiry') return (
    <label className="block">
      <span className="text-xs text-gray-500">Days before expiry to alert</span>
      <input type="number" min="1" max="365"
        value={params.days ?? 30}
        onChange={e => set('days', Number(e.target.value))}
        className="mt-1 w-full input-sm" />
    </label>
  )

  if (condition === 'container_down') return (
    <label className="block">
      <span className="text-xs text-gray-500">Container name (leave blank for any)</span>
      <input type="text" placeholder="e.g. npm_waf"
        value={params.name ?? ''}
        onChange={e => set('name', e.target.value)}
        className="mt-1 w-full input-sm" />
    </label>
  )

  if (condition === 'breach_events') return (
    <label className="block">
      <span className="text-xs text-gray-500">Unacknowledged event threshold</span>
      <input type="number" min="1"
        value={params.threshold ?? 1}
        onChange={e => set('threshold', Number(e.target.value))}
        className="mt-1 w-full input-sm" />
    </label>
  )

  if (condition === 'error_rate') return (
    <div className="space-y-2">
      <label className="block">
        <span className="text-xs text-gray-500">Error rate threshold (%)</span>
        <input type="number" min="1" max="100"
          value={params.threshold ?? 10}
          onChange={e => set('threshold', Number(e.target.value))}
          className="mt-1 w-full input-sm" />
      </label>
      <label className="block">
        <span className="text-xs text-gray-500">Window (minutes)</span>
        <input type="number" min="1"
          value={params.window_minutes ?? 5}
          onChange={e => set('window_minutes', Number(e.target.value))}
          className="mt-1 w-full input-sm" />
      </label>
    </div>
  )

  if (condition === 'host_down') return (
    <label className="block">
      <span className="text-xs text-gray-500">Host to monitor (leave blank for any)</span>
      <input type="text" placeholder="e.g. dash.example.com"
        value={params.host ?? ''}
        onChange={e => set('host', e.target.value)}
        className="mt-1 w-full input-sm" />
    </label>
  )

  if (condition === 'ban_spike') return (
    <label className="block">
      <span className="text-xs text-gray-500">Total banned IPs threshold</span>
      <input type="number" min="1"
        value={params.threshold ?? 50}
        onChange={e => set('threshold', Number(e.target.value))}
        className="mt-1 w-full input-sm" />
    </label>
  )

  return null
}

// ── Config fields per channel type ─────────────────────────────────────────

function ChannelConfigFields({ type, config, onChange }) {
  const set = (k, v) => onChange({ ...config, [k]: v })

  if (type === 'email') return (
    <label className="block">
      <span className="text-xs text-gray-500">Recipient email address</span>
      <input type="email" placeholder="you@example.com"
        value={config.email ?? ''}
        onChange={e => set('email', e.target.value)}
        className="mt-1 w-full input-sm" />
    </label>
  )

  if (type === 'webhook') return (
    <label className="block">
      <span className="text-xs text-gray-500">Webhook URL (receives POST with JSON body)</span>
      <input type="url" placeholder="https://…"
        value={config.url ?? ''}
        onChange={e => set('url', e.target.value)}
        className="mt-1 w-full input-sm" />
    </label>
  )

  if (type === 'slack') return (
    <label className="block">
      <span className="text-xs text-gray-500">Slack incoming webhook URL</span>
      <input type="url" placeholder="https://hooks.slack.com/services/…"
        value={config.url ?? ''}
        onChange={e => set('url', e.target.value)}
        className="mt-1 w-full input-sm" />
    </label>
  )

  return null
}

// ── Channel form ───────────────────────────────────────────────────────────

function ChannelForm({ initial, channels, onSave, onCancel }) {
  const [form, setForm] = useState(initial ?? { name: '', type: 'email', config: {}, enabled: true })
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState(null)
  const [err, setErr] = useState('')

  async function save(e) {
    e.preventDefault()
    setSaving(true)
    setErr('')
    try {
      if (form.id) {
        await axios.put(`/api/alerts/channels/${form.id}`, form)
      } else {
        await axios.post('/api/alerts/channels', form)
      }
      onSave()
    } catch (e) {
      setErr(e.response?.data?.detail || e.message)
    } finally { setSaving(false) }
  }

  async function test() {
    if (!form.id) return
    setTesting(true)
    setTestResult(null)
    try {
      const { data } = await axios.post(`/api/alerts/channels/${form.id}/test`)
      setTestResult(data.delivered ? { ok: true, text: 'Test delivered successfully!' } : { ok: false, text: data.error || 'Delivery failed' })
    } catch (e) {
      setTestResult({ ok: false, text: e.response?.data?.detail || e.message })
    } finally { setTesting(false) }
  }

  return (
    <form onSubmit={save} className="bg-gray-900/60 border border-gray-800 rounded-xl p-4 space-y-3">
      <div className="font-medium text-white text-sm">{form.id ? 'Edit Channel' : 'New Channel'}</div>

      <input type="text" placeholder="Channel name" required
        value={form.name}
        onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
        className="w-full input-sm" />

      <div className="flex flex-wrap gap-2">
        {CHANNEL_TYPES.map(t => (
          <button key={t.value} type="button"
            onClick={() => setForm(f => ({ ...f, type: t.value, config: {} }))}
            className={`flex-1 text-xs px-3 py-2 rounded-lg border transition-colors ${
              form.type === t.value
                ? 'bg-sky-500/20 border-sky-500/40 text-sky-300'
                : 'bg-gray-800 border-gray-700 text-gray-400 hover:text-white'
            }`}>
            {t.label}
          </button>
        ))}
      </div>

      <ChannelConfigFields
        type={form.type}
        config={form.config}
        onChange={cfg => setForm(f => ({ ...f, config: cfg }))}
      />

      <label className="flex items-center gap-2 text-sm text-gray-400 cursor-pointer">
        <input type="checkbox" checked={form.enabled}
          onChange={e => setForm(f => ({ ...f, enabled: e.target.checked }))}
          className="accent-sky-500" />
        Enabled
      </label>

      {err && <div className="text-xs text-rose-400 bg-rose-500/10 rounded-lg px-3 py-2">{err}</div>}
      {testResult && (
        <div className={`text-xs rounded-lg px-3 py-2 ${testResult.ok ? 'bg-emerald-500/10 text-emerald-400' : 'bg-rose-500/10 text-rose-400'}`}>
          {testResult.text}
        </div>
      )}

      <div className="flex gap-2">
        <button type="submit" disabled={saving}
          className="flex-1 text-xs py-2 bg-sky-500/20 text-sky-300 hover:bg-sky-500/40 rounded-lg transition-colors disabled:opacity-50">
          {saving ? 'Saving…' : 'Save'}
        </button>
        {form.id && (
          <button type="button" disabled={testing} onClick={test}
            className="text-xs px-3 py-2 bg-gray-800 text-gray-400 hover:text-white hover:bg-gray-700 rounded-lg transition-colors disabled:opacity-50">
            {testing ? 'Testing…' : 'Test'}
          </button>
        )}
        <button type="button" onClick={onCancel}
          className="text-xs px-3 py-2 bg-gray-800 text-gray-400 hover:text-white hover:bg-gray-700 rounded-lg transition-colors">
          Cancel
        </button>
      </div>
    </form>
  )
}

// ── Rule form ──────────────────────────────────────────────────────────────

function RuleForm({ initial, channels, onSave, onCancel }) {
  const [form, setForm] = useState(initial ?? {
    name: '', condition: 'cert_expiry', params: { days: 30 },
    channel_id: null, cooldown_minutes: 60, enabled: true,
  })
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  async function save(e) {
    e.preventDefault()
    setSaving(true)
    setErr('')
    try {
      if (form.id) {
        await axios.put(`/api/alerts/rules/${form.id}`, form)
      } else {
        await axios.post('/api/alerts/rules', form)
      }
      onSave()
    } catch (e) {
      setErr(e.response?.data?.detail || e.message)
    } finally { setSaving(false) }
  }

  function setCondition(cond) {
    // Reset params to defaults for the chosen condition
    const defaults = {
      cert_expiry:    { days: 30 },
      container_down: {},
      breach_events:  { threshold: 1 },
      error_rate:     { threshold: 10, window_minutes: 5 },
      host_down:      { host: '' },
      ban_spike:      { threshold: 50 },
    }
    setForm(f => ({ ...f, condition: cond, params: defaults[cond] ?? {} }))
  }

  const condInfo = CONDITIONS.find(c => c.value === form.condition)

  return (
    <form onSubmit={save} className="bg-gray-900/60 border border-gray-800 rounded-xl p-4 space-y-3">
      <div className="font-medium text-white text-sm">{form.id ? 'Edit Rule' : 'New Rule'}</div>

      <input type="text" placeholder="Rule name" required
        value={form.name}
        onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
        className="w-full input-sm" />

      <div>
        <div className="text-xs text-gray-500 mb-1.5">Condition</div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
          {CONDITIONS.map(c => (
            <button key={c.value} type="button"
              onClick={() => setCondition(c.value)}
              className={`text-left text-xs px-3 py-2 rounded-lg border transition-colors ${
                form.condition === c.value
                  ? 'bg-violet-500/20 border-violet-500/40 text-violet-300'
                  : 'bg-gray-800 border-gray-700 text-gray-400 hover:text-white'
              }`}>
              <div className="font-medium">{c.label}</div>
              <div className="text-gray-600 text-[10px] mt-0.5">{c.desc}</div>
            </button>
          ))}
        </div>
      </div>

      <ParamFields
        condition={form.condition}
        params={form.params}
        onChange={params => setForm(f => ({ ...f, params }))}
      />

      <div className="grid grid-cols-2 gap-3">
        <div>
          <div className="text-xs text-gray-500 mb-1">Delivery channel</div>
          <select value={form.channel_id ?? ''}
            onChange={e => setForm(f => ({ ...f, channel_id: e.target.value ? Number(e.target.value) : null }))}
            className="w-full input-sm">
            <option value="">— log only, no delivery —</option>
            {channels.map(ch => (
              <option key={ch.id} value={ch.id}>{ch.name} ({ch.type})</option>
            ))}
          </select>
        </div>
        <div>
          <div className="text-xs text-gray-500 mb-1">Cooldown (minutes)</div>
          <input type="number" min="1"
            value={form.cooldown_minutes}
            onChange={e => setForm(f => ({ ...f, cooldown_minutes: Number(e.target.value) }))}
            className="w-full input-sm" />
        </div>
      </div>

      <label className="flex items-center gap-2 text-sm text-gray-400 cursor-pointer">
        <input type="checkbox" checked={form.enabled}
          onChange={e => setForm(f => ({ ...f, enabled: e.target.checked }))}
          className="accent-violet-500" />
        Enabled
      </label>

      {err && <div className="text-xs text-rose-400 bg-rose-500/10 rounded-lg px-3 py-2">{err}</div>}

      <div className="flex gap-2">
        <button type="submit" disabled={saving}
          className="flex-1 text-xs py-2 bg-violet-500/20 text-violet-300 hover:bg-violet-500/40 rounded-lg transition-colors disabled:opacity-50">
          {saving ? 'Saving…' : 'Save Rule'}
        </button>
        <button type="button" onClick={onCancel}
          className="text-xs px-3 py-2 bg-gray-800 text-gray-400 hover:text-white hover:bg-gray-700 rounded-lg transition-colors">
          Cancel
        </button>
      </div>
    </form>
  )
}

// ── SMTP test panel ────────────────────────────────────────────────────────

function SmtpTestPanel() {
  const [config,   setConfig]   = useState(null)
  const [to,       setTo]       = useState('')
  const [sending,  setSending]  = useState(false)
  const [result,   setResult]   = useState(null)

  useEffect(() => {
    axios.get('/api/alerts/smtp-config').then(r => setConfig(r.data)).catch(() => {})
  }, [])

  async function sendTest(e) {
    e.preventDefault()
    setSending(true)
    setResult(null)
    try {
      const { data } = await axios.post('/api/alerts/smtp-test', { to })
      setResult(data)
    } catch (err) {
      setResult({ delivered: false, error: err.response?.data?.detail || err.message })
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="bg-gray-900/60 border border-gray-800 rounded-xl px-4 py-3 space-y-3">
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium text-white">📧 Email / SMTP Settings</span>
        {config && (
          <span className={`text-xs px-1.5 py-0.5 rounded ${config.configured ? 'bg-emerald-500/20 text-emerald-400' : 'bg-rose-500/20 text-rose-400'}`}>
            {config.configured ? 'configured' : 'not configured'}
          </span>
        )}
      </div>

      {config && config.configured && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
          {[
            ['Host',  `${config.host}:${config.port}`],
            ['User',  config.user  || '—'],
            ['From',  config.from_addr || '—'],
          ].map(([label, val]) => (
            <div key={label} className="bg-gray-800/60 rounded-lg px-2.5 py-1.5">
              <div className="text-gray-600 mb-0.5">{label}</div>
              <div className="font-mono text-gray-300 truncate">{val}</div>
            </div>
          ))}
        </div>
      )}

      {config && !config.configured && (
        <div className="text-xs text-gray-500">
          Set <code className="bg-gray-800 px-1 rounded">SMTP_HOST</code>,{' '}
          <code className="bg-gray-800 px-1 rounded">SMTP_USER</code>,{' '}
          <code className="bg-gray-800 px-1 rounded">SMTP_PASSWORD</code>, and{' '}
          <code className="bg-gray-800 px-1 rounded">SMTP_FROM</code> in your <code className="bg-gray-800 px-1 rounded">.env</code> to enable email delivery.
        </div>
      )}

      <form onSubmit={sendTest} className="flex gap-2 items-center">
        <input
          type="email"
          placeholder="Send test email to…"
          value={to}
          onChange={e => { setTo(e.target.value); setResult(null) }}
          required
          className="flex-1 input-sm"
        />
        <button type="submit" disabled={sending || !config?.configured}
          title={!config?.configured ? 'SMTP not configured' : 'Send a test email'}
          className="text-xs px-3 py-1.5 bg-sky-500/20 text-sky-300 hover:bg-sky-500/40 rounded-lg transition-colors disabled:opacity-40 shrink-0">
          {sending ? 'Sending…' : 'Send Test'}
        </button>
      </form>

      {result && (
        <div className={`text-xs px-3 py-2 rounded-lg flex items-start gap-2 ${result.delivered ? 'bg-emerald-500/10 text-emerald-400' : 'bg-rose-500/10 text-rose-300'}`}>
          <span className="shrink-0">{result.delivered ? '✓' : '✗'}</span>
          <span>{result.delivered ? `Test email sent to ${to}` : `Failed: ${result.error}`}</span>
        </div>
      )}
    </div>
  )
}

// ── Main AlertsConfig ──────────────────────────────────────────────────────

export default function AlertsConfig() {
  const [channels, setChannels] = useState([])
  const [rules,    setRules]    = useState([])
  const [history,  setHistory]  = useState([])
  const [editCh,   setEditCh]   = useState(null)   // null | {} | {id,...}
  const [editRule, setEditRule]  = useState(null)   // null | {} | {id,...}
  const [tab,      setTab]       = useState('rules')
  const [deleting, setDeleting]  = useState(null)
  const [runResults,  setRunResults]  = useState({})  // { [ruleId]: { loading, result } }
  const [testResults, setTestResults] = useState({})  // { [chId]:   { loading, result } }

  const load = useCallback(() => {
    axios.get('/api/alerts/channels').then(r => setChannels(r.data)).catch(() => {})
    axios.get('/api/alerts/rules').then(r => setRules(r.data)).catch(() => {})
    axios.get('/api/alerts/history?limit=50').then(r => setHistory(r.data)).catch(() => {})
  }, [])

  useEffect(() => { load() }, [load])

  async function deleteChannel(id) {
    if (!confirm('Delete this channel? Any rules using it will lose their delivery target.')) return
    setDeleting(`ch-${id}`)
    try { await axios.delete(`/api/alerts/channels/${id}`); load() }
    catch (e) { alert(e.response?.data?.detail || e.message) }
    finally { setDeleting(null) }
  }

  async function deleteRule(id) {
    if (!confirm('Delete this rule?')) return
    setDeleting(`rule-${id}`)
    try { await axios.delete(`/api/alerts/rules/${id}`); load() }
    catch (e) { alert(e.response?.data?.detail || e.message) }
    finally { setDeleting(null) }
  }

  async function toggleRule(rule) {
    try {
      await axios.put(`/api/alerts/rules/${rule.id}`, { ...rule, enabled: !rule.enabled })
      load()
    } catch (e) { alert(e.response?.data?.detail || e.message) }
  }

  async function testChannel(chId) {
    setTestResults(prev => ({ ...prev, [chId]: { loading: true, result: null } }))
    try {
      const { data } = await axios.post(`/api/alerts/channels/${chId}/test`)
      setTestResults(prev => ({ ...prev, [chId]: { loading: false, result: data } }))
      setTimeout(() => setTestResults(prev => {
        const next = { ...prev }
        delete next[chId]
        return next
      }), 8000)
    } catch (e) {
      setTestResults(prev => ({
        ...prev,
        [chId]: { loading: false, result: { delivered: false, error: e.response?.data?.detail || e.message } }
      }))
    }
  }

  async function runNow(ruleId) {
    setRunResults(prev => ({ ...prev, [ruleId]: { loading: true, result: null } }))
    try {
      const { data } = await axios.post(`/api/alerts/rules/${ruleId}/check-now`)
      setRunResults(prev => ({ ...prev, [ruleId]: { loading: false, result: data } }))
      // Auto-clear after 8 seconds
      setTimeout(() => setRunResults(prev => {
        const next = { ...prev }
        delete next[ruleId]
        return next
      }), 8000)
      load() // refresh last_fired_at
    } catch (e) {
      setRunResults(prev => ({
        ...prev,
        [ruleId]: { loading: false, result: { error: e.response?.data?.detail || e.message } }
      }))
    }
  }

  return (
    <div className="space-y-4">
      {/* Tab bar */}
      <div className="flex bg-gray-800 rounded-lg p-0.5 gap-0.5">
        {[['rules', 'Rules'], ['channels', 'Channels'], ['history', 'History']].map(([t, label]) => (
          <button key={t} onClick={() => setTab(t)}
            className={`flex-1 px-3 py-1.5 rounded-md text-xs font-medium transition-colors
              ${tab === t ? 'bg-gray-700 text-white' : 'text-gray-500 hover:text-gray-300'}`}>
            {label}
            {t === 'history' && history.length > 0 && (
              <span className="ml-1.5 text-[10px] px-1.5 py-0.5 bg-gray-600 rounded-full">{history.length}</span>
            )}
          </button>
        ))}
      </div>

      {/* ── Rules ─────────────────────────────────────────────────────────── */}
      {tab === 'rules' && (
        <div className="space-y-3">
          {editRule !== null && (
            <RuleForm
              initial={editRule.id ? editRule : undefined}
              channels={channels}
              onSave={() => { setEditRule(null); load() }}
              onCancel={() => setEditRule(null)}
            />
          )}

          {!rules.length && !editRule && (
            <div className="text-gray-600 text-sm text-center py-6">
              No rules configured. Create one to start receiving alerts.
            </div>
          )}

          {rules.map(rule => {
            const cond    = CONDITIONS.find(c => c.value === rule.condition)
            const rr      = runResults[rule.id]  // { loading, result } | undefined
            return (
              <div key={rule.id} className={`bg-gray-900/60 border rounded-xl px-4 py-3 ${rule.enabled ? 'border-gray-800' : 'border-gray-800/40 opacity-60'}`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-white text-sm">{rule.name}</span>
                      <span className="text-xs px-1.5 py-0.5 bg-violet-500/20 text-violet-300 rounded">
                        {cond?.label ?? rule.condition}
                      </span>
                      {!rule.enabled && (
                        <span className="text-xs px-1.5 py-0.5 bg-gray-700 text-gray-500 rounded">disabled</span>
                      )}
                    </div>
                    <div className="text-xs text-gray-500 mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
                      <span>Channel: {rule.channel_name ? `${rule.channel_name} (${rule.channel_type})` : 'log only'}</span>
                      <span>Cooldown: {rule.cooldown_minutes}m</span>
                      {rule.last_fired_at && <span>Last fired: {fmtTime(rule.last_fired_at)}</span>}
                    </div>
                    {rule.params && Object.keys(rule.params).length > 0 && (
                      <div className="text-xs text-gray-600 mt-0.5 font-mono">
                        {Object.entries(rule.params).map(([k, v]) => `${k}: ${v}`).join(', ')}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      onClick={() => runNow(rule.id)}
                      disabled={rr?.loading}
                      title="Evaluate condition now — fires alert if met (ignores cooldown)"
                      className="text-xs px-2.5 py-1 bg-violet-500/10 text-violet-400 hover:bg-violet-500/25 rounded-lg transition-colors disabled:opacity-50">
                      {rr?.loading ? '⏳' : '▶ Run'}
                    </button>
                    <button onClick={() => toggleRule(rule)}
                      className="text-xs px-2.5 py-1 bg-gray-800 text-gray-400 hover:text-white hover:bg-gray-700 rounded-lg transition-colors">
                      {rule.enabled ? 'Disable' : 'Enable'}
                    </button>
                    <button onClick={() => setEditRule(rule)}
                      className="text-xs px-2.5 py-1 bg-gray-800 text-gray-400 hover:text-white hover:bg-gray-700 rounded-lg transition-colors">
                      Edit
                    </button>
                    <button onClick={() => deleteRule(rule.id)} disabled={deleting === `rule-${rule.id}`}
                      className="text-xs px-2.5 py-1 bg-rose-500/10 text-rose-400 hover:bg-rose-500/25 rounded-lg transition-colors disabled:opacity-50">
                      {deleting === `rule-${rule.id}` ? '…' : 'Delete'}
                    </button>
                  </div>
                </div>

                {/* Inline run-now result */}
                {rr && !rr.loading && rr.result && (
                  <div className={`mt-2.5 text-xs px-3 py-2 rounded-lg flex items-start gap-2 ${
                    rr.result.error
                      ? 'bg-rose-500/10 text-rose-300'
                      : rr.result.condition_met && rr.result.delivered
                        ? 'bg-amber-500/10 text-amber-300'
                        : rr.result.condition_met && !rr.result.delivered
                          ? 'bg-rose-500/10 text-rose-300'
                          : 'bg-gray-800/60 text-gray-400'
                  }`}>
                    <span className="shrink-0">
                      {rr.result.error ? '✗' : rr.result.condition_met ? (rr.result.delivered ? '⚡' : '✗') : '✓'}
                    </span>
                    <span>
                      {rr.result.error
                        ? `Error: ${rr.result.error}`
                        : rr.result.condition_met
                          ? rr.result.delivered
                            ? `Condition met — alert delivered: ${rr.result.message}`
                            : `Condition met but delivery failed: ${rr.result.error ?? 'unknown error'}`
                          : `Condition not met — ${rr.result.message}`
                      }
                    </span>
                  </div>
                )}
              </div>
            )
          })}

          {!editRule && (
            <button onClick={() => setEditRule({})}
              className="w-full text-xs py-2 border border-dashed border-gray-700 text-gray-500 hover:text-gray-300 hover:border-gray-600 rounded-xl transition-colors">
              + Add Rule
            </button>
          )}
        </div>
      )}

      {/* ── Channels ──────────────────────────────────────────────────────── */}
      {tab === 'channels' && (
        <div className="space-y-3">
          <SmtpTestPanel />
          {editCh !== null && (
            <ChannelForm
              initial={editCh.id ? editCh : undefined}
              channels={channels}
              onSave={() => { setEditCh(null); load() }}
              onCancel={() => setEditCh(null)}
            />
          )}

          {!channels.length && !editCh && (
            <div className="text-gray-600 text-sm text-center py-6">
              No channels configured. Add one to enable alert delivery.
            </div>
          )}

          {channels.map(ch => {
            const tr = testResults[ch.id]
            return (
            <div key={ch.id} className={`bg-gray-900/60 border border-gray-800 rounded-xl px-4 py-3 ${!ch.enabled ? 'opacity-60' : ''}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-white text-sm">{ch.name}</span>
                    <span className="text-xs px-1.5 py-0.5 bg-sky-500/20 text-sky-300 rounded">{ch.type}</span>
                    {!ch.enabled && <span className="text-xs px-1.5 py-0.5 bg-gray-700 text-gray-500 rounded">disabled</span>}
                  </div>
                  <div className="text-xs text-gray-600 mt-0.5 font-mono">
                    {ch.config?.email || ch.config?.url || '—'}
                  </div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <button onClick={() => testChannel(ch.id)} disabled={tr?.loading}
                    title="Send a test message via this channel"
                    className="text-xs px-2.5 py-1 bg-sky-500/10 text-sky-400 hover:bg-sky-500/25 rounded-lg transition-colors disabled:opacity-50">
                    {tr?.loading ? 'Sending…' : 'Send Test'}
                  </button>
                  <button onClick={() => setEditCh(ch)}
                    className="text-xs px-2.5 py-1 bg-gray-800 text-gray-400 hover:text-white hover:bg-gray-700 rounded-lg transition-colors">
                    Edit
                  </button>
                  <button onClick={() => deleteChannel(ch.id)} disabled={deleting === `ch-${ch.id}`}
                    className="text-xs px-2.5 py-1 bg-rose-500/10 text-rose-400 hover:bg-rose-500/25 rounded-lg transition-colors disabled:opacity-50">
                    {deleting === `ch-${ch.id}` ? '…' : 'Delete'}
                  </button>
                </div>
              </div>

              {/* Inline test result */}
              {tr && !tr.loading && tr.result && (
                <div className={`mt-2.5 text-xs px-3 py-2 rounded-lg flex items-start gap-2 ${
                  tr.result.delivered
                    ? 'bg-emerald-500/10 text-emerald-400'
                    : 'bg-rose-500/10 text-rose-300'
                }`}>
                  <span className="shrink-0">{tr.result.delivered ? '✓' : '✗'}</span>
                  <span>
                    {tr.result.delivered
                      ? 'Test message delivered successfully'
                      : `Delivery failed: ${tr.result.error || 'unknown error'}`
                    }
                  </span>
                </div>
              )}
            </div>
            )
          })}

          {!editCh && (
            <button onClick={() => setEditCh({})}
              className="w-full text-xs py-2 border border-dashed border-gray-700 text-gray-500 hover:text-gray-300 hover:border-gray-600 rounded-xl transition-colors">
              + Add Channel
            </button>
          )}
        </div>
      )}

      {/* ── History ───────────────────────────────────────────────────────── */}
      {tab === 'history' && (
        <div>
          {!history.length && (
            <div className="text-gray-600 text-sm text-center py-6">No alerts have fired yet</div>
          )}
          {history.length > 0 && (
            <div className="rounded-xl border border-gray-800 overflow-hidden">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-gray-900/80 text-gray-500 uppercase tracking-wider text-left border-b border-gray-800">
                    <th className="px-3 py-2.5 font-medium">Time</th>
                    <th className="px-3 py-2.5 font-medium">Rule</th>
                    <th className="px-3 py-2.5 font-medium hidden sm:table-cell">Message</th>
                    <th className="px-3 py-2.5 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-800/50">
                  {history.map(h => (
                    <tr key={h.id} className="hover:bg-gray-800/30 transition-colors">
                      <td className="px-3 py-2 text-gray-500 whitespace-nowrap">{fmtTime(h.fired_at)}</td>
                      <td className="px-3 py-2 text-white font-medium">{h.rule_name}</td>
                      <td className="px-3 py-2 text-gray-400 max-w-[200px] truncate hidden sm:table-cell" title={h.message}>{h.message}</td>
                      <td className="px-3 py-2">
                        {h.delivered
                          ? <span className="text-emerald-400">✓ delivered</span>
                          : h.channel_type
                            ? <span className="text-rose-400" title={h.error}>✗ failed</span>
                            : <span className="text-gray-600">logged</span>
                        }
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
