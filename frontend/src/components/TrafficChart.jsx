import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer
} from 'recharts'
import { format, parseISO } from 'date-fns'

const COLORS = {
  requests:        '#38bdf8',
  unique_visitors: '#a78bfa',
  errors:          '#f87171',
  bots:            '#fb923c',
  bytes:           '#34d399',
}

function fmt(val, key) {
  if (key === 'bytes') {
    if (val > 1e9) return `${(val / 1e9).toFixed(1)} GB`
    if (val > 1e6) return `${(val / 1e6).toFixed(1)} MB`
    if (val > 1e3) return `${(val / 1e3).toFixed(1)} KB`
    return `${val} B`
  }
  return val?.toLocaleString()
}

export default function TrafficChart({ data, period }) {
  if (!data?.length) return (
    <div className="flex items-center justify-center h-48 text-gray-600">No data for period</div>
  )

  const tickFmt = period === '24h' || period === '3d'
    ? (t) => format(parseISO(t), 'HH:mm')
    : (t) => format(parseISO(t), 'MMM d')

  return (
    <ResponsiveContainer width="100%" height={260}>
      <AreaChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
        <defs>
          {Object.entries(COLORS).map(([key, color]) => (
            <linearGradient key={key} id={`grad_${key}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={color} stopOpacity={0.25} />
              <stop offset="95%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          ))}
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
        <XAxis dataKey="time" tickFormatter={tickFmt} tick={{ fill: '#6b7280', fontSize: 11 }} stroke="#374151" />
        <YAxis tick={{ fill: '#6b7280', fontSize: 11 }} stroke="#374151" />
        <Tooltip
          contentStyle={{ background: '#111827', border: '1px solid #374151', borderRadius: 8 }}
          labelStyle={{ color: '#9ca3af' }}
          formatter={(val, name) => [fmt(val, name), name.replace(/_/g, ' ')]}
          labelFormatter={(t) => format(parseISO(t), 'MMM d HH:mm')}
        />
        <Legend wrapperStyle={{ fontSize: 12, paddingTop: 8 }} />
        <Area type="monotone" dataKey="requests"        stroke={COLORS.requests}        fill={`url(#grad_requests)`}        strokeWidth={2} dot={false} />
        <Area type="monotone" dataKey="unique_visitors" stroke={COLORS.unique_visitors} fill={`url(#grad_unique_visitors)`} strokeWidth={2} dot={false} />
        <Area type="monotone" dataKey="errors"          stroke={COLORS.errors}          fill={`url(#grad_errors)`}          strokeWidth={1.5} dot={false} />
        <Area type="monotone" dataKey="bots"            stroke={COLORS.bots}            fill={`url(#grad_bots)`}            strokeWidth={1.5} dot={false} />
      </AreaChart>
    </ResponsiveContainer>
  )
}
