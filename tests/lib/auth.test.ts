import { parseAdditionalUserInputFromProviderProfile } from 'better-auth/db'
import { beforeAll, describe, expect, it } from 'vitest'
import { getAuth } from '@/lib/auth'

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
