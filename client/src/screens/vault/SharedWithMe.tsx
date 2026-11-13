import { CopyPlus, Share2, Trash2, Users } from 'lucide-react'
import { Modal } from '../../components/ui'
import { useI18n } from '../../i18n'
import type { OpenVault } from '../../state/session'
import type { SharedItem } from '../../state/shares'
import { ItemDetail } from './ItemDetail'
import { TYPE_BY_ID, typeLabel } from './itemTypes'

// Lista de lo que otras cuentas te compartieron (solo lectura)
export function SharedList({ shared, selectedId, onSelect }: { shared: SharedItem[]; selectedId: string | null; onSelect: (id: string) => void }) {
  const { t } = useI18n()
  if (!shared.length) {
    return (
      <div className="empty">
        <Users size={40} strokeWidth={1.4} />
        <p>{t('shared.empty')}</p>
      </div>
    )
  }
  return (
    <ul className="item-list">
      {shared.map((s) => {
        const def = TYPE_BY_ID[s.item.data.type]
        return (
          <li key={s.id}>
            <div className={`item-line ${s.id === selectedId ? 'on' : ''}`}>
              <button className="item-row" onClick={() => onSelect(s.id)}>
                <span className="avatar" aria-hidden>
                  <def.icon size={18} />
                </span>
                <span className="item-text">
                  <span className="item-name">
                    {s.item.data.name || t('item.untitled')}
                    {!s.seen && <span className="badge">{t('shared.new')}</span>}
                  </span>
                  <span className="item-sub">{t('shared.from', { email: s.from })}</span>
                </span>
              </button>
            </div>
          </li>
        )
      })}
    </ul>
  )
}

interface DetailProps {
  shared: SharedItem
  // Bóveda donde se guardaría una copia propia; sin ella no se ofrece
  copyTo: OpenVault | undefined
  onBack: () => void
  onCopy: () => void
  onRemove: () => void
}

export function SharedDetail({ shared, copyTo, onBack, onCopy, onRemove }: DetailProps) {
  const { t } = useI18n()
  return (
    <div className="shared-detail">
      <p className="notice shared-banner">
        <Share2 size={16} aria-hidden />
        <span>
          {t('shared.banner', { email: shared.from, type: t(typeLabel(shared.item.data.type)) })}
        </span>
      </p>
      <ItemDetail
        item={shared.item}
        vault={null}
        readOnly
        onBack={onBack}
        onEdit={() => {}}
        onToggleFavorite={() => {}}
        onUpdate={() => {}}
        onTrash={() => {}}
        onRestore={() => {}}
        onDeleteForever={() => {}}
      />
      <footer className="detail-footer">
        {copyTo && (
          <button className="btn" onClick={onCopy}>
            <CopyPlus size={16} /> {t('shared.copy', { vault: copyTo.meta.name })}
          </button>
        )}
        <button className="btn danger" onClick={onRemove}>
          <Trash2 size={16} /> {t('shared.remove')}
        </button>
      </footer>
    </div>
  )
}

// Aviso al entrar: quién te compartió qué desde la última vez
export function NewSharesModal({ shared, onOpen, onClose }: { shared: SharedItem[]; onOpen: () => void; onClose: () => void }) {
  const { t } = useI18n()
  return (
    <Modal title={t('shared.newTitle')} onClose={onClose}>
      <ul className="new-shares">
        {shared.map((s) => (
          <li key={s.id}>
            <Share2 size={16} aria-hidden />
            <span>{t('shared.newLine', { email: s.from, name: s.item.data.name || t('item.untitled') })}</span>
          </li>
        ))}
      </ul>
      <div className="row end">
        <button className="btn" onClick={onClose}>
          {t('common.close')}
        </button>
        <button className="btn primary" onClick={onOpen} autoFocus>
          {t('shared.open')}
        </button>
      </div>
    </Modal>
  )
}
