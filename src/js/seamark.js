// Overpass API lookup for OpenSeaMap/seamark features near a clicked point
const OVERPASS_URL = 'https://overpass-api.de/api/interpreter'

// Seamark tag → human-readable Norwegian label
const SEAMARK_LABELS = {
  light: 'Fyr/lys',
  buoy_lateral: 'Sidemerke bøye',
  buoy_cardinal: 'Kardinalmerke bøye',
  buoy_safe_water: 'Midtfarvannsmerke',
  buoy_special_purpose: 'Spesialmerke bøye',
  buoy_isolated_danger: 'Isolert faremerke',
  beacon_lateral: 'Sidemerke stake',
  beacon_cardinal: 'Kardinalmerke stake',
  beacon_safe_water: 'Midtfarvannsmerke stake',
  beacon_special_purpose: 'Spesialstake',
  beacon_isolated_danger: 'Isolert faremerke stake',
  rock: 'Skjær/stein',
  wreck: 'Vrak',
  obstruction: 'Hindring',
  platform: 'Plattform',
  cable_overhead: 'Luftledning',
  cable_submarine: 'Sjøkabel',
  pipeline_submarine: 'Undersjøisk rørledning',
  anchorage: 'Ankringssted',
  anchor_berth: 'Ankringsberth',
  harbour: 'Havn',
  small_craft_facility: 'Gjestehavn/marinaanlegg',
  mooring: 'Fortøyningsinnretning',
  pile: 'Påle/pelarbøye',
  bridge: 'Bro',
  separation_lane: 'Trafikkseparasjonsfelt',
  restricted_area: 'Begrenset område',
  military_practice: 'Militært øvingsområde',
  nature_reserve: 'Naturreservat',
  fairway: 'Led',
  depth_area: 'Dybdeområde',
  sea_area: 'Sjøområde',
}

const LATERAL_COLORS = { red: 'Babord (rød)', green: 'Styrbord (grønn)', yellow: 'Gul', white: 'Hvit' }
const CARDINAL_DIRS  = { north: 'Nord', south: 'Sør', east: 'Øst', west: 'Vest' }

export async function querySeamarks(lat, lon, radiusM = 80) {
  const query = `
    [out:json][timeout:10];
    (
      node["seamark:type"](around:${radiusM},${lat},${lon});
      way["seamark:type"](around:${radiusM},${lat},${lon});
    );
    out body;
  `
  try {
    const res = await fetch(OVERPASS_URL, {
      method: 'POST',
      body: 'data=' + encodeURIComponent(query),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    })
    if (!res.ok) throw new Error(`Overpass ${res.status}`)
    const json = await res.json()
    return json.elements || []
  } catch (err) {
    console.warn('Overpass query failed:', err)
    return []
  }
}

export function buildSeamarkPopup(elements) {
  if (!elements.length) return null

  const items = elements.map(el => {
    const t = el.tags || {}
    const type = t['seamark:type'] || 'ukjent'
    const label = SEAMARK_LABELS[type] || type.replace(/_/g, ' ')

    const rows = [`<b style="color:#00aaff">${label}</b>`]

    // Name
    if (t.name || t['seamark:name']) rows.push(`Navn: ${t.name || t['seamark:name']}`)

    // Light characteristics
    if (t['seamark:light:colour']) rows.push(`Farge: ${t['seamark:light:colour']}`)
    if (t['seamark:light:character']) rows.push(`Karakter: ${t['seamark:light:character']}`)
    if (t['seamark:light:period']) rows.push(`Periode: ${t['seamark:light:period']}s`)
    if (t['seamark:light:range']) rows.push(`Rekkevidde: ${t['seamark:light:range']} nm`)
    if (t['seamark:light:height']) rows.push(`Høyde: ${t['seamark:light:height']} m`)

    // Lateral marks
    const lateralType = t['seamark:buoy_lateral:category'] || t['seamark:beacon_lateral:category']
    if (lateralType) rows.push(`Side: ${LATERAL_COLORS[lateralType] || lateralType}`)

    // Cardinal marks
    const cardDir = t['seamark:buoy_cardinal:category'] || t['seamark:beacon_cardinal:category']
    if (cardDir) rows.push(`Retning: ${CARDINAL_DIRS[cardDir] || cardDir}`)

    // Depth/height
    if (t['seamark:rock:water_level']) rows.push(`Vannstand: ${t['seamark:rock:water_level']}`)
    if (t.depth) rows.push(`Dybde: ${t.depth} m`)
    if (t.height) rows.push(`Høyde: ${t.height} m`)

    // Obstruction/wreck
    if (t['seamark:wreck:category']) rows.push(`Type: ${t['seamark:wreck:category']}`)

    // OSM link
    if (el.id) {
      const osmType = el.type === 'node' ? 'node' : 'way'
      rows.push(`<a href="https://www.openstreetmap.org/${osmType}/${el.id}" target="_blank" style="color:#00ddaa;font-size:0.75rem">OSM →</a>`)
    }

    return rows.join('<br>')
  })

  return `<div style="font-family:monospace;font-size:12px;color:#e8f0fe;background:#0f2040;padding:10px;border-radius:8px;max-width:200px;line-height:1.6">
    ${items.join('<hr style="border-color:#1a3055;margin:6px 0">')}
  </div>`
}
