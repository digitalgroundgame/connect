import { asc, eq } from 'drizzle-orm'
import type { Db } from '@/db'
import { projects } from '@/db/schema'

export type Project = typeof projects.$inferSelect

export interface ProjectInput {
  slug: string
  name: string
  description: string
  homepageUrl: string | null
  canDm: boolean
  enabled: boolean
}

export function listProjects(db: Db): Promise<Project[]> {
  return db.select().from(projects).orderBy(asc(projects.name))
}

export function listEnabledProjects(db: Db): Promise<Project[]> {
  return db.select().from(projects).where(eq(projects.enabled, true)).orderBy(asc(projects.name))
}

export async function findProject(db: Db, id: string): Promise<Project | null> {
  const [row] = await db.select().from(projects).where(eq(projects.id, id))
  return row ?? null
}

export async function createProject(db: Db, input: ProjectInput): Promise<Project> {
  const [row] = await db.insert(projects).values(input).returning()
  return row as Project
}

/** The slug stays fixed once created: tools and links depend on it. */
export async function updateProject(
  db: Db,
  id: string,
  input: Omit<ProjectInput, 'slug'>,
): Promise<Project | null> {
  const [row] = await db.update(projects).set(input).where(eq(projects.id, id)).returning()
  return row ?? null
}
