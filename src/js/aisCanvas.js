/**
 * Canvas-based AIS rendering over Leaflet map.
 * One <canvas> element replaces N DOM markers — scales to hundreds of vessels.
 */

import L from 'leaflet'

let map    = null
let canvas = null
let ctx    = null
let rafId  = null

// mmsi → { lat, lon, heading, name, speed, course, risk }
const vessels = {}

let visible = true
let activePopup = null

// ── Init ─────────────────────────────────────────────────────────────────────
export function initAisCanvas(leafletMap) {
  map = leafletMap

  canvas = document.createElement('canvas')
  canvas.style.cssText = [
    'position:absolute', 'inset:0', 'width:100%', 'height:100%',
    'z-index:450', 'pointer-events:none',   // map click events flow through
  ].join(';')

  // Must sit inside the Leaflet container so coordinates stay aligned
  map.getContainer().appendChild(canvas)
  ctx = canvas.getContext('2d')

  resizeCanvas()
  window.addEventListener('resize', resizeCanvas)

  // Redraw on every map movement
  map.on('move zoom viewreset resize', scheduleDraw)
}

function resizeCanvas() {
  const el = map.getContainer()
  canvas.width  = el.clientWidth  * (window.devicePixelRatio || 1)
  canvas.height = el.clientHeight * (window.devicePixelRatio || 1)
  canvas.style.width  = el.clientWidth  + 'px'
  canvas.style.height = el.clientHeight + 'px'
  scheduleDraw()
}

// ── Draw loop ─────────────────────────────────────────────────────────────────
function scheduleDraw() {
  if (rafId) return
  rafId = requestAnimationFrame(() => {
    rafId = null
    draw()
  })
}

function draw() {
  if (!ctx) return
  const dpr = window.devicePixelRatio || 1
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  if (!visible) return

  ctx.save()
  ctx.scale(dpr, dpr)

  for (const v of Object.values(vessels)) {
    const pt = map.latLngToContainerPoint([v.lat, v.lon])
    drawVessel(pt.x, pt.y, v.heading ?? 0, v.risk ?? 'none', v.speed ?? 0)
  }

  ctx.restore()
}

function drawVessel(x, y, headingDeg, risk, speedKnots) {
  const S = 9   // half-size in CSS pixels

  const color = risk === 'critical' ? '#ff5a4d'
              : risk === 'warning'  ? '#ffb028'
              : '#5ab0ff'

  ctx.save()
  ctx.translate(x, y)
  ctx.rotate(headingDeg * Math.PI / 180)

  // COG / heading line (length scales with speed, min 20px, max 60px)
  const lineLen = Math.min(60, Math.max(20, (speedKnots || 0) * 6))
  ctx.beginPath()
  ctx.moveTo(0, -S * 1.1)
  ctx.lineTo(0, -S * 1.1 - lineLen)
  ctx.strokeStyle = color
  ctx.globalAlpha = 0.55
  ctx.lineWidth = 1.5
  ctx.setLineDash([4, 3])
  ctx.stroke()
  ctx.setLineDash([])
  ctx.globalAlpha = 1

  // Triangle hull
  ctx.beginPath()
  ctx.moveTo(0,          -S * 1.1)   // bow tip
  ctx.lineTo( S * 0.6,   S * 0.8)   // starboard stern
  ctx.lineTo(0,          S * 0.2)    // stern notch
  ctx.lineTo(-S * 0.6,   S * 0.8)   // port stern
  ctx.closePath()

  ctx.fillStyle = color
  ctx.fill()
  ctx.strokeStyle = 'rgba(5,16,28,0.9)'
  ctx.lineWidth = 1.3
  ctx.stroke()

  ctx.restore()
}

// ── Hit test + popup (called from map click event in main.js) ─────────────────
const HIT_PX = 26   // click radius in CSS pixels

export function aisCanvasHandleClick(containerX, containerY) {
  let best = null, bestD = HIT_PX
  for (const [mmsi, v] of Object.entries(vessels)) {
    const pt = map.latLngToContainerPoint([v.lat, v.lon])
    const d  = Math.hypot(pt.x - containerX, pt.y - containerY)
    if (d < bestD) { bestD = d; best = { mmsi, v } }
  }
  if (!best) return false   // no hit — caller can handle normally

  const { mmsi, v } = best
  const latlng = map.containerPointToLatLng([containerX, containerY])

  if (activePopup) { activePopup.remove(); activePopup = null }

  const cpaLine = v.cpaNm != null
    ? `<div class="r"><span>CPA</span><span>${v.cpaNm.toFixed(2)} nm · ${Math.round(v.tcpaMin ?? 0)} min</span></div>`
    : ''

  const html = `<div class="ais-pop">
    <b>${v.name || 'Ukjent'}</b>
    <div class="r"><span>MMSI</span><span>${mmsi}</span></div>
    <div class="r"><span>Fart</span><span>${v.speed != null ? v.speed.toFixed(1) + ' kn' : '--'}</span></div>
    <div class="r"><span>Kurs</span><span>${v.course != null ? Math.round(v.course) + '°' : '--'}</span></div>
    ${cpaLine}
  </div>`

  activePopup = L.popup({ maxWidth: 220, className: 'ais-popup' })
    .setLatLng(latlng)
    .setContent(html)
    .openOn(map)

  return true   // hit handled
}

// ── Public API ────────────────────────────────────────────────────────────────
export function aisCanvasUpdate(mmsi, lat, lon, heading, name, speed, course) {
  if (!vessels[mmsi]) vessels[mmsi] = {}
  const v = vessels[mmsi]
  v.lat = lat; v.lon = lon; v.heading = heading
  v.name = name; v.speed = speed; v.course = course
  scheduleDraw()
}

export function aisCanvasRemove(mmsi) {
  delete vessels[mmsi]
  scheduleDraw()
}

export function aisCanvasSetRisk(mmsi, risk, cpaNm, tcpaMin) {
  if (vessels[mmsi]) {
    vessels[mmsi].risk = risk
    if (cpaNm != null)   vessels[mmsi].cpaNm   = cpaNm
    if (tcpaMin != null) vessels[mmsi].tcpaMin = tcpaMin
    scheduleDraw()
  }
}

export function aisCanvasSetVisible(vis) {
  visible = vis
  canvas.style.pointerEvents = vis ? 'auto' : 'none'
  scheduleDraw()
}

export function aisCanvasCount() {
  return Object.keys(vessels).length
}
