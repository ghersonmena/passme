import type { FastifyReply, FastifyRequest } from 'fastify'
import type { Sql } from './db.js'
import { HttpError } from './http.js'
import { hashToken, newToken } from './security.js'

// __Host- obliga a Secure, Path=/ y sin Domain: la cookie no se comparte con subdominios
export const SESSION_COOKIE = '__Host-passme_sid'

export type SessionKind = 'full' | 'mfa' | 'recovery'

export interface Session {
  id: string
  userId: string
  attempts: number
}

declare module 'fastify' {
  interface FastifyRequest {
    session?: Session
  }
}

export async function createSession(
  sql: Sql,
  req: FastifyRequest,
  userId: string,
  kind: SessionKind,
  ttlMs: number
): Promise<string> {
  const { token, hash } = newToken()
  const userAgent = String(req.headers['user-agent'] ?? '').slice(0, 300)
  await sql`
    INSERT INTO sessions (user_id, token_hash, kind, ip, user_agent, expires_at)
    VALUES (${userId}, ${hash}, ${kind}, ${req.ip}, ${userAgent}, ${new Date(Date.now() + ttlMs)})`
  return token
}

export function setSessionCookie(reply: FastifyReply, token: string, ttlMs: number): void {
  reply.setCookie(SESSION_COOKIE, token, {
    path: '/',
    httpOnly: true,
    secure: true,
    sameSite: 'strict',
    maxAge: Math.floor(ttlMs / 1000)
  })
}

export function clearSessionCookie(reply: FastifyReply): void {
  reply.clearCookie(SESSION_COOKIE, { path: '/', httpOnly: true, secure: true, sameSite: 'strict' })
}

export async function findSession(sql: Sql, token: string | undefined, kind: SessionKind): Promise<Session | null> {
  if (!token || token.length > 100) return null
  const [row] = await sql<{ id: string; user_id: string; attempts: number }[]>`
    SELECT id, user_id, attempts FROM sessions
    WHERE token_hash = ${hashToken(token)} AND kind = ${kind} AND expires_at > now()`
  return row ? { id: row.id, userId: row.user_id, attempts: row.attempts } : null
}

// preHandler de las rutas que necesitan una sesión completa (con el 2FA ya resuelto)
// La sesión vence a los SESSION_TTL_DAYS desde el login, se use o no: después hay que volver a
// iniciar sesión (con 2FA)
export function requireAuth(sql: Sql) {
  return async (req: FastifyRequest) => {
    const session = await findSession(sql, req.cookies[SESSION_COOKIE], 'full')
    if (!session) throw new HttpError(401, 'unauthorized')
    await sql`
      UPDATE sessions SET last_seen_at = now()
      WHERE id = ${session.id} AND last_seen_at < now() - interval '5 minutes'`
    req.session = session
  }
}
