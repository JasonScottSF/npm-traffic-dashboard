import { useState, useEffect } from 'react'
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

export default function UserManagement({ onClose }) {
  const [users, setUsers] = useState(null)
  const [form, setForm] = useState({ username: '', password: '', is_admin: false })

  function refetch() {
    axios.get('/auth/api/users').then(r => setUsers(r.data)).catch(() => {})
  }

  useEffect(() => { refetch() }, [])
  const [resetting, setResetting] = useState(null)
  const [newPw, setNewPw] = useState('')
  const [deleting, setDeleting] = useState(null)
  const [msg, setMsg] = useState(null)
  const [creating, setCreating] = useState(false)

  async function createUser(e) {
    e.preventDefault()
    setCreating(true)
    setMsg(null)
    try {
      await axios.post('/auth/api/users', form)
      setMsg({ type: 'ok', text: `User "${form.username}" created. They must log in to set up MFA.` })
      setForm({ username: '', password: '', is_admin: false })
      refetch()
    } catch (e) {
      setMsg({ type: 'err', text: e.response?.data?.detail || e.message })
    } finally {
      setCreating(false)
    }
  }

  async function resetPassword(username) {
    if (!newPw || newPw.length < 8) {
      setMsg({ type: 'err', text: 'Password must be 8+ characters' })
      return
    }
    try {
      await axios.put(`/auth/api/users/${username}/password`, { password: newPw })
      setMsg({ type: 'ok', text: `Password reset for "${username}". MFA will be re-setup on next login.` })
      setResetting(null)
      setNewPw('')
      refetch()
    } catch (e) {
      setMsg({ type: 'err', text: e.response?.data?.detail || e.message })
    }
  }

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
      setDeleting(null) }
  }

  return (
    <Drawer title="User Management" onClose={onClose}>
      {msg && (
        <div className={`text-sm rounded-lg px-3 py-2 ${msg.type === 'ok' ? 'bg-emerald-500/20 text-emerald-300' : 'bg-rose-500/20 text-rose-300'}`}>
          {msg.text}
        </div>
      )}

      {/* User list */}
      <div>
        <div className="text-xs text-gray-500 uppercase tracking-widest mb-2">Existing Users</div>
        <div className="space-y-2">
          {!users?.length && <div className="text-gray-600 text-sm text-center py-4">No users found</div>}
          {users?.map(u => (
            <div key={u.id} className="bg-gray-900 border border-gray-800 rounded-xl px-4 py-3">
              <div className="flex items-center gap-3">
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-white font-medium">{u.username}</span>
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
                  <div className="text-xs text-gray-600 mt-0.5">Created {u.created_at?.slice(0, 10)}</div>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => { setResetting(resetting === u.username ? null : u.username); setNewPw('') }}
                    className="text-xs px-2.5 py-1.5 bg-gray-800 text-gray-400 hover:text-white hover:bg-gray-700 rounded-lg transition-colors"
                  >
                    Reset PW
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

              {resetting === u.username && (
                <div className="flex gap-2 mt-3 pt-3 border-t border-gray-800">
                  <input
                    type="password"
                    value={newPw}
                    onChange={e => setNewPw(e.target.value)}
                    placeholder="New password (8+ chars)"
                    className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-gray-100 focus:outline-none focus:border-sky-500"
                  />
                  <button
                    onClick={() => resetPassword(u.username)}
                    className="text-xs px-3 py-1.5 bg-sky-500/20 text-sky-300 hover:bg-sky-500/40 rounded-lg transition-colors"
                  >
                    Save
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Create user form */}
      <div className="border-t border-gray-800 pt-4">
        <div className="text-xs text-gray-500 uppercase tracking-widest mb-3">Add User</div>
        <form onSubmit={createUser} className="space-y-3">
          <input
            type="text"
            value={form.username}
            onChange={e => setForm(f => ({ ...f, username: e.target.value }))}
            placeholder="Username"
            required
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-sky-500"
          />
          <input
            type="password"
            value={form.password}
            onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
            placeholder="Password (8+ characters)"
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
            disabled={creating}
            className="w-full text-sm py-2 bg-sky-500/20 text-sky-300 hover:bg-sky-500/40 rounded-lg transition-colors disabled:opacity-50"
          >
            {creating ? 'Creating…' : 'Create User'}
          </button>
        </form>
        <p className="text-xs text-gray-600 mt-2">New users must log in and complete MFA setup before accessing the dashboard.</p>
      </div>
    </Drawer>
  )
}
