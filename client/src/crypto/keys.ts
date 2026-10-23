import { generateMnemonic, mnemonicToEntropy, validateMnemonic } from '@scure/bip39'
import { wordlist } from '@scure/bip39/wordlists/english.js'
import { decryptBytes, decryptJson, encryptBytes, encryptJson, importAesKey } from './aes'
import { randomBytes, toBase64, wipe } from './encoding'
import { deriveMasterKeys, newKdfParams, splitKeys, type DerivedKeys, type KdfParams } from './kdf'

// Jerarquía de llaves (ver docs/CRYPTO.md):
//   contraseña maestra ─Argon2id→ llave maestra ─HKDF→ authKey (al servidor) + encKey
//   frase de 24 palabras ─HKDF→ recoveryAuthKey (al servidor) + recoveryEncKey
//   encKey y recoveryEncKey cifran, cada una, una copia de la llave de usuario
//   la llave de usuario cifra la llave privada y las llaves de cada bóveda
//   cada llave de bóveda cifra sus elementos
export const AAD = {
  userKey: 'passme:user-key',
  userKeyRecovery: 'passme:user-key:recovery',
  privateKey: 'passme:private-key',
  vaultKey: (vaultId: string) => `passme:vault-key:${vaultId}`,
  vault: (vaultId: string) => `passme:vault:${vaultId}`,
  item: (vaultId: string, itemId: string) => `passme:item:${vaultId}:${itemId}`
}

export interface VaultMeta {
  name: string
}

// --- Frase de recuperación (BIP39, 24 palabras = 256 bits) ---

export function newRecoveryPhrase(): string {
  return generateMnemonic(wordlist, 256)
}

export function normalizePhrase(phrase: string): string {
  return phrase.trim().toLowerCase().split(/\s+/).join(' ')
}

export function isValidPhrase(phrase: string): boolean {
  const normalized = normalizePhrase(phrase)
  return normalized.split(' ').length === 24 && validateMnemonic(normalized, wordlist)
}

// La frase ya tiene 256 bits de entropía, así que no necesita un KDF lento como la contraseña
export async function deriveRecoveryKeys(phrase: string): Promise<DerivedKeys> {
  const entropy = mnemonicToEntropy(normalizePhrase(phrase), wordlist)
  const keys = await splitKeys(new Uint8Array(entropy), 'recovery')
  wipe(entropy)
  return keys
}

// --- Creación de cuenta ---

export interface RegisterPayload {
  email: string
  kdf: KdfParams
  authKey: string
  protectedUserKey: string
  recoveryAuthKey: string
  recoveryProtectedUserKey: string
  publicKey: string
  protectedPrivateKey: string
  vault: { id: string; data: string; protectedVaultKey: string }
}

export async function createAccount(
  email: string,
  password: string,
  phrase: string,
  defaultVaultName: string
): Promise<{ payload: RegisterPayload; encKey: CryptoKey }> {
  const kdf = newKdfParams()
  const master = await deriveMasterKeys(password, kdf)
  const recovery = await deriveRecoveryKeys(phrase)

  const userKeyRaw = randomBytes(32)
  const userKey = await importAesKey(userKeyRaw)
  const protectedUserKey = await encryptBytes(master.encKey, userKeyRaw, AAD.userKey)
  const recoveryProtectedUserKey = await encryptBytes(recovery.encKey, userKeyRaw, AAD.userKeyRecovery)
  wipe(userKeyRaw)

  // Par de llaves P-256 para que otros usuarios puedan compartir bóvedas contigo (v0.6)
  const pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])
  const publicKey = toBase64(new Uint8Array(await crypto.subtle.exportKey('spki', pair.publicKey)))
  const privateRaw = new Uint8Array(await crypto.subtle.exportKey('pkcs8', pair.privateKey))
  const protectedPrivateKey = await encryptBytes(userKey, privateRaw, AAD.privateKey)
  wipe(privateRaw)

  const vaultId = crypto.randomUUID()
  const vaultKeyRaw = randomBytes(32)
  const vaultKey = await importAesKey(vaultKeyRaw)
  const protectedVaultKey = await encryptBytes(userKey, vaultKeyRaw, AAD.vaultKey(vaultId))
  wipe(vaultKeyRaw)
  const meta: VaultMeta = { name: defaultVaultName }

  const payload: RegisterPayload = {
    email,
    kdf,
    authKey: master.authKey,
    protectedUserKey,
    recoveryAuthKey: recovery.authKey,
    recoveryProtectedUserKey,
    publicKey,
    protectedPrivateKey,
    vault: { id: vaultId, data: await encryptJson(vaultKey, meta, AAD.vault(vaultId)), protectedVaultKey }
  }
  return { payload, encKey: master.encKey }
}

// --- Desbloqueo ---

// Descifra la llave de usuario. Si la contraseña es incorrecta el GCM falla con DecryptError.
export async function unlockUserKey(encKey: CryptoKey, protectedUserKey: string, aad = AAD.userKey): Promise<CryptoKey> {
  const raw = await decryptBytes(encKey, protectedUserKey, aad)
  const key = await importAesKey(raw)
  wipe(raw)
  return key
}

// Vuelve a cifrar la llave de usuario con una contraseña nueva (cambio de contraseña o
// recuperación). La llave de usuario es la misma, así que las bóvedas no se tocan.
export async function rewrapUserKey(
  oldEncKey: CryptoKey,
  protectedUserKey: string,
  newPassword: string,
  aad = AAD.userKey
): Promise<{ kdf: KdfParams; authKey: string; protectedUserKey: string }> {
  const raw = await decryptBytes(oldEncKey, protectedUserKey, aad)
  const kdf = newKdfParams()
  const master = await deriveMasterKeys(newPassword, kdf)
  const rewrapped = await encryptBytes(master.encKey, raw, AAD.userKey)
  wipe(raw)
  return { kdf, authKey: master.authKey, protectedUserKey: rewrapped }
}

export async function unlockVaultKey(userKey: CryptoKey, vaultId: string, protectedVaultKey: string): Promise<CryptoKey> {
  const raw = await decryptBytes(userKey, protectedVaultKey, AAD.vaultKey(vaultId))
  const key = await importAesKey(raw)
  wipe(raw)
  return key
}

export function decryptVaultMeta(vaultKey: CryptoKey, vaultId: string, data: string): Promise<VaultMeta> {
  return decryptJson<VaultMeta>(vaultKey, data, AAD.vault(vaultId))
}
