import { LockKeyhole, Share2 } from 'lucide-react'
import { useEffect, useState, type FormEvent } from 'react'
import { api, ApiError, type PublicShare } from '../api/client'
import { ErrorText, Field, Logo, Spinner } from '../components/ui'
import type { Item } from '../crypto/items'
import { linkAuth } from '../crypto/share'
import { errorMessage, useI18n } from '../i18n'
import { AuthLayout } from './AuthLayout'
import { ItemDetail } from './vault/ItemDetail'

interface Props {
  id: string
  // El secreto del enlace (lo que va después del "#")
  secret: string
}

interface Opened {
  item: Item
  from: string
  expiresAt: string
}

// Para quien recibió un enlace y no tiene cuenta: con el PIN se descifra la credencial aquí mismo
export function ExternalShare({ id, secret }: Props) {
  const { t, lang } = useI18n()
  const [info, setInfo] = useState<PublicShare | null>(null)
  const [gone, setGone] = useState(false)
  const [pin, setPin] = useState('')
  const [opened, setOpened] = useState<Opened | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    api.publicShare(id).then(setInfo, (err) => {
      if (err instanceof ApiError && err.status === 404) setGone(true)
      else setError(errorMessage(t, err))
    })
  }, [id])

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!info) return
    setError('')
    setBusy(true)
    try {
      const auth = await linkAuth(secret, pin.trim(), info.pinKdf)
      const res = await api.openPublicShare(id, auth.pinAuth)
      const data = await auth.open(id, res.recipientKey, res.data)
      setOpened({
        item: { id, vaultId: '', revision: 0, createdAt: res.updatedAt, updatedAt: res.updatedAt, trashedAt: null, data },
        from: res.from,
        expiresAt: res.expiresAt
      })
      setPin('')
    } catch (err) {
      if (err instanceof ApiError && err.code === 'wrong_pin') {
        setError(t('external.wrongPin', { n: err.extra.attemptsLeft ?? 0 }))
      } else if (err instanceof ApiError && err.code === 'share_locked') {
        setInfo({ ...info, locked: true })
      } else if (err instanceof ApiError && err.status === 404) {
        setGone(true)
      } else {
        // El secreto del enlace está incompleto (se copió mal) o no corresponde
        setError(t('external.badLink'))
      }
    }
    setBusy(false)
  }

  const date = (iso: string) => new Date(iso).toLocaleString(lang, { dateStyle: 'long', timeStyle: 'short' })

  if (opened) {
    return (
      <main className="external-view">
        <header className="external-header">
          <Logo size={32} />
          <span>PassMe</span>
        </header>
        <p className="notice shared-banner">
          <Share2 size={16} aria-hidden />
          <span>{t('external.from', { email: opened.from, date: date(opened.expiresAt) })}</span>
        </p>
        <ItemDetail
          item={opened.item}
          vault={null}
          readOnly
          onBack={() => setOpened(null)}
          onEdit={() => {}}
          onToggleFavorite={() => {}}
          onUpdate={() => {}}
          onTrash={() => {}}
          onRestore={() => {}}
          onDeleteForever={() => {}}
        />
        <p className="hint">{t('external.saveHint')}</p>
        <button className="btn" onClick={() => setOpened(null)}>
          <LockKeyhole size={16} /> {t('external.hide')}
        </button>
      </main>
    )
  }

  return (
    <AuthLayout title={t('external.title')} subtitle={t('external.subtitle')}>
      {gone ? (
        <p className="notice">{t('external.gone')}</p>
      ) : !info ? (
        error ? <ErrorText>{error}</ErrorText> : <Spinner label={t('common.loading')} />
      ) : info.locked ? (
        <p className="warning">{t('external.locked')}</p>
      ) : (
        <form className="stack" onSubmit={submit}>
          <Field
            label={t('external.pin')}
            value={pin}
            onChange={(e) => setPin(e.target.value)}
            inputMode="numeric"
            autoComplete="off"
            className="mono"
            maxLength={12}
            autoFocus
            required
          />
          <ErrorText>{error}</ErrorText>
          <button className="btn primary" disabled={busy || pin.trim().length < 4}>
            {busy ? <Spinner label={t('external.opening')} /> : t('external.open')}
          </button>
          <p className="hint">{t('external.expires', { date: date(info.expiresAt) })}</p>
        </form>
      )}
    </AuthLayout>
  )
}
