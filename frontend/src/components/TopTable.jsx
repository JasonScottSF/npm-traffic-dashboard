function Bar({ value, max, color }) {
  const pct = max > 0 ? (value / max) * 100 : 0
  return (
    <div className="w-full bg-gray-800 rounded-full h-1 mt-1">
      <div className={`h-1 rounded-full ${color}`} style={{ width: `${pct}%` }} />
    </div>
  )
}

export default function TopTable({ rows: rawRows, labelKey, valueKey, valueLabel, color = 'bg-sky-500', maxRows = 10 }) {
  const rows = rawRows ?? []
  const max = rows[0]?.[valueKey] ?? 1
  const visible = rows.slice(0, maxRows)

  if (!visible.length) return (
    <div className="text-gray-600 text-sm py-4 text-center">No data</div>
  )

  return (
    <div className="space-y-2">
      {visible.map((row, i) => (
        <div key={i}>
          <div className="flex justify-between items-baseline gap-2">
            <span className="text-sm text-gray-300 truncate min-w-0 flex-1" title={row[labelKey]}>
              <span className="text-gray-600 text-xs mr-1">{i + 1}.</span>
              {row[labelKey]}
            </span>
            <span className="text-sm font-mono text-white shrink-0">
              {typeof row[valueKey] === 'number' ? row[valueKey].toLocaleString() : row[valueKey]}
            </span>
          </div>
          <Bar value={row[valueKey]} max={max} color={color} />
        </div>
      ))}
    </div>
  )
}
