import { Server, TextCursorInput } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useI18n } from '../../i18n'
import { askNative, sendNative, type NativeMessage } from '../../native'

interface Info extends NativeMessage {
  server: string
  version: string
  // unsupported: Android sin servicio de autocompletar (o desactivado por el fabricante)
  autofill: 'enabled' | 'disabled' | 'unsupported'
}

// Solo dentro de la app de Android: el servidor al que se conecta y el autocompletado en otras apps
export function AndroidSettings() {
  const { t } = useI18n()
  const [info, setInfo] = useState<Info | null>(null)

  useEffect(() => {
    const load = () => void askNative<Info>({ type: 'info' }, 'info').then(setInfo, () => {})
    load()
    // Al volver de los ajustes de Android se actualiza el estado del autocompletado
    const onVisible = () => document.visibilityState === 'visible' && load()
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [])

  if (!info) return null
  return (
    <div className="card">
      <h3>{t('android.title')}</h3>
      <p className="muted">
        {t('android.server')} <span className="mono">{info.server}</span>
        <br />
        {t('android.version', { version: info.version })}
      </p>
      <button className="btn" onClick={() => sendNative({ type: 'changeServer' })}>
        <Server size={16} /> {t('android.changeServer')}
      </button>

      <h4>{t('android.autofill')}</h4>
      {info.autofill === 'unsupported' ? (
        <p className="muted">{t('android.autofillUnsupported')}</p>
      ) : (
        <>
          <p className={info.autofill === 'enabled' ? 'ok' : 'muted'}>
            {info.autofill === 'enabled' ? t('android.autofillOn') : t('android.autofillOff')}
          </p>
          {info.autofill !== 'enabled' && (
            <button className="btn primary" onClick={() => sendNative({ type: 'autofillSettings' })}>
              <TextCursorInput size={16} /> {t('android.enableAutofill')}
            </button>
          )}
          <p className="hint">{t('android.chromeHint')}</p>
        </>
      )}
    </div>
  )
}
