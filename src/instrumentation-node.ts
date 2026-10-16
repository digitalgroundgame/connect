import path from 'node:path'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { getDb } from '@/db'
import { log } from '@/lib/log'

// Bring the database schema up to date before the server takes requests.
await migrate(getDb(), { migrationsFolder: path.join(process.cwd(), 'drizzle') })
log.info({}, 'database migrations applied')
