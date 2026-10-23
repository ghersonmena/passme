import { useRef, useState, type FormEvent } from 'react'
import { api } from '../api/client'
import { ErrorText, Field, PasswordField, PasswordStrength, Spinner } from '../components/ui'
import { AAD, deriveRecoveryKeys, isValidPhrase, rewrapUserKey, unlockUserKey } from '../crypto/keys'
import { errorMessage, useI18n } from '../i18n'
import { AuthLayout } from './AuthLayout'
import { masterPasswordProblem, MIN_MASTER_LENGTH } from './Register'

interface Props {
  initialEmail: string
  onDone: (email: string) => void
  onCancel: () => void
}

// Recuperación con la frase de 24 palabras: el servidor comprueba la frase (solo conoce un
// derivado de ella) y entrega la llave de usuario cifrada; el navegador la descifra y la vuelve
// a cifrar con la nueva contraseña maestra. Las bóvedas quedan intactas.
export function Recover({ initialEmail, onDone, onCancel }: Props) {
  const { t } = useI18n()
  const [step, setStep] = useState<'phrase' | 'password'>('phrase')
  const [email, setEmail] = useState(initialEmail)
  const [phrase, setPhrase] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState('')
  const recovery = useRef<{ token: string; encKey: CryptoKey; protectedUserKey: string } | null>(null)

  async function submitPhrase(e: FormEvent) {
    e.preventDefault()
    if (!isValidPhrase(phrase)) {
      setError(t('recover.invalidPhrase'))
      return
    }
    setError('')
    try {
      setBusy(t('login.checking'))
      const keys = await deriveRecoveryKeys(phrase)
      const result = await api.recover(email, keys.authKey)
      // Comprueba antes de pedir la contraseña nueva que la frase realmente abre la llave
      await unlockUserKey(keys.encKey, result.recoveryProtectedUserKey, AAD.userKeyRecovery)
      recovery.current = { token: result.token, encKey: keys.encKey, protectedUserKey: result.recoveryProtectedUserKey }
      setPhrase('')
      setStep('password')
    } catch (err) {
      setError(errorMessage(t, err))
    }
    setBusy(null)
  }

  async function submitPassword(e: FormEvent) {
    e.preventDefault()
    const problem = masterPasswordProblem(t, password, confirm)
    setError(problem)
    if (problem || !recovery.current) return
    try {
      setBusy(t('recover.saving'))
      const { token, encKey, protectedUserKey } = recovery.current
      const next = await rewrapUserKey(encKey, protectedUserKey, password, AAD.userKeyRecovery)
      await api.recoverReset(token, next)
      recovery.current = null
      onDone(email)
    } catch (err) {
      setError(errorMessage(t, err))
      setBusy(null)
    }
  }

  if (step === 'password') {
    return (
      <AuthLayout title={t('recover.newPasswordTitle')} subtitle={t('recover.newPasswordSubtitle')}>
        <form onSubmit={submitPassword} className="stack">
          <PasswordField
            label={t('field.newMasterPassword')}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
            autoFocus
            required
            hint={<PasswordStrength password={password} />}
          />
          <PasswordField
            label={t('field.confirmPassword')}
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            autoComplete="new-password"
            required
          />
          <p className="hint">{t('register.passwordHelp', { min: MIN_MASTER_LENGTH })}</p>
          <ErrorText>{error}</ErrorText>
          <button className="btn primary" disabled={!!busy}>
            {busy ? <Spinner label={busy} /> : t('recover.save')}
          </button>
        </form>
      </AuthLayout>
    )
  }

  return (
    <AuthLayout title={t('recover.title')} subtitle={t('recover.subtitle')}>
      <form onSubmit={submitPhrase} className="stack">
        <Field
          label={t('field.email')}
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="username"
          required
        />
        <div className="field">
          <label htmlFor="recovery-phrase">{t('recover.phrase')}</label>
          <textarea
            id="recovery-phrase"
            value={phrase}
            onChange={(e) => setPhrase(e.target.value)}
            rows={5}
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            required
          />
        </div>
        <ErrorText>{error}</ErrorText>
        <button className="btn primary" disabled={!!busy}>
          {busy ? <Spinner label={busy} /> : t('common.continue')}
        </button>
        <button type="button" className="btn link" onClick={onCancel}>
          {t('common.back')}
        </button>
      </form>
    </AuthLayout>
  )
}
