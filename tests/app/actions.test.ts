import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getCode, signIn, signOut, type CodeState } from '@/app/actions'
import { getAuth } from '@/lib/auth'
import { isGuildMember } from '@/lib/discord'
import { currentMember, type Member } from '@/lib/session'
import { issueCode } from '@/services/codes'
import { findProject, type Project } from '@/services/projects'

vi.mock('@/lib/session', () => ({ currentMember: vi.fn() }))
vi.mock('@/lib/discord', () => ({ isGuildMember: vi.fn() }))
vi.mock('@/services/codes', () => ({ issueCode: vi.fn() }))
vi.mock('@/services/projects', () => ({ findProject: vi.fn() }))
vi.mock('@/lib/auth', () => ({ getAuth: vi.fn() }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('next/headers', () => ({ headers: vi.fn(async () => new Headers({ cookie: 'c=1' })) }))
// The real redirect throws Next's own error to stop the action; so does this one.
vi.mock('next/navigation', () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT ${url}`)
  }),
}))

const PROJECT_ID = '6f1c1c1e-6d0e-4b7a-9a43-3d1a5b0c2f10'

const member: Member = {
  id: 'user-1',
  name: 'Nelly',
  discordId: '80351110224678912',
  discordUsername: 'nelly',
  isAdmin: false,
}

function project(overrides: Partial<Project> = {}): Project {
  return {
    id: PROJECT_ID,
    slug: 'hindsight',
    name: 'Hindsight',
    description: '',
    homepageUrl: null,
    canDm: true,
    enabled: true,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    ...overrides,
  }
}

const idle: CodeState = { status: 'idle' }

function form(projectId: string = PROJECT_ID): FormData {
  const data = new FormData()
  data.set('projectId', projectId)
  return data
}

describe('getCode', () => {
  beforeEach(() => {
    vi.mocked(currentMember).mockResolvedValue(member)
    vi.mocked(findProject).mockResolvedValue(project())
    vi.mocked(isGuildMember).mockResolvedValue(true)
    vi.mocked(issueCode).mockResolvedValue('dgc_code')
    vi.spyOn(console, 'info').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('issues a code to a member of the server', async () => {
    expect(await getCode(idle, form())).toEqual({ status: 'issued', code: 'dgc_code' })
    expect(issueCode).toHaveBeenCalledWith(member.id, PROJECT_ID)
    expect(isGuildMember).toHaveBeenCalledWith(member.discordId)
  })

  it('never logs the code', async () => {
    await getCode(idle, form())
    expect(JSON.stringify(vi.mocked(console.info).mock.calls)).not.toContain('dgc_code')
  })

  it('sends someone signed out back to the home page', async () => {
    vi.mocked(currentMember).mockResolvedValue(null)
    await expect(getCode(idle, form())).rejects.toThrow('NEXT_REDIRECT /')
    expect(issueCode).not.toHaveBeenCalled()
  })

  it('refuses a project id that is not a uuid without looking it up', async () => {
    expect(await getCode(idle, form('1; drop table'))).toEqual({
      status: 'error',
      message: 'That tool is not available right now.',
    })
    expect(findProject).not.toHaveBeenCalled()
  })

  it.each([
    ['missing', null],
    ['disabled', project({ enabled: false })],
  ])('refuses a project that is %s', async (_case, found) => {
    vi.mocked(findProject).mockResolvedValue(found)
    expect(await getCode(idle, form())).toMatchObject({ status: 'error' })
    expect(issueCode).not.toHaveBeenCalled()
  })

  it('refuses someone who has left the server since signing in', async () => {
    vi.mocked(isGuildMember).mockResolvedValue(false)
    expect(await getCode(idle, form())).toEqual({
      status: 'error',
      message: 'Your Discord account is no longer in the DGG Discord server.',
    })
    expect(issueCode).not.toHaveBeenCalled()
  })
})

describe('signIn', () => {
  it('sends the member to Discord', async () => {
    const signInSocial = vi.fn().mockResolvedValue({ url: 'https://discord.com/oauth2/authorize' })
    vi.mocked(getAuth).mockReturnValue({ api: { signInSocial } } as never)
    await expect(signIn()).rejects.toThrow('NEXT_REDIRECT https://discord.com/oauth2/authorize')
    expect(signInSocial).toHaveBeenCalledWith({
      body: { provider: 'discord', callbackURL: '/', errorCallbackURL: '/' },
    })
  })

  it('goes home when Better Auth gives no link', async () => {
    const signInSocial = vi.fn().mockResolvedValue({})
    vi.mocked(getAuth).mockReturnValue({ api: { signInSocial } } as never)
    await expect(signIn()).rejects.toThrow('NEXT_REDIRECT /')
  })
})

describe('signOut', () => {
  it('ends the session from the request cookies, then goes home', async () => {
    const signOutApi = vi.fn().mockResolvedValue({ success: true })
    vi.mocked(getAuth).mockReturnValue({ api: { signOut: signOutApi } } as never)
    await expect(signOut()).rejects.toThrow('NEXT_REDIRECT /')
    expect(signOutApi.mock.calls[0]![0].headers.get('cookie')).toBe('c=1')
  })
})
