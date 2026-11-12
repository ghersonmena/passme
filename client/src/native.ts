// Puente con la app de Android (carpeta android/). La app muestra esta misma web y, solo en las
// páginas de su servidor, agrega window.passmeAndroid (addWebMessageListener con el origen
// permitido): una página de otro sitio no lo ve. Los mensajes son JSON con un campo "type".

export interface NativeMessage {
  type: string
  [key: string]: unknown
}

interface Bridge {
  postMessage(data: string): void
  addEventListener(type: 'message', listener: (e: MessageEvent<string>) => void): void
  removeEventListener(type: 'message', listener: (e: MessageEvent<string>) => void): void
}

const bridge = (globalThis as { passmeAndroid?: Bridge }).passmeAndroid

export const isAndroidApp = !!bridge

export function sendNative(msg: NativeMessage): void {
  bridge?.postMessage(JSON.stringify(msg))
}

// Manda un mensaje y espera la respuesta del tipo indicado
export function askNative<T extends NativeMessage>(msg: NativeMessage, reply: string, timeoutMs = 5000): Promise<T> {
  return new Promise((resolve, reject) => {
    if (!bridge) {
      reject(new Error('native'))
      return
    }
    const timer = setTimeout(() => {
      bridge.removeEventListener('message', listener)
      reject(new Error('native'))
    }, timeoutMs)
    function listener(e: MessageEvent<string>) {
      let data: NativeMessage
      try {
        data = JSON.parse(e.data) as NativeMessage
      } catch {
        return
      }
      if (data.type !== reply) return
      clearTimeout(timer)
      bridge!.removeEventListener('message', listener)
      resolve(data as T)
    }
    bridge.addEventListener('message', listener)
    sendNative(msg)
  })
}

// La app abre la web con ?autofill=fill (elegir qué login poner en otra app) o ?autofill=save
// (guardar el que se acaba de escribir en otra app)
export type AutofillMode = 'fill' | 'save'

export const autofillMode: AutofillMode | null = (() => {
  if (!bridge) return null
  const mode = new URLSearchParams(location.search).get('autofill')
  return mode === 'fill' || mode === 'save' ? mode : null
})()

// Guarda un archivo de texto: en el navegador con una descarga normal; en la app, Android
// pregunta dónde guardarlo (un WebView no sabe descargar los enlaces blob:)
export function saveFile(name: string, text: string, mime = 'text/plain'): void {
  if (bridge) {
    const bytes = new TextEncoder().encode(text)
    let binary = ''
    for (const b of bytes) binary += String.fromCharCode(b)
    sendNative({ type: 'download', name, mime, data: btoa(binary) })
    return
  }
  const url = URL.createObjectURL(new Blob([text], { type: mime }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  // Se revoca después para que el navegador alcance a empezar la descarga
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
