import { updateAisTarget, removeAisTarget } from './map.js'
import { updateAisState, removeAisState } from './cpa.js'

const AISSTREAM_URL = 'wss://stream.aisstream.io/v0/stream'
const API_KEY = import.meta.env.VITE_AISSTREAM_KEY || ''

let ws = null
let reconnectTimer = null
let isEnabled = true
let currentBBox = null

// Stale target cleanup: remove AIS targets not updated in 10min
const targetTimestamps = {}
const STALE_TIMEOUT = 10 * 60 * 1000

export function startAIS(centerLat, centerLon, radiusDeg = 0.5) {
  if (!API_KEY) {
    console.warn('AIS: VITE_AISSTREAM_KEY ikke satt i .env')
    return
  }

  currentBBox = [
    [centerLat - radiusDeg, centerLon - radiusDeg],
    [centerLat + radiusDeg, centerLon + radiusDeg],
  ]

  connect()

  // Clean up stale targets every minute
  setInterval(cleanStaleTargets, 60 * 1000)
}

function connect() {
  if (!isEnabled || !API_KEY) return

  ws = new WebSocket(AISSTREAM_URL)

  ws.onopen = () => {
    console.log('AIS connected')
    const sub = {
      APIKey: API_KEY,
      BoundingBoxes: [currentBBox],
      FilterMessageTypes: ['PositionReport', 'ShipStaticData'],
    }
    ws.send(JSON.stringify(sub))
  }

  ws.onmessage = (evt) => {
    try {
      const msg = JSON.parse(evt.data)
      handleMessage(msg)
    } catch {}
  }

  ws.onerror = () => console.warn('AIS WebSocket error')

  ws.onclose = () => {
    if (isEnabled) {
      console.log('AIS disconnected, reconnecting in 15s...')
      reconnectTimer = setTimeout(connect, 15000)
    }
  }
}

function handleMessage(msg) {
  const type = msg.MessageType
  const meta = msg.MetaData || {}
  const mmsi = meta.MMSI

  if (!mmsi) return

  if (type === 'PositionReport') {
    const p = msg.Message?.PositionReport || {}
    const lat = p.Latitude
    const lon = p.Longitude
    if (!lat || !lon) return

    targetTimestamps[mmsi] = Date.now()
    updateAisTarget(
      mmsi,
      lat, lon,
      p.TrueHeading ?? p.CourseOverGround ?? 0,
      meta.ShipName || '',
      p.SpeedOverGround,
      p.CourseOverGround
    )
    updateAisState(mmsi, lat, lon, p.SpeedOverGround ?? 0, p.CourseOverGround ?? 0)
  }
}

function cleanStaleTargets() {
  const now = Date.now()
  for (const [mmsi, ts] of Object.entries(targetTimestamps)) {
    if (now - ts > STALE_TIMEOUT) {
      removeAisTarget(mmsi)
      removeAisState(mmsi)
      delete targetTimestamps[mmsi]
    }
  }
}

export function stopAIS() {
  isEnabled = false
  if (reconnectTimer) clearTimeout(reconnectTimer)
  if (ws) ws.close()
}

export function pauseAIS() {
  isEnabled = false
  if (ws) ws.close()
}

export function resumeAIS() {
  isEnabled = true
  connect()
}
