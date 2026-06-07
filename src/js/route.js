import L from 'leaflet'

const NM = 1852  // metres per nautical mile

let map = null
let waypoints = []       // [{ lat, lon, marker }]
let routeLine = null
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

  marker.on('drag', () => {
    const { lat: la, lng: lo } = marker.getLatLng()
    const wp = waypoints.find(w => w.marker === marker)
    if (wp) { wp.lat = la; wp.lon = lo }
    redrawLine()
    notifyUpdate()
  })

  marker.on('dblclick', () => removeWaypoint(marker))

  waypoints.push({ lat, lon, marker })
  redrawLine()
  notifyUpdate()
}

export function removeWaypoint(marker) {
  const idx = waypoints.findIndex(w => w.marker === marker)
  if (idx === -1) return
  map.removeLayer(marker)
  waypoints.splice(idx, 1)
  // Renumber remaining markers
  waypoints.forEach((wp, i) => {
    wp.marker.setIcon(L.divIcon({
      html: `<div class="wp-marker">${i + 1}</div>`,
      className: '',
      iconSize: [26, 26],
      iconAnchor: [13, 13],
    }))
  })
  redrawLine()
  notifyUpdate()
}

export function clearRoute() {
  waypoints.forEach(wp => map.removeLayer(wp.marker))
  waypoints = []
  if (routeLine) { map.removeLayer(routeLine); routeLine = null }
  notifyUpdate()
}

function redrawLine() {
  const latlngs = waypoints.map(wp => [wp.lat, wp.lon])
  if (routeLine) map.removeLayer(routeLine)
  if (latlngs.length < 2) { routeLine = null; return }
  routeLine = L.polyline(latlngs, {
    color: '#00aaff',
    weight: 2.5,
    opacity: 0.85,
    dashArray: '8 5',
  }).addTo(map)
}

function haversineNm(lat1, lon1, lat2, lon2) {
  const R = 6371000
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLon = (lon2 - lon1) * Math.PI / 180
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180) * Math.cos(lat2*Math.PI/180) * Math.sin(dLon/2)**2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a)) / NM
}

export function getRouteStats(speedKnots) {
  if (waypoints.length < 2) return null

  const legs = []
  let totalNm = 0

  for (let i = 1; i < waypoints.length; i++) {
    const dist = haversineNm(
      waypoints[i-1].lat, waypoints[i-1].lon,
      waypoints[i].lat,   waypoints[i].lon
    )
    legs.push({ from: i, to: i+1, distNm: dist })
    totalNm += dist
  }

  const etaHours = speedKnots > 0 ? totalNm / speedKnots : null

  return { legs, totalNm, etaHours, waypointCount: waypoints.length }
}

export function getWaypoints() { return waypoints }

function notifyUpdate() {
  if (onRouteUpdate) onRouteUpdate(waypoints.length)
}
