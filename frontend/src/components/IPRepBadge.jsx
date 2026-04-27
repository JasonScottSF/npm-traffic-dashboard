import { useState } from 'react'
import axios from 'axios'

/**
 * IPRepBadge — lazy AbuseIPDB reputation lookup.
 *
 * Renders a "Check Rep" button. On click it fetches /api/ip_rep/<ip>
 * and replaces itself with a colour-coded abuse-confidence score.
 *
 * Props:
 *   ip  — the IP address string to look up
 */
export default function IPRepBadge({ ip }) {
  const [state, setState] = useState('idle')   // idle | loading | done | error | unconfigured
  const [data, setData]   = useState(null)
  const [err, setErr]     = useState(null)

  async function lookup() {
    if (state !== 'idle') return
    setState('loading')
    try {
      const r = await axios.get(`/api/ip_rep/${encodeURIComponent(ip)}`)
      if (r.data?.error) {
        if (r.data.error.includes('not configured')) {
          setState('unconfigured')
        } else {
          setErr(r.data.error)
          setState('error')
        }
      } else {
        setData(r.data)
        setState('done')
      }
    } catch (e) {
      setErr(e.response?.data?.detail || e.message)
      setState('error')
    }
  }

  if (state === 'idle') {
    return (
      <button
        onClick={lookup}
        className="text-xs px-2 py-0.5 rounded bg-gray-800 text-gray-400 hover:text-white border border-gray-700 transition-colors whitespace-nowrap"
        title="Look up abuse reputation on AbuseIPDB"
      >
        Rep?
      </button>
    )
  }

  if (state === 'loading') {
    return <span className="text-xs text-gray-500 italic">checking…</span>
  }

  if (state === 'unconfigured') {
    return (
      <span className="text-xs text-gray-600" title="Set ABUSEIPDB_KEY in .env to enable">
        no key
      </span>
    )
  }

  if (state === 'error') {
    return (
      <span className="text-xs text-rose-400" title={err}>
        rep err
      </span>
    )
  }

  // done
  const score   = data?.abuseConfidenceScore ?? 0
  const reports = data?.totalReports ?? 0
  const country = data?.countryCode ?? ''
  const domain  = data?.domain ?? ''

  const { bg, text, dot } =
    score > 75 ? { bg: 'bg-rose-500/20',   text: 'text-rose-300',   dot: 'bg-rose-400'   } :
    score > 25 ? { bg: 'bg-amber-500/20',  text: 'text-amber-300',  dot: 'bg-amber-400'  } :
                 { bg: 'bg-emerald-500/20', text: 'text-emerald-300', dot: 'bg-emerald-400' }

  const tooltip = [
    `Abuse confidence: ${score}%`,
    `Reports (90d): ${reports}`,
    domain  && `ISP/domain: ${domain}`,
    country && `Country: ${country}`,
  ].filter(Boolean).join('\n')

  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs border border-transparent ${bg} ${text}`}
      title={tooltip}
    >
      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${dot}`} />
      {score}% abuse
      {reports > 0 && <span className="opacity-60">({reports})</span>}
    </span>
  )
}
