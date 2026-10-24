import { Grid3x3, KeyRound } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import type { Account } from '../../api/client'
import { PatternPad, PinPad } from '../../components/QuickPads'
import { ErrorText, Modal, PasswordField, Spinner } from '../../components/ui'
import { deriveMasterKeys, type DerivedKeys } from '../../crypto/kdf'
import { unlockUserKey } from '../../crypto/keys'
import {
  disableQuickUnlock,
  enableQuickUnlock,
  isWeakPin,
  loadQuickRecord,
  PATTERN_MIN,
  type QuickMethod,
  type QuickRecord
} from '../../crypto/quickUnlock'
import { errorMessage, useI18n } from '../../i18n'

export function QuickUnlockSettings({ account }: { account: Account }) {
  const { t } = useI18n()
  const [record, setRecord] = useState(() => loadQuickRecord(account))
  const [setup, setSetup] = useState<QuickMethod | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function disable() {
    setError('')
    setBusy(true)
    try {
      await disableQuickUnlock(record!)
      setRecord(null)
    } catch (err) {
      setError(errorMessage(t, err))
    }
    setBusy(false)
  }

  return (
    <div className="card">
      <h3>{t('quickUnlock.title')}</h3>
      {record ? (
        <>
          <p>{record.method === 'pin' ? t('quickUnlock.onPin') : t('quickUnlock.onPattern')}</p>
          <div className="row">
            <button className="btn" onClick={() => setSetup(record.method === 'pin' ? 'pattern' : 'pin')} disabled={busy}>
              {record.method === 'pin' ? <Grid3x3 size={16} /> : <KeyRound size={16} />}
              {record.method === 'pin' ? t('quickUnlock.switchToPattern') : t('quickUnlock.switchToPin')}
            </button>
            <button className="btn" onClick={() => setSetup(record.method)} disabled={busy}>
              {record.method === 'pin' ? t('quickUnlock.changePin') : t('quickUnlock.changePattern')}
            </button>
            <button className="btn danger" onClick={() => void disable()} disabled={busy}>
              {busy ? <Spinner /> : t('quickUnlock.disable')}
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="hint">{t('quickUnlock.help')}</p>
          <div className="row">
            <button className="btn" onClick={() => setSetup('pin')}>
              <KeyRound size={16} /> {t('quickUnlock.usePin')}
            </button>
            <button className="btn" onClick={() => setSetup('pattern')}>
              <Grid3x3 size={16} /> {t('quickUnlock.usePattern')}
            </button>
          </div>
        </>
      )}
      <ErrorText>{error}</ErrorText>
      {setup && (
        <QuickSetup
          account={account}
          method={setup}
          previous={record}
          onClose={() => setSetup(null)}
          onDone={(next) => {
            setRecord(next)
            setSetup(null)
          }}
        />
      )}
    </div>
  )
}

type Step = { name: 'password' } | { name: 'create' } | { name: 'confirm'; first: string } | { name: 'saving' }

function QuickSetup({
  account,
  method,
  previous,
  onClose,
  onDone
}: {
  account: Account
  method: QuickMethod
  previous: QuickRecord | null
  onClose: () => void
  onDone: (record: QuickRecord) => void
}) {
  const { t } = useI18n()
  const [step, setStep] = useState<Step>({ name: 'password' })
  const [password, setPassword] = useState('')
  // Las llaves de la contraseña maestra, ya comprobadas, en vez de guardar la contraseña
  const [master, setMaster] = useState<DerivedKeys | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const pin = method === 'pin'

  async function checkPassword(e: FormEvent) {
    e.preventDefault()
    setError('')
    setBusy(true)
    try {
      const keys = await deriveMasterKeys(password, account.kdf)
      // Si la contraseña es incorrecta, el descifrado falla aquí
      await unlockUserKey(keys.encKey, account.protectedUserKey)
      setMaster(keys)
      setPassword('')
      setStep({ name: 'create' })
    } catch (err) {
      setError(errorMessage(t, err))
    }
    setBusy(false)
  }

  function restart(message: string) {
    setError(message)
    setAttempt((n) => n + 1)
    setStep({ name: 'create' })
  }

  async function entered(secret: string) {
    setError('')
    if (step.name === 'create') {
      if (pin && isWeakPin(secret)) return restart(t('quickUnlock.weakPin'))
      setAttempt((n) => n + 1)
      setStep({ name: 'confirm', first: secret })
      return
    }
    if (step.name !== 'confirm') return
    if (secret !== step.first) return restart(t('quickUnlock.mismatch'))
    setStep({ name: 'saving' })
    try {
      onDone(await enableQuickUnlock(account, master!, method, secret, previous))
    } catch (err) {
      restart(errorMessage(t, err))
    }
  }

  const prompt =
    step.name === 'create'
      ? pin
        ? t('quickUnlock.createPin')
        : t('quickUnlock.createPattern', { n: PATTERN_MIN })
      : pin
        ? t('quickUnlock.confirmPin')
        : t('quickUnlock.confirmPattern')

  return (
    <Modal title={pin ? t('quickUnlock.setupPin') : t('quickUnlock.setupPattern')} onClose={onClose}>
      {step.name === 'password' ? (
        <form className="stack" onSubmit={checkPassword}>
          <p className="hint">{t('quickUnlock.passwordFirst')}</p>
          <PasswordField
            label={t('field.masterPassword')}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            autoFocus
            required
          />
          <ErrorText>{error}</ErrorText>
          <div className="row end">
            <button type="button" className="btn" onClick={onClose} disabled={busy}>
              {t('common.cancel')}
            </button>
            <button className="btn primary" disabled={busy}>
              {busy ? <Spinner label={t('login.deriving')} /> : t('common.continue')}
            </button>
          </div>
        </form>
      ) : (
        <div className="stack quick-unlock">
          <p className="quick-prompt">{step.name === 'saving' ? t('quickUnlock.saving') : prompt}</p>
          {pin ? (
            <PinPad key={attempt} busy={step.name === 'saving'} onComplete={(s) => void entered(s)} />
          ) : (
            <PatternPad
              key={attempt}
              busy={step.name === 'saving'}
              onComplete={(s) => void entered(s)}
              onTooShort={() => setError(t('quickUnlock.tooShort', { n: PATTERN_MIN }))}
            />
          )}
          <div className="quick-status">{step.name === 'saving' ? <Spinner /> : <ErrorText>{error}</ErrorText>}</div>
        </div>
      )}
    </Modal>
  )
}
