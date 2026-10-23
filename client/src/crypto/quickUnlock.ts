import { api, type Account } from '../api/client'
import { decryptBytes, encryptBytes, importAesKey } from './aes'
import { fromBase64, utf8, wipe } from './encoding'
import { deriveKeys, newKdfParams, type DerivedKeys, type KdfParams } from './kdf'
import { AAD } from './keys'

// Desbloqueo rápido con PIN de 6 dígitos o patrón (ver docs/CRYPTO.md).
//
// La llave de usuario queda en este dispositivo cifrada dos veces:
//   1. con una llave aleatoria que guarda el servidor ("share") y
//   2. con una llave derivada del PIN con Argon2id y una sal que nunca sale del dispositivo.
// El servidor solo entrega el share a quien le muestre el verificador del PIN, con 5 intentos.
// Así, quien robe el dispositivo no puede probar el millón de PINs por su cuenta, y el servidor
// tampoco puede adivinar el PIN porque no conoce la sal.

export type QuickMethod = 'pin' | 'pattern'

export interface QuickRecord {
  v: 1
  userId: string
  method: QuickMethod
  kdf: KdfParams
  blob: string
}

const STORE = 'passme:quick-unlock'
const PURPOSE = 'quick-unlock'
export const PIN_LENGTH = 6
export const PATTERN_MIN = 4

const secretFor = (method: QuickMethod, secret: string) => `${method}:${secret}`

export function loadQuickRecord(account: Account): QuickRecord | null {
  try {
    const raw = JSON.parse(localStorage.getItem(STORE) ?? 'null') as QuickRecord | null
    if (raw?.v === 1 && raw.userId === account.id && account.quickUnlock) return raw
    // Del servidor ya no está activo (intentos agotados, otra cuenta, sesión nueva): se descarta
    if (raw) clearQuickRecord()
  } catch {
    // Sin almacenamiento disponible: no hay desbloqueo rápido
  }
  return null
}

export function clearQuickRecord(): void {
  try {
    localStorage.removeItem(STORE)
  } catch {
    // Nada que borrar
  }
}

// Pide las llaves de la contraseña maestra: es la única forma de obtener la llave de usuario en
// bruto, porque en memoria solo existe como CryptoKey no exportable
export async function enableQuickUnlock(
  account: Account,
  master: DerivedKeys,
  method: QuickMethod,
  secret: string
): Promise<QuickRecord> {
  const raw = await decryptBytes(master.encKey, account.protectedUserKey, AAD.userKey)
  try {
    const kdf = newKdfParams()
    const quick = await deriveKeys(secretFor(method, secret), kdf, PURPOSE)
    const { share } = await api.enableQuickUnlock(master.authKey, quick.authKey)
    const shareKey = await importShare(share)
    const inner = await encryptBytes(shareKey, raw, AAD.quickUnlockShare)
    const blob = await encryptBytes(quick.encKey, utf8.encode(inner), AAD.quickUnlock)
    const record: QuickRecord = { v: 1, userId: account.id, method, kdf, blob }
    localStorage.setItem(STORE, JSON.stringify(record))
    return record
  } finally {
    wipe(raw)
  }
}

export async function disableQuickUnlock(): Promise<void> {
  await api.disableQuickUnlock()
  clearQuickRecord()
}

// Devuelve la llave de usuario. Un PIN incorrecto llega como ApiError 'wrong_pin' (con los
// intentos que quedan) y, si se agotan, como 'quick_unlock_off'.
export async function openQuickUnlock(record: QuickRecord, secret: string): Promise<CryptoKey> {
  const quick = await deriveKeys(secretFor(record.method, secret), record.kdf, PURPOSE)
  const { share } = await api.openQuickUnlock(quick.authKey)
  const inner = utf8.decode(await decryptBytes(quick.encKey, record.blob, AAD.quickUnlock))
  const raw = await decryptBytes(await importShare(share), inner, AAD.quickUnlockShare)
  try {
    return await importAesKey(raw)
  } finally {
    wipe(raw)
  }
}

async function importShare(share: string): Promise<CryptoKey> {
  const bytes = fromBase64(share)
  const key = await importAesKey(bytes)
  wipe(bytes)
  return key
}

// PINs que cualquiera probaría primero: todos iguales o una escalera (123456, 987654)
export function isWeakPin(pin: string): boolean {
  const d = [...pin].map(Number)
  const steps = new Set(d.slice(1).map((n, i) => n - d[i]!))
  return steps.size === 1 && [0, 1, -1].includes([...steps][0]!)
}
