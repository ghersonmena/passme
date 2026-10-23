import { useRef, useState, type FormEvent } from 'react'
import { api, type ServerConfig } from '../api/client'
import { ErrorText, Field, PasswordField, Spinner } from '../components/ui'
import { deriveMasterKeys } from '../crypto/kdf'
import { errorMessage, useI18n } from '../i18n'
import { openSession, type Unlocked } from '../state/session'
import { AuthLayout } from './AuthLayout'

interface Props {
  config: ServerConfig
  initialEmail: string
  notice?: string
  onUnlocked: (session: Unlocked) => void
  onRegister: () => void
  onRecover: () => void
}

export function Login({ config, initialEmail, notice, onUnlocked, onRegister, onRecover }: Props) {
  const { t } = useI18n()
  const [step, setStep] = useState<'credentials' | 'mfa'>('credentials')
  const [email, setEmail] = useState(initialEmail)
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState('')
  // La llave de cifrado se deriva una sola vez y se usa al terminar el 2FA
  const encKey = useRef<CryptoKey | null>(null)

  async function finish() {
    setBusy(t('login.opening'))
    const account = await api.account()
    const session = await openSession(account, encKey.current!)
    encKey.current = null
    onUnlocked(session)
  }

  async function submitCredentials(e: FormEvent) {
    e.preventDefault()
    setError('')
    try {
      setBusy(t('login.deriving'))
      const { kdf } = await api.prelogin(email)
      const keys = await deriveMasterKeys(password, kdf)
      setBusy(t('login.checking'))
      const result = await api.login(email, keys.authKey)
      encKey.current = keys.encKey
      setPassword('')
      if (result.mfaRequired) {
        setStep('mfa')
        setBusy(null)
        return
      }
      await finish()
    } catch (err) {
      setError(errorMessage(t, err))
      setBusy(null)
    }
  }

  async function submitCode(e: FormEvent) {
    e.preventDefault()
    setError('')
    try {
      setBusy(t('login.checking'))
      await api.loginMfa(code)
      await finish()
    } catch (err) {
      setError(errorMessage(t, err))
      setCode('')
      setBusy(null)
      // La sesión pendiente venció o se agotaron los intentos: hay que empezar de nuevo
      if ((err as { code?: string }).code === 'mfa_expired') {
        encKey.current = null
        setStep('credentials')
      }
    }
  }

  if (step === 'mfa') {
    return (
      <AuthLayout title={t('login.mfaTitle')} subtitle={t('login.mfaSubtitle')}>
        <form onSubmit={submitCode} className="stack">
          <Field
            label={t('login.code')}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            inputMode="text"
            autoComplete="one-time-code"
            autoFocus
            required
            maxLength={20}
          />
          <ErrorText>{error}</ErrorText>
          <button className="btn primary" disabled={!!busy || code.trim().length < 6}>
            {busy ? <Spinner label={busy} /> : t('login.verify')}
          </button>
          <button
            type="button"
            className="btn link"
            onClick={() => {
              encKey.current = null
              setStep('credentials')
              setError('')
            }}
          >
            {t('common.back')}
          </button>
        </form>
      </AuthLayout>
    )
  }

  return (
    <AuthLayout title={t('login.title')} subtitle={t('login.subtitle')}>
      {notice && <p className="notice">{notice}</p>}
      <form onSubmit={submitCredentials} className="stack">
        <Field
          label={t('field.email')}
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="username"
          autoFocus={!initialEmail}
          required
        />
        <PasswordField
          label={t('field.masterPassword')}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          autoFocus={!!initialEmail}
          required
        />
        <ErrorText>{error}</ErrorText>
        <button className="btn primary" disabled={!!busy}>
          {busy ? <Spinner label={busy} /> : t('login.submit')}
        </button>
      </form>
      <div className="auth-links">
        <button type="button" className="btn link" onClick={onRecover}>
          {t('login.forgot')}
        </button>
        {config.registration !== 'closed' && (
          <button type="button" className="btn link" onClick={onRegister}>
            {config.registration === 'first' ? t('login.createAdmin') : t('login.createAccount')}
          </button>
        )}
      </div>
    </AuthLayout>
  )
}
