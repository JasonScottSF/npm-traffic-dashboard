import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend } from 'recharts'

const PALETTE = ['#38bdf8','#a78bfa','#34d399','#fb923c','#f87171','#e879f9','#facc15','#818cf8']

export default function BrowserDonut({ data, groupKey = 'browser', title }) {
  if (!data?.length) return (
    <div className="flex items-center justify-center h-40 text-gray-600">No data</div>
  )

  const grouped = data.reduce((acc, row) => {
    const key = row[groupKey] || 'Unknown'
    acc[key] = (acc[key] || 0) + row.requests
    return acc
  }, {})

  const sorted = Object.entries(grouped)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)

  const total = sorted.reduce((s, [, v]) => s + v, 0)
  const chartData = sorted.map(([name, value]) => ({ name, value }))

  return (
    <div>
      {title && <div className="text-xs text-gray-500 uppercase tracking-widest mb-2">{title}</div>}
      <ResponsiveContainer width="100%" height={180}>
        <PieChart>
          <Pie data={chartData} cx="50%" cy="50%" innerRadius={45} outerRadius={70} paddingAngle={2} dataKey="value">
            {chartData.map((_, i) => (
              <Cell key={i} fill={PALETTE[i % PALETTE.length]} />
            ))}
          </Pie>
          <Tooltip
            contentStyle={{ background: '#111827', border: '1px solid #374151', borderRadius: 8 }}
            formatter={(v, name) => [`${v.toLocaleString()} (${((v / total) * 100).toFixed(1)}%)`, name]}
          />
          <Legend wrapperStyle={{ fontSize: 11 }} />
        </PieChart>
      </ResponsiveContainer>
    </div>
  )
}
