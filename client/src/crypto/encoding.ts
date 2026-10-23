export function toBase64(bytes: Uint8Array): string {
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary)
}

export function fromBase64(text: string): Uint8Array<ArrayBuffer> {
  const binary = atob(text)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

export function toBase64Url(bytes: Uint8Array): string {
  return toBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function fromBase64Url(text: string): Uint8Array<ArrayBuffer> {
  const std = text.replace(/-/g, '+').replace(/_/g, '/')
  return fromBase64(std + '='.repeat((4 - (std.length % 4)) % 4))
}

export const utf8 = {
  encode: (text: string): Uint8Array<ArrayBuffer> => new TextEncoder().encode(text),
  decode: (bytes: Uint8Array): string => new TextDecoder().decode(bytes)
}

export function randomBytes(length: number): Uint8Array<ArrayBuffer> {
  return crypto.getRandomValues(new Uint8Array(length))
}

// Borra un búfer con material de llaves en cuanto ya no hace falta
export function wipe(bytes: Uint8Array): void {
  bytes.fill(0)
}
