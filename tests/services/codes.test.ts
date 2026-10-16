import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { Db } from '@/db'
import { accessCodes, user } from '@/db/schema'
import { hashCode, looksLikeCode, newCode } from '@/lib/codes'
import {
  codesForUser,
  findByCode,
  issueCode,
  listMembers,
  revokeCode,
  setAdmin,
  setDmChannel,
  touchCode,
} from '@/services/codes'
import {
  insertProject,
  insertUser,
  openTestDb,
  testDatabaseUrl,
  truncateAll,
  type TestDb,
} from '../db'

describe.skipIf(!testDatabaseUrl)('services/codes', () => {
  let testDb: TestDb
  let db: Db

  beforeAll(async () => {
    testDb = await openTestDb()
    db = testDb.db
  })

  afterAll(async () => {
    await testDb?.close()
  })

  beforeEach(async () => {
    await truncateAll(db)
  })

  async function codeRow(userId: string, projectId: string) {
    const rows = await db.select().from(accessCodes).where(eq(accessCodes.userId, userId))
    return rows.find((r) => r.projectId === projectId)
  }

  describe('issueCode', () => {
    it('returns a code and stores only its hash', async () => {
      const member = await insertUser(db)
      const project = await insertProject(db)
      const code = await issueCode(db, member.id, project.id)
      expect(looksLikeCode(code)).toBe(true)
      const row = await codeRow(member.id, project.id)
      expect(row?.codeHash).toBe(hashCode(code))
      expect(row?.lastUsedAt).toBeNull()
      expect(row?.revokedAt).toBeNull()
    })

    it('replaces the earlier code for the same project, keeping one row', async () => {
      const member = await insertUser(db)
      const project = await insertProject(db)
      const first = await issueCode(db, member.id, project.id)
      const before = await codeRow(member.id, project.id)
      const second = await issueCode(db, member.id, project.id)

      expect(second).not.toBe(first)
      const rows = await db.select().from(accessCodes)
      expect(rows).toHaveLength(1)
      expect(rows[0]!.id).toBe(before!.id)
      expect(rows[0]!.codeHash).toBe(hashCode(second))
      expect(rows[0]!.issuedAt.getTime()).toBeGreaterThanOrEqual(before!.issuedAt.getTime())
      expect(await findByCode(db, first)).toBeNull()
      expect(await findByCode(db, second)).not.toBeNull()
    })

    it('clears revoked and last-used on the replaced code', async () => {
      const member = await insertUser(db)
      const project = await insertProject(db)
      await issueCode(db, member.id, project.id)
      const { id } = (await codeRow(member.id, project.id))!
      await touchCode(db, id)
      await revokeCode(db, id)
      const used = await codeRow(member.id, project.id)
      expect(used?.lastUsedAt).not.toBeNull()
      expect(used?.revokedAt).not.toBeNull()

      const code = await issueCode(db, member.id, project.id)
      const row = await codeRow(member.id, project.id)
      expect(row?.lastUsedAt).toBeNull()
      expect(row?.revokedAt).toBeNull()
      expect(await findByCode(db, code)).not.toBeNull()
    })

    it('keeps separate codes for separate projects', async () => {
      const member = await insertUser(db)
      const a = await insertProject(db)
      const b = await insertProject(db)
      const codeA = await issueCode(db, member.id, a.id)
      const codeB = await issueCode(db, member.id, b.id)
      expect((await findByCode(db, codeA))?.project.id).toBe(a.id)
      expect((await findByCode(db, codeB))?.project.id).toBe(b.id)
    })
  })

  describe('findByCode', () => {
    it('returns the code, member and project', async () => {
      const member = await insertUser(db, { name: 'Destiny', dmChannelId: 'channel-1' })
      const project = await insertProject(db, { slug: 'hindsight', name: 'Hindsight' })
      const code = await issueCode(db, member.id, project.id)
      const row = await codeRow(member.id, project.id)

      expect(await findByCode(db, code)).toEqual({
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
      const member = await insertUser(db)
      const project = await insertProject(db)
      await issueCode(db, member.id, project.id)
      expect(await findByCode(db, newCode())).toBeNull()
    })

    it('returns null for a revoked code', async () => {
      const member = await insertUser(db)
      const project = await insertProject(db)
      const code = await issueCode(db, member.id, project.id)
      await revokeCode(db, (await codeRow(member.id, project.id))!.id)
      expect(await findByCode(db, code)).toBeNull()
    })

    it('still finds a code for a disabled project, leaving the refusal to the caller', async () => {
      const member = await insertUser(db)
      const project = await insertProject(db, { enabled: false })
      const code = await issueCode(db, member.id, project.id)
      expect((await findByCode(db, code))?.project.enabled).toBe(false)
    })
  })

  describe('revokeCode', () => {
    it('is true when it revokes a live code', async () => {
      const member = await insertUser(db)
      const project = await insertProject(db)
      await issueCode(db, member.id, project.id)
      const { id } = (await codeRow(member.id, project.id))!
      expect(await revokeCode(db, id)).toBe(true)
      expect((await codeRow(member.id, project.id))?.revokedAt).toBeInstanceOf(Date)
    })

    it('is false for a code already revoked, and keeps the first revoke time', async () => {
      const member = await insertUser(db)
      const project = await insertProject(db)
      await issueCode(db, member.id, project.id)
      const { id } = (await codeRow(member.id, project.id))!
      await revokeCode(db, id)
      const first = (await codeRow(member.id, project.id))!.revokedAt
      expect(await revokeCode(db, id)).toBe(false)
      expect((await codeRow(member.id, project.id))!.revokedAt).toEqual(first)
    })

    it('is false for a code id that does not exist', async () => {
      expect(await revokeCode(db, '00000000-0000-4000-8000-000000000000')).toBe(false)
    })
  })

  describe('codesForUser', () => {
    it('maps each project id to the member’s code info', async () => {
      const member = await insertUser(db)
      const a = await insertProject(db)
      const b = await insertProject(db)
      await issueCode(db, member.id, a.id)
      await issueCode(db, member.id, b.id)
      const rowA = (await codeRow(member.id, a.id))!

      const codes = await codesForUser(db, member.id)
      expect([...codes.keys()].sort()).toEqual([a.id, b.id].sort())
      expect(codes.get(a.id)).toEqual({
        id: rowA.id,
        issuedAt: rowA.issuedAt,
        lastUsedAt: null,
        revokedAt: null,
      })
    })

    it('includes revoked codes', async () => {
      const member = await insertUser(db)
      const project = await insertProject(db)
      await issueCode(db, member.id, project.id)
      await revokeCode(db, (await codeRow(member.id, project.id))!.id)
      expect((await codesForUser(db, member.id)).get(project.id)?.revokedAt).toBeInstanceOf(Date)
    })

    it('leaves out other members’ codes', async () => {
      const member = await insertUser(db)
      const other = await insertUser(db)
      const project = await insertProject(db)
      await issueCode(db, other.id, project.id)
      expect((await codesForUser(db, member.id)).size).toBe(0)
    })
  })

  describe('listMembers', () => {
    it('lists every member, with an empty list for those with no codes', async () => {
      const withCodes = await insertUser(db, { name: 'Alice' })
      const without = await insertUser(db, { name: 'Bob' })
      const project = await insertProject(db, { name: 'Hindsight' })
      await issueCode(db, withCodes.id, project.id)

      const members = await listMembers(db)
      expect(members.map((m) => m.name)).toEqual(['Alice', 'Bob'])
      expect(members[0]!.codes).toHaveLength(1)
      expect(members[1]).toEqual({
        id: without.id,
        name: 'Bob',
        discordUsername: without.discordUsername,
        discordId: without.discordId,
        isAdmin: false,
        createdAt: without.createdAt,
        codes: [],
      })
    })

    it('groups each member’s codes under one row, ordered by project name', async () => {
      const member = await insertUser(db, { name: 'Alice' })
      const zeta = await insertProject(db, { name: 'Zeta' })
      const alpha = await insertProject(db, { name: 'Alpha' })
      await issueCode(db, member.id, zeta.id)
      await issueCode(db, member.id, alpha.id)
      await revokeCode(db, (await codeRow(member.id, zeta.id))!.id)

      const members = await listMembers(db)
      expect(members).toHaveLength(1)
      const codes = members[0]!.codes
      expect(codes.map((c) => c.projectName)).toEqual(['Alpha', 'Zeta'])
      expect(codes[0]!.revokedAt).toBeNull()
      expect(codes[1]!.revokedAt).toBeInstanceOf(Date)
      expect(codes[0]!.id).toBe((await codeRow(member.id, alpha.id))!.id)
    })

    it('orders members by name', async () => {
      await insertUser(db, { name: 'Carol' })
      await insertUser(db, { name: 'Alice' })
      await insertUser(db, { name: 'Bob' })
      expect((await listMembers(db)).map((m) => m.name)).toEqual(['Alice', 'Bob', 'Carol'])
    })

    it('is empty with no members', async () => {
      expect(await listMembers(db)).toEqual([])
    })
  })

  describe('touchCode', () => {
    it('sets last-used to now', async () => {
      const member = await insertUser(db)
      const project = await insertProject(db)
      await issueCode(db, member.id, project.id)
      const { id } = (await codeRow(member.id, project.id))!
      const before = Date.now()
      await touchCode(db, id)
      const lastUsedAt = (await codeRow(member.id, project.id))!.lastUsedAt
      expect(lastUsedAt).toBeInstanceOf(Date)
      expect(lastUsedAt!.getTime()).toBeGreaterThanOrEqual(before - 1000)
      expect(lastUsedAt!.getTime()).toBeLessThanOrEqual(Date.now() + 1000)
    })

    it('touches only that code', async () => {
      const member = await insertUser(db)
      const a = await insertProject(db)
      const b = await insertProject(db)
      await issueCode(db, member.id, a.id)
      await issueCode(db, member.id, b.id)
      await touchCode(db, (await codeRow(member.id, a.id))!.id)
      expect((await codeRow(member.id, b.id))!.lastUsedAt).toBeNull()
    })
  })

  describe('setDmChannel', () => {
    it('saves the DM channel on the member', async () => {
      const member = await insertUser(db)
      const other = await insertUser(db)
      await setDmChannel(db, member.id, 'channel-42')
      const rows = await db.select().from(user)
      expect(rows.find((r) => r.id === member.id)?.dmChannelId).toBe('channel-42')
      expect(rows.find((r) => r.id === other.id)?.dmChannelId).toBeNull()
    })

    it('is what findByCode returns afterwards', async () => {
      const member = await insertUser(db)
      const project = await insertProject(db)
      const code = await issueCode(db, member.id, project.id)
      await setDmChannel(db, member.id, 'channel-42')
      expect((await findByCode(db, code))?.user.dmChannelId).toBe('channel-42')
    })
  })

  describe('setAdmin', () => {
    it('members start as non-admins', async () => {
      const member = await insertUser(db)
      expect(member.isAdmin).toBe(false)
    })

    it('makes a member an admin and back, and listMembers shows it', async () => {
      const member = await insertUser(db)
      const other = await insertUser(db)
      expect(await setAdmin(db, member.id, true)).toBe(true)
      let members = await listMembers(db)
      expect(members.find((m) => m.id === member.id)?.isAdmin).toBe(true)
      expect(members.find((m) => m.id === other.id)?.isAdmin).toBe(false)

      expect(await setAdmin(db, member.id, false)).toBe(true)
      members = await listMembers(db)
      expect(members.find((m) => m.id === member.id)?.isAdmin).toBe(false)
    })

    it('returns false for an unknown member', async () => {
      expect(await setAdmin(db, 'nobody', true)).toBe(false)
    })
  })
})
