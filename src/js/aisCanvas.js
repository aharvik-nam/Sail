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
    'z-index:450', 'pointer-events:auto',
  ].join(';')

  // Must sit inside the Leaflet container so coordinates stay aligned
  map.getContainer().appendChild(canvas)
  ctx = canvas.getContext('2d')

  resizeCanvas()
  window.addEventListener('resize', resizeCanvas)

  // Redraw on every map movement
  map.on('move zoom viewreset resize', scheduleDraw)

  // Click → popup
  canvas.addEventListener('click', onCanvasClick)
  canvas.addEventListener('touchend', onCanvasTouch, { passive: true })
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
    drawVessel(pt.x, pt.y, v.heading ?? 0, v.risk ?? 'none')
  }

  ctx.restore()
}

function drawVessel(x, y, headingDeg, risk) {
  const S = 9   // half-size in CSS pixels

  const color = risk === 'critical' ? '#ff5a4d'
              : risk === 'warning'  ? '#ffb028'
              : '#5ab0ff'

  ctx.save()
  ctx.translate(x, y)
  ctx.rotate(headingDeg * Math.PI / 180)

  ctx.beginPath()
  ctx.moveTo(0,          -S * 1.1)   // bow tip
  ctx.lineTo( S * 0.6,   S * 0.8)   // starboard stern
  ctx.lineTo(0,          S * 0.2)   // stern notch
  ctx.lineTo(-S * 0.6,   S * 0.8)   // port stern
  ctx.closePath()

  ctx.fillStyle = color
  ctx.fill()
  ctx.strokeStyle = 'rgba(5,16,28,0.9)'
  ctx.lineWidth = 1.3
  ctx.stroke()

  ctx.restore()
}

// ── Hit test ──────────────────────────────────────────────────────────────────
const HIT_PX = 22   // click radius in CSS pixels

function hitTest(cx, cy) {
  let best = null, bestD = HIT_PX
  for (const [mmsi, v] of Object.entries(vessels)) {
    const pt = map.latLngToContainerPoint([v.lat, v.lon])
    const d  = Math.hypot(pt.x - cx, pt.y - cy)
    if (d < bestD) { bestD = d; best = { mmsi, v } }
  }
  return best
}

function onCanvasClick(e) {
  const rect = canvas.getBoundingClientRect()
  const dpr  = window.devicePixelRatio || 1
  showPopupAt(
    (e.clientX - rect.left),
    (e.clientY - rect.top),
  )
}

function onCanvasTouch(e) {
  if (!e.changedTouches.length) return
  const t    = e.changedTouches[0]
  const rect = canvas.getBoundingClientRect()
  showPopupAt(t.clientX - rect.left, t.clientY - rect.top)
}

function showPopupAt(cx, cy) {
  const hit = hitTest(cx, cy)
  if (!hit) return

  const { mmsi, v } = hit
  const latlng = map.containerPointToLatLng([cx, cy])

  if (activePopup) { activePopup.remove(); activePopup = null }

  const html = `<div class="ais-pop">
    <b>${v.name || 'Ukjent'}</b>
    <div class="r"><span>MMSI</span><span>${mmsi}</span></div>
    <div class="r"><span>Fart</span><span>${v.speed != null ? v.speed.toFixed(1) + ' kn' : '--'}</span></div>
    <div class="r"><span>Kurs</span><span>${v.course != null ? Math.round(v.course) + '°' : '--'}</span></div>
  </div>`

  activePopup = L.popup({ maxWidth: 220, className: 'ais-popup' })
    .setLatLng(latlng)
    .setContent(html)
    .openOn(map)
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

export function aisCanvasSetRisk(mmsi, risk) {
  if (vessels[mmsi]) { vessels[mmsi].risk = risk; scheduleDraw() }
}

export function aisCanvasSetVisible(vis) {
  visible = vis
  canvas.style.pointerEvents = vis ? 'auto' : 'none'
  scheduleDraw()
}

export function aisCanvasCount() {
  return Object.keys(vessels).length
}
