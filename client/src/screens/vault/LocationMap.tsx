import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { Crosshair, ExternalLink, Search } from 'lucide-react'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { ErrorText, Modal, Spinner } from '../../components/ui'
import { useI18n } from '../../i18n'
import { formatLatLng, mapLinks, parseLocation, type LatLng } from './geo'

// Mapa de OpenStreetMap para elegir o ver una ubicación. Se carga aparte (solo cuando se abre) y
// solo entonces se piden las imágenes del mapa: OpenStreetMap ve la zona que se mira, nunca el
// resto de los datos.
const TILES = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png'
const SEARCH = 'https://nominatim.openstreetmap.org/search'

const PIN = L.divIcon({
  className: 'map-pin',
  html: '<svg viewBox="0 0 32 42" width="32" height="42" aria-hidden="true"><path d="M16 1C7.7 1 1 7.6 1 15.8 1 27 16 41 16 41s15-14 15-25.2C31 7.6 24.3 1 16 1z"/><circle cx="16" cy="15.5" r="5.5"/></svg>',
  iconSize: [32, 42],
  iconAnchor: [16, 41]
})

interface Place {
  name: string
  point: LatLng
}

interface Props {
  value: string
  // Sin onPick el mapa es solo para ver
  onPick?: (point: LatLng, address?: string) => void
  onClose: () => void
}

export default function LocationMap({ value, onPick, onClose }: Props) {
  const { t, lang } = useI18n()
  const box = useRef<HTMLDivElement>(null)
  const map = useRef<L.Map | null>(null)
  const marker = useRef<L.Marker | null>(null)
  const [point, setPoint] = useState<LatLng | null>(() => parseLocation(value))
  const [address, setAddress] = useState<string>()
  const [query, setQuery] = useState('')
  const [places, setPlaces] = useState<Place[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  function place(p: LatLng, zoom?: number) {
    const m = map.current!
    if (marker.current) marker.current.setLatLng(p)
    else {
      marker.current = L.marker(p, { icon: PIN, draggable: !!onPick, keyboard: false }).addTo(m)
      marker.current.on('dragend', () => {
        const { lat, lng } = marker.current!.getLatLng()
        setPoint({ lat, lng })
        setAddress(undefined)
      })
    }
    if (zoom) m.setView(p, zoom)
    setPoint(p)
  }

  useEffect(() => {
    const start = parseLocation(value)
    const m = L.map(box.current!, { zoomControl: true, attributionControl: true }).setView(start ?? { lat: 20, lng: -40 }, start ? 17 : 2)
    L.tileLayer(TILES, {
      maxZoom: 19,
      // La app no manda Referer; OpenStreetMap pide al menos el origen para servir el mapa
      referrerPolicy: 'origin',
      attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>'
    }).addTo(m)
    map.current = m
    if (start) place(start)
    if (onPick) {
      m.on('click', (e: L.LeafletMouseEvent) => {
        place({ lat: e.latlng.lat, lng: e.latlng.lng })
        setAddress(undefined)
      })
    }
    // El diálogo termina de acomodarse después de montar el mapa
    const timer = setTimeout(() => m.invalidateSize(), 50)
    return () => {
      clearTimeout(timer)
      m.remove()
      map.current = null
      marker.current = null
    }
  }, [])

  async function search(e: FormEvent) {
    e.preventDefault()
    const q = query.trim()
    if (!q) return
    // Unas coordenadas o un enlace de mapa no necesitan buscarse
    const direct = parseLocation(q)
    if (direct) {
      place(direct, 17)
      setPlaces(null)
      return
    }
    setError('')
    setBusy(true)
    try {
      const url = `${SEARCH}?format=jsonv2&limit=5&accept-language=${lang}&q=${encodeURIComponent(q)}`
      const res = await fetch(url, { referrerPolicy: 'origin', credentials: 'omit' })
      if (!res.ok) throw new Error()
      const rows = (await res.json()) as { display_name: string; lat: string; lon: string }[]
      setPlaces(rows.map((r) => ({ name: r.display_name, point: { lat: Number(r.lat), lng: Number(r.lon) } })))
    } catch {
      setError(t('map.searchError'))
    }
    setBusy(false)
  }

  function locate() {
    setError('')
    if (!navigator.geolocation) {
      setError(t('map.noLocation'))
      return
    }
    setBusy(true)
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        place({ lat: pos.coords.latitude, lng: pos.coords.longitude }, 18)
        setAddress(undefined)
        setBusy(false)
      },
      () => {
        setError(t('map.noLocation'))
        setBusy(false)
      },
      { enableHighAccuracy: true, timeout: 15000 }
    )
  }

  const links = point && mapLinks(point)

  return (
    <Modal title={onPick ? t('map.pickTitle') : t('map.viewTitle')} onClose={onClose}>
      <div className="stack map-dialog">
        {onPick && (
          <form className="map-search" onSubmit={search}>
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('map.searchPlaceholder')}
              aria-label={t('map.search')}
            />
            <button className="icon-btn" aria-label={t('map.search')} title={t('map.search')} disabled={busy}>
              <Search size={18} />
            </button>
            <button
              type="button"
              className="icon-btn"
              onClick={locate}
              aria-label={t('map.myLocation')}
              title={t('map.myLocation')}
              disabled={busy}
            >
              <Crosshair size={18} />
            </button>
          </form>
        )}
        {places && (
          <ul className="map-results">
            {places.length === 0 && <li className="muted">{t('map.noResults')}</li>}
            {places.map((p) => (
              <li key={`${p.point.lat},${p.point.lng}`}>
                <button
                  type="button"
                  onClick={() => {
                    place(p.point, 17)
                    setAddress(p.name)
                    setPlaces(null)
                  }}
                >
                  {p.name}
                </button>
              </li>
            ))}
          </ul>
        )}
        <div ref={box} className="map-box" />
        {busy && <Spinner />}
        <ErrorText>{error}</ErrorText>
        <p className="hint">{onPick ? t('map.pickHelp') : t('map.privacy')}</p>
        <div className="map-footer">
          <span className="mono">{point ? formatLatLng(point) : t('map.noPoint')}</span>
          {links && (
            <span className="map-links">
              <a href={links.google} target="_blank" rel="noopener noreferrer">
                Google Maps <ExternalLink size={12} />
              </a>
              <a href={links.apple} target="_blank" rel="noopener noreferrer">
                Apple Maps <ExternalLink size={12} />
              </a>
            </span>
          )}
        </div>
        {onPick && (
          <div className="row end">
            <button type="button" className="btn" onClick={onClose}>
              {t('common.cancel')}
            </button>
            <button type="button" className="btn primary" disabled={!point} onClick={() => point && onPick(point, address)}>
              {t('map.use')}
            </button>
          </div>
        )}
      </div>
    </Modal>
  )
}
