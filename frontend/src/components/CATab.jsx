import { useState, useEffect, useCallback } from 'react'
import axios from 'axios'

// ── Helpers ────────────────────────────────────────────────────────────────

function fmtDate(iso) {
  if (!iso) return '—'
  try {
    return new Intl.DateTimeFormat('en-US', {
      year: 'numeric', month: 'short', day: '2-digit',
    }).format(new Date(iso))
  } catch { return iso }
}

function DaysLeftBadge({ days }) {
  if (days == null) return <span className="text-gray-600">—</span>
  const cls =
    days <= 7  ? 'bg-rose-500/20 text-rose-300' :
    days <= 30 ? 'bg-amber-500/20 text-amber-300' :
                 'bg-emerald-500/20 text-emerald-300'
  return (
    <span className={`inline-flex px-1.5 py-0.5 rounded text-[10px] font-mono font-bold ${cls}`}>
      {days}d
    </span>
  )
}

function NpmStatus({ cert }) {
  if (cert.revoked) return <span className="text-gray-600 text-xs">revoked</span>
  if (cert.push_error) return (
    <span className="text-rose-400 text-xs" title={cert.push_error}>
      error
    </span>
  )
  if (cert.npm_pushed_at) return (
    <span className="text-emerald-400 text-xs" title={`Pushed ${fmtDate(cert.npm_pushed_at)}`}>
      pushed
    </span>
  )
  return <span className="text-gray-500 text-xs">not pushed</span>
}

// ── Trust instructions panel ───────────────────────────────────────────────

function TrustInstructions() {
  const [open, setOpen] = useState(false)

  return (
    <div className="border border-gray-800 rounded-xl overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-4 py-2.5 bg-gray-900/40 hover:bg-gray-800/40 transition-colors text-left"
      >
        <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
          Trust instructions
        </span>
        <svg
          className={`w-4 h-4 text-gray-500 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div className="px-4 py-3 space-y-3 text-xs text-gray-400 bg-gray-900/20">

          <div>
            <div className="font-semibold text-gray-300 mb-1">macOS</div>
            <ol className="list-decimal list-inside space-y-0.5 text-gray-500">
              <li>Download <code className="bg-gray-800 px-1 rounded">ca.crt</code> above</li>
              <li>Double-click to open in Keychain Access</li>
              <li>Find the cert under <em>System</em> keychain, double-click it</li>
              <li>Expand "Trust" → set "When using this certificate" to <strong>Always Trust</strong></li>
              <li>Close and enter your password to confirm</li>
            </ol>
          </div>

          <div>
            <div className="font-semibold text-gray-300 mb-1">Windows</div>
            <ol className="list-decimal list-inside space-y-0.5 text-gray-500">
              <li>Download <code className="bg-gray-800 px-1 rounded">ca.crt</code></li>
              <li>Right-click → <em>Install Certificate</em></li>
              <li>Choose <strong>Local Machine</strong> → Next</li>
              <li>Select <strong>Place all certificates in the following store</strong></li>
              <li>Browse → <strong>Trusted Root Certification Authorities</strong> → OK → Finish</li>
            </ol>
          </div>

          <div>
            <div className="font-semibold text-gray-300 mb-1">iOS / iPadOS</div>
            <ol className="list-decimal list-inside space-y-0.5 text-gray-500">
              <li>AirDrop or email yourself <code className="bg-gray-800 px-1 rounded">ca.crt</code></li>
              <li>Settings → General → VPN &amp; Device Management → tap the profile → Install</li>
              <li>Settings → General → About → Certificate Trust Settings → enable your CA</li>
            </ol>
          </div>

          <div>
            <div className="font-semibold text-gray-300 mb-1">Android</div>
            <ol className="list-decimal list-inside space-y-0.5 text-gray-500">
              <li>Download <code className="bg-gray-800 px-1 rounded">ca.crt</code> to the device</li>
              <li>Settings → Security → Encryption &amp; credentials → Install a certificate → CA certificate</li>
              <li>Select the downloaded file and confirm</li>
            </ol>
          </div>

          <div>
            <div className="font-semibold text-gray-300 mb-1">Linux (system-wide)</div>
            <pre className="bg-gray-900 rounded-lg px-3 py-2 text-gray-400 font-mono text-[11px] overflow-x-auto whitespace-pre">
{`sudo cp ca.crt /usr/local/share/ca-certificates/internal-ca.crt
sudo update-ca-certificates`}
            </pre>
          </div>

        </div>
      )}
    </div>
  )
}

// ── Root CA section ────────────────────────────────────────────────────────

function RootCAPanel() {
  const [info,         setInfo]         = useState(null)
  const [downloading,  setDownloading]  = useState(false)
  const [err,          setErr]          = useState('')

  useEffect(() => {
    axios.get('/api/ca/root-cert/info')
      .then(r => setInfo(r.data))
      .catch(e => setErr(e.response?.data?.detail || e.message))
  }, [])

  function download() {
    setDownloading(true)
    axios.get('/api/ca/root-cert', { responseType: 'blob' })
      .then(r => {
        const url = URL.createObjectURL(r.data)
        const a = document.createElement('a')
        a.href = url
        a.download = 'ca.crt'
        a.click()
        URL.revokeObjectURL(url)
      })
      .catch(e => setErr(e.response?.data?.detail || e.message))
      .finally(() => setDownloading(false))
  }

  return (
    <div className="bg-gray-900/60 border border-gray-800 rounded-xl p-4 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="font-semibold text-white text-sm">Root Certificate Authority</div>
        <button
          onClick={download}
          disabled={downloading || !info}
          className="text-xs px-3 py-1.5 bg-sky-500/20 text-sky-300 hover:bg-sky-500/40 rounded-lg transition-colors disabled:opacity-50 shrink-0"
        >
          {downloading ? 'Downloading…' : 'Download Root Certificate'}
        </button>
      </div>

      {err && <div className="text-xs text-rose-400 bg-rose-500/10 rounded-lg px-3 py-2">{err}</div>}

      {info && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          {[
            ['Common Name', info.common_name],
            ['Valid Until', fmtDate(info.not_after)],
            ['SHA-256 Fingerprint', info.fingerprint_sha256],
          ].map(([label, val]) => (
            <div key={label} className="bg-gray-800/60 rounded-lg px-3 py-2">
              <div className="text-[10px] text-gray-600 uppercase tracking-wider mb-0.5">{label}</div>
              <div className="font-mono text-gray-300 text-xs break-all">{val}</div>
            </div>
          ))}
        </div>
      )}

      {!info && !err && (
        <div className="text-xs text-gray-600 animate-pulse">Loading CA info…</div>
      )}

      <TrustInstructions />
    </div>
  )
}

// ── Issue cert form ────────────────────────────────────────────────────────

function IssueCertForm({ onIssued }) {
  const [domain,      setDomain]      = useState('')
  const [sans,        setSans]        = useState('')
  const [certType,    setCertType]    = useState('proxy')
  const [pushToNpm,   setPushToNpm]   = useState(false)
  const [submitting,  setSubmitting]  = useState(false)
  const [err,         setErr]         = useState('')
  const [npmErr,      setNpmErr]      = useState('')

  async function submit(e) {
    e.preventDefault()
    setSubmitting(true)
    setErr('')
    setNpmErr('')
    const sanList = sans.split(',').map(s => s.trim()).filter(Boolean)
    try {
      const { data } = await axios.post('/api/ca/certs', {
        domain: domain.trim(),
        sans: sanList,
        cert_type: certType,
        push_to_npm: pushToNpm,
      })
      if (data.npm_error) {
        setNpmErr(data.npm_error)
      }
      setDomain('')
      setSans('')
      setCertType('proxy')
      setPushToNpm(false)
      onIssued()
    } catch (e) {
      setErr(e.response?.data?.detail || e.message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={submit} className="bg-gray-900/60 border border-gray-800 rounded-xl p-4 space-y-3">
      <div className="font-semibold text-white text-sm">Issue New Certificate</div>

      <div>
        <label className="block text-xs text-gray-500 mb-1">Domain (CN)</label>
        <input
          type="text"
          placeholder="e.g. homelab.local or 192.168.1.10"
          required
          value={domain}
          onChange={e => setDomain(e.target.value)}
          className="w-full input-sm"
        />
      </div>

      <div>
        <label className="block text-xs text-gray-500 mb-1">
          SANs — Subject Alternative Names (comma-separated, optional)
        </label>
        <textarea
          rows={2}
          placeholder="e.g. www.homelab.local, 192.168.1.10, npm_auth"
          value={sans}
          onChange={e => setSans(e.target.value)}
          className="w-full input-sm resize-none font-mono"
        />
      </div>

      <div>
        <div className="text-xs text-gray-500 mb-1.5">Certificate type</div>
        <div className="flex gap-2">
          {[['proxy', 'Proxy Host'], ['container', 'Container']].map(([val, label]) => (
            <button
              key={val}
              type="button"
              onClick={() => setCertType(val)}
              className={`flex-1 text-xs px-3 py-2 rounded-lg border transition-colors ${
                certType === val
                  ? 'bg-violet-500/20 border-violet-500/40 text-violet-300'
                  : 'bg-gray-800 border-gray-700 text-gray-400 hover:text-white'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <label className="flex items-center gap-2 text-sm text-gray-400 cursor-pointer">
        <input
          type="checkbox"
          checked={pushToNpm}
          onChange={e => setPushToNpm(e.target.checked)}
          className="accent-sky-500"
        />
        Push to NPM automatically after issuance
      </label>

      {err && (
        <div className="text-xs text-rose-400 bg-rose-500/10 rounded-lg px-3 py-2">{err}</div>
      )}
      {npmErr && (
        <div className="text-xs text-amber-400 bg-amber-500/10 rounded-lg px-3 py-2">
          Cert issued but NPM push failed: {npmErr}
        </div>
      )}

      <button
        type="submit"
        disabled={submitting}
        className="w-full text-xs py-2 bg-violet-500/20 text-violet-300 hover:bg-violet-500/40 rounded-lg transition-colors disabled:opacity-50"
      >
        {submitting ? 'Issuing…' : 'Issue Certificate'}
      </button>
    </form>
  )
}

// ── Cert table ─────────────────────────────────────────────────────────────

function CertTable({ certs, onRefresh }) {
  const [busy,    setBusy]    = useState({})
  const [confirm, setConfirm] = useState(null)  // domain string

  async function renew(domain) {
    setBusy(b => ({ ...b, [domain]: 'renewing' }))
    try {
      await axios.post(`/api/ca/certs/${encodeURIComponent(domain)}/renew`)
      onRefresh()
    } catch (e) {
      alert(e.response?.data?.detail || e.message)
    } finally {
      setBusy(b => { const n = { ...b }; delete n[domain]; return n })
    }
  }

  async function pushNpm(domain) {
    setBusy(b => ({ ...b, [domain]: 'pushing' }))
    try {
      await axios.post(`/api/ca/certs/${encodeURIComponent(domain)}/push-npm`)
      onRefresh()
    } catch (e) {
      alert(e.response?.data?.detail || e.message)
    } finally {
      setBusy(b => { const n = { ...b }; delete n[domain]; return n })
    }
  }

  async function revoke(domain) {
    setBusy(b => ({ ...b, [domain]: 'revoking' }))
    setConfirm(null)
    try {
      await axios.delete(`/api/ca/certs/${encodeURIComponent(domain)}`)
      onRefresh()
    } catch (e) {
      alert(e.response?.data?.detail || e.message)
    } finally {
      setBusy(b => { const n = { ...b }; delete n[domain]; return n })
    }
  }

  async function downloadCert(domain) {
    try {
      const resp = await axios.get(
        `/api/ca/certs/${encodeURIComponent(domain)}/download`,
        { responseType: 'blob' }
      )
      const url = URL.createObjectURL(resp.data)
      const a = document.createElement('a')
      a.href = url
      a.download = `${domain.replace(/[*/]/g, '_')}-cert.zip`
      a.click()
      URL.revokeObjectURL(url)
    } catch (e) {
      alert(e.response?.data?.detail || e.message)
    }
  }

  if (!certs.length) {
    return (
      <div className="text-gray-600 text-sm text-center py-8">
        No certificates issued yet. Use the form above to issue your first cert.
      </div>
    )
  }

  return (
    <div className="rounded-xl border border-gray-800 overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-gray-900/80 text-gray-500 uppercase tracking-wider text-left border-b border-gray-800">
              <th className="px-3 py-2.5 font-medium">Domain</th>
              <th className="px-3 py-2.5 font-medium hidden sm:table-cell">Type</th>
              <th className="px-3 py-2.5 font-medium hidden md:table-cell">SANs</th>
              <th className="px-3 py-2.5 font-medium">Expires</th>
              <th className="px-3 py-2.5 font-medium">Left</th>
              <th className="px-3 py-2.5 font-medium">NPM</th>
              <th className="px-3 py-2.5 font-medium text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-800/50">
            {certs.map(cert => {
              const b = busy[cert.domain]
              return (
                <tr
                  key={cert.domain}
                  className={`hover:bg-gray-800/30 transition-colors ${cert.revoked ? 'opacity-40' : ''}`}
                >
                  <td className="px-3 py-2 font-mono text-sky-400 max-w-[160px] truncate" title={cert.domain}>
                    {cert.domain}
                  </td>
                  <td className="px-3 py-2 hidden sm:table-cell">
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium uppercase ${
                      cert.cert_type === 'container'
                        ? 'bg-violet-500/20 text-violet-300'
                        : 'bg-sky-500/20 text-sky-300'
                    }`}>
                      {cert.cert_type}
                    </span>
                  </td>
                  <td className="px-3 py-2 hidden md:table-cell text-gray-500 max-w-[180px] truncate" title={(cert.sans || []).join(', ')}>
                    {(cert.sans || []).filter(s => s !== cert.domain).join(', ') || '—'}
                  </td>
                  <td className="px-3 py-2 text-gray-400 whitespace-nowrap">{fmtDate(cert.not_after)}</td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    {cert.revoked
                      ? <span className="text-gray-600 text-[10px]">revoked</span>
                      : <DaysLeftBadge days={cert.days_left} />
                    }
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap"><NpmStatus cert={cert} /></td>
                  <td className="px-3 py-2">
                    <div className="flex items-center justify-end gap-1 flex-wrap">
                      {!cert.revoked && (
                        <>
                          <button
                            onClick={() => renew(cert.domain)}
                            disabled={!!b}
                            className="text-[10px] px-2 py-1 bg-sky-500/10 text-sky-400 hover:bg-sky-500/25 rounded-lg transition-colors disabled:opacity-50 whitespace-nowrap"
                          >
                            {b === 'renewing' ? '…' : 'Renew'}
                          </button>
                          <button
                            onClick={() => pushNpm(cert.domain)}
                            disabled={!!b}
                            title={cert.push_error || 'Push to NPM'}
                            className="text-[10px] px-2 py-1 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/25 rounded-lg transition-colors disabled:opacity-50 whitespace-nowrap"
                          >
                            {b === 'pushing' ? '…' : 'Push NPM'}
                          </button>
                          <button
                            onClick={() => downloadCert(cert.domain)}
                            disabled={!!b}
                            title="Download key + chain as zip"
                            className="text-[10px] px-2 py-1 bg-gray-800 text-gray-400 hover:text-white hover:bg-gray-700 rounded-lg transition-colors disabled:opacity-50 whitespace-nowrap"
                          >
                            Download
                          </button>
                        </>
                      )}
                      {!cert.revoked && (
                        confirm === cert.domain ? (
                          <span className="flex items-center gap-1">
                            <button
                              onClick={() => revoke(cert.domain)}
                              disabled={!!b}
                              className="text-[10px] px-2 py-1 bg-rose-500/20 text-rose-300 hover:bg-rose-500/40 rounded-lg border border-rose-500/30 transition-colors disabled:opacity-50 whitespace-nowrap font-bold"
                            >
                              {b === 'revoking' ? '…' : 'Confirm'}
                            </button>
                            <button
                              onClick={() => setConfirm(null)}
                              className="text-[10px] px-1.5 py-1 text-gray-500 hover:text-gray-300 transition-colors"
                            >
                              ✕
                            </button>
                          </span>
                        ) : (
                          <button
                            onClick={() => setConfirm(cert.domain)}
                            disabled={!!b}
                            className="text-[10px] px-2 py-1 bg-rose-500/10 text-rose-400 hover:bg-rose-500/25 rounded-lg transition-colors disabled:opacity-50 whitespace-nowrap"
                          >
                            Revoke
                          </button>
                        )
                      )}
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── Main CATab ─────────────────────────────────────────────────────────────

export default function CATab() {
  const [certs, setCerts] = useState([])
  const [tab,   setTab]   = useState('certs')

  const loadCerts = useCallback(() => {
    axios.get('/api/ca/certs').then(r => setCerts(r.data)).catch(() => {})
  }, [])

  useEffect(() => { loadCerts() }, [loadCerts])

  const activeCerts  = certs.filter(c => !c.revoked)
  const expiringSoon = activeCerts.filter(c => c.days_left != null && c.days_left <= 30).length

  return (
    <div className="space-y-4">
      {/* Tab bar */}
      <div className="flex bg-gray-800 rounded-lg p-0.5 gap-0.5">
        {[
          ['certs',  'Issued Certs'],
          ['issue',  'Issue New'],
          ['rootca', 'Root CA'],
        ].map(([t, label]) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex-1 px-3 py-1.5 rounded-md text-xs font-medium transition-colors relative
              ${tab === t ? 'bg-gray-700 text-white' : 'text-gray-500 hover:text-gray-300'}`}
          >
            {label}
            {t === 'certs' && expiringSoon > 0 && (
              <span className="absolute -top-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-amber-500 text-white text-[9px] font-bold leading-none">
                {expiringSoon > 9 ? '9+' : expiringSoon}
              </span>
            )}
          </button>
        ))}
      </div>

      {tab === 'rootca' && <RootCAPanel />}

      {tab === 'issue' && (
        <IssueCertForm onIssued={() => { loadCerts(); setTab('certs') }} />
      )}

      {tab === 'certs' && (
        <div className="space-y-3">
          {certs.length > 0 && (
            <div className="flex items-center gap-3 text-xs text-gray-500">
              <span>{activeCerts.length} active</span>
              {expiringSoon > 0 && (
                <span className="text-amber-400">{expiringSoon} expiring within 30 days</span>
              )}
              <span className="flex-1" />
              <button
                onClick={loadCerts}
                className="text-gray-600 hover:text-gray-300 transition-colors"
                title="Refresh"
              >
                Refresh
              </button>
            </div>
          )}
          <CertTable certs={certs} onRefresh={loadCerts} />
        </div>
      )}
    </div>
  )
}
