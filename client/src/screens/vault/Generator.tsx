import { RefreshCw } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { CopyButton, StrengthMeter } from '../../components/ui'
import {
  generatePassphrase,
  generatePassword,
  passphraseEntropy,
  passwordEntropy,
  type PassphraseOptions,
  type PasswordOptions
} from '../../crypto/generator'
import { useI18n } from '../../i18n'
import { DEFAULT_GENERATED } from './ItemEditor'

type Mode = 'password' | 'passphrase'

export function Generator() {
  const { t } = useI18n()
  const [mode, setMode] = useState<Mode>('password')
  const [pw, setPw] = useState<PasswordOptions>(DEFAULT_GENERATED)
  const [pp, setPp] = useState<PassphraseOptions>({ words: 5, separator: '-', capitalize: true, includeNumber: true })
  const [value, setValue] = useState('')

  const regenerate = useCallback(() => {
    setValue(mode === 'password' ? generatePassword(pw) : generatePassphrase(pp))
  }, [mode, pw, pp])
  useEffect(regenerate, [regenerate])

  const bits = mode === 'password' ? passwordEntropy(pw) : passphraseEntropy(pp)
  const toggle = (key: 'lower' | 'upper' | 'digits' | 'symbols' | 'avoidAmbiguous') =>
    setPw((o) => ({ ...o, [key]: !o[key] }))

  return (
    <section className="page">
      <h2>{t('generator.title')}</h2>
      <div className="segmented" role="tablist">
        {(['password', 'passphrase'] as const).map((m) => (
          <button key={m} role="tab" aria-selected={mode === m} className={mode === m ? 'on' : ''} onClick={() => setMode(m)}>
            {t(`generator.${m}`)}
          </button>
        ))}
      </div>

      <div className="generated">
        <output className="mono">{value}</output>
        <div className="row">
          <button className="icon-btn" onClick={regenerate} aria-label={t('generator.regenerate')} title={t('generator.regenerate')}>
            <RefreshCw size={18} />
          </button>
          <CopyButton value={value} />
        </div>
      </div>
      <StrengthMeter bits={bits} />

      {mode === 'password' ? (
        <div className="options">
          <label className="range">
            <span>{t('generator.length', { n: pw.length })}</span>
            <input
              type="range"
              min={8}
              max={64}
              value={pw.length}
              onChange={(e) => setPw((o) => ({ ...o, length: Number(e.target.value) }))}
            />
          </label>
          {(['upper', 'lower', 'digits', 'symbols', 'avoidAmbiguous'] as const).map((key) => (
            <label className="check" key={key}>
              <input type="checkbox" checked={pw[key]} onChange={() => toggle(key)} />
              {t(`generator.${key}`)}
            </label>
          ))}
        </div>
      ) : (
        <div className="options">
          <label className="range">
            <span>{t('generator.words', { n: pp.words })}</span>
            <input
              type="range"
              min={3}
              max={12}
              value={pp.words}
              onChange={(e) => setPp((o) => ({ ...o, words: Number(e.target.value) }))}
            />
          </label>
          <label className="inline-field">
            <span>{t('generator.separator')}</span>
            <select value={pp.separator} onChange={(e) => setPp((o) => ({ ...o, separator: e.target.value }))}>
              <option value="-">-</option>
              <option value=".">.</option>
              <option value="_">_</option>
              <option value=" ">{t('generator.space')}</option>
            </select>
          </label>
          <label className="check">
            <input type="checkbox" checked={pp.capitalize} onChange={() => setPp((o) => ({ ...o, capitalize: !o.capitalize }))} />
            {t('generator.capitalize')}
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={pp.includeNumber}
              onChange={() => setPp((o) => ({ ...o, includeNumber: !o.includeNumber }))}
            />
            {t('generator.includeNumber')}
          </label>
        </div>
      )}
    </section>
  )
}
