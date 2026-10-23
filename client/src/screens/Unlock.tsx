import { useState, type FormEvent } from 'react'
import { ApiError, type Account } from '../api/client'
import { PatternPad, PinPad } from '../components/QuickPads'
import { ErrorText, PasswordField, Spinner } from '../components/ui'
import { deriveMasterKeys } from '../crypto/kdf'
import { clearQuickRecord, loadQuickRecord, openQuickUnlock, PATTERN_MIN } from '../crypto/quickUnlock'
import { errorMessage, useI18n } from '../i18n'
import { openSession, openSessionWithKey, type Unlocked } from '../state/session'
import { AuthLayout } from './AuthLayout'

interface Props {
  account: Account
  onUnlocked: (session: Unlocked) => void
  onLogout: () => void
}

// La sesión con el servidor sigue abierta, pero las llaves se borraron de la memoria (bloqueo
// automático o recarga). Desbloquear es local: si la contraseña es incorrecta, el descifrado falla.
// Con el desbloqueo rápido activo se pide el PIN o el patrón; la contraseña siempre sirve.
export function Unlock({ account, onUnlocked, onLogout }: Props) {
  const { t } = useI18n()
  const [record, setRecord] = useState(() => loadQuickRecord(account))
  const [usePassword, setUsePassword] = useState(false)
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  // Cambia para reiniciar el teclado o el patrón tras un intento fallido
  const [attempt, setAttempt] = useState(0)

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

  async function quick(secret: string) {
    if (!record) return
    setError('')
    setBusy(true)
    try {
      const userKey = await openQuickUnlock(record, secret)
      onUnlocked(await openSessionWithKey(account, userKey))
    } catch (err) {
      if (err instanceof ApiError && err.code === 'wrong_pin') {
        setError(t('quickUnlock.wrong', { n: err.extra.attemptsLeft ?? 0 }))
      } else if (err instanceof ApiError && err.code === 'quick_unlock_off') {
        // Se agotaron los intentos: a partir de aquí solo con la contraseña maestra
        clearQuickRecord()
        setRecord(null)
        setError(t('quickUnlock.off'))
      } else {
        setError(errorMessage(t, err))
      }
      setAttempt((n) => n + 1)
      setBusy(false)
    }
  }

  const quickMode = record && !usePassword

  return (
    <AuthLayout title={t('unlock.title')} subtitle={account.email}>
      {quickMode ? (
        <div className="stack quick-unlock">
          <p className="quick-prompt">
            {record.method === 'pin' ? t('quickUnlock.enterPin') : t('quickUnlock.drawPattern')}
          </p>
          {record.method === 'pin' ? (
            <PinPad key={attempt} busy={busy} onComplete={(pin) => void quick(pin)} />
          ) : (
            <PatternPad
              key={attempt}
              busy={busy}
              onComplete={(pattern) => void quick(pattern)}
              onTooShort={() => setError(t('quickUnlock.tooShort', { n: PATTERN_MIN }))}
            />
          )}
          <div className="quick-status">{busy ? <Spinner label={t('login.checking')} /> : <ErrorText>{error}</ErrorText>}</div>
          <button type="button" className="btn link" onClick={() => setUsePassword(true)} disabled={busy}>
            {t('quickUnlock.usePassword')}
          </button>
        </div>
      ) : (
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
          {record && (
            <button
              type="button"
              className="btn link"
              onClick={() => {
                setError('')
                setUsePassword(false)
              }}
            >
              {record.method === 'pin' ? t('quickUnlock.backToPin') : t('quickUnlock.backToPattern')}
            </button>
          )}
        </form>
      )}
      <button type="button" className="btn link" onClick={onLogout} disabled={busy}>
        {t('unlock.logout')}
      </button>
    </AuthLayout>
  )
}
