import { useState } from 'react'
import { useApi } from '../hooks/useApi'
import axios from 'axios'

const regionNames = new Intl.DisplayNames(['en'], { type: 'region' })

const FLAG = cc => {
  if (!cc || cc.length !== 2) return ''
  return String.fromCodePoint(...[...cc.toUpperCase()].map(c => 0x1F1E6 + c.charCodeAt(0) - 65))
}

const countryName = cc => {
  try { return regionNames.of(cc.toUpperCase()) } catch { return cc }
}

export default function GeoBlock({ trafficCountries = [], onBlock }) {
  const { data: blocked, refetch } = useApi('/f2b/geo/blocked', {}, 15000)
  const [input, setInput] = useState('')
  const [blocking, setBlocking] = useState(null)
  const [message, setMessage] = useState(null)

  const blockedCodes = new Set((blocked ?? []).map(b => b.country_code))

  async function block(cc) {
    setBlocking(cc)
    setMessage(null)
    try {
      const { data } = await axios.post('/api/f2b/geo/block', { country_code: cc })
      setMessage({ type: 'ok', text: `${cc} blocked — ${data.cidrs} CIDRs added.` })
      setInput('')
      refetch()
      onBlock?.()
    } catch (e) {
      setMessage({ type: 'err', text: e.response?.data?.detail || e.message })
    } finally {
      setBlocking(null)
    }
  }

  const unblocked = trafficCountries.filter(c => c.country_code !== 'XX' && !blockedCodes.has(c.country_code))

  return (
    <div className="card space-y-4">
      <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-widest">Block Countries</h2>

      {message && (
        <div className={`text-sm rounded-lg px-3 py-2 ${message.type === 'ok' ? 'bg-emerald-500/20 text-emerald-300' : 'bg-rose-500/20 text-rose-300'}`}>
          {message.text}
        </div>
      )}

      {/* Manual entry */}
      <div className="flex gap-2">
        <input
          value={input}
          onChange={e => setInput(e.target.value.toUpperCase().slice(0, 2))}
          placeholder="CC"
          maxLength={2}
          className="w-20 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm font-mono text-gray-100 uppercase focus:outline-none focus:border-rose-500"
        />
        <button
          onClick={() => input.length === 2 && block(input)}
          disabled={input.length !== 2 || !!blocking}
          className="text-sm px-4 py-2 bg-rose-500/20 text-rose-300 hover:bg-rose-500/40 rounded-lg disabled:opacity-40 transition-colors"
        >
          {blocking === input ? 'Blocking…' : 'Block Country'}
        </button>
        <span className="text-xs text-gray-600 self-center">Enter a 2-letter ISO country code</span>
      </div>

      {/* Countries seen in traffic */}
      {unblocked.length > 0 && (
        <div>
          <div className="text-xs text-gray-500 uppercase tracking-widest mb-2">Countries in Traffic (click to block)</div>
          <div className="flex flex-wrap gap-2">
            {unblocked.map(c => (
              <button
                key={c.country_code}
                onClick={() => block(c.country_code)}
                disabled={blocking === c.country_code}
                className="flex items-center gap-1.5 bg-gray-800 hover:bg-rose-500/20 border border-gray-700 hover:border-rose-500/40 rounded-lg px-2.5 py-1.5 transition-colors disabled:opacity-40"
              >
                <span className="text-base">{FLAG(c.country_code)}</span>
                <span className="text-gray-300 text-xs">{countryName(c.country_code)}</span>
                <span className="text-gray-600 text-xs">{c.requests?.toLocaleString()}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
