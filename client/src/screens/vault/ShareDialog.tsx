import { Link2, Mail, Share2, UserRound, X } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import type { OutgoingShare } from '../../api/client'
import { CopyButton, ErrorText, Field, Modal, Spinner } from '../../components/ui'
import type { Item } from '../../crypto/items'
import { randomPin } from '../../crypto/share'
import { errorMessage, useI18n } from '../../i18n'
import type { Unlocked } from '../../state/session'
import { shareByLink, shareWithUser } from '../../state/shares'

const DAYS = [1, 7, 30] as const

type Step = { name: 'form' } | { name: 'external'; email: string } | { name: 'link'; email: string; link: string; pin: string }

interface Props {
  session: Unlocked
  item: Item
  // Con quién está compartido ya este elemento
  shares: OutgoingShare[]
  onChanged: () => Promise<void>
  onRevoke: (share: OutgoingShare) => Promise<void>
  onClose: () => void
}

export function ShareDialog({ session, item, shares, onChanged, onRevoke, onClose }: Props) {
  const { t, lang } = useI18n()
  const [step, setStep] = useState<Step>({ name: 'form' })
  const [email, setEmail] = useState('')
  const [pin, setPin] = useState(randomPin)
  const [days, setDays] = useState<number>(7)
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

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

  // Primero se busca el correo: si tiene cuenta se comparte ya; si no, se pide PIN y vigencia
  const submit = (e: FormEvent) => {
    e.preventDefault()
    const address = email.trim().toLowerCase()
    void run(async () => {
      setNotice('')
      const res = await shareWithUser(session, item, address, lang)
      if (res.kind === 'external') {
        setStep({ name: 'external', email: address })
        return
      }
      setEmail('')
      setNotice(t(res.emailed ? 'share.doneUserMail' : 'share.doneUser', { email: address }))
      await onChanged()
    })
  }

  const createLink = (e: FormEvent) => {
    e.preventDefault()
    if (step.name !== 'external') return
    void run(async () => {
      const link = await shareByLink(session, item, step.email, pin, days)
      setStep({ name: 'link', email: step.email, link, pin })
      setEmail('')
      await onChanged()
    })
  }

  const date = (iso: string) => new Date(iso).toLocaleDateString(lang, { day: 'numeric', month: 'short', year: 'numeric' })

  function status(s: OutgoingShare): string {
    if (s.kind === 'user') return s.seenAt ? t('share.statusSeen') : t('share.statusPending')
    if (s.locked) return t('share.statusLocked')
    if (s.expiresAt && new Date(s.expiresAt) < new Date()) return t('share.statusExpired')
    const views = s.views ? t('share.views', { n: s.views }) : t('share.notOpened')
    return `${views} · ${t('share.expires', { date: date(s.expiresAt!) })}`
  }

  // El enlace va por correo desde la app de correo de quien comparte; el PIN, por otro medio
  const mailto = (to: string, link: string) =>
    `mailto:${to}?subject=${encodeURIComponent(t('share.mailSubject', { name: item.data.name }))}&body=${encodeURIComponent(
      t('share.mailBody', { name: item.data.name, link })
    )}`

  return (
    <Modal title={t('share.title', { name: item.data.name || t('item.untitled') })} onClose={onClose}>
      {step.name === 'form' && (
        <form className="stack" onSubmit={submit}>
          <p className="hint">{t('share.help')}</p>
          <div className="with-action">
            <Field
              label={t('share.email')}
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="off"
              required
              autoFocus
            />
            <button className="btn primary" disabled={busy}>
              {busy ? <Spinner /> : <Share2 size={16} />} {t('share.submit')}
            </button>
          </div>
          {notice && <p className="ok">{notice}</p>}
        </form>
      )}

      {step.name === 'external' && (
        <form className="stack" onSubmit={createLink}>
          <p className="notice">{t('share.external', { email: step.email })}</p>
          <Field
            label={t('share.pin')}
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\s/g, ''))}
            inputMode="numeric"
            minLength={4}
            maxLength={12}
            className="mono"
            autoComplete="off"
            hint={t('share.pinHelp')}
            required
          />
          <div className="field">
            <label htmlFor="share-days">{t('share.days')}</label>
            <select id="share-days" value={days} onChange={(e) => setDays(Number(e.target.value))}>
              {DAYS.map((d) => (
                <option key={d} value={d}>
                  {t('share.daysN', { n: d })}
                </option>
              ))}
            </select>
          </div>
          <div className="row end">
            <button type="button" className="btn" onClick={() => setStep({ name: 'form' })} disabled={busy}>
              {t('common.back')}
            </button>
            <button className="btn primary" disabled={busy || pin.length < 4}>
              {busy ? <Spinner /> : <Link2 size={16} />} {t('share.createLink')}
            </button>
          </div>
        </form>
      )}

      {step.name === 'link' && (
        <div className="stack share-result">
          <p className="ok">{t('share.linkReady', { email: step.email })}</p>
          <div className="field">
            <label htmlFor="share-link">{t('share.link')}</label>
            <div className="input-row">
              <input id="share-link" className="mono" readOnly value={step.link} onFocus={(e) => e.target.select()} />
              <CopyButton value={step.link} />
            </div>
          </div>
          <div className="field">
            <label htmlFor="share-pin">{t('share.pin')}</label>
            <div className="input-row">
              <input id="share-pin" className="mono" readOnly value={step.pin} />
              <CopyButton value={step.pin} />
            </div>
          </div>
          <p className="warning">{t('share.pinSeparately')}</p>
          <div className="row end">
            <a className="btn" href={mailto(step.email, step.link)}>
              <Mail size={16} /> {t('share.sendMail')}
            </a>
            <button type="button" className="btn primary" onClick={() => setStep({ name: 'form' })}>
              {t('share.another')}
            </button>
          </div>
        </div>
      )}

      <ErrorText>{error}</ErrorText>

      {shares.length > 0 && (
        <section className="stack tight">
          <h4>{t('share.current')}</h4>
          <ul className="admin-list">
            {shares.map((s) => (
              <li key={s.id}>
                <span className="avatar small" aria-hidden>
                  {s.kind === 'user' ? <UserRound size={14} /> : <Link2 size={14} />}
                </span>
                <span className="admin-who">
                  {s.email}
                  <span className="hint">
                    {t(s.kind === 'user' ? 'share.kindUser' : 'share.kindLink')} · {status(s)}
                  </span>
                </span>
                <button
                  className="icon-btn small"
                  onClick={() => void run(() => onRevoke(s))}
                  disabled={busy}
                  aria-label={t('share.revoke', { email: s.email })}
                  title={t('share.revokeShort')}
                >
                  <X size={16} />
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </Modal>
  )
}
