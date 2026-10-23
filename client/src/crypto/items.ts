import { decryptJson, encryptJson } from './aes'
import { AAD } from './keys'

// Todo lo de un elemento (incluso su tipo y nombre) va dentro del texto cifrado: el servidor solo
// sabe que existe, en qué bóveda está y cuándo cambió
export const ITEM_TYPES = [
  'login',
  'note',
  'card',
  'identity',
  'api',
  'database',
  'server',
  'license',
  'sshKey',
  'wifi',
  'location',
  'bank',
  'crypto',
  'medical',
  'passport'
] as const

export type ItemType = (typeof ITEM_TYPES)[number]

export interface CustomField {
  label: string
  value: string
  secret: boolean
}

export interface ItemData {
  type: ItemType
  name: string
  // Campos propios de cada tipo (usuario, número de tarjeta, host…), todos como texto. Qué campos
  // tiene cada tipo lo define la interfaz; aquí no se valida para no perder datos de versiones nuevas.
  fields: Record<string, string>
  // Sitios web: solo los usan los inicios de sesión
  urls: string[]
  note: string
  favorite: boolean
  custom: CustomField[]
}

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

export function emptyItem(type: ItemType): ItemData {
  return { type, name: '', fields: {}, urls: [], note: '', favorite: false, custom: [] }
}

// Los inicios de sesión de la v0.1 guardaban usuario y contraseña en la raíz
interface LegacyLogin {
  type: 'login'
  username?: string
  password?: string
}

export function normalizeItem(raw: Partial<ItemData> & Partial<LegacyLogin>): ItemData {
  const type = ITEM_TYPES.includes(raw.type as ItemType) ? (raw.type as ItemType) : 'note'
  const fields: Record<string, string> = {}
  for (const [key, value] of Object.entries(raw.fields ?? {})) {
    if (typeof value === 'string') fields[key] = value
  }
  if (!raw.fields && type === 'login') {
    fields.username = raw.username ?? ''
    fields.password = raw.password ?? ''
  }
  return {
    type,
    name: raw.name ?? '',
    fields,
    urls: Array.isArray(raw.urls) ? raw.urls.filter((u) => typeof u === 'string') : [],
    note: raw.note ?? '',
    favorite: !!raw.favorite,
    custom: Array.isArray(raw.custom)
      ? raw.custom.map((c) => ({ label: String(c.label ?? ''), value: String(c.value ?? ''), secret: !!c.secret }))
      : []
  }
}

export function encryptItem(vaultKey: CryptoKey, vaultId: string, itemId: string, data: ItemData): Promise<string> {
  return encryptJson(vaultKey, data, AAD.item(vaultId, itemId))
}

export async function decryptItem(vaultKey: CryptoKey, item: EncryptedItem): Promise<Item> {
  const raw = await decryptJson<Partial<ItemData> & Partial<LegacyLogin>>(vaultKey, item.data, AAD.item(item.vaultId, item.id))
  return { ...item, data: normalizeItem(raw) }
}
