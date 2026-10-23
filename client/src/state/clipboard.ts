const CLEAR_AFTER_MS = 30_000
let clearTimer: number | undefined

// Copia y vacía el portapapeles a los 30 s. No se lee antes de vaciarlo porque leerlo dispara un
// aviso de permiso en el navegador; es lo mismo que hacen otros gestores.
export async function copySecret(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
  } catch {
    return false
  }
  window.clearTimeout(clearTimer)
  clearTimer = window.setTimeout(() => void clearClipboard(), CLEAR_AFTER_MS)
  return true
}

async function clearClipboard(): Promise<void> {
  try {
    await navigator.clipboard.writeText('')
  } catch {
    // Sin foco no se puede escribir: se vacía en cuanto el usuario vuelva a la app
    window.addEventListener('focus', () => void clearClipboard(), { once: true })
  }
}
