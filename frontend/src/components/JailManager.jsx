import { useState } from 'react'
import { useApi } from '../hooks/useApi'
import axios from 'axios'

const DEFAULT_FORM = {
  name: '', filter: '', logpath: '', port: 'http,https',
  maxretry: 5, findtime: '10m', bantime: '1h', action: ''
}

function CannedJailCard({ jail, activeJails, onAdd }) {
  const isActive = activeJails.includes(jail.name)
  return (
    <div className={`border rounded-xl p-4 flex flex-col gap-2 transition-colors
      ${isActive ? 'border-emerald-500/40 bg-emerald-500/5' : 'border-gray-700 bg-gray-800/50 hover:border-gray-600'}`}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="font-mono text-sm text-sky-400">{jail.name}</div>
          <div className="text-xs text-gray-400 mt-0.5">{jail.description}</div>
        </div>
        {isActive
          ? <span className="shrink-0 text-xs bg-emerald-500/20 text-emerald-300 px-2 py-0.5 rounded-full">Active</span>
          : <button
              onClick={() => onAdd(jail)}
              className="shrink-0 text-xs bg-sky-500/20 text-sky-300 hover:bg-sky-500/40 px-3 py-1 rounded-lg transition-colors"
            >
              Add Jail
            </button>
        }
      </div>
      <div className="grid grid-cols-3 gap-2 text-xs text-gray-500 mt-1">
        <span>retry: <span className="text-gray-300">{jail.maxretry}</span></span>
        <span>find: <span className="text-gray-300">{jail.findtime}</span></span>
        <span>ban: <span className="text-gray-300">{jail.bantime}</span></span>
      </div>
    </div>
  )
}

function FormField({ label, name, value, onChange, type = 'text', hint }) {
  return (
    <div>
      <label className="block text-xs text-gray-400 mb-1">{label}</label>
      <input
        type={type}
        value={value}
        onChange={e => onChange(name, type === 'number' ? Number(e.target.value) : e.target.value)}
        className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-sky-500"
      />
      {hint && <div className="text-xs text-gray-600 mt-0.5">{hint}</div>}
    </div>
  )
}

export default function JailManager({ activeJails = [], onRefresh }) {
  const { data: canned } = useApi('/f2b/canned_jails', {}, 0)
  const [mode, setMode] = useState(null) // null | 'canned' | 'custom' | 'raw'
  const [form, setForm] = useState(DEFAULT_FORM)
  const [rawContent, setRawContent] = useState('')
  const [rawName, setRawName] = useState('')
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState(null)

  function setField(name, value) {
    setForm(f => ({ ...f, [name]: value }))
  }

  function prefillCanned(jail) {
    setForm({ ...DEFAULT_FORM, ...jail })
    setMode('custom')
  }

  async function submitForm() {
    setSaving(true)
    setMessage(null)
    try {
      const { data } = await axios.post('/api/f2b/jail/create', form)
      if (!data.success) {
        setMessage({ type: 'err', text: data.warning || 'Failed to create jail' })
        return
      }
      setMessage({ type: 'ok', text: `Jail "${form.name}" created and fail2ban reloaded.` })
      setForm(DEFAULT_FORM)
      setMode(null)
      onRefresh()
    } catch (e) {
      setMessage({ type: 'err', text: e.response?.data?.detail || e.message })
    } finally {
      setSaving(false)
    }
  }

  async function submitRaw() {
    setSaving(true)
    setMessage(null)
    try {
      const { data } = await axios.put('/api/f2b/jail/raw', { name: rawName, content: rawContent })
      if (!data.success) {
        setMessage({ type: 'err', text: data.warning || 'Failed to save jail' })
        return
      }
      setMessage({ type: 'ok', text: `Jail "${rawName}" saved and fail2ban reloaded.` })
      setRawName(''); setRawContent(''); setMode(null)
      onRefresh()
    } catch (e) {
      setMessage({ type: 'err', text: e.response?.data?.detail || e.message })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="card space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-widest">Manage Jails</h2>
        <div className="flex gap-2">
          <button
            onClick={() => setMode(mode === 'canned' ? null : 'canned')}
            className={`text-xs px-3 py-1.5 rounded-lg transition-colors
              ${mode === 'canned' ? 'bg-sky-500 text-white' : 'bg-gray-800 text-gray-300 hover:bg-gray-700'}`}
          >
            + From Library
          </button>
          <button
            onClick={() => setMode(mode === 'custom' ? null : 'custom')}
            className={`text-xs px-3 py-1.5 rounded-lg transition-colors
              ${mode === 'custom' ? 'bg-violet-500 text-white' : 'bg-gray-800 text-gray-300 hover:bg-gray-700'}`}
          >
            + Custom Jail
          </button>
          <button
            onClick={() => setMode(mode === 'raw' ? null : 'raw')}
            className={`text-xs px-3 py-1.5 rounded-lg transition-colors
              ${mode === 'raw' ? 'bg-amber-500 text-white' : 'bg-gray-800 text-gray-300 hover:bg-gray-700'}`}
          >
            + Raw Config
          </button>
        </div>
      </div>

      {message && (
        <div className={`text-sm rounded-lg px-3 py-2 ${message.type === 'ok' ? 'bg-emerald-500/20 text-emerald-300' : 'bg-rose-500/20 text-rose-300'}`}>
          {message.text}
        </div>
      )}

      {/* Canned jail library */}
      {mode === 'canned' && (
        <div>
          <div className="text-xs text-gray-500 mb-3">Click "Add Jail" to activate, or customize settings first.</div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {(canned ?? []).map(jail => (
              <CannedJailCard
                key={jail.name}
                jail={jail}
                activeJails={activeJails}
                onAdd={prefillCanned}
              />
            ))}
          </div>
        </div>
      )}

      {/* Form editor (custom or pre-filled from canned) */}
      {mode === 'custom' && (
        <div className="space-y-4 border border-gray-700 rounded-xl p-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <FormField label="Jail Name *" name="name" value={form.name} onChange={setField} hint="Lowercase letters, numbers, hyphens only" />
            <FormField label="Filter Name *" name="filter" value={form.filter} onChange={setField} hint="Must match a file in /etc/fail2ban/filter.d/" />
            <FormField label="Port(s)" name="port" value={form.port} onChange={setField} hint='e.g. "ssh" or "http,https" or "all"' />
            <FormField label="Max Retries" name="maxretry" value={form.maxretry} onChange={setField} type="number" />
            <FormField label="Find Time" name="findtime" value={form.findtime} onChange={setField} hint='e.g. "10m", "1h", "1d"' />
            <FormField label="Ban Time" name="bantime" value={form.bantime} onChange={setField} hint='e.g. "30m", "24h", "7d", "-1" for permanent' />
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">Log Path(s) *</label>
            <textarea
              rows={3}
              value={form.logpath}
              onChange={e => setField('logpath', e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm font-mono text-gray-100 focus:outline-none focus:border-sky-500"
              placeholder="/npm_logs/proxy-host-*_access.log"
            />
          </div>
          <div className="flex gap-3 justify-end">
            <button onClick={() => { setMode(null); setForm(DEFAULT_FORM) }} className="text-sm px-4 py-2 text-gray-400 hover:text-gray-200">Cancel</button>
            <button
              onClick={submitForm}
              disabled={saving || !form.name || !form.filter || !form.logpath}
              className="text-sm px-4 py-2 bg-sky-500 hover:bg-sky-400 text-white rounded-lg disabled:opacity-50 transition-colors"
            >
              {saving ? 'Saving…' : 'Create Jail'}
            </button>
          </div>
        </div>
      )}

      {/* Raw config editor */}
      {mode === 'raw' && (
        <div className="space-y-4 border border-gray-700 rounded-xl p-4">
          <div>
            <label className="block text-xs text-gray-400 mb-1">Jail Name (used as filename)</label>
            <input
              value={rawName}
              onChange={e => setRawName(e.target.value)}
              placeholder="my-custom-jail"
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm font-mono text-gray-100 focus:outline-none focus:border-amber-500"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">Raw jail config</label>
            <textarea
              rows={12}
              value={rawContent}
              onChange={e => setRawContent(e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm font-mono text-gray-100 focus:outline-none focus:border-amber-500"
              placeholder={`[my-jail]\nenabled = true\nfilter = my-filter\nlogpath = /var/log/myapp.log\nmaxretry = 5\nfindtime = 10m\nbantime = 1h`}
            />
          </div>
          <div className="flex gap-3 justify-end">
            <button onClick={() => { setMode(null); setRawContent(''); setRawName('') }} className="text-sm px-4 py-2 text-gray-400 hover:text-gray-200">Cancel</button>
            <button
              onClick={submitRaw}
              disabled={saving || !rawName || !rawContent}
              className="text-sm px-4 py-2 bg-amber-500 hover:bg-amber-400 text-white rounded-lg disabled:opacity-50 transition-colors"
            >
              {saving ? 'Saving…' : 'Save & Reload'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
