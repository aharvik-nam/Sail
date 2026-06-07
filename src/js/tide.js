const TIDE_API = 'https://api.sehavniva.no/tideapi.php'

// Known Oslofjord tide stations with coords for nearest-station lookup
const STATIONS = [
  { id: 'OSL', name: 'Oslo', lat: 59.908, lon: 10.735 },
  { id: 'DRB', name: 'Drøbak', lat: 59.663, lon: 10.616 },
  { id: 'TGN', name: 'Tjøme', lat: 59.123, lon: 10.411 },
  { id: 'HRT', name: 'Horten', lat: 59.413, lon: 10.496 },
  { id: 'MSS', name: 'Moss', lat: 59.434, lon: 10.662 },
  { id: 'FRD', name: 'Fredrikstad', lat: 59.218, lon: 10.936 },
]

let tideCache = {}

export function nearestStation(lat, lon) {
  let best = null, bestDist = Infinity
  for (const st of STATIONS) {
    const d = Math.hypot(st.lat - lat, st.lon - lon)
    if (d < bestDist) { bestDist = d; best = st }
  }
  return best
}

export async function fetchTide(stationId) {
  if (tideCache[stationId] && Date.now() - tideCache[stationId].fetchedAt < 30 * 60 * 1000) {
    return tideCache[stationId]
  }

  try {
    const now = new Date()
    const from = formatDate(now)
    const to = formatDate(new Date(now.getTime() + 24 * 60 * 60 * 1000))

    const url = `${TIDE_API}?stationcode=${stationId}&fromtime=${from}&totime=${to}&datatype=tab&refcode=cd&place=&file=&lang=nb&interval=10&dst=1&tzone=1&tide_request=locationdata`

    const res = await fetch(url)
    if (!res.ok) throw new Error(`Tide HTTP ${res.status}`)

    const text = await res.text()
    const data = parseTideXml(text)

    tideCache[stationId] = { ...data, fetchedAt: Date.now() }
    return tideCache[stationId]
  } catch (err) {
    console.warn('Tide fetch failed:', err)
    return null
  }
}

function formatDate(d) {
  return d.toISOString().slice(0, 16).replace('T', 'T')
}

function parseTideXml(xml) {
  const parser = new DOMParser()
  const doc = parser.parseFromString(xml, 'text/xml')

  // Get current water level
  const waterlevels = [...doc.querySelectorAll('waterlevel')]
  const now = Date.now()

  // Find current level
  let currentLevel = null
  let closest = Infinity
  for (const wl of waterlevels) {
    const t = new Date(wl.getAttribute('time')).getTime()
    const diff = Math.abs(t - now)
    if (diff < closest) {
      closest = diff
      currentLevel = parseFloat(wl.getAttribute('value'))
    }
  }

  // Find high/low tide events in next 24h
  const highLows = []
  const highLowEls = doc.querySelectorAll('highlow')
  for (const hl of highLowEls) {
    highLows.push({
      time: new Date(hl.getAttribute('time')),
      value: parseFloat(hl.getAttribute('value')),
      type: hl.getAttribute('flag'), // 'high' or 'low'
    })
  }

  return { currentLevel, highLows }
}

export function formatTideTable(highLows) {
  if (!highLows || highLows.length === 0) return '<div style="padding:12px;color:#7a99c0">Ingen tidevannsdata</div>'

  const rows = highLows.slice(0, 6).map(hl => {
    const time = hl.time.toLocaleTimeString('no-NO', { hour: '2-digit', minute: '2-digit' })
    const isHigh = hl.type === 'high'
    const label = isHigh ? 'Høyvann' : 'Lavvann'
    return `<div class="tide-row ${isHigh ? 'high' : 'low'}">
      <span class="ty">${label}</span>
      <span class="tm">${time}</span>
      <span class="th">${Math.round(hl.value)} cm</span>
    </div>`
  }).join('')

  return rows
}
