import { randomUUID } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { DAY, MINUTE, type Context } from '../context.js'
import { base64, blob, DEFAULT_KDF, email, HttpError, kdf, key32, parse, uuid } from '../http.js'
import { findInvite, registrationMode } from '../invitations.js'
import { burnVerifyTime, hashSecret, hashToken, verifySecret } from '../security.js'
import {
  clearSessionCookie,
  createSession,
  findSession,
  SESSION_COOKIE,
  setSessionCookie
} from '../sessions.js'
import { verifySecondFactor } from '../totp.js'

const MAX_FAILED_LOGINS = 10
const LOCK_MINUTES = 15
const MAX_MFA_ATTEMPTS = 5


const registerSchema = z.object({
  email,
  kdf,
  authKey: key32,
  protectedUserKey: blob(200),
  recoveryAuthKey: key32,
  recoveryProtectedUserKey: blob(200),
  publicKey: base64(400),
  protectedPrivateKey: blob(500),
  vault: z.object({ id: uuid, data: blob(4000), protectedVaultKey: blob(200) }),
  // Token del enlace de invitación; obligatorio si el registro es solo por invitación
  invite: z.string().max(100).optional()
})

const loginSchema = z.object({ email, authKey: key32 })
const mfaSchema = z.object({ code: z.string().min(6).max(20) })
const recoverSchema = z.object({ email, recoveryAuthKey: key32 })
const resetSchema = z.object({
  token: z.string().max(100),
  kdf,
  authKey: key32,
  protectedUserKey: blob(200)
})

interface LoginUser {
  id: string
  auth_hash: string
  recovery_auth_hash: string
  totp_enabled: boolean
  locked_until: Date | null
}

export async function authRoutes(app: FastifyInstance, ctx: Context): Promise<void> {
  const { sql, config } = ctx
  const strict = { rateLimit: { max: config.authRateLimit, timeWindow: '1 minute' } }
  const sessionTtl = config.sessionTtlDays * DAY

  async function userCount(): Promise<number> {
    const [row] = await sql<{ count: number }[]>`SELECT count(*)::int AS count FROM users`
    return row?.count ?? 0
  }

  app.get('/config', async () => {
    const registration = (await userCount()) === 0 ? 'first' : await registrationMode(sql, config)
    return { version: ctx.version, registration }
  })

  // Para el formulario de registro: a qué correo es la invitación del enlace
  app.get('/invite/:token', { config: strict }, async (req) => {
    const { token } = parse(z.object({ token: z.string().max(100) }), req.params)
    const invite = await findInvite(sql, token)
    if (!invite) throw new HttpError(404, 'invite_invalid')
    return { email: invite.email }
  })

  // Parámetros para derivar la llave maestra. Para correos que no existen se responde una sal
  // falsa pero estable, así no se puede averiguar quién tiene cuenta.
  app.post('/auth/prelogin', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (req) => {
    const body = parse(z.object({ email }), req.body)
    const [user] = await sql<{ kdf_salt: string; kdf_params: Omit<z.infer<typeof kdf>, 'salt'> }[]>`
      SELECT kdf_salt, kdf_params FROM users WHERE email = ${body.email}`
    if (!user) return { kdf: { ...DEFAULT_KDF, salt: ctx.keys.fakeSalt(body.email) } }
    return { kdf: { ...user.kdf_params, salt: user.kdf_salt } }
  })

  app.post('/auth/register', { config: strict }, async (req, reply) => {
    const body = parse(registerSchema, req.body)
    const { salt, ...kdfParams } = body.kdf
    const userId = randomUUID()
    const authHash = await hashSecret(Buffer.from(body.authKey, 'base64'))
    const recoveryHash = await hashSecret(Buffer.from(body.recoveryAuthKey, 'base64'))

    await sql.begin(async (tx) => {
      // Serializa los registros para que solo la primera cuenta quede como administrador
      await tx`SELECT pg_advisory_xact_lock(1)`
      const [row] = await tx<{ count: number }[]>`SELECT count(*)::int AS count FROM users`
      const first = (row?.count ?? 0) === 0
      if (!first && body.invite) {
        // La invitación es para un correo concreto y sirve una sola vez
        const invite = await findInvite(tx, body.invite, true)
        if (!invite) throw new HttpError(403, 'invite_invalid')
        if (invite.email !== body.email) throw new HttpError(403, 'invite_email')
        await tx`UPDATE invitations SET used_at = now() WHERE id = ${invite.id}`
      } else if (!first && (await registrationMode(sql, config)) !== 'open') {
        throw new HttpError(403, 'registration_closed')
      }

      const inserted = await tx`
        INSERT INTO users (
          id, email, kdf_salt, kdf_params, auth_hash, protected_user_key,
          recovery_auth_hash, recovery_protected_user_key, public_key, protected_private_key, is_admin
        ) VALUES (
          ${userId}, ${body.email}, ${salt}, ${tx.json(kdfParams)}, ${authHash}, ${body.protectedUserKey},
          ${recoveryHash}, ${body.recoveryProtectedUserKey}, ${body.publicKey}, ${body.protectedPrivateKey}, ${first}
        ) ON CONFLICT (email) DO NOTHING`
      if (inserted.count === 0) throw new HttpError(409, 'email_taken')

      await tx`INSERT INTO vaults (id, owner_id, data) VALUES (${body.vault.id}, ${userId}, ${body.vault.data})`
      await tx`
        INSERT INTO vault_members (vault_id, user_id, protected_vault_key, role)
        VALUES (${body.vault.id}, ${userId}, ${body.vault.protectedVaultKey}, 'owner')`
    })

    const token = await createSession(sql, req, userId, 'full', sessionTtl)
    setSessionCookie(reply, token, sessionTtl)
    return { ok: true }
  })

  // Verifica un secreto contra el usuario aplicando el bloqueo por intentos fallidos
  async function checkSecret(emailAddr: string, secret: Buffer, field: 'auth_hash' | 'recovery_auth_hash') {
    const [user] = await sql<LoginUser[]>`
      SELECT id, auth_hash, recovery_auth_hash, totp_enabled, locked_until FROM users WHERE email = ${emailAddr}`
    if (!user) {
      await burnVerifyTime(secret)
      throw new HttpError(401, 'invalid_credentials')
    }
    if (user.locked_until && user.locked_until > new Date()) throw new HttpError(429, 'account_locked')

    if (!(await verifySecret(secret, user[field]))) {
      await sql`
        UPDATE users SET
          failed_logins = CASE WHEN failed_logins + 1 >= ${MAX_FAILED_LOGINS} THEN 0 ELSE failed_logins + 1 END,
          locked_until = CASE WHEN failed_logins + 1 >= ${MAX_FAILED_LOGINS}
            THEN now() + make_interval(mins => ${LOCK_MINUTES}) ELSE locked_until END
        WHERE id = ${user.id}`
      throw new HttpError(401, 'invalid_credentials')
    }
    await sql`UPDATE users SET failed_logins = 0, locked_until = NULL WHERE id = ${user.id}`
    return user
  }

  app.post('/auth/login', { config: strict }, async (req, reply) => {
    const body = parse(loginSchema, req.body)
    const user = await checkSecret(body.email, Buffer.from(body.authKey, 'base64'), 'auth_hash')

    if (user.totp_enabled) {
      const ttl = 5 * MINUTE
      const token = await createSession(sql, req, user.id, 'mfa', ttl)
      setSessionCookie(reply, token, ttl)
      return { mfaRequired: true }
    }
    const token = await createSession(sql, req, user.id, 'full', sessionTtl)
    setSessionCookie(reply, token, sessionTtl)
    return { mfaRequired: false }
  })

  app.post('/auth/login/mfa', { config: strict }, async (req, reply) => {
    const body = parse(mfaSchema, req.body)
    const pending = await findSession(sql, req.cookies[SESSION_COOKIE], 'mfa')
    if (!pending) throw new HttpError(401, 'mfa_expired')
    if (pending.attempts >= MAX_MFA_ATTEMPTS) {
      await sql`DELETE FROM sessions WHERE id = ${pending.id}`
      throw new HttpError(401, 'mfa_expired')
    }
    await sql`UPDATE sessions SET attempts = attempts + 1 WHERE id = ${pending.id}`

    if (!(await verifySecondFactor(ctx, pending.userId, body.code))) throw new HttpError(401, 'invalid_code')

    await sql`DELETE FROM sessions WHERE id = ${pending.id}`
    const token = await createSession(sql, req, pending.userId, 'full', sessionTtl)
    setSessionCookie(reply, token, sessionTtl)
    return { ok: true }
  })

  app.post('/auth/logout', async (req, reply) => {
    const token = req.cookies[SESSION_COOKIE]
    if (token && token.length <= 100) await sql`DELETE FROM sessions WHERE token_hash = ${hashToken(token)}`
    clearSessionCookie(reply)
    return { ok: true }
  })

  // Paso 1 de la recuperación: la frase de 24 palabras demuestra que eres el dueño y devuelve la
  // llave de usuario cifrada con ella. El navegador la descifra y la vuelve a cifrar con la nueva
  // contraseña maestra.
  app.post('/auth/recover', { config: strict }, async (req) => {
    const body = parse(recoverSchema, req.body)
    const user = await checkSecret(body.email, Buffer.from(body.recoveryAuthKey, 'base64'), 'recovery_auth_hash')
    const [keys] = await sql<{ recovery_protected_user_key: string }[]>`
      SELECT recovery_protected_user_key FROM users WHERE id = ${user.id}`
    const token = await createSession(sql, req, user.id, 'recovery', 10 * MINUTE)
    return { token, recoveryProtectedUserKey: keys?.recovery_protected_user_key }
  })

  // Paso 2: guarda la nueva contraseña y cierra todas las sesiones. El 2FA sigue activo; quien
  // perdió también el teléfono entra con un código de respaldo.
  app.post('/auth/recover/reset', { config: strict }, async (req, reply) => {
    const body = parse(resetSchema, req.body)
    const session = await findSession(sql, body.token, 'recovery')
    if (!session) throw new HttpError(401, 'recovery_expired')
    const { salt, ...kdfParams } = body.kdf
    const authHash = await hashSecret(Buffer.from(body.authKey, 'base64'))

    await sql.begin(async (tx) => {
      await tx`
        UPDATE users SET kdf_salt = ${salt}, kdf_params = ${tx.json(kdfParams)}, auth_hash = ${authHash},
          protected_user_key = ${body.protectedUserKey}, failed_logins = 0, locked_until = NULL, updated_at = now()
        WHERE id = ${session.userId}`
      await tx`DELETE FROM sessions WHERE user_id = ${session.userId}`
      // Quien recupera la cuenta puede sospechar de un dispositivo: se revocan todos los PIN
      await tx`DELETE FROM quick_unlock_devices WHERE user_id = ${session.userId}`
    })
    clearSessionCookie(reply)
    return { ok: true }
  })
}
