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

// open: cualquiera crea su cuenta · invite: solo con una invitación del administrador
export type RegistrationMode = 'open' | 'invite'

export interface SmtpConfig {
  host: string
  port: number
  user: string
  pass: string
  from: string
}

export interface Config {
  port: number
  host: string
  databaseUrl: string
  serverSecret: Buffer
  // Modo inicial; el administrador lo puede cambiar desde la app. La primera cuenta siempre se
  // puede crear (es la del administrador).
  registration: RegistrationMode
  // Para mandar invitaciones por correo; sin él se comparte el enlace a mano
  smtp: SmtpConfig | null
  // Dirección pública de la app, para los enlaces de los correos. Si falta, se usa la del navegador
  // del administrador (útil con túneles cuya URL cambia).
  publicUrl: string | null
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
    // "closed" es el nombre que tenía "invite" antes de la v0.2.0
    registration: process.env.REGISTRATION === 'open' ? 'open' : 'invite',
    smtp: process.env.SMTP_HOST
      ? {
          host: process.env.SMTP_HOST,
          port: Number(process.env.SMTP_PORT ?? 587),
          user: process.env.SMTP_USER ?? '',
          pass: process.env.SMTP_PASS ?? '',
          from: process.env.SMTP_FROM || process.env.SMTP_USER || 'PassMe <passme@localhost>'
        }
      : null,
    publicUrl: process.env.PUBLIC_URL?.replace(/\/+$/, '') || null,
    trustProxy: Number(process.env.TRUST_PROXY ?? 1),
    sessionTtlDays: Number(process.env.SESSION_TTL_DAYS ?? 14),
    authRateLimit: Number(process.env.AUTH_RATE_LIMIT ?? 10)
  }
}
