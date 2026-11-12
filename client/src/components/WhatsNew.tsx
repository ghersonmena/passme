import { Sparkles } from 'lucide-react'
import { useState } from 'react'
import { useI18n } from '../i18n'
import { RELEASES, type Release } from '../releases'
import { Modal } from './ui'

interface Props {
  // Las versiones a destacar; las demás quedan detrás de "ver versiones anteriores"
  releases: Release[]
  onClose: () => void
}

export function WhatsNew({ releases, onClose }: Props) {
  const { t, lang } = useI18n()
  const [all, setAll] = useState(false)
  const shown = all ? RELEASES : releases
  const date = (iso: string) =>
    new Date(`${iso}T12:00:00`).toLocaleDateString(lang, { day: 'numeric', month: 'long', year: 'numeric' })

  return (
    <Modal title={t('whatsNew.title')} onClose={onClose}>
      <div className="whats-new">
        {shown.map((r, i) => (
          <section key={r.version} className={i === 0 ? 'release latest' : 'release'}>
            <header>
              <span className="release-version">
                {i === 0 && <Sparkles size={14} aria-hidden="true" />}v{r.version}
              </span>
              <span className="hint">{date(r.date)}</span>
            </header>
            <ul>
              {r.notes[lang].map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          </section>
        ))}
      </div>
      <div className="row end">
        {!all && releases.length < RELEASES.length && (
          <button type="button" className="btn" onClick={() => setAll(true)}>
            {t('whatsNew.older')}
          </button>
        )}
        <button type="button" className="btn primary" onClick={onClose} autoFocus>
          {t('whatsNew.ok')}
        </button>
      </div>
    </Modal>
  )
}
