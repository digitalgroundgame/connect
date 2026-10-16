import path from 'node:path'
import { sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { Pool } from 'pg'
import type { Db } from '@/db'
import * as schema from '@/db/schema'
import type { Project, ProjectInput } from '@/services/projects'
import { createProject } from '@/services/projects'

/**
 * A real database for the service tests, from TEST_DATABASE_URL. Tests that
 * use it skip when the variable is unset. Built here rather than with getDb,
 * which reads the app's whole environment.
 */
export const testDatabaseUrl = process.env.TEST_DATABASE_URL

export interface TestDb {
  db: Db
  close(): Promise<void>
}

export async function openTestDb(): Promise<TestDb> {
  const pool = new Pool({ connectionString: testDatabaseUrl, max: 2 })
  const db = drizzle(pool, { schema })
  await migrate(db, { migrationsFolder: path.resolve(import.meta.dirname, '../drizzle') })
  return { db, close: () => pool.end() }
}

export async function truncateAll(db: Db): Promise<void> {
  await db.execute(
    sql`TRUNCATE TABLE "access_codes", "projects", "session", "account", "verification", "user" CASCADE`,
  )
}

let users = 0

/** Inserts a member as Better Auth would after a Discord sign-in. */
export async function insertUser(
  db: Db,
  overrides: Partial<typeof schema.user.$inferInsert> = {},
): Promise<typeof schema.user.$inferSelect> {
  users++
  const [row] = await db
    .insert(schema.user)
    .values({
      id: `user-${users}`,
      name: `Member ${users}`,
      email: `member${users}@example.test`,
      discordId: `10000000000000${users}`,
      discordUsername: `member${users}`,
      ...overrides,
    })
    .returning()
  return row!
}

let projects = 0

export async function insertProject(
  db: Db,
  overrides: Partial<ProjectInput> = {},
): Promise<Project> {
  projects++
  return createProject(db, {
    slug: `tool-${projects}`,
    name: `Tool ${projects}`,
    description: '',
    homepageUrl: null,
    canDm: true,
    enabled: true,
    ...overrides,
  })
}

/** The Postgres error code (such as 23505 for a unique violation) behind a failed query. */
export function pgErrorCode(err: unknown): string | undefined {
  let current: unknown = err
  while (current instanceof Error) {
    const code = (current as { code?: unknown }).code
    if (typeof code === 'string') return code
    current = current.cause
  }
  return undefined
}
