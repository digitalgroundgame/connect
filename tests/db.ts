import path from 'node:path'
import { sql } from 'drizzle-orm'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { db } from '@/db'
import * as schema from '@/db/schema'
import type { Project, ProjectInput } from '@/services/projects'
import { createProject } from '@/services/projects'

/**
 * A real database for the service tests, from TEST_DATABASE_URL. Tests that
 * use it skip when the variable is unset. tests/setup.ts copies it into
 * DATABASE_URL, so the app's own `db` talks to the test database.
 */
export const testDatabaseUrl = process.env.TEST_DATABASE_URL

/**
 * Rebuilds the schema from the migrations. Both schemas are dropped first, so
 * a journal left by older migrations cannot stop the current ones running.
 */
export async function resetTestDb(): Promise<void> {
  await db.execute(sql`DROP SCHEMA IF EXISTS "drizzle" CASCADE`)
  await db.execute(sql`DROP SCHEMA IF EXISTS "public" CASCADE`)
  await db.execute(sql`CREATE SCHEMA "public"`)
  await migrate(db, { migrationsFolder: path.resolve(import.meta.dirname, '../drizzle') })
}

/** Closes the app's pool, and forgets it so a later import would build a new one. */
export async function closeTestDb(): Promise<void> {
  await db.$client.end()
  delete (globalThis as { connectPool?: unknown }).connectPool
}

export async function truncateAll(): Promise<void> {
  await db.execute(
    sql`TRUNCATE TABLE "access_codes", "projects", "session", "account", "verification", "user" CASCADE`,
  )
}

let users = 0

/** Inserts a member as Better Auth would after a Discord sign-in. */
export async function insertUser(
  overrides: Partial<typeof schema.user.$inferInsert> = {},
): Promise<typeof schema.user.$inferSelect> {
  users++
  const [row] = await db
    .insert(schema.user)
    .values({
      id: `user-${users}`,
      name: `Member ${users}`,
      email: `member${users}@example.test`,
      role: 'user',
      discordId: `10000000000000${users}`,
      discordUsername: `member${users}`,
      ...overrides,
    })
    .returning()
  return row!
}

let projects = 0

export async function insertProject(overrides: Partial<ProjectInput> = {}): Promise<Project> {
  projects++
  return createProject({
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
