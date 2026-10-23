import { describe, expect, it } from 'vitest'
import { decryptBytes, DecryptError, encryptBytes, importAesKey } from './aes'
import { randomBytes, utf8 } from './encoding'
import {
  estimatePasswordBits,
  generatePassphrase,
  generatePassword,
  randomInt,
  strengthFromBits
} from './generator'
import { decryptItem, emptyItem, encryptItem, normalizeItem } from './items'
import { deriveMasterKeys } from './kdf'
import {
  AAD,
  createAccount,
  decryptVaultMeta,
  deriveRecoveryKeys,
  isValidPhrase,
  newRecoveryPhrase,
  rewrapUserKey,
  unlockUserKey,
  unlockVaultKey
} from './keys'

describe('aes', () => {
  it('cifra y descifra, y rechaza otro AAD o un texto alterado', async () => {
    const key = await importAesKey(randomBytes(32))
    const sealed = await encryptBytes(key, utf8.encode('hola'), 'a')
    expect(sealed.startsWith('v1.')).toBe(true)
    expect(utf8.decode(await decryptBytes(key, sealed, 'a'))).toBe('hola')
    await expect(decryptBytes(key, sealed, 'b')).rejects.toBeInstanceOf(DecryptError)
    const tampered = sealed.slice(0, -2) + (sealed.endsWith('AA') ? 'BB' : 'AA')
    await expect(decryptBytes(key, tampered, 'a')).rejects.toBeInstanceOf(DecryptError)
  })

  it('usa un IV distinto cada vez', async () => {
    const key = await importAesKey(randomBytes(32))
    const a = await encryptBytes(key, utf8.encode('x'), 'a')
    const b = await encryptBytes(key, utf8.encode('x'), 'a')
    expect(a).not.toBe(b)
  })
})

describe('cuenta', () => {
  const password = 'correct horse battery staple ñ'

  it('crea la cuenta, desbloquea con la contraseña y con la frase de recuperación', async () => {
    const phrase = newRecoveryPhrase()
    expect(phrase.split(' ')).toHaveLength(24)
    expect(isValidPhrase(phrase)).toBe(true)

    const { payload, encKey } = await createAccount('a@b.c', password, phrase, 'Personal')
    await unlockUserKey(encKey, payload.protectedUserKey)
    expect(payload.authKey).toMatch(/^[A-Za-z0-9+/]{43}=$/)
    expect(payload.recoveryAuthKey).not.toBe(payload.authKey)
    expect(payload.kdf.salt).toMatch(/^[A-Za-z0-9+/]{22}==$/)

    // Contraseña correcta
    const master = await deriveMasterKeys(password, payload.kdf)
    expect(master.authKey).toBe(payload.authKey)
    const userKey = await unlockUserKey(master.encKey, payload.protectedUserKey)
    const vaultKey = await unlockVaultKey(userKey, payload.vault.id, payload.vault.protectedVaultKey)
    expect(await decryptVaultMeta(vaultKey, payload.vault.id, payload.vault.data)).toEqual({ name: 'Personal', icon: 'home', color: 'plum' })

    // Contraseña incorrecta
    const wrong = await deriveMasterKeys(password + 'x', payload.kdf)
    expect(wrong.authKey).not.toBe(payload.authKey)
    await expect(unlockUserKey(wrong.encKey, payload.protectedUserKey)).rejects.toBeInstanceOf(DecryptError)

    // Frase de recuperación (con mayúsculas y espacios de más) → nueva contraseña → misma bóveda
    const recovery = await deriveRecoveryKeys(`  ${phrase.toUpperCase().replace(/ /g, '   ')} `)
    expect(recovery.authKey).toBe(payload.recoveryAuthKey)
    const reset = await rewrapUserKey(
      recovery.encKey,
      payload.recoveryProtectedUserKey,
      'nueva contraseña larga',
      AAD.userKeyRecovery
    )
    const newMaster = await deriveMasterKeys('nueva contraseña larga', reset.kdf)
    expect(newMaster.authKey).toBe(reset.authKey)
    const sameUserKey = await unlockUserKey(newMaster.encKey, reset.protectedUserKey)
    const sameVaultKey = await unlockVaultKey(sameUserKey, payload.vault.id, payload.vault.protectedVaultKey)
    expect(await decryptVaultMeta(sameVaultKey, payload.vault.id, payload.vault.data)).toEqual({ name: 'Personal', icon: 'home', color: 'plum' })
  })

  it('rechaza frases inválidas', () => {
    expect(isValidPhrase('hola mundo')).toBe(false)
    // Solo se aceptan frases de 24 palabras
    expect(isValidPhrase(newRecoveryPhrase().split(' ').slice(0, 12).join(' '))).toBe(false)
    // Una palabra cambiada rompe la suma de verificación (1 en 256 de que no; se prueba con 'zoo')
    const words = newRecoveryPhrase().split(' ')
    const variants = ['abandon', 'zoo'].map((w) => [...words.slice(0, 23), w].join(' '))
    expect(variants.filter(isValidPhrase).length).toBeLessThan(2)
  })
})

describe('elementos', () => {
  it('ata cada elemento a su id y su bóveda', async () => {
    const key = await importAesKey(randomBytes(32))
    const vaultId = crypto.randomUUID()
    const id = crypto.randomUUID()
    const data = { ...emptyItem('login'), name: 'GitHub', fields: { username: 'ana', password: 's3cr3t' } }
    const sealed = await encryptItem(key, vaultId, id, data)
    const meta = { vaultId, revision: 1, createdAt: '', updatedAt: '', trashedAt: null }
    expect((await decryptItem(key, { ...meta, id, data: sealed })).data).toEqual(data)
    await expect(decryptItem(key, { ...meta, id: crypto.randomUUID(), data: sealed })).rejects.toThrow()
    await expect(
      decryptItem(key, { ...meta, id, vaultId: crypto.randomUUID(), data: sealed })
    ).rejects.toThrow()
  })
})

describe('formato de elementos', () => {
  it('convierte los inicios de sesión de la v0.1 al formato con campos', () => {
    const old = { type: 'login', name: 'GitHub', username: 'ana', password: 'x', urls: ['https://github.com'], note: '', favorite: true }
    expect(normalizeItem(old as never)).toEqual({
      type: 'login',
      name: 'GitHub',
      fields: { username: 'ana', password: 'x' },
      urls: ['https://github.com'],
      note: '',
      favorite: true,
      custom: []
    })
  })

  it('descarta valores que no son texto y tipos desconocidos', () => {
    const odd = normalizeItem({ type: 'spaceship', name: 'X', fields: { a: 'ok', b: 3 } } as never)
    expect(odd.type).toBe('note')
    expect(odd.fields).toEqual({ a: 'ok' })
  })
})

describe('generador', () => {
  it('respeta largo y grupos', () => {
    for (let i = 0; i < 200; i++) {
      const pw = generatePassword({ length: 16, lower: true, upper: true, digits: true, symbols: true, avoidAmbiguous: true })
      expect(pw).toHaveLength(16)
      expect(pw).toMatch(/[a-z]/)
      expect(pw).toMatch(/[A-Z]/)
      expect(pw).toMatch(/\d/)
      expect(pw).toMatch(/[^a-zA-Z0-9]/)
      expect(pw).not.toMatch(/[O0oIl1|]/)
    }
    expect(generatePassword({ length: 8, lower: false, upper: false, digits: true, symbols: false, avoidAmbiguous: false })).toMatch(/^\d{8}$/)
  })

  it('genera frases', () => {
    const p = generatePassphrase({ words: 5, separator: '-', capitalize: true, includeNumber: true })
    expect(p.split('-')).toHaveLength(5)
    expect(p).toMatch(/\d/)
    expect(p).toMatch(/^[A-Z]/)
  })

  it('randomInt es uniforme', () => {
    const counts: number[] = Array.from({ length: 6 }, () => 0)
    for (let i = 0; i < 60000; i++) counts[randomInt(6)]! += 1
    for (const c of counts) expect(Math.abs(c - 10000)).toBeLessThan(600)
  })

  it('califica contraseñas', () => {
    expect(strengthFromBits(estimatePasswordBits('123456'))).toBe('weak')
    expect(strengthFromBits(estimatePasswordBits('aaaaaaaaaaaaaaaaaaaa'))).toBe('weak')
    expect(strengthFromBits(estimatePasswordBits('x7#Kq9!mP2$vL8@wR4'))).toBe('strong')
  })
})
