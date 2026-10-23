// Prueba de punta a punta: usa la criptografía real del cliente contra la API con una base de datos
// de prueba. Corre solo si existe TEST_DATABASE_URL (la base se borra al empezar).
//   TEST_DATABASE_URL=postgres://passme:passme-dev@localhost:5433/passme_test npm test -w server
import * as OTPAuth from 'otpauth'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { decryptItem, emptyItem, encryptItem } from '../../client/src/crypto/items'
import { deriveMasterKeys } from '../../client/src/crypto/kdf'
import {
  AAD,
  createAccount,
  decryptVaultMeta,
  encryptVaultMeta,
  newVault,
  deriveRecoveryKeys,
  newRecoveryPhrase,
  rewrapUserKey,
  unlockUserKey,
  unlockVaultKey
} from '../../client/src/crypto/keys'
import { buildApp } from '../src/app'
import type { Config } from '../src/config'
import { connect, migrate, type Sql } from '../src/db'
import { ServerKeys } from '../src/security'

const DB = process.env.TEST_DATABASE_URL
const SECRET = Buffer.alloc(32, 7)

type App = Awaited<ReturnType<typeof buildApp>>

function config(overrides: Partial<Config> = {}): Config {
  return {
    port: 0,
    host: '127.0.0.1',
    databaseUrl: DB ?? '',
    serverSecret: SECRET,
    registration: 'open',
    trustProxy: 1,
    sessionTtlDays: 14,
    authRateLimit: 1000,
    ...overrides
  }
}

class Client {
  cookie = ''
  constructor(private app: App) {}

  async call(method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, body?: unknown, csrf = true) {
    const res = await this.app.inject({
      method,
      url: `/api${url}`,
      headers: { ...(csrf ? { 'x-passme-request': '1' } : {}), ...(this.cookie ? { cookie: this.cookie } : {}) },
      ...(body === undefined ? {} : { payload: body as object })
    })
    const setCookie = res.headers['set-cookie']
    if (setCookie) {
      const first = (Array.isArray(setCookie) ? setCookie[0]! : setCookie).split(';')[0]!
      this.cookie = first.endsWith('=') ? '' : first
    }
    return { status: res.statusCode, body: res.json() as Record<string, any> }
  }
}

describe.skipIf(!DB)('API de punta a punta', () => {
  let sql: Sql
  let app: App

  beforeAll(async () => {
    sql = connect(DB!)
    await sql.unsafe('DROP SCHEMA public CASCADE; CREATE SCHEMA public;')
    await migrate(sql, () => {})
    app = await buildApp({ config: config(), sql, keys: new ServerKeys(SECRET), version: 'test' }, false)
  })

  afterAll(async () => {
    await app?.close()
    await sql?.end()
  })

  const email = 'ana@example.com'
  const password = 'una contraseña maestra muy larga'
  const phrase = newRecoveryPhrase()
  let itemId = ''
  let vaultId = ''
  let backupCodes: string[] = []
  let totpSecret = ''
  let enableCode = ''

  it('rechaza escrituras sin el encabezado CSRF', async () => {
    const c = new Client(app)
    expect((await c.call('POST', '/auth/prelogin', { email }, false)).status).toBe(403)
  })

  it('registra la primera cuenta como administrador y guarda solo datos cifrados', async () => {
    const c = new Client(app)
    expect((await c.call('GET', '/config')).body.registration).toBe('first')
    const { payload } = await createAccount(email, password, phrase, 'Personal')
    const res = await c.call('POST', '/auth/register', payload)
    expect(res.status).toBe(200)
    expect(c.cookie).toMatch(/^__Host-passme_sid=/)

    const account = (await c.call('GET', '/account')).body
    expect(account.isAdmin).toBe(true)
    expect(account.email).toBe(email)

    // El servidor no tiene la contraseña ni el authKey en claro
    const [row] = await sql`SELECT auth_hash FROM users WHERE email = ${email}`
    expect(row!.auth_hash).toMatch(/^scrypt\$/)
    expect(row!.auth_hash).not.toContain(payload.authKey)

    const dup = await new Client(app).call('POST', '/auth/register', payload)
    expect(dup.body.error).toBe('email_taken')
  })

  it('inicia sesión, crea, edita y borra elementos cifrados', async () => {
    const c = new Client(app)
    const { kdf } = (await c.call('POST', '/auth/prelogin', { email })).body
    const keys = await deriveMasterKeys(password, kdf)
    expect((await c.call('POST', '/auth/login', { email, authKey: keys.authKey })).body.mfaRequired).toBe(false)

    const account = (await c.call('GET', '/account')).body
    const userKey = await unlockUserKey(keys.encKey, account.protectedUserKey)
    const [vault] = (await c.call('GET', '/vaults')).body as unknown as { id: string; protectedVaultKey: string }[]
    vaultId = vault!.id
    const vaultKey = await unlockVaultKey(userKey, vault!.id, vault!.protectedVaultKey)

    itemId = crypto.randomUUID()
    const data = { ...emptyItem('login'), name: 'GitHub', fields: { username: 'ana', password: 's3cr3t!' } }
    const created = await c.call('POST', '/items', { id: itemId, vaultId, data: await encryptItem(vaultKey, vaultId, itemId, data) })
    expect(created.status).toBe(200)
    expect(created.body.data).not.toContain('GitHub')

    const updated = await c.call('PUT', `/items/${itemId}`, {
      data: await encryptItem(vaultKey, vaultId, itemId, { ...data, fields: { ...data.fields, password: 'otra' } }),
      revision: 1
    })
    expect(updated.body.revision).toBe(2)

    // Una edición basada en una revisión vieja se rechaza
    const stale = await c.call('PUT', `/items/${itemId}`, { data: created.body.data, revision: 1 })
    expect(stale.status).toBe(409)

    const [enc] = (await c.call('GET', '/items')).body as unknown as Parameters<typeof decryptItem>[1][]
    expect((await decryptItem(vaultKey, enc!)).data.fields.password).toBe('otra')

    // Borrar para siempre solo desde la papelera
    const temp = crypto.randomUUID()
    await c.call('POST', '/items', { id: temp, vaultId, data: await encryptItem(vaultKey, vaultId, temp, data) })
    expect((await c.call('DELETE', `/items/${temp}`)).body.error).toBe('not_in_trash')
    expect((await c.call('POST', `/items/${temp}/trash`, {})).body.trashedAt).toBeTruthy()
    expect((await c.call('DELETE', `/items/${temp}`)).status).toBe(200)

    expect((await c.call('POST', '/auth/logout', {})).status).toBe(200)
    expect((await c.call('GET', '/account')).status).toBe(401)
  })

  it('no revela si un correo existe', async () => {
    const c = new Client(app)
    const a = (await c.call('POST', '/auth/prelogin', { email: 'nadie@example.com' })).body
    const b = (await c.call('POST', '/auth/prelogin', { email: 'nadie@example.com' })).body
    expect(a.kdf.salt).toBe(b.kdf.salt)
    const fake = await deriveMasterKeys('x', a.kdf)
    const res = await c.call('POST', '/auth/login', { email: 'nadie@example.com', authKey: fake.authKey })
    expect(res.body.error).toBe('invalid_credentials')
  })

  it('aísla las bóvedas entre usuarios', async () => {
    const c = new Client(app)
    const { payload } = await createAccount('beto@example.com', password, newRecoveryPhrase(), 'Personal')
    await c.call('POST', '/auth/register', payload)
    expect((await c.call('GET', '/account')).body.isAdmin).toBe(false)
    expect((await c.call('GET', '/items')).body).toEqual([])
    expect((await c.call('PUT', `/items/${itemId}`, { data: 'v1.' + 'A'.repeat(60), revision: 2 })).status).toBe(404)
    expect((await c.call('POST', `/items/${itemId}/trash`, {})).status).toBe(404)
    // No puede crear elementos en la bóveda de otro
    const res = await c.call('POST', '/items', { id: crypto.randomUUID(), vaultId, data: 'v1.' + 'A'.repeat(60) })
    expect(res.status).toBe(404)
    // Ni editar, ni borrar, ni mover elementos hacia la bóveda de otro
    expect((await c.call('PUT', `/vaults/${vaultId}`, { data: 'v1.' + 'A'.repeat(60) })).status).toBe(404)
    expect((await c.call('DELETE', `/vaults/${vaultId}`)).status).toBe(404)
    const [own] = (await c.call('GET', '/vaults')).body as unknown as { id: string }[]
    const mine = crypto.randomUUID()
    await c.call('POST', '/items', { id: mine, vaultId: own!.id, data: 'v1.' + 'A'.repeat(60) })
    const moved = await c.call('POST', `/items/${mine}/move`, { vaultId, data: 'v1.' + 'A'.repeat(60), revision: 1 })
    expect(moved.status).toBe(404)
  })

  it('crea, edita y borra bóvedas, y mueve elementos entre ellas', async () => {
    const c = new Client(app)
    const { payload, encKey } = await createAccount('caro@example.com', password, newRecoveryPhrase(), 'Personal')
    await c.call('POST', '/auth/register', payload)
    const account = (await c.call('GET', '/account')).body
    const userKey = await unlockUserKey(encKey, account.protectedUserKey)
    const first = payload.vault.id
    const firstKey = await unlockVaultKey(userKey, first, payload.vault.protectedVaultKey)

    // La última bóveda no se puede borrar
    expect((await c.call('DELETE', `/vaults/${first}`)).body.error).toBe('last_vault')

    const work = await newVault(userKey, { name: 'Trabajo', icon: 'briefcase', color: 'blue' })
    const created = await c.call('POST', '/vaults', { id: work.id, data: work.data, protectedVaultKey: work.protectedVaultKey })
    expect(created.status).toBe(200)
    expect(created.body.role).toBe('owner')
    expect((await c.call('POST', '/vaults', { id: work.id, data: work.data, protectedVaultKey: work.protectedVaultKey })).status).toBe(409)

    const renamed = await encryptVaultMeta(work.key, work.id, { name: 'Oficina', icon: 'building', color: 'green' })
    expect((await c.call('PUT', `/vaults/${work.id}`, { data: renamed })).status).toBe(200)
    const listed = (await c.call('GET', '/vaults')).body as unknown as { id: string; data: string }[]
    expect(listed.map((v) => v.id)).toEqual([first, work.id])
    expect((await decryptVaultMeta(work.key, work.id, listed[1]!.data)).name).toBe('Oficina')

    // Mover: se vuelve a cifrar con la llave de la bóveda destino
    const id = crypto.randomUUID()
    const data = { ...emptyItem('wifi'), name: 'Casa', fields: { ssid: 'MiRed', password: 'clave' } }
    await c.call('POST', '/items', { id, vaultId: first, data: await encryptItem(firstKey, first, id, data) })
    const moved = await c.call('POST', `/items/${id}/move`, {
      vaultId: work.id,
      data: await encryptItem(work.key, work.id, id, data),
      revision: 1
    })
    expect(moved.body.vaultId).toBe(work.id)
    expect((await decryptItem(work.key, moved.body as never)).data.fields.ssid).toBe('MiRed')
    // Un movimiento con una revisión vieja se rechaza
    const stale = await c.call('POST', `/items/${id}/move`, {
      vaultId: first,
      data: await encryptItem(firstKey, first, id, data),
      revision: 1
    })
    expect(stale.status).toBe(409)

    // Borrar la bóveda borra también sus elementos
    expect((await c.call('DELETE', `/vaults/${work.id}`)).status).toBe(200)
    expect((await c.call('GET', '/items')).body).toEqual([])
    expect(((await c.call('GET', '/vaults')).body as unknown as unknown[]).length).toBe(1)
  })

  it('activa el 2FA y lo exige al iniciar sesión, sin aceptar códigos repetidos', async () => {
    const c = new Client(app)
    const { kdf } = (await c.call('POST', '/auth/prelogin', { email })).body
    const keys = await deriveMasterKeys(password, kdf)
    await c.call('POST', '/auth/login', { email, authKey: keys.authKey })

    const wrongPw = await deriveMasterKeys('otra', kdf)
    expect((await c.call('POST', '/account/totp/setup', { authKey: wrongPw.authKey })).body.error).toBe('invalid_password')

    const setup = (await c.call('POST', '/account/totp/setup', { authKey: keys.authKey })).body
    expect(setup.uri).toMatch(/^otpauth:\/\/totp\/PassMe/)
    totpSecret = setup.secret
    expect((await c.call('POST', '/account/totp/enable', { code: '000000' })).body.error).toBe('invalid_code')
    enableCode = new OTPAuth.TOTP({ secret: OTPAuth.Secret.fromBase32(totpSecret) }).generate()
    const enabled = await c.call('POST', '/account/totp/enable', { code: enableCode })
    backupCodes = enabled.body.backupCodes
    expect(backupCodes).toHaveLength(10)

    const d = new Client(app)
    expect((await d.call('POST', '/auth/login', { email, authKey: keys.authKey })).body.mfaRequired).toBe(true)
    // La sesión pendiente no da acceso a nada
    expect((await d.call('GET', '/account')).status).toBe(401)
    // El código con el que se activó ya no sirve
    expect((await d.call('POST', '/auth/login/mfa', { code: enableCode })).body.error).toBe('invalid_code')
    // Un código de respaldo sí, en minúsculas y sin guion
    const backup = backupCodes[0]!.replace('-', '').toLowerCase()
    expect((await d.call('POST', '/auth/login/mfa', { code: backup })).status).toBe(200)
    expect((await d.call('GET', '/account')).body.backupCodesLeft).toBe(9)

    // Y no se puede usar dos veces
    const e = new Client(app)
    await e.call('POST', '/auth/login', { email, authKey: keys.authKey })
    expect((await e.call('POST', '/auth/login/mfa', { code: backupCodes[0] })).body.error).toBe('invalid_code')
  })

  it('corta el 2FA tras 5 intentos fallidos', async () => {
    const c = new Client(app)
    const { kdf } = (await c.call('POST', '/auth/prelogin', { email })).body
    const keys = await deriveMasterKeys(password, kdf)
    await c.call('POST', '/auth/login', { email, authKey: keys.authKey })
    for (let i = 0; i < 5; i++) await c.call('POST', '/auth/login/mfa', { code: 'AAAAA-AAAAA' })
    expect((await c.call('POST', '/auth/login/mfa', { code: backupCodes[1] })).body.error).toBe('mfa_expired')
  })

  it('recupera la cuenta con la frase y conserva los datos', async () => {
    const c = new Client(app)
    const wrong = await deriveRecoveryKeys(newRecoveryPhrase())
    expect((await c.call('POST', '/auth/recover', { email, recoveryAuthKey: wrong.authKey })).body.error).toBe(
      'invalid_credentials'
    )

    const recovery = await deriveRecoveryKeys(phrase)
    const started = (await c.call('POST', '/auth/recover', { email, recoveryAuthKey: recovery.authKey })).body
    const next = await rewrapUserKey(
      recovery.encKey,
      started.recoveryProtectedUserKey,
      'contraseña nueva tras recuperar',
      AAD.userKeyRecovery
    )
    expect((await c.call('POST', '/auth/recover/reset', { token: started.token, ...next })).status).toBe(200)
    // El token de recuperación es de un solo uso (se borran todas las sesiones)
    expect((await c.call('POST', '/auth/recover/reset', { token: started.token, ...next })).body.error).toBe(
      'recovery_expired'
    )

    const old = await deriveMasterKeys(password, next.kdf)
    expect((await c.call('POST', '/auth/login', { email, authKey: old.authKey })).body.error).toBe('invalid_credentials')

    const keys = await deriveMasterKeys('contraseña nueva tras recuperar', next.kdf)
    expect((await c.call('POST', '/auth/login', { email, authKey: keys.authKey })).body.mfaRequired).toBe(true)
    expect((await c.call('POST', '/auth/login/mfa', { code: backupCodes[2] })).status).toBe(200)

    const account = (await c.call('GET', '/account')).body
    const userKey = await unlockUserKey(keys.encKey, account.protectedUserKey)
    const [vault] = (await c.call('GET', '/vaults')).body as unknown as { id: string; protectedVaultKey: string }[]
    const vaultKey = await unlockVaultKey(userKey, vault!.id, vault!.protectedVaultKey)
    const items = (await c.call('GET', '/items')).body as unknown as Parameters<typeof decryptItem>[1][]
    const item = items.find((i) => i.id === itemId)!
    expect((await decryptItem(vaultKey, item)).data.name).toBe('GitHub')
  })

  it('bloquea la cuenta tras 10 contraseñas incorrectas', async () => {
    const c = new Client(app)
    const target = 'beto@example.com'
    const { kdf } = (await c.call('POST', '/auth/prelogin', { email: target })).body
    const wrong = await deriveMasterKeys('incorrecta', kdf)
    for (let i = 0; i < 10; i++) await c.call('POST', '/auth/login', { email: target, authKey: wrong.authKey })
    const right = await deriveMasterKeys(password, kdf)
    expect((await c.call('POST', '/auth/login', { email: target, authKey: right.authKey })).body.error).toBe(
      'account_locked'
    )
  })

  it('con el registro cerrado no acepta cuentas nuevas', async () => {
    const closed = await buildApp(
      { config: config({ registration: 'closed' }), sql, keys: new ServerKeys(SECRET), version: 'test' },
      false
    )
    const c = new Client(closed)
    expect((await c.call('GET', '/config')).body.registration).toBe('closed')
    const { payload } = await createAccount('carla@example.com', password, newRecoveryPhrase(), 'Personal')
    expect((await c.call('POST', '/auth/register', payload)).body.error).toBe('registration_closed')
    await closed.close()
  })

  it('aplica el límite de intentos por IP', async () => {
    const limited = await buildApp(
      { config: config({ authRateLimit: 3 }), sql, keys: new ServerKeys(SECRET), version: 'test' },
      false
    )
    const c = new Client(limited)
    const statuses: number[] = []
    for (let i = 0; i < 4; i++) {
      statuses.push((await c.call('POST', '/auth/login', { email, authKey: 'A'.repeat(43) + '=' })).status)
    }
    expect(statuses).toEqual([401, 401, 401, 429])
    await limited.close()
  })
})
