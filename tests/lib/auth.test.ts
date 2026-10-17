import { parseAdditionalUserInputFromProviderProfile } from 'better-auth/db'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { getAuth } from '@/lib/auth'
import { DiscordAPIError, isGuildMember } from '@/lib/discord'

vi.mock('@/lib/discord', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/discord')>()),
  isGuildMember: vi.fn(),
}))

beforeAll(() => {
  process.env.BETTER_AUTH_URL ??= 'http://localhost:3000'
  process.env.BETTER_AUTH_SECRET ??= 'test-secret-that-is-at-least-32-characters'
})

// What mapProfileToUser adds on top of name and email. Better Auth runs it
// through this same filter when a member first signs in, and on later sign-ins.
const profile = { discordId: '80351110224678912', discordUsername: 'nelly' }

describe('Discord sign-in', () => {
  it('keeps the Discord fields when creating a member', () => {
    expect(
      parseAdditionalUserInputFromProviderProfile(getAuth().options, profile, 'create'),
    ).toMatchObject(profile)
  })

  it('keeps the Discord username current on later sign-ins', () => {
    expect(
      parseAdditionalUserInputFromProviderProfile(getAuth().options, profile, 'update'),
    ).toMatchObject(profile)
  })

  const mapProfile = (discord: Record<string, unknown>) =>
    (
      getAuth().options.socialProviders!.discord!.mapProfileToUser as (
        profile: unknown,
      ) => Record<string, unknown>
    )(discord)

  it('makes a member from the Discord profile, with no real email', () => {
    expect(
      mapProfile({ id: '80351110224678912', username: 'nelly', global_name: 'Nelly' }),
    ).toEqual({
      email: '80351110224678912@discord.invalid',
      emailVerified: false,
      name: 'Nelly',
      discordId: '80351110224678912',
      discordUsername: 'nelly',
    })
  })

  it('names a member by username when they have no display name', () => {
    expect(mapProfile({ id: '1', username: 'nelly', global_name: null })).toMatchObject({
      name: 'nelly',
    })
  })

  it('does not let members edit their own profile', async () => {
    const res = await getAuth().handler(
      new Request('http://localhost:3000/api/auth/update-user', {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: 'http://localhost:3000' },
        body: JSON.stringify({ discordId: '1' }),
      }),
    )
    expect(res.status).toBe(404)
  })
})

describe('membership check at sign-in', () => {
  const source = { oauth: { providerId: 'discord', profile: { id: profile.discordId } } }
  const validate = (input: unknown) =>
    (getAuth().options.user?.validateUserInfo as (input: unknown) => Promise<unknown>)(input)

  it('logs why Discord could not be asked', async () => {
    vi.mocked(isGuildMember).mockRejectedValueOnce(new Error('401: Unauthorized'))
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(await validate({ source })).toEqual({ error: 'discord_unavailable' })
    expect(log).toHaveBeenCalledWith('membership check failed', {
      discordId: profile.discordId,
      err: '401: Unauthorized',
    })
    log.mockRestore()
  })

  it('logs the status and code of a Discord error', async () => {
    vi.mocked(isGuildMember).mockRejectedValueOnce(
      new DiscordAPIError(
        { code: 10004, message: 'Unknown Guild' },
        10004,
        404,
        'GET',
        'https://discord.com/api/v10/guilds/1/members/2',
        {},
      ),
    )
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(await validate({ source })).toEqual({ error: 'discord_unavailable' })
    expect(log).toHaveBeenCalledWith(
      'membership check failed',
      expect.objectContaining({ discordId: profile.discordId, status: 404, code: 10004 }),
    )
    log.mockRestore()
  })

  it.each([
    ['another provider', { oauth: { providerId: 'github', profile: { id: '1' } } }],
    ['no OAuth profile', {}],
  ])('refuses %s without asking Discord', async (_case, other) => {
    vi.mocked(isGuildMember).mockClear()
    expect(await validate({ source: other })).toEqual({ error: 'discord_only' })
    expect(isGuildMember).not.toHaveBeenCalled()
  })

  it('lets members of the server in', async () => {
    vi.mocked(isGuildMember).mockResolvedValueOnce(true)
    expect(await validate({ source })).toBeUndefined()
  })

  it('turns away accounts outside the server', async () => {
    vi.mocked(isGuildMember).mockResolvedValueOnce(false)
    expect(await validate({ source })).toEqual({ error: 'not_in_server' })
  })
})
