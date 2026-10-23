import { ChevronDown, LayoutGrid, Lock, Pencil, Plus, Search, Settings as SettingsIcon, Star, Trash2, Wand2 } from 'lucide-react'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { api } from '../../api/client'
import { Logo, Modal, Spinner } from '../../components/ui'
import { emptyItem, type Item, type ItemData, type ItemType } from '../../crypto/items'
import type { VaultMeta } from '../../crypto/keys'
import { errorMessage, useI18n, type MessageKey } from '../../i18n'
import type { Prefs } from '../../state/prefs'
import {
  canWrite,
  createItem,
  createVault,
  loadItems,
  moveItem,
  restoreItem,
  trashItem,
  updateItem,
  updateVault,
  type OpenVault,
  type Unlocked
} from '../../state/session'
import { Generator } from './Generator'
import { ItemDetail } from './ItemDetail'
import { ItemEditor } from './ItemEditor'
import { searchText, TYPE_BY_ID, TYPES, typeLabel } from './itemTypes'
import { Settings } from './Settings'
import { TypePicker } from './TypePicker'
import { VaultEditor } from './VaultEditor'
import { VaultIcon } from './vaultLooks'

type View = 'all' | 'favorites' | 'trash' | 'generator' | 'settings'

const NAV: { view: View; icon: ReactNode; label: MessageKey }[] = [
  { view: 'all', icon: <LayoutGrid size={20} />, label: 'nav.all' },
  { view: 'favorites', icon: <Star size={20} />, label: 'nav.favorites' },
  { view: 'trash', icon: <Trash2 size={20} />, label: 'nav.trash' },
  { view: 'generator', icon: <Wand2 size={20} />, label: 'nav.generator' },
  { view: 'settings', icon: <SettingsIcon size={20} />, label: 'nav.settings' }
]

// pick = eligiendo el tipo del elemento nuevo
type Editing = { mode: 'pick' } | { mode: 'new'; type: ItemType } | { mode: 'edit' } | null

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
  const [vaultFilter, setVaultFilter] = useState<string | null>(null)
  const [typeFilter, setTypeFilter] = useState<ItemType | ''>('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [editing, setEditing] = useState<Editing>(null)
  // undefined = cerrado, null = bóveda nueva
  const [vaultModal, setVaultModal] = useState<OpenVault | null | undefined>(undefined)
  const [vaultSheet, setVaultSheet] = useState(false)
  const [error, setError] = useState('')

  const { vaults } = session
  const vaultById = useMemo(() => new Map(vaults.map((v) => [v.id, v])), [vaults])
  const writable = vaults.filter(canWrite)
  const currentVault = vaultFilter ? (vaultById.get(vaultFilter) ?? null) : null
  const ownedCount = vaults.filter((v) => v.role === 'owner').length

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

  // Elementos activos por bóveda, para los contadores
  const counts = useMemo(() => {
    const map = new Map<string, number>()
    for (const i of items ?? []) if (!i.trashedAt) map.set(i.vaultId, (map.get(i.vaultId) ?? 0) + 1)
    return map
  }, [items])

  const inScope = useMemo(
    () =>
      (items ?? [])
        .filter((i) => !vaultFilter || i.vaultId === vaultFilter)
        .filter((i) => (view === 'trash' ? !!i.trashedAt : !i.trashedAt))
        .filter((i) => view !== 'favorites' || i.data.favorite),
    [items, vaultFilter, view]
  )

  // Solo se ofrecen en el filtro los tipos que hay en la vista actual
  const presentTypes = useMemo(() => TYPES.filter((d) => inScope.some((i) => i.data.type === d.type)), [inScope])

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    return inScope
      .filter((i) => !typeFilter || i.data.type === typeFilter)
      .filter((i) => !q || searchText(i.data).includes(q))
      .sort((a, b) => a.data.name.localeCompare(b.data.name, lang, { sensitivity: 'base' }))
  }, [inScope, query, typeFilter, lang])

  const selected = items?.find((i) => i.id === selectedId) ?? null
  const selectedVault = selected ? (vaultById.get(selected.vaultId) ?? null) : null

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

  async function save(data: ItemData, vaultId: string) {
    // Los errores los muestra el editor
    let saved: Item
    try {
      if (editing?.mode === 'edit' && selected) {
        saved =
          vaultId === selected.vaultId
            ? await updateItem(session, selected, data)
            : await moveItem(session, selected, vaultId, data)
      } else {
        saved = await createItem(session, vaultId, data)
      }
    } catch (err) {
      if ((err as { code?: string }).code === 'conflict') await reload()
      throw err
    }
    replace(saved)
    setSelectedId(saved.id)
    setEditing(null)
  }

  // --- Bóvedas ---

  function setVaults(next: OpenVault[]) {
    onSession({ ...session, vaults: next })
  }

  async function saveVault(meta: VaultMeta) {
    if (vaultModal) {
      const updated = await updateVault(vaultModal, meta)
      setVaults(vaults.map((v) => (v.id === updated.id ? updated : v)))
    } else {
      const created = await createVault(session, meta)
      setVaults([...vaults, created])
      pickVault(created.id)
    }
    setVaultModal(undefined)
  }

  async function deleteVault() {
    const target = vaultModal!
    await api.deleteVault(target.id)
    setVaults(vaults.filter((v) => v.id !== target.id))
    setItems((list) => list?.filter((i) => i.vaultId !== target.id) ?? null)
    if (vaultFilter === target.id) setVaultFilter(null)
    if (selected?.vaultId === target.id) setSelectedId(null)
    setVaultModal(undefined)
  }

  function pickVault(id: string | null) {
    setVaultFilter(id)
    setTypeFilter('')
    setSelectedId(null)
    setEditing(null)
    setVaultSheet(false)
    if (view !== 'favorites' && view !== 'trash') setView('all')
  }

  function go(next: View) {
    setView(next)
    setSelectedId(null)
    setEditing(null)
    setQuery('')
    setTypeFilter('')
  }

  // Los elementos nuevos van a la bóveda abierta, o a la primera donde se pueda escribir
  const targetVault = currentVault && canWrite(currentVault) ? currentVault : writable[0]

  const isList = view === 'all' || view === 'favorites' || view === 'trash'
  const showDetail = isList && (editing !== null || selected !== null)

  let detail: ReactNode = (
    <div className="empty">
      <LayoutGrid size={40} strokeWidth={1.4} />
      <p>{t('vault.selectItem')}</p>
    </div>
  )
  if (editing?.mode === 'pick') {
    detail = <TypePicker onPick={(type) => setEditing({ mode: 'new', type })} onCancel={() => setEditing(null)} />
  } else if (editing && targetVault) {
    const isNew = editing.mode === 'new'
    detail = (
      <ItemEditor
        key={isNew ? `new-${editing.type}` : selected?.id}
        initial={isNew ? emptyItem(editing.type) : selected!.data}
        isNew={isNew}
        vaults={writable}
        vaultId={isNew ? targetVault.id : selected!.vaultId}
        onSave={save}
        onCancel={() => setEditing(null)}
      />
    )
  } else if (selected) {
    detail = (
      <ItemDetail
        item={selected}
        vault={vaults.length > 1 ? selectedVault : null}
        readOnly={!canWrite(selectedVault ?? undefined)}
        onBack={() => setSelectedId(null)}
        onEdit={() => setEditing({ mode: 'edit' })}
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

  const total = [...counts.values()].reduce((a, b) => a + b, 0)

  // La misma lista de bóvedas va en la barra lateral y en la hoja del teléfono
  const vaultList = (
    <ul className="vault-list">
      <li>
        <button className={`nav-item ${vaultFilter === null ? 'on' : ''}`} onClick={() => pickVault(null)}>
          <span className="vault-icon all" aria-hidden>
            <LayoutGrid size={16} />
          </span>
          <span className="nav-label">{t('vaults.all')}</span>
          <span className="count">{total}</span>
        </button>
      </li>
      {vaults.map((v) => (
        <li key={v.id} className="vault-row">
          <button className={`nav-item ${vaultFilter === v.id ? 'on' : ''}`} onClick={() => pickVault(v.id)}>
            <VaultIcon meta={v.meta} size={16} />
            <span className="nav-label">{v.meta.name}</span>
            <span className="count">{counts.get(v.id) ?? 0}</span>
          </button>
          {(v.role === 'owner' || v.role === 'manager') && (
            <button
              className="icon-btn small vault-edit"
              onClick={() => setVaultModal(v)}
              aria-label={t('vaults.editNamed', { name: v.meta.name })}
              title={t('vaults.edit')}
            >
              <Pencil size={14} />
            </button>
          )}
        </li>
      ))}
    </ul>
  )

  return (
    <div className="app">
      <nav className="sidebar" aria-label={t('nav.label')}>
        <div className="sidebar-brand">
          <Logo size={30} />
          <span>PassMe</span>
        </div>
        <div className="sidebar-section">
          <span>{t('vaults.title')}</span>
          <button className="icon-btn small" onClick={() => setVaultModal(null)} aria-label={t('vaults.new')} title={t('vaults.new')}>
            <Plus size={16} />
          </button>
        </div>
        {vaultList}
        <div className="sidebar-divider" />
        {NAV.filter((n) => n.view !== 'all').map((n) => (
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
                <div className="list-title">
                  <button className="vault-switch" onClick={() => setVaultSheet(true)} aria-haspopup="dialog">
                    {currentVault ? (
                      <VaultIcon meta={currentVault.meta} size={16} />
                    ) : (
                      <span className="vault-icon all" aria-hidden>
                        <LayoutGrid size={16} />
                      </span>
                    )}
                    <span className="nav-label">{currentVault ? currentVault.meta.name : t('vaults.all')}</span>
                    {view !== 'all' && <span className="view-tag">{t(`nav.${view}` as MessageKey)}</span>}
                    <ChevronDown size={16} className="mobile-only" aria-hidden />
                  </button>
                  {presentTypes.length > 1 && (
                    <select
                      className="type-filter"
                      value={typeFilter}
                      onChange={(e) => setTypeFilter(e.target.value as ItemType | '')}
                      aria-label={t('vault.typeFilter')}
                    >
                      <option value="">{t('vault.allTypes')}</option>
                      {presentTypes.map((d) => (
                        <option key={d.type} value={d.type}>
                          {t(typeLabel(d.type))}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
                <div className="list-tools">
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
                  {view !== 'trash' && targetVault && (
                    <button
                      className="btn primary icon-text"
                      onClick={() => {
                        setSelectedId(null)
                        setEditing({ mode: 'pick' })
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
                </div>
              </header>
              {error && <p className="error banner">{error}</p>}
              {failed > 0 && <p className="warning banner">{t('vault.failedItems', { n: failed })}</p>}
              {items === null ? (
                <div className="empty">
                  <Spinner label={t('vault.loading')} />
                </div>
              ) : visible.length === 0 ? (
                <div className="empty">
                  <p>
                    {query || typeFilter ? t('vault.noResults') : t(`vault.empty.${view as 'all' | 'favorites' | 'trash'}`)}
                  </p>
                </div>
              ) : (
                <ul className="item-list">
                  {visible.map((item) => {
                    const def = TYPE_BY_ID[item.data.type]
                    const vault = vaultById.get(item.vaultId)
                    return (
                      <li key={item.id}>
                        <button
                          className={`item-row ${item.id === selectedId ? 'on' : ''}`}
                          onClick={() => {
                            setEditing(null)
                            setSelectedId(item.id)
                          }}
                        >
                          <span className="avatar" aria-hidden>
                            <def.icon size={18} />
                          </span>
                          <span className="item-text">
                            <span className="item-name">
                              {item.data.name || t('item.untitled')}
                              {item.data.favorite && <Star size={12} fill="currentColor" className="fav" />}
                            </span>
                            <span className="item-sub">{def.subtitle(item.data) || t(typeLabel(item.data.type))}</span>
                          </span>
                          {!vaultFilter && vaults.length > 1 && vault && (
                            <span className="row-vault" title={vault.meta.name}>
                              <VaultIcon meta={vault.meta} size={12} />
                            </span>
                          )}
                        </button>
                      </li>
                    )
                  })}
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

      {vaultSheet && (
        <Modal title={t('vaults.title')} onClose={() => setVaultSheet(false)}>
          {vaultList}
          <button
            className="btn"
            onClick={() => {
              setVaultSheet(false)
              setVaultModal(null)
            }}
          >
            <Plus size={16} /> {t('vaults.new')}
          </button>
        </Modal>
      )}

      {vaultModal !== undefined && (
        <VaultEditor
          meta={vaultModal?.meta ?? null}
          itemCount={vaultModal ? (items ?? []).filter((i) => i.vaultId === vaultModal.id).length : 0}
          canDelete={!!vaultModal && vaultModal.role === 'owner' && ownedCount > 1}
          onSave={saveVault}
          onDelete={deleteVault}
          onClose={() => setVaultModal(undefined)}
        />
      )}
    </div>
  )
}
