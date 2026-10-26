import type { FastifyInstance } from 'fastify'
import type { TransactionSql } from 'postgres'
import { z } from 'zod'
import type { Context } from '../context.js'
import { blob, HttpError, parse, uuid } from '../http.js'
import { requireAuth } from '../sessions.js'

// Un elemento cifrado: suficiente para notas largas; los adjuntos irán aparte
const itemData = blob(100_000)
// Nombre, ícono y color de la bóveda, cifrados
const vaultData = blob(4000)
const WRITE_ROLES = ['owner', 'manager', 'editor']
const MANAGE_ROLES = ['owner', 'manager']
const MAX_VAULTS = 50
const MAX_BATCH = 100

interface ItemRow {
  id: string
  vault_id: string
  data: string
  revision: number
  created_at: Date
  updated_at: Date
  trashed_at: Date | null
}

function toItem(row: ItemRow) {
  return {
    id: row.id,
    vaultId: row.vault_id,
    data: row.data,
    revision: row.revision,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    trashedAt: row.trashed_at
  }
}

export async function vaultRoutes(app: FastifyInstance, ctx: Context): Promise<void> {
  const { sql } = ctx
  app.addHook('preHandler', requireAuth(sql))

  // Solo devuelve un elemento si el usuario puede escribir en su bóveda
  async function writableItem(userId: string, itemId: string): Promise<ItemRow> {
    const [row] = await sql<ItemRow[]>`
      SELECT i.* FROM items i
      JOIN vault_members m ON m.vault_id = i.vault_id AND m.user_id = ${userId}
      WHERE i.id = ${itemId} AND m.role IN ${sql(WRITE_ROLES)}`
    if (!row) throw new HttpError(404, 'not_found')
    return row
  }

  function itemId(params: unknown): string {
    return parse(z.object({ id: uuid }), params).id
  }

  async function memberRole(userId: string, vaultId: string): Promise<string | null> {
    const [m] = await sql<{ role: string }[]>`
      SELECT role FROM vault_members WHERE vault_id = ${vaultId} AND user_id = ${userId}`
    return m?.role ?? null
  }

  async function ownedVaults(tx: TransactionSql, userId: string): Promise<number> {
    // Bloquea al usuario para que dos peticiones en paralelo no se salten los límites
    await tx`SELECT id FROM users WHERE id = ${userId} FOR UPDATE`
    const [row] = await tx<{ count: number }[]>`SELECT count(*)::int AS count FROM vaults WHERE owner_id = ${userId}`
    return row?.count ?? 0
  }

  async function listVaults(userId: string, vaultId?: string) {
    const rows = await sql`
      SELECT v.id, v.data, v.owner_id, m.protected_vault_key, m.role, v.updated_at
      FROM vault_members m JOIN vaults v ON v.id = m.vault_id
      WHERE m.user_id = ${userId} ${vaultId ? sql`AND v.id = ${vaultId}` : sql``}
      ORDER BY v.created_at`
    return rows.map((r) => ({
      id: r.id,
      data: r.data,
      ownerId: r.owner_id,
      protectedVaultKey: r.protected_vault_key,
      role: r.role,
      updatedAt: r.updated_at
    }))
  }

  app.get('/vaults', async (req) => listVaults(req.session!.userId))

  // Como con los elementos, el id lo genera el cliente porque va en los datos autenticados
  app.post('/vaults', async (req) => {
    const userId = req.session!.userId
    const body = parse(z.object({ id: uuid, data: vaultData, protectedVaultKey: blob(200) }), req.body)
    await sql.begin(async (tx) => {
      const count = await ownedVaults(tx, userId)
      if (count >= MAX_VAULTS) throw new HttpError(409, 'too_many_vaults')
      const [created] = await tx`
        INSERT INTO vaults (id, owner_id, data) VALUES (${body.id}, ${userId}, ${body.data})
        ON CONFLICT (id) DO NOTHING RETURNING id`
      if (!created) throw new HttpError(409, 'conflict')
      await tx`
        INSERT INTO vault_members (vault_id, user_id, protected_vault_key, role)
        VALUES (${body.id}, ${userId}, ${body.protectedVaultKey}, 'owner')`
    })
    return (await listVaults(userId, body.id))[0]
  })

  app.put('/vaults/:id', async (req) => {
    const userId = req.session!.userId
    const id = itemId(req.params)
    const body = parse(z.object({ data: vaultData }), req.body)
    const role = await memberRole(userId, id)
    if (!role) throw new HttpError(404, 'not_found')
    if (!MANAGE_ROLES.includes(role)) throw new HttpError(403, 'forbidden')
    await sql`UPDATE vaults SET data = ${body.data}, updated_at = now() WHERE id = ${id}`
    return (await listVaults(userId, id))[0]
  })

  // Borra la bóveda con todo su contenido. Solo el dueño, y nunca su última bóveda.
  app.delete('/vaults/:id', async (req) => {
    const userId = req.session!.userId
    const id = itemId(req.params)
    const role = await memberRole(userId, id)
    if (!role) throw new HttpError(404, 'not_found')
    if (role !== 'owner') throw new HttpError(403, 'forbidden')
    await sql.begin(async (tx) => {
      const count = await ownedVaults(tx, userId)
      if (count <= 1) throw new HttpError(409, 'last_vault')
      await tx`DELETE FROM vaults WHERE id = ${id}`
    })
    return { ok: true }
  })

  app.get('/items', async (req) => {
    const rows = await sql<ItemRow[]>`
      SELECT i.* FROM items i
      JOIN vault_members m ON m.vault_id = i.vault_id AND m.user_id = ${req.session!.userId}
      ORDER BY i.updated_at DESC`
    return rows.map(toItem)
  })

  // El id lo genera el cliente: forma parte de los datos autenticados del cifrado, así que un
  // elemento no se puede mover a otro id o bóveda sin que el descifrado falle
  app.post('/items', async (req) => {
    const body = parse(z.object({ id: uuid, vaultId: uuid, data: itemData }), req.body)
    const [member] = await sql<{ role: string }[]>`
      SELECT role FROM vault_members WHERE vault_id = ${body.vaultId} AND user_id = ${req.session!.userId}`
    if (!member || !WRITE_ROLES.includes(member.role)) throw new HttpError(404, 'not_found')
    const [row] = await sql<ItemRow[]>`
      INSERT INTO items (id, vault_id, data) VALUES (${body.id}, ${body.vaultId}, ${body.data})
      ON CONFLICT (id) DO NOTHING RETURNING *`
    if (!row) throw new HttpError(409, 'conflict')
    return toItem(row)
  })

  // Importación: varios elementos nuevos de una misma bóveda en una sola petición. Todo o nada,
  // para que un lote a medias no deje duplicados al reintentar.
  app.post(
    '/items/batch',
    { bodyLimit: (MAX_BATCH + 1) * 100_000 },
    async (req) => {
      const body = parse(
        z.object({ vaultId: uuid, items: z.array(z.object({ id: uuid, data: itemData })).min(1).max(MAX_BATCH) }),
        req.body
      )
      const role = await memberRole(req.session!.userId, body.vaultId)
      if (!role || !WRITE_ROLES.includes(role)) throw new HttpError(404, 'not_found')
      const rows = await sql.begin(async (tx) => {
        const inserted = await tx<ItemRow[]>`
          INSERT INTO items ${tx(body.items.map((i) => ({ id: i.id, vault_id: body.vaultId, data: i.data })))}
          ON CONFLICT (id) DO NOTHING RETURNING *`
        if (inserted.length !== body.items.length) throw new HttpError(409, 'conflict')
        return inserted
      })
      return rows.map(toItem)
    }
  )

  // Control de concurrencia optimista: si otro dispositivo guardó antes, se responde 409 y el
  // cliente recarga en vez de pisar el cambio
  app.put('/items/:id', async (req) => {
    const id = itemId(req.params)
    const body = parse(z.object({ data: itemData, revision: z.int().positive() }), req.body)
    await writableItem(req.session!.userId, id)
    const [row] = await sql<ItemRow[]>`
      UPDATE items SET data = ${body.data}, revision = revision + 1, updated_at = now()
      WHERE id = ${id} AND revision = ${body.revision} RETURNING *`
    if (!row) throw new HttpError(409, 'conflict')
    return toItem(row)
  })

  // Mover a otra bóveda: el cliente vuelve a cifrar el elemento con la llave de la bóveda destino
  app.post('/items/:id/move', async (req) => {
    const userId = req.session!.userId
    const id = itemId(req.params)
    const body = parse(z.object({ vaultId: uuid, data: itemData, revision: z.int().positive() }), req.body)
    await writableItem(userId, id)
    const role = await memberRole(userId, body.vaultId)
    if (!role || !WRITE_ROLES.includes(role)) throw new HttpError(404, 'not_found')
    const [row] = await sql<ItemRow[]>`
      UPDATE items SET vault_id = ${body.vaultId}, data = ${body.data}, revision = revision + 1, updated_at = now()
      WHERE id = ${id} AND revision = ${body.revision} RETURNING *`
    if (!row) throw new HttpError(409, 'conflict')
    return toItem(row)
  })

  app.post('/items/:id/trash', async (req) => {
    const id = itemId(req.params)
    await writableItem(req.session!.userId, id)
    const [row] = await sql<ItemRow[]>`
      UPDATE items SET trashed_at = now(), updated_at = now() WHERE id = ${id} RETURNING *`
    return toItem(row!)
  })

  app.post('/items/:id/restore', async (req) => {
    const id = itemId(req.params)
    await writableItem(req.session!.userId, id)
    const [row] = await sql<ItemRow[]>`
      UPDATE items SET trashed_at = NULL, updated_at = now() WHERE id = ${id} RETURNING *`
    return toItem(row!)
  })

  // Borrado definitivo: solo desde la papelera
  app.delete('/items/:id', async (req) => {
    const id = itemId(req.params)
    const item = await writableItem(req.session!.userId, id)
    if (!item.trashed_at) throw new HttpError(409, 'not_in_trash')
    await sql`DELETE FROM items WHERE id = ${id}`
    return { ok: true }
  })
}
