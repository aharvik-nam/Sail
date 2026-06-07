// CPA/TCPA — Closest Point of Approach / Time to Closest Point of Approach
// Beregner kollisjonskursrisiko mot alle AIS-mål

const NM_TO_M = 1852
const KNOT_TO_MS = 0.51444

// Konfigurerbare terskler
export const CPA_CONFIG = {
  warnCpaNm: 0.5,    // nm — varsle hvis CPA under dette
  warnTcpaMin: 15,   // minutter — varsle bare hvis TCPA under dette
  critCpaNm: 0.2,    // nm — kritisk (rød)
}

// Resultater: mmsi → { cpa, tcpa, risk }
let cpaResults = {}
let ownState = null
let aisTargets = {}  // mmsi → { lat, lon, sog, cog }
let onUpdateCallback = null
let intervalId = null

export function setCpaCallback(cb) { onUpdateCallback = cb }

export function updateOwnState(lat, lon, sogKnots, cogDeg) {
  ownState = { lat, lon, sog: sogKnots, cog: cogDeg }
}

export function updateAisState(mmsi, lat, lon, sogKnots, cogDeg) {
  aisTargets[mmsi] = { lat, lon, sog: sogKnots ?? 0, cog: cogDeg ?? 0 }
}

export function removeAisState(mmsi) {
  delete aisTargets[mmsi]
  delete cpaResults[mmsi]
}

export function startCpaLoop() {
  intervalId = setInterval(runCpaAll, 5000)
}

export function stopCpaLoop() {
  if (intervalId) clearInterval(intervalId)
}

function runCpaAll() {
  if (!ownState || ownState.sog < 0.5) return  // don't compute when stationary

  const results = {}
  for (const [mmsi, tgt] of Object.entries(aisTargets)) {
    const r = computeCpa(ownState, tgt)
    if (r) {
      r.risk = classifyRisk(r.cpaM, r.tcpaSec)
      results[mmsi] = r
    }
  }
  cpaResults = results
  if (onUpdateCallback) onUpdateCallback(results)
}

// Returns { cpaM (metres), cpaNm, tcpaSec, tcpaMin } or null
function computeCpa(own, tgt) {
  if (tgt.sog < 0.1) return null  // stationary target

  const latMid = (own.lat + tgt.lat) / 2
  const cosLat = Math.cos(latMid * Math.PI / 180)

  // Relative position (metres, East-North)
  const rx = (tgt.lon - own.lon) * cosLat * 111320
  const ry = (tgt.lat - own.lat) * 111320

  // Velocities (m/s, East-North)
  const ownCogRad = own.cog * Math.PI / 180
  const tgtCogRad = tgt.cog * Math.PI / 180
  const vx1 = own.sog * KNOT_TO_MS * Math.sin(ownCogRad)
  const vy1 = own.sog * KNOT_TO_MS * Math.cos(ownCogRad)
  const vx2 = tgt.sog * KNOT_TO_MS * Math.sin(tgtCogRad)
  const vy2 = tgt.sog * KNOT_TO_MS * Math.cos(tgtCogRad)

  // Relative velocity
  const vrx = vx2 - vx1
  const vry = vy2 - vy1
  const vr2 = vrx * vrx + vry * vry

  if (vr2 < 0.0001) return null  // parallel courses

  // TCPA
  const tcpaSec = -(rx * vrx + ry * vry) / vr2
  if (tcpaSec < 0) return null  // already past CPA (diverging)

  // CPA position
  const cpax = rx + vrx * tcpaSec
  const cpay = ry + vry * tcpaSec
  const cpaM = Math.sqrt(cpax * cpax + cpay * cpay)

  return {
    cpaM,
    cpaNm: cpaM / NM_TO_M,
    tcpaSec,
    tcpaMin: tcpaSec / 60,
  }
}

function classifyRisk(cpaM, tcpaSec) {
  const cpaNm = cpaM / NM_TO_M
  const tcpaMin = tcpaSec / 60
  if (cpaNm > CPA_CONFIG.warnCpaNm || tcpaMin > CPA_CONFIG.warnTcpaMin) return 'none'
  if (cpaNm <= CPA_CONFIG.critCpaNm) return 'critical'
  return 'warning'
}

export function getCpaResults() { return cpaResults }

export function formatCpa(mmsi) {
  const r = cpaResults[mmsi]
  if (!r || r.risk === 'none') return null
  return {
    cpaNm: r.cpaNm.toFixed(2),
    tcpaMin: r.tcpaMin.toFixed(1),
    risk: r.risk,
  }
}
