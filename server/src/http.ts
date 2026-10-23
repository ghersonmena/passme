import { z } from 'zod'

// Los errores viajan al cliente solo como un código; la app los traduce
export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    // Datos extra que la app puede mostrar, como los intentos que quedan
    readonly extra: Record<string, number> = {}
  ) {
    super(code)
  }
}

export function parse<T extends z.ZodType>(schema: T, data: unknown): z.infer<T> {
  const result = schema.safeParse(data)
  if (!result.success) throw new HttpError(400, 'invalid_request')
  return result.data
}

// Llave de 32 bytes en base64 estándar (authKey, llave de recuperación)
export const key32 = z.string().regex(/^[A-Za-z0-9+/]{43}=$/)
// Texto cifrado por el cliente: "v1." + base64url(iv || ciphertext || tag)
export const blob = (maxLength: number) => z.string().max(maxLength).regex(/^v1\.[A-Za-z0-9_-]{40,}$/)
export const base64 = (maxLength: number) => z.string().max(maxLength).regex(/^[A-Za-z0-9+/]+={0,2}$/)
export const email = z.string().trim().toLowerCase().pipe(z.email().max(254))
export const uuid = z.uuid()

export const kdf = z.object({
  alg: z.literal('argon2id'),
  salt: z.string().regex(/^[A-Za-z0-9+/]{22}==$/),
  // Mínimos que el servidor exige aunque un cliente modificado intente debilitarlos
  m: z.int().min(65536).max(1048576),
  t: z.int().min(3).max(20),
  p: z.int().min(1).max(8)
})
export type Kdf = z.infer<typeof kdf>

export const DEFAULT_KDF = { alg: 'argon2id', m: 65536, t: 3, p: 1 } as const
