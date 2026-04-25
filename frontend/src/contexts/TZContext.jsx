import { createContext, useContext, useState } from 'react'

export const TIMEZONES = [
  { value: 'America/Los_Angeles', label: 'US Pacific' },
  { value: 'America/Denver',      label: 'US Mountain' },
  { value: 'America/Chicago',     label: 'US Central' },
  { value: 'America/New_York',    label: 'US Eastern' },
  { value: 'America/Anchorage',   label: 'US Alaska' },
  { value: 'Pacific/Honolulu',    label: 'US Hawaii' },
  { value: 'UTC',                 label: 'UTC' },
  { value: 'Europe/London',       label: 'London' },
  { value: 'Europe/Paris',        label: 'Paris / Berlin' },
  { value: 'Europe/Helsinki',     label: 'Helsinki / Athens' },
  { value: 'Asia/Dubai',          label: 'Dubai' },
  { value: 'Asia/Kolkata',        label: 'India' },
  { value: 'Asia/Bangkok',        label: 'Bangkok / Jakarta' },
  { value: 'Asia/Shanghai',       label: 'China' },
  { value: 'Asia/Tokyo',          label: 'Japan / Korea' },
  { value: 'Australia/Sydney',    label: 'Sydney' },
]

const DEFAULT_TZ = 'America/Los_Angeles'
const TZContext = createContext({ tz: DEFAULT_TZ, setTz: () => {} })

export function TZProvider({ children }) {
  const [tz, setTz] = useState(
    () => localStorage.getItem('dashboard_tz') || DEFAULT_TZ
  )

  function setAndSave(newTz) {
    setTz(newTz)
    localStorage.setItem('dashboard_tz', newTz)
  }

  return <TZContext.Provider value={{ tz, setTz: setAndSave }}>{children}</TZContext.Provider>
}

export function useTZ() {
  return useContext(TZContext)
}

/** UTC offset in whole hours for the configured timezone at this moment. */
export function getTZOffset(tz) {
  const now = new Date()
  const a = new Date(now.toLocaleString('en-US', { timeZone: tz }))
  const b = new Date(now.toLocaleString('en-US', { timeZone: 'UTC' }))
  return Math.round((a - b) / 3600000)
}

/** Format an ISO timestamp string in the given timezone. */
export function formatInTZ(isoStr, tz, opts) {
  return new Intl.DateTimeFormat('en-US', { timeZone: tz, ...opts }).format(new Date(isoStr))
}
