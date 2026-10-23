import { randomInt } from 'node:crypto'
import * as OTPAuth from 'otpauth'
import type { Context } from './context.js'

const PERIOD = 30
const BACKUP_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

export function newTotpSecret(): string {
  return new OTPAuth.Secret({ size: 20 }).base32
}

export function totpUri(secretBase32: string, email: string): string {
  return new OTPAuth.TOTP({
    issuer: 'PassMe',
    label: email,
    secret: OTPAuth.Secret.fromBase32(secretBase32),
    algorithm: 'SHA1',
    digits: 6,
    period: PERIOD
  }).toString()
}

// Devuelve el contador del código si es válido (±1 periodo de tolerancia de reloj)
export function matchTotp(secretBase32: string, code: string): number | null {
  const totp = new OTPAuth.TOTP({ secret: OTPAuth.Secret.fromBase32(secretBase32), digits: 6, period: PERIOD })
  const delta = totp.validate({ token: code, window: 1 })
  if (delta === null) return null
  return Math.floor(Date.now() / 1000 / PERIOD) + delta
}

// 10 códigos de un solo uso, ~50 bits cada uno, con formato XXXXX-XXXXX
export function newBackupCodes(): string[] {
  return Array.from({ length: 10 }, () => {
    let code = ''
    for (let i = 0; i < 10; i++) code += BACKUP_ALPHABET[randomInt(BACKUP_ALPHABET.length)]
    return `${code.slice(0, 5)}-${code.slice(5)}`
  })
}

function normalizeBackupCode(code: string): string {
  const clean = code.toUpperCase().replace(/[^A-Z0-9]/g, '')
  return `${clean.slice(0, 5)}-${clean.slice(5)}`
}

// Acepta un código TOTP (6 dígitos) o un código de respaldo. Un código TOTP ya usado no se acepta
// de nuevo, aunque siga dentro de su ventana de 30 s.
export async function verifySecondFactor(ctx: Context, userId: string, code: string): Promise<boolean> {
  const trimmed = code.trim()
  if (/^\d{6}$/.test(trimmed)) {
    const [user] = await ctx.sql<{ totp_secret: string | null; totp_last_counter: string }[]>`
      SELECT totp_secret, totp_last_counter FROM users WHERE id = ${userId}`
    if (!user?.totp_secret) return false
    const counter = matchTotp(ctx.keys.open(user.totp_secret, `totp:${userId}`), trimmed)
    if (counter === null) return false
    const updated = await ctx.sql`
      UPDATE users SET totp_last_counter = ${counter}
      WHERE id = ${userId} AND totp_last_counter < ${counter}`
    return updated.count === 1
  }
  const used = await ctx.sql`
    UPDATE totp_backup_codes SET used_at = now()
    WHERE user_id = ${userId} AND used_at IS NULL
      AND code_hash = ${ctx.keys.backupCodeHash(userId, normalizeBackupCode(trimmed))}`
  return used.count === 1
}
