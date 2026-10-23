// Preferencias de este dispositivo. Nada sensible: solo comodidades que pueden perderse sin problema
// (en modo privado o con el almacenamiento bloqueado se usan los valores por defecto).
export type Lang = 'es' | 'en'
export type Theme = 'system' | 'light' | 'dark'

export interface Prefs {
  lang: Lang
  theme: Theme
  lockMinutes: number
  lastEmail: string
}

const KEY = 'passme:prefs'
export const LOCK_OPTIONS = [1, 5, 15, 60]

function defaultLang(): Lang {
  return navigator.language?.toLowerCase().startsWith('es') ? 'es' : 'en'
}

export function loadPrefs(): Prefs {
  const defaults: Prefs = { lang: defaultLang(), theme: 'system', lockMinutes: 5, lastEmail: '' }
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Prefs>
    return {
      lang: raw.lang === 'es' || raw.lang === 'en' ? raw.lang : defaults.lang,
      theme: raw.theme === 'light' || raw.theme === 'dark' ? raw.theme : 'system',
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

// Color de la barra del navegador y del sistema para cada tema
const THEME_COLORS = { light: '#7c2d92', dark: '#1b131f' }

// "system" quita el atributo y deja que mande prefers-color-scheme; la hoja de estilos hace el resto
export function applyTheme(theme: Theme): void {
  const root = document.documentElement
  if (theme === 'system') delete root.dataset.theme
  else root.dataset.theme = theme
  for (const meta of document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) {
    const scheme = meta.media.includes('dark') ? 'dark' : 'light'
    meta.content = THEME_COLORS[theme === 'system' ? scheme : theme]
  }
}
