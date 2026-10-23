import { Check, Copy, Eye, EyeOff, LoaderCircle, X } from 'lucide-react'
import { useEffect, useId, useRef, useState, type InputHTMLAttributes, type ReactNode } from 'react'
import { estimatePasswordBits, strengthFromBits, type Strength } from '../crypto/generator'
import { useI18n } from '../i18n'
import { copySecret } from '../state/clipboard'

export function Logo({ size = 40 }: { size?: number }) {
  return <img src="/icons/icon.svg" width={size} height={size} alt="" className="logo" />
}

export function Spinner({ label }: { label?: string }) {
  return (
    <span className="spinner" role="status">
      <LoaderCircle size={18} className="spin" aria-hidden />
      {label && <span>{label}</span>}
    </span>
  )
}

interface FieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string
  hint?: ReactNode
}

export function Field({ label, hint, ...input }: FieldProps) {
  const id = useId()
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input id={id} {...input} />
      {hint && <div className="hint">{hint}</div>}
    </div>
  )
}

// Campo de contraseña con botón para mostrarla. Sin corrector ni mayúsculas automáticas: el
// teclado del teléfono no debe aprender ni alterar lo que se escribe aquí.
export function PasswordField({ label, hint, ...input }: FieldProps) {
  const id = useId()
  const { t } = useI18n()
  const [visible, setVisible] = useState(false)
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <div className="input-row">
        <input
          id={id}
          type={visible ? 'text' : 'password'}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          {...input}
        />
        <button
          type="button"
          className="icon-btn"
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? t('common.hide') : t('common.show')}
          title={visible ? t('common.hide') : t('common.show')}
        >
          {visible ? <EyeOff size={18} /> : <Eye size={18} />}
        </button>
      </div>
      {hint && <div className="hint">{hint}</div>}
    </div>
  )
}

export function CopyButton({ value, label }: { value: string; label?: string }) {
  const { t } = useI18n()
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return
    const timer = window.setTimeout(() => setCopied(false), 1500)
    return () => window.clearTimeout(timer)
  }, [copied])
  const text = copied ? t('common.copied') : (label ?? t('common.copy'))
  return (
    <button
      type="button"
      className="icon-btn"
      disabled={!value}
      onClick={async () => setCopied(await copySecret(value))}
      aria-label={text}
      title={text}
    >
      {copied ? <Check size={18} /> : <Copy size={18} />}
    </button>
  )
}

export function StrengthMeter({ bits }: { bits: number }) {
  const { t } = useI18n()
  const strength: Strength = strengthFromBits(bits)
  const level = { weak: 1, fair: 2, good: 3, strong: 4 }[strength]
  return (
    <div className={`strength strength-${strength}`}>
      <div className="strength-bars" aria-hidden>
        {[1, 2, 3, 4].map((n) => (
          <span key={n} className={n <= level ? 'on' : ''} />
        ))}
      </div>
      <span>
        {t(`strength.${strength}`)} · {t('strength.bits', { bits: Math.round(bits) })}
      </span>
    </div>
  )
}

export function PasswordStrength({ password }: { password: string }) {
  if (!password) return null
  return <StrengthMeter bits={estimatePasswordBits(password)} />
}

export function ErrorText({ children }: { children: ReactNode }) {
  if (!children) return null
  return (
    <p className="error" role="alert">
      {children}
    </p>
  )
}

// Ventana modal con <dialog>: el navegador se encarga del foco, de Esc y de bloquear el fondo
export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const { t } = useI18n()
  const ref = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  useEffect(() => {
    const dialog = ref.current
    if (dialog && !dialog.open) dialog.showModal()
    return () => dialog?.close()
  }, [])
  return (
    <dialog
      ref={ref}
      className="modal"
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault()
        onClose()
      }}
      // Un clic en el fondo oscuro (fuera del contenido) cierra la ventana
      onClick={(e) => e.target === ref.current && onClose()}
    >
      <div className="modal-body">
        <header className="modal-header">
          <h2 id={titleId}>{title}</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label={t('common.close')} title={t('common.close')}>
            <X size={20} />
          </button>
        </header>
        {children}
      </div>
    </dialog>
  )
}
