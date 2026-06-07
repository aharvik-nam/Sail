import L from 'leaflet'
import { analyzeleg, bearing, fmtEta } from './polar.js'
import { updateRouteLine } from './map.js'

const NM = 1852

let map = null
let waypoints = []       // [{ lat, lon, marker }]
let planningMode = false
let onRouteUpdate = null

export function initRoute(leafletMap, onUpdate) {
  map = leafletMap
  onRouteUpdate = onUpdate
}

export function togglePlanningMode() {
  planningMode = !planningMode
  if (planningMode) {
    map.getContainer().style.cursor = 'crosshair'
    map.on('click', onMapClick)
  } else {
    map.getContainer().style.cursor = ''
    map.off('click', onMapClick)
  }
  return planningMode
}

export function isPlanningMode() { return planningMode }

function onMapClick(e) {
  addWaypoint(e.latlng.lat, e.latlng.lng)
}

export function addWaypoint(lat, lon) {
  const idx = waypoints.length + 1

  const icon = L.divIcon({
    html: `<div class="wp-marker">${idx}</div>`,
    className: '',
    iconSize: [26, 26],
    iconAnchor: [13, 13],
  })

  const marker = L.marker([lat, lon], { icon, draggable: true })
    .addTo(map)
    .bindTooltip(`WP${idx}`, { permanent: false, direction: 'top' })

  const wp = { lat, lon, marker }

  marker.on('drag', () => {
    const { lat: la, lng: lo } = marker.getLatLng()
    wp.lat = la; wp.lon = lo
    redrawLine()
    notifyUpdate()
  })

  marker.on('dblclick', () => removeWaypoint(wp))

  waypoints.push(wp)
  redrawLine()
  notifyUpdate()
}

export function removeWaypoint(wp) {
  const idx = waypoints.indexOf(wp)
  if (idx === -1) return
  map.removeLayer(wp.marker)
  waypoints.splice(idx, 1)
  waypoints.forEach((w, i) => {
    w.marker.setIcon(L.divIcon({
      html: `<div class="wp-marker">${i + 1}</div>`,
      className: '', iconSize: [26, 26], iconAnchor: [13, 13],
    }))
  })
  redrawLine()
  notifyUpdate()
}

export function clearRoute() {
  waypoints.forEach(wp => map.removeLayer(wp.marker))
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
  let totalNm = 0, totalEta = 0, etaValid = true
  const hasWind = windDir !== null && windKnots !== null && windKnots > 1

  for (let i = 1; i < waypoints.length; i++) {
    const dist = haversineNm(waypoints[i-1].lat, waypoints[i-1].lon, waypoints[i].lat, waypoints[i].lon)
    const brng = bearing(waypoints[i-1].lat, waypoints[i-1].lon, waypoints[i].lat, waypoints[i].lon)

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
