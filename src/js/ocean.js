// MET Oceanforecast 2.0 — bølger, strøm, havtemperatur
// Ingen API-nøkkel, men krever User-Agent
const OCEAN_URL  = 'https://api.met.no/weatherapi/oceanforecast/2.0/complete'
const USER_AGENT = 'SeilNav/1.0 kontakt@example.com'

let cache     = null
let cachePos  = null
let cacheTime = 0

export async function fetchOcean(lat, lon) {
  // Ikke hent på nytt hvis posisjon uendret og data < 30 min gammelt
  if (cache && cachePos) {
    const dist = Math.hypot(lat - cachePos.lat, lon - cachePos.lon)
    if (dist < 0.01 && Date.now() - cacheTime < 30 * 60 * 1000) return cache
  }

  try {
    const url = `${OCEAN_URL}?lat=${lat.toFixed(4)}&lon=${lon.toFixed(4)}`
    const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } })
    if (!res.ok) throw new Error(`Oceanforecast HTTP ${res.status}`)

    const json  = await res.json()
    const ts    = json.properties?.timeseries?.[0]
    if (!ts) return null

    const inst  = ts.data?.instant?.details   || {}
    const next1 = ts.data?.next_1_hours?.details || {}

    cache = {
      // Bølger
      waveHeight:    inst.sea_surface_wave_height          ?? null,
      wavePeriod:    inst.sea_surface_wave_period          ?? null,
      waveDirection: inst.sea_surface_wave_from_direction  ?? null,
      // Strøm
      currentSpeed:  inst.sea_water_speed                  ?? null,
      currentDir:    inst.sea_water_to_direction           ?? null,
      // Havtemperatur
      seaTemp:       inst.sea_water_temperature            ?? null,
      fetchedAt:     Date.now(),
    }
    cachePos  = { lat, lon }
    cacheTime = Date.now()
    return cache
  } catch (err) {
    console.warn('Oceanforecast feil:', err)
    return null
  }
}

export function scheduleOceanUpdates(getPosition, onUpdate) {
  const doFetch = async () => {
    const pos = getPosition()
    if (!pos) return
    const data = await fetchOcean(pos.lat, pos.lon)
    if (data) onUpdate(data)
  }
  doFetch()
  return setInterval(doFetch, 30 * 60 * 1000)  // hvert 30. min
}
