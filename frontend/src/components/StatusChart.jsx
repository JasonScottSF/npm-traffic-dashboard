import { PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer } from 'recharts'

const STATUS_COLORS = {
  '2xx': '#34d399',
  '3xx': '#38bdf8',
  '4xx': '#fb923c',
  '5xx': '#f87171',
}

function classify(code) {
  if (code < 300) return '2xx'
  if (code < 400) return '3xx'
  if (code < 500) return '4xx'
  return '5xx'
}

export default function StatusChart({ data }) {
  if (!data?.length) return (
    <div className="flex items-center justify-center h-48 text-gray-600">No data</div>
  )

  const grouped = data.reduce((acc, { status, count }) => {
    const cls = classify(status)
    acc[cls] = (acc[cls] || 0) + count
    return acc
  }, {})

  const chartData = Object.entries(grouped).map(([name, value]) => ({ name, value }))

  return (
    <ResponsiveContainer width="100%" height={220}>
      <PieChart>
        <Pie
          data={chartData}
          cx="50%" cy="50%"
          innerRadius={55} outerRadius={85}
          paddingAngle={3}
          dataKey="value"
          label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
          labelLine={false}
        >
          {chartData.map((entry) => (
            <Cell key={entry.name} fill={STATUS_COLORS[entry.name]} />
          ))}
        </Pie>
        <Tooltip
          contentStyle={{ background: '#111827', border: '1px solid #374151', borderRadius: 8 }}
          formatter={(v) => [v.toLocaleString(), 'Requests']}
        />
      </PieChart>
    </ResponsiveContainer>
  )
}
