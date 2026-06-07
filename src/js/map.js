import maplibregl from 'maplibre-gl'

const MAPTILER_KEY = 'I30ZJuzLgpLmqLmUzOe8'
const KV_ATTR = '© <a href="https://kartverket.no">Kartverket</a>'
const OSM_ATTR = '© <a href="https://openseamap.org">OpenSeaMap</a>'

// Inline MapLibre styles — raster tiles, no remote JSON fetch needed
function buildStyle(baseKey) {
  const TILES = {
    sjo:  'https://cache.kartverket.no/v1/wmts/1.0.0/sjokartraster/default/webmercator/{z}/{y}/{x}.png',
    topo: 'https://cache.kartverket.no/v1/wmts/1.0.0/toporaster/default/webmercator/{z}/{y}/{x}.png',
  }
  return {
    version: 8,
    glyphs: `https://api.maptiler.com/fonts/{fontstack}/{range}.pbf?key=${MAPTILER_KEY}`,
    sources: {
      base: {
        type: 'raster',
        tiles: [TILES[baseKey] || TILES.sjo],
        tileSize: 256,
        attribution: KV_ATTR,
        maxzoom: 18,
      },
    },
    layers: [
      { id: 'background', type: 'background', paint: { 'background-color': '#05101c' } },
      { id: 'base-raster', type: 'raster', source: 'base', paint: { 'raster-opacity': 1 } },
    ],
  }
}

// Oslofjord center
const DEFAULT_CENTER = [10.6, 59.44]   // [lon, lat] — MapLibre order
const DEFAULT_ZOOM   = 10

let map = null
let nightMode      = false
let currentFilter  = 'none'
let currentBaseKey = 'sjo'

// Markers
let boatMarker  = null
let aisMarkers  = {}   // mmsi → { marker, el }

// Route GeoJSON source exists after load
let routeLoaded = false

export function initMap() {
  map = new maplibregl.Map({
    container: 'map',
    style: buildStyle('sjo'),
    center: DEFAULT_CENTER,
    zoom:   DEFAULT_ZOOM,
    attributionControl: false,
  })

  // Minimal attribution bottom-right
  map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right')

  map.on('load', () => {
    routeLoaded = true

    // OpenSeaMap overlay
    map.addSource('openseamap-src', {
      type: 'raster',
      tiles: ['https://tiles.openseamap.org/seamark/{z}/{x}/{y}.png'],
      tileSize: 256,
      attribution: '© <a href="https://openseamap.org">OpenSeaMap</a>',
    })
    map.addLayer({
      id: 'openseamap',
      type: 'raster',
      source: 'openseamap-src',
      paint: { 'raster-opacity': 1 },
    })

    // Route line source + layer
    map.addSource('route', {
      type: 'geojson',
      data: { type: 'Feature', geometry: { type: 'LineString', coordinates: [] } },
    })
    map.addLayer({
      id: 'route-line',
      type: 'line',
      source: 'route',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': '#00aaff',
        'line-width': 2.5,
        'line-opacity': 0.85,
        'line-dasharray': [2, 1.6],
      },
    })

    // Apply filter immediately after load
    applyFilter()
  })

  return map
}

export function getMap() { return map }

// ── Route line ──────────────────────────────────────────────────────────────
export function updateRouteLine(latlonPairs) {
  // latlonPairs: [[lat,lon], [lat,lon], ...] (our internal order)
  if (!routeLoaded) return
  const src = map.getSource('route')
  if (!src) return
  const coords = latlonPairs.map(([lat, lon]) => [lon, lat])
  src.setData({ type: 'Feature', geometry: { type: 'LineString', coordinates: coords } })
}

// ── Boat marker ──────────────────────────────────────────────────────────────
function makeBoatEl(heading) {
  const el = document.createElement('div')
  el.className = 'boat-icon'
  el.innerHTML = `<svg width="34" height="34" viewBox="0 0 34 34">
    <g transform="rotate(${heading} 17 17)">
      <path d="M17 3 23.5 28 17 23.5 10.5 28Z"
        fill="var(--accent)" stroke="var(--c-bg)" stroke-width="1.6" stroke-linejoin="round"/>
    </g></svg>`
  return el
}

export function updateBoatPosition(lat, lon, heading = 0) {
  if (!boatMarker) {
    const el = makeBoatEl(heading)
    boatMarker = new maplibregl.Marker({ element: el, anchor: 'center' })
      .setLngLat([lon, lat])
      .addTo(map)
  } else {
    boatMarker.setLngLat([lon, lat])
    boatMarker.getElement().innerHTML = makeBoatEl(heading).innerHTML
  }
}

export function centerOnBoat(lat, lon) {
  map.easeTo({ center: [lon, lat], zoom: Math.max(map.getZoom(), 13) })
}

// ── Map filter ────────────────────────────────────────────────────────────────
function applyFilter() {
  const canvas = map.getCanvas()
  if (!canvas) return
  canvas.style.filter = nightMode
    ? 'invert(1) hue-rotate(180deg) brightness(0.78) contrast(1.06) saturate(0.9)'
    : currentFilter
}

export function setMapFilter(filterStr) {
  currentFilter = filterStr
  applyFilter()
}

export function setMapNight(isNight) {
  nightMode = isNight
  applyFilter()
}

// ── Layers ────────────────────────────────────────────────────────────────────
export function setBaseLayer(key) {
  if (!['sjo', 'topo'].includes(key)) return
  currentBaseKey = key
  routeLoaded = false
  map.setStyle(buildStyle(key))
  map.once('styledata', () => {
    // styledata fires when style is parsed; wait for it to be fully loaded
    if (map.isStyleLoaded()) addOverlaysAfterStyle()
    else map.once('idle', addOverlaysAfterStyle)
  })
  return key
}

function addOverlaysAfterStyle() {
  routeLoaded = true

  if (!map.getSource('openseamap-src')) {
    map.addSource('openseamap-src', {
      type: 'raster',
      tiles: ['https://tiles.openseamap.org/seamark/{z}/{x}/{y}.png'],
      tileSize: 256,
      attribution: OSM_ATTR,
    })
  }
  if (!map.getLayer('openseamap')) {
    map.addLayer({
      id: 'openseamap',
      type: 'raster',
      source: 'openseamap-src',
      paint: { 'raster-opacity': 1 },
    })
  }

  if (!map.getSource('route')) {
    map.addSource('route', {
      type: 'geojson',
      data: { type: 'Feature', geometry: { type: 'LineString', coordinates: [] } },
    })
  }
  if (!map.getLayer('route-line')) {
    map.addLayer({
      id: 'route-line',
      type: 'line',
      source: 'route',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': '#00aaff',
        'line-width': 2.5,
        'line-opacity': 0.85,
        'line-dasharray': [2, 1.6],
      },
    })
  }

  applyFilter()
}

export function getBaseLayers() {
  return {
    sjo:  { label: 'Sjøkart' },
    topo: { label: 'Topografisk' },
  }
}

// ── Seamark overlay ────────────────────────────────────────────────────────────
export function setSeamarkVisible(visible) {
  if (!map.getLayer('openseamap')) return
  map.setLayoutProperty('openseamap', 'visibility', visible ? 'visible' : 'none')
}

// ── AIS markers ───────────────────────────────────────────────────────────────
function makeAisEl(heading = 0) {
  const el = document.createElement('div')
  el.className = 'ais-icon'
  el.innerHTML = `<svg class="ais-tri" width="22" height="22" viewBox="0 0 22 22">
    <g transform="rotate(${heading} 11 11)">
      <path d="M11 2 15 19 11 15.5 7 19Z"
        fill="#5ab0ff" stroke="var(--c-bg)" stroke-width="1.3" stroke-linejoin="round"/>
    </g></svg>`
  return el
}

export function updateAisTarget(mmsi, lat, lon, heading, name, speed, course) {
  const popupHtml = `<div class="ais-pop"><b>${name || 'Ukjent'}</b>
    <div class="r"><span>MMSI</span><span>${mmsi}</span></div>
    <div class="r"><span>Fart</span><span>${speed ? speed.toFixed(1) + ' kn' : '--'}</span></div>
    <div class="r"><span>Kurs</span><span>${course ? Math.round(course) + '°' : '--'}</span></div></div>`

  if (aisMarkers[mmsi]) {
    aisMarkers[mmsi].marker.setLngLat([lon, lat])
    aisMarkers[mmsi].el.innerHTML = makeAisEl(heading).innerHTML
    aisMarkers[mmsi].popup.setHTML(popupHtml)
  } else {
    const el    = makeAisEl(heading)
    const popup = new maplibregl.Popup({ className: 'ais-popup', closeButton: true, maxWidth: '220px' })
      .setHTML(popupHtml)
    const marker = new maplibregl.Marker({ element: el, anchor: 'center' })
      .setLngLat([lon, lat])
      .setPopup(popup)
      .addTo(map)
    aisMarkers[mmsi] = { marker, el, popup }
  }
}

export function removeAisTarget(mmsi) {
  if (aisMarkers[mmsi]) {
    aisMarkers[mmsi].marker.remove()
    delete aisMarkers[mmsi]
  }
}

export function setAisRisk(mmsi, risk) {
  const entry = aisMarkers[mmsi]
  if (!entry) return
  entry.el.classList.remove('ais-warn', 'ais-critical')
  if (risk === 'warning')  entry.el.classList.add('ais-warn')
  if (risk === 'critical') entry.el.classList.add('ais-critical')
}

export function setAisVisible(visible) {
  Object.values(aisMarkers).forEach(({ marker }) => {
    const el = marker.getElement()
    el.style.display = visible ? '' : 'none'
  })
}
