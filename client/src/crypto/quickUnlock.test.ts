import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError, type Account } from '../api/client'
import { createAccount, newRecoveryPhrase, unlockUserKey } from './keys'
import { deriveMasterKeys } from './kdf'
import { encryptJson, decryptJson } from './aes'

// Servidor de mentira: guarda el verificador y la mitad, y cuenta intentos como el real
const server = { verifier: '', share: Buffer.alloc(32, 9).toString('base64'), attempts: 0 }
vi.mock('../api/client', async (original) => ({
  ...(await original<typeof import('../api/client')>()),
  api: {
    enableQuickUnlock: async (_authKey: string, verifier: string) => {
      server.verifier = verifier
      server.attempts = 0
      return { share: server.share }
    },
    openQuickUnlock: async (verifier: string) => {
      if (verifier === server.verifier) return { share: server.share }
      server.attempts++
      throw new ApiError(400, 'wrong_pin', { attemptsLeft: 5 - server.attempts })
    },
    disableQuickUnlock: async () => ({ ok: true })
  }
}))

const { enableQuickUnlock, openQuickUnlock, isWeakPin, loadQuickRecord } = await import('./quickUnlock')

const store = new Map<string, string>()
vi.stubGlobal('localStorage', {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k)
})

describe('desbloqueo rápido', () => {
  beforeEach(() => store.clear())

  it('recupera la misma llave de usuario con el PIN correcto y no con otro', async () => {
    const password = 'una contraseña maestra muy larga'
    const { payload } = await createAccount('eva@example.com', password, newRecoveryPhrase(), 'Personal')
    const account = { id: 'u1', kdf: payload.kdf, protectedUserKey: payload.protectedUserKey, quickUnlock: true } as Account
    const master = await deriveMasterKeys(password, payload.kdf)

    const record = await enableQuickUnlock(account, master, 'pin', '480913')
    expect(loadQuickRecord(account)).toEqual(record)
    // El blob guardado no contiene el PIN ni la mitad del servidor
    expect(JSON.stringify(record)).not.toContain('480913')
    expect(JSON.stringify(record)).not.toContain(server.share)

    const quickKey = await openQuickUnlock(record, '480913')
    const realKey = await unlockUserKey(master.encKey, payload.protectedUserKey)
    // Misma llave: lo que cifra una, lo descifra la otra
    const sealed = await encryptJson(realKey, { ok: 1 }, 'prueba')
    expect(await decryptJson(quickKey, sealed, 'prueba')).toEqual({ ok: 1 })

    await expect(openQuickUnlock(record, '480914')).rejects.toMatchObject({ code: 'wrong_pin', extra: { attemptsLeft: 4 } })
    // El mismo dígito como patrón es otro secreto
    await expect(openQuickUnlock({ ...record, method: 'pattern' }, '480913')).rejects.toMatchObject({ code: 'wrong_pin' })
  })

  it('descarta el registro si el servidor ya no lo tiene activo o es de otra cuenta', async () => {
    store.set('passme:quick-unlock', JSON.stringify({ v: 1, userId: 'u1', method: 'pin', kdf: {}, blob: 'x' }))
    expect(loadQuickRecord({ id: 'u2', quickUnlock: true } as Account)).toBeNull()
    expect(store.size).toBe(0)
    store.set('passme:quick-unlock', JSON.stringify({ v: 1, userId: 'u1', method: 'pin', kdf: {}, blob: 'x' }))
    expect(loadQuickRecord({ id: 'u1', quickUnlock: false } as Account)).toBeNull()
  })

  it('rechaza PINs obvios', () => {
    for (const pin of ['000000', '111111', '123456', '987654', '456789']) expect(isWeakPin(pin)).toBe(true)
    for (const pin of ['480913', '112233', '135790', '121212']) expect(isWeakPin(pin)).toBe(false)
  })
})
