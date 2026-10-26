import type { TransactionSql } from 'postgres'
import type { Config, RegistrationMode } from './config.js'
import type { Sql } from './db.js'
import { hashToken } from './security.js'

export const INVITE_DAYS = 7

// El modo que eligió el administrador, o el de la variable de entorno si nunca lo cambió
export async function registrationMode(sql: Sql, config: Config): Promise<RegistrationMode> {
  const [row] = await sql<{ value: unknown }[]>`SELECT value FROM settings WHERE key = 'registration'`
  return row?.value === 'open' || row?.value === 'invite' ? row.value : config.registration
}

export interface InviteRow {
  id: string
  email: string
}

// Invitación vigente y sin usar. Al registrarse se bloquea la fila para que sirva una sola vez.
export async function findInvite(db: Sql | TransactionSql, token: string, lock = false): Promise<InviteRow | null> {
  if (!token || token.length > 100) return null
  const [row] = await db<InviteRow[]>`
    SELECT id, email FROM invitations
    WHERE token_hash = ${hashToken(token)} AND used_at IS NULL AND expires_at > now()
    ${lock ? db`FOR UPDATE` : db``}`
  return row ?? null
}
