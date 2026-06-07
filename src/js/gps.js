let watchId = null
let lastPos = null
let lastHeading = 0
let onUpdateCallback = null

export function startGPS(onUpdate) {
  onUpdateCallback = onUpdate

  if (!navigator.geolocation) {
    setGpsStatus(false, 'GPS ikke støttet')
    return
  }

  const options = {
    enableHighAccuracy: true,
    maximumAge: 2000,
    timeout: 10000,
  }

  watchId = navigator.geolocation.watchPosition(
    onPosition,
    onError,
    options
  )

  // Also listen to deviceorientation for compass heading
  if (window.DeviceOrientationEvent) {
    window.addEventListener('deviceorientationabsolute', onOrientation, true)
    window.addEventListener('deviceorientation', onOrientation, true)
  }
}

function onPosition(pos) {
  const { latitude, longitude, accuracy, speed, heading } = pos.coords

  // Use GPS heading if available and moving fast enough
  if (heading !== null && speed !== null && speed > 0.5) {
    lastHeading = heading
  }

  lastPos = { lat: latitude, lon: longitude, accuracy, speed, heading: lastHeading }

  setGpsStatus(true, `±${Math.round(accuracy)}m`)

  if (onUpdateCallback) onUpdateCallback(lastPos)
}

function onError(err) {
  const msgs = {
    1: 'GPS tilgang nektet',
    2: 'Posisjon utilgjengelig',
    3: 'GPS timeout',
  }
  setGpsStatus(false, msgs[err.code] || 'GPS feil')
}

function onOrientation(evt) {
  // Use compass heading from device orientation
  if (evt.absolute && evt.alpha !== null) {
    // Convert to 0-360 compass bearing
    let heading = 360 - evt.alpha
    if (heading >= 360) heading -= 360
    lastHeading = heading
  }
}

function setGpsStatus(hasFix, text) {
  const icon = document.getElementById('gps-icon')
  const accuracy = document.getElementById('gps-accuracy')
  if (icon) {
    icon.textContent = hasFix ? '◉' : '⊙'
    icon.className = hasFix ? 'fix' : ''
  }
  if (accuracy) accuracy.textContent = text
}

export function getLastPosition() { return lastPos }
export function getLastHeading() { return lastHeading }

// Convert speed m/s to knots
export function msToKnots(ms) {
  if (ms === null || ms === undefined) return null
  return ms * 1.94384
}
