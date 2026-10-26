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
import type { Mail } from '../src/mail'
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
    smtp: null,
    publicUrl: null,
    ...overrides
  }
}

// Buzón falso: guarda los correos en vez de mandarlos
const outbox: Mail[] = []
const mailer = { send: async (mail: Mail) => void outbox.push(mail) }

class Client {
  cookie = ''
  headers: Record<string, string> = {}
  constructor(private app: App) {}

  async call(method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, body?: unknown, csrf = true) {
    const res = await this.app.inject({
      method,
      url: `/api${url}`,
      headers: { ...this.headers, ...(csrf ? { 'x-passme-request': '1' } : {}), ...(this.cookie ? { cookie: this.cookie } : {}) },
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
    app = await buildApp({ config: config(), sql, keys: new ServerKeys(SECRET), mailer, version: 'test' }, false)
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

  it('importa elementos por lotes, todo o nada', async () => {
    const c = new Client(app)
    const { payload, encKey } = await createAccount('fer@example.com', password, newRecoveryPhrase(), 'Personal')
    await c.call('POST', '/auth/register', payload)
    const account = (await c.call('GET', '/account')).body
    const userKey = await unlockUserKey(encKey, account.protectedUserKey)
    const vault = payload.vault.id
    const key = await unlockVaultKey(userKey, vault, payload.vault.protectedVaultKey)

    const batch = await Promise.all(
      Array.from({ length: 100 }, async (_, n) => {
        const id = crypto.randomUUID()
        const data = { ...emptyItem('login'), name: `Sitio ${n}`, fields: { username: 'dani', password: `clave-${n}` } }
        return { id, data: await encryptItem(key, vault, id, data) }
      })
    )
    const res = await c.call('POST', '/items/batch', { vaultId: vault, items: batch })
    expect(res.status).toBe(200)
    expect((res.body as unknown as unknown[]).length).toBe(100)

    // Más de 100 se rechaza, y un lote con un id repetido no guarda nada
    const extra = { id: crypto.randomUUID(), data: batch[0]!.data }
    expect((await c.call('POST', '/items/batch', { vaultId: vault, items: [...batch, extra] })).status).toBe(400)
    expect((await c.call('POST', '/items/batch', { vaultId: vault, items: [extra, batch[0]] })).status).toBe(409)
    expect(((await c.call('GET', '/items')).body as unknown as unknown[]).length).toBe(100)

    // Ni en la bóveda de otro usuario
    expect((await c.call('POST', '/items/batch', { vaultId, items: [extra] })).status).toBe(404)
  })

  it('desbloqueo rápido: pide la contraseña, limita los intentos y sobrevive al cerrar sesión', async () => {
    const c = new Client(app)
    const { payload } = await createAccount('dani@example.com', password, newRecoveryPhrase(), 'Personal')
    await c.call('POST', '/auth/register', payload)
    const verifier = Buffer.alloc(32, 1).toString('base64')
    const wrong = Buffer.alloc(32, 2).toString('base64')

    // Sin la contraseña maestra no se activa
    const denied = await c.call('POST', '/account/quick-unlock', { authKey: wrong, verifier })
    expect(denied.body.error).toBe('invalid_password')

    const enabled = await c.call('POST', '/account/quick-unlock', { authKey: payload.authKey, verifier })
    const { id, share } = enabled.body as { id: string; share: string }
    expect(share).toMatch(/^[A-Za-z0-9+/]{43}=$/)
    // La mitad del servidor se guarda cifrada con SERVER_SECRET
    const [row] = await sql`SELECT share FROM quick_unlock_devices WHERE id = ${id}`
    expect(row!.share).not.toBe(share)

    const open = (v: string, client = c, device = id) => client.call('POST', `/account/quick-unlock/${device}/open`, { verifier: v })
    expect((await open(wrong)).body).toEqual({ error: 'wrong_pin', attemptsLeft: 4 })
    // Un acierto devuelve la mitad y reinicia el contador
    expect((await open(verifier)).body.share).toBe(share)

    // Cerrar sesión no lo borra: con una sesión nueva (contraseña de nuevo) sigue sirviendo
    await c.call('POST', '/auth/logout', {})
    expect((await open(verifier)).status).toBe(401)
    await c.call('POST', '/auth/login', { email: 'dani@example.com', authKey: payload.authKey })
    expect((await open(verifier)).body.share).toBe(share)

    // Otra cuenta no puede usar el dispositivo de Dani
    expect((await open(verifier, new Client(app))).status).toBe(401)
    const beto = new Client(app)
    const { payload: other } = await createAccount('eli@example.com', password, newRecoveryPhrase(), 'Personal')
    await beto.call('POST', '/auth/register', other)
    expect((await open(verifier, beto)).body.error).toBe('quick_unlock_off')

    for (const left of [4, 3, 2, 1]) expect((await open(wrong)).body.attemptsLeft).toBe(left)
    // El quinto fallo lo borra; ni el verificador correcto sirve después
    expect((await open(wrong)).body.error).toBe('quick_unlock_off')
    expect((await open(verifier)).body.error).toBe('quick_unlock_off')

    // Cambiar de PIN reemplaza el dispositivo anterior
    const a = (await c.call('POST', '/account/quick-unlock', { authKey: payload.authKey, verifier })).body.id
    const b = (await c.call('POST', '/account/quick-unlock', { authKey: payload.authKey, verifier, replace: a })).body.id
    expect((await open(verifier, c, a)).body.error).toBe('quick_unlock_off')

    // Cambiar la contraseña conserva el de este dispositivo y revoca los demás
    const d = (await c.call('POST', '/account/quick-unlock', { authKey: payload.authKey, verifier })).body.id
    const next = await rewrapUserKey(
      (await deriveMasterKeys(password, payload.kdf)).encKey,
      payload.protectedUserKey,
      'otra contraseña maestra larga'
    )
    expect((await c.call('POST', '/account/password', { currentAuthKey: payload.authKey, ...next, keepQuickUnlock: b })).status).toBe(200)
    expect((await open(verifier, c, b)).body.share).toBeTruthy()
    expect((await open(verifier, c, d)).body.error).toBe('quick_unlock_off')
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

  it('invitaciones: el administrador invita por correo y el enlace sirve una vez', async () => {
    // Un administrador propio para esta prueba (Ana ya tiene 2FA de las anteriores)
    const admin = new Client(app)
    admin.headers.origin = 'https://passme.example'
    await admin.call('POST', '/auth/register', (await createAccount('iris@example.com', password, newRecoveryPhrase(), 'Personal')).payload)
    await sql`UPDATE users SET is_admin = true WHERE email = 'iris@example.com'`

    // Un usuario normal no entra al panel
    const beto = new Client(app)
    await beto.call('POST', '/auth/register', (await createAccount('jose@example.com', password, newRecoveryPhrase(), 'Personal')).payload)
    expect((await beto.call('GET', '/admin')).status).toBe(403)
    expect((await beto.call('POST', '/admin/invitations', { email: 'x@example.com' })).status).toBe(403)

    // Solo por invitación: registrarse sin enlace se rechaza
    expect((await admin.call('PUT', '/admin/registration', { mode: 'invite' })).status).toBe(200)
    expect((await new Client(app).call('GET', '/config')).body.registration).toBe('invite')
    const gaby = await createAccount('gaby@example.com', password, newRecoveryPhrase(), 'Personal')
    expect((await new Client(app).call('POST', '/auth/register', gaby.payload)).body.error).toBe('registration_closed')

    // Invitar manda el correo con el enlace
    const sent = await admin.call('POST', '/admin/invitations', { email: 'Gaby@Example.com', lang: 'es' })
    expect(sent.body.emailed).toBe(true)
    const token = new URL(sent.body.link).searchParams.get('invite')!
    expect(sent.body.link).toBe(`https://passme.example/?invite=${token}`)
    const mail = outbox.at(-1)!
    expect(mail.to).toBe('gaby@example.com')
    expect(mail.text).toContain(sent.body.link)
    expect(mail.html).toContain('iris@example.com')
    // La base solo guarda el hash del token
    const [row] = await sql`SELECT token_hash FROM invitations WHERE email = 'gaby@example.com'`
    expect(Buffer.from(row!.token_hash).toString('base64url')).not.toBe(token)

    const visitor = new Client(app)
    expect((await visitor.call('GET', `/invite/${token}`)).body.email).toBe('gaby@example.com')
    // La invitación es para ese correo
    const other = await createAccount('otro@example.com', password, newRecoveryPhrase(), 'Personal')
    expect((await visitor.call('POST', '/auth/register', { ...other.payload, invite: token })).body.error).toBe('invite_email')
    expect((await visitor.call('POST', '/auth/register', { ...gaby.payload, invite: token })).status).toBe(200)
    // Ya usada no sirve otra vez
    expect((await new Client(app).call('GET', `/invite/${token}`)).status).toBe(404)
    expect((await new Client(app).call('POST', '/auth/register', { ...other.payload, invite: token })).body.error).toBe('invite_invalid')

    // No se invita a quien ya tiene cuenta, y una invitación revocada deja de servir
    expect((await admin.call('POST', '/admin/invitations', { email: 'gaby@example.com' })).body.error).toBe('email_taken')
    const hugo = await admin.call('POST', '/admin/invitations', { email: 'hugo@example.com', lang: 'en' })
    expect(outbox.at(-1)!.subject).toBe("You're invited to PassMe")
    const overview = (await admin.call('GET', '/admin')).body
    expect(overview.invitations.map((i: { email: string }) => i.email)).toEqual(['hugo@example.com'])
    expect(overview.users.find((u: { email: string }) => u.email === 'gaby@example.com').isAdmin).toBe(false)
    await admin.call('DELETE', `/admin/invitations/${hugo.body.id}`)
    const hugoToken = new URL(hugo.body.link).searchParams.get('invite')!
    expect((await new Client(app).call('GET', `/invite/${hugoToken}`)).status).toBe(404)

    // Con el registro abierto cualquiera puede crear su cuenta
    await admin.call('PUT', '/admin/registration', { mode: 'open' })
    expect((await new Client(app).call('POST', '/auth/register', other.payload)).status).toBe(200)
    await sql`DELETE FROM settings`
  })

  it('con el registro cerrado no acepta cuentas nuevas', async () => {
    const closed = await buildApp(
      { config: config({ registration: 'invite' }), sql, keys: new ServerKeys(SECRET), mailer, version: 'test' },
      false
    )
    const c = new Client(closed)
    expect((await c.call('GET', '/config')).body.registration).toBe('invite')
    const { payload } = await createAccount('carla@example.com', password, newRecoveryPhrase(), 'Personal')
    expect((await c.call('POST', '/auth/register', payload)).body.error).toBe('registration_closed')
    await closed.close()
  })

  it('aplica el límite de intentos por IP', async () => {
    const limited = await buildApp(
      { config: config({ authRateLimit: 3 }), sql, keys: new ServerKeys(SECRET), mailer, version: 'test' },
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
