import { Download } from 'lucide-react'
import { useMemo, useState, type FormEvent } from 'react'
import { api, type ServerConfig } from '../api/client'
import { CopyButton, ErrorText, Field, PasswordField, PasswordStrength, Spinner } from '../components/ui'
import { estimatePasswordBits, randomInt, strengthFromBits } from '../crypto/generator'
import { createAccount, newRecoveryPhrase } from '../crypto/keys'
import { errorMessage, useI18n, type Translate } from '../i18n'
import { openSession, type Unlocked } from '../state/session'
import { AuthLayout } from './AuthLayout'

export const MIN_MASTER_LENGTH = 12

// Regla de la contraseña maestra: larga y que no salga "débil" en el medidor
export function masterPasswordProblem(t: Translate, password: string, confirm: string): string {
  if (password.length < MIN_MASTER_LENGTH) return t('register.tooShort', { min: MIN_MASTER_LENGTH })
  if (strengthFromBits(estimatePasswordBits(password)) === 'weak') return t('register.tooWeak')
  if (password !== confirm) return t('register.mismatch')
  return ''
}

interface Props {
  config: ServerConfig
  onUnlocked: (session: Unlocked) => void
  onCancel: () => void
}

type Step = 'form' | 'phrase' | 'verify'

export function Register({ config, onUnlocked, onCancel }: Props) {
  const { t } = useI18n()
  const [step, setStep] = useState<Step>('form')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [accepted, setAccepted] = useState(false)
  const [phrase] = useState(newRecoveryPhrase)
  const [saved, setSaved] = useState(false)
  const [answers, setAnswers] = useState<Record<number, string>>({})
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState('')

  const words = phrase.split(' ')
  // Tres posiciones al azar para comprobar que la frase quedó anotada
  const checks = useMemo(() => {
    const picked = new Set<number>()
    while (picked.size < 3) picked.add(randomInt(24))
    return [...picked].sort((a, b) => a - b)
  }, [])

  function submitForm(e: FormEvent) {
    e.preventDefault()
    const problem = masterPasswordProblem(t, password, confirm)
    setError(problem)
    if (!problem) setStep('phrase')
  }

  function downloadPhrase() {
    const text = `PassMe — ${t('register.phraseFileTitle')}\n${email}\n\n${words
      .map((w, i) => `${String(i + 1).padStart(2, ' ')}. ${w}`)
      .join('\n')}\n`
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }))
    const a = document.createElement('a')
    a.href = url
    a.download = 'passme-recovery-phrase.txt'
    a.click()
    URL.revokeObjectURL(url)
  }

  async function submitVerify(e: FormEvent) {
    e.preventDefault()
    const wrong = checks.some((i) => (answers[i] ?? '').trim().toLowerCase() !== words[i])
    if (wrong) {
      setError(t('register.verifyWrong'))
      return
    }
    setError('')
    try {
      setBusy(t('register.creating'))
      const { payload, encKey } = await createAccount(email.trim().toLowerCase(), password, phrase, t('vault.defaultName'))
      await api.register(payload)
      setBusy(t('login.opening'))
      onUnlocked(await openSession(await api.account(), encKey))
    } catch (err) {
      setError(errorMessage(t, err))
      setBusy(null)
      if ((err as { code?: string }).code === 'email_taken') setStep('form')
    }
  }

  if (step === 'phrase') {
    return (
      <AuthLayout title={t('register.phraseTitle')} subtitle={t('register.phraseSubtitle')}>
        <ol className="phrase-grid">
          {words.map((w, i) => (
            <li key={i}>
              <span className="phrase-n">{i + 1}</span>
              {w}
            </li>
          ))}
        </ol>
        <div className="row">
          <button type="button" className="btn" onClick={downloadPhrase}>
            <Download size={18} /> {t('register.download')}
          </button>
          <CopyButton value={phrase} />
        </div>
        <p className="warning">{t('register.phraseWarning')}</p>
        <label className="check">
          <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} />
          {t('register.phraseSaved')}
        </label>
        <div className="stack">
          <button className="btn primary" disabled={!saved} onClick={() => setStep('verify')}>
            {t('common.continue')}
          </button>
          <button type="button" className="btn link" onClick={() => setStep('form')}>
            {t('common.back')}
          </button>
        </div>
      </AuthLayout>
    )
  }

  if (step === 'verify') {
    return (
      <AuthLayout title={t('register.verifyTitle')} subtitle={t('register.verifySubtitle')}>
        <form onSubmit={submitVerify} className="stack">
          {checks.map((i, n) => (
            <Field
              key={i}
              label={t('register.wordN', { n: i + 1 })}
              value={answers[i] ?? ''}
              onChange={(e) => setAnswers((a) => ({ ...a, [i]: e.target.value }))}
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              autoFocus={n === 0}
              required
            />
          ))}
          <ErrorText>{error}</ErrorText>
          <button className="btn primary" disabled={!!busy}>
            {busy ? <Spinner label={busy} /> : t('register.create')}
          </button>
          <button type="button" className="btn link" disabled={!!busy} onClick={() => setStep('phrase')}>
            {t('register.showAgain')}
          </button>
        </form>
      </AuthLayout>
    )
  }

  return (
    <AuthLayout
      title={config.registration === 'first' ? t('register.adminTitle') : t('register.title')}
      subtitle={t('register.subtitle')}
    >
      <form onSubmit={submitForm} className="stack">
        <Field
          label={t('field.email')}
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="username"
          autoFocus
          required
        />
        <PasswordField
          label={t('field.masterPassword')}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="new-password"
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
        <label className="check">
          <input type="checkbox" checked={accepted} onChange={(e) => setAccepted(e.target.checked)} />
          {t('register.accept')}
        </label>
        <ErrorText>{error}</ErrorText>
        <button className="btn primary" disabled={!accepted}>
          {t('common.continue')}
        </button>
        <button type="button" className="btn link" onClick={onCancel}>
          {t('register.haveAccount')}
        </button>
      </form>
    </AuthLayout>
  )
}
