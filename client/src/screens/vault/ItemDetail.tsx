import { ArrowLeft, ExternalLink, Eye, EyeOff, Pencil, RotateCcw, Star, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { CopyButton, PasswordStrength } from '../../components/ui'
import type { Item } from '../../crypto/items'
import { useI18n } from '../../i18n'
import { safeUrl } from './url'

interface Props {
  item: Item
  readOnly: boolean
  onBack: () => void
  onEdit: () => void
  onToggleFavorite: () => void
  onTrash: () => void
  onRestore: () => void
  onDeleteForever: () => void
}

export function ItemDetail({ item, readOnly, onBack, onEdit, onToggleFavorite, onTrash, onRestore, onDeleteForever }: Props) {
  const { t, lang } = useI18n()
  const [showPassword, setShowPassword] = useState(false)
  const { data } = item
  const trashed = !!item.trashedAt

  // Al cambiar de elemento, la contraseña vuelve a ocultarse
  useEffect(() => setShowPassword(false), [item.id])

  const date = (iso: string) => new Date(iso).toLocaleString(lang)

  return (
    <article className="detail">
      <header className="detail-header">
        <button className="icon-btn back-btn" onClick={onBack} aria-label={t('common.back')}>
          <ArrowLeft size={20} />
        </button>
        <div className="avatar large" aria-hidden>
          {(data.name || '?').slice(0, 1).toUpperCase()}
        </div>
        <h2>{data.name || t('item.untitled')}</h2>
        {!trashed && !readOnly && (
          <div className="detail-actions">
            <button
              className={`icon-btn ${data.favorite ? 'active' : ''}`}
              onClick={onToggleFavorite}
              aria-label={data.favorite ? t('item.unfavorite') : t('item.favorite')}
              title={data.favorite ? t('item.unfavorite') : t('item.favorite')}
            >
              <Star size={18} fill={data.favorite ? 'currentColor' : 'none'} />
            </button>
            <button className="btn" onClick={onEdit}>
              <Pencil size={16} /> {t('common.edit')}
            </button>
          </div>
        )}
      </header>

      {trashed && <p className="notice">{t('item.inTrash')}</p>}

      <dl className="fields">
        {data.username && (
          <div className="field-view">
            <dt>{t('field.username')}</dt>
            <dd>
              <span className="value">{data.username}</span>
              <CopyButton value={data.username} />
            </dd>
          </div>
        )}
        {data.password && (
          <div className="field-view">
            <dt>{t('field.password')}</dt>
            <dd>
              <span className={`value mono ${showPassword ? '' : 'masked'}`}>
                {showPassword ? data.password : '•'.repeat(12)}
              </span>
              <button
                className="icon-btn"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? t('common.hide') : t('common.show')}
                title={showPassword ? t('common.hide') : t('common.show')}
              >
                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
              <CopyButton value={data.password} />
            </dd>
            {showPassword && <PasswordStrength password={data.password} />}
          </div>
        )}
        {data.urls.filter(Boolean).map((url, i) => {
          const href = safeUrl(url)
          return (
            <div className="field-view" key={i}>
              <dt>{t('field.website')}</dt>
              <dd>
                <span className="value">{url}</span>
                {href && (
                  <a
                    className="icon-btn"
                    href={href}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={t('item.openSite')}
                    title={t('item.openSite')}
                  >
                    <ExternalLink size={18} />
                  </a>
                )}
                <CopyButton value={url} />
              </dd>
            </div>
          )
        })}
        {data.note && (
          <div className="field-view">
            <dt>{t('field.note')}</dt>
            <dd>
              <span className="value note">{data.note}</span>
            </dd>
          </div>
        )}
      </dl>

      <p className="meta">
        {t('item.created', { date: date(item.createdAt) })}
        <br />
        {t('item.updated', { date: date(item.updatedAt) })}
      </p>

      {!readOnly && (
        <footer className="detail-footer">
          {trashed ? (
            <>
              <button className="btn" onClick={onRestore}>
                <RotateCcw size={16} /> {t('item.restore')}
              </button>
              <button className="btn danger" onClick={onDeleteForever}>
                <Trash2 size={16} /> {t('item.deleteForever')}
              </button>
            </>
          ) : (
            <button className="btn danger" onClick={onTrash}>
              <Trash2 size={16} /> {t('item.moveToTrash')}
            </button>
          )}
        </footer>
      )}
    </article>
  )
}
