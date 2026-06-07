// Vercel serverless function — proxyer BarentsWatch AIS-oppslag
// Håndterer både token og datahenting server-side for å unngå CORS

const TOKEN_URL = 'https://id.barentswatch.no/connect/token'
const AIS_URL   = 'https://live.ais.barentswatch.no/v1/latest/combined'

let cachedToken  = null
let tokenExpiry  = 0

async function getToken(clientId, clientSecret) {
  if (cachedToken && Date.now() < tokenExpiry - 30_000) return cachedToken

  const body = new URLSearchParams({
    grant_type:    'client_credentials',
    client_id:     clientId,
    client_secret: clientSecret,
    scope:         'ais',
  })

  const res = await fetch(TOKEN_URL, {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body:    body.toString(),
  })

  if (!res.ok) {
    const txt = await res.text()
    throw new Error(`Token feil ${res.status}: ${txt}`)
  }

  const json   = await res.json()
  cachedToken  = json.access_token
  tokenExpiry  = Date.now() + json.expires_in * 1000
  return cachedToken
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  const clientId  = process.env.BW_CLIENT_ID
  const clientSec = process.env.BW_CLIENT_SECRET

  if (!clientId || !clientSec) {
    return res.status(500).json({ error: 'BW_CLIENT_ID / BW_CLIENT_SECRET mangler' })
  }

  const { xmin, ymin, xmax, ymax } = req.query
  if (!xmin || !ymin || !xmax || !ymax) {
    return res.status(400).json({ error: 'Mangler bbox-parametre: xmin, ymin, xmax, ymax' })
  }

  try {
    const token = await getToken(clientId, clientSec)

    const params = new URLSearchParams({ xmin, ymin, xmax, ymax })
    const aisRes = await fetch(`${AIS_URL}?${params}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept:        'application/json',
      }
    })

    if (!aisRes.ok) {
      const txt = await aisRes.text()
      throw new Error(`AIS feil ${aisRes.status}: ${txt}`)
    }

    const data    = await aisRes.json()
    const vessels = Array.isArray(data) ? data : (data.features || [])

    // Debug: logg første fartøy og antall per skipstype
    if (vessels.length > 0) {
      const sample = vessels[0]
      console.log('BW sample vessel:', JSON.stringify(sample))

      const byType = {}
      for (const v of vessels) {
        const p    = v.properties || v
        const type = p.shipType ?? p.vesselType ?? p.messageType ?? p.modelType ?? 'ukjent'
        byType[type] = (byType[type] || 0) + 1
      }
      console.log('BW vessel types:', JSON.stringify(byType))
      console.log('BW total vessels:', vessels.length)
    } else {
      console.log('BW: ingen fartøy returnert')
    }

    res.setHeader('Cache-Control', 'public, max-age=55')
    res.setHeader('Access-Control-Allow-Origin', '*')
    return res.status(200).json(data)
  } catch (err) {
    console.error('BW AIS feil:', err.message)
    return res.status(500).json({ error: err.message })
  }
}
