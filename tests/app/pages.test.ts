import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import AdminPage from '@/app/admin/page'
import Home from '@/app/page'
import { currentMember, type Member } from '@/lib/session'
import { codesForUser, listMembers, type CodeInfo, type MemberRow } from '@/services/codes'
import { listEnabledProjects, listProjects, type Project } from '@/services/projects'

vi.mock('@/lib/session', () => ({ currentMember: vi.fn() }))
vi.mock('@/services/codes', () => ({ codesForUser: vi.fn(), listMembers: vi.fn() }))
vi.mock('@/services/projects', () => ({ listEnabledProjects: vi.fn(), listProjects: vi.fn() }))
// The pages only pass the actions to forms; nothing here runs them.
vi.mock('@/app/actions', () => ({ signIn: vi.fn(), signOut: vi.fn(), getCode: vi.fn() }))
vi.mock('@/app/admin/actions', () => ({
  saveProject: vi.fn(),
  revokeMemberCode: vi.fn(),
  setMemberAdmin: vi.fn(),
}))
vi.mock('next/navigation', () => ({
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND')
  }),
}))

const member: Member = {
  id: 'user-1',
  name: 'Nelly',
  discordId: '80351110224678912',
  discordUsername: 'nelly',
  isAdmin: false,
}

function project(overrides: Partial<Project> = {}): Project {
  return {
    id: '6f1c1c1e-6d0e-4b7a-9a43-3d1a5b0c2f10',
    slug: 'hindsight',
    name: 'Hindsight',
    description: 'Answers on Discord',
    homepageUrl: null,
    canDm: true,
    enabled: true,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    ...overrides,
  }
}

function code(overrides: Partial<CodeInfo> = {}): CodeInfo {
  return {
    id: 'a3c1a2d4-8a5e-4f7e-9d1b-0c7f6f1e2a31',
    issuedAt: new Date('2026-10-01T00:00:00Z'),
    lastUsedAt: null,
    revokedAt: null,
    ...overrides,
  }
}

function memberRow(overrides: Partial<MemberRow> = {}): MemberRow {
  return {
    id: 'user-2',
    name: 'Other',
    discordUsername: 'other',
    discordId: '2',
    role: 'user',
    createdAt: new Date(0),
    codes: [],
    ...overrides,
  }
}

async function home(error?: string): Promise<string> {
  const searchParams = Promise.resolve(error === undefined ? {} : { error })
  return renderToStaticMarkup(await Home({ searchParams, params: Promise.resolve({}) }))
}

beforeEach(() => {
  vi.mocked(currentMember).mockResolvedValue(member)
  vi.mocked(listEnabledProjects).mockResolvedValue([project()])
  vi.mocked(codesForUser).mockResolvedValue(new Map())
})

describe('home page, signed out', () => {
  beforeEach(() => {
    vi.mocked(currentMember).mockResolvedValue(null)
  })

  it('offers Discord sign-in and lists nothing', async () => {
    const html = await home()
    expect(html).toContain('Sign in with Discord')
    expect(html).not.toContain('Could not sign you in')
    expect(listEnabledProjects).not.toHaveBeenCalled()
  })

  it.each([
    ['not_in_server', 'Join the server, then sign in again.'],
    ['NOT_IN_SERVER', 'Join the server, then sign in again.'],
    ['discord_unavailable', 'Discord did not answer.'],
    ['discord_only', 'Sign in with Discord.'],
    ['state_mismatch', 'Sign-in did not work. Try again.'],
  ])('explains the sign-in error %s', async (error, message) => {
    const html = await home(error)
    expect(html).toContain('Could not sign you in')
    expect(html).toContain(message)
  })
})

describe('home page, signed in', () => {
  it.each([
    ['no code', undefined, 'No code yet.', 'Get a code'],
    ['an unused code', code(), 'not used yet.', 'Get a new code'],
    [
      'a used code',
      code({ lastUsedAt: new Date('2026-10-02T12:00:00Z') }),
      'Code last used Fri, 02 Oct 2026 12:00:00 GMT.',
      'Get a new code',
    ],
    ['a revoked code', code({ revokedAt: new Date() }), 'Your code was turned off.', 'Get a code'],
  ])('shows a tool with %s', async (_case, info, status, button) => {
    if (info !== undefined)
      vi.mocked(codesForUser).mockResolvedValue(new Map([[project().id, info]]))
    const html = await home()
    expect(html).toContain('Hindsight')
    expect(html).toContain(status)
    expect(html).toContain(`>${button}</button>`)
  })

  it('says when no tools are set up', async () => {
    vi.mocked(listEnabledProjects).mockResolvedValue([])
    expect(await home()).toContain('No tools are set up yet.')
  })

  it('links admins, and only admins, to /admin', async () => {
    expect(await home()).not.toContain('href="/admin"')
    vi.mocked(currentMember).mockResolvedValue({ ...member, isAdmin: true })
    expect(await home()).toContain('href="/admin"')
  })
})

describe('admin page', () => {
  it.each([
    ['signed out', null],
    ['a member', member],
  ])('is not found for someone %s', async (_who, who) => {
    vi.mocked(currentMember).mockResolvedValue(who)
    await expect(AdminPage()).rejects.toThrow('NEXT_NOT_FOUND')
    expect(listProjects).not.toHaveBeenCalled()
    expect(listMembers).not.toHaveBeenCalled()
  })

  async function adminPage(members: MemberRow[]): Promise<string> {
    vi.mocked(currentMember).mockResolvedValue({ ...member, isAdmin: true })
    vi.mocked(listProjects).mockResolvedValue([project({ enabled: false })])
    vi.mocked(listMembers).mockResolvedValue(members)
    return renderToStaticMarkup(await AdminPage())
  }

  it('lists projects for an admin', async () => {
    const html = await adminPage([])
    expect(html).toContain('Hindsight')
    expect(html).toContain('Add a project')
  })

  it('offers to turn off a live code, and marks a revoked one', async () => {
    const html = await adminPage([
      memberRow({
        codes: [
          { ...code({ lastUsedAt: new Date('2026-10-05T00:00:00Z') }), projectName: 'Hindsight' },
          { ...code({ id: 'revoked', revokedAt: new Date() }), projectName: 'Other tool' },
        ],
      }),
    ])
    expect(html).toContain('2026-10-01')
    expect(html).toContain('2026-10-05')
    expect(html).toContain('never')
    expect(html.match(/>Turn off</g)).toHaveLength(1)
    expect(html).toContain('Other tool')
  })

  it('offers to change everyone’s role but the admin’s own', async () => {
    const html = await adminPage([
      memberRow({ id: member.id, role: 'admin', discordUsername: 'nelly' }),
      memberRow({ id: 'user-2', role: 'admin' }),
      memberRow({ id: 'user-3', role: 'user' }),
    ])
    expect(html).not.toContain(`value="${member.id}"`)
    expect(html.match(/>Remove admin</g)).toHaveLength(1)
    expect(html.match(/>Make admin</g)).toHaveLength(1)
    expect(html).toContain('No codes')
  })
})
