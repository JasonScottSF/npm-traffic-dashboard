import { useTZ, getTZOffset } from '../contexts/TZContext'

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const HOURS = Array.from({ length: 24 }, (_, i) => i)

export default function HeatMap({ data }) {
  const { tz } = useTZ()

  if (!data?.length) return (
    <div className="flex items-center justify-center h-32 text-gray-600">No data</div>
  )

  const offset = getTZOffset(tz)

  // Remap UTC (day, hour) data into the configured timezone
  const map = {}
  let max = 0
  for (const { day, hour, requests } of data) {
    let localHour = hour + offset
    let localDay = day
    if (localHour >= 24) {
      localHour -= 24
      localDay = (day + 1) % 7
    } else if (localHour < 0) {
      localHour += 24
      localDay = (day + 6) % 7
    }
    const key = `${localDay}-${localHour}`
    const prev = map[key] || 0
    map[key] = prev + requests
    if (map[key] > max) max = map[key]
  }

  const cell = (day, hour) => {
    const val = map[`${day}-${hour}`] || 0
    const intensity = max > 0 ? val / max : 0
    const opacity = intensity === 0 ? 0.05 : 0.15 + intensity * 0.85
    return (
      <div
        key={`${day}-${hour}`}
        className="rounded-sm"
        style={{ backgroundColor: `rgba(56,189,248,${opacity})`, aspectRatio: '1' }}
        title={`${DAYS[day]} ${hour}:00 — ${val.toLocaleString()} req`}
      />
    )
  }

  return (
    <div className="overflow-x-auto">
      <div className="min-w-max">
        <div className="flex gap-1 mb-1 ml-8">
          {HOURS.map(h => (
            <div key={h} className="text-center text-gray-600 text-[9px]" style={{ width: 16 }}>
              {h % 3 === 0 ? h : ''}
            </div>
          ))}
        </div>
        {DAYS.map((day, d) => (
          <div key={day} className="flex items-center gap-1 mb-1">
            <div className="text-gray-500 text-[10px] w-7 text-right pr-1">{day}</div>
            {HOURS.map(h => cell(d, h))}
          </div>
        ))}
        <div className="flex items-center gap-2 mt-2 ml-8">
          <span className="text-gray-600 text-[10px]">Low</span>
          <div className="flex gap-0.5">
            {[0.05, 0.25, 0.45, 0.65, 0.85, 1].map(o => (
              <div key={o} className="w-3 h-3 rounded-sm" style={{ backgroundColor: `rgba(56,189,248,${o})` }} />
            ))}
          </div>
          <span className="text-gray-600 text-[10px]">High</span>
        </div>
      </div>
    </div>
  )
}
