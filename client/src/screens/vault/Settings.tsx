import { Download, LogOut, Monitor, Moon, ShieldCheck, ShieldOff, Sun } from 'lucide-react'
import QRCode from 'qrcode'
import { useState, type FormEvent } from 'react'
import { api, type Account } from '../../api/client'
import { CopyButton, ErrorText, Field, PasswordField, PasswordStrength, Spinner } from '../../components/ui'
import { deriveMasterKeys } from '../../crypto/kdf'
import { rewrapUserKey } from '../../crypto/keys'
import { errorMessage, useI18n } from '../../i18n'
import { LOCK_OPTIONS, type Lang, type Prefs, type Theme } from '../../state/prefs'
import { masterPasswordProblem, MIN_MASTER_LENGTH } from '../Register'
import { QuickUnlockSettings } from './QuickUnlockSettings'
import { loadQuickRecord } from '../../crypto/quickUnlock'
import type { Item } from '../../crypto/items'
import type { OpenVault, Unlocked } from '../../state/session'
import { TransferSettings } from './Transfer'

const SOURCE_URL = 'https://github.com/ghersonmena/passme'

const THEMES: { value: Theme; icon: typeof Sun }[] = [
  { value: 'system', icon: Monitor },
  { value: 'light', icon: Sun },
  { value: 'dark', icon: Moon }
]

interface Props {
  session: Unlocked
  items: Item[]
  onImported: (vaults: OpenVault[], items: Item[]) => void
  prefs: Prefs
  onPrefs: (prefs: Prefs) => void
  onAccountChanged: () => Promise<void>
  onLogout: () => void
}

export function Settings({ session, items, onImported, prefs, onPrefs, onAccountChanged, onLogout }: Props) {
  const { t } = useI18n()
  const { account } = session
  return (
    <section className="page settings">
      <h2>{t('settings.title')}</h2>

      <div className="card">
        <h3>{t('settings.device')}</h3>
        <label className="inline-field">
          <span>{t('settings.language')}</span>
          <select value={prefs.lang} onChange={(e) => onPrefs({ ...prefs, lang: e.target.value as Lang })}>
            <option value="es">Español</option>
            <option value="en">English</option>
          </select>
        </label>
        <div className="inline-field">
          <span id="theme-label">{t('settings.theme')}</span>
          <div className="segmented" role="radiogroup" aria-labelledby="theme-label">
            {THEMES.map(({ value, icon: Icon }) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={prefs.theme === value}
                className={prefs.theme === value ? 'on' : ''}
                onClick={() => onPrefs({ ...prefs, theme: value })}
              >
                <Icon size={16} aria-hidden /> {t(`settings.theme.${value}`)}
              </button>
            ))}
          </div>
        </div>
        <label className="inline-field">
          <span>{t('settings.autoLock')}</span>
          <select
            value={prefs.lockMinutes}
            onChange={(e) => onPrefs({ ...prefs, lockMinutes: Number(e.target.value) })}
          >
            {LOCK_OPTIONS.map((m) => (
              <option key={m} value={m}>
                {t('settings.minutes', { n: m })}
              </option>
            ))}
          </select>
        </label>
        <p className="hint">{t('settings.autoLockHelp')}</p>
      </div>

      <TransferSettings session={session} items={items} onImported={onImported} />
      <QuickUnlockSettings account={account} />
      <TwoFactor account={account} onChanged={onAccountChanged} />
      <ChangePassword account={account} onChanged={onAccountChanged} />

      <div className="card">
        <h3>{t('settings.account')}</h3>
        <p>
          {account.email}
          {account.isAdmin && <span className="badge">{t('settings.admin')}</span>}
        </p>
        <button className="btn" onClick={onLogout}>
          <LogOut size={16} /> {t('settings.logout')}
        </button>
      </div>

      <div className="card">
        <h3>{t('settings.about')}</h3>
        <p className="muted">
          PassMe v{__APP_VERSION__} · {t('settings.license')}
          <br />
          <a href={SOURCE_URL} target="_blank" rel="noopener noreferrer">
            {t('settings.sourceCode')}
          </a>
        </p>
      </div>
    </section>
  )
}

type TotpStep = 'idle' | 'password' | 'scan' | 'codes' | 'disable'

function TwoFactor({ account, onChanged }: { account: Account; onChanged: () => Promise<void> }) {
  const { t } = useI18n()
  const [step, setStep] = useState<TotpStep>('idle')
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [setup, setSetup] = useState<{ secret: string; qr: string } | null>(null)
  const [codes, setCodes] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  function reset() {
    setStep('idle')
    setPassword('')
    setCode('')
    setSetup(null)
    setError('')
    setBusy(false)
  }

  async function run(action: () => Promise<void>) {
    setError('')
    setBusy(true)
    try {
      await action()
    } catch (err) {
      setError(errorMessage(t, err))
    }
    setBusy(false)
  }

  const authKey = async () => (await deriveMasterKeys(password, account.kdf)).authKey

  const startSetup = (e: FormEvent) => {
    e.preventDefault()
    void run(async () => {
      const result = await api.totpSetup(await authKey())
      setPassword('')
      setSetup({ secret: result.secret, qr: await QRCode.toDataURL(result.uri, { margin: 1, width: 220 }) })
      setStep('scan')
    })
  }

  const confirmSetup = (e: FormEvent) => {
    e.preventDefault()
    void run(async () => {
      const result = await api.totpEnable(code.trim())
      setCodes(result.backupCodes)
      setSetup(null)
      setCode('')
      setStep('codes')
      await onChanged()
    })
  }

  const disable = (e: FormEvent) => {
    e.preventDefault()
    void run(async () => {
      await api.totpDisable(await authKey(), code.trim())
      reset()
      await onChanged()
    })
  }

  function downloadCodes() {
    const text = `PassMe — ${t('totp.backupTitle')}\n${account.email}\n\n${codes.join('\n')}\n`
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }))
    const a = document.createElement('a')
    a.href = url
    a.download = 'passme-backup-codes.txt'
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="card">
      <h3>{t('totp.title')}</h3>
      {step === 'idle' && (
        <>
          <p className={account.totpEnabled ? 'ok' : 'muted'}>
            {account.totpEnabled ? t('totp.enabled', { n: account.backupCodesLeft }) : t('totp.disabledHelp')}
          </p>
          {account.totpEnabled ? (
            <button className="btn" onClick={() => setStep('disable')}>
              <ShieldOff size={16} /> {t('totp.disable')}
            </button>
          ) : (
            <button className="btn primary" onClick={() => setStep('password')}>
              <ShieldCheck size={16} /> {t('totp.enable')}
            </button>
          )}
        </>
      )}

      {step === 'password' && (
        <form className="stack" onSubmit={startSetup}>
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
            <button type="button" className="btn" onClick={reset}>
              {t('common.cancel')}
            </button>
            <button className="btn primary" disabled={busy}>
              {busy ? <Spinner /> : t('common.continue')}
            </button>
          </div>
        </form>
      )}

      {step === 'scan' && setup && (
        <form className="stack" onSubmit={confirmSetup}>
          <p>{t('totp.scan')}</p>
          <img className="qr" src={setup.qr} alt={t('totp.qrAlt')} width={220} height={220} />
          <dl className="field-view">
            <dt>{t('totp.manual')}</dt>
            <dd>
              <span className="value mono">{setup.secret.match(/.{1,4}/g)?.join(' ')}</span>
              <CopyButton value={setup.secret} />
            </dd>
          </dl>
          <Field
            label={t('totp.code')}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="\d{6}"
            maxLength={6}
            required
          />
          <ErrorText>{error}</ErrorText>
          <div className="row end">
            <button type="button" className="btn" onClick={reset}>
              {t('common.cancel')}
            </button>
            <button className="btn primary" disabled={busy}>
              {busy ? <Spinner /> : t('totp.activate')}
            </button>
          </div>
        </form>
      )}

      {step === 'codes' && (
        <div className="stack">
          <p className="warning">{t('totp.backupHelp')}</p>
          <ul className="backup-codes mono">
            {codes.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
          <div className="row">
            <button className="btn" onClick={downloadCodes}>
              <Download size={16} /> {t('register.download')}
            </button>
            <CopyButton value={codes.join('\n')} />
          </div>
          <button
            className="btn primary"
            onClick={() => {
              setCodes([])
              reset()
            }}
          >
            {t('totp.savedCodes')}
          </button>
        </div>
      )}

      {step === 'disable' && (
        <form className="stack" onSubmit={disable}>
          <PasswordField
            label={t('field.masterPassword')}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            autoFocus
            required
          />
          <Field
            label={t('totp.codeOrBackup')}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            autoComplete="one-time-code"
            maxLength={20}
            required
          />
          <ErrorText>{error}</ErrorText>
          <div className="row end">
            <button type="button" className="btn" onClick={reset}>
              {t('common.cancel')}
            </button>
            <button className="btn danger" disabled={busy}>
              {busy ? <Spinner /> : t('totp.disable')}
            </button>
          </div>
        </form>
      )}
    </div>
  )
}

function ChangePassword({ account, onChanged }: { account: Account; onChanged: () => Promise<void> }) {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const [current, setCurrent] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    const problem = masterPasswordProblem(t, password, confirm)
    setError(problem)
    if (problem) return
    setBusy(true)
    try {
      const old = await deriveMasterKeys(current, account.kdf)
      const next = await rewrapUserKey(old.encKey, account.protectedUserKey, password)
      // El PIN de este dispositivo se conserva; el de los demás se revoca
      await api.changePassword(old.authKey, next, loadQuickRecord(account)?.deviceId)
      setCurrent('')
      setPassword('')
      setConfirm('')
      setOpen(false)
      setDone(true)
      await onChanged()
    } catch (err) {
      setError(errorMessage(t, err))
    }
    setBusy(false)
  }

  return (
    <div className="card">
      <h3>{t('password.title')}</h3>
      {done && <p className="ok">{t('password.changed')}</p>}
      {!open ? (
        <button
          className="btn"
          onClick={() => {
            setOpen(true)
            setDone(false)
          }}
        >
          {t('password.change')}
        </button>
      ) : (
        <form className="stack" onSubmit={submit}>
          <PasswordField
            label={t('field.currentPassword')}
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            autoComplete="current-password"
            autoFocus
            required
          />
          <PasswordField
            label={t('field.newMasterPassword')}
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
          <p className="hint">
            {t('register.passwordHelp', { min: MIN_MASTER_LENGTH })} {t('password.otherSessions')}
          </p>
          <ErrorText>{error}</ErrorText>
          <div className="row end">
            <button type="button" className="btn" onClick={() => setOpen(false)}>
              {t('common.cancel')}
            </button>
            <button className="btn primary" disabled={busy}>
              {busy ? <Spinner /> : t('password.change')}
            </button>
          </div>
        </form>
      )}
    </div>
  )
}
