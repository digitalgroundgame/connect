import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/db'
import { accessCodes, user } from '@/db/schema'
import { hashCode, looksLikeCode, newCode } from '@/lib/codes'
import {
  codesForUser,
  findByCode,
  issueCode,
  listMembers,
  revokeCode,
  setDmChannel,
  setRole,
  touchCode,
} from '@/services/codes'
import {
  closeTestDb,
  insertProject,
  insertUser,
  resetTestDb,
  testDatabaseUrl,
  truncateAll,
} from '../db'

describe.skipIf(!testDatabaseUrl)('services/codes', () => {
  beforeAll(async () => {
    await resetTestDb()
  })

  afterAll(async () => {
    await closeTestDb()
  })

  beforeEach(async () => {
    await truncateAll()
  })

  async function codeRow(userId: string, projectId: string) {
    const rows = await db.select().from(accessCodes).where(eq(accessCodes.userId, userId))
    return rows.find((r) => r.projectId === projectId)
  }

  describe('issueCode', () => {
    it('returns a code and stores only its hash', async () => {
      const member = await insertUser()
      const project = await insertProject()
      const code = await issueCode(member.id, project.id)
      expect(looksLikeCode(code)).toBe(true)
      const row = await codeRow(member.id, project.id)
      expect(row?.codeHash).toBe(hashCode(code))
      expect(row?.lastUsedAt).toBeNull()
      expect(row?.revokedAt).toBeNull()
    })

    it('replaces the earlier code for the same project, keeping one row', async () => {
      const member = await insertUser()
      const project = await insertProject()
      const first = await issueCode(member.id, project.id)
      const before = await codeRow(member.id, project.id)
      const second = await issueCode(member.id, project.id)

      expect(second).not.toBe(first)
      const rows = await db.select().from(accessCodes)
      expect(rows).toHaveLength(1)
      expect(rows[0]!.id).toBe(before!.id)
      expect(rows[0]!.codeHash).toBe(hashCode(second))
      expect(rows[0]!.issuedAt.getTime()).toBeGreaterThanOrEqual(before!.issuedAt.getTime())
      expect(await findByCode(first)).toBeNull()
      expect(await findByCode(second)).not.toBeNull()
    })

    it('clears revoked and last-used on the replaced code', async () => {
      const member = await insertUser()
      const project = await insertProject()
      await issueCode(member.id, project.id)
      const { id } = (await codeRow(member.id, project.id))!
      await touchCode(id)
      await revokeCode(id)
      const used = await codeRow(member.id, project.id)
      expect(used?.lastUsedAt).not.toBeNull()
      expect(used?.revokedAt).not.toBeNull()

      const code = await issueCode(member.id, project.id)
      const row = await codeRow(member.id, project.id)
      expect(row?.lastUsedAt).toBeNull()
      expect(row?.revokedAt).toBeNull()
      expect(await findByCode(code)).not.toBeNull()
    })

    it('keeps separate codes for separate projects', async () => {
      const member = await insertUser()
      const a = await insertProject()
      const b = await insertProject()
      const codeA = await issueCode(member.id, a.id)
      const codeB = await issueCode(member.id, b.id)
      expect((await findByCode(codeA))?.project.id).toBe(a.id)
      expect((await findByCode(codeB))?.project.id).toBe(b.id)
    })
  })

  describe('findByCode', () => {
    it('returns the code, member and project', async () => {
      const member = await insertUser({ name: 'Destiny', dmChannelId: 'channel-1' })
      const project = await insertProject({ slug: 'hindsight', name: 'Hindsight' })
      const code = await issueCode(member.id, project.id)
      const row = await codeRow(member.id, project.id)

      expect(await findByCode(code)).toEqual({
        codeId: row!.id,
        user: {
          id: member.id,
          name: 'Destiny',
          discordId: member.discordId,
          dmChannelId: 'channel-1',
        },
        project,
      })
    })

    it('returns null for an unknown code', async () => {
      const member = await insertUser()
      const project = await insertProject()
      await issueCode(member.id, project.id)
      expect(await findByCode(newCode())).toBeNull()
    })

    it('returns null for a revoked code', async () => {
      const member = await insertUser()
      const project = await insertProject()
      const code = await issueCode(member.id, project.id)
      await revokeCode((await codeRow(member.id, project.id))!.id)
      expect(await findByCode(code)).toBeNull()
    })

    it('still finds a code for a disabled project, leaving the refusal to the caller', async () => {
      const member = await insertUser()
      const project = await insertProject({ enabled: false })
      const code = await issueCode(member.id, project.id)
      expect((await findByCode(code))?.project.enabled).toBe(false)
    })
  })

  describe('revokeCode', () => {
    it('is true when it revokes a live code', async () => {
      const member = await insertUser()
      const project = await insertProject()
      await issueCode(member.id, project.id)
      const { id } = (await codeRow(member.id, project.id))!
      expect(await revokeCode(id)).toBe(true)
      expect((await codeRow(member.id, project.id))?.revokedAt).toBeInstanceOf(Date)
    })

    it('is false for a code already revoked, and keeps the first revoke time', async () => {
      const member = await insertUser()
      const project = await insertProject()
      await issueCode(member.id, project.id)
      const { id } = (await codeRow(member.id, project.id))!
      await revokeCode(id)
      const first = (await codeRow(member.id, project.id))!.revokedAt
      expect(await revokeCode(id)).toBe(false)
      expect((await codeRow(member.id, project.id))!.revokedAt).toEqual(first)
    })

    it('is false for a code id that does not exist', async () => {
      expect(await revokeCode('00000000-0000-4000-8000-000000000000')).toBe(false)
    })
  })

  describe('codesForUser', () => {
    it('maps each project id to the member’s code info', async () => {
      const member = await insertUser()
      const a = await insertProject()
      const b = await insertProject()
      await issueCode(member.id, a.id)
      await issueCode(member.id, b.id)
      const rowA = (await codeRow(member.id, a.id))!

      const codes = await codesForUser(member.id)
      expect([...codes.keys()].sort()).toEqual([a.id, b.id].sort())
      expect(codes.get(a.id)).toEqual({
        id: rowA.id,
        issuedAt: rowA.issuedAt,
        lastUsedAt: null,
        revokedAt: null,
      })
    })

    it('includes revoked codes', async () => {
      const member = await insertUser()
      const project = await insertProject()
      await issueCode(member.id, project.id)
      await revokeCode((await codeRow(member.id, project.id))!.id)
      expect((await codesForUser(member.id)).get(project.id)?.revokedAt).toBeInstanceOf(Date)
    })

    it('leaves out other members’ codes', async () => {
      const member = await insertUser()
      const other = await insertUser()
      const project = await insertProject()
      await issueCode(other.id, project.id)
      expect((await codesForUser(member.id)).size).toBe(0)
    })
  })

  describe('listMembers', () => {
    it('lists every member, with an empty list for those with no codes', async () => {
      const withCodes = await insertUser({ name: 'Alice' })
      const without = await insertUser({ name: 'Bob' })
      const project = await insertProject({ name: 'Hindsight' })
      await issueCode(withCodes.id, project.id)

      const members = await listMembers()
      expect(members.map((m) => m.name)).toEqual(['Alice', 'Bob'])
      expect(members[0]!.codes).toHaveLength(1)
      expect(members[1]).toEqual({
        id: without.id,
        name: 'Bob',
        discordUsername: without.discordUsername,
        discordId: without.discordId,
        role: 'user',
        createdAt: without.createdAt,
        codes: [],
      })
    })

    it('groups each member’s codes under one row, ordered by project name', async () => {
      const member = await insertUser({ name: 'Alice' })
      const zeta = await insertProject({ name: 'Zeta' })
      const alpha = await insertProject({ name: 'Alpha' })
      await issueCode(member.id, zeta.id)
      await issueCode(member.id, alpha.id)
      await revokeCode((await codeRow(member.id, zeta.id))!.id)

      const members = await listMembers()
      expect(members).toHaveLength(1)
      const codes = members[0]!.codes
      expect(codes.map((c) => c.projectName)).toEqual(['Alpha', 'Zeta'])
      expect(codes[0]!.revokedAt).toBeNull()
      expect(codes[1]!.revokedAt).toBeInstanceOf(Date)
      expect(codes[0]!.id).toBe((await codeRow(member.id, alpha.id))!.id)
    })

    it('orders members by name', async () => {
      await insertUser({ name: 'Carol' })
      await insertUser({ name: 'Alice' })
      await insertUser({ name: 'Bob' })
      expect((await listMembers()).map((m) => m.name)).toEqual(['Alice', 'Bob', 'Carol'])
    })

    it('is empty with no members', async () => {
      expect(await listMembers()).toEqual([])
    })
  })

  describe('touchCode', () => {
    it('sets last-used to now', async () => {
      const member = await insertUser()
      const project = await insertProject()
      await issueCode(member.id, project.id)
      const { id } = (await codeRow(member.id, project.id))!
      const before = Date.now()
      await touchCode(id)
      const lastUsedAt = (await codeRow(member.id, project.id))!.lastUsedAt
      expect(lastUsedAt).toBeInstanceOf(Date)
      expect(lastUsedAt!.getTime()).toBeGreaterThanOrEqual(before - 1000)
      expect(lastUsedAt!.getTime()).toBeLessThanOrEqual(Date.now() + 1000)
    })

    it('touches only that code', async () => {
      const member = await insertUser()
      const a = await insertProject()
      const b = await insertProject()
      await issueCode(member.id, a.id)
      await issueCode(member.id, b.id)
      await touchCode((await codeRow(member.id, a.id))!.id)
      expect((await codeRow(member.id, b.id))!.lastUsedAt).toBeNull()
    })
  })

  describe('setDmChannel', () => {
    it('saves the DM channel on the member', async () => {
      const member = await insertUser()
      const other = await insertUser()
      await setDmChannel(member.id, 'channel-42')
      const rows = await db.select().from(user)
      expect(rows.find((r) => r.id === member.id)?.dmChannelId).toBe('channel-42')
      expect(rows.find((r) => r.id === other.id)?.dmChannelId).toBeNull()
    })

    it('is what findByCode returns afterwards', async () => {
      const member = await insertUser()
      const project = await insertProject()
      const code = await issueCode(member.id, project.id)
      await setDmChannel(member.id, 'channel-42')
      expect((await findByCode(code))?.user.dmChannelId).toBe('channel-42')
    })
  })

  describe('listMembers roles', () => {
    it('shows each member’s Better Auth role', async () => {
      const admin = await insertUser({ role: 'admin' })
      const member = await insertUser({ role: 'user' })
      const members = await listMembers()
      expect(members.find((m) => m.id === admin.id)?.role).toBe('admin')
      expect(members.find((m) => m.id === member.id)?.role).toBe('user')
    })

    it('is null for a member with no role set', async () => {
      const member = await insertUser({ role: null })
      expect((await listMembers()).find((m) => m.id === member.id)?.role).toBeNull()
    })
  })

  describe('setRole', () => {
    async function roleOf(id: string) {
      const [row] = await db.select({ role: user.role }).from(user).where(eq(user.id, id))
      return row?.role
    }

    it('makes a member an admin and back while another admin remains', async () => {
      const first = await insertUser({ role: 'admin' })
      const member = await insertUser()
      expect(await setRole(member.id, 'admin')).toBe(true)
      expect(await roleOf(member.id)).toBe('admin')
      expect(await setRole(member.id, 'user')).toBe(true)
      expect(await roleOf(member.id)).toBe('user')
      expect(await roleOf(first.id)).toBe('admin')
    })

    it('refuses to remove the last admin', async () => {
      const only = await insertUser({ role: 'admin' })
      expect(await setRole(only.id, 'user')).toBe(false)
      expect(await roleOf(only.id)).toBe('admin')
    })

    it('lets only one of two admins removing each other at once succeed', async () => {
      const a = await insertUser({ role: 'admin' })
      const b = await insertUser({ role: 'admin' })
      const results = await Promise.all([setRole(a.id, 'user'), setRole(b.id, 'user')])
      expect(results.filter(Boolean)).toHaveLength(1)
      const roles = [await roleOf(a.id), await roleOf(b.id)]
      expect(roles.filter((r) => r === 'admin')).toHaveLength(1)
    })

    it('returns false for an unknown member', async () => {
      expect(await setRole('nobody', 'admin')).toBe(false)
    })
  })
})
