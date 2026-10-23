import { ArrowLeft, Plus, RefreshCw, X } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { ErrorText, Field, PasswordField, PasswordStrength, Spinner } from '../../components/ui'
import { generatePassword } from '../../crypto/generator'
import { emptyLogin, type LoginData } from '../../crypto/items'
import { errorMessage, useI18n } from '../../i18n'

export const DEFAULT_GENERATED = {
  length: 20,
  lower: true,
  upper: true,
  digits: true,
  symbols: true,
  avoidAmbiguous: false
}

interface Props {
  initial: LoginData | null
  onSave: (data: LoginData) => Promise<void>
  onCancel: () => void
}

export function ItemEditor({ initial, onSave, onCancel }: Props) {
  const { t } = useI18n()
  const [data, setData] = useState<LoginData>(() => {
    const base = initial ?? emptyLogin()
    return { ...base, urls: base.urls.length ? base.urls : [''] }
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const set = <K extends keyof LoginData>(key: K, value: LoginData[K]) => setData((d) => ({ ...d, [key]: value }))
  const setUrl = (i: number, value: string) => set('urls', data.urls.map((u, j) => (j === i ? value : u)))

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError('')
    setBusy(true)
    try {
      await onSave({ ...data, name: data.name.trim(), urls: data.urls.map((u) => u.trim()).filter(Boolean) })
    } catch (err) {
      setError(errorMessage(t, err))
      setBusy(false)
    }
  }

  return (
    <form className="detail editor" onSubmit={submit}>
      <header className="detail-header">
        <button type="button" className="icon-btn back-btn" onClick={onCancel} aria-label={t('common.back')}>
          <ArrowLeft size={20} />
        </button>
        <h2>{initial ? t('item.editTitle') : t('item.newTitle')}</h2>
      </header>

      <div className="stack">
        <Field
          label={t('field.name')}
          value={data.name}
          onChange={(e) => set('name', e.target.value)}
          autoFocus={!initial}
          required
          maxLength={200}
        />
        <Field
          label={t('field.username')}
          value={data.username}
          onChange={(e) => set('username', e.target.value)}
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
        />
        <div className="with-action">
          <PasswordField
            label={t('field.password')}
            value={data.password}
            onChange={(e) => set('password', e.target.value)}
            autoComplete="new-password"
            hint={<PasswordStrength password={data.password} />}
          />
          <button
            type="button"
            className="btn"
            onClick={() => set('password', generatePassword(DEFAULT_GENERATED))}
            title={t('generator.generate')}
          >
            <RefreshCw size={16} /> {t('generator.generate')}
          </button>
        </div>

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
                autoCapitalize="off"
                spellCheck={false}
                aria-label={t('field.website')}
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

        <div className="field">
          <label htmlFor="item-note">{t('field.note')}</label>
          <textarea id="item-note" rows={4} value={data.note} onChange={(e) => set('note', e.target.value)} />
        </div>

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
