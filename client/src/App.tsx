import { useCallback, useEffect, useRef, useState } from 'react'
import { api, ApiError, type Account, type Invite, type ServerConfig } from './api/client'
import { Spinner } from './components/ui'
import { I18nProvider, useI18n } from './i18n'
import { useAutoLock } from './state/autolock'
import { applyTheme, loadPrefs, savePrefs, type Prefs } from './state/prefs'
import type { Unlocked } from './state/session'
import { AuthLayout } from './screens/AuthLayout'
import { Login } from './screens/Login'
import { Recover } from './screens/Recover'
import { Register } from './screens/Register'
import { Unlock } from './screens/Unlock'
import { VaultApp } from './screens/vault/VaultApp'

type Phase =
  | { name: 'loading' }
  | { name: 'offline' }
  | { name: 'login'; notice?: string }
  | { name: 'register'; invite?: Invite }
  | { name: 'recover' }
  | { name: 'unlock'; account: Account }
  | { name: 'vault'; session: Unlocked }

export function App() {
  const [prefs, setPrefs] = useState<Prefs>(loadPrefs)

  const updatePrefs = useCallback((next: Prefs) => {
    setPrefs(next)
    savePrefs(next)
  }, [])

  useEffect(() => {
    document.documentElement.lang = prefs.lang
  }, [prefs.lang])

  useEffect(() => applyTheme(prefs.theme), [prefs.theme])

  return (
    <I18nProvider lang={prefs.lang}>
      <Root prefs={prefs} onPrefs={updatePrefs} />
    </I18nProvider>
  )
}

function Root({ prefs, onPrefs }: { prefs: Prefs; onPrefs: (p: Prefs) => void }) {
  const { t } = useI18n()
  const [phase, setPhase] = useState<Phase>({ name: 'loading' })
  const [config, setConfig] = useState<ServerConfig | null>(null)
  // start corre una sola vez; con la referencia no se reinicia la app al cambiar de idioma
  const tRef = useRef(t)
  tRef.current = t

  const start = useCallback(async () => {
    setPhase({ name: 'loading' })
    try {
      setConfig(await api.config())
    } catch {
      setPhase({ name: 'offline' })
      return
    }
    // Enlace de invitación: ?invite=<token>. Se quita de la barra para que no quede en el historial.
    const token = new URLSearchParams(location.search).get('invite')
    if (token) {
      history.replaceState(null, '', location.pathname)
      try {
        const { email } = await api.invite(token)
        // Con una sesión abierta en este navegador primero hay que salir de ella
        await api.logout().catch(() => {})
        setPhase({ name: 'register', invite: { token, email } })
      } catch {
        setPhase({ name: 'login', notice: tRef.current('register.inviteInvalid') })
      }
      return
    }
    try {
      // Si la sesión sigue viva solo hace falta desbloquear con la contraseña maestra
      setPhase({ name: 'unlock', account: await api.account() })
    } catch (err) {
      setPhase(err instanceof ApiError && err.status === 0 ? { name: 'offline' } : { name: 'login' })
    }
  }, [])

  useEffect(() => {
    void start()
  }, [start])

  const onUnlocked = useCallback(
    (session: Unlocked) => {
      onPrefs({ ...prefs, lastEmail: session.account.email })
      setPhase({ name: 'vault', session })
    },
    [prefs, onPrefs]
  )

  // Bloquear suelta las llaves y los elementos descifrados; la sesión con el servidor sigue
  const lock = useCallback(() => {
    setPhase((p) => (p.name === 'vault' ? { name: 'unlock', account: p.session.account } : p))
  }, [])

  const logout = useCallback(async () => {
    await api.logout().catch(() => {})
    setPhase({ name: 'login' })
  }, [])

  useAutoLock(phase.name === 'vault', prefs.lockMinutes, lock)

  switch (phase.name) {
    case 'loading':
      return (
        <main className="auth">
          <Spinner label={t('common.loading')} />
        </main>
      )
    case 'offline':
      return (
        <AuthLayout title={t('offline.title')} subtitle={t('offline.subtitle')}>
          <button className="btn primary" onClick={() => void start()}>
            {t('offline.retry')}
          </button>
        </AuthLayout>
      )
    case 'login':
      return (
        <Login
          config={config!}
          initialEmail={prefs.lastEmail}
          notice={phase.notice}
          onUnlocked={onUnlocked}
          onRegister={() => setPhase({ name: 'register' })}
          onRecover={() => setPhase({ name: 'recover' })}
        />
      )
    case 'register':
      return (
        <Register
          config={config!}
          invite={phase.invite}
          onUnlocked={onUnlocked}
          onCancel={() => setPhase({ name: 'login' })}
        />
      )
    case 'recover':
      return (
        <Recover
          initialEmail={prefs.lastEmail}
          onDone={(email) => {
            onPrefs({ ...prefs, lastEmail: email })
            setPhase({ name: 'login', notice: t('recover.done') })
          }}
          onCancel={() => setPhase({ name: 'login' })}
        />
      )
    case 'unlock':
      return <Unlock account={phase.account} onUnlocked={onUnlocked} onLogout={logout} />
    case 'vault':
      return (
        <VaultApp
          session={phase.session}
          prefs={prefs}
          onPrefs={onPrefs}
          onSession={(session) => setPhase({ name: 'vault', session })}
          onLock={lock}
          onLogout={logout}
        />
      )
  }
}
