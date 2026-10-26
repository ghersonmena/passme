import cookie from '@fastify/cookie'
import rateLimit from '@fastify/rate-limit'
import Fastify, { type FastifyInstance } from 'fastify'
import type { Context } from './context.js'
import { HttpError } from './http.js'
import { accountRoutes } from './routes/account.js'
import { adminRoutes } from './routes/admin.js'
import { authRoutes } from './routes/auth.js'
import { vaultRoutes } from './routes/vault.js'

// Toda petición que cambia algo debe traer este encabezado. Un sitio ajeno no puede mandarlo sin
// pasar por CORS (que no habilitamos), así que junto con SameSite=Strict cierra la puerta al CSRF.
export const CSRF_HEADER = 'x-passme-request'

export async function buildApp(ctx: Context, logger: boolean | object = true): Promise<FastifyInstance> {
  const app = Fastify({
    logger,
    // Confía solo en los N saltos de proxy configurados (nginx = 1) para obtener la IP real
    trustProxy: (_addr: string, hop: number) => hop < ctx.config.trustProxy,
    bodyLimit: 512 * 1024
  })

  await app.register(cookie)
  await app.register(rateLimit, {
    max: 300,
    timeWindow: '1 minute',
    errorResponseBuilder: () => ({ statusCode: 429, error: 'too_many_requests' })
  })

  app.addHook('onRequest', async (req) => {
    if (req.method !== 'GET' && req.method !== 'HEAD' && req.headers[CSRF_HEADER] !== '1') {
      throw new HttpError(403, 'csrf')
    }
  })

  app.addHook('onSend', async (_req, reply) => {
    reply.header('cache-control', 'no-store')
    reply.header('x-content-type-options', 'nosniff')
  })

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof HttpError) return reply.status(err.status).send({ ...err.extra, error: err.code })
    const status = (err as { statusCode?: number }).statusCode
    if (status === 429) return reply.status(429).send({ error: 'too_many_requests' })
    if (status && status >= 400 && status < 500) return reply.status(status).send({ error: 'invalid_request' })
    req.log.error(err)
    return reply.status(500).send({ error: 'server_error' })
  })

  app.setNotFoundHandler((_req, reply) => reply.status(404).send({ error: 'not_found' }))

  await app.register(
    async (api) => {
      api.get('/health', async () => ({ ok: true }))
      await api.register(async (scope) => authRoutes(scope, ctx))
      await api.register(async (scope) => accountRoutes(scope, ctx))
      await api.register(async (scope) => vaultRoutes(scope, ctx))
      await api.register(async (scope) => adminRoutes(scope, ctx))
    },
    { prefix: '/api' }
  )

  return app
}
