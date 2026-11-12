import { ArrowLeft, Eye, EyeOff, FileUp, KeySquare, MapPin, Plus, RefreshCw, X } from 'lucide-react'
import { lazy, Suspense, useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { ErrorText, Field, PasswordField, PasswordStrength, Spinner } from '../../components/ui'
import { generatePassword } from '../../crypto/generator'
import { isValidPhrase } from '../../crypto/keys'
import type { CustomField, ItemData } from '../../crypto/items'
import { errorMessage, useI18n } from '../../i18n'
import type { OpenVault } from '../../state/session'
import { formatLatLng, isShortMapLink, parseLocation } from './geo'
import { fieldLabel, MULTILINE_KINDS, optionLabel, TYPE_BY_ID, typeLabel, type FieldDef } from './itemTypes'
import { analyzeKey, hasPrivateKey, normCode, parseCodes, phraseWords, type KeyInfo } from './keyFiles'

const LocationMap = lazy(() => import('./LocationMap'))

export const DEFAULT_GENERATED = {
  length: 20,
  lower: true,
  upper: true,
  digits: true,
  symbols: true,
  avoidAmbiguous: false
}

// Atributos para que ni el navegador ni el teclado del teléfono guarden o corrijan lo que se escribe
const RAW = { autoComplete: 'off', autoCapitalize: 'off', autoCorrect: 'off', spellCheck: false } as const

interface Props {
  initial: ItemData
  isNew: boolean
  // Bóvedas donde se puede guardar; si hay más de una se puede elegir (o mover el elemento)
  vaults: OpenVault[]
  vaultId: string
  onSave: (data: ItemData, vaultId: string) => Promise<void>
  onCancel: () => void
}

// Secreto de varias líneas (llave privada, frase semilla): oculto hasta que se pide editarlo
function SecretTextField({
  label,
  value,
  onChange,
  mono,
  rows = 4,
  actions,
  children
}: {
  label: string
  value: string
  onChange: (v: string) => void
  mono?: boolean
  rows?: number
  // Botones junto a la etiqueta (cargar archivo)
  actions?: ReactNode
  // Ayuda o avisos debajo
  children?: ReactNode
}) {
  const { t } = useI18n()
  const id = useId()
  const [visible, setVisible] = useState(!value)
  return (
    <div className="field">
      <div className="label-row">
        <label htmlFor={id}>{label}</label>
        <span className="label-actions">
          {actions}
          <button
            type="button"
            className="icon-btn small"
            onClick={() => setVisible((v) => !v)}
            aria-label={visible ? t('common.hide') : t('common.show')}
            title={visible ? t('common.hide') : t('common.show')}
          >
            {visible ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
        </span>
      </div>
      {visible ? (
        <textarea id={id} rows={rows} className={mono ? 'mono' : ''} value={value} onChange={(e) => onChange(e.target.value)} {...RAW} />
      ) : (
        <button type="button" id={id} className="secret-placeholder" onClick={() => setVisible(true)}>
          {'•'.repeat(16)}
        </button>
      )}
      {children}
    </div>
  )
}

const MAX_KEY_FILE = 256 * 1024

// Lee un archivo de llave: texto (.asc, .pem, id_ed25519, .pub) o binario de GnuPG (.gpg)
async function readKeyFile(file: File): Promise<KeyInfo | null> {
  if (file.size > MAX_KEY_FILE) return null
  const bytes = new Uint8Array(await file.arrayBuffer())
  // Un paquete PGP binario empieza con el bit alto encendido; un archivo de texto no
  if (bytes.length && bytes[0]! & 0x80) return analyzeKey(bytes)
  return analyzeKey(new TextDecoder().decode(bytes))
}

// Botón "Cargar archivo" de los campos de llave
function FileButton({ onFile }: { onFile: (file: File) => void }) {
  const { t } = useI18n()
  const ref = useRef<HTMLInputElement>(null)
  return (
    <>
      <button type="button" className="btn small" onClick={() => ref.current?.click()}>
        <FileUp size={14} /> {t('key.loadFile')}
      </button>
      <input
        ref={ref}
        type="file"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0]
          e.target.value = ''
          if (file) onFile(file)
        }}
      />
    </>
  )
}

export function ItemEditor({ initial, isNew, vaults, vaultId: initialVault, onSave, onCancel }: Props) {
  const { t } = useI18n()
  const [data, setData] = useState<ItemData>(() => ({
    ...initial,
    urls: TYPE_BY_ID[initial.type].urls && !initial.urls.length ? [''] : initial.urls
  }))
  const [vaultId, setVaultId] = useState(initialVault)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [mapFor, setMapFor] = useState<string | null>(null)
  const [keyInfo, setKeyInfo] = useState<KeyInfo | null>(null)
  const [keyNotice, setKeyNotice] = useState('')
  const def = TYPE_BY_ID[data.type]

  const set = <K extends keyof ItemData>(key: K, value: ItemData[K]) => setData((d) => ({ ...d, [key]: value }))
  const setField = (key: string, value: string) => setData((d) => ({ ...d, fields: { ...d.fields, [key]: value } }))
  const setUrl = (i: number, value: string) => set('urls', data.urls.map((u, j) => (j === i ? value : u)))
  const setCustom = (i: number, patch: Partial<CustomField>) =>
    set('custom', data.custom.map((c, j) => (j === i ? { ...c, ...patch } : c)))

  // Una llave pegada o cargada llena sola los datos que estén vacíos (tipo, identidad, huella…)
  const keyText = data.type === 'privateKey' ? `${data.fields.privateKey ?? ''}\n${data.fields.publicKey ?? ''}` : ''
  useEffect(() => {
    if (!keyText.trim()) {
      setKeyInfo(null)
      return
    }
    let current = true
    void analyzeKey(keyText).then((info) => {
      if (!current) return
      setKeyInfo(info)
      if (info) fillFromKey(info)
    })
    return () => {
      current = false
    }
  }, [keyText])

  function fillFromKey(info: KeyInfo) {
    setData((d) => {
      const fields = { ...d.fields }
      const put = (key: string, value: string) => {
        if (value && !fields[key]?.trim()) fields[key] = value
      }
      put('keyKind', info.kind)
      put('identity', info.identity)
      put('fingerprint', info.fingerprint)
      put('publicKey', info.publicKey)
      put('createdOn', info.createdOn)
      put('expiresOn', info.expiresOn)
      return { ...d, fields }
    })
  }

  async function loadKeyFile(file: File) {
    setKeyNotice('')
    const info = await readKeyFile(file)
    if (!info) {
      setKeyNotice(t('key.notAKey', { file: file.name }))
      return
    }
    // Lo privado va a su campo y lo público al suyo, venga del archivo que venga
    if (info.privateKey) setField('privateKey', info.privateKey)
    if (info.publicKey && (!info.privateKey || !data.fields.publicKey?.trim())) setField('publicKey', info.publicKey)
    if (!info.privateKey) setKeyNotice(t('key.onlyPublic', { file: file.name }))
    if (!data.name.trim()) set('name', file.name.replace(/\.(asc|gpg|key|pem|pub|txt)$/i, ''))
    fillFromKey(info)
  }

  // Una llave privada pegada en una nota se puede pasar a su propio tipo
  async function noteToKey() {
    const info = await analyzeKey(data.note)
    if (!info?.privateKey) return
    setData((d) => ({
      ...d,
      type: 'privateKey',
      fields: { ...d.fields, privateKey: info.privateKey },
      note: d.note.replace(/-----BEGIN [A-Z0-9 ]*PRIVATE KEY( BLOCK)?-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY( BLOCK)?-----/g, '').trim()
    }))
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError('')
    setBusy(true)
    // No se guardan campos vacíos ni de otros tipos
    const fields: Record<string, string> = {}
    for (const fd of def.fields) {
      const value = data.fields[fd.key] ?? ''
      if (value.trim()) fields[fd.key] = MULTILINE_KINDS.includes(fd.kind) ? value : value.trim()
    }
    // Solo se recuerdan como usados los códigos que siguen en la lista
    if (fields.usedCodes) {
      const current = new Set(parseCodes(fields.backupCodes ?? '').map(normCode))
      const used = parseCodes(fields.usedCodes).filter((c) => current.has(normCode(c)))
      if (used.length) fields.usedCodes = used.join('\n')
      else delete fields.usedCodes
    }
    try {
      await onSave(
        {
          ...data,
          name: data.name.trim(),
          fields,
          urls: data.urls.map((u) => u.trim()).filter(Boolean),
          custom: data.custom.filter((c) => c.label.trim() || c.value).map((c) => ({ ...c, label: c.label.trim() }))
        },
        vaultId
      )
    } catch (err) {
      setError(errorMessage(t, err))
      setBusy(false)
    }
  }

  function input(fd: FieldDef) {
    const label = t(fieldLabel(fd))
    const value = data.fields[fd.key] ?? ''
    const onChange = (v: string) => setField(fd.key, v)
    const mono = fd.mono ? 'mono' : ''
    switch (fd.kind) {
      case 'password':
        return (
          <div className="with-action" key={fd.key}>
            <PasswordField
              label={label}
              value={value}
              onChange={(e) => onChange(e.target.value)}
              autoComplete="new-password"
              hint={<PasswordStrength password={value} />}
            />
            <button type="button" className="btn" onClick={() => onChange(generatePassword(DEFAULT_GENERATED))}>
              <RefreshCw size={16} /> {t('generator.generate')}
            </button>
          </div>
        )
      case 'secret':
        return (
          <PasswordField
            key={fd.key}
            label={label}
            value={value}
            className={mono}
            onChange={(e) => onChange(e.target.value)}
            inputMode={['cardNumber', 'cvv', 'pin'].includes(fd.key) ? 'numeric' : undefined}
            {...RAW}
          />
        )
      case 'secretText':
        return (
          <SecretTextField
            key={fd.key}
            label={label}
            value={value}
            onChange={onChange}
            mono={fd.mono}
            rows={fd.file ? 6 : 4}
            actions={fd.file && <FileButton onFile={(file) => void loadKeyFile(file)} />}
          >
            {fd.file && (
              <div className="hint">
                {keyNotice ||
                  (keyInfo?.encrypted && !data.fields.passphrase?.trim()
                    ? t('key.needsPassphrase')
                    : value.trim() && keyInfo && !keyInfo.privateKey
                      ? t('key.looksPublic')
                      : t('key.help'))}
              </div>
            )}
          </SecretTextField>
        )
      case 'phrase': {
        const words = phraseWords(value).length
        return (
          <SecretTextField key={fd.key} label={label} value={value} onChange={onChange} mono={fd.mono}>
            {isValidPhrase(value) ? (
              <p className="warning">{t('recovery.notPassMe')}</p>
            ) : (
              <div className="hint">{words ? t('recovery.words', { n: words }) : t('recovery.phraseHelp')}</div>
            )}
          </SecretTextField>
        )
      }
      case 'codes': {
        const n = parseCodes(value).length
        return (
          <SecretTextField key={fd.key} label={label} value={value} onChange={onChange} mono={fd.mono} rows={6}>
            <div className="hint">{n ? t('recovery.codesCount', { n }) : t('recovery.codesHelp')}</div>
          </SecretTextField>
        )
      }
      case 'hidden':
        return null
      case 'multiline':
        return (
          <div className="field" key={fd.key}>
            <div className="label-row">
              <label htmlFor={`f-${fd.key}`}>{label}</label>
              {fd.file && <FileButton onFile={(file) => void loadKeyFile(file)} />}
            </div>
            <textarea
              id={`f-${fd.key}`}
              rows={3}
              className={mono}
              value={value}
              onChange={(e) => onChange(e.target.value)}
              {...(fd.mono ? RAW : {})}
            />
          </div>
        )
      case 'select':
        return (
          <div className="field" key={fd.key}>
            <label htmlFor={`f-${fd.key}`}>{label}</label>
            <select id={`f-${fd.key}`} value={value} onChange={(e) => onChange(e.target.value)}>
              <option value="">—</option>
              {fd.options!.map((o) => (
                <option key={o} value={o}>
                  {optionLabel(t, o)}
                </option>
              ))}
            </select>
          </div>
        )
      case 'coordinates': {
        const point = parseLocation(value)
        return (
          <div className="field" key={fd.key}>
            <label htmlFor={`f-${fd.key}`}>{label}</label>
            <div className="input-row">
              <input
                id={`f-${fd.key}`}
                className="mono"
                value={value}
                placeholder={t('map.coordsPlaceholder')}
                onChange={(e) => onChange(e.target.value)}
                // Un enlace o grados pegados se convierten a "lat, lon"
                onBlur={() => point && onChange(formatLatLng(point))}
                {...RAW}
              />
              <button type="button" className="btn" onClick={() => setMapFor(fd.key)}>
                <MapPin size={16} /> {t('map.open')}
              </button>
            </div>
            <div className="hint">
              {isShortMapLink(value) ? t('map.shortLink') : value && !point ? t('map.invalid') : t('map.coordsHelp')}
            </div>
          </div>
        )
      }
      case 'date':
        return <Field key={fd.key} label={label} type="date" value={value} onChange={(e) => onChange(e.target.value)} />
      default:
        return (
          <Field
            key={fd.key}
            label={label}
            value={value}
            className={mono}
            onChange={(e) => onChange(e.target.value)}
            type={fd.kind === 'email' ? 'email' : 'text'}
            inputMode={
              fd.kind === 'email'
                ? 'email'
                : fd.kind === 'phone'
                  ? 'tel'
                  : fd.kind === 'number' || fd.kind === 'expiry'
                    ? 'numeric'
                    : fd.kind === 'url'
                      ? 'url'
                      : undefined
            }
            placeholder={fd.kind === 'expiry' ? t('item.expiryPlaceholder') : fd.kind === 'url' ? 'https://' : undefined}
            maxLength={fd.kind === 'expiry' ? 7 : undefined}
            {...(fd.mono || fd.kind !== 'text' ? RAW : { autoComplete: 'off' })}
          />
        )
    }
  }

  return (
    <>
      <form className="detail editor" onSubmit={submit}>
        <header className="detail-header">
          <button type="button" className="icon-btn back-btn" onClick={onCancel} aria-label={t('common.back')}>
            <ArrowLeft size={20} />
          </button>
          <div className="avatar large" aria-hidden>
            <def.icon size={24} />
          </div>
          <h2>{isNew ? t('item.newTitle', { type: t(typeLabel(data.type)) }) : t('item.editTitle')}</h2>
        </header>

        <div className="stack">
          {vaults.length > 1 && (
            <div className="field">
              <label htmlFor="item-vault">{t('item.vault')}</label>
              <select id="item-vault" value={vaultId} onChange={(e) => setVaultId(e.target.value)}>
                {vaults.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.meta.name}
                  </option>
                ))}
              </select>
              {!isNew && vaultId !== initialVault && <div className="hint">{t('item.moveHint')}</div>}
            </div>
          )}

          <Field
            label={t('field.name')}
            value={data.name}
            onChange={(e) => set('name', e.target.value)}
            autoFocus={isNew}
            required
            maxLength={200}
          />

          {def.fields.map(input)}

          {def.urls && (
            <fieldset className="urls">
              <legend>{t('field.websites')}</legend>
              {data.urls.map((url, i) => (
                <div className="input-row" key={i}>
                  <input
                    type="text"
                    inputMode="url"
                    value={url}
                    placeholder="https://"
                    onChange={(e) => setUrl(i, e.target.value)}
                    aria-label={t('field.website')}
                    {...RAW}
                  />
                  {data.urls.length > 1 && (
                    <button
                      type="button"
                      className="icon-btn"
                      onClick={() => set('urls', data.urls.filter((_, j) => j !== i))}
                      aria-label={t('common.remove')}
                    >
                      <X size={18} />
                    </button>
                  )}
                </div>
              ))}
              <button type="button" className="btn link" onClick={() => set('urls', [...data.urls, ''])}>
                <Plus size={16} /> {t('item.addUrl')}
              </button>
            </fieldset>
          )}

          <div className="field">
            <label htmlFor="item-note">{t('field.note')}</label>
            <textarea
              id="item-note"
              rows={data.type === 'note' ? 10 : 4}
              value={data.note}
              onChange={(e) => set('note', e.target.value)}
            />
            {data.type === 'note' && hasPrivateKey(data.note) && (
              <div className="notice row">
                <span>{t('key.inNote')}</span>
                <button type="button" className="btn small" onClick={() => void noteToKey()}>
                  <KeySquare size={14} /> {t('key.toKeyType')}
                </button>
              </div>
            )}
          </div>

          <fieldset className="custom-fields">
            <legend>{t('item.customFields')}</legend>
            {data.custom.map((c, i) => (
              <div className="custom-row" key={i}>
                <input
                  type="text"
                  value={c.label}
                  placeholder={t('item.customLabel')}
                  aria-label={t('item.customLabel')}
                  onChange={(e) => setCustom(i, { label: e.target.value })}
                  maxLength={100}
                />
                <input
                  type={c.secret ? 'password' : 'text'}
                  value={c.value}
                  placeholder={t('item.customValue')}
                  aria-label={t('item.customValue')}
                  onChange={(e) => setCustom(i, { value: e.target.value })}
                  {...RAW}
                />
                <label className="check compact">
                  <input type="checkbox" checked={c.secret} onChange={(e) => setCustom(i, { secret: e.target.checked })} />
                  <span>{t('item.customSecret')}</span>
                </label>
                <button
                  type="button"
                  className="icon-btn"
                  onClick={() => set('custom', data.custom.filter((_, j) => j !== i))}
                  aria-label={t('common.remove')}
                >
                  <X size={18} />
                </button>
              </div>
            ))}
            <button
              type="button"
              className="btn link"
              onClick={() => set('custom', [...data.custom, { label: '', value: '', secret: false }])}
            >
              <Plus size={16} /> {t('item.addCustomField')}
            </button>
          </fieldset>

          <ErrorText>{error}</ErrorText>
          <div className="row end">
            <button type="button" className="btn" onClick={onCancel} disabled={busy}>
              {t('common.cancel')}
            </button>
            <button className="btn primary" disabled={busy}>
              {busy ? <Spinner /> : t('common.save')}
            </button>
          </div>
        </div>
      </form>
      {mapFor && (
        <Suspense fallback={null}>
          <LocationMap
            value={data.fields[mapFor] ?? ''}
            onPick={(point, address) => {
              setField(mapFor, formatLatLng(point))
              // La dirección del lugar buscado, solo si no había una
              if (address && !data.fields.address?.trim()) setField('address', address)
              setMapFor(null)
            }}
            onClose={() => setMapFor(null)}
          />
        </Suspense>
      )}
    </>
  )
}
