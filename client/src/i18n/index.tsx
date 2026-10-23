import { createContext, useContext, useMemo, type ReactNode } from 'react'
import { ApiError } from '../api/client'
import { DecryptError } from '../crypto/aes'
import type { Lang } from '../state/prefs'
import { en } from './en'
import { es, type Messages } from './es'

export type MessageKey = keyof Messages
type Vars = Record<string, string | number>
export type Translate = (key: MessageKey, vars?: Vars) => string

const dictionaries: Record<Lang, Messages> = { es, en }

function translate(lang: Lang, key: MessageKey, vars?: Vars): string {
  const text = dictionaries[lang][key] ?? es[key] ?? key
  return vars ? text.replace(/\{(\w+)\}/g, (_, name: string) => String(vars[name] ?? `{${name}}`)) : text
}

interface I18n {
  lang: Lang
  t: Translate
}

const I18nContext = createContext<I18n>({ lang: 'es', t: (key, vars) => translate('es', key, vars) })

export function I18nProvider({ lang, children }: { lang: Lang; children: ReactNode }) {
  const value = useMemo<I18n>(() => ({ lang, t: (key, vars) => translate(lang, key, vars) }), [lang])
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export function useI18n(): I18n {
  return useContext(I18nContext)
}

// Convierte cualquier error en un mensaje para la persona, sin detalles técnicos
export function errorMessage(t: Translate, err: unknown): string {
  if (err instanceof DecryptError) return t('error.wrong_password')
  if (err instanceof ApiError) {
    const key = `error.${err.code}` as MessageKey
    return key in es ? t(key) : t('error.server_error')
  }
  return t('error.unexpected')
}
