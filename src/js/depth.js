// Depth lookup via GEBCO WMTS GetFeatureInfo
// Falls back to Kartverket havdybde if GEBCO fails
const GEBCO_WMS = 'https://www.gebco.net/data_and_products/gebco_web_services/web_map_service/mapserv'

let depthAlarmThreshold = null  // null = disabled
let alarmActive = false
let alarmCallback = null
let lastDepth = null

export function setDepthAlarm(thresholdMeters, onAlarm) {
  depthAlarmThreshold = thresholdMeters
  alarmCallback = onAlarm
  alarmActive = false
}

export function clearDepthAlarm() {
  depthAlarmThreshold = null
  alarmActive = false
}

export function getDepthAlarmThreshold() { return depthAlarmThreshold }

export async function lookupDepth(lat, lon) {
  try {
    // GEBCO WMS GetFeatureInfo — returns depth at point
    const params = new URLSearchParams({
      SERVICE: 'WMS',
      VERSION: '1.1.1',
      REQUEST: 'GetFeatureInfo',
      LAYERS: 'GEBCO_LATEST',
      QUERY_LAYERS: 'GEBCO_LATEST',
      INFO_FORMAT: 'text/plain',
      SRS: 'EPSG:4326',
      BBOX: `${lon - 0.001},${lat - 0.001},${lon + 0.001},${lat + 0.001}`,
      WIDTH: '3',
      HEIGHT: '3',
      X: '1',
      Y: '1',
    })
    const res = await fetch(`${GEBCO_WMS}?${params}`)
    if (!res.ok) throw new Error(`GEBCO ${res.status}`)
    const text = await res.text()
    // GEBCO returns something like "value_list = -42.5"
    const match = text.match(/[-\d.]+/)
    if (match) {
      const raw = parseFloat(match[0])
      // GEBCO: negative = below sea level (depth), positive = above
      lastDepth = raw < 0 ? Math.abs(raw) : null
      checkAlarm()
      return lastDepth
    }
  } catch (err) {
    console.warn('GEBCO lookup failed:', err)
  }
  return null
}

function checkAlarm() {
  if (depthAlarmThreshold === null || lastDepth === null) return
  const triggered = lastDepth < depthAlarmThreshold
  if (triggered && !alarmActive) {
    alarmActive = true
    if (alarmCallback) alarmCallback(lastDepth, depthAlarmThreshold)
  } else if (!triggered) {
    alarmActive = false
  }
}

export function getLastDepth() { return lastDepth }
