// BarentsWatch AIS — kaller Vercel proxy som håndterer auth + CORS
import { updateAisTarget } from './map.js'
import { updateAisState }  from './cpa.js'

const AIS_PROXY = '/api/bw-ais'
const POLL_MS   = 60_000

let pollTimer   = null
let isEnabled   = true
let statusCb    = null
let currentBBox = null
let bwTargets   = new Set()

export function setBwStatusCallback(cb) { statusCb = cb }
function setStatus(state, text) { if (statusCb) statusCb(state, text) }

export async function startBarentswatch(centerLat, centerLon, radiusDeg = 0.5) {
  currentBBox = {
    xmin: (centerLon - radiusDeg).toFixed(4),
    ymin: (centerLat - radiusDeg).toFixed(4),
    xmax: (centerLon + radiusDeg).toFixed(4),
    ymax: (centerLat + radiusDeg).toFixed(4),
  }
  setStatus('connecting', 'BW: kobler...')
  await poll()
  pollTimer = setInterval(poll, POLL_MS)
}

async function poll() {
  if (!isEnabled) return
  try {
    const params = new URLSearchParams(currentBBox)
    const res    = await fetch(`${AIS_PROXY}?${params}`)

    if (!res.ok) {
      const json = await res.json().catch(() => ({}))
      throw new Error(json.error || `HTTP ${res.status}`)
    }

    const data    = await res.json()
    const vessels = Array.isArray(data) ? data : (data.features || [])

    bwTargets.clear()
    for (const v of vessels) {
      const props  = v.properties || v
      const coords = v.geometry?.coordinates
      const lat    = coords?.[1] ?? props.latitude        ?? props.lat
      const lon    = coords?.[0] ?? props.longitude       ?? props.lon
      const mmsi   = props.mmsi  ?? props.MMSI
      if (!mmsi || !lat || !lon) continue

      bwTargets.add(String(mmsi))
      updateAisTarget(
        mmsi, lat, lon,
        props.trueHeading       ?? props.courseOverGround ?? 0,
        props.name              || props.shipName         || '',
        props.speedOverGround,
        props.courseOverGround,
      )
      updateAisState(mmsi, lat, lon, props.speedOverGround ?? 0, props.courseOverGround ?? 0)
    }

    setStatus('ok', `BW: ${bwTargets.size} mål`)
  } catch (err) {
    console.warn('BarentsWatch AIS feil:', err.message)
    setStatus('error', `BW: ${err.message}`)
  }
}

export function stopBarentswatch() {
  isEnabled = false
  if (pollTimer) clearInterval(pollTimer)
}
