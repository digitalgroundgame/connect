import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { revokeMemberCode, saveProject, setMemberAdmin } from '@/app/admin/actions'
import { db } from '@/db'
import { accessCodes, user } from '@/db/schema'
import { currentMember, type Member } from '@/lib/session'
import { issueCode } from '@/services/codes'
import { findProject, listProjects } from '@/services/projects'
import {
  closeTestDb,
  insertProject,
  insertUser,
  resetTestDb,
  testDatabaseUrl,
  truncateAll,
} from '../db'

vi.mock('@/lib/session', () => ({ currentMember: vi.fn() }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
// The real notFound throws Next's own error; any throw stops the action the same way.
vi.mock('next/navigation', () => ({
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND')
  }),
}))

function form(values: Record<string, string>): FormData {
  const data = new FormData()
  for (const [key, value] of Object.entries(values)) data.set(key, value)
  return data
}

const idle = { status: 'idle' } as const

describe.skipIf(!testDatabaseUrl)('admin actions', () => {
  let admin: Member

  beforeAll(async () => {
    await resetTestDb()
  })

  afterAll(async () => {
    await closeTestDb()
  })

  beforeEach(async () => {
    await truncateAll()
    const row = await insertUser({ role: 'admin' })
    admin = { ...row, isAdmin: true }
    vi.mocked(currentMember).mockResolvedValue(admin)
    vi.spyOn(console, 'info').mockImplementation(() => {})
  })

  describe('only admins', () => {
    it.each([
      ['signed out', null],
      [
        'a member',
        { id: 'user-x', name: 'X', discordId: '1', discordUsername: 'x', isAdmin: false },
      ],
    ])('turns away someone %s', async (_who, member) => {
      vi.mocked(currentMember).mockResolvedValue(member)
      const project = await insertProject()
      await expect(
        saveProject(idle, form({ slug: 'new', name: 'New', description: '', homepageUrl: '' })),
      ).rejects.toThrow('NEXT_NOT_FOUND')
      await expect(revokeMemberCode(form({ codeId: project.id }))).rejects.toThrow('NEXT_NOT_FOUND')
      await expect(setMemberAdmin(form({ userId: admin.id, admin: 'false' }))).rejects.toThrow(
        'NEXT_NOT_FOUND',
      )
      expect(await listProjects()).toHaveLength(1)
    })
  })

  describe('saveProject', () => {
    it('creates a project, lowercasing the slug and reading the switches', async () => {
      const state = await saveProject(
        idle,
        form({
          slug: ' Hindsight ',
          name: ' Hindsight ',
          description: 'Answers on Discord',
          homepageUrl: 'https://example.com',
          canDm: 'on',
        }),
      )
      expect(state).toEqual({ status: 'saved' })
      expect(await listProjects()).toMatchObject([
        {
          slug: 'hindsight',
          name: 'Hindsight',
          description: 'Answers on Discord',
          homepageUrl: 'https://example.com',
          canDm: true,
          enabled: false,
        },
      ])
    })

    it('stores an empty homepage as none', async () => {
      await saveProject(idle, form({ slug: 'tool', name: 'Tool', homepageUrl: '' }))
      expect((await listProjects())[0]!.homepageUrl).toBeNull()
    })

    it.each([
      ['a slug with spaces', { slug: 'two words', name: 'Tool' }, /slug/],
      ['a slug over 32 characters', { slug: 'a'.repeat(33), name: 'Tool' }, /slug/],
      ['a slug ending in a dash', { slug: 'tool-', name: 'Tool' }, /slug/],
      ['no name', { slug: 'tool', name: '  ' }, /.+/],
      ['a long name', { slug: 'tool', name: 'n'.repeat(81) }, /80 characters/],
      ['a long description', { slug: 'tool', name: 'Tool', description: 'd'.repeat(501) }, /500/],
      ['an http homepage', { slug: 'tool', name: 'Tool', homepageUrl: 'http://x.test' }, /https/],
      ['a homepage that is not a link', { slug: 'tool', name: 'Tool', homepageUrl: 'x' }, /https/],
    ])('refuses %s and gives the values back', async (_case, values, message) => {
      const state = await saveProject(idle, form(values))
      expect(state).toMatchObject({
        status: 'error',
        message: expect.stringMatching(message),
        values: expect.objectContaining(values),
      })
      expect(await listProjects()).toHaveLength(0)
    })

    it('refuses a slug another project uses', async () => {
      await insertProject({ slug: 'taken' })
      const state = await saveProject(idle, form({ slug: 'taken', name: 'Again' }))
      expect(state).toMatchObject({
        status: 'error',
        message: 'Another project already uses that slug.',
        values: { slug: 'taken', name: 'Again' },
      })
    })

    it('updates a project but keeps its slug', async () => {
      const project = await insertProject({ slug: 'fixed', canDm: true, enabled: true })
      const state = await saveProject(
        idle,
        form({ id: project.id, slug: 'changed', name: 'Renamed', description: 'New' }),
      )
      expect(state).toEqual({ status: 'saved' })
      expect(await findProject(project.id)).toMatchObject({
        slug: 'fixed',
        name: 'Renamed',
        description: 'New',
        // Unchecked switches are missing from the form, so they turn off.
        canDm: false,
        enabled: false,
      })
    })

    it('refuses an invalid update without touching the project', async () => {
      const project = await insertProject({ name: 'Before' })
      const state = await saveProject(idle, form({ id: project.id, name: '' }))
      expect(state).toMatchObject({ status: 'error', values: { id: project.id } })
      expect((await findProject(project.id))!.name).toBe('Before')
    })

    it.each([
      ['an id that is not a uuid', 'not-a-uuid'],
      ['a project that was deleted', '00000000-0000-4000-8000-000000000000'],
    ])('says the project is gone for %s', async (_case, id) => {
      const state = await saveProject(idle, form({ id, name: 'Tool' }))
      expect(state).toMatchObject({ status: 'error', message: 'That project no longer exists.' })
    })
  })

  describe('revokeMemberCode', () => {
    it('revokes the code', async () => {
      const member = await insertUser()
      const project = await insertProject()
      await issueCode(member.id, project.id)
      const [code] = await db.select().from(accessCodes)
      await revokeMemberCode(form({ codeId: code!.id }))
      const [after] = await db.select().from(accessCodes)
      expect(after!.revokedAt).toBeInstanceOf(Date)
    })

    it('ignores a code id that is not a uuid', async () => {
      await expect(revokeMemberCode(form({ codeId: 'nope' }))).resolves.toBeUndefined()
    })
  })

  describe('setMemberAdmin', () => {
    const roleOf = async (id: string) =>
      (await db.select().from(user).where(eq(user.id, id)))[0]!.role

    it('makes a member an admin, and back', async () => {
      const member = await insertUser()
      await setMemberAdmin(form({ userId: member.id, admin: 'true' }))
      expect(await roleOf(member.id)).toBe('admin')
      await setMemberAdmin(form({ userId: member.id, admin: 'false' }))
      expect(await roleOf(member.id)).toBe('user')
    })

    it('does not let an admin remove their own role', async () => {
      await insertUser({ role: 'admin' })
      await setMemberAdmin(form({ userId: admin.id, admin: 'false' }))
      expect(await roleOf(admin.id)).toBe('admin')
    })

    it('ignores a form without a member', async () => {
      await expect(setMemberAdmin(form({ admin: 'true' }))).resolves.toBeUndefined()
    })
  })
})
