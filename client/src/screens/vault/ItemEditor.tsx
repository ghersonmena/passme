import { ArrowLeft, Eye, EyeOff, Plus, RefreshCw, X } from 'lucide-react'
import { useId, useState, type FormEvent } from 'react'
import { ErrorText, Field, PasswordField, PasswordStrength, Spinner } from '../../components/ui'
import { generatePassword } from '../../crypto/generator'
import type { CustomField, ItemData } from '../../crypto/items'
import { errorMessage, useI18n } from '../../i18n'
import type { OpenVault } from '../../state/session'
import { fieldLabel, optionLabel, TYPE_BY_ID, typeLabel, type FieldDef } from './itemTypes'

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
function SecretTextField({ label, value, onChange, mono }: { label: string; value: string; onChange: (v: string) => void; mono?: boolean }) {
  const { t } = useI18n()
  const id = useId()
  const [visible, setVisible] = useState(!value)
  return (
    <div className="field">
      <div className="label-row">
        <label htmlFor={id}>{label}</label>
        <button
          type="button"
          className="icon-btn small"
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? t('common.hide') : t('common.show')}
          title={visible ? t('common.hide') : t('common.show')}
        >
          {visible ? <EyeOff size={16} /> : <Eye size={16} />}
        </button>
      </div>
      {visible ? (
        <textarea id={id} rows={4} className={mono ? 'mono' : ''} value={value} onChange={(e) => onChange(e.target.value)} {...RAW} />
      ) : (
        <button type="button" id={id} className="secret-placeholder" onClick={() => setVisible(true)}>
          {'•'.repeat(16)}
        </button>
      )}
    </div>
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
  const def = TYPE_BY_ID[data.type]

  const set = <K extends keyof ItemData>(key: K, value: ItemData[K]) => setData((d) => ({ ...d, [key]: value }))
  const setField = (key: string, value: string) => setData((d) => ({ ...d, fields: { ...d.fields, [key]: value } }))
  const setUrl = (i: number, value: string) => set('urls', data.urls.map((u, j) => (j === i ? value : u)))
  const setCustom = (i: number, patch: Partial<CustomField>) =>
    set('custom', data.custom.map((c, j) => (j === i ? { ...c, ...patch } : c)))

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError('')
    setBusy(true)
    // No se guardan campos vacíos ni de otros tipos
    const fields: Record<string, string> = {}
    for (const fd of def.fields) {
      const value = data.fields[fd.key] ?? ''
      if (value.trim()) fields[fd.key] = fd.kind === 'multiline' || fd.kind === 'secretText' ? value : value.trim()
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
        return <SecretTextField key={fd.key} label={label} value={value} onChange={onChange} mono={fd.mono} />
      case 'multiline':
        return (
          <div className="field" key={fd.key}>
            <label htmlFor={`f-${fd.key}`}>{label}</label>
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
  )
}
