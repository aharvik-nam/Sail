// MET MetAlerts 2.0 — aktive farevarsler for posisjon
const METALERTS_URL = 'https://api.met.no/weatherapi/metalerts/2.0/current.json'
const USER_AGENT    = 'SeilNav/1.0 kontakt@example.com'

// Alvorlighetsnivå → norsk tekst + farge
const SEVERITY = {
  Extreme:  { label: 'EKSTREMT',  color: '#cc0000' },
  Severe:   { label: 'ALVORLIG',  color: '#ff4400' },
  Moderate: { label: 'MODERAT',   color: '#ff9900' },
  Minor:    { label: 'LAV',       color: '#ffcc00' },
}

// Farvann-typer vi bryr oss om (sjø-relaterte)
const MARINE_EVENTS = [
  'wind', 'gale', 'storm', 'hurricane', 'coastalevent',
  'fog', 'snow', 'ice', 'avalanche', 'flooding',
]

let alertCache    = null
let alertCacheTime = 0
let alertTimer    = null

export async function fetchAlerts(lat, lon) {
  if (alertCache && Date.now() - alertCacheTime < 15 * 60 * 1000) return alertCache

  try {
    const url = `${METALERTS_URL}?lat=${lat.toFixed(4)}&lon=${lon.toFixed(4)}`
    const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } })
    if (!res.ok) throw new Error(`MetAlerts HTTP ${res.status}`)

    const json     = await res.json()
    const features = json.features || []

    alertCache = features
      .map(f => {
        const p    = f.properties || {}
        const sev  = SEVERITY[p.severity] || SEVERITY.Minor
        return {
          title:       p.title || p.eventAwarenessName || 'Farevarsel',
          severity:    p.severity,
          label:       sev.label,
          color:       sev.color,
          event:       p.event,
          description: p.description || '',
          from:        p.onset      ? new Date(p.onset)    : null,
          to:          p.expires    ? new Date(p.expires)  : null,
          area:        p.area       || '',
          instruction: p.instruction || '',
        }
      })
      .filter(a => a.severity !== 'Minor')   // skjul lavrisiko-varsler
      .sort((a, b) => {
        const order = { Extreme: 0, Severe: 1, Moderate: 2, Minor: 3 }
        return (order[a.severity] ?? 9) - (order[b.severity] ?? 9)
      })

    alertCacheTime = Date.now()
    return alertCache
  } catch (err) {
    console.warn('MetAlerts feil:', err)
    return []
  }
}

export function scheduleAlertChecks(getPosition, onAlerts) {
  const doFetch = async () => {
    const pos = getPosition()
    if (!pos) return
    const alerts = await fetchAlerts(pos.lat, pos.lon)
    onAlerts(alerts)
  }
  alertTimer = setInterval(doFetch, 15 * 60 * 1000)
  return doFetch  // returner trigger
}

export function stopAlerts() {
  if (alertTimer) clearInterval(alertTimer)
}

export function formatAlertTime(date) {
  if (!date) return ''
  return date.toLocaleString('no-NO', { weekday: 'short', hour: '2-digit', minute: '2-digit' })
}
