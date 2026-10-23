import { Eye, EyeOff } from 'lucide-react'
import { useEffect } from 'react'
import { CopyButton, PasswordStrength } from '../../components/ui'
import type { ItemData } from '../../crypto/items'
import { useI18n } from '../../i18n'
import { fieldLabel, formatCardNumber, TYPE_BY_ID } from './itemTypes'

// La vista rápida se cierra sola para que un secreto no quede a la vista si te alejas
const AUTO_HIDE_MS = 30_000

export function quickField(data: ItemData) {
  const fd = TYPE_BY_ID[data.type].fields.find((f) => f.key === TYPE_BY_ID[data.type].quick)
  const value = fd ? (data.fields[fd.key] ?? '') : ''
  return fd && value ? { fd, value } : null
}

export function QuickActions({ data, open, onToggle }: { data: ItemData; open: boolean; onToggle: () => void }) {
  const { t } = useI18n()
  const quick = quickField(data)
  if (!quick) return null
  const label = t(fieldLabel(quick.fd))
  return (
    <span className="quick-actions">
      <button
        className={`icon-btn ${open ? 'on' : ''}`}
        onClick={onToggle}
        aria-expanded={open}
        aria-label={open ? t('quick.hide', { field: label }) : t('quick.show', { field: label })}
        title={open ? t('common.hide') : t('quick.title')}
      >
        {open ? <EyeOff size={18} /> : <Eye size={18} />}
      </button>
      <CopyButton value={quick.value} label={t('quick.copy', { field: label })} />
    </span>
  )
}

export function QuickPanel({ data, onClose }: { data: ItemData; onClose: () => void }) {
  const { t } = useI18n()
  const quick = quickField(data)

  useEffect(() => {
    const timer = window.setTimeout(onClose, AUTO_HIDE_MS)
    return () => window.clearTimeout(timer)
  }, [onClose])

  if (!quick) return null
  const { fd, value } = quick
  return (
    <div className="quick-panel" role="region" aria-label={t('quick.title')}>
      <span className="quick-label">{t(fieldLabel(fd))}</span>
      <div className="quick-value mono">{fd.key === 'cardNumber' ? formatCardNumber(value) : value}</div>
      {fd.kind === 'password' && <PasswordStrength password={value} />}
    </div>
  )
}
