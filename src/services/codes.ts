import { and, asc, eq, isNull } from 'drizzle-orm'
import type { Db } from '@/db'
import { accessCodes, projects, user } from '@/db/schema'
import { hashCode, newCode } from '@/lib/codes'
import type { Project } from './projects'

export type CodeInfo = Pick<
  typeof accessCodes.$inferSelect,
  'id' | 'issuedAt' | 'lastUsedAt' | 'revokedAt'
>

/**
 * Gives the member a new code for the project, replacing any earlier one.
 * Returns the code itself, which is never stored and so can be shown once.
 */
export async function issueCode(db: Db, userId: string, projectId: string): Promise<string> {
  const code = newCode()
  const codeHash = hashCode(code)
  await db
    .insert(accessCodes)
    .values({ userId, projectId, codeHash })
    .onConflictDoUpdate({
      target: [accessCodes.userId, accessCodes.projectId],
      set: { codeHash, issuedAt: new Date(), lastUsedAt: null, revokedAt: null },
    })
  return code
}

/** Each of the member's codes, by project id. */
export async function codesForUser(db: Db, userId: string): Promise<Map<string, CodeInfo>> {
  const rows = await db
    .select({
      projectId: accessCodes.projectId,
      id: accessCodes.id,
      issuedAt: accessCodes.issuedAt,
      lastUsedAt: accessCodes.lastUsedAt,
      revokedAt: accessCodes.revokedAt,
    })
    .from(accessCodes)
    .where(eq(accessCodes.userId, userId))
  return new Map(rows.map(({ projectId, ...info }) => [projectId, info]))
}

export interface CodeOwner {
  codeId: string
  user: { id: string; name: string; discordId: string; dmChannelId: string | null }
  project: Project
}

/** Who a live code belongs to, or null for an unknown or revoked code. */
export async function findByCode(db: Db, code: string): Promise<CodeOwner | null> {
  const [row] = await db
    .select({
      codeId: accessCodes.id,
      user: {
        id: user.id,
        name: user.name,
        discordId: user.discordId,
        dmChannelId: user.dmChannelId,
      },
      project: projects,
    })
    .from(accessCodes)
    .innerJoin(user, eq(user.id, accessCodes.userId))
    .innerJoin(projects, eq(projects.id, accessCodes.projectId))
    .where(and(eq(accessCodes.codeHash, hashCode(code)), isNull(accessCodes.revokedAt)))
  return row ?? null
}

export async function touchCode(db: Db, codeId: string): Promise<void> {
  await db.update(accessCodes).set({ lastUsedAt: new Date() }).where(eq(accessCodes.id, codeId))
}

/** Turns a code off; the member can get a new one. False when there was none to revoke. */
export async function revokeCode(db: Db, codeId: string): Promise<boolean> {
  const rows = await db
    .update(accessCodes)
    .set({ revokedAt: new Date() })
    .where(and(eq(accessCodes.id, codeId), isNull(accessCodes.revokedAt)))
    .returning({ id: accessCodes.id })
  return rows.length > 0
}

export interface MemberRow {
  id: string
  name: string
  discordUsername: string
  discordId: string
  createdAt: Date
  codes: (CodeInfo & { projectName: string })[]
}

/** Every member, with their codes, for the admin page. */
export async function listMembers(db: Db): Promise<MemberRow[]> {
  const rows = await db
    .select({
      member: {
        id: user.id,
        name: user.name,
        discordUsername: user.discordUsername,
        discordId: user.discordId,
        createdAt: user.createdAt,
      },
      code: {
        id: accessCodes.id,
        issuedAt: accessCodes.issuedAt,
        lastUsedAt: accessCodes.lastUsedAt,
        revokedAt: accessCodes.revokedAt,
      },
      projectName: projects.name,
    })
    .from(user)
    .leftJoin(accessCodes, eq(accessCodes.userId, user.id))
    .leftJoin(projects, eq(projects.id, accessCodes.projectId))
    .orderBy(asc(user.name), asc(projects.name))

  const members = new Map<string, MemberRow>()
  for (const { member, code, projectName } of rows) {
    let row = members.get(member.id)
    if (row === undefined) {
      row = { ...member, codes: [] }
      members.set(member.id, row)
    }
    if (code !== null && projectName !== null) row.codes.push({ ...code, projectName })
  }
  return [...members.values()]
}

export async function setDmChannel(db: Db, userId: string, channelId: string): Promise<void> {
  await db.update(user).set({ dmChannelId: channelId }).where(eq(user.id, userId))
}
