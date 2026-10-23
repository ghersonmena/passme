import { api, type Account, type EncryptedVault } from '../api/client'
import { decryptItem, encryptItem, type EncryptedItem, type Item, type ItemData } from '../crypto/items'
import { decryptVaultMeta, unlockUserKey, unlockVaultKey, type VaultMeta } from '../crypto/keys'

// Una bóveda ya descifrada. Las llaves viven solo en memoria: al bloquear se sueltan todas las
// referencias y al recargar la página hay que volver a escribir la contraseña maestra.
export interface OpenVault {
  id: string
  role: EncryptedVault['role']
  meta: VaultMeta
  key: CryptoKey
}

export interface Unlocked {
  account: Account
  userKey: CryptoKey
  vaults: OpenVault[]
}

export async function openSession(account: Account, encKey: CryptoKey): Promise<Unlocked> {
  const userKey = await unlockUserKey(encKey, account.protectedUserKey)
  const vaults: OpenVault[] = []
  for (const v of await api.vaults()) {
    const key = await unlockVaultKey(userKey, v.id, v.protectedVaultKey)
    vaults.push({ id: v.id, role: v.role, key, meta: await decryptVaultMeta(key, v.id, v.data) })
  }
  return { account, userKey, vaults }
}

export interface LoadedItems {
  items: Item[]
  // Elementos que no se pudieron descifrar (dañados o de una bóveda sin llave)
  failed: number
}

export async function loadItems(session: Unlocked): Promise<LoadedItems> {
  const keys = new Map(session.vaults.map((v) => [v.id, v.key]))
  const items: Item[] = []
  let failed = 0
  for (const enc of await api.items()) {
    const key = keys.get(enc.vaultId)
    try {
      if (!key) throw new Error('no_key')
      items.push(await decryptItem(key, enc))
    } catch {
      failed++
    }
  }
  return { items, failed }
}

function vaultKey(session: Unlocked, vaultId: string): CryptoKey {
  const vault = session.vaults.find((v) => v.id === vaultId)
  if (!vault) throw new Error('vault_not_found')
  return vault.key
}

async function decrypted(session: Unlocked, enc: EncryptedItem): Promise<Item> {
  return decryptItem(vaultKey(session, enc.vaultId), enc)
}

export async function createItem(session: Unlocked, vaultId: string, data: ItemData): Promise<Item> {
  const id = crypto.randomUUID()
  const sealed = await encryptItem(vaultKey(session, vaultId), vaultId, id, data)
  return decrypted(session, await api.createItem(id, vaultId, sealed))
}

export async function updateItem(session: Unlocked, item: Item, data: ItemData): Promise<Item> {
  const sealed = await encryptItem(vaultKey(session, item.vaultId), item.vaultId, item.id, data)
  return decrypted(session, await api.updateItem(item.id, sealed, item.revision))
}

export async function trashItem(session: Unlocked, item: Item): Promise<Item> {
  return decrypted(session, await api.trashItem(item.id))
}

export async function restoreItem(session: Unlocked, item: Item): Promise<Item> {
  return decrypted(session, await api.restoreItem(item.id))
}
