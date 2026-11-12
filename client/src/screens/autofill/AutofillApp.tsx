import { KeyRound, Search } from 'lucide-react'
import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { ErrorText, Field, Logo, PasswordField, Spinner } from '../../components/ui'
import { emptyItem, type Item } from '../../crypto/items'
import { errorMessage, useI18n } from '../../i18n'
import { askNative, sendNative, type AutofillMode, type NativeMessage } from '../../native'
import { canWrite, createItem, loadItems, updateItem, type Unlocked } from '../../state/session'
import { androidAppUrl, matchesTarget, targetName, targetUrl, type FillTarget } from './match'

// Lo que la app de Android sabe de la otra app: quién pide y, al guardar, lo que se escribió
interface Context extends NativeMessage, FillTarget {
  username?: string
  password?: string
}

interface Props {
  session: Unlocked
  mode: AutofillMode
}

// La web dentro de la app de Android cuando otra app pide autocompletar o guardar un login
export function AutofillApp({ session, mode }: Props) {
  const { t } = useI18n()
  const [context, setContext] = useState<Context | null>(null)
  const [items, setItems] = useState<Item[] | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    Promise.all([askNative<Context>({ type: 'context' }, 'context'), loadItems(session)])
      .then(([ctx, loaded]) => {
        setContext(ctx)
        setItems(loaded.items.filter((i) => !i.trashedAt && i.data.type === 'login'))
      })
      .catch((err) => setError(errorMessage(t, err)))
  }, [])

  const target = context && (context.domain || context.appLabel || context.app)

  return (
    <main className="autofill">
      <header className="autofill-header">
        <Logo size={32} />
        <div>
          <h1>{mode === 'fill' ? t('autofill.fillTitle') : t('autofill.saveTitle')}</h1>
          {target && <p className="muted">{t('autofill.for', { target })}</p>}
        </div>
      </header>
      {!context || !items ? (
        error ? <ErrorText>{error}</ErrorText> : <Spinner label={t('common.loading')} />
      ) : mode === 'fill' ? (
        <FillPicker session={session} target={context} items={items} />
      ) : (
        <SaveForm session={session} context={context} items={items} />
      )}
    </main>
  )
}

function FillPicker({ session, target, items }: { session: Unlocked; target: FillTarget; items: Item[] }) {
  const { t, lang } = useI18n()
  const [query, setQuery] = useState('')
  // En una app (sin dominio) se puede recordar el login para la próxima vez
  const [remember, setRemember] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const matches = useMemo(() => items.filter((i) => matchesTarget(i.data, target)), [items, target])
  const others = useMemo(() => {
    const q = query.trim().toLowerCase()
    return items
      .filter((i) => !matches.includes(i))
      .filter((i) => !q || [i.data.name, i.data.fields.username ?? '', ...i.data.urls].join('\n').toLowerCase().includes(q))
      .sort((a, b) => a.data.name.localeCompare(b.data.name, lang, { sensitivity: 'base' }))
  }, [items, matches, query, lang])

  async function choose(item: Item) {
    setError('')
    setBusy(true)
    try {
      const vault = session.vaults.find((v) => v.id === item.vaultId)
      if (!target.domain && target.app && remember && !matches.includes(item) && canWrite(vault)) {
        await updateItem(session, item, { ...item.data, urls: [...item.data.urls, androidAppUrl(target.app)] })
      }
      sendNative({ type: 'fill', username: item.data.fields.username ?? '', password: item.data.fields.password ?? '' })
    } catch (err) {
      setError(errorMessage(t, err))
      setBusy(false)
    }
  }

  const row = (item: Item) => (
    <li key={item.id}>
      <button className="item-row" onClick={() => void choose(item)} disabled={busy}>
        <span className="avatar" aria-hidden>
          <KeyRound size={18} />
        </span>
        <span className="item-text">
          <span className="item-name">{item.data.name || t('item.untitled')}</span>
          <span className="item-sub">{item.data.fields.username || item.data.urls[0] || ''}</span>
        </span>
      </button>
    </li>
  )

  return (
    <div className="autofill-body">
      {matches.length > 0 ? (
        <section>
          <h2 className="autofill-section">{t('autofill.suggested')}</h2>
          <ul className="item-list">{matches.map(row)}</ul>
        </section>
      ) : (
        <p className="notice">{t('autofill.noMatch')}</p>
      )}
      <section>
        <h2 className="autofill-section">{t('autofill.allLogins')}</h2>
        <div className="search">
          <Search size={16} aria-hidden />
          <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('vault.search')} aria-label={t('vault.search')} />
        </div>
        {!target.domain && target.app && (
          <label className="check">
            <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
            {t('autofill.remember', { app: target.appLabel || target.app })}
          </label>
        )}
        <ul className="item-list">{others.map(row)}</ul>
        {others.length === 0 && <p className="muted">{t('vault.noResults')}</p>}
      </section>
      {busy && <Spinner />}
      <ErrorText>{error}</ErrorText>
      <div className="autofill-footer">
        <button className="btn" onClick={() => sendNative({ type: 'cancel' })}>
          {t('common.cancel')}
        </button>
      </div>
    </div>
  )
}

function SaveForm({ session, context, items }: { session: Unlocked; context: Context; items: Item[] }) {
  const { t } = useI18n()
  const writable = session.vaults.filter(canWrite)
  const username = context.username ?? ''
  // Si ya hay un login de esa app o sitio con el mismo usuario, se le actualiza la contraseña
  const existing = items.find(
    (i) => matchesTarget(i.data, context) && (i.data.fields.username ?? '').toLowerCase() === username.toLowerCase()
  )
  const [name, setName] = useState(existing?.data.name ?? targetName(context))
  const [user, setUser] = useState(username)
  const [password, setPassword] = useState(context.password ?? '')
  const [vaultId, setVaultId] = useState(writable[0]?.id ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const updating = !!existing && canWrite(session.vaults.find((v) => v.id === existing.vaultId))

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError('')
    setBusy(true)
    try {
      if (updating) {
        await updateItem(session, existing, {
          ...existing.data,
          name: name.trim() || existing.data.name,
          fields: { ...existing.data.fields, username: user.trim(), password }
        })
      } else {
        const data = emptyItem('login')
        await createItem(session, vaultId, {
          ...data,
          name: name.trim() || targetName(context),
          fields: { username: user.trim(), password },
          urls: [targetUrl(context)]
        })
      }
      sendNative({ type: 'saved' })
    } catch (err) {
      setError(errorMessage(t, err))
      setBusy(false)
    }
  }

  if (!writable.length) {
    return (
      <div className="autofill-body">
        <p className="notice">{t('autofill.noVault')}</p>
        <button className="btn" onClick={() => sendNative({ type: 'cancel' })}>
          {t('common.close')}
        </button>
      </div>
    )
  }

  return (
    <form className="autofill-body stack" onSubmit={submit}>
      {updating && <p className="notice">{t('autofill.updating', { name: existing.data.name })}</p>}
      <Field label={t('field.name')} value={name} onChange={(e) => setName(e.target.value)} required maxLength={200} />
      <Field label={t('f.loginUsername')} value={user} onChange={(e) => setUser(e.target.value)} autoComplete="off" />
      <PasswordField label={t('f.password')} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="off" required />
      {!updating && writable.length > 1 && (
        <div className="field">
          <label htmlFor="autofill-vault">{t('item.vault')}</label>
          <select id="autofill-vault" value={vaultId} onChange={(e) => setVaultId(e.target.value)}>
            {writable.map((v) => (
              <option key={v.id} value={v.id}>
                {v.meta.name}
              </option>
            ))}
          </select>
        </div>
      )}
      <ErrorText>{error}</ErrorText>
      <div className="autofill-footer">
        <button type="button" className="btn" onClick={() => sendNative({ type: 'cancel' })} disabled={busy}>
          {t('autofill.notNow')}
        </button>
        <button className="btn primary" disabled={busy}>
          {busy ? <Spinner /> : updating ? t('autofill.update') : t('common.save')}
        </button>
      </div>
    </form>
  )
}
