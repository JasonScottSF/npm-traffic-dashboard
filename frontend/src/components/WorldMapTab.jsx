import { useState, useEffect, useMemo } from 'react'
import axios from 'axios'
import {
  ComposableMap,
  Geographies,
  Geography,
  Marker,
} from 'react-simple-maps'

const GEO_URL = "https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json"

// world-atlas@2 countries-110m.json stores ISO 3166-1 numeric codes in geo.id
// (not iso_a2 in properties). This maps numeric → alpha-2 so we can look up traffic data.
const NUMERIC_TO_ALPHA2 = {
  4:'AF',8:'AL',12:'DZ',20:'AD',24:'AO',28:'AG',32:'AR',36:'AU',40:'AT',
  44:'BS',48:'BH',50:'BD',52:'BB',56:'BE',60:'BM',64:'BT',68:'BO',70:'BA',
  72:'BW',76:'BR',84:'BZ',90:'SB',96:'BN',100:'BG',104:'MM',108:'BI',
  112:'BY',116:'KH',120:'CM',124:'CA',132:'CV',140:'CF',144:'LK',148:'TD',
  152:'CL',156:'CN',170:'CO',174:'KM',178:'CG',180:'CD',188:'CR',191:'HR',
  192:'CU',196:'CY',203:'CZ',204:'BJ',208:'DK',214:'DO',218:'EC',222:'SV',
  226:'GQ',231:'ET',232:'ER',233:'EE',238:'FK',242:'FJ',246:'FI',250:'FR',
  262:'DJ',266:'GA',268:'GE',270:'GM',276:'DE',288:'GH',296:'KI',300:'GR',
  308:'GD',320:'GT',324:'GN',328:'GY',332:'HT',340:'HN',344:'HK',348:'HU',
  352:'IS',356:'IN',360:'ID',364:'IR',368:'IQ',372:'IE',376:'IL',380:'IT',
  384:'CI',388:'JM',392:'JP',398:'KZ',400:'JO',404:'KE',408:'KP',410:'KR',
  414:'KW',417:'KG',418:'LA',422:'LB',426:'LS',428:'LV',430:'LR',434:'LY',
  438:'LI',440:'LT',442:'LU',446:'MO',450:'MG',454:'MW',458:'MY',462:'MV',
  466:'ML',470:'MT',478:'MR',480:'MU',484:'MX',492:'MC',496:'MN',498:'MD',
  499:'ME',504:'MA',508:'MZ',512:'OM',516:'NA',524:'NP',528:'NL',548:'VU',
  554:'NZ',558:'NI',562:'NE',566:'NG',578:'NO',584:'MH',585:'PW',586:'PK',
  591:'PA',598:'PG',600:'PY',604:'PE',608:'PH',616:'PL',620:'PT',624:'GW',
  626:'TL',634:'QA',642:'RO',643:'RU',646:'RW',659:'KN',662:'LC',670:'VC',
  674:'SM',678:'ST',682:'SA',686:'SN',688:'RS',694:'SL',702:'SG',703:'SK',
  704:'VN',705:'SI',706:'SO',710:'ZA',716:'ZW',724:'ES',728:'SS',729:'SD',
  740:'SR',748:'SZ',752:'SE',756:'CH',760:'SY',762:'TJ',764:'TH',768:'TG',
  776:'TO',780:'TT',784:'AE',788:'TN',792:'TR',795:'TM',800:'UG',804:'UA',
  807:'MK',818:'EG',826:'GB',834:'TZ',840:'US',858:'UY',860:'UZ',862:'VE',
  882:'WS',887:'YE',894:'ZM',
}

const CENTROIDS = {
  AD:[1.6,42.5],AE:[54.0,23.4],AF:[67.7,33.9],AG:[-61.8,17.1],AL:[20.2,41.2],
  AM:[44.9,40.1],AO:[17.9,-11.2],AR:[-63.6,-38.4],AT:[14.5,47.5],AU:[133.8,-25.7],
  AZ:[47.6,40.1],BA:[17.7,44.2],BB:[-59.6,13.2],BD:[90.4,23.7],BE:[4.5,50.5],
  BF:[-1.6,12.4],BG:[25.5,42.7],BH:[50.6,26.0],BI:[29.9,-3.4],BJ:[2.3,9.3],
  BN:[114.7,4.5],BO:[-64.7,-17.0],BR:[-51.9,-14.2],BS:[-77.4,25.0],BT:[90.4,27.5],
  BW:[24.7,-22.3],BY:[28.0,53.7],BZ:[-88.5,17.2],CA:[-96.8,56.1],CD:[23.7,-2.9],
  CF:[20.9,6.6],CG:[15.2,-0.2],CH:[8.2,46.8],CI:[-5.5,7.5],CL:[-71.5,-35.7],
  CM:[12.4,5.7],CN:[104.2,35.8],CO:[-74.3,4.1],CR:[-84.2,9.7],CU:[-79.5,21.5],
  CV:[-24.0,16.5],CY:[33.4,35.1],CZ:[15.5,49.8],DE:[10.4,51.2],DJ:[42.6,11.8],
  DK:[9.5,56.3],DM:[-61.4,15.4],DO:[-70.2,18.7],DZ:[2.6,28.0],EC:[-78.1,-1.8],
  EE:[25.0,58.6],EG:[30.8,26.8],ER:[38.9,15.2],ES:[-3.7,40.2],ET:[40.5,9.1],
  FI:[25.7,61.9],FJ:[178.1,-17.7],FR:[2.2,46.2],GA:[11.6,-0.8],GB:[-3.4,55.4],
  GD:[-61.7,12.1],GE:[43.4,42.3],GH:[-1.0,7.9],GM:[-15.3,13.4],GN:[-11.8,10.9],
  GQ:[10.3,1.7],GR:[22.0,39.1],GT:[-90.2,15.8],GW:[-15.2,11.8],GY:[-58.9,4.9],
  HN:[-86.6,15.2],HR:[15.2,45.1],HT:[-72.3,19.0],HU:[19.5,47.2],ID:[117.9,-0.8],
  IE:[-8.1,53.4],IL:[34.9,31.0],IN:[78.7,20.6],IQ:[43.7,33.2],IR:[53.7,32.4],
  IS:[-18.6,64.9],IT:[12.6,42.8],JM:[-77.3,18.1],JO:[36.2,30.6],JP:[138.3,36.2],
  KE:[37.9,0.0],KG:[74.8,41.2],KH:[105.0,12.6],KI:[-157.4,1.3],KM:[43.9,-11.6],
  KP:[127.5,40.3],KR:[127.8,36.6],KW:[47.5,29.3],KZ:[66.9,48.0],LA:[103.0,18.2],
  LB:[35.9,33.9],LC:[-60.9,13.9],LI:[9.5,47.1],LK:[80.7,7.9],LR:[-9.4,6.4],
  LS:[28.2,-29.6],LT:[23.9,56.0],LU:[6.1,49.8],LV:[24.6,56.9],LY:[17.2,27.0],
  MA:[-7.1,31.8],MC:[7.4,43.7],MD:[28.5,47.4],ME:[19.4,42.7],MG:[46.9,-19.4],
  MH:[168.7,7.1],MK:[21.7,41.6],ML:[-2.0,17.6],MM:[95.9,17.1],MN:[103.8,46.9],
  MR:[-10.9,20.3],MT:[14.4,35.9],MU:[57.6,-20.3],MV:[73.5,3.2],MW:[34.3,-13.3],
  MX:[-102.6,23.6],MY:[109.7,2.5],MZ:[35.5,-17.3],NA:[18.5,-22.1],NE:[8.1,16.1],
  NG:[8.7,9.1],NI:[-85.0,12.8],NL:[5.3,52.1],NO:[8.5,60.5],NP:[84.2,28.4],
  NR:[166.9,-0.5],NZ:[172.0,-41.5],OM:[56.0,21.0],PA:[-80.8,8.5],PE:[-75.0,-9.2],
  PG:[143.9,-6.3],PH:[122.9,12.9],PK:[69.3,30.4],PL:[19.1,51.9],PT:[-8.2,39.4],
  PW:[134.6,7.5],PY:[-58.4,-23.2],QA:[51.2,25.4],RO:[24.9,45.9],RS:[20.8,44.0],
  RU:[105.3,61.5],RW:[29.9,-1.9],SA:[45.1,23.9],SB:[160.2,-9.6],SC:[55.5,-4.7],
  SD:[29.9,15.5],SE:[17.0,62.0],SG:[103.8,1.4],SI:[14.8,46.1],SK:[19.5,48.7],
  SL:[-11.8,8.6],SM:[12.5,43.9],SN:[-14.5,14.5],SO:[45.3,6.1],SR:[-56.0,4.0],
  SS:[30.3,7.0],ST:[6.6,0.2],SV:[-88.9,13.8],SZ:[31.5,-26.5],TD:[18.7,15.5],
  TG:[0.8,8.6],TH:[101.0,15.9],TJ:[71.3,38.9],TL:[125.7,-8.9],TM:[58.4,40.1],
  TN:[9.0,34.0],TO:[-175.2,-21.2],TR:[35.2,38.9],TT:[-61.2,10.7],TV:[177.6,-8.5],
  TZ:[34.9,-6.4],UA:[31.2,48.4],UG:[32.3,1.4],US:[-95.7,37.1],UY:[-56.0,-32.5],
  UZ:[63.9,41.4],VA:[12.5,41.9],VC:[-61.2,13.3],VE:[-66.6,7.1],VN:[107.8,14.1],
  VU:[167.0,-15.4],WS:[-172.1,-13.8],YE:[47.6,15.6],ZA:[25.1,-29.0],ZM:[27.8,-13.1],
  ZW:[30.0,-19.0],
}

const SERVER_DEST = [-98.0, 38.0]

const PERIODS = ['24h', '7d', '30d']

const FLAG = cc => cc && cc !== 'XX'
  ? String.fromCodePoint(...[...cc.toUpperCase()].map(c => 0x1F1E6 - 65 + c.charCodeAt(0)))
  : '🌐'

function fmtNum(n) {
  if (!n) return '0'
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`
  return String(n)
}

function countryFill(entry, hovered) {
  if (!entry) return hovered ? '#2d3748' : '#1e293b'
  const isHov = hovered
  if (entry.status === 'bad')   return isHov ? 'rgba(239,68,68,0.6)'   : 'rgba(239,68,68,0.4)'
  if (entry.status === 'mixed') return isHov ? 'rgba(251,191,36,0.5)'  : 'rgba(251,191,36,0.3)'
  // good — scale brightness by request volume (log scale)
  const logScale = Math.min(1, Math.log10(entry.requests + 1) / 5)
  const opacity = 0.15 + logScale * 0.45
  return isHov
    ? `rgba(34,197,94,${Math.min(opacity + 0.15, 0.75)})`
    : `rgba(34,197,94,${opacity})`
}

// Build a quadratic Bezier arc path string between two projected [x,y] points
function buildArcPath(fromProj, toProj) {
  const [x1, y1] = fromProj
  const [x2, y2] = toProj
  const mx = (x1 + x2) / 2
  const my = (y1 + y2) / 2 - Math.abs(x2 - x1) * 0.4
  return `M ${x1} ${y1} Q ${mx} ${my} ${x2} ${y2}`
}

// react-simple-maps doesn't expose the projection directly from Geographies,
// so we build arcs as SVG <path> elements laid on top of the map using
// the same geoNaturalEarth1 projection we configure on ComposableMap.
// We use the `useRef` trick to grab the SVG viewBox and then compute
// approximate screen-space coordinates via a simple lat/lon → pixel mapping
// that matches the Natural Earth projection at scale 147.
//
// For a more accurate approach we use a manually-recreated projection helper.
import { geoNaturalEarth1, geoPath } from 'd3-geo'

function makeProjection(width, height) {
  return geoNaturalEarth1()
    .scale(147)
    .translate([width / 2, height / 2])
}

export default function WorldMapTab() {
  const [mapData, setMapData]     = useState([])
  const [period, setPeriod]       = useState('24h')
  const [loading, setLoading]     = useState(true)
  const [tooltip, setTooltip]     = useState(null)   // { cc, x, y }
  const [hoveredCC, setHoveredCC] = useState(null)

  useEffect(() => {
    setLoading(true)
    axios.get(`/api/map_data?period=${period}`)
      .then(r => setMapData(r.data))
      .catch(() => setMapData([]))
      .finally(() => setLoading(false))
  }, [period])

  const dataByCC = useMemo(() => {
    const m = {}
    for (const entry of mapData) m[entry.cc] = entry
    return m
  }, [mapData])

  // Arc data — only countries with centroids, skip XX
  const arcEntries = useMemo(() =>
    mapData.filter(e => e.cc !== 'XX' && CENTROIDS[e.cc]),
    [mapData]
  )

  // Stats
  const goodCount  = mapData.filter(e => e.status === 'good').length
  const badCount   = mapData.filter(e => e.status === 'bad').length
  const totalReqs  = mapData.reduce((s, e) => s + e.requests, 0)
  const topSource  = mapData[0]

  // Map dimensions (natural earth at scale 147 — matches react-simple-maps default)
  const MAP_W = 800
  const MAP_H = 400
  const proj  = makeProjection(MAP_W, MAP_H)

  const serverXY = proj(SERVER_DEST)

  return (
    <div className="space-y-4">
      <style>{`
        @keyframes dash {
          from { stroke-dashoffset: 1000; }
          to   { stroke-dashoffset: 0; }
        }
        .arc-line {
          stroke-dasharray: 1000;
          animation: dash 2s linear infinite;
        }
        @keyframes server-pulse {
          0%, 100% { opacity: 1; r: 5px; }
          50%       { opacity: 0.4; r: 8px; }
        }
        .server-dot-outer {
          animation: server-pulse 1.8s ease-in-out infinite;
        }
      `}</style>

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-lg font-semibold text-white">🌍 World Traffic Map</h2>
          <p className="text-xs text-gray-500 mt-0.5">Animated arcs show inbound traffic — green good, red bad/blocked</p>
        </div>
        <div className="flex bg-gray-800 rounded-lg p-0.5 gap-0.5">
          {PERIODS.map(p => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors
                ${period === p ? 'bg-sky-500 text-white' : 'text-gray-400 hover:text-white'}`}
            >
              {p}
            </button>
          ))}
        </div>
      </div>

      {/* Map container */}
      <div className="relative rounded-xl overflow-hidden border border-gray-800 bg-[#0f172a]" style={{ aspectRatio: '2/1' }}>
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center z-10">
            <div className="text-gray-500 text-sm animate-pulse">Loading map data…</div>
          </div>
        )}

        {/* Tooltip */}
        {tooltip && (
          <div
            className="absolute z-20 pointer-events-none"
            style={{ left: tooltip.x + 12, top: tooltip.y - 10, maxWidth: 200 }}
          >
            <div className="bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-xs shadow-xl">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-base">{FLAG(tooltip.cc)}</span>
                <span className="font-semibold text-white">{tooltip.cc}</span>
                {tooltip.entry?.blocked && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-500/20 text-red-400 font-medium">BLOCKED</span>
                )}
              </div>
              {tooltip.entry ? (
                <>
                  <div className="text-gray-400">
                    <span className="text-gray-200 font-mono">{fmtNum(tooltip.entry.requests)}</span> requests
                  </div>
                  <div className="text-gray-500 mt-0.5">
                    Bots: <span className={tooltip.entry.requests > 0 && tooltip.entry.bots / tooltip.entry.requests > 0.5 ? 'text-amber-400' : 'text-gray-400'}>
                      {tooltip.entry.requests > 0 ? `${((tooltip.entry.bots / tooltip.entry.requests) * 100).toFixed(0)}%` : '—'}
                    </span>
                    {' · '}
                    Errors: <span className={tooltip.entry.requests > 0 && tooltip.entry.errors / tooltip.entry.requests > 0.3 ? 'text-rose-400' : 'text-gray-400'}>
                      {tooltip.entry.requests > 0 ? `${((tooltip.entry.errors / tooltip.entry.requests) * 100).toFixed(0)}%` : '—'}
                    </span>
                  </div>
                  <div className={`mt-1 text-[10px] font-medium ${tooltip.entry.status === 'bad' ? 'text-red-400' : tooltip.entry.status === 'mixed' ? 'text-amber-400' : 'text-emerald-400'}`}>
                    {tooltip.entry.status === 'bad' ? 'Bad / Blocked' : tooltip.entry.status === 'mixed' ? 'Mixed' : 'Good'}
                  </div>
                </>
              ) : (
                <div className="text-gray-600">No traffic in period</div>
              )}
            </div>
          </div>
        )}

        <div className="w-full h-full relative">
          <ComposableMap
            projection="geoNaturalEarth1"
            projectionConfig={{ scale: 147 }}
            width={MAP_W}
            height={MAP_H}
            style={{ width: '100%', height: '100%' }}
          >
            <Geographies geography={GEO_URL}>
              {({ geographies }) =>
                geographies.map(geo => {
                  // world-atlas@2 uses numeric ISO codes in geo.id; fall back to name-based props for edge cases
                  const cc    = NUMERIC_TO_ALPHA2[geo.id] || geo.properties?.iso_a2 || geo.properties?.ISO_A2
                  const entry = dataByCC[cc]
                  const isHov = hoveredCC === cc
                  return (
                    <Geography
                      key={geo.rsmKey}
                      geography={geo}
                      fill={countryFill(entry, isHov)}
                      stroke="#0f172a"
                      strokeWidth={0.4}
                      style={{ default: { outline: 'none' }, hover: { outline: 'none' }, pressed: { outline: 'none' } }}
                      onMouseEnter={e => {
                        setHoveredCC(cc)
                        const svgEl  = e.target.closest('svg')
                        const svgRect = svgEl?.getBoundingClientRect()
                        if (svgRect) {
                          const scaleX = svgRect.width  / MAP_W
                          const scaleY = svgRect.height / MAP_H
                          const centroid = cc && CENTROIDS[cc] ? proj(CENTROIDS[cc]) : null
                          setTooltip({
                            cc,
                            entry,
                            x: centroid ? centroid[0] * scaleX : e.clientX - svgRect.left,
                            y: centroid ? centroid[1] * scaleY : e.clientY - svgRect.top,
                          })
                        }
                      }}
                      onMouseLeave={() => { setHoveredCC(null); setTooltip(null) }}
                    />
                  )
                })
              }
            </Geographies>

            {/* Arc lines — rendered as SVG paths via Marker at origin (0,0) */}
            {arcEntries.map((entry, i) => {
              const fromXY = proj(CENTROIDS[entry.cc])
              if (!fromXY || !serverXY) return null
              const d = buildArcPath(fromXY, serverXY)
              const color  = entry.status === 'bad' ? '#ef4444' : '#22c55e'
              const width  = entry.status === 'bad' ? 1.0 : 0.8
              const opacity = entry.status === 'bad' ? 0.7 : 0.6
              return (
                <path
                  key={entry.cc}
                  d={d}
                  fill="none"
                  stroke={color}
                  strokeWidth={width}
                  strokeOpacity={opacity}
                  strokeLinecap="round"
                  className="arc-line"
                  style={{ animationDelay: `${i * 0.1}s` }}
                />
              )
            })}

            {/* Country source dots */}
            {arcEntries.map(entry => {
              const xy = proj(CENTROIDS[entry.cc])
              if (!xy) return null
              const r = Math.max(1.5, Math.min(5, Math.log10(entry.requests + 1) * 0.9))
              const color = entry.status === 'bad' ? '#ef4444' : entry.status === 'mixed' ? '#fbbf24' : '#22c55e'
              return (
                <Marker key={`dot-${entry.cc}`} coordinates={CENTROIDS[entry.cc]}>
                  <circle r={r} fill={color} fillOpacity={0.85} stroke="#0f172a" strokeWidth={0.4} />
                </Marker>
              )
            })}

            {/* Server destination dot */}
            {serverXY && (
              <Marker coordinates={SERVER_DEST}>
                <circle r={8} fill="white" fillOpacity={0.08} className="server-dot-outer" />
                <circle r={4} fill="white" fillOpacity={0.9} stroke="#0f172a" strokeWidth={0.8} />
              </Marker>
            )}
          </ComposableMap>
        </div>

        {/* Legend — bottom left */}
        <div className="absolute bottom-3 left-3 flex flex-col gap-1 bg-gray-950/80 backdrop-blur rounded-lg px-3 py-2 border border-gray-800">
          <span className="text-[10px] text-gray-500 uppercase tracking-wider mb-0.5">Legend</span>
          {[
            { color: 'rgba(34,197,94,0.5)',  label: 'Good traffic' },
            { color: 'rgba(251,191,36,0.4)', label: 'Mixed' },
            { color: 'rgba(239,68,68,0.5)',  label: 'Blocked / Bad' },
            { color: '#1e293b',              label: 'No traffic', border: '#334155' },
          ].map(({ color, label, border }) => (
            <div key={label} className="flex items-center gap-2">
              <span
                className="w-3 h-3 rounded-sm shrink-0"
                style={{ background: color, border: border ? `1px solid ${border}` : undefined }}
              />
              <span className="text-[10px] text-gray-400">{label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Countries Seen', value: mapData.filter(e => e.cc !== 'XX').length, color: 'text-sky-400' },
          { label: 'Good Sources',   value: goodCount,  color: 'text-emerald-400' },
          { label: 'Bad / Blocked',  value: badCount,   color: 'text-red-400' },
          {
            label: 'Top Source',
            value: topSource ? `${FLAG(topSource.cc)} ${topSource.cc}` : '—',
            sub: topSource ? `${fmtNum(topSource.requests)} req` : null,
            color: 'text-white',
          },
        ].map(({ label, value, sub, color }) => (
          <div key={label} className="card text-center py-4">
            <div className={`text-2xl font-bold tabular-nums ${color}`}>{value ?? '—'}</div>
            {sub && <div className="text-xs text-gray-500 mt-0.5">{sub}</div>}
            <div className="text-xs text-gray-500 mt-1">{label}</div>
          </div>
        ))}
      </div>
    </div>
  )
}
