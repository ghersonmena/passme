import { ArrowLeft } from 'lucide-react'
import type { ItemType } from '../../crypto/items'
import { useI18n } from '../../i18n'
import { TYPES, typeLabel } from './itemTypes'

export function TypePicker({ onPick, onCancel }: { onPick: (type: ItemType) => void; onCancel: () => void }) {
  const { t } = useI18n()
  return (
    <section className="detail">
      <header className="detail-header">
        <button className="icon-btn back-btn" onClick={onCancel} aria-label={t('common.back')}>
          <ArrowLeft size={20} />
        </button>
        <h2>{t('item.pickType')}</h2>
      </header>
      <div className="type-grid">
        {TYPES.map(({ type, icon: Icon }) => (
          <button key={type} className="type-option" onClick={() => onPick(type)}>
            <span className="avatar" aria-hidden>
              <Icon size={20} />
            </span>
            <span>{t(typeLabel(type))}</span>
          </button>
        ))}
      </div>
    </section>
  )
}
