import { readdir, readFile } from 'node:fs/promises'
import postgres from 'postgres'

export type Sql = postgres.Sql

export function connect(url: string): Sql {
  return postgres(url, {
    max: 10,
    transform: { undefined: null },
    onnotice: () => {}
  })
}

const MIGRATIONS_DIR = new URL('../migrations/', import.meta.url)

// Aplica en orden los .sql de migrations/ que aún no se hayan corrido, cada uno en su transacción
export async function migrate(sql: Sql, log: (msg: string) => void): Promise<void> {
  await sql`CREATE TABLE IF NOT EXISTS schema_migrations (
    name text PRIMARY KEY,
    applied_at timestamptz NOT NULL DEFAULT now()
  )`
  // Evita que dos instancias migren a la vez
  await sql.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(4040)`
    const applied = new Set(
      (await tx<{ name: string }[]>`SELECT name FROM schema_migrations`).map((r) => r.name)
    )
    const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort()
    for (const file of files) {
      if (applied.has(file)) continue
      const body = await readFile(new URL(file, MIGRATIONS_DIR), 'utf8')
      await tx.unsafe(body)
      await tx`INSERT INTO schema_migrations (name) VALUES (${file})`
      log(`Migración aplicada: ${file}`)
    }
  })
}
