import { useState, useEffect, useCallback } from 'react'
import axios from 'axios'

function Drawer({ title, onClose, children }) {
  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="absolute right-0 top-0 bottom-0 w-full max-w-lg bg-gray-950 border-l border-gray-800 flex flex-col shadow-2xl">
        <div className="flex items-center justify-between p-5 border-b border-gray-800 shrink-0">
          <div className="font-bold text-white text-lg">{title}</div>
          <button onClick={onClose} className="text-gray-500 hover:text-white text-xl leading-none">✕</button>
        </div>
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {children}
        </div>
      </div>
    </div>
  )
}

function CopyButton({ text }) {
  const [copied, setCopied] = useState(false)
  async function copy() {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // fallback: select the text
    }
  }
  return (
    <button
      onClick={copy}
      className="shrink-0 text-xs px-2.5 py-1.5 bg-sky-500/20 text-sky-300 hover:bg-sky-500/40 rounded-lg transition-colors"
    >
      {copied ? '✓ Copied' : 'Copy'}
    </button>
  )
}

const EVENT_COLORS = {
  LOGIN_OK:            'text-emerald-400',
  ADMIN_CREATED:       'text-emerald-400',
  MFA_SETUP_OK:        'text-emerald-400',
  INVITE_ACCEPTED:     'text-emerald-400',
  INVITE_CREATED:      'text-sky-400',
  RESET_LINK_CREATED:  'text-sky-400',
  FORGOT_EMAIL_SENT:   'text-sky-400',
  RESET_PASSWORD_SET:  'text-amber-400',
  INVITE_PASSWORD_SET: 'text-amber-400',
  LOGIN_FAILED:        'text-rose-400',
  LOGIN_FAILED_MFA:    'text-rose-400',
  FORGOT_EMAIL_FAILED: 'text-rose-400',
}

function AuditLog() {
  const [log, setLog] = useState(null)
  useEffect(() => {
    axios.get('/auth/api/audit').then(r => setLog(r.data)).catch(() => setLog([]))
  }, [])

  if (!log) return <div className="text-gray-600 text-sm text-center py-8">Loading…</div>
  if (!log.length) return <div className="text-gray-600 text-sm text-center py-8">No audit events recorded yet</div>

  return (
    <div className="space-y-px font-mono text-xs">
      {log.map(e => (
        <div key={e.id} className="flex items-start gap-2 py-1.5 px-2 rounded hover:bg-gray-800/40 border-b border-gray-800/40 last:border-0">
          <span className="text-gray-600 shrink-0 w-36">{e.ts}</span>
          <span className={`shrink-0 w-32 ${EVENT_COLORS[e.event] || 'text-gray-400'}`}>{e.event}</span>
          <span className="text-gray-300 flex-1 truncate">{e.username}</span>
          <span className="text-gray-600 shrink-0 w-28 text-right truncate">{e.ip}</span>
        </div>
      ))}
    </div>
  )
}

export default function UserManagement({ onClose }) {
  const [tab,     setTab]     = useState('users')
  const [users,   setUsers]   = useState(null)
  const [invites, setInvites] = useState(null)
  const [form,    setForm]    = useState({ name: '', email: '', is_admin: false })

  const refetch = useCallback(() => {
    axios.get('/auth/api/users').then(r => setUsers(r.data)).catch(() => {})
    axios.get('/auth/api/invites').then(r => setInvites(r.data)).catch(() => {})
  }, [])

  useEffect(() => { refetch() }, [refetch])

  const [deleting,       setDeleting]       = useState(null)
  const [revoking,       setRevoking]       = useState(null)
  const [generating,     setGenerating]     = useState(false)
  const [sendingReset,   setSendingReset]   = useState(null)
  const [pendingLinks,   setPendingLinks]   = useState({}) // username → { url, kind }
  const [msg, setMsg] = useState(null)

  // ── Invite generation ───────────────────────────────────────────────────────
  async function generateInvite(e) {
    e.preventDefault()
    setGenerating(true)
    setMsg(null)
    try {
      const { data } = await axios.post('/auth/api/invites', {
        name: form.name,
        email: form.email,
        is_admin: form.is_admin,
      })
      const url = `${window.location.origin}/auth/invite/${data.token}`
      setPendingLinks(prev => ({ ...prev, [data.email]: { url, kind: 'invite' } }))
      setMsg({
        type: 'ok',
        text: `Invite created for ${data.email} — expires in ${data.expires_in_hours}h. Copy the link and send it to them.`,
      })
      setForm({ name: '', email: '', is_admin: false })
      refetch()
    } catch (e) {
      setMsg({ type: 'err', text: e.response?.data?.detail || e.message })
    } finally {
      setGenerating(false)
    }
  }

  // ── Send reset link ─────────────────────────────────────────────────────────
  async function sendResetLink(username) {
    setSendingReset(username)
    setMsg(null)
    try {
      const { data } = await axios.post(`/auth/api/users/${username}/reset-link`)
      const url = `${window.location.origin}/auth/invite/${data.token}`
      setPendingLinks(prev => ({ ...prev, [username]: { url, kind: 'reset' } }))
      setMsg({
        type: 'ok',
        text: `Reset link created for "${username}" — expires in ${data.expires_in_hours}h. Send it to the user.`,
      })
      refetch()
    } catch (e) {
      setMsg({ type: 'err', text: e.response?.data?.detail || e.message })
    } finally {
      setSendingReset(null)
    }
  }

  // ── Revoke invite / reset link ──────────────────────────────────────────────
  async function revokeInvite(token, username) {
    setRevoking(token)
    try {
      await axios.delete(`/auth/api/invites/${token}`)
      setMsg({ type: 'ok', text: `Link for "${username}" revoked.` })
      setPendingLinks(prev => { const n = { ...prev }; delete n[username]; return n })
      refetch()
    } catch (e) {
      setMsg({ type: 'err', text: e.response?.data?.detail || e.message })
    } finally {
      setRevoking(null)
    }
  }

  // ── Delete user ─────────────────────────────────────────────────────────────
  async function deleteUser(username) {
    if (!confirm(`Delete user "${username}"? This cannot be undone.`)) return
    setDeleting(username)
    try {
      await axios.delete(`/auth/api/users/${username}`)
      setMsg({ type: 'ok', text: `User "${username}" deleted.` })
      refetch()
    } catch (e) {
      setMsg({ type: 'err', text: e.response?.data?.detail || e.message })
    } finally {
      setDeleting(null)
    }
  }

  function fmtExpiry(ts) {
    const d = new Date(ts * 1000)
    const hLeft = Math.max(0, Math.round((ts - Date.now() / 1000) / 3600))
    return `expires in ${hLeft}h (${d.toLocaleString()})`
  }

  return (
    <Drawer title="User Management" onClose={onClose}>
      {/* Tab switcher */}
      <div className="flex bg-gray-800 rounded-lg p-0.5 gap-0.5 mb-1">
        {[['users', 'Users'], ['audit', 'Audit Log']].map(([t, label]) => (
          <button key={t} onClick={() => setTab(t)}
            className={`flex-1 px-3 py-1.5 rounded-md text-xs font-medium transition-colors
              ${tab === t ? 'bg-sky-500 text-white' : 'text-gray-400 hover:text-white'}`}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'audit' && <AuditLog />}
      {tab === 'users' && <>

      {msg && (
        <div className={`text-sm rounded-lg px-3 py-2 ${msg.type === 'ok' ? 'bg-emerald-500/20 text-emerald-300' : 'bg-rose-500/20 text-rose-300'}`}>
          {msg.text}
        </div>
      )}

      {/* ── Existing users ────────────────────────────────────────────────── */}
      <div>
        <div className="text-xs text-gray-500 uppercase tracking-widest mb-2">Existing Users</div>
        <div className="space-y-2">
          {!users?.length && <div className="text-gray-600 text-sm text-center py-4">No users found</div>}
          {users?.map(u => (
            <div key={u.id} className="bg-gray-900 border border-gray-800 rounded-xl px-4 py-3">
              <div className="flex items-center gap-3">
                <div className="flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-white font-medium">{u.name || u.username}</span>
                    {u.is_admin ? (
                      <span className="text-xs px-1.5 py-0.5 bg-violet-500/20 text-violet-300 rounded">admin</span>
                    ) : (
                      <span className="text-xs px-1.5 py-0.5 bg-gray-700 text-gray-400 rounded">user</span>
                    )}
                    {u.totp_confirmed ? (
                      <span className="text-xs px-1.5 py-0.5 bg-emerald-500/20 text-emerald-300 rounded">MFA ✓</span>
                    ) : (
                      <span className="text-xs px-1.5 py-0.5 bg-amber-500/20 text-amber-300 rounded">MFA pending</span>
                    )}
                  </div>
                  <div className="text-xs text-gray-600 mt-0.5">
                    {u.email || u.username} · Created {u.created_at?.slice(0, 10)}
                  </div>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => sendResetLink(u.username)}
                    disabled={sendingReset === u.username}
                    className="text-xs px-2.5 py-1.5 bg-gray-800 text-gray-400 hover:text-white hover:bg-gray-700 rounded-lg transition-colors disabled:opacity-50"
                  >
                    {sendingReset === u.username ? '…' : 'Reset'}
                  </button>
                  <button
                    onClick={() => deleteUser(u.username)}
                    disabled={deleting === u.username}
                    className="text-xs px-2.5 py-1.5 bg-rose-500/10 text-rose-400 hover:bg-rose-500/25 rounded-lg transition-colors disabled:opacity-50"
                  >
                    {deleting === u.username ? '…' : 'Delete'}
                  </button>
                </div>
              </div>

              {/* Show freshly generated reset link inline under the user row */}
              {pendingLinks[u.username]?.kind === 'reset' && (
                <div className="mt-3 pt-3 border-t border-gray-800 space-y-1.5">
                  <div className="text-xs text-amber-400">Reset link — send to user:</div>
                  <div className="flex items-center gap-2">
                    <input
                      readOnly
                      value={pendingLinks[u.username].url}
                      className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-2.5 py-1.5 text-xs font-mono text-gray-400 focus:outline-none select-all"
                      onClick={e => e.target.select()}
                    />
                    <CopyButton text={pendingLinks[u.username].url} />
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* ── Pending invites ────────────────────────────────────────────────── */}
      {invites?.length > 0 && (
        <div>
          <div className="text-xs text-gray-500 uppercase tracking-widest mb-2">Pending Invites</div>
          <div className="space-y-2">
            {invites.map(inv => {
              const link = pendingLinks[inv.username]?.url
                ?? `${window.location.origin}/auth/invite/${inv.token}`
              const isReset = inv.kind === 'reset'
              return (
                <div key={inv.token} className={`bg-gray-900 border rounded-xl px-4 py-3 space-y-2 ${isReset ? 'border-sky-500/20' : 'border-amber-500/20'}`}>
                  <div className="flex items-center gap-2 justify-between">
                    <div>
                      <span className="text-white font-medium">{inv.name || inv.username}</span>
                      {inv.email && inv.email !== inv.name && (
                        <span className="ml-2 text-xs text-gray-500">{inv.email}</span>
                      )}
                      {inv.is_admin ? (
                        <span className="ml-2 text-xs px-1.5 py-0.5 bg-violet-500/20 text-violet-300 rounded">admin</span>
                      ) : (
                        <span className="ml-2 text-xs px-1.5 py-0.5 bg-gray-700 text-gray-400 rounded">user</span>
                      )}
                      {isReset
                        ? <span className="ml-2 text-xs px-1.5 py-0.5 bg-sky-500/20 text-sky-300 rounded">reset pending</span>
                        : <span className="ml-2 text-xs px-1.5 py-0.5 bg-amber-500/20 text-amber-300 rounded">invite pending</span>
                      }
                    </div>
                    <button
                      onClick={() => revokeInvite(inv.token, inv.username)}
                      disabled={revoking === inv.token}
                      className="text-xs px-2.5 py-1.5 bg-rose-500/10 text-rose-400 hover:bg-rose-500/25 rounded-lg transition-colors disabled:opacity-50"
                    >
                      {revoking === inv.token ? '…' : 'Revoke'}
                    </button>
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      readOnly
                      value={link}
                      className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-2.5 py-1.5 text-xs font-mono text-gray-400 focus:outline-none select-all"
                      onClick={e => e.target.select()}
                    />
                    <CopyButton text={link} />
                  </div>
                  <div className="text-xs text-gray-600">{fmtExpiry(inv.expires_at)}</div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* ── Generate invite ────────────────────────────────────────────────── */}
      <div className="border-t border-gray-800 pt-4">
        <div className="text-xs text-gray-500 uppercase tracking-widest mb-3">Invite New User</div>
        <p className="text-xs text-gray-600 mb-3">
          The new user sets their own password via the invite link and is immediately taken through MFA setup. The link expires in 48 hours and is single-use.
        </p>
        <form onSubmit={generateInvite} className="space-y-3">
          <input
            type="text"
            value={form.name}
            onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
            placeholder="Full name"
            required
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-sky-500"
          />
          <input
            type="email"
            value={form.email}
            onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
            placeholder="Email address"
            required
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-sky-500"
          />
          <label className="flex items-center gap-2 text-sm text-gray-400 cursor-pointer">
            <input
              type="checkbox"
              checked={form.is_admin}
              onChange={e => setForm(f => ({ ...f, is_admin: e.target.checked }))}
              className="accent-violet-500"
            />
            Admin (can manage users and all settings)
          </label>
          <button
            type="submit"
            disabled={generating}
            className="w-full text-sm py-2 bg-sky-500/20 text-sky-300 hover:bg-sky-500/40 rounded-lg transition-colors disabled:opacity-50"
          >
            {generating ? 'Generating…' : '🔗 Generate Invite Link'}
          </button>
        </form>

        {/* Show freshly generated invite link inline after form submission */}
        {form.name === '' && (() => {
          const pendingEmails = new Set((invites ?? []).map(i => i.email || i.username))
          const fresh = Object.entries(pendingLinks).find(
            ([e, v]) => v.kind === 'invite' && !pendingEmails.has(e)
          )
          if (!fresh) return null
          const [, { url }] = fresh
          return (
            <div className="mt-3 p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-xl space-y-2">
              <div className="text-xs text-emerald-400 font-medium">Invite link ready — send this to the user:</div>
              <div className="flex items-center gap-2">
                <input
                  readOnly
                  value={url}
                  className="flex-1 bg-gray-900 border border-gray-700 rounded-lg px-2.5 py-1.5 text-xs font-mono text-gray-300 focus:outline-none select-all"
                  onClick={e => e.target.select()}
                />
                <CopyButton text={url} />
              </div>
            </div>
          )
        })()}
      </div>
      </>}
    </Drawer>
  )
}
