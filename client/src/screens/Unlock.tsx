import { useState, type FormEvent } from 'react'
import type { Account } from '../api/client'
import { ErrorText, PasswordField, Spinner } from '../components/ui'
import { deriveMasterKeys } from '../crypto/kdf'
import { errorMessage, useI18n } from '../i18n'
import { openSession, type Unlocked } from '../state/session'
import { AuthLayout } from './AuthLayout'

interface Props {
  account: Account
  onUnlocked: (session: Unlocked) => void
  onLogout: () => void
}

// La sesión con el servidor sigue abierta, pero las llaves se borraron de la memoria (bloqueo
// automático o recarga). Desbloquear es local: si la contraseña es incorrecta, el descifrado falla.
export function Unlock({ account, onUnlocked, onLogout }: Props) {
  const { t } = useI18n()
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError('')
    setBusy(true)
    try {
      const keys = await deriveMasterKeys(password, account.kdf)
      onUnlocked(await openSession(account, keys.encKey))
    } catch (err) {
      setError(errorMessage(t, err))
      setPassword('')
      setBusy(false)
    }
  }

  return (
    <AuthLayout title={t('unlock.title')} subtitle={account.email}>
      <form onSubmit={submit} className="stack">
        <PasswordField
          label={t('field.masterPassword')}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          autoFocus
          required
        />
        <ErrorText>{error}</ErrorText>
        <button className="btn primary" disabled={busy}>
          {busy ? <Spinner label={t('login.deriving')} /> : t('unlock.submit')}
        </button>
        <button type="button" className="btn link" onClick={onLogout}>
          {t('unlock.logout')}
        </button>
      </form>
    </AuthLayout>
  )
}
