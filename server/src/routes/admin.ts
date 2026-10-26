import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { DAY, type Context } from '../context.js'
import { email, HttpError, parse, uuid } from '../http.js'
import { INVITE_DAYS, registrationMode } from '../invitations.js'
import { inviteMail } from '../mail.js'
import { newToken } from '../security.js'
import { requireAuth } from '../sessions.js'

const origin = z.string().regex(/^https?:\/\/[^\s/?#]+$/)

// Administración del servidor: modo de registro, invitaciones y lista de usuarios. Solo ve datos
// de cuenta (correos y fechas); el contenido de las bóvedas sigue cifrado.
export async function adminRoutes(app: FastifyInstance, ctx: Context): Promise<void> {
  const { sql, config, mailer } = ctx
  app.addHook('preHandler', requireAuth(sql))
  app.addHook('preHandler', async (req) => {
    const [user] = await sql<{ is_admin: boolean }[]>`SELECT is_admin FROM users WHERE id = ${req.session!.userId}`
    if (!user?.is_admin) throw new HttpError(403, 'forbidden')
  })

  app.get('/admin', async () => {
    const users = await sql<{ id: string; email: string; is_admin: boolean; totp_enabled: boolean; created_at: Date }[]>`
      SELECT id, email, is_admin, totp_enabled, created_at FROM users ORDER BY created_at`
    const invitations = await sql<{ id: string; email: string; created_at: Date; expires_at: Date }[]>`
      SELECT id, email, created_at, expires_at FROM invitations
      WHERE used_at IS NULL AND expires_at > now() ORDER BY created_at DESC`
    return {
      registration: await registrationMode(sql, config),
      mail: !!mailer,
      users: users.map((u) => ({
        id: u.id,
        email: u.email,
        isAdmin: u.is_admin,
        totpEnabled: u.totp_enabled,
        createdAt: u.created_at
      })),
      invitations: invitations.map((i) => ({ id: i.id, email: i.email, createdAt: i.created_at, expiresAt: i.expires_at }))
    }
  })

  app.put('/admin/registration', async (req) => {
    const { mode } = parse(z.object({ mode: z.enum(['open', 'invite']) }), req.body)
    await sql`
      INSERT INTO settings (key, value) VALUES ('registration', ${sql.json(mode)})
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`
    return { registration: mode }
  })

  // Crea (o reenvía) una invitación. Devuelve el enlace para que el administrador también pueda
  // compartirlo a mano, por si no hay correo configurado o no llega.
  app.post('/admin/invitations', async (req) => {
    const body = parse(z.object({ email, lang: z.enum(['es', 'en']).default('es') }), req.body)
    const base = config.publicUrl ?? parse(origin, req.headers.origin)
    const [exists] = await sql`SELECT 1 FROM users WHERE email = ${body.email}`
    if (exists) throw new HttpError(409, 'email_taken')

    const { token, hash } = newToken()
    const [invite] = await sql.begin(async (tx) => {
      await tx`DELETE FROM invitations WHERE email = ${body.email} AND used_at IS NULL`
      return tx<{ id: string }[]>`
        INSERT INTO invitations (email, token_hash, invited_by, expires_at)
        VALUES (${body.email}, ${hash}, ${req.session!.userId}, ${new Date(Date.now() + INVITE_DAYS * DAY)})
        RETURNING id`
    })
    const link = `${base}/?invite=${token}`

    let emailed = false
    if (mailer) {
      const [admin] = await sql<{ email: string }[]>`SELECT email FROM users WHERE id = ${req.session!.userId}`
      try {
        await mailer.send(inviteMail(body.email, link, admin!.email, body.lang, INVITE_DAYS))
        emailed = true
      } catch (err) {
        req.log.error(err, 'no se pudo mandar la invitación')
      }
    }
    return { id: invite!.id, link, emailed, mail: !!mailer }
  })

  app.delete('/admin/invitations/:id', async (req) => {
    const { id } = parse(z.object({ id: uuid }), req.params)
    await sql`DELETE FROM invitations WHERE id = ${id} AND used_at IS NULL`
    return { ok: true }
  })
}
