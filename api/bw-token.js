// Vercel serverless function — proxyer BarentsWatch OAuth2 token-kall
// Holder client_secret på server, unngår CORS og eksponering i bundle

export default async function handler(req, res) {
  // Bare tillat POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const clientId  = process.env.BW_CLIENT_ID
  const clientSec = process.env.BW_CLIENT_SECRET

  if (!clientId || !clientSec) {
    return res.status(500).json({ error: 'BW_CLIENT_ID / BW_CLIENT_SECRET ikke satt i env' })
  }

  try {
    const body = new URLSearchParams({
      grant_type:    'client_credentials',
      client_id:     clientId,
      client_secret: clientSec,
      scope:         'ais',
    })

    const tokenRes = await fetch('https://id.barentswatch.no/connect/token', {
      method:  'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body:    body.toString(),
    })

    if (!tokenRes.ok) {
      const text = await tokenRes.text()
      console.error('BW token feil:', tokenRes.status, text)
      return res.status(tokenRes.status).json({ error: `BW auth feil: ${tokenRes.status}` })
    }

    const json = await tokenRes.json()

    // Send bare token og utløpstid til klienten — ikke secret
    res.setHeader('Cache-Control', 'no-store')
    return res.status(200).json({
      access_token: json.access_token,
      expires_in:   json.expires_in,
    })
  } catch (err) {
    console.error('BW token exception:', err)
    return res.status(500).json({ error: 'Intern feil' })
  }
}
