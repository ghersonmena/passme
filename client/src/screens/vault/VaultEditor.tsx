import { Trash2 } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { ErrorText, Field, Modal, Spinner } from '../../components/ui'
import { DEFAULT_VAULT_LOOK, type VaultMeta } from '../../crypto/keys'
import { errorMessage, useI18n, type MessageKey } from '../../i18n'
import { VAULT_COLORS, VAULT_ICONS, VaultIcon } from './vaultLooks'

interface Props {
  // Sin bóveda es una bóveda nueva
  meta: VaultMeta | null
  itemCount: number
  // Solo el dueño puede borrar, y nunca su última bóveda
  canDelete: boolean
  onSave: (meta: VaultMeta) => Promise<void>
  onDelete: () => Promise<void>
  onClose: () => void
}

export function VaultEditor({ meta, itemCount, canDelete, onSave, onDelete, onClose }: Props) {
  const { t } = useI18n()
  const [name, setName] = useState(meta?.name ?? '')
  const [icon, setIcon] = useState<string>(meta?.icon ?? DEFAULT_VAULT_LOOK.icon)
  const [color, setColor] = useState<string>(meta?.color ?? DEFAULT_VAULT_LOOK.color)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function run(action: () => Promise<void>) {
    setError('')
    setBusy(true)
    try {
      await action()
    } catch (err) {
      setError(errorMessage(t, err))
      setBusy(false)
    }
  }

  function submit(e: FormEvent) {
    e.preventDefault()
    void run(() => onSave({ name: name.trim(), icon, color }))
  }

  return (
    <Modal title={meta ? t('vaults.editTitle') : t('vaults.newTitle')} onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        <div className="vault-preview">
          <VaultIcon meta={{ name, icon, color }} size={26} />
          <strong>{name.trim() || t('vaults.namePlaceholder')}</strong>
        </div>

        <Field
          label={t('field.name')}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t('vaults.namePlaceholder')}
          required
          maxLength={60}
          autoFocus={!meta}
        />

        <fieldset className="picker">
          <legend>{t('vaults.icon')}</legend>
          <div className="icon-grid">
            {Object.entries(VAULT_ICONS).map(([id, Icon]) => (
              <label key={id} className={`icon-choice ${icon === id ? 'on' : ''}`} title={t(`vaultIcon.${id}` as MessageKey)}>
                <input type="radio" name="vault-icon" value={id} checked={icon === id} onChange={() => setIcon(id)} />
                <Icon size={20} aria-hidden />
                <span className="sr-only">{t(`vaultIcon.${id}` as MessageKey)}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset className="picker">
          <legend>{t('vaults.color')}</legend>
          <div className="color-row">
            {VAULT_COLORS.map((c) => (
              <label key={c} className={`color-choice vc-${c} ${color === c ? 'on' : ''}`} title={t(`vaultColor.${c}` as MessageKey)}>
                <input type="radio" name="vault-color" value={c} checked={color === c} onChange={() => setColor(c)} />
                <span className="sr-only">{t(`vaultColor.${c}` as MessageKey)}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <ErrorText>{error}</ErrorText>

        <div className="row end">
          <button type="button" className="btn" onClick={onClose} disabled={busy}>
            {t('common.cancel')}
          </button>
          <button className="btn primary" disabled={busy || !name.trim()}>
            {busy && !confirmDelete ? <Spinner /> : t('common.save')}
          </button>
        </div>

        {meta && canDelete && (
          <div className="danger-zone">
            {confirmDelete ? (
              <>
                <p>
                  {itemCount > 0
                    ? t('vaults.deleteWarning', { name: meta.name, n: itemCount })
                    : t('vaults.deleteEmpty', { name: meta.name })}
                </p>
                <div className="row">
                  <button type="button" className="btn" onClick={() => setConfirmDelete(false)} disabled={busy}>
                    {t('common.cancel')}
                  </button>
                  <button type="button" className="btn danger" onClick={() => void run(onDelete)} disabled={busy}>
                    {busy ? <Spinner /> : <Trash2 size={16} />} {t('vaults.deleteConfirm')}
                  </button>
                </div>
              </>
            ) : (
              <button type="button" className="btn danger" onClick={() => setConfirmDelete(true)}>
                <Trash2 size={16} /> {t('vaults.delete')}
              </button>
            )}
          </div>
        )}
      </form>
    </Modal>
  )
}
