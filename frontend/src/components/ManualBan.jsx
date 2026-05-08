import { useState } from 'react'
import { useApi } from '../hooks/useApi'
import axios from 'axios'

function isValidIpOrCidr(s) {
  const ipv4 = /^(\d{1,3}\.){3}\d{1,3}(\/\d{1,2})?$/
  const ipv6 = /^[0-9a-fA-F:]+(:\/\d{1,3})?$/
  return ipv4.test(s) || ipv6.test(s)
}

function fmtDate(iso) {
  if (!iso) return null
  try {
    return new Date(iso).toLocaleString('en-US', {
      month: 'short', day: '2-digit',
      hour: '2-digit', minute: '2-digit',
      hour12: false,
    })
  } catch {
    return null
  }
}

export default function ManualBan() {
  const { data: banned, refetch } = useApi('/f2b/manual/banned', {}, 15000)
  const [input, setInput]   = useState('')
  const [reason, setReason] = useState('')
  const [banning, setBanning]     = useState(false)
  const [unbanning, setUnbanning] = useState(null)
  const [message, setMessage]     = useState(null)

  const valid = isValidIpOrCidr(input.trim())

  async function ban() {
    if (!valid) return
    setBanning(true)
    setMessage(null)
    try {
      await axios.post('/api/f2b/manual/ban', {
        ip: input.trim(),
        reason: reason.trim() || 'Manually banned',
      })
      setMessage({ type: 'ok', text: `${input.trim()} blocked.` })
      setInput('')
      setReason('')
      refetch()
    } catch (e) {
      setMessage({ type: 'err', text: e.response?.data?.detail || e.message })
    } finally {
      setBanning(false)
    }
  }

  async function unban(ip) {
    setUnbanning(ip)
    try {
      await axios.delete('/api/f2b/manual/ban', { params: { ip } })
      refetch()
    } catch (e) {
      setMessage({ type: 'err', text: e.response?.data?.detail || e.message })
    } finally {
      setUnbanning(null)
    }
  }

  // Sort: auto-escalated last, then alphabetically by IP
  const sorted = [...(banned ?? [])].sort((a, b) => {
    if (a.auto && !b.auto) return 1
    if (!a.auto && b.auto) return -1
    return (a.ip ?? '').localeCompare(b.ip ?? '')
  })

  const autoCount   = sorted.filter(e => e.auto).length
  const manualCount = sorted.filter(e => !e.auto).length

  return (
    <div className="card space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-widest">Block IP / CIDR</h2>
        {banned?.length > 0 && (
          <div className="flex gap-2 text-xs text-gray-500">
            {manualCount > 0 && <span>{manualCount} manual</span>}
            {autoCount   > 0 && <span className="text-rose-400">{autoCount} auto-escalated</span>}
          </div>
        )}
      </div>

      {message && (
        <div className={`text-sm rounded-lg px-3 py-2 ${message.type === 'ok' ? 'bg-emerald-500/20 text-emerald-300' : 'bg-rose-500/20 text-rose-300'}`}>
          {message.text}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <input
          value={input}
          onChange={e => setInput(e.target.value.trim())}
          onKeyDown={e => e.key === 'Enter' && valid && ban()}
          placeholder="1.2.3.4 or 192.168.0.0/24"
          className="flex-1 min-w-48 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm font-mono text-gray-100 focus:outline-none focus:border-rose-500"
        />
        <input
          value={reason}
          onChange={e => setReason(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && valid && ban()}
          placeholder="Reason (optional)"
          className="flex-1 min-w-48 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-300 focus:outline-none focus:border-rose-500"
        />
        <button
          onClick={ban}
          disabled={!valid || banning}
          className="text-sm px-4 py-2 bg-rose-500/20 text-rose-300 hover:bg-rose-500/40 rounded-lg disabled:opacity-40 transition-colors whitespace-nowrap"
        >
          {banning ? 'Blocking…' : 'Block'}
        </button>
      </div>

      {sorted.length > 0 && (
        <div>
          <div className="text-xs text-gray-500 uppercase tracking-widest mb-2">Currently Blocked</div>
          <div className="space-y-1 max-h-72 overflow-y-auto">
            {sorted.map(entry => (
              <div
                key={entry.ip}
                className={`flex items-start justify-between rounded-lg px-3 py-2 gap-3
                  ${entry.auto ? 'bg-rose-950/30 border border-rose-500/20' : 'bg-gray-800/60'}`}
              >
                <div className="flex-1 min-w-0 space-y-0.5">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono text-rose-300 text-sm">{entry.ip}</span>
                    {entry.auto && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-rose-500/20 text-rose-400 font-medium uppercase tracking-wide">
                        Auto
                      </span>
                    )}
                  </div>
                  {entry.reason && (
                    <div className="text-xs text-gray-500 truncate" title={entry.reason}>
                      {entry.reason}
                    </div>
                  )}
                  {entry.added_at && fmtDate(entry.added_at) && (
                    <div className="text-[10px] text-gray-600">{fmtDate(entry.added_at)}</div>
                  )}
                </div>
                <button
                  onClick={() => unban(entry.ip)}
                  disabled={unbanning === entry.ip}
                  className="shrink-0 text-xs px-2.5 py-1 bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/40 rounded-lg transition-colors disabled:opacity-50"
                >
                  {unbanning === entry.ip ? '…' : 'Unban'}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
