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

const BASE_LAYERS = {
  bw: {
    label: 'Sjøkart gråtone',
    url: 'https://cache.kartverket.no/v1/wmts/1.0.0/sjokartraster/default/webmercator/{z}/{y}/{x}.png',
    options: { attribution: KARTVERKET_ATTR, maxZoom: 18 },
    filter: 'grayscale(1)',
  },
  color: {
    label: 'Sjøkart farge',
    url: 'https://cache.kartverket.no/v1/wmts/1.0.0/sjokartraster/default/webmercator/{z}/{y}/{x}.png',
    options: { attribution: KARTVERKET_ATTR, maxZoom: 18 },
    filter: 'none',
  },
  topo: {
    label: 'Topografisk',
    url: 'https://cache.kartverket.no/v1/wmts/1.0.0/toporaster/default/webmercator/{z}/{y}/{x}.png',
    options: { attribution: KARTVERKET_ATTR, maxZoom: 18 },
    filter: 'none',
  },
}

export function initMap() {
  map = L.map('map', {
    center: DEFAULT_CENTER,
    zoom: DEFAULT_ZOOM,
    zoomControl: false,
    attributionControl: true,
  })

  // Default: B&W sea chart
  setBaseLayer('bw')

  // OpenSeaMap seamark overlay
  seamarkLayer = L.tileLayer(
    'https://tiles.openseamap.org/seamark/{z}/{x}/{y}.png',
    {
      attribution: '© <a href="https://openseamap.org">OpenSeaMap</a>',
      maxZoom: 18,
      opacity: 1,
    }
  ).addTo(map)

  // Zoom control top-right
  L.control.zoom({ position: 'topright' }).addTo(map)

  return map
}

export function getMap() { return map }

export function setBaseLayer(key) {
  const def = BASE_LAYERS[key]
  if (!def) return

  if (activeBaseLayer) map.removeLayer(activeBaseLayer)

  activeBaseLayer = L.tileLayer(def.url, def.options)
  activeBaseLayer.addTo(map)

  // Seamark must stay on top
  if (seamarkLayer && map.hasLayer(seamarkLayer)) {
    seamarkLayer.bringToFront()
  }

  // Apply CSS filter to the tile layer's container
  activeBaseLayer.on('load', () => applyBaseFilter(def.filter))
  // Also apply immediately if tiles already in cache
  applyBaseFilter(def.filter)

  return key
}

function applyBaseFilter(filter) {
  // Leaflet renders tiles inside .leaflet-tile-pane
  const pane = map.getPanes().tilePane
  if (!pane) return
  // Only filter the first tile layer (base), not seamark
  const containers = pane.querySelectorAll('.leaflet-layer')
  if (containers[0]) containers[0].style.filter = filter
}

export function getBaseLayers() { return BASE_LAYERS }

export function setSeamarkVisible(visible) {
  if (visible) {
    if (!map.hasLayer(seamarkLayer)) map.addLayer(seamarkLayer)
  } else {
    if (map.hasLayer(seamarkLayer)) map.removeLayer(seamarkLayer)
  }
}

// SVG boat icon pointing in heading direction
function createBoatIcon(heading = 0) {
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">
      <g transform="rotate(${heading}, 16, 16)">
        <polygon points="16,4 22,26 16,22 10,26" fill="#00aaff" stroke="#0a1628" stroke-width="1.5"/>
      </g>
    </svg>`
  return L.divIcon({
    html: svg,
    className: '',
    iconSize: [32, 32],
    iconAnchor: [16, 16],
  })
}

export function updateBoatPosition(lat, lon, heading) {
  if (!boatMarker) {
    boatMarker = L.marker([lat, lon], {
      icon: createBoatIcon(heading),
      zIndexOffset: 1000,
    }).addTo(map)
    boatMarker.bindPopup('<b>Min posisjon</b>')
  } else {
    boatMarker.setLatLng([lat, lon])
    boatMarker.setIcon(createBoatIcon(heading))
  }
}

export function centerOnBoat(lat, lon) {
  map.setView([lat, lon], Math.max(map.getZoom(), 13), { animate: true })
}

// AIS markers
function createAisIcon(heading = 0, name = '') {
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 20 20">
      <g transform="rotate(${heading}, 10, 10)">
        <polygon points="10,2 14,18 10,14 6,18" fill="#00ddaa" stroke="#0a1628" stroke-width="1"/>
      </g>
    </svg>`
  return L.divIcon({
    html: svg,
    className: '',
    iconSize: [20, 20],
    iconAnchor: [10, 10],
  })
}

export function updateAisTarget(mmsi, lat, lon, heading, name, speed, course) {
  const popup = `
    <div style="font-family:monospace;font-size:12px;color:#e8f0fe;background:#0f2040;padding:8px;border-radius:6px;min-width:140px">
      <b style="color:#00ddaa">${name || 'Ukjent'}</b><br>
      MMSI: ${mmsi}<br>
      Fart: ${speed ? speed.toFixed(1) + ' kn' : '--'}<br>
      Kurs: ${course ? Math.round(course) + '°' : '--'}
    </div>`

  if (aisMarkers[mmsi]) {
    aisMarkers[mmsi].setLatLng([lat, lon])
    aisMarkers[mmsi].setIcon(createAisIcon(heading, name))
    aisMarkers[mmsi].getPopup().setContent(popup)
  } else {
    aisMarkers[mmsi] = L.marker([lat, lon], {
      icon: createAisIcon(heading, name),
      zIndexOffset: 500,
    }).addTo(map)
    aisMarkers[mmsi].bindPopup(popup, { className: 'ais-popup' })
  }
}

export function removeAisTarget(mmsi) {
  if (aisMarkers[mmsi]) {
    map.removeLayer(aisMarkers[mmsi])
    delete aisMarkers[mmsi]
  }
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
