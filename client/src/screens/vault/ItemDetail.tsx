import { ArrowLeft, ExternalLink, Eye, EyeOff, Map as MapIcon, Pencil, QrCode, RotateCcw, Star, Trash2 } from 'lucide-react'
import QRCode from 'qrcode'
import { lazy, Suspense, useEffect, useState, type ReactNode } from 'react'
import { CopyButton, PasswordStrength } from '../../components/ui'
import type { Item } from '../../crypto/items'
import { useI18n } from '../../i18n'
import type { OpenVault } from '../../state/session'
import {
  cardBrand,
  expiryStatus,
  fieldLabel,
  formatCardNumber,
  lastDigits,
  optionLabel,
  SECRET_KINDS,
  TYPE_BY_ID,
  typeLabel,
  wifiQrText,
  type FieldDef
} from './itemTypes'
import { mapLinks, parseLocation } from './geo'
import { safeUrl } from './url'
import { VaultIcon } from './vaultLooks'

interface Props {
  item: Item
  // Bóveda del elemento; se muestra solo si hay más de una
  vault: OpenVault | null
  readOnly: boolean
  onBack: () => void
  onEdit: () => void
  onToggleFavorite: () => void
  onTrash: () => void
  onRestore: () => void
  onDeleteForever: () => void
}

interface ViewProps {
  label: ReactNode
  value: string
  secret?: boolean
  mono?: boolean
  multiline?: boolean
  // Lo que se muestra en lugar del valor real (fechas, opciones, número de tarjeta con espacios)
  display?: string
  // Lo que se muestra mientras está oculto
  masked?: string
  revealed?: boolean
  onReveal?: () => void
  actions?: ReactNode
  below?: ReactNode
}

function FieldView({ label, value, secret, mono, multiline, display, masked, revealed, onReveal, actions, below }: ViewProps) {
  const { t } = useI18n()
  const hidden = secret && !revealed
  return (
    <div className="field-view">
      <dt>{label}</dt>
      <dd>
        <span className={`value ${mono ? 'mono' : ''} ${multiline && !hidden ? 'note' : ''} ${hidden ? 'masked' : ''}`}>
          {hidden ? (masked ?? '•'.repeat(12)) : (display ?? value)}
        </span>
        {secret && (
          <button
            className="icon-btn"
            onClick={onReveal}
            aria-label={revealed ? t('common.hide') : t('common.show')}
            title={revealed ? t('common.hide') : t('common.show')}
          >
            {revealed ? <EyeOff size={18} /> : <Eye size={18} />}
          </button>
        )}
        {actions}
        <CopyButton value={value} />
      </dd>
      {below}
    </div>
  )
}

// Leaflet pesa: se descarga solo al abrir un mapa
const LocationMap = lazy(() => import('./LocationMap'))

function LinkButton({ href, label, icon }: { href: string; label: string; icon: ReactNode }) {
  return (
    <a className="icon-btn" href={href} target="_blank" rel="noopener noreferrer" aria-label={label} title={label}>
      {icon}
    </a>
  )
}

export function ItemDetail({ item, vault, readOnly, onBack, onEdit, onToggleFavorite, onTrash, onRestore, onDeleteForever }: Props) {
  const { t, lang } = useI18n()
  const [revealed, setRevealed] = useState<Set<string>>(new Set())
  const [wifiQr, setWifiQr] = useState<string | null>(null)
  const [showMap, setShowMap] = useState(false)
  const { data } = item
  const def = TYPE_BY_ID[data.type]
  const Icon = def.icon
  const trashed = !!item.trashedAt

  // Al cambiar de elemento todo vuelve a ocultarse
  useEffect(() => {
    setRevealed(new Set())
    setWifiQr(null)
  }, [item.id])

  const toggle = (key: string) =>
    setRevealed((set) => {
      const next = new Set(set)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })

  const date = (iso: string) => new Date(iso).toLocaleString(lang)
  // Las fechas de los campos son de calendario, sin hora ni zona horaria
  const calendarDate = (value: string) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
    return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).toLocaleDateString(lang, { dateStyle: 'long' }) : value
  }

  function renderField(fd: FieldDef) {
    const value = data.fields[fd.key] ?? ''
    if (!value) return null
    const secret = SECRET_KINDS.includes(fd.kind)
    const status = fd.expires ? expiryStatus(value) : null
    let label: ReactNode = t(fieldLabel(fd))
    let display: string | undefined
    let masked: string | undefined
    let actions: ReactNode = null
    let below: ReactNode = null

    if (fd.kind === 'date') display = calendarDate(value)
    if (fd.kind === 'select') display = optionLabel(t, value)
    if (status) {
      label = (
        <>
          {label} <span className={`badge ${status}`}>{t(status === 'expired' ? 'item.expired' : 'item.expiresSoon')}</span>
        </>
      )
    }
    if (fd.key === 'cardNumber') {
      display = formatCardNumber(value)
      masked = lastDigits(value)
      const brand = cardBrand(value)
      if (brand) label = `${t(fieldLabel(fd))} · ${brand}`
    }
    if (fd.kind === 'url') {
      const href = safeUrl(value)
      if (href) actions = <LinkButton href={href} label={t('item.openSite')} icon={<ExternalLink size={18} />} />
    }
    if (fd.key === 'coordinates') {
      const point = parseLocation(value)
      if (point) {
        actions = (
          <>
            <button type="button" className="icon-btn" onClick={() => setShowMap(true)} aria-label={t('map.show')} title={t('map.show')}>
              <MapIcon size={18} />
            </button>
            <LinkButton href={mapLinks(point).google} label={t('item.openMap')} icon={<ExternalLink size={18} />} />
          </>
        )
      }
    }
    if (fd.kind === 'password' && revealed.has(fd.key)) below = <PasswordStrength password={value} />

    return (
      <FieldView
        key={fd.key}
        label={label}
        value={value}
        secret={secret}
        mono={fd.mono || fd.kind === 'password'}
        multiline={fd.kind === 'multiline' || fd.kind === 'secretText'}
        display={display}
        masked={masked}
        revealed={revealed.has(fd.key)}
        onReveal={() => toggle(fd.key)}
        actions={actions}
        below={below}
      />
    )
  }

  async function toggleWifiQr() {
    setWifiQr(wifiQr ? null : await QRCode.toDataURL(wifiQrText(data), { margin: 1, width: 220 }))
  }

  const fields = def.fields.map(renderField).filter(Boolean)
  const urls = data.urls.filter(Boolean)
  const custom = data.custom.filter((c) => c.value)
  const hasFields = fields.length > 0 || urls.length > 0 || custom.length > 0

  return (
    <article className="detail">
      <header className="detail-header">
        <button className="icon-btn back-btn" onClick={onBack} aria-label={t('common.back')}>
          <ArrowLeft size={20} />
        </button>
        <div className="avatar large" aria-hidden>
          <Icon size={24} />
        </div>
        <div className="detail-title">
          <h2>{data.name || t('item.untitled')}</h2>
          <p className="detail-sub">
            {t(typeLabel(data.type))}
            {vault && (
              <span className="vault-chip">
                <VaultIcon meta={vault.meta} size={12} />
                {vault.meta.name}
              </span>
            )}
          </p>
        </div>
        {!trashed && !readOnly && (
          <div className="detail-actions">
            <button
              className={`icon-btn ${data.favorite ? 'active' : ''}`}
              onClick={onToggleFavorite}
              aria-label={data.favorite ? t('item.unfavorite') : t('item.favorite')}
              title={data.favorite ? t('item.unfavorite') : t('item.favorite')}
            >
              <Star size={18} fill={data.favorite ? 'currentColor' : 'none'} />
            </button>
            <button className="btn" onClick={onEdit}>
              <Pencil size={16} /> {t('common.edit')}
            </button>
          </div>
        )}
      </header>

      {trashed && <p className="notice">{t('item.inTrash')}</p>}

      {hasFields && (
        <dl className="fields">
          {fields}
          {urls.map((url, i) => {
            const href = safeUrl(url)
            return (
              <FieldView
                key={`url-${i}`}
                label={t('field.website')}
                value={url}
                actions={href && <LinkButton href={href} label={t('item.openSite')} icon={<ExternalLink size={18} />} />}
              />
            )
          })}
          {custom.map((c, i) => (
            <FieldView
              key={`custom-${i}`}
              label={c.label || t('item.customField')}
              value={c.value}
              secret={c.secret}
              revealed={revealed.has(`custom-${i}`)}
              onReveal={() => toggle(`custom-${i}`)}
            />
          ))}
        </dl>
      )}

      {data.type === 'wifi' && data.fields.ssid && (
        <div className="wifi-qr">
          <button className="btn" onClick={toggleWifiQr}>
            <QrCode size={16} /> {wifiQr ? t('item.hideWifiQr') : t('item.showWifiQr')}
          </button>
          {wifiQr && (
            <>
              <img className="qr" src={wifiQr} alt={t('item.wifiQrAlt')} width={220} height={220} />
              <p className="hint">{t('item.wifiQrHelp')}</p>
            </>
          )}
        </div>
      )}

      {showMap && (
        <Suspense fallback={null}>
          <LocationMap value={data.fields.coordinates ?? ''} onClose={() => setShowMap(false)} />
        </Suspense>
      )}

      {data.note && (
        <dl className="fields">
          <FieldView label={t('field.note')} value={data.note} multiline />
        </dl>
      )}

      <p className="meta">
        {t('item.created', { date: date(item.createdAt) })}
        <br />
        {t('item.updated', { date: date(item.updatedAt) })}
      </p>

      {!readOnly && (
        <footer className="detail-footer">
          {trashed ? (
            <>
              <button className="btn" onClick={onRestore}>
                <RotateCcw size={16} /> {t('item.restore')}
              </button>
              <button className="btn danger" onClick={onDeleteForever}>
                <Trash2 size={16} /> {t('item.deleteForever')}
              </button>
            </>
          ) : (
            <button className="btn danger" onClick={onTrash}>
              <Trash2 size={16} /> {t('item.moveToTrash')}
            </button>
          )}
        </footer>
      )}
    </article>
  )
}
