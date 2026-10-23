import { KeyRound, Lock, Plus, Search, Settings as SettingsIcon, Star, Trash2, Wand2 } from 'lucide-react'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { api } from '../../api/client'
import { Logo, Spinner } from '../../components/ui'
import type { Item, LoginData } from '../../crypto/items'
import { errorMessage, useI18n, type MessageKey } from '../../i18n'
import type { Prefs } from '../../state/prefs'
import { createItem, loadItems, restoreItem, trashItem, updateItem, type Unlocked } from '../../state/session'
import { Generator } from './Generator'
import { ItemDetail } from './ItemDetail'
import { ItemEditor } from './ItemEditor'
import { Settings } from './Settings'

type View = 'all' | 'favorites' | 'trash' | 'generator' | 'settings'

const NAV: { view: View; icon: ReactNode; label: MessageKey }[] = [
  { view: 'all', icon: <KeyRound size={20} />, label: 'nav.all' },
  { view: 'favorites', icon: <Star size={20} />, label: 'nav.favorites' },
  { view: 'trash', icon: <Trash2 size={20} />, label: 'nav.trash' },
  { view: 'generator', icon: <Wand2 size={20} />, label: 'nav.generator' },
  { view: 'settings', icon: <SettingsIcon size={20} />, label: 'nav.settings' }
]

interface Props {
  session: Unlocked
  prefs: Prefs
  onPrefs: (prefs: Prefs) => void
  onSession: (session: Unlocked) => void
  onLock: () => void
  onLogout: () => void
}

export function VaultApp({ session, prefs, onPrefs, onSession, onLock, onLogout }: Props) {
  const { t, lang } = useI18n()
  const [view, setView] = useState<View>('all')
  const [items, setItems] = useState<Item[] | null>(null)
  const [failed, setFailed] = useState(0)
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [editing, setEditing] = useState<'new' | 'edit' | null>(null)
  const [error, setError] = useState('')

  const vault = session.vaults[0]!
  const readOnly = vault.role === 'viewer'

  async function reload() {
    try {
      const result = await loadItems(session)
      setItems(result.items)
      setFailed(result.failed)
    } catch (err) {
      setError(errorMessage(t, err))
    }
  }

  // Se cargan una vez al abrir la bóveda
  useEffect(() => {
    void reload()
  }, [])

  const visible = useMemo(() => {
    if (!items) return []
    const q = query.trim().toLowerCase()
    return items
      .filter((i) => (view === 'trash' ? !!i.trashedAt : !i.trashedAt))
      .filter((i) => view !== 'favorites' || i.data.favorite)
      .filter(
        (i) =>
          !q ||
          i.data.name.toLowerCase().includes(q) ||
          i.data.username.toLowerCase().includes(q) ||
          i.data.urls.some((u) => u.toLowerCase().includes(q))
      )
      .sort((a, b) => a.data.name.localeCompare(b.data.name, lang, { sensitivity: 'base' }))
  }, [items, query, view, lang])

  const selected = items?.find((i) => i.id === selectedId) ?? null

  function replace(item: Item) {
    setItems((list) => (list ? [item, ...list.filter((i) => i.id !== item.id)] : [item]))
  }

  async function act(action: () => Promise<void>) {
    setError('')
    try {
      await action()
    } catch (err) {
      setError(errorMessage(t, err))
      // Otro dispositivo cambió el elemento: se recarga para no pisar su versión
      if ((err as { code?: string }).code === 'conflict') await reload()
    }
  }

  async function save(data: LoginData) {
    // Los errores los muestra el editor
    let saved: Item
    try {
      saved = editing === 'edit' && selected
        ? await updateItem(session, selected, data)
        : await createItem(session, vault.id, data)
    } catch (err) {
      if ((err as { code?: string }).code === 'conflict') await reload()
      throw err
    }
    replace(saved)
    setSelectedId(saved.id)
    setEditing(null)
  }

  function go(next: View) {
    setView(next)
    setSelectedId(null)
    setEditing(null)
    setQuery('')
  }

  const isList = view === 'all' || view === 'favorites' || view === 'trash'
  const showDetail = isList && (editing !== null || selected !== null)

  let detail: ReactNode = (
    <div className="empty">
      <KeyRound size={40} strokeWidth={1.4} />
      <p>{t('vault.selectItem')}</p>
    </div>
  )
  if (editing) {
    detail = (
      <ItemEditor
        key={editing === 'edit' ? selected?.id : 'new'}
        initial={editing === 'edit' ? (selected?.data ?? null) : null}
        onSave={save}
        onCancel={() => setEditing(null)}
      />
    )
  } else if (selected) {
    detail = (
      <ItemDetail
        item={selected}
        readOnly={readOnly}
        onBack={() => setSelectedId(null)}
        onEdit={() => setEditing('edit')}
        onToggleFavorite={() =>
          act(async () => replace(await updateItem(session, selected, { ...selected.data, favorite: !selected.data.favorite })))
        }
        onTrash={() =>
          act(async () => {
            replace(await trashItem(session, selected))
            setSelectedId(null)
          })
        }
        onRestore={() =>
          act(async () => {
            replace(await restoreItem(session, selected))
            setSelectedId(null)
          })
        }
        onDeleteForever={() => {
          if (!window.confirm(t('item.confirmDelete', { name: selected.data.name }))) return
          void act(async () => {
            await api.deleteItem(selected.id)
            setItems((list) => list?.filter((i) => i.id !== selected.id) ?? null)
            setSelectedId(null)
          })
        }}
      />
    )
  }

  return (
    <div className="app">
      <nav className="sidebar" aria-label={t('nav.label')}>
        <div className="sidebar-brand">
          <Logo size={30} />
          <span>PassMe</span>
        </div>
        {NAV.map((n) => (
          <button key={n.view} className={`nav-item ${view === n.view ? 'on' : ''}`} onClick={() => go(n.view)}>
            {n.icon}
            <span>{t(n.label)}</span>
          </button>
        ))}
        <div className="sidebar-spacer" />
        <button className="nav-item" onClick={onLock}>
          <Lock size={20} />
          <span>{t('nav.lock')}</span>
        </button>
      </nav>

      <div className={`content ${showDetail ? 'has-detail' : ''}`}>
        {isList ? (
          <>
            <section className="list-pane">
              <header className="list-header">
                <div className="search">
                  <Search size={18} aria-hidden />
                  <input
                    type="search"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder={t('vault.search')}
                    aria-label={t('vault.search')}
                  />
                </div>
                {view !== 'trash' && !readOnly && (
                  <button
                    className="btn primary icon-text"
                    onClick={() => {
                      setSelectedId(null)
                      setEditing('new')
                    }}
                    aria-label={t('vault.newItem')}
                  >
                    <Plus size={18} />
                    <span>{t('vault.new')}</span>
                  </button>
                )}
                <button className="icon-btn mobile-only" onClick={onLock} aria-label={t('nav.lock')}>
                  <Lock size={20} />
                </button>
              </header>
              {error && <p className="error banner">{error}</p>}
              {failed > 0 && <p className="warning banner">{t('vault.failedItems', { n: failed })}</p>}
              {items === null ? (
                <div className="empty">
                  <Spinner label={t('vault.loading')} />
                </div>
              ) : visible.length === 0 ? (
                <div className="empty">
                  <p>{query ? t('vault.noResults') : t(`vault.empty.${view as 'all' | 'favorites' | 'trash'}`)}</p>
                </div>
              ) : (
                <ul className="item-list">
                  {visible.map((item) => (
                    <li key={item.id}>
                      <button
                        className={`item-row ${item.id === selectedId ? 'on' : ''}`}
                        onClick={() => {
                          setEditing(null)
                          setSelectedId(item.id)
                        }}
                      >
                        <span className="avatar" aria-hidden>
                          {(item.data.name || '?').slice(0, 1).toUpperCase()}
                        </span>
                        <span className="item-text">
                          <span className="item-name">
                            {item.data.name || t('item.untitled')}
                            {item.data.favorite && <Star size={12} fill="currentColor" className="fav" />}
                          </span>
                          <span className="item-sub">{item.data.username || item.data.urls[0] || '—'}</span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
            <section className="detail-pane">{detail}</section>
          </>
        ) : view === 'generator' ? (
          <Generator />
        ) : (
          <Settings
            account={session.account}
            prefs={prefs}
            onPrefs={onPrefs}
            onAccountChanged={async () => onSession({ ...session, account: await api.account() })}
            onLogout={onLogout}
          />
        )}
      </div>

      <nav className="bottom-nav" aria-label={t('nav.label')}>
        {NAV.map((n) => (
          <button key={n.view} className={view === n.view ? 'on' : ''} onClick={() => go(n.view)}>
            {n.icon}
            <span>{t(n.label)}</span>
          </button>
        ))}
      </nav>
    </div>
  )
}
