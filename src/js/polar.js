// Generisk seilbåt-polarkurve for cruising-båt (~35-40 fot, Beneteau/HR-type)
// Normalisert fartsfaktor (0–1) ved ulike TWA (True Wind Angle, 0–180°)
// Kilde: typiske polarkurver for medium cruiser

const POLAR_TWA = [  0,  40,  45,  52,  60,  70,  80,  90, 100, 110, 120, 130, 140, 150, 160, 170, 180]
const POLAR_SPD = [  0, 0.40,0.52,0.60,0.68,0.76,0.83,0.89,0.93,0.97,0.98,0.95,0.90,0.83,0.75,0.68,0.64]

const TACK_ANGLE  = 45   // optimal kryssvinkel til vinden (grader)
const NOGO_ANGLE  = 40   // ingen-gå-sone grense

// Maks båthastighet (kn) basert på vindstyrke
export function maxBoatSpeed(windKnots) {
  if (windKnots < 3)  return 1.0
  if (windKnots < 8)  return windKnots * 0.50
  if (windKnots < 15) return 3.5 + (windKnots - 8) * 0.38
  if (windKnots < 25) return 6.2 + (windKnots - 15) * 0.20
  return Math.min(8.2 + (windKnots - 25) * -0.05, 9.0)
}

// Interpoler polarkurven ved gitt TWA (0–180)
export function polarSpeed(twa, windKnots) {
  const absT = Math.abs(twa)
  if (absT < NOGO_ANGLE) return 0

  // Lineær interpolasjon mellom polarpunkter
  let factor = 0
  for (let i = 1; i < POLAR_TWA.length; i++) {
    if (absT <= POLAR_TWA[i]) {
      const t = (absT - POLAR_TWA[i-1]) / (POLAR_TWA[i] - POLAR_TWA[i-1])
      factor = POLAR_SPD[i-1] + t * (POLAR_SPD[i] - POLAR_SPD[i-1])
      break
    }
  }
  return factor * maxBoatSpeed(windKnots)
}

// VMG mot en gitt retning (positiv = fremgang)
function vmg(twa, windKnots) {
  const speed = polarSpeed(twa, windKnots)
  return speed * Math.cos(twa * Math.PI / 180)
}

// Beste kryssvinkel (TWA) for upwind VMG
export function bestUWVMGAngle() { return TACK_ANGLE }

// Beste jibing-vinkel (TWA) for downwind VMG
export function bestDWVMGAngle() {
  let best = 150, bestVMG = 0
  for (let twa = 90; twa <= 180; twa += 1) {
    const v = -vmg(twa, 12)  // negativ cos for downwind
    if (v > bestVMG) { bestVMG = v; best = twa }
  }
  return best
}

// Analyser én ruteetappe
// bearing: kurs fra A til B (0–360)
// windDir: vindretning (fra, 0–360)
// windKnots: vindstyrke i knop
export function analyzeleg(bearingDeg, distNm, windDir, windKnots) {
  // TWA: vinkelen mellom kursen og vindens motretning (0 = rett mot vinden)
  let twa = bearingDeg - windDir
  while (twa > 180)  twa -= 360
  while (twa < -180) twa += 360
  const absTwa = Math.abs(twa)
  const side   = twa >= 0 ? 'stb' : 'bb'  // babord eller styrbord halse

  const dw_twa = bestDWVMGAngle()

  // --- KRYSS (no-go) ---
  if (absTwa < NOGO_ANGLE) {
    // Kryss ved ±TACK_ANGLE på begge halser
    // Matematisk korrekt takkdistanse ved tacking på ±45°:
    // d_total = d_direct * sqrt(2) * cos(absTwa * PI/180)
    const tackFactor  = Math.sqrt(2) * Math.cos(absTwa * Math.PI / 180)
    const tackDistNm  = distNm * tackFactor
    const speedAtTack = polarSpeed(TACK_ANGLE, windKnots)
    const vmgUpwind   = speedAtTack * Math.cos(TACK_ANGLE * Math.PI / 180)
    const etaHours    = vmgUpwind > 0 ? distNm / vmgUpwind : null

    // De to kryssretningene
    const tack1 = normBearing(windDir + TACK_ANGLE)
    const tack2 = normBearing(windDir - TACK_ANGLE)

    return {
      type:      'upwind',
      label:     'Kryss ⬆',
      color:     '#ffaa00',
      twa:       absTwa,
      twaSide:   side,
      speed:     speedAtTack,
      vmg:       vmgUpwind,
      etaHours,
      tackDistNm,
      tackFactor,
      tack1,
      tack2,
      advice: `Kryss på ${Math.round(tack1)}° og ${Math.round(tack2)}° — ~${Math.round((tackFactor - 1) * 100)}% lengre distanse`,
    }
  }

  // --- STØKK (rett for vinden, suboptimal) ---
  if (absTwa > 165) {
    const dw_speed = polarSpeed(dw_twa, windKnots)
    const dw_vmg   = dw_speed * Math.cos((180 - dw_twa) * Math.PI / 180)
    const dd_speed = polarSpeed(180, windKnots)
    const dd_vmg   = dd_speed  // cos(0) = 1 for downwind component
    const jibeFactor = dw_vmg > 0 ? dd_vmg / dw_vmg : 1
    const jibe1    = normBearing(windDir + dw_twa)
    const jibe2    = normBearing(windDir - dw_twa)
    const etaHours = dw_vmg > 0 ? distNm / dw_vmg : null

    return {
      type:      'downwind',
      label:     'Støkk ⬇',
      color:     '#4488ff',
      twa:       absTwa,
      twaSide:   side,
      speed:     dd_speed,
      vmg:       dw_vmg,
      etaHours,
      jibe1,
      jibe2,
      jibeFactor,
      advice: jibeFactor < 0.92
        ? `Jibing på ${Math.round(jibe1)}° og ${Math.round(jibe2)}° gir ~${Math.round((1-jibeFactor)*100)}% høyere VMG`
        : 'Kurs OK — marginalt å jibe',
    }
  }

  // --- ROMSKJØTS (bredbefaret nedvinds) ---
  if (absTwa >= 120) {
    const speed = polarSpeed(absTwa, windKnots)
    const etaHours = speed > 0 ? distNm / speed : null
    return {
      type:      'reaching',
      label:     'Romskjøts ↘',
      color:     '#00cc66',
      twa:       absTwa,
      twaSide:   side,
      speed,
      vmg:       null,
      etaHours,
      advice:    `${Math.round(absTwa)}° til vinden — god kurs`,
    }
  }

  // --- BIDEVIND / HALVVIND ---
  if (absTwa >= NOGO_ANGLE && absTwa < 90) {
    const speed = polarSpeed(absTwa, windKnots)
    const etaHours = speed > 0 ? distNm / speed : null
    return {
      type:      'close',
      label:     absTwa < 60 ? 'Bidevind ↗' : 'Halvvind →',
      color:     absTwa < 60 ? '#00ddaa' : '#00cc66',
      twa:       absTwa,
      twaSide:   side,
      speed,
      vmg:       null,
      etaHours,
      advice:    `${Math.round(absTwa)}° til vinden — ${absTwa < 55 ? 'nær optimalt bidevind' : 'halvvind, rask kurs'}`,
    }
  }

  // --- SLØR (90–120°, oftest raskest) ---
  const speed    = polarSpeed(absTwa, windKnots)
  const etaHours = speed > 0 ? distNm / speed : null
  return {
    type:    'reaching',
    label:   'Slør ↗',
    color:   '#00ff88',
    twa:     absTwa,
    twaSide: side,
    speed,
    vmg:     null,
    etaHours,
    advice:  `${Math.round(absTwa)}° til vinden — optimalt seilevindu`,
  }
}

function normBearing(b) {
  while (b >= 360) b -= 360
  while (b < 0)    b += 360
  return b
}

// Beregn kurs mellom to lat/lon-punkter (0–360)
export function bearing(lat1, lon1, lat2, lon2) {
  const dLon = (lon2 - lon1) * Math.PI / 180
  const la1  = lat1 * Math.PI / 180
  const la2  = lat2 * Math.PI / 180
  const y    = Math.sin(dLon) * Math.cos(la2)
  const x    = Math.cos(la1) * Math.sin(la2) - Math.sin(la1) * Math.cos(la2) * Math.cos(dLon)
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360
}

// Formater tid
export function fmtEta(hours) {
  if (hours === null || !isFinite(hours)) return '--'
  const h = Math.floor(hours)
  const m = Math.round((hours - h) * 60)
  return h > 0 ? `${h}t ${m}min` : `${m} min`
}
