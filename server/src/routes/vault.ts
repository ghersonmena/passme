import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { Context } from '../context.js'
import { blob, HttpError, parse, uuid } from '../http.js'
import { requireAuth } from '../sessions.js'

// Un elemento cifrado: suficiente para notas largas; los adjuntos irán aparte
const itemData = blob(100_000)
const WRITE_ROLES = ['owner', 'manager', 'editor']

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

  app.get('/vaults', async (req) => {
    const rows = await sql`
      SELECT v.id, v.data, v.owner_id, m.protected_vault_key, m.role, v.updated_at
      FROM vault_members m JOIN vaults v ON v.id = m.vault_id
      WHERE m.user_id = ${req.session!.userId}
      ORDER BY v.created_at`
    return rows.map((r) => ({
      id: r.id,
      data: r.data,
      ownerId: r.owner_id,
      protectedVaultKey: r.protected_vault_key,
      role: r.role,
      updatedAt: r.updated_at
    }))
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
