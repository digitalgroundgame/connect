import path from 'node:path'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { db } from '@/db'

// Bring the database schema up to date before the server takes requests.
await migrate(db, { migrationsFolder: path.join(process.cwd(), 'drizzle') })
console.info('database migrations applied')
