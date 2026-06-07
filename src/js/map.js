import L from 'leaflet'
import {
  initAisCanvas, aisCanvasUpdate, aisCanvasRemove,
  aisCanvasSetRisk, aisCanvasSetVisible, aisCanvasHandleClick,
} from './aisCanvas.js'

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

const KARTVERKET_ATTR = '© <a href="https://kartverket.no">Kartverket</a>'

let currentMapFilter = 'none'
let nightMode = false

const TILE_OPTIONS = {
  attribution: KARTVERKET_ATTR,
  maxZoom: 18,
  keepBuffer: 4,          // cache mer rundt viewport → færre fetches under scroll
  updateWhenIdle: true,   // last kun nye tiles når brukeren stopper
  updateInterval: 150,    // ms mellom tile-oppdateringer under scroll
  crossOrigin: true,
}

const BASE_LAYERS = {
  sjo: {
    label: 'Sjøkart',
    url: 'https://cache.kartverket.no/v1/wmts/1.0.0/sjokartraster/default/webmercator/{z}/{y}/{x}.png',
    options: TILE_OPTIONS,
  },
  topo: {
    label: 'Topografisk',
    url: 'https://cache.kartverket.no/v1/wmts/1.0.0/toporaster/default/webmercator/{z}/{y}/{x}.png',
    options: TILE_OPTIONS,
  },
}

export function initMap() {
  map = L.map('map', {
    center: DEFAULT_CENTER,
    zoom: DEFAULT_ZOOM,
    zoomControl: false,
    attributionControl: true,
    preferCanvas: true,
    renderer: L.canvas({ tolerance: 5 }),
    // Performance: limit redraws, use RAF
    updateWhenIdle: false,
    updateWhenZooming: false,
  })

  setBaseLayer('sjo')

  seamarkLayer = L.tileLayer(
    'https://tiles.openseamap.org/seamark/{z}/{x}/{y}.png',
    { attribution: '© <a href="https://openseamap.org">OpenSeaMap</a>', maxZoom: 18, opacity: 1 }
  ).addTo(map)

  // Canvas-based AIS rendering (replaces DOM markers)
  initAisCanvas(map)

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

// AIS — canvas-based (see aisCanvas.js)
export function updateAisTarget(mmsi, lat, lon, heading, name, speed, course) {
  aisCanvasUpdate(mmsi, lat, lon, heading, name, speed, course)
}

export function removeAisTarget(mmsi) {
  aisCanvasRemove(mmsi)
}

export function setAisRisk(mmsi, risk, cpaNm, tcpaMin) {
  aisCanvasSetRisk(mmsi, risk, cpaNm, tcpaMin)
}

export function handleAisClick(containerX, containerY) {
  return aisCanvasHandleClick(containerX, containerY)
}

export function setAisVisible(visible) {
  aisCanvasSetVisible(visible)
}
