import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError, type Account } from '../api/client'
import { createAccount, newRecoveryPhrase, unlockUserKey } from './keys'
import { deriveMasterKeys } from './kdf'
import { encryptJson, decryptJson } from './aes'

// Servidor de mentira: guarda el verificador y la mitad, y cuenta intentos como el real
const server = { id: '', verifier: '', share: Buffer.alloc(32, 9).toString('base64'), attempts: 0, replaced: '' }
vi.mock('../api/client', async (original) => ({
  ...(await original<typeof import('../api/client')>()),
  api: {
    enableQuickUnlock: async (_authKey: string, verifier: string, replace?: string) => {
      server.replaced = replace ?? ''
      server.id = crypto.randomUUID()
      server.verifier = verifier
      server.attempts = 0
      return { id: server.id, share: server.share }
    },
    openQuickUnlock: async (id: string, verifier: string) => {
      if (id !== server.id) throw new ApiError(409, 'quick_unlock_off')
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
    const account = { id: 'u1', kdf: payload.kdf, protectedUserKey: payload.protectedUserKey } as unknown as Account
    const master = await deriveMasterKeys(password, payload.kdf)

    const record = await enableQuickUnlock(account, master, 'pin', '480913', null)
    expect(loadQuickRecord(account)).toEqual(record)
    // Cada cuenta tiene el suyo en el mismo dispositivo
    expect(loadQuickRecord({ id: 'u2' } as unknown as Account)).toBeNull()
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

    // Cambiar a patrón reemplaza el dispositivo anterior en el servidor
    const pattern = await enableQuickUnlock(account, master, 'pattern', '0-1-2-5', record)
    expect(server.replaced).toBe(record.deviceId)
    expect(loadQuickRecord(account)).toEqual(pattern)
    await expect(openQuickUnlock(record, '480913')).rejects.toMatchObject({ code: 'quick_unlock_off' })
    expect(await openQuickUnlock(pattern, '0-1-2-5')).toBeTruthy()
  })

  it('descarta el registro de la v0.1.5, que iba ligado a la sesión', () => {
    store.set('passme:quick-unlock', JSON.stringify({ v: 1, userId: 'u1', method: 'pin', kdf: {}, blob: 'x' }))
    expect(loadQuickRecord({ id: 'u1' } as unknown as Account)).toBeNull()
    expect(store.size).toBe(0)
  })

  it('rechaza PINs obvios', () => {
    for (const pin of ['000000', '111111', '123456', '987654', '456789']) expect(isWeakPin(pin)).toBe(true)
    for (const pin of ['480913', '112233', '135790', '121212']) expect(isWeakPin(pin)).toBe(false)
  })
})
