import maplibregl from 'maplibre-gl'
import { analyzeleg, bearing, fmtEta } from './polar.js'
import { updateRouteLine } from './map.js'

const NM = 1852  // metres per nautical mile

let map = null
let waypoints = []       // [{ lat, lon, marker, el }]
let planningMode = false
let onRouteUpdate = null

export function initRoute(mapInstance, onUpdate) {
  map = mapInstance
  onRouteUpdate = onUpdate
}

export function togglePlanningMode() {
  planningMode = !planningMode
  map.getCanvas().style.cursor = planningMode ? 'crosshair' : ''
  if (planningMode) {
    map.on('click', onMapClick)
  } else {
    map.off('click', onMapClick)
  }
  return planningMode
}

export function isPlanningMode() { return planningMode }

function onMapClick(e) {
  addWaypoint(e.lngLat.lat, e.lngLat.lng)
}

export function addWaypoint(lat, lon) {
  const idx = waypoints.length + 1

  const el = document.createElement('div')
  el.className = 'wp-marker'
  el.textContent = idx

  const marker = new maplibregl.Marker({ element: el, anchor: 'center', draggable: true })
    .setLngLat([lon, lat])
    .addTo(map)

  const wp = { lat, lon, marker, el }

  marker.on('drag', () => {
    const { lat: la, lng: lo } = marker.getLngLat()
    wp.lat = la
    wp.lon = lo
    redrawLine()
    notifyUpdate()
  })

  el.addEventListener('dblclick', (ev) => {
    ev.stopPropagation()
    removeWaypoint(wp)
  })

  waypoints.push(wp)
  redrawLine()
  notifyUpdate()
}

export function removeWaypoint(wp) {
  const idx = waypoints.indexOf(wp)
  if (idx === -1) return
  wp.marker.remove()
  waypoints.splice(idx, 1)
  // Renumber remaining markers
  waypoints.forEach((w, i) => { w.el.textContent = i + 1 })
  redrawLine()
  notifyUpdate()
}

export function clearRoute() {
  waypoints.forEach(wp => wp.marker.remove())
  waypoints = []
  updateRouteLine([])
  notifyUpdate()
}

function redrawLine() {
  updateRouteLine(waypoints.map(wp => [wp.lat, wp.lon]))
}

function haversineNm(lat1, lon1, lat2, lon2) {
  const R = 6371000
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLon = (lon2 - lon1) * Math.PI / 180
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180) * Math.cos(lat2*Math.PI/180) * Math.sin(dLon/2)**2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a)) / NM
}

export function getRouteStats(speedKnots, windDir = null, windKnots = null) {
  if (waypoints.length < 2) return null

  const legs = []
  let totalNm   = 0
  let totalEta  = 0
  let etaValid  = true
  const hasWind = windDir !== null && windKnots !== null && windKnots > 1

  for (let i = 1; i < waypoints.length; i++) {
    const dist = haversineNm(
      waypoints[i-1].lat, waypoints[i-1].lon,
      waypoints[i].lat,   waypoints[i].lon
    )
    const brng = bearing(
      waypoints[i-1].lat, waypoints[i-1].lon,
      waypoints[i].lat,   waypoints[i].lon
    )

    let wind = null
    if (hasWind) {
      wind = analyzeleg(brng, dist, windDir, windKnots)
      if (wind.etaHours !== null) totalEta += wind.etaHours
      else etaValid = false
    }

    legs.push({ from: i, to: i+1, distNm: dist, bearing: Math.round(brng), wind })
    totalNm += dist
  }

  let etaHours = null
  if (hasWind && etaValid)   etaHours = totalEta
  else if (speedKnots > 0.3) etaHours = totalNm / speedKnots

  return { legs, totalNm, etaHours, waypointCount: waypoints.length, windAnalysis: hasWind }
}

export function getWaypoints() { return waypoints }

function notifyUpdate() {
  if (onRouteUpdate) onRouteUpdate(waypoints.length)
}
