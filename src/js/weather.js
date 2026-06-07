const YR_BASE = 'https://api.met.no/weatherapi/locationforecast/2.0/compact'
const USER_AGENT = 'SeilNav/1.0 kontakt@example.com'

let lastWeatherData = null
let lastFetchCoords = null
let fetchTimer = null

export async function fetchWeather(lat, lon) {
  // Don't re-fetch if position hasn't moved >1km and data is fresh (<10min)
  if (lastWeatherData && lastFetchCoords) {
    const dist = haversine(lat, lon, lastFetchCoords.lat, lastFetchCoords.lon)
    const age = Date.now() - lastWeatherData.fetchedAt
    if (dist < 1000 && age < 10 * 60 * 1000) return lastWeatherData
  }

  try {
    const url = `${YR_BASE}?lat=${lat.toFixed(4)}&lon=${lon.toFixed(4)}`
    const res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT }
    })
    if (!res.ok) throw new Error(`Yr HTTP ${res.status}`)

    const json = await res.json()
    const ts = json.properties.timeseries[0]
    const instant = ts.data.instant.details
    const next1h = ts.data.next_1_hours?.summary || {}

    lastWeatherData = {
      windSpeed: instant.wind_speed,
      windGust: instant.wind_speed_of_gust,
      windDir: instant.wind_from_direction,
      temp: instant.air_temperature,
      pressure: instant.air_pressure_at_sea_level,
      symbol: next1h.symbol_code,
      fetchedAt: Date.now(),
    }
    lastFetchCoords = { lat, lon }
    return lastWeatherData
  } catch (err) {
    console.warn('Yr fetch failed:', err)
    return null
  }
}

export function scheduleWeatherUpdates(getPosition, onUpdate) {
  const doFetch = async () => {
    const pos = getPosition()
    if (!pos) return
    const data = await fetchWeather(pos.lat, pos.lon)
    if (data) onUpdate(data)
  }

  // Ikke hent umiddelbart — vent på posisjon via triggerWeatherFetch()
  fetchTimer = setInterval(doFetch, 10 * 60 * 1000)

  // Returner trigger-funksjon for bruk når posisjon er klar
  return doFetch
}

export function stopWeatherUpdates() {
  if (fetchTimer) clearInterval(fetchTimer)
}

// Wind direction degrees → compass text
export function degToCompass(deg) {
  if (deg === null || deg === undefined) return '--'
  const dirs = ['N','NNØ','NØ','ØNØ','Ø','ØSØ','SØ','SSØ','S','SSV','SV','VSV','V','VNV','NV','NNV']
  return dirs[Math.round(deg / 22.5) % 16]
}

// Wind arrow rotation (FROM direction → arrow points where wind comes from)
export function windArrowRotation(deg) {
  return deg !== null ? deg : 0
}

function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371000
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLon = (lon2 - lon1) * Math.PI / 180
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180) * Math.cos(lat2*Math.PI/180) * Math.sin(dLon/2)**2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a))
}
