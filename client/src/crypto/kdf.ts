import { argon2id } from 'hash-wasm'
import { importAesKey } from './aes'
import { fromBase64, randomBytes, toBase64, utf8, wipe } from './encoding'

export interface KdfParams {
  alg: 'argon2id'
  salt: string
  // Memoria en KiB, iteraciones y paralelismo
  m: number
  t: number
  p: number
}

// 64 MiB y 3 pasadas: las recomendaciones de OWASP para Argon2id, y aún rápido en un teléfono
export function newKdfParams(): KdfParams {
  return { alg: 'argon2id', salt: toBase64(randomBytes(16)), m: 65536, t: 3, p: 1 }
}

export interface DerivedKeys {
  // Se manda al servidor para iniciar sesión; no sirve para descifrar nada
  authKey: string
  // Nunca sale del navegador: descifra la llave de usuario
  encKey: CryptoKey
}

export async function hkdf(ikm: Uint8Array<ArrayBuffer>, info: string): Promise<Uint8Array<ArrayBuffer>> {
  const base = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(32), info: utf8.encode(info) },
    base,
    256
  )
  return new Uint8Array(bits)
}

// De un secreto de 256 bits salen dos llaves independientes: una para autenticarse y otra para
// cifrar. Conocer la de autenticación (el servidor) no da ninguna pista de la de cifrado.
export async function splitKeys(secret: Uint8Array<ArrayBuffer>, purpose: string): Promise<DerivedKeys> {
  const auth = await hkdf(secret, `passme:${purpose}:auth`)
  const enc = await hkdf(secret, `passme:${purpose}:enc`)
  const authKey = toBase64(auth)
  const encKey = await importAesKey(enc)
  wipe(auth)
  wipe(enc)
  return { authKey, encKey }
}

export async function deriveMasterKeys(password: string, kdf: KdfParams): Promise<DerivedKeys> {
  const master = await argon2id({
    // NFKC: la misma contraseña escrita en otro teclado o sistema produce los mismos bytes
    password: password.normalize('NFKC'),
    salt: fromBase64(kdf.salt),
    memorySize: kdf.m,
    iterations: kdf.t,
    parallelism: kdf.p,
    hashLength: 32,
    outputType: 'binary'
  })
  const keys = await splitKeys(new Uint8Array(master), 'master')
  wipe(master)
  return keys
}
