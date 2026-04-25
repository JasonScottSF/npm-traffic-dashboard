import { useState } from 'react'
import { useApi } from '../hooks/useApi'
import axios from 'axios'

function isValidIpOrCidr(s) {
  const ipv4 = /^(\d{1,3}\.){3}\d{1,3}(\/\d{1,2})?$/
  const ipv6 = /^[0-9a-fA-F:]+(:\/\d{1,3})?$/
  return ipv4.test(s) || ipv6.test(s)
}

export default function ManualBan() {
  const { data: banned, refetch } = useApi('/f2b/manual/banned', {}, 15000)
  const [input, setInput] = useState('')
  const [banning, setBanning] = useState(false)
  const [unbanning, setUnbanning] = useState(null)
  const [message, setMessage] = useState(null)

  const valid = isValidIpOrCidr(input.trim())

  async function ban() {
    if (!valid) return
    setBanning(true)
    setMessage(null)
    try {
      await axios.post('/api/f2b/manual/ban', { ip: input.trim() })
      setMessage({ type: 'ok', text: `${input.trim()} banned.` })
      setInput('')
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
      setUnbanning(null) }
  }

  return (
    <div className="card space-y-4">
      <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-widest">Block IP / CIDR</h2>

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
        <button
          onClick={ban}
          disabled={!valid || banning}
          className="text-sm px-4 py-2 bg-rose-500/20 text-rose-300 hover:bg-rose-500/40 rounded-lg disabled:opacity-40 transition-colors whitespace-nowrap"
        >
          {banning ? 'Blocking…' : 'Block'}
        </button>
      </div>

      {banned?.length > 0 && (
        <div>
          <div className="text-xs text-gray-500 uppercase tracking-widest mb-2">Currently Blocked</div>
          <div className="space-y-1 max-h-52 overflow-y-auto">
            {banned.map(ip => (
              <div key={ip} className="flex items-center justify-between bg-gray-800/60 rounded-lg px-3 py-2">
                <span className="font-mono text-rose-300 text-sm">{ip}</span>
                <button
                  onClick={() => unban(ip)}
                  disabled={unbanning === ip}
                  className="text-xs px-2.5 py-1 bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/40 rounded-lg transition-colors disabled:opacity-50"
                >
                  {unbanning === ip ? '…' : 'Unban'}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
