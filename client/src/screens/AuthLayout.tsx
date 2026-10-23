import type { ReactNode } from 'react'
import { Logo } from '../components/ui'

export function AuthLayout({ title, subtitle, children }: { title: string; subtitle?: ReactNode; children: ReactNode }) {
  return (
    <main className="auth">
      <div className="auth-card">
        <div className="auth-brand">
          <Logo size={44} />
          <span>PassMe</span>
        </div>
        <h1>{title}</h1>
        {subtitle && <p className="muted">{subtitle}</p>}
        {children}
      </div>
    </main>
  )
}
