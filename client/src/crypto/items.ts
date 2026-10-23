import { decryptJson, encryptJson } from './aes'
import { AAD } from './keys'

// Todo lo de un elemento (incluso su tipo y nombre) va dentro del texto cifrado: el servidor solo
// sabe que existe, en qué bóveda está y cuándo cambió
export interface LoginData {
  type: 'login'
  name: string
  username: string
  password: string
  urls: string[]
  note: string
  favorite: boolean
}

export type ItemData = LoginData

export interface Item {
  id: string
  vaultId: string
  revision: number
  createdAt: string
  updatedAt: string
  trashedAt: string | null
  data: ItemData
}

export interface EncryptedItem extends Omit<Item, 'data'> {
  data: string
}

export function emptyLogin(): LoginData {
  return { type: 'login', name: '', username: '', password: '', urls: [], note: '', favorite: false }
}

export function encryptItem(vaultKey: CryptoKey, vaultId: string, itemId: string, data: ItemData): Promise<string> {
  return encryptJson(vaultKey, data, AAD.item(vaultId, itemId))
}

export async function decryptItem(vaultKey: CryptoKey, item: EncryptedItem): Promise<Item> {
  const data = await decryptJson<ItemData>(vaultKey, item.data, AAD.item(item.vaultId, item.id))
  return { ...item, data }
}
