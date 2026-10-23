// Solo se abren enlaces http(s): un "javascript:" guardado en un elemento nunca debe ejecutarse
export function safeUrl(raw: string): string | null {
  const text = raw.trim()
  if (!text) return null
  try {
    // "ejemplo.com" o "localhost:8080" se toman como https; un esquema explícito se respeta
    const explicit = /^[a-z][a-z0-9+.-]*:\/\//i.test(text) || /^(javascript|data|vbscript|blob|file):/i.test(text)
    const url = new URL(explicit ? text : `https://${text}`)
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null
  } catch {
    return null
  }
}
