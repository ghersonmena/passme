import { Check } from 'lucide-react'
import type { ReactNode } from 'react'
import { Logo } from '../components/ui'
import { useI18n } from '../i18n'

// Pantallas de acceso: panel de marca (arriba en el teléfono, a la izquierda en escritorio) y el
// formulario aparte
export function AuthLayout({ title, subtitle, children }: { title: string; subtitle?: ReactNode; children: ReactNode }) {
  const { t } = useI18n()
  return (
    <main className="auth-split">
      <aside className="auth-side">
        <div className="auth-brand">
          <Logo size={40} />
          <span>PassMe</span>
        </div>
        <div className="auth-pitch">
          <h2>{t('auth.tagline')}</h2>
          <p>{t('auth.pitch')}</p>
        </div>
        <ul className="auth-facts">
          {(['auth.fact.e2e', 'auth.fact.oss', 'auth.fact.app'] as const).map((key) => (
            <li key={key}>
              <Check size={16} aria-hidden /> {t(key)}
            </li>
          ))}
        </ul>
        <svg className="auth-rings" viewBox="0 0 200 200" aria-hidden>
          <circle cx="100" cy="100" r="96" strokeWidth="2" />
          <circle cx="100" cy="100" r="74" strokeWidth="10" strokeDasharray="4 10" />
          <circle cx="100" cy="100" r="50" strokeWidth="2" />
          <circle cx="100" cy="100" r="24" strokeWidth="8" />
        </svg>
      </aside>
      <section className="auth-main">
        <div className="auth-form">
          <h1>{title}</h1>
          {subtitle && <p className="muted">{subtitle}</p>}
          {children}
        </div>
      </section>
    </main>
  )
}
