import { readFile } from 'node:fs/promises'
import { buildApp } from './app.js'
import { loadConfig } from './config.js'
import { connect, migrate } from './db.js'
import { createMailer } from './mail.js'
import { ServerKeys } from './security.js'

const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')) as { version: string }
const config = loadConfig()
const sql = connect(config.databaseUrl)

const app = await buildApp({
  config,
  sql,
  keys: new ServerKeys(config.serverSecret),
  mailer: createMailer(config.smtp),
  version: pkg.version
})
await migrate(sql, (msg) => app.log.info(msg))

// Limpieza periódica de sesiones vencidas
const cleanup = setInterval(() => {
  sql`DELETE FROM sessions WHERE expires_at < now()`.catch((err) => app.log.error(err))
  sql`DELETE FROM invitations WHERE used_at IS NULL AND expires_at < now()`.catch((err) => app.log.error(err))
}, 60 * 60 * 1000)

async function shutdown() {
  clearInterval(cleanup)
  await app.close()
  await sql.end({ timeout: 5 })
  process.exit(0)
}
process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)

app.log.info(`PassMe ${pkg.version} · registro inicial: ${config.registration} · correo: ${config.smtp ? config.smtp.host : 'sin SMTP'}`)
await app.listen({ port: config.port, host: config.host })
