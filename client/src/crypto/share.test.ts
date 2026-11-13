import { describe, expect, it } from 'vitest'
import { importAesKey } from './aes'
import { randomBytes, toBase64 } from './encoding'
import { emptyItem } from './items'
import {
  linkAuth,
  newShareKey,
  openForUser,
  openOwnerKey,
  openShareData,
  randomPin,
  sealForLink,
  sealForUser,
  sealOwnerKey,
  sealShareData
} from './share'

const ITEM = { ...emptyItem('login'), name: 'Netflix', favorite: true, fields: { username: 'ana', password: 's3creta' } }
const ID = crypto.randomUUID()

async function account() {
  const pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])
  const publicKey = toBase64(new Uint8Array(await crypto.subtle.exportKey('spki', pair.publicKey)))
  return { publicKey, privateKey: pair.privateKey }
}

describe('compartir', () => {
  it('con otra cuenta: solo su llave privada abre la copia', async () => {
    const ana = await account()
    const beto = await account()
    const k = await newShareKey()
    const data = await sealShareData(k, ID, ITEM)
    const sealed = await sealForUser(k, ID, beto.publicKey)
    expect(sealed).toMatch(/^e1\.[A-Za-z0-9_-]+\.v1\./)

    const opened = await openShareData(await openForUser(beto.privateKey, ID, sealed), ID, data)
    expect(opened).toMatchObject({ name: 'Netflix', favorite: false, fields: { password: 's3creta' } })
    await expect(openForUser(ana.privateKey, ID, sealed)).rejects.toThrow()
    // Atada a su id: no sirve copiarla a otro compartido
    await expect(openForUser(beto.privateKey, crypto.randomUUID(), sealed)).rejects.toThrow()
  })

  it('el dueño recupera la llave para actualizar la copia', async () => {
    const userKey = await importAesKey(randomBytes(32))
    const k = await newShareKey()
    const again = await openOwnerKey(userKey, ID, await sealOwnerKey(userKey, k, ID))
    const data = await sealShareData(again, ID, { ...ITEM, name: 'Netflix 2' })
    expect((await openShareData(k, ID, data)).name).toBe('Netflix 2')
  })

  it('con enlace: hacen falta el secreto y el PIN', async () => {
    const k = await newShareKey()
    const data = await sealShareData(k, ID, ITEM)
    const link = await sealForLink(k, ID, '482913')

    const right = await linkAuth(link.secret, '482913', link.pinKdf)
    expect(right.pinAuth).toBe(link.pinAuth)
    expect((await right.open(ID, link.recipientKey, data)).fields.password).toBe('s3creta')

    // PIN equivocado: otro verificador (el servidor lo rechaza) y la llave no abre
    const wrongPin = await linkAuth(link.secret, '000000', link.pinKdf)
    expect(wrongPin.pinAuth).not.toBe(link.pinAuth)
    await expect(wrongPin.open(ID, link.recipientKey, data)).rejects.toThrow()

    // Con el PIN pero otro secreto (el servidor no tiene el del enlace) tampoco
    const other = await sealForLink(k, ID, '482913')
    const wrongSecret = await linkAuth(other.secret, '482913', link.pinKdf)
    expect(wrongSecret.pinAuth).not.toBe(link.pinAuth)
  }, 30_000)

  it('genera PIN de 6 dígitos', () => {
    for (let i = 0; i < 50; i++) expect(randomPin()).toMatch(/^\d{6}$/)
  })
})
