import { randomBytes, randomUUID } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { Context } from '../context.js'
import { blob, HttpError, kdf, key32, parse, uuid } from '../http.js'
import { hashSecret, verifySecret } from '../security.js'
import { requireAuth } from '../sessions.js'
import { matchTotp, newBackupCodes, newTotpSecret, totpUri, verifySecondFactor } from '../totp.js'

// Intentos de PIN o patrón antes de desactivar el desbloqueo rápido en ese dispositivo
export const QUICK_UNLOCK_ATTEMPTS = 5
const MAX_QUICK_DEVICES = 20

const passwordSchema = z.object({
  currentAuthKey: key32,
  kdf,
  authKey: key32,
  protectedUserKey: blob(200),
  // Desbloqueo rápido de este dispositivo, que se conserva; el de los demás se revoca
  keepQuickUnlock: uuid.optional()
})

export async function accountRoutes(app: FastifyInstance, ctx: Context): Promise<void> {
  const { sql, keys } = ctx
  const strict = { rateLimit: { max: ctx.config.authRateLimit, timeWindow: '1 minute' } }
  app.addHook('preHandler', requireAuth(sql))

  // Las operaciones sensibles piden de nuevo la contraseña maestra, para que una sesión robada no
  // alcance para cambiar la contraseña o el 2FA
  async function confirmPassword(userId: string, authKey: string): Promise<void> {
    const [user] = await sql<{ auth_hash: string }[]>`SELECT auth_hash FROM users WHERE id = ${userId}`
    if (!user || !(await verifySecret(Buffer.from(authKey, 'base64'), user.auth_hash))) {
      throw new HttpError(403, 'invalid_password')
    }
  }

  app.get('/account', async (req) => {
    const [user] = await sql`
      SELECT id, email, is_admin, totp_enabled, kdf_salt, kdf_params,
        protected_user_key, public_key, protected_private_key
      FROM users WHERE id = ${req.session!.userId}`
    if (!user) throw new HttpError(401, 'unauthorized')
    const [codes] = await sql<{ count: number }[]>`
      SELECT count(*)::int AS count FROM totp_backup_codes WHERE user_id = ${user.id} AND used_at IS NULL`
    return {
      id: user.id,
      email: user.email,
      isAdmin: user.is_admin,
      totpEnabled: user.totp_enabled,
      backupCodesLeft: codes?.count ?? 0,
      kdf: { ...user.kdf_params, salt: user.kdf_salt },
      protectedUserKey: user.protected_user_key,
      publicKey: user.public_key,
      protectedPrivateKey: user.protected_private_key
    }
  })

  // --- Desbloqueo rápido (PIN o patrón) por dispositivo ---

  // Activarlo pide la contraseña maestra. El cliente manda un verificador derivado del PIN con una
  // sal que solo tiene el dispositivo, así que el servidor no puede adivinar el PIN a partir de él.
  // "replace" es el dispositivo anterior (al cambiar de PIN a patrón o de PIN), que se borra.
  app.post('/account/quick-unlock', { config: strict }, async (req) => {
    const body = parse(z.object({ authKey: key32, verifier: key32, replace: uuid.optional() }), req.body)
    const { userId } = req.session!
    await confirmPassword(userId, body.authKey)
    const share = randomBytes(32).toString('base64')
    const verifierHash = await hashSecret(Buffer.from(body.verifier, 'base64'))
    const id = randomUUID()
    await sql.begin(async (tx) => {
      await tx`SELECT id FROM users WHERE id = ${userId} FOR UPDATE`
      if (body.replace) await tx`DELETE FROM quick_unlock_devices WHERE id = ${body.replace} AND user_id = ${userId}`
      const [row] = await tx<{ count: number }[]>`
        SELECT count(*)::int AS count FROM quick_unlock_devices WHERE user_id = ${userId}`
      if ((row?.count ?? 0) >= MAX_QUICK_DEVICES) throw new HttpError(409, 'too_many_devices')
      await tx`
        INSERT INTO quick_unlock_devices (id, user_id, verifier_hash, share)
        VALUES (${id}, ${userId}, ${verifierHash}, ${keys.seal(share, `quick-unlock:${id}`)})`
    })
    return { id, share }
  })

  app.delete('/account/quick-unlock/:id', async (req) => {
    const { id } = parse(z.object({ id: uuid }), req.params)
    await sql`DELETE FROM quick_unlock_devices WHERE id = ${id} AND user_id = ${req.session!.userId}`
    return { ok: true }
  })

  // Entrega la mitad del servidor si el verificador es correcto. El intento se cuenta antes de
  // comprobarlo, así que ni en paralelo se pueden probar más de QUICK_UNLOCK_ATTEMPTS. Al agotarlos
  // se borra el dispositivo y solo queda la contraseña maestra.
  app.post('/account/quick-unlock/:id/open', { config: strict }, async (req) => {
    const { id } = parse(z.object({ id: uuid }), req.params)
    const body = parse(z.object({ verifier: key32 }), req.body)
    const [row] = await sql<{ hash: string; share: string; attempts: number }[]>`
      UPDATE quick_unlock_devices SET attempts = attempts + 1
      WHERE id = ${id} AND user_id = ${req.session!.userId} AND attempts < ${QUICK_UNLOCK_ATTEMPTS}
      RETURNING verifier_hash AS hash, share, attempts`
    if (!row) throw new HttpError(409, 'quick_unlock_off')

    if (await verifySecret(Buffer.from(body.verifier, 'base64'), row.hash)) {
      await sql`UPDATE quick_unlock_devices SET attempts = 0, last_used_at = now() WHERE id = ${id}`
      return { share: keys.open(row.share, `quick-unlock:${id}`) }
    }
    const left = QUICK_UNLOCK_ATTEMPTS - row.attempts
    if (left <= 0) {
      await sql`DELETE FROM quick_unlock_devices WHERE id = ${id}`
      throw new HttpError(409, 'quick_unlock_off')
    }
    throw new HttpError(400, 'wrong_pin', { attemptsLeft: left })
  })

  // Cambia la contraseña maestra. La llave de usuario no cambia, solo cómo va cifrada, así que las
  // bóvedas no se tocan. Se cierran las demás sesiones y se revoca su desbloqueo rápido.
  app.post('/account/password', { config: strict }, async (req) => {
    const body = parse(passwordSchema, req.body)
    const userId = req.session!.userId
    await confirmPassword(userId, body.currentAuthKey)
    const { salt, ...kdfParams } = body.kdf
    const authHash = await hashSecret(Buffer.from(body.authKey, 'base64'))
    await sql.begin(async (tx) => {
      await tx`
        UPDATE users SET kdf_salt = ${salt}, kdf_params = ${tx.json(kdfParams)}, auth_hash = ${authHash},
          protected_user_key = ${body.protectedUserKey}, updated_at = now()
        WHERE id = ${userId}`
      await tx`DELETE FROM sessions WHERE user_id = ${userId} AND id <> ${req.session!.id}`
      await tx`
        DELETE FROM quick_unlock_devices
        WHERE user_id = ${userId} AND id IS DISTINCT FROM ${body.keepQuickUnlock ?? null}`
    })
    return { ok: true }
  })

  // Genera un secreto TOTP pendiente; no queda activo hasta confirmarlo con un código
  app.post('/account/totp/setup', { config: strict }, async (req) => {
    const body = parse(z.object({ authKey: key32 }), req.body)
    const userId = req.session!.userId
    await confirmPassword(userId, body.authKey)
    const [user] = await sql<{ email: string; totp_enabled: boolean }[]>`
      SELECT email, totp_enabled FROM users WHERE id = ${userId}`
    if (!user || user.totp_enabled) throw new HttpError(409, 'totp_already_enabled')

    const secret = newTotpSecret()
    await sql`UPDATE users SET totp_secret = ${keys.seal(secret, `totp:${userId}`)} WHERE id = ${userId}`
    return { secret, uri: totpUri(secret, user.email) }
  })

  app.post('/account/totp/enable', { config: strict }, async (req) => {
    const body = parse(z.object({ code: z.string().regex(/^\d{6}$/) }), req.body)
    const userId = req.session!.userId
    const [user] = await sql<{ totp_secret: string | null; totp_enabled: boolean }[]>`
      SELECT totp_secret, totp_enabled FROM users WHERE id = ${userId}`
    if (!user?.totp_secret || user.totp_enabled) throw new HttpError(409, 'totp_not_pending')
    const counter = matchTotp(keys.open(user.totp_secret, `totp:${userId}`), body.code)
    if (counter === null) throw new HttpError(400, 'invalid_code')

    const backupCodes = newBackupCodes()
    await sql.begin(async (tx) => {
      await tx`UPDATE users SET totp_enabled = true, totp_last_counter = ${counter} WHERE id = ${userId}`
      await tx`DELETE FROM totp_backup_codes WHERE user_id = ${userId}`
      for (const code of backupCodes) {
        await tx`INSERT INTO totp_backup_codes (user_id, code_hash) VALUES (${userId}, ${keys.backupCodeHash(userId, code)})`
      }
    })
    return { backupCodes }
  })

  app.post('/account/totp/disable', { config: strict }, async (req) => {
    const body = parse(z.object({ authKey: key32, code: z.string().min(6).max(20) }), req.body)
    const userId = req.session!.userId
    await confirmPassword(userId, body.authKey)
    if (!(await verifySecondFactor(ctx, userId, body.code))) throw new HttpError(400, 'invalid_code')
    await sql.begin(async (tx) => {
      await tx`UPDATE users SET totp_enabled = false, totp_secret = NULL, totp_last_counter = 0 WHERE id = ${userId}`
      await tx`DELETE FROM totp_backup_codes WHERE user_id = ${userId}`
    })
    return { ok: true }
  })
}
