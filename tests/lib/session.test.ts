import { describe, expect, it, vi } from 'vitest'
import { getAuth } from '@/lib/auth'
import { currentMember } from '@/lib/session'

vi.mock('@/lib/auth', () => ({ getAuth: vi.fn() }))
vi.mock('next/headers', () => ({ headers: vi.fn(async () => new Headers({ cookie: 'c=1' })) }))

function withSession(session: unknown) {
  const getSession = vi.fn().mockResolvedValue(session)
  vi.mocked(getAuth).mockReturnValue({ api: { getSession } } as never)
  return getSession
}

const sessionUser = {
  id: 'user-1',
  name: 'Nelly',
  email: '80351110224678912@discord.invalid',
  discordId: '80351110224678912',
  discordUsername: 'nelly',
  dmChannelId: '123',
}

describe('currentMember', () => {
  it('is null when nobody is signed in', async () => {
    withSession(null)
    expect(await currentMember()).toBeNull()
  })

  it('reads the session from the request cookies', async () => {
    const getSession = withSession(null)
    await currentMember()
    expect(getSession.mock.calls[0]![0].headers.get('cookie')).toBe('c=1')
  })

  it('gives only what pages need about a member', async () => {
    withSession({ user: { ...sessionUser, role: 'user' } })
    expect(await currentMember()).toEqual({
      id: 'user-1',
      name: 'Nelly',
      discordId: '80351110224678912',
      discordUsername: 'nelly',
      isAdmin: false,
    })
  })

  it.each([
    ['admin', true],
    ['user', false],
    [null, false],
    ['admin,user', false],
  ])('treats role %j as admin: %s', async (role, isAdmin) => {
    withSession({ user: { ...sessionUser, role } })
    expect((await currentMember())!.isAdmin).toBe(isAdmin)
  })
})
