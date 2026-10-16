import 'server-only'
import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import * as schema from './schema'

// Kept on globalThis so dev-mode reloads reuse the pool instead of leaking one
// per edit. The pool connects on first query, so importing this needs no database.
const globals = globalThis as unknown as { connectPool?: Pool }
globals.connectPool ??= new Pool({ connectionString: process.env.DATABASE_URL, max: 10 })

export const db = drizzle({ client: globals.connectPool, schema })
