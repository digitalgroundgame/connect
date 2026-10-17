import { asc, eq } from 'drizzle-orm'
import { db } from '@/db'
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

export function listProjects(): Promise<Project[]> {
  return db.select().from(projects).orderBy(asc(projects.name))
}

export function listEnabledProjects(): Promise<Project[]> {
  return db.select().from(projects).where(eq(projects.enabled, true)).orderBy(asc(projects.name))
}

export async function findProject(id: string): Promise<Project | null> {
  const [row] = await db.select().from(projects).where(eq(projects.id, id))
  return row ?? null
}

export async function createProject(input: ProjectInput): Promise<Project> {
  const [row] = await db.insert(projects).values(input).returning()
  return row as Project
}

/** The slug stays fixed once created: tools and links depend on it. */
export async function updateProject(
  id: string,
  input: Omit<ProjectInput, 'slug'>,
): Promise<Project | null> {
  const [row] = await db.update(projects).set(input).where(eq(projects.id, id)).returning()
  return row ?? null
}

/** Any project, on or off, by its slug: for the admin's edit page. */
export async function findProjectBySlug(slug: string): Promise<Project | null> {
  const [row] = await db.select().from(projects).where(eq(projects.slug, slug))
  return row ?? null
}
