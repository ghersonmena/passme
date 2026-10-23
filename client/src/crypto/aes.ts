import { fromBase64Url, randomBytes, toBase64Url, utf8 } from './encoding'

// Formato de todo lo que se guarda cifrado: "v1." + base64url(iv[12] || ciphertext || tag[16]).
// El AAD (datos autenticados) ata cada texto cifrado a su lugar: no se puede copiar la llave de una
// bóveda a otra ni un elemento a otro id sin que el descifrado falle.
const VERSION = 'v1.'

export class DecryptError extends Error {
  constructor() {
    super('decrypt_failed')
  }
}

export function importAesKey(raw: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
  // No exportable: aunque un script lograra leer el objeto, no podría sacar los bytes de la llave
  return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt'])
}

export async function encryptBytes(key: CryptoKey, plaintext: Uint8Array<ArrayBuffer>, aad: string): Promise<string> {
  const iv = randomBytes(12)
  const ct = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: utf8.encode(aad) }, key, plaintext)
  )
  const out = new Uint8Array(iv.length + ct.length)
  out.set(iv)
  out.set(ct, iv.length)
  return VERSION + toBase64Url(out)
}

export async function decryptBytes(key: CryptoKey, sealed: string, aad: string): Promise<Uint8Array<ArrayBuffer>> {
  if (!sealed.startsWith(VERSION)) throw new DecryptError()
  const raw = fromBase64Url(sealed.slice(VERSION.length))
  try {
    return new Uint8Array(
      await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: raw.subarray(0, 12), additionalData: utf8.encode(aad) },
        key,
        raw.subarray(12)
      )
    )
  } catch {
    throw new DecryptError()
  }
}

export async function encryptJson(key: CryptoKey, value: unknown, aad: string): Promise<string> {
  return encryptBytes(key, utf8.encode(JSON.stringify(value)), aad)
}

export async function decryptJson<T>(key: CryptoKey, sealed: string, aad: string): Promise<T> {
  return JSON.parse(utf8.decode(await decryptBytes(key, sealed, aad))) as T
}
