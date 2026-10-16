import 'server-only'
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import { env } from '@/lib/env'
import * as schema from './schema'

export type Db = NodePgDatabase<typeof schema>

// One pool per process. Kept on globalThis so dev-mode reloads reuse it
// rather than leaking a pool per edit.
const globals = globalThis as unknown as { connectDb?: { pool: Pool; db: Db } }

export function getDb(): Db {
  globals.connectDb ??= (() => {
    const pool = new Pool({ connectionString: env().databaseUrl, max: 10 })
    return { pool, db: drizzle(pool, { schema }) }
  })()
  return globals.connectDb.db
}
