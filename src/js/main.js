import 'leaflet/dist/leaflet.css'
import '../css/main.css'
import L from 'leaflet'

import { initMap, getMap, updateBoatPosition, centerOnBoat, setSeamarkVisible, setAisVisible, setBaseLayer, setAisRisk } from './map.js'
import { startGPS, getLastPosition, msToKnots } from './gps.js'
import { scheduleWeatherUpdates, degToCompass } from './weather.js'
import { nearestStation, fetchTide, formatTideTable } from './tide.js'
import { startAIS, pauseAIS, resumeAIS, setAisStatusCallback } from './ais.js'
import { startBarentswatch, stopBarentswatch, setBwStatusCallback } from './barentswatch.js'
import { scheduleOceanUpdates } from './ocean.js'
import { scheduleAlertChecks, formatAlertTime } from './metalerts.js'
import { querySeamarks, buildSeamarkPopup } from './seamark.js'
import { lookupDepth, setDepthAlarm, clearDepthAlarm } from './depth.js'
import { updateOwnState, setCpaCallback, startCpaLoop } from './cpa.js'
import { initRoute, togglePlanningMode, isPlanningMode, clearRoute, getRouteStats } from './route.js'

// ===== State =====
let nightMode      = false
let showingPanel   = null
let lastWeather    = null
let lastPosition   = null
let lastSpeedKnots = 0
let seamarkPopup   = null
let depthLookupTimer = null
let activeAlerts   = []

// ===== Init =====
const map = initMap()
initRoute(map, onRouteUpdate)

// ===== GPS =====
let firstFix = true
startGPS((pos) => {
  lastPosition   = pos
  updateBoatPosition(pos.lat, pos.lon, pos.heading ?? 0)

  const knots    = msToKnots(pos.speed) ?? 0
  lastSpeedKnots = knots
  setInstrument('val-speed',  knots > 0 ? knots.toFixed(1) : '--')
  setInstrument('val-course', pos.heading !== null ? Math.round(pos.heading) + '°' : '---')

  updateOwnState(pos.lat, pos.lon, knots, pos.heading ?? 0)
  updateTideInstrument(pos.lat, pos.lon)
  scheduleDepthLookup(pos.lat, pos.lon)
  refreshRouteStats()

  // Første GPS-fix: hent vær, hav og varsler umiddelbart
  if (firstFix) {
    firstFix = false
    fetchWeatherNow()
    fetchOceanNow()
    fetchAlertsNow()
  }
})

// ===== Yr.no vær =====
const fetchWeatherNow = scheduleWeatherUpdates(
  () => lastPosition,
  (data) => { lastWeather = data; updateWeatherUI(data) }
)

// ===== MET Oceanforecast =====
const fetchOceanNow = scheduleOceanUpdates(
  () => lastPosition,
  (data) => updateOceanUI(data)
)

// ===== MetAlerts =====
const fetchAlertsNow = scheduleAlertChecks(
  () => lastPosition,
  (alerts) => { activeAlerts = alerts; updateAlertBanner(alerts) }
)

// ===== AIS — aisstream.io =====
setAisStatusCallback((state, text) => {
  const icon  = document.getElementById('ais-icon')
  const label = document.getElementById('ais-text')
  if (icon)  icon.className = state
  if (label) label.textContent = text
})

// ===== AIS — BarentsWatch =====
setBwStatusCallback((state, text) => {
  const icon  = document.getElementById('bw-icon')
  const label = document.getElementById('bw-text')
  if (icon)  icon.className = state
  if (label) label.textContent = text
})

setTimeout(() => {
  const pos    = getLastPosition()
  const center = pos || { lat: 59.44, lon: 10.6 }
  startAIS(center.lat, center.lon, 0.5)
  startBarentswatch(center.lat, center.lon, 0.5)
}, 2000)

// ===== CPA =====
startCpaLoop()
setCpaCallback(onCpaUpdate)

function onCpaUpdate(results) {
  let worstRisk = 'none', worstCpaNm = null, worstTcpaMin = null
  for (const [mmsi, r] of Object.entries(results)) {
    setAisRisk(mmsi, r.risk)
    if (r.risk === 'critical' || (r.risk === 'warning' && worstRisk !== 'critical')) {
      worstRisk = r.risk; worstCpaNm = r.cpaNm.toFixed(2); worstTcpaMin = r.tcpaMin.toFixed(1)
    }
  }
  const banner = document.getElementById('cpa-banner')
  if (worstRisk !== 'none') {
    banner.className = worstRisk === 'critical' ? 'critical' : ''
    document.getElementById('cpa-banner-text').textContent =
      `⚠️ KOLLISJONSKURS  CPA ${worstCpaNm} nm / ${worstTcpaMin} min`
    banner.classList.remove('hidden')
  } else {
    banner.classList.add('hidden')
  }
}

// ===== Seamark click =====
map.on('click', async (e) => {
  if (isPlanningMode()) return
  hideAllPanels()
  const seamarkCheck = document.getElementById('layer-seamark')
  if (!seamarkCheck?.checked) return
  const { lat, lng } = e.latlng
  const elements = await querySeamarks(lat, lng, 80)
  const html     = buildSeamarkPopup(elements)
  if (!html) return
  if (seamarkPopup) seamarkPopup.remove()
  seamarkPopup = L.popup({ className: 'seamark-popup', maxWidth: 240 })
    .setLatLng(e.latlng).setContent(html).openOn(map)
})

// ===== Depth =====
function scheduleDepthLookup(lat, lon) {
  if (depthLookupTimer) return
  depthLookupTimer = setTimeout(async () => {
    depthLookupTimer = null
    const depth = await lookupDepth(lat, lon)
    if (depth !== null) setInstrument('val-depth-live', depth.toFixed(0))
  }, 30000)
}
function onDepthAlarm(depth, threshold) {
  const banner = document.getElementById('depth-alarm-banner')
  document.getElementById('alarm-depth-val').textContent = depth.toFixed(1)
  banner.classList.remove('hidden')
  if (navigator.vibrate) navigator.vibrate([300, 100, 300, 100, 300])
  setTimeout(() => banner.classList.add('hidden'), 8000)
  document.getElementById('depth-alarm-status').textContent = `⚠️ Alarm — ${depth.toFixed(1)} m < ${threshold} m`
  document.getElementById('depth-alarm-status').className = 'depth-status alarm'
}

// ===== Route =====
function onRouteUpdate(wpCount) {
  refreshRouteStats()
  if (wpCount >= 2) document.getElementById('route-stats').classList.remove('hidden')
}
function refreshRouteStats() {
  const stats = getRouteStats(lastSpeedKnots)
  if (!stats) return
  setInstrument('route-wp-count',  stats.waypointCount)
  setInstrument('route-total-nm',  stats.totalNm.toFixed(1) + ' nm')
  if (stats.etaHours !== null && lastSpeedKnots > 0.3) {
    const h = Math.floor(stats.etaHours)
    const m = Math.round((stats.etaHours - h) * 60)
    setInstrument('route-eta', h > 0 ? `${h}t ${m}min` : `${m} min`)
  } else {
    setInstrument('route-eta', '-- (ingen fart)')
  }
  document.getElementById('route-legs').innerHTML = stats.legs.map(leg =>
    `<div class="route-leg"><span>WP${leg.from} → WP${leg.to}</span><span>${leg.distNm.toFixed(2)} nm</span></div>`
  ).join('')
}

// ===== Windy =====
function openWindy(lat, lon) {
  const iframe = document.getElementById('windy-iframe')
  iframe.src = `https://embed.windy.com/embed2.html?lat=${lat.toFixed(3)}&lon=${lon.toFixed(3)}&zoom=${map.getZoom()}&level=surface&overlay=wind&product=ecmwf&menu=&message=&marker=&calendar=now&pressure=&type=map&location=coordinates&detail=&metricWind=m%2Fs&metricTemp=%C2%B0C&radarRange=-1`
}

// ===== Helpers =====
function setInstrument(id, value) {
  const el = document.getElementById(id)
  if (el) el.textContent = value
}

function msToKnots2(ms) { return ms !== null ? (ms * 1.94384) : null }

// ===== Weather UI =====
function updateWeatherUI(data) {
  setInstrument('val-wind',    data.windSpeed !== null ? data.windSpeed.toFixed(1) : '--')
  const arrow = document.getElementById('wind-arrow')
  if (arrow && data.windDir !== null) arrow.style.transform = `rotate(${data.windDir}deg)`
  setInstrument('val-winddir', degToCompass(data.windDir))

  document.getElementById('wx-wind').textContent     = data.windSpeed !== null ? `${data.windSpeed.toFixed(1)} m/s` : '--'
  document.getElementById('wx-gust').textContent     = data.windGust  !== null ? `${data.windGust.toFixed(1)} m/s`  : '--'
  document.getElementById('wx-dir').textContent      = `${degToCompass(data.windDir)} (${Math.round(data.windDir ?? 0)}°)`
  document.getElementById('wx-temp').textContent     = data.temp     !== null ? `${data.temp.toFixed(1)} °C`     : '--'
  document.getElementById('wx-pressure').textContent = data.pressure !== null ? `${Math.round(data.pressure)} hPa` : '--'
  document.getElementById('wx-updated').textContent  =
    new Date(data.fetchedAt).toLocaleTimeString('no-NO', { hour: '2-digit', minute: '2-digit' })
}

// ===== Ocean UI =====
function updateOceanUI(data) {
  // Instrumentpanel
  setInstrument('val-wave',    data.waveHeight   !== null ? data.waveHeight.toFixed(1)   : '--')
  const currentKn = data.currentSpeed !== null ? (data.currentSpeed * 1.94384).toFixed(1) : '--'
  setInstrument('val-current', currentKn)
  setInstrument('val-temp',    data.seaTemp      !== null ? data.seaTemp.toFixed(1)      : '--')

  // Vær-panel hav-seksjon
  document.getElementById('wx-wave-height').textContent  = data.waveHeight   !== null ? `${data.waveHeight.toFixed(1)} m`  : '--'
  document.getElementById('wx-wave-period').textContent  = data.wavePeriod   !== null ? `${data.wavePeriod.toFixed(0)} s`  : '--'
  document.getElementById('wx-wave-dir').textContent     = data.waveDirection !== null ? `${degToCompass(data.waveDirection)} (${Math.round(data.waveDirection)}°)` : '--'
  document.getElementById('wx-current-speed').textContent = data.currentSpeed !== null ? `${(data.currentSpeed * 1.94384).toFixed(2)} kn` : '--'
  document.getElementById('wx-current-dir').textContent  = data.currentDir   !== null ? `${degToCompass(data.currentDir)} (${Math.round(data.currentDir)}°)` : '--'
  document.getElementById('wx-sea-temp').textContent     = data.seaTemp      !== null ? `${data.seaTemp.toFixed(1)} °C`   : '--'
}

// ===== MetAlerts UI =====
function updateAlertBanner(alerts) {
  const banner = document.getElementById('alert-banner')
  if (!alerts || alerts.length === 0) { banner.classList.add('hidden'); return }

  const top = alerts[0]
  banner.className = top.severity === 'Extreme' ? 'extreme' : top.severity === 'Severe' ? 'severe' : ''
  document.getElementById('alert-text').textContent = `${top.label}: ${top.title}`
  banner.classList.remove('hidden')

  // Oppdater detalj-panel
  document.getElementById('alert-list').innerHTML = alerts.map(a => `
    <div class="alert-item">
      <span class="alert-severity" style="background:${a.color};color:#fff">${a.label}</span>
      <div class="alert-title">${a.title}</div>
      <div class="alert-desc">${a.description || ''}</div>
      ${a.instruction ? `<div class="alert-desc"><b>Handling:</b> ${a.instruction}</div>` : ''}
      <div class="alert-time">${formatAlertTime(a.from)} – ${formatAlertTime(a.to)}</div>
    </div>`).join('')
}

// ===== Tide UI =====
let lastTideStation = null, tideUpdateTimer = null

async function updateTideInstrument(lat, lon) {
  const station = nearestStation(lat, lon)
  if (!station) return
  if (lastTideStation === station.id && tideUpdateTimer) return
  lastTideStation = station.id

  const fetchAndUpdate = async () => {
    const data = await fetchTide(station.id)
    if (!data) return
    setInstrument('val-tide', data.currentLevel !== null ? Math.round(data.currentLevel) : '--')
    document.getElementById('tide-station').textContent  = `Stasjon: ${station.name}`
    document.getElementById('tide-table').innerHTML      = formatTideTable(data.highLows)
  }
  await fetchAndUpdate()
  if (tideUpdateTimer) clearInterval(tideUpdateTimer)
  tideUpdateTimer = setInterval(fetchAndUpdate, 30 * 60 * 1000)
}

// ===== Panel management =====
const PANELS = ['weather', 'tide', 'layer', 'depth', 'windy', 'route', 'alert']

function showPanel(name) {
  PANELS.forEach(p => document.getElementById(p + '-panel').classList.add('hidden'))
  if (showingPanel === name) { showingPanel = null; return }
  showingPanel = name
  document.getElementById(name + '-panel').classList.remove('hidden')
}

function hideAllPanels() {
  showingPanel = null
  PANELS.forEach(p => document.getElementById(p + '-panel').classList.add('hidden'))
}

// ===== Buttons =====
document.getElementById('btn-center').addEventListener('click', () => {
  const pos = getLastPosition()
  if (pos) centerOnBoat(pos.lat, pos.lon)
})
document.getElementById('btn-night').addEventListener('click', () => {
  nightMode = !nightMode
  document.body.classList.toggle('night-mode', nightMode)
  document.getElementById('btn-night').textContent = nightMode ? '☀️' : '🔴'
})
document.getElementById('btn-layers').addEventListener('click', () => showPanel('layer'))
document.getElementById('btn-windy').addEventListener('click', () => {
  showPanel('windy')
  if (showingPanel === 'windy') {
    const pos = getLastPosition() || { lat: 59.44, lon: 10.6 }
    openWindy(pos.lat, pos.lon)
  }
})
document.getElementById('btn-depth').addEventListener('click', () => showPanel('depth'))
document.getElementById('btn-route').addEventListener('click', () => showPanel('route'))

document.getElementById('inst-wind').addEventListener('click',    () => showPanel('weather'))
document.getElementById('inst-winddir').addEventListener('click', () => showPanel('weather'))
document.getElementById('inst-wave').addEventListener('click',    () => showPanel('weather'))
document.getElementById('inst-current').addEventListener('click', () => showPanel('weather'))
document.getElementById('inst-temp').addEventListener('click',    () => showPanel('weather'))
document.getElementById('inst-tide').addEventListener('click',    () => showPanel('tide'))

document.getElementById('btn-close-weather').addEventListener('click', hideAllPanels)
document.getElementById('btn-close-tide').addEventListener('click',    hideAllPanels)
document.getElementById('btn-close-layers').addEventListener('click',  hideAllPanels)
document.getElementById('btn-close-depth').addEventListener('click',   hideAllPanels)
document.getElementById('btn-close-route').addEventListener('click',   hideAllPanels)
document.getElementById('btn-close-alert').addEventListener('click',   hideAllPanels)
document.getElementById('btn-close-windy').addEventListener('click', () => {
  hideAllPanels()
  document.getElementById('windy-iframe').src = ''
})

// Alert-banner knapper
document.getElementById('btn-alert-details').addEventListener('click', () => showPanel('alert'))
document.getElementById('btn-alert-close').addEventListener('click', () => {
  document.getElementById('alert-banner').classList.add('hidden')
})

// Base layer radios
document.querySelectorAll('input[name="baselayer"]').forEach(radio => {
  radio.addEventListener('change', (e) => { if (e.target.checked) setBaseLayer(e.target.value) })
})

// Overlay toggles
document.getElementById('layer-seamark').addEventListener('change', (e) => setSeamarkVisible(e.target.checked))
document.getElementById('layer-ais').addEventListener('change', (e) => {
  setAisVisible(e.target.checked)
  if (e.target.checked) resumeAIS(); else pauseAIS()
})

// Depth alarm
document.getElementById('depth-alarm-enabled').addEventListener('change', (e) => {
  const btn = document.getElementById('btn-depth')
  if (e.target.checked) {
    const threshold = parseFloat(document.getElementById('depth-threshold').value) || 5
    setDepthAlarm(threshold, onDepthAlarm)
    document.getElementById('depth-alarm-status').textContent = `Alarm aktiv under ${threshold} m`
    document.getElementById('depth-alarm-status').className = 'depth-status'
    btn.classList.add('active')
  } else {
    clearDepthAlarm()
    document.getElementById('depth-alarm-status').textContent = ''
    btn.classList.remove('active')
  }
})
document.getElementById('depth-threshold').addEventListener('change', () => {
  if (document.getElementById('depth-alarm-enabled').checked) {
    const threshold = parseFloat(document.getElementById('depth-threshold').value) || 5
    setDepthAlarm(threshold, onDepthAlarm)
    document.getElementById('depth-alarm-status').textContent = `Alarm aktiv under ${threshold} m`
  }
})

// Route planner
document.getElementById('btn-route-toggle').addEventListener('click', () => {
  const active  = togglePlanningMode()
  const btn     = document.getElementById('btn-route-toggle')
  const ind     = document.getElementById('route-mode-indicator')
  const routeBtn = document.getElementById('btn-route')
  btn.textContent = active ? 'Deaktiver planlegging' : 'Aktiver planlegging'
  btn.classList.toggle('active', active)
  routeBtn.classList.toggle('active', active)
  ind.className = active ? 'route-mode-on' : 'route-mode-off'
  ind.innerHTML = active
    ? '✅ Klikk på kartet for å legge til waypoints.<br>Dobbeltklikk på waypoint for å slette.'
    : 'Trykk <b>Aktiver</b> og klikk på kartet for å legge til waypoints.<br>Dobbeltklikk på waypoint for å slette det.'
})
document.getElementById('btn-route-clear').addEventListener('click', () => {
  clearRoute()
  document.getElementById('route-stats').classList.add('hidden')
  setInstrument('route-wp-count', '0')
  setInstrument('route-total-nm', '-- nm')
  setInstrument('route-eta', '--')
  document.getElementById('route-legs').innerHTML = ''
})

// ===== Demo mode =====
setTimeout(() => {
  if (!getLastPosition()) {
    const demoPos = { lat: 59.44, lon: 10.6, accuracy: 999, speed: 3.2, heading: 135 }
    lastPosition   = demoPos
    lastSpeedKnots = msToKnots(3.2)
    updateBoatPosition(demoPos.lat, demoPos.lon, demoPos.heading)
    setInstrument('val-speed',  '3.2')
    setInstrument('val-course', '135°')
    updateTideInstrument(demoPos.lat, demoPos.lon)
    document.getElementById('gps-accuracy').textContent = 'Demo-modus'
    // Hent vær, hav og varsler for demo-posisjon
    firstFix = false
    fetchWeatherNow()
    fetchOceanNow()
    fetchAlertsNow()
  }
}, 8000)
