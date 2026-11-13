import { decryptBytes, decryptJson, encryptBytes, encryptJson, importAesKey } from './aes'
import { fromBase64, fromBase64Url, randomBytes, toBase64Url, wipe } from './encoding'
import { deriveKeys, hkdf, newKdfParams, type KdfParams } from './kdf'
import { AAD } from './keys'
import type { ItemData } from './items'

// Compartir un elemento (ver docs/CRYPTO.md):
//   K = llave aleatoria del compartido; cifra la copia del elemento
//   K va cifrada para el dueño (llave de usuario) y para quien la recibe:
//     cuenta  → ECDH P-256 con una llave efímera y la llave pública del destinatario
//     enlace  → Argon2id(PIN) junto con un secreto de 256 bits que va en el "#" del enlace
//   El servidor no tiene K ni el secreto del enlace: con su base de datos no puede leer la copia.

export const SHARE_AAD = {
  data: (id: string) => `passme:share:${id}`,
  ownerKey: (id: string) => `passme:share-key:${id}:owner`,
  recipientKey: (id: string) => `passme:share-key:${id}:recipient`
}

export interface ShareKey {
  raw: Uint8Array<ArrayBuffer>
  key: CryptoKey
}

export async function newShareKey(): Promise<ShareKey> {
  const raw = randomBytes(32)
  return { raw, key: await importAesKey(raw) }
}

async function shareKeyFrom(raw: Uint8Array<ArrayBuffer>): Promise<ShareKey> {
  return { raw, key: await importAesKey(raw) }
}

// Lo que se comparte: el elemento sin lo que es solo del dueño (favorito)
export function sharedData(d: ItemData): ItemData {
  return { ...d, favorite: false }
}

export function sealShareData(k: ShareKey, id: string, data: ItemData): Promise<string> {
  return encryptJson(k.key, sharedData(data), SHARE_AAD.data(id))
}

export function openShareData(k: ShareKey, id: string, sealed: string): Promise<ItemData> {
  return decryptJson<ItemData>(k.key, sealed, SHARE_AAD.data(id))
}

// --- Para el dueño ---

export function sealOwnerKey(userKey: CryptoKey, k: ShareKey, id: string): Promise<string> {
  return encryptBytes(userKey, k.raw, SHARE_AAD.ownerKey(id))
}

export async function openOwnerKey(userKey: CryptoKey, id: string, sealed: string): Promise<ShareKey> {
  return shareKeyFrom(await decryptBytes(userKey, sealed, SHARE_AAD.ownerKey(id)))
}

// --- Para otra cuenta (ECDH P-256) ---

const ECDH = { name: 'ECDH', namedCurve: 'P-256' } as const

async function wrapKeyFromEcdh(privateKey: CryptoKey, publicKey: CryptoKey, ephemeralRaw: Uint8Array, id: string): Promise<CryptoKey> {
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: publicKey }, privateKey, 256))
  // La llave efímera entra en la derivación: la llave K queda atada a este intercambio y a este compartido
  const bytes = await hkdf(shared, `passme:share:${id}:${toBase64Url(ephemeralRaw)}`)
  wipe(shared)
  const key = await importAesKey(bytes)
  wipe(bytes)
  return key
}

// recipientPublicKey: la llave pública (SPKI en base64) de la cuenta, tal como la da el servidor
export async function sealForUser(k: ShareKey, id: string, recipientPublicKey: string): Promise<string> {
  const recipient = await crypto.subtle.importKey('spki', fromBase64(recipientPublicKey), ECDH, false, [])
  const ephemeral = await crypto.subtle.generateKey(ECDH, true, ['deriveBits'])
  const ephemeralRaw = new Uint8Array(await crypto.subtle.exportKey('raw', ephemeral.publicKey))
  const wrap = await wrapKeyFromEcdh(ephemeral.privateKey, recipient, ephemeralRaw, id)
  return `e1.${toBase64Url(ephemeralRaw)}.${await encryptBytes(wrap, k.raw, SHARE_AAD.recipientKey(id))}`
}

// privateKey: la llave privada ECDH de la cuenta (unlockPrivateKey)
export async function openForUser(privateKey: CryptoKey, id: string, sealed: string): Promise<ShareKey> {
  const [prefix, ephemeralB64, ...rest] = sealed.split('.')
  if (prefix !== 'e1' || !ephemeralB64) throw new Error('share_format')
  const ephemeralRaw = fromBase64Url(ephemeralB64)
  const ephemeral = await crypto.subtle.importKey('raw', ephemeralRaw, ECDH, false, [])
  const wrap = await wrapKeyFromEcdh(privateKey, ephemeral, ephemeralRaw, id)
  return shareKeyFrom(await decryptBytes(wrap, rest.join('.'), SHARE_AAD.recipientKey(id)))
}

export async function unlockPrivateKey(userKey: CryptoKey, protectedPrivateKey: string): Promise<CryptoKey> {
  const raw = await decryptBytes(userKey, protectedPrivateKey, AAD.privateKey)
  const key = await crypto.subtle.importKey('pkcs8', raw, ECDH, false, ['deriveBits'])
  wipe(raw)
  return key
}

// --- Enlace con PIN (para quien no tiene cuenta) ---

export interface LinkSecret {
  // Va en el "#" del enlace; el navegador nunca lo manda al servidor
  secret: string
  pinKdf: KdfParams
}

// De Argon2id(PIN) y del secreto del enlace salen el verificador del PIN (al servidor, que cuenta
// los intentos) y la llave que cifra K. Sin el secreto, el servidor no puede probar PIN por su cuenta.
async function linkKeys(secret: string, pin: string, pinKdf: KdfParams) {
  const fromPin = await deriveKeys(pin, pinKdf, 'share-pin')
  const raw = fromBase64Url(secret)
  if (raw.length !== 32) throw new Error('share_format')
  const ikm = new Uint8Array([...raw, ...fromBase64(fromPin.authKey)])
  const authBytes = await hkdf(ikm, 'passme:share-link:auth')
  const encBytes = await hkdf(ikm, 'passme:share-link:enc')
  wipe(raw)
  wipe(ikm)
  const pinAuth = btoa(String.fromCharCode(...authBytes))
  const encKey = await importAesKey(encBytes)
  wipe(authBytes)
  wipe(encBytes)
  return { pinAuth, encKey }
}

export async function sealForLink(k: ShareKey, id: string, pin: string): Promise<LinkSecret & { recipientKey: string; pinAuth: string }> {
  const secret = toBase64Url(randomBytes(32))
  const pinKdf = newKdfParams()
  const { pinAuth, encKey } = await linkKeys(secret, pin, pinKdf)
  return { secret, pinKdf, pinAuth, recipientKey: await encryptBytes(encKey, k.raw, SHARE_AAD.recipientKey(id)) }
}

// Primero el verificador (para pedirle la copia al servidor) y luego, con la respuesta, la llave
export async function linkAuth(secret: string, pin: string, pinKdf: KdfParams) {
  const { pinAuth, encKey } = await linkKeys(secret, pin, pinKdf)
  return {
    pinAuth,
    async open(id: string, recipientKey: string, data: string): Promise<ItemData> {
      const k = await shareKeyFrom(await decryptBytes(encKey, recipientKey, SHARE_AAD.recipientKey(id)))
      return openShareData(k, id, data)
    }
  }
}

// PIN de 6 dígitos al azar (sin sesgo: se descartan los valores que no reparten parejo)
export function randomPin(): string {
  const limit = 4_294_000_000
  for (;;) {
    const [n] = crypto.getRandomValues(new Uint32Array(1))
    if (n! < limit) return String(n! % 1_000_000).padStart(6, '0')
  }
}
