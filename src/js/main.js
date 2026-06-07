import 'leaflet/dist/leaflet.css'
import '../css/main.css'
import L from 'leaflet'

import { initMap, getMap, updateBoatPosition, centerOnBoat, setSeamarkVisible, setAisVisible,
         setBaseLayer, setAisRisk, setMapFilter, setMapNight } from './map.js'
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
let showingPanel   = null
let lastWeather    = null
let lastPosition   = null
let lastSpeedKnots = 0
let seamarkPopup   = null
let depthLookupTimer = null
let activeAlerts   = []
let nightMode      = false

// Filter state (synced with tweaks panel)
let mapFilter = { grayscale: 0, sepia: 0, brightness: 1, contrast: 1, hue: 0, saturate: 1, invert: 0 }

// ===== Init =====
const map = initMap()
initRoute(map, onRouteUpdate)

// ===== GPS =====
let firstFix = true
startGPS((pos) => {
  lastPosition   = pos
  updateBoatPosition(pos.lat, pos.lon, pos.heading ?? 0)

  const knots = msToKnots(pos.speed) ?? 0
  lastSpeedKnots = knots
  setEl('v-spd',  knots > 0.2 ? knots.toFixed(1) : '--')
  setEl('v-crs',  pos.heading !== null ? Math.round(pos.heading).toString().padStart(3,'0') : '---')

  updateOwnState(pos.lat, pos.lon, knots, pos.heading ?? 0)
  updateTideInstrument(pos.lat, pos.lon)
  scheduleDepthLookup(pos.lat, pos.lon)
  refreshRouteStats()

  // GPS chip
  const dot = document.getElementById('gps-dot')
  const acc = document.getElementById('gps-acc')
  if (dot) { dot.className = 'dot ok'; }
  if (acc && pos.accuracy) acc.textContent = '±' + Math.round(pos.accuracy) + ' m'

  if (firstFix) {
    firstFix = false
    fetchWeatherNow()
    fetchOceanNow()
    fetchAlertsNow()
  }
})

// ===== Weather =====
const fetchWeatherNow = scheduleWeatherUpdates(
  () => lastPosition,
  (data) => { lastWeather = data; updateWeatherUI(data) }
)

// ===== Oceanforecast =====
const fetchOceanNow = scheduleOceanUpdates(
  () => lastPosition,
  (data) => updateOceanUI(data)
)

// ===== MetAlerts =====
const fetchAlertsNow = scheduleAlertChecks(
  () => lastPosition,
  (alerts) => { activeAlerts = alerts; updateAlertPanel(alerts) }
)

// ===== AIS — aisstream =====
let aisCount = 0
setAisStatusCallback((state, text) => {
  const dot   = document.getElementById('ais-dot')
  const count = document.getElementById('ais-count')
  if (dot) dot.className = state === 'connected' ? 'dot live' : state === 'error' ? 'dot warn' : 'dot'
  // parse count from text like "7 mål" or "3 targets"
  const m = text?.match(/\d+/)
  if (count && m) { aisCount = parseInt(m[0]); count.textContent = aisCount }
})

// ===== AIS — BarentsWatch =====
setBwStatusCallback((state, text) => {
  // merge BW status into AIS chip
  const dot = document.getElementById('ais-dot')
  if (state === 'ok' && dot) dot.className = 'dot live'
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
  let worstRisk = 'none', worstCpaNm = null, worstTcpaMin = null, worstName = ''
  for (const [mmsi, r] of Object.entries(results)) {
    setAisRisk(mmsi, r.risk)
    if (r.risk === 'critical' || (r.risk === 'warning' && worstRisk !== 'critical')) {
      worstRisk = r.risk; worstCpaNm = r.cpaNm; worstTcpaMin = r.tcpaMin; worstName = r.name || mmsi
    }
  }
  const banner = document.getElementById('banner-cpa')
  if (!banner) return
  if (worstRisk !== 'none') {
    banner.classList.add('show')
    banner.classList.toggle('critical', worstRisk === 'critical')
    setEl('banner-cpa-text', `${worstName} · CPA ${worstCpaNm?.toFixed(2)} nm om ${Math.round(worstTcpaMin)} min`)
  } else {
    banner.classList.remove('show', 'critical')
  }
}

// ===== Seamark click =====
map.on('click', async (e) => {
  if (isPlanningMode()) return
  closePanels()
  const seaCheck = document.getElementById('ov-seamark')
  if (!seaCheck?.checked) return
  const { lat, lng } = e.latlng
  const elements = await querySeamarks(lat, lng, 80)
  const html = buildSeamarkPopup(elements)
  if (!html) return
  if (seamarkPopup) seamarkPopup.remove()
  seamarkPopup = L.popup({ maxWidth: 240 }).setLatLng(e.lngLat).setContent(html).openOn(map)
})

// ===== Depth =====
function scheduleDepthLookup(lat, lon) {
  if (depthLookupTimer) return
  depthLookupTimer = setTimeout(async () => {
    depthLookupTimer = null
    const depth = await lookupDepth(lat, lon)
    if (depth !== null) {
      setEl('v-depth', depth.toFixed(0))
      setEl('depth-live', depth.toFixed(1))
    }
  }, 30000)
}

function onDepthAlarm(depth, threshold) {
  const banner = document.getElementById('banner-depth')
  setEl('banner-depth-v', depth.toFixed(1))
  if (banner) banner.classList.add('show')
  document.getElementById('depth-big')?.classList.add('alarm')
  if (navigator.vibrate) navigator.vibrate([300, 100, 300, 100, 300])
  setTimeout(() => { banner?.classList.remove('show'); document.getElementById('depth-big')?.classList.remove('alarm') }, 8000)
}

// ===== Route =====
function onRouteUpdate(wpCount) {
  refreshRouteStats()
  if (wpCount >= 2) {
    const el = document.getElementById('route-stats')
    if (el) el.style.display = 'block'
  }
}

function refreshRouteStats() {
  const windDir   = lastWeather?.windDir ?? null
  const windKnots = lastWeather ? lastWeather.windSpeed * 1.94384 : null
  const stats     = getRouteStats(lastSpeedKnots, windDir, windKnots)
  if (!stats) return

  setEl('r-wp', stats.waypointCount)
  document.getElementById('r-dist').innerHTML = stats.totalNm.toFixed(2) + ' <span class="u">nm</span>'

  const windRow = document.getElementById('r-wind-row')
  if (stats.etaHours !== null) {
    setEl('r-eta', fmtMin(stats.etaHours * 60))
    if (windRow) windRow.style.display = stats.windAnalysis ? '' : 'none'
  } else {
    setEl('r-eta', '—')
    if (windRow) windRow.style.display = 'none'
  }

  // Polar type → CSS tag class
  const typeClass = { upwind: 'pt-kryss', close: 'pt-slor', reaching: 'pt-slor', downwind: 'pt-laens' }

  document.getElementById('route-legs').innerHTML = stats.legs.map(leg => {
    const w = leg.wind
    if (w) {
      const cls = typeClass[w.type] || 'pt-platt'
      const etaTxt = w.etaHours !== null ? fmtMin(w.etaHours * 60) : '--'
      const spd    = w.speed ? w.speed.toFixed(1) + ' kn' : '--'
      const side   = w.twaSide === 'stb' ? 'styrbord' : 'babord'
      return `<div class="route-leg" style="border-left-color:${w.color}">
        <div class="lh"><span class="lt">WP${leg.from} → WP${leg.to}</span><span class="ld">${leg.distNm.toFixed(2)} nm</span></div>
        <span class="pt-tag ${cls}">${w.label}</span>
        <div class="det">TWA ${Math.round(w.twa)}° (${side}) · ${spd} · ${Math.round(leg.bearing)}° · ${etaTxt}</div>
        <div class="adv">${w.advice}</div>
      </div>`
    }
    return `<div class="route-leg">
      <div class="lh"><span class="lt">WP${leg.from} → WP${leg.to}</span><span class="ld">${leg.distNm.toFixed(2)} nm</span></div>
      <div class="det">${Math.round(leg.bearing)}°</div>
    </div>`
  }).join('')
}

function fmtMin(m) {
  if (m < 60) return Math.round(m) + ' min'
  return Math.floor(m / 60) + ' t ' + Math.round(m % 60) + ' min'
}

// ===== Weather UI =====
function updateWeatherUI(data) {
  setEl('v-wind', data.windSpeed !== null ? data.windSpeed.toFixed(1) : '--')
  const arrow = document.getElementById('wind-arrow')
  if (arrow && data.windDir !== null) arrow.style.transform = `rotate(${data.windDir}deg)`

  document.getElementById('wx-wind').innerHTML     = data.windSpeed !== null ? `${data.windSpeed.toFixed(1)} <span class="u">m/s</span>` : '—'
  document.getElementById('wx-gust').innerHTML     = data.windGust  !== null ? `${data.windGust.toFixed(1)} <span class="u">m/s</span>` : '—'
  document.getElementById('wx-dir').textContent    = `${degToCompass(data.windDir)} · ${Math.round(data.windDir ?? 0)}°`
  document.getElementById('wx-temp').innerHTML     = data.temp     !== null ? `${data.temp.toFixed(1)} <span class="u">°C</span>` : '—'
  document.getElementById('wx-pressure').innerHTML = data.pressure !== null ? `${Math.round(data.pressure)} <span class="u">hPa</span>` : '—'
  document.getElementById('wx-updated').textContent =
    new Date(data.fetchedAt).toLocaleTimeString('no-NO', { hour: '2-digit', minute: '2-digit' })
}

// ===== Ocean UI =====
function updateOceanUI(data) {
  setEl('v-wave', data.waveHeight  !== null ? data.waveHeight.toFixed(1) : '--')
  const curKn = data.currentSpeed !== null ? (data.currentSpeed * 1.94384).toFixed(1) : '--'
  setEl('v-cur',  curKn)
  setEl('v-temp', data.seaTemp !== null ? data.seaTemp.toFixed(1) : '--')

  document.getElementById('wx-wave-height').innerHTML  = data.waveHeight   !== null ? `${data.waveHeight.toFixed(1)} <span class="u">m</span>` : '—'
  document.getElementById('wx-wave-period').innerHTML  = data.wavePeriod   !== null ? `${data.wavePeriod.toFixed(0)} <span class="u">s</span>` : '—'
  document.getElementById('wx-wave-dir').textContent   = data.waveDirection !== null ? `${degToCompass(data.waveDirection)} · ${Math.round(data.waveDirection)}°` : '—'
  document.getElementById('wx-current-speed').innerHTML = data.currentSpeed !== null ? `${(data.currentSpeed * 1.94384).toFixed(2)} <span class="u">kn</span>` : '—'
  document.getElementById('wx-current-dir').textContent = data.currentDir   !== null ? `${degToCompass(data.currentDir)} · ${Math.round(data.currentDir)}°` : '—'
  document.getElementById('wx-sea-temp').innerHTML     = data.seaTemp      !== null ? `${data.seaTemp.toFixed(1)} <span class="u">°C</span>` : '—'
}

// ===== Alerts UI =====
function updateAlertPanel(alerts) {
  const body   = document.getElementById('alerts-body')
  const toolBtn = document.getElementById('tool-alerts')
  if (!body) return

  if (!alerts || alerts.length === 0) {
    body.innerHTML = '<div class="row"><span class="k" style="color:var(--c-text-mute)">Ingen aktive farevarsler</span></div>'
    if (toolBtn) toolBtn.classList.remove('active')
    return
  }

  // Badge on tool button
  if (toolBtn) toolBtn.classList.add('active')

  const sevClass = { Extreme: 'red', Severe: 'orange', Moderate: 'yellow', Minor: 'yellow' }
  body.innerHTML = alerts.map(a => `
    <div class="alert-item">
      <span class="sev ${sevClass[a.severity] || 'yellow'}">${a.label}</span>
      <div class="at">${a.title}</div>
      <div class="ad">${a.description || ''}</div>
      ${a.instruction ? `<div class="ad"><b>Handling:</b> ${a.instruction}</div>` : ''}
      <div class="atm">${formatAlertTime(a.from)} – ${formatAlertTime(a.to)}</div>
    </div>`).join('')
}

// ===== Tide UI =====
let lastTideStation = null, tideUpdateTimer = null

async function updateTideInstrument(lat, lon) {
  const station = nearestStation(lat, lon)
  if (!station) return
  if (lastTideStation === station.id && tideUpdateTimer) return
  lastTideStation = station.id

  setEl('tide-station', `Stasjon · ${station.name}`)

  const fetchAndUpdate = async () => {
    const data = await fetchTide(station.id)
    if (!data) return
    setEl('v-tide', data.currentLevel !== null ? Math.round(data.currentLevel) : '—')
    document.getElementById('tide-table').innerHTML = formatTideTable(data.highLows)
  }
  await fetchAndUpdate()
  if (tideUpdateTimer) clearInterval(tideUpdateTimer)
  tideUpdateTimer = setInterval(fetchAndUpdate, 30 * 60 * 1000)
}

// ===== Map filter / tweaks bridge =====
function buildFilterStr(f) {
  return `grayscale(${f.grayscale}) sepia(${f.sepia}) brightness(${f.brightness}) ` +
         `contrast(${f.contrast}) hue-rotate(${f.hue}deg) saturate(${f.saturate}) invert(${f.invert})`
}

window.SeilNav = {
  applyTweaks(v) {
    if (!v) return
    if (v.accent) document.documentElement.style.setProperty('--accent', v.accent)
    const lf = v.labelFont === 'mono'
      ? "'JetBrains Mono', ui-monospace, monospace"
      : "'Saira Semi Condensed', system-ui, sans-serif"
    document.documentElement.style.setProperty('--font-label', lf)
    if (v.touch) document.documentElement.style.setProperty('--touch', v.touch + 'px')
    ;['grayscale','sepia','brightness','contrast','hue','saturate','invert'].forEach(k => {
      if (typeof v[k] === 'number') mapFilter[k] = v[k]
    })
    try { localStorage.setItem('seilnav.filter', JSON.stringify(mapFilter)) } catch(e) {}
    if (!nightMode) setMapFilter(buildFilterStr(mapFilter))
  }
}

// ===== Panel management =====
const PANELS = ['layers', 'route', 'weather', 'depth', 'tide', 'alerts']

function openPanel(name) {
  PANELS.forEach(p => {
    const el = document.getElementById('panel-' + p)
    if (el) el.classList.toggle('open', p === name)
  })
  document.querySelectorAll('.tool[data-tool]').forEach(t => {
    const isPanel = PANELS.includes(t.dataset.tool)
    if (isPanel) t.classList.toggle('active', t.dataset.tool === name)
  })
  showingPanel = name
}

function closePanels() {
  PANELS.forEach(p => { document.getElementById('panel-' + p)?.classList.remove('open') })
  document.querySelectorAll('.tool[data-tool]').forEach(t => {
    if (PANELS.includes(t.dataset.tool) && t.dataset.tool !== 'alerts') t.classList.remove('active')
  })
  showingPanel = null
}

// ===== Tool dock wiring =====
document.querySelectorAll('.tool[data-tool]').forEach(btn => {
  btn.addEventListener('click', () => {
    const t = btn.dataset.tool

    if (t === 'center') {
      const pos = getLastPosition()
      if (pos) centerOnBoat(pos.lat, pos.lon)
      btn.classList.add('active')
      setTimeout(() => btn.classList.remove('active'), 500)
      return
    }

    if (t === 'night') {
      nightMode = !nightMode
      document.body.classList.toggle('night', nightMode)
      btn.classList.toggle('active', nightMode)
      setMapNight(nightMode)
      return
    }

    if (t === 'tweaks') {
      window.dispatchEvent(new MessageEvent('message', { data: { type: '__activate_edit_mode' } }))
      btn.classList.toggle('active')
      return
    }

    // Panel toggle
    if (showingPanel === t) { closePanels() } else { openPanel(t) }
  })
})

// Close via [data-close] attribute
document.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', closePanels))

// Instrument → open panel on click
document.querySelectorAll('.inst[data-open]').forEach(el => {
  el.addEventListener('click', () => openPanel(el.dataset.open))
})

// Dash expand (phone)
document.getElementById('dash-grip').addEventListener('click', () => {
  const dash = document.getElementById('dash')
  const lbl  = document.getElementById('grip-lbl')
  dash.classList.toggle('expanded')
  if (lbl) lbl.textContent = dash.classList.contains('expanded') ? 'Mindre' : 'Mer'
})

// Zoom buttons
document.getElementById('zin').addEventListener('click', () => map.zoomIn())
document.getElementById('zout').addEventListener('click', () => map.zoomOut())

// Layer radios
document.querySelectorAll('input[name="base"]').forEach(r =>
  r.addEventListener('change', () => { if (r.checked) setBaseLayer(r.value) })
)
document.getElementById('ov-seamark').addEventListener('change', e => setSeamarkVisible(e.target.checked))
document.getElementById('ov-ais').addEventListener('change', e => {
  setAisVisible(e.target.checked)
  if (e.target.checked) resumeAIS(); else pauseAIS()
})

// Route planner
document.getElementById('route-toggle').addEventListener('click', () => {
  const active = togglePlanningMode()
  const btn    = document.getElementById('route-toggle')
  const hint   = document.getElementById('route-hint')
  btn.textContent = active ? 'Stopp planlegging' : 'Aktiver planlegging'
  btn.classList.toggle('on', active)
  if (hint) hint.innerHTML = active
    ? 'Planlegging <b>aktiv</b> — klikk i kartet. Dra for å flytte, dobbeltklikk for å fjerne.'
    : 'Trykk <b>Aktiver</b> og klikk i kartet for å legge til waypoints. Dobbeltklikk for å fjerne.'
})
document.getElementById('route-clear').addEventListener('click', () => {
  clearRoute()
  const stats = document.getElementById('route-stats')
  if (stats) stats.style.display = 'none'
  setEl('route-legs', '')
})

// Depth panel
document.getElementById('depth-thr').addEventListener('input', () => updateDepthThreshold())
document.getElementById('depth-minus').addEventListener('click', () => {
  const inp = document.getElementById('depth-thr')
  inp.value = Math.max(1, (+inp.value) - 1)
  updateDepthThreshold()
})
document.getElementById('depth-plus').addEventListener('click', () => {
  const inp = document.getElementById('depth-thr')
  inp.value = Math.min(50, (+inp.value) + 1)
  updateDepthThreshold()
})
document.getElementById('depth-en').addEventListener('change', (e) => {
  if (e.target.checked) {
    const thr = parseFloat(document.getElementById('depth-thr').value) || 5
    setDepthAlarm(thr, onDepthAlarm)
    document.querySelector('[data-tool="depth"]')?.classList.add('active')
  } else {
    clearDepthAlarm()
    if (showingPanel !== 'depth') document.querySelector('[data-tool="depth"]')?.classList.remove('active')
  }
})
function updateDepthThreshold() {
  if (document.getElementById('depth-en').checked) {
    const thr = parseFloat(document.getElementById('depth-thr').value) || 5
    setDepthAlarm(thr, onDepthAlarm)
  }
}

// ===== Helpers =====
function setEl(id, val) {
  const el = document.getElementById(id)
  if (el) el.textContent = val
}

// ===== Demo mode =====
setTimeout(() => {
  if (!getLastPosition()) {
    const demoPos = { lat: 59.9035, lon: 10.728, accuracy: 25, speed: 2.6, heading: 185 }
    lastPosition   = demoPos
    lastSpeedKnots = msToKnots(2.6)
    updateBoatPosition(demoPos.lat, demoPos.lon, demoPos.heading)
    setEl('v-spd', '2.6')
    setEl('v-crs', '185')
    setEl('gps-acc', '±25 m')
    const dot = document.getElementById('gps-dot')
    if (dot) dot.className = 'dot ok'
    updateTideInstrument(demoPos.lat, demoPos.lon)
    firstFix = false
    fetchWeatherNow()
    fetchOceanNow()
    fetchAlertsNow()
  }
}, 8000)

// Apply initial filter from localStorage
;(() => {
  try {
    const saved = JSON.parse(localStorage.getItem('seilnav.filter') || 'null')
    if (saved) {
      // Migrate old grayscale-default: if it's the old "gratone" preset, reset to dag
      const isOldDefault = saved.grayscale >= 1 && !saved.sepia && saved.brightness === 1 &&
                           saved.contrast === 1 && !saved.hue && saved.saturate === 1 && !saved.invert
      if (!isOldDefault) {
        Object.assign(mapFilter, saved)
        setMapFilter(buildFilterStr(mapFilter))
      }
    }
  } catch(e) {}
})()
