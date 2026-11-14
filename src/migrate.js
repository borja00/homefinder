// Apply db/migrations/*.sql in order, each once. Safe to run on every start:
// an advisory lock keeps concurrent runners (the web pod and the scrape Job)
// from racing, and applied files are recorded in schema_migrations.

import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const MIGRATIONS_DIR = fileURLToPath(new URL('../db/migrations/', import.meta.url))
const LOCK_ID = 7_244_105 // arbitrary, unique to homefinder

export async function migrate(sql, log = console.log) {
  await sql.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(${LOCK_ID})`
    await tx`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        filename    text PRIMARY KEY,
        applied_at  timestamptz NOT NULL DEFAULT now()
      )`
    const applied = new Set((await tx`SELECT filename FROM schema_migrations`).map((r) => r.filename))
    const pending = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort()
      .filter((f) => !applied.has(f))
    for (const file of pending) {
      await tx.unsafe(readFileSync(MIGRATIONS_DIR + file, 'utf8'))
      await tx`INSERT INTO schema_migrations (filename) VALUES (${file})`
      log(`applied ${file}`)
    }
    if (!pending.length) log('no pending migrations')
  })
}
