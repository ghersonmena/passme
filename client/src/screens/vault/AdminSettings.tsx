import { MailPlus, RotateCw, X } from 'lucide-react'
import { useEffect, useState, type FormEvent } from 'react'
import { api, type AdminOverview } from '../../api/client'
import { CopyButton, ErrorText, Field, Spinner } from '../../components/ui'
import { errorMessage, useI18n } from '../../i18n'

interface Sent {
  email: string
  link: string
  emailed: boolean
  mail: boolean
}

// Solo para el administrador: quién puede registrarse, invitaciones y usuarios del servidor
export function AdminSettings() {
  const { t, lang } = useI18n()
  const [data, setData] = useState<AdminOverview | null>(null)
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState<Sent | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const load = async () => setData(await api.admin())

  useEffect(() => {
    load().catch((err) => setError(errorMessage(t, err)))
  }, [])

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

  const invite = (address: string) =>
    run(async () => {
      const res = await api.createInvite(address, lang)
      setSent({ email: address, ...res })
      setEmail('')
      await load()
    })

  const submit = (e: FormEvent) => {
    e.preventDefault()
    void invite(email.trim().toLowerCase())
  }

  const date = (iso: string) => new Date(iso).toLocaleDateString(lang, { day: 'numeric', month: 'short', year: 'numeric' })

  if (!data) {
    return (
      <div className="card">
        <h3>{t('admin.title')}</h3>
        {error ? <ErrorText>{error}</ErrorText> : <Spinner />}
      </div>
    )
  }

  return (
    <div className="card">
      <h3>{t('admin.title')}</h3>

      <div className="inline-field">
        <span id="reg-label">{t('admin.registration')}</span>
        <div className="segmented" role="radiogroup" aria-labelledby="reg-label">
          {(['invite', 'open'] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              role="radio"
              aria-checked={data.registration === mode}
              className={data.registration === mode ? 'on' : ''}
              disabled={busy}
              onClick={() =>
                run(async () => {
                  await api.setRegistration(mode)
                  setData({ ...data, registration: mode })
                })
              }
            >
              {t(`admin.reg.${mode}`)}
            </button>
          ))}
        </div>
      </div>
      <p className="hint">{t(`admin.reg.${data.registration}Help`)}</p>

      <form className="with-action invite-form" onSubmit={submit}>
        <Field
          label={t('admin.inviteEmail')}
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="off"
          required
        />
        <button className="btn primary" disabled={busy}>
          {busy ? <Spinner /> : <MailPlus size={16} />} {t('admin.invite')}
        </button>
      </form>
      {!data.mail && <p className="hint">{t('admin.noMail')}</p>}
      <ErrorText>{error}</ErrorText>

      {sent && (
        <div className="invite-sent stack tight">
          {sent.emailed ? (
            <p className="ok">{t('admin.sent', { email: sent.email })}</p>
          ) : (
            <p className={sent.mail ? 'warning' : ''}>
              {sent.mail ? t('admin.mailFailed') : t('admin.shareLink', { email: sent.email })}
            </p>
          )}
          <div className="input-row">
            <input className="mono" readOnly value={sent.link} aria-label={t('admin.link')} onFocus={(e) => e.target.select()} />
            <CopyButton value={sent.link} />
          </div>
          <p className="hint">{t('admin.linkHelp')}</p>
        </div>
      )}

      {data.invitations.length > 0 && (
        <>
          <h4>{t('admin.pending')}</h4>
          <ul className="admin-list">
            {data.invitations.map((i) => (
              <li key={i.id}>
                <span className="admin-who">
                  {i.email}
                  <span className="hint">{t('admin.expires', { date: date(i.expiresAt) })}</span>
                </span>
                <button
                  className="icon-btn small"
                  onClick={() => void invite(i.email)}
                  disabled={busy}
                  aria-label={t('admin.resend', { email: i.email })}
                  title={t('admin.resendShort')}
                >
                  <RotateCw size={16} />
                </button>
                <button
                  className="icon-btn small"
                  onClick={() =>
                    run(async () => {
                      await api.revokeInvite(i.id)
                      if (sent?.email === i.email) setSent(null)
                      await load()
                    })
                  }
                  disabled={busy}
                  aria-label={t('admin.revoke', { email: i.email })}
                  title={t('admin.revokeShort')}
                >
                  <X size={16} />
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      <h4>{t('admin.users', { n: data.users.length })}</h4>
      <ul className="admin-list">
        {data.users.map((u) => (
          <li key={u.id}>
            <span className="admin-who">
              <span>
                {u.email}
                {u.isAdmin && <span className="badge">{t('settings.admin')}</span>}
                {u.totpEnabled && <span className="badge">2FA</span>}
              </span>
              <span className="hint">{t('admin.since', { date: date(u.createdAt) })}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}
