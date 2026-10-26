// Coordenadas de las ubicaciones secretas. Se guardan como texto "lat, lon" con 6 decimales
// (unos 10 cm), y se aceptan pegadas en casi cualquier forma.

export interface LatLng {
  lat: number
  lng: number
}

const valid = (lat: number, lng: number): LatLng | null =>
  Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? { lat, lng } : null

const NUM = String.raw`-?\d{1,3}(?:\.\d+)?`
const PAIR = new RegExp(String.raw`^\s*(${NUM})\s*[,;\s]\s*(${NUM})\s*$`)

// 19°25'57.4"N 99°07'59.5"W (como lo muestra Google Maps)
const DMS = /(\d{1,3})°\s*(\d{1,2})['′]\s*(\d{1,2}(?:\.\d+)?)["″]?\s*([NSEWO])/gi

function fromDms(text: string): LatLng | null {
  const parts = [...text.matchAll(DMS)]
  if (parts.length !== 2) return null
  const [lat, lng] = parts.map((m) => {
    const value = Number(m[1]) + Number(m[2]) / 60 + Number(m[3]) / 3600
    return /[SWO]/i.test(m[4]!) ? -value : value
  })
  return valid(lat!, lng!)
}

// Enlaces de Google Maps, Apple Maps, OpenStreetMap y "geo:"
function fromUrl(text: string): LatLng | null {
  const decoded = decodeURIComponent(text)
  const patterns = [
    // Google: el punto exacto del lugar va en !3d<lat>!4d<lon>; @lat,lon es el centro de la vista
    new RegExp(String.raw`!3d(${NUM})!4d(${NUM})`),
    new RegExp(String.raw`[?&](?:q|query|ll|sll|daddr|destination)=(${NUM}),\s*(${NUM})`),
    new RegExp(String.raw`@(${NUM}),(${NUM})`),
    new RegExp(String.raw`mlat=(${NUM})&mlon=(${NUM})`),
    new RegExp(String.raw`#map=\d+/(${NUM})/(${NUM})`),
    new RegExp(String.raw`^geo:(${NUM}),(${NUM})`)
  ]
  for (const re of patterns) {
    const m = re.exec(decoded)
    if (m) return valid(Number(m[1]), Number(m[2]))
  }
  return null
}

export function parseLocation(text: string): LatLng | null {
  const value = text.trim()
  if (!value) return null
  const pair = PAIR.exec(value)
  if (pair) return valid(Number(pair[1]), Number(pair[2]))
  return fromUrl(value) ?? fromDms(value)
}

// Enlaces cortos de Google (maps.app.goo.gl) no traen coordenadas: hay que abrirlos para verlas
export const isShortMapLink = (text: string) => /^https?:\/\/(maps\.app\.goo\.gl|goo\.gl\/maps)\//i.test(text.trim())

export const formatLatLng = ({ lat, lng }: LatLng) => `${lat.toFixed(6)}, ${lng.toFixed(6)}`

export function mapLinks({ lat, lng }: LatLng) {
  return {
    google: `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`,
    apple: `https://maps.apple.com/?ll=${lat},${lng}&q=${lat},${lng}`,
    osm: `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=17/${lat}/${lng}`
  }
}
