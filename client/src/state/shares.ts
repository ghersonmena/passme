import { api, type OutgoingShare } from '../api/client'
import type { Item, ItemData } from '../crypto/items'
import {
  newShareKey,
  openForUser,
  openOwnerKey,
  openShareData,
  sealForLink,
  sealForUser,
  sealOwnerKey,
  sealShareData,
  unlockPrivateKey
} from '../crypto/share'
import type { Unlocked } from './session'

// Lo que otra cuenta te compartió, ya descifrado. Se muestra como un elemento de solo lectura.
export interface SharedItem {
  id: string
  from: string
  seen: boolean
  item: Item
}

export interface Shares {
  outgoing: OutgoingShare[]
  incoming: SharedItem[]
}

export async function loadShares(session: Unlocked): Promise<Shares> {
  const { outgoing, incoming } = await api.shares()
  if (!incoming.length) return { outgoing, incoming: [] }
  const privateKey = await unlockPrivateKey(session.userKey, session.account.protectedPrivateKey)
  const opened = await Promise.all(
    incoming.map(async (s): Promise<SharedItem | null> => {
      try {
        const data = await openShareData(await openForUser(privateKey, s.id, s.recipientKey), s.id, s.data)
        return {
          id: s.id,
          from: s.from,
          seen: !!s.seenAt,
          item: { id: s.id, vaultId: '', revision: 0, createdAt: s.createdAt, updatedAt: s.updatedAt, trashedAt: null, data }
        }
      } catch {
        // Una copia dañada o de una llave vieja no impide ver las demás
        return null
      }
    })
  )
  return { outgoing, incoming: opened.filter((s): s is SharedItem => !!s) }
}

export type ShareResult = { kind: 'user'; emailed: boolean } | { kind: 'external' }

// Con una cuenta del servidor se comparte de inmediato; sin cuenta hay que crear un enlace con PIN
export async function shareWithUser(session: Unlocked, item: Item, email: string, lang: string): Promise<ShareResult> {
  const { user } = await api.lookupUser(email)
  if (!user) return { kind: 'external' }
  const id = crypto.randomUUID()
  const k = await newShareKey()
  const res = await api.shareWithUser(
    {
      id,
      itemId: item.id,
      email: user.email,
      data: await sealShareData(k, id, item.data),
      ownerKey: await sealOwnerKey(session.userKey, k, id),
      recipientKey: await sealForUser(k, id, user.publicKey)
    },
    lang
  )
  return { kind: 'user', emailed: res.emailed }
}

// El enlace lleva el secreto después del "#": el navegador no lo manda al servidor
export const shareLinkUrl = (id: string, secret: string) => `${location.origin}/?share=${id}#${secret}`

export async function shareByLink(session: Unlocked, item: Item, email: string, pin: string, days: number): Promise<string> {
  const id = crypto.randomUUID()
  const k = await newShareKey()
  const link = await sealForLink(k, id, pin)
  await api.shareByLink({
    id,
    itemId: item.id,
    email,
    data: await sealShareData(k, id, item.data),
    ownerKey: await sealOwnerKey(session.userKey, k, id),
    recipientKey: link.recipientKey,
    pinKdf: link.pinKdf,
    pinAuth: link.pinAuth,
    days
  })
  return shareLinkUrl(id, link.secret)
}

// Al editar un elemento compartido se vuelve a cifrar cada copia con su llave, para que quien lo
// recibe vea la versión nueva
export async function syncShares(session: Unlocked, itemId: string, data: ItemData, outgoing: OutgoingShare[]): Promise<void> {
  await Promise.all(
    outgoing
      .filter((s) => s.itemId === itemId)
      .map(async (s) => {
        const k = await openOwnerKey(session.userKey, s.id, s.ownerKey)
        await api.updateShare(s.id, await sealShareData(k, s.id, data))
      })
  )
}
