import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  createProject,
  findProject,
  listEnabledProjects,
  listProjects,
  updateProject,
  type ProjectInput,
} from '@/services/projects'
import { closeTestDb, pgErrorCode, resetTestDb, testDatabaseUrl, truncateAll } from '../db'

const UNIQUE_VIOLATION = '23505'

function input(overrides: Partial<ProjectInput> = {}): ProjectInput {
  return {
    slug: 'hindsight',
    name: 'Hindsight',
    description: 'Ask Claude what just happened.',
    homepageUrl: 'https://example.test/hindsight',
    canDm: true,
    enabled: true,
    ...overrides,
  }
}

const changes: Omit<ProjectInput, 'slug'> = {
  name: 'Hindsight',
  description: '',
  homepageUrl: null,
  canDm: true,
  enabled: true,
}

describe.skipIf(!testDatabaseUrl)('services/projects', () => {
  beforeAll(async () => {
    await resetTestDb()
  })

  afterAll(async () => {
    await closeTestDb()
  })

  beforeEach(async () => {
    await truncateAll()
  })

  describe('createProject', () => {
    it('stores the project and returns it with its id and times', async () => {
      const project = await createProject(input())
      expect(project).toMatchObject(input())
      expect(project.id).toMatch(/^[0-9a-f-]{36}$/)
      expect(project.createdAt).toBeInstanceOf(Date)
      expect(await findProject(project.id)).toEqual(project)
    })

    it('refuses a slug that is already taken', async () => {
      await createProject(input())
      const err = await createProject(input({ name: 'Another' })).catch((e: unknown) => e)
      expect(pgErrorCode(err)).toBe(UNIQUE_VIOLATION)
      expect(await listProjects()).toHaveLength(1)
    })

    it('allows the same name with a different slug', async () => {
      await createProject(input())
      await createProject(input({ slug: 'hindsight-2' }))
      expect(await listProjects()).toHaveLength(2)
    })
  })

  describe('updateProject', () => {
    it('changes every field but the slug', async () => {
      const created = await createProject(input())
      const updated = await updateProject(created.id, {
        name: 'Hindsight 2',
        description: 'New',
        homepageUrl: null,
        canDm: false,
        enabled: false,
      })
      expect(updated).toMatchObject({
        id: created.id,
        slug: 'hindsight',
        name: 'Hindsight 2',
        description: 'New',
        homepageUrl: null,
        canDm: false,
        enabled: false,
      })
      expect((await findProject(created.id))?.slug).toBe('hindsight')
    })

    it('moves updatedAt forward', async () => {
      const created = await createProject(input())
      const updated = await updateProject(created.id, { ...changes, name: 'Renamed' })
      expect(updated!.updatedAt.getTime()).toBeGreaterThanOrEqual(created.updatedAt.getTime())
      expect(updated!.createdAt).toEqual(created.createdAt)
    })

    it('returns null for an unknown project', async () => {
      expect(await updateProject('00000000-0000-4000-8000-000000000000', changes)).toBeNull()
    })
  })

  describe('findProject', () => {
    it('returns null for an unknown id', async () => {
      expect(await findProject('00000000-0000-4000-8000-000000000000')).toBeNull()
    })
  })

  describe('listProjects and listEnabledProjects', () => {
    beforeEach(async () => {
      await createProject(input({ slug: 'zeta', name: 'Zeta' }))
      await createProject(input({ slug: 'off', name: 'Middle', enabled: false }))
      await createProject(input({ slug: 'alpha', name: 'Alpha', canDm: false }))
    })

    it('lists every project by name', async () => {
      expect((await listProjects()).map((p) => p.slug)).toEqual(['alpha', 'off', 'zeta'])
    })

    it('lists only enabled projects, by name', async () => {
      expect((await listEnabledProjects()).map((p) => p.slug)).toEqual(['alpha', 'zeta'])
    })

    it('is empty when every project is disabled', async () => {
      await truncateAll()
      await createProject(input({ enabled: false }))
      expect(await listEnabledProjects()).toEqual([])
    })
  })
})
