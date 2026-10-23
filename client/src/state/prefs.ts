// Preferencias de este dispositivo. Nada sensible: solo comodidades que pueden perderse sin problema
// (en modo privado o con el almacenamiento bloqueado se usan los valores por defecto).
export type Lang = 'es' | 'en'

export interface Prefs {
  lang: Lang
  lockMinutes: number
  lastEmail: string
}

const KEY = 'passme:prefs'
export const LOCK_OPTIONS = [1, 5, 15, 60]

function defaultLang(): Lang {
  return navigator.language?.toLowerCase().startsWith('es') ? 'es' : 'en'
}

export function loadPrefs(): Prefs {
  const defaults: Prefs = { lang: defaultLang(), lockMinutes: 5, lastEmail: '' }
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Prefs>
    return {
      lang: raw.lang === 'es' || raw.lang === 'en' ? raw.lang : defaults.lang,
      lockMinutes: LOCK_OPTIONS.includes(raw.lockMinutes ?? 0) ? raw.lockMinutes! : defaults.lockMinutes,
      lastEmail: typeof raw.lastEmail === 'string' ? raw.lastEmail : ''
    }
  } catch {
    return defaults
  }
}

export function savePrefs(prefs: Prefs): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs))
  } catch {
    // Sin almacenamiento: las preferencias duran lo que dure la pestaña
  }
}
