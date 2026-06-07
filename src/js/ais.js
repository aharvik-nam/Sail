import { updateAisTarget, removeAisTarget } from './map.js'
import { updateAisState, removeAisState } from './cpa.js'

const AISSTREAM_URL = 'wss://stream.aisstream.io/v0/stream'
const API_KEY = import.meta.env.VITE_AISSTREAM_KEY || ''

let ws = null
let reconnectTimer = null
let isEnabled = true
let currentBBox = null
let statusCallback = null
let targetCount = 0

const targetTimestamps = {}
const STALE_TIMEOUT = 10 * 60 * 1000

export function setAisStatusCallback(cb) { statusCallback = cb }

function setStatus(state, text) {
  if (statusCallback) statusCallback(state, text)
}

export function startAIS(centerLat, centerLon, radiusDeg = 0.5) {
  if (!API_KEY) {
    setStatus('off', 'Ingen AIS-nøkkel')
    return
  }

  currentBBox = [
    [centerLat - radiusDeg, centerLon - radiusDeg],
    [centerLat + radiusDeg, centerLon + radiusDeg],
  ]

  connect()
  setInterval(cleanStaleTargets, 60 * 1000)
}

function connect() {
  if (!isEnabled || !API_KEY) return

  setStatus('connecting', 'Kobler til...')
  ws = new WebSocket(AISSTREAM_URL)

  ws.onopen = () => {
    setStatus('connected', '0 mål')
    const sub = {
      APIKey: API_KEY,
      BoundingBoxes: [currentBBox],
      // Inkluder alle relevante meldingstyper: Class A + Class B
      FilterMessageTypes: [
        'PositionReport',              // Class A (type 1,2,3) — cargo, tanker
        'StandardClassBPositionReport', // Class B (type 18) — fritidsbåter, ferger
        'ExtendedClassBPositionReport', // Class B extended (type 19)
        'ShipStaticData',               // Skipsnavn, type, dimensjoner (type 5)
      ],
    }
    ws.send(JSON.stringify(sub))
  }

  ws.onmessage = (evt) => {
    try {
      const msg = JSON.parse(evt.data)
      handleMessage(msg)
    } catch {}
  }

  ws.onerror = (err) => {
    setStatus('error', 'Tilkoblingsfeil')
  }

  ws.onclose = (evt) => {
    if (isEnabled) {
      const reason = evt.code === 1008 ? 'Ugyldig nøkkel' : `Frakoblet (${evt.code})`
      setStatus('reconnecting', reason + ' — prøver igjen...')
      reconnectTimer = setTimeout(connect, 15000)
    }
  }
}

function handleMessage(msg) {
  const type = msg.MessageType
  const meta = msg.MetaData || {}
  const mmsi = meta.MMSI
  if (!mmsi) return

  // Class A posisjon
  if (type === 'PositionReport') {
    const p = msg.Message?.PositionReport || {}
    handlePosition(mmsi, p.Latitude, p.Longitude,
      p.TrueHeading ?? p.CourseOverGround ?? 0,
      meta.ShipName || '', p.SpeedOverGround, p.CourseOverGround)
  }

  // Class B standard
  if (type === 'StandardClassBPositionReport') {
    const p = msg.Message?.StandardClassBPositionReport || {}
    handlePosition(mmsi, p.Latitude, p.Longitude,
      p.TrueHeading ?? p.CourseOverGround ?? 0,
      meta.ShipName || '', p.SpeedOverGround, p.CourseOverGround)
  }

  // Class B extended
  if (type === 'ExtendedClassBPositionReport') {
    const p = msg.Message?.ExtendedClassBPositionReport || {}
    handlePosition(mmsi, p.Latitude, p.Longitude,
      p.TrueHeading ?? p.CourseOverGround ?? 0,
      p.Name || meta.ShipName || '', p.SpeedOverGround, p.CourseOverGround)
  }
}

function handlePosition(mmsi, lat, lon, heading, name, sog, cog) {
  if (!lat || !lon) return
  if (lat === 0 && lon === 0) return  // ugyldig posisjon

  const isNew = !targetTimestamps[mmsi]
  targetTimestamps[mmsi] = Date.now()

  if (isNew) {
    targetCount++
    setStatus('connected', `${targetCount} mål`)
  }

  updateAisTarget(mmsi, lat, lon, heading, name, sog, cog)
  updateAisState(mmsi, lat, lon, sog ?? 0, cog ?? 0)
}

function cleanStaleTargets() {
  const now = Date.now()
  for (const [mmsi, ts] of Object.entries(targetTimestamps)) {
    if (now - ts > STALE_TIMEOUT) {
      removeAisTarget(mmsi)
      removeAisState(mmsi)
      delete targetTimestamps[mmsi]
      targetCount = Math.max(0, targetCount - 1)
    }
  }
  if (Object.keys(targetTimestamps).length === 0) {
    setStatus('connected', '0 mål')
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
  setStatus('off', 'Pauset')
}

export function resumeAIS() {
  isEnabled = true
  connect()
}
