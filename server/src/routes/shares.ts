import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { DAY, type Context } from '../context.js'
import { blob, email, HttpError, kdf, key32, parse, uuid } from '../http.js'
import { shareMail } from '../mail.js'
import { hashSecret, verifySecret } from '../security.js'
import { requireAuth } from '../sessions.js'

// Intentos de PIN de un enlace antes de bloquearlo (el dueño puede crear otro)
export const SHARE_PIN_ATTEMPTS = 5
const SHARE_DAYS = [1, 7, 30] as const
const WRITE_ROLES = ['owner', 'manager', 'editor']

// Para una cuenta: "e1." + base64url(llave pública efímera) + "." + llave K cifrada.
// Para un enlace: solo la llave K cifrada.
const recipientKey = z
  .string()
  .max(1000)
  .regex(/^(e1\.[A-Za-z0-9_-]{60,120}\.)?v1\.[A-Za-z0-9_-]{40,}$/)
const origin = z.string().regex(/^https?:\/\/[^\s/?#]+$/)

interface ShareRow {
  id: string
  item_id: string
  kind: 'user' | 'link'
  recipient_email: string
  owner_key: string
  attempts: number
  views: number
  seen_at: Date | null
  last_viewed_at: Date | null
  expires_at: Date | null
  created_at: Date
  updated_at: Date
}

const createSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('user'),
    id: uuid,
    itemId: uuid,
    email,
    data: blob(100_000),
    ownerKey: blob(300),
    recipientKey,
    lang: z.enum(['es', 'en']).default('es')
  }),
  z.object({
    kind: z.literal('link'),
    id: uuid,
    itemId: uuid,
    email,
    data: blob(100_000),
    ownerKey: blob(300),
    recipientKey,
    pinKdf: kdf,
    pinAuth: key32,
    days: z.union(SHARE_DAYS.map((d) => z.literal(d)))
  })
])

export async function shareRoutes(app: FastifyInstance, ctx: Context): Promise<void> {
  const { sql, mailer, config } = ctx
  app.addHook('preHandler', requireAuth(sql))

  // La llave pública de otra cuenta, para cifrarle la copia. Sin cuenta: se comparte con enlace.
  app.get('/users/lookup', async (req) => {
    const query = parse(z.object({ email }), req.query)
    const [user] = await sql<{ id: string; email: string; public_key: string }[]>`
      SELECT id, email, public_key FROM users WHERE email = ${query.email}`
    if (user?.id === req.session!.userId) throw new HttpError(400, 'share_self')
    return { user: user ? { email: user.email, publicKey: user.public_key } : null }
  })

  app.get('/shares', async (req) => {
    const userId = req.session!.userId
    const outgoing = await sql<ShareRow[]>`
      SELECT id, item_id, kind, recipient_email, owner_key, attempts, views, seen_at, last_viewed_at,
             expires_at, created_at, updated_at
      FROM shares WHERE owner_id = ${userId}
      ORDER BY created_at`
    const incoming = await sql<
      { id: string; owner_email: string; data: string; recipient_key: string; seen_at: Date | null; created_at: Date; updated_at: Date }[]
    >`
      SELECT s.id, u.email AS owner_email, s.data, s.recipient_key, s.seen_at, s.created_at, s.updated_at
      FROM shares s JOIN users u ON u.id = s.owner_id
      WHERE s.recipient_id = ${userId} AND s.kind = 'user'
      ORDER BY s.created_at DESC`
    return {
      outgoing: outgoing.map((s) => ({
        id: s.id,
        itemId: s.item_id,
        kind: s.kind,
        email: s.recipient_email,
        ownerKey: s.owner_key,
        locked: s.kind === 'link' && s.attempts >= SHARE_PIN_ATTEMPTS,
        views: s.views,
        seenAt: s.seen_at,
        lastViewedAt: s.last_viewed_at,
        expiresAt: s.expires_at,
        createdAt: s.created_at,
        updatedAt: s.updated_at
      })),
      incoming: incoming.map((s) => ({
        id: s.id,
        from: s.owner_email,
        data: s.data,
        recipientKey: s.recipient_key,
        seenAt: s.seen_at,
        createdAt: s.created_at,
        updatedAt: s.updated_at
      }))
    }
  })

  app.post('/shares', async (req) => {
    const body = parse(createSchema, req.body)
    const userId = req.session!.userId
    // Solo se comparte lo que uno puede editar
    const [item] = await sql`
      SELECT 1 FROM items i JOIN vault_members m ON m.vault_id = i.vault_id AND m.user_id = ${userId}
      WHERE i.id = ${body.itemId} AND m.role IN ${sql(WRITE_ROLES)}`
    if (!item) throw new HttpError(404, 'not_found')

    if (body.kind === 'link') {
      const pinHash = await hashSecret(Buffer.from(body.pinAuth, 'base64'))
      await sql`
        INSERT INTO shares (id, owner_id, item_id, kind, recipient_email, data, owner_key, recipient_key,
                            pin_kdf, pin_hash, expires_at)
        VALUES (${body.id}, ${userId}, ${body.itemId}, 'link', ${body.email}, ${body.data}, ${body.ownerKey},
                ${body.recipientKey}, ${sql.json(body.pinKdf)}, ${pinHash}, ${new Date(Date.now() + body.days * DAY)})`
      return { id: body.id }
    }

    const [recipient] = await sql<{ id: string }[]>`SELECT id FROM users WHERE email = ${body.email}`
    if (!recipient) throw new HttpError(404, 'share_no_user')
    if (recipient.id === userId) throw new HttpError(400, 'share_self')
    // Volver a compartir con la misma cuenta reemplaza la copia anterior (y vuelve a avisarle)
    await sql.begin(async (tx) => {
      await tx`DELETE FROM shares WHERE item_id = ${body.itemId} AND recipient_id = ${recipient.id} AND kind = 'user'`
      await tx`
        INSERT INTO shares (id, owner_id, item_id, kind, recipient_id, recipient_email, data, owner_key, recipient_key)
        VALUES (${body.id}, ${userId}, ${body.itemId}, 'user', ${recipient.id}, ${body.email}, ${body.data},
                ${body.ownerKey}, ${body.recipientKey})`
    })

    // Aviso por correo, sin nada secreto: solo quién compartió y dónde entrar
    let emailed = false
    if (mailer) {
      const base = config.publicUrl ?? (origin.safeParse(req.headers.origin).data || null)
      const [owner] = await sql<{ email: string }[]>`SELECT email FROM users WHERE id = ${userId}`
      if (base && owner) {
        try {
          await mailer.send(shareMail(body.email, `${base}/`, owner.email, body.lang))
          emailed = true
        } catch (err) {
          req.log.error(err, 'no se pudo avisar del elemento compartido')
        }
      }
    }
    return { id: body.id, emailed }
  })

  // El dueño vuelve a cifrar la copia cuando edita el elemento
  app.put('/shares/:id', async (req) => {
    const { id } = parse(z.object({ id: uuid }), req.params)
    const body = parse(z.object({ data: blob(100_000) }), req.body)
    const rows = await sql`
      UPDATE shares SET data = ${body.data}, updated_at = now()
      WHERE id = ${id} AND owner_id = ${req.session!.userId}
      RETURNING id`
    if (!rows.length) throw new HttpError(404, 'not_found')
    return { ok: true }
  })

  // El dueño deja de compartir, o quien lo recibió lo quita de su lista
  app.delete('/shares/:id', async (req) => {
    const { id } = parse(z.object({ id: uuid }), req.params)
    const userId = req.session!.userId
    const rows = await sql`
      DELETE FROM shares WHERE id = ${id} AND (owner_id = ${userId} OR recipient_id = ${userId}) RETURNING id`
    if (!rows.length) throw new HttpError(404, 'not_found')
    return { ok: true }
  })

  app.post('/shares/seen', async (req) => {
    const { ids } = parse(z.object({ ids: z.array(uuid).max(500) }), req.body)
    await sql`
      UPDATE shares SET seen_at = now()
      WHERE recipient_id = ${req.session!.userId} AND id IN ${sql(ids.length ? ids : ['00000000-0000-0000-0000-000000000000'])}
        AND seen_at IS NULL`
    return { ok: true }
  })
}

// Enlaces para personas sin cuenta: no piden sesión. Sin el secreto del enlace (que va después del
// "#" y nunca llega al servidor) y el PIN no se puede descifrar nada.
export async function publicShareRoutes(app: FastifyInstance, ctx: Context): Promise<void> {
  const { sql } = ctx
  const strict = { rateLimit: { max: ctx.config.authRateLimit, timeWindow: '1 minute' } }

  async function activeLink(id: string) {
    const [row] = await sql<{ pin_kdf: unknown; attempts: number; expires_at: Date }[]>`
      SELECT pin_kdf, attempts, expires_at FROM shares
      WHERE id = ${id} AND kind = 'link' AND expires_at > now()`
    if (!row) throw new HttpError(404, 'share_gone')
    return row
  }

  app.get('/public/shares/:id', async (req) => {
    const { id } = parse(z.object({ id: uuid }), req.params)
    const row = await activeLink(id)
    return { pinKdf: row.pin_kdf, expiresAt: row.expires_at, locked: row.attempts >= SHARE_PIN_ATTEMPTS }
  })

  // Igual que el desbloqueo rápido: el intento se cuenta antes de comprobarlo, así que ni en
  // paralelo se pueden probar más de SHARE_PIN_ATTEMPTS PIN
  app.post('/public/shares/:id/open', { config: strict }, async (req) => {
    const { id } = parse(z.object({ id: uuid }), req.params)
    const body = parse(z.object({ pinAuth: key32 }), req.body)
    const [row] = await sql<{ pin_hash: string; attempts: number }[]>`
      UPDATE shares SET attempts = attempts + 1
      WHERE id = ${id} AND kind = 'link' AND expires_at > now() AND attempts < ${SHARE_PIN_ATTEMPTS}
      RETURNING pin_hash, attempts`
    if (!row) {
      await activeLink(id)
      throw new HttpError(423, 'share_locked')
    }
    if (!(await verifySecret(Buffer.from(body.pinAuth, 'base64'), row.pin_hash))) {
      const left = SHARE_PIN_ATTEMPTS - row.attempts
      if (left <= 0) throw new HttpError(423, 'share_locked')
      throw new HttpError(400, 'wrong_pin', { attemptsLeft: left })
    }
    const [share] = await sql<{ data: string; recipient_key: string; owner_email: string; expires_at: Date; updated_at: Date }[]>`
      UPDATE shares s SET attempts = 0, views = views + 1, last_viewed_at = now()
      FROM users u WHERE s.id = ${id} AND u.id = s.owner_id
      RETURNING s.data, s.recipient_key, u.email AS owner_email, s.expires_at, s.updated_at`
    return {
      data: share!.data,
      recipientKey: share!.recipient_key,
      from: share!.owner_email,
      expiresAt: share!.expires_at,
      updatedAt: share!.updated_at
    }
  })
}
