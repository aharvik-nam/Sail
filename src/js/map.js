import L from 'leaflet'

// Fix Leaflet default icon paths with Vite
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png?url'
import markerIcon from 'leaflet/dist/images/marker-icon.png?url'
import markerShadow from 'leaflet/dist/images/marker-shadow.png?url'
delete L.Icon.Default.prototype._getIconUrl
L.Icon.Default.mergeOptions({ iconUrl: markerIcon, iconRetinaUrl: markerIcon2x, shadowUrl: markerShadow })

// Oslofjord center
const DEFAULT_CENTER = [59.44, 10.6]
const DEFAULT_ZOOM = 10

let map, activeBaseLayer, seamarkLayer
let boatMarker = null
let aisMarkers = {}

const KARTVERKET_ATTR = '© <a href="https://kartverket.no">Kartverket</a>'

let currentMapFilter = 'none'
let nightMode = false

const BASE_LAYERS = {
  sjo: {
    label: 'Sjøkart',
    url: 'https://cache.kartverket.no/v1/wmts/1.0.0/sjokartraster/default/webmercator/{z}/{y}/{x}.png',
    options: { attribution: KARTVERKET_ATTR, maxZoom: 18 },
  },
  topo: {
    label: 'Topografisk',
    url: 'https://cache.kartverket.no/v1/wmts/1.0.0/toporaster/default/webmercator/{z}/{y}/{x}.png',
    options: { attribution: KARTVERKET_ATTR, maxZoom: 18 },
  },
}

export function initMap() {
  map = L.map('map', {
    center: DEFAULT_CENTER,
    zoom: DEFAULT_ZOOM,
    zoomControl: false,
    attributionControl: true,
    preferCanvas: true,
  })

  setBaseLayer('sjo')

  seamarkLayer = L.tileLayer(
    'https://tiles.openseamap.org/seamark/{z}/{x}/{y}.png',
    { attribution: '© <a href="https://openseamap.org">OpenSeaMap</a>', maxZoom: 18, opacity: 1 }
  ).addTo(map)

  return map
}

export function getMap() { return map }

export function setBaseLayer(key) {
  const def = BASE_LAYERS[key]
  if (!def) return
  if (activeBaseLayer) map.removeLayer(activeBaseLayer)
  activeBaseLayer = L.tileLayer(def.url, def.options).addTo(map)
  if (seamarkLayer && map.hasLayer(seamarkLayer)) seamarkLayer.bringToFront()
  activeBaseLayer.on('load', () => applyBaseFilter())
  applyBaseFilter()
  return key
}

function applyBaseFilter() {
  const pane = map.getPanes().tilePane
  if (!pane) return
  const containers = pane.querySelectorAll('.leaflet-layer')
  const filterStr = nightMode
    ? 'invert(1) hue-rotate(180deg) brightness(0.78) contrast(1.06) saturate(0.9)'
    : currentMapFilter
  if (containers[0]) containers[0].style.filter = filterStr
}

export function setMapFilter(filterStr) {
  currentMapFilter = filterStr
  applyBaseFilter()
}

export function setMapNight(isNight) {
  nightMode = isNight
  applyBaseFilter()
}

export function getBaseLayers() { return BASE_LAYERS }

export function setSeamarkVisible(visible) {
  if (visible) { if (!map.hasLayer(seamarkLayer)) map.addLayer(seamarkLayer) }
  else { if (map.hasLayer(seamarkLayer)) map.removeLayer(seamarkLayer) }
}

// SVG boat icon
function createBoatIcon(heading = 0) {
  return L.divIcon({
    className: 'boat-icon',
    iconSize: [34, 34],
    iconAnchor: [17, 17],
    html: `<svg width="34" height="34" viewBox="0 0 34 34"><g transform="rotate(${heading} 17 17)">
      <path d="M17 3 23.5 28 17 23.5 10.5 28Z" fill="var(--accent)" stroke="var(--c-bg)" stroke-width="1.6" stroke-linejoin="round"/>
      </g></svg>`,
  })
}

export function updateBoatPosition(lat, lon, heading) {
  if (!boatMarker) {
    boatMarker = L.marker([lat, lon], { icon: createBoatIcon(heading), zIndexOffset: 1000 }).addTo(map)
    boatMarker.bindPopup('<b>Min posisjon</b>')
  } else {
    boatMarker.setLatLng([lat, lon])
    boatMarker.setIcon(createBoatIcon(heading))
  }
}

export function centerOnBoat(lat, lon) {
  map.setView([lat, lon], Math.max(map.getZoom(), 13), { animate: true })
}

// Route line
let routeLine = null
export function updateRouteLine(latlonPairs) {
  if (routeLine) { map.removeLayer(routeLine); routeLine = null }
  if (latlonPairs.length < 2) return
  routeLine = L.polyline(latlonPairs, {
    color: '#00aaff', weight: 2.5, opacity: 0.85, dashArray: '8 5',
  }).addTo(map)
}

// AIS markers
function createAisIcon(heading = 0) {
  return L.divIcon({
    className: 'ais-icon',
    iconSize: [22, 22],
    iconAnchor: [11, 11],
    html: `<svg class="ais-tri" width="22" height="22" viewBox="0 0 22 22"><g transform="rotate(${heading} 11 11)">
      <path d="M11 2 15 19 11 15.5 7 19Z" fill="#5ab0ff" stroke="var(--c-bg)" stroke-width="1.3" stroke-linejoin="round"/>
      </g></svg>`,
  })
}

export function updateAisTarget(mmsi, lat, lon, heading, name, speed, course) {
  const popup = `<div class="ais-pop"><b>${name || 'Ukjent'}</b>
    <div class="r"><span>MMSI</span><span>${mmsi}</span></div>
    <div class="r"><span>Fart</span><span>${speed ? speed.toFixed(1) + ' kn' : '--'}</span></div>
    <div class="r"><span>Kurs</span><span>${course ? Math.round(course) + '°' : '--'}</span></div></div>`

  if (aisMarkers[mmsi]) {
    aisMarkers[mmsi].setLatLng([lat, lon])
    aisMarkers[mmsi].setIcon(createAisIcon(heading))
    aisMarkers[mmsi].getPopup().setContent(popup)
  } else {
    aisMarkers[mmsi] = L.marker([lat, lon], { icon: createAisIcon(heading), zIndexOffset: 500 }).addTo(map)
    aisMarkers[mmsi].bindPopup(popup, { className: 'ais-popup' })
  }
}

export function removeAisTarget(mmsi) {
  if (aisMarkers[mmsi]) { map.removeLayer(aisMarkers[mmsi]); delete aisMarkers[mmsi] }
}

export function setAisRisk(mmsi, risk) {
  const m = aisMarkers[mmsi]
  if (!m) return
  const el = m.getElement()
  if (!el) return
  el.classList.remove('ais-warn', 'ais-critical')
  if (risk === 'warning')  el.classList.add('ais-warn')
  if (risk === 'critical') el.classList.add('ais-critical')
}

export function setAisVisible(visible) {
  Object.values(aisMarkers).forEach(m => {
    if (visible) { if (!map.hasLayer(m)) map.addLayer(m) }
    else { if (map.hasLayer(m)) map.removeLayer(m) }
  })
}
