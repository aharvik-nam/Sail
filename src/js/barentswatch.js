// BarentsWatch AIS — OAuth2 client_credentials + REST polling
import { updateAisTarget } from './map.js'
import { updateAisState } from './cpa.js'

const TOKEN_URL  = 'https://id.barentswatch.no/connect/token'
const AIS_URL    = 'https://www.barentswatch.no/bwapi/v2/geodata/ais/openpositions'
const CLIENT_ID  = import.meta.env.VITE_BW_CLIENT_ID     || ''
const CLIENT_SEC = import.meta.env.VITE_BW_CLIENT_SECRET || ''
const POLL_MS    = 60_000   // 60 sekunder mellom oppdateringer

let token       = null
let tokenExpiry = 0
let pollTimer   = null
let isEnabled   = true
let statusCb    = null
let currentBBox = null
let bwTargets   = new Set()

export function setBwStatusCallback(cb) { statusCb = cb }

function setStatus(state, text) { if (statusCb) statusCb(state, text) }

export async function startBarentswatch(centerLat, centerLon, radiusDeg = 0.5) {
  if (!CLIENT_ID || !CLIENT_SEC) {
    setStatus('off', 'Ingen BW-nøkkel')
    return
  }
  currentBBox = {
    xMin: centerLon - radiusDeg,
    yMin: centerLat - radiusDeg,
    xMax: centerLon + radiusDeg,
    yMax: centerLat + radiusDeg,
  }
  await poll()
  pollTimer = setInterval(poll, POLL_MS)
}

async function poll() {
  if (!isEnabled) return
  try {
    const t = await getToken()
    if (!t) return

    const params = new URLSearchParams({
      Xmin: currentBBox.xMin.toFixed(4),
      Ymin: currentBBox.yMin.toFixed(4),
      Xmax: currentBBox.xMax.toFixed(4),
      Ymax: currentBBox.yMax.toFixed(4),
    })

    const res = await fetch(`${AIS_URL}?${params}`, {
      headers: { Authorization: `Bearer ${t}` }
    })
    if (!res.ok) throw new Error(`BW AIS HTTP ${res.status}`)

    const vessels = await res.json()
    const arr = Array.isArray(vessels) ? vessels : (vessels.features || [])

    bwTargets.clear()
    for (const v of arr) {
      // GeoJSON feature eller flat objekt
      const props = v.properties || v
      const coords = v.geometry?.coordinates
      const lat  = coords?.[1] ?? props.latitude  ?? props.lat
      const lon  = coords?.[0] ?? props.longitude ?? props.lon
      const mmsi = props.mmsi  ?? props.MMSI
      if (!mmsi || !lat || !lon) continue

      bwTargets.add(String(mmsi))
      updateAisTarget(
        mmsi, lat, lon,
        props.trueHeading ?? props.courseOverGround ?? 0,
        props.name || props.shipName || '',
        props.speedOverGround,
        props.courseOverGround,
      )
      updateAisState(mmsi, lat, lon, props.speedOverGround ?? 0, props.courseOverGround ?? 0)
    }

    setStatus('ok', `BW: ${bwTargets.size} mål`)
  } catch (err) {
    console.warn('BarentsWatch AIS feil:', err)
    setStatus('error', 'BW: feil')
  }
}

async function getToken() {
  if (token && Date.now() < tokenExpiry - 30_000) return token

  try {
    const body = new URLSearchParams({
      grant_type:    'client_credentials',
      client_id:     CLIENT_ID,
      client_secret: CLIENT_SEC,
      scope:         'ais',
    })
    const res = await fetch(TOKEN_URL, {
      method:  'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    })
    if (!res.ok) throw new Error(`Token HTTP ${res.status}`)
    const json = await res.json()
    token       = json.access_token
    tokenExpiry = Date.now() + json.expires_in * 1000
    return token
  } catch (err) {
    console.warn('BarentsWatch token feil:', err)
    setStatus('error', 'BW: auth feil')
    return null
  }
}

export function stopBarentswatch() {
  isEnabled = false
  if (pollTimer) clearInterval(pollTimer)
}
