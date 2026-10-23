function required(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`Falta la variable de entorno ${name}`)
  return value
}

function parseSecret(raw: string): Buffer {
  const secret = Buffer.from(raw, 'base64')
  if (secret.length < 32) {
    throw new Error('SERVER_SECRET debe tener al menos 32 bytes en base64 (openssl rand -base64 32)')
  }
  return secret
}

export type RegistrationMode = 'open' | 'closed'

export interface Config {
  port: number
  host: string
  databaseUrl: string
  serverSecret: Buffer
  // closed: solo se puede crear la primera cuenta (la del administrador)
  registration: RegistrationMode
  // Cuántos proxies hay delante de la API (nginx = 1). Determina de dónde sale la IP real
  trustProxy: number
  sessionTtlDays: number
  // Intentos por minuto y por IP en las rutas que reciben secretos (login, 2FA, recuperación)
  authRateLimit: number
}

export function loadConfig(): Config {
  return {
    port: Number(process.env.PORT ?? 3000),
    host: process.env.HOST ?? '0.0.0.0',
    databaseUrl: required('DATABASE_URL'),
    serverSecret: parseSecret(required('SERVER_SECRET')),
    registration: process.env.REGISTRATION === 'open' ? 'open' : 'closed',
    trustProxy: Number(process.env.TRUST_PROXY ?? 1),
    sessionTtlDays: Number(process.env.SESSION_TTL_DAYS ?? 14),
    authRateLimit: Number(process.env.AUTH_RATE_LIMIT ?? 10)
  }
}
