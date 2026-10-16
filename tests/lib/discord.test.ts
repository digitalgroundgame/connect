import { DiscordAPIError, RateLimitError, type RESTOptions } from '@discordjs/rest'
import { RESTJSONErrorCodes } from 'discord-api-types/v10'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as discord from '@/lib/discord'

/** Stands in for @discordjs/rest's REST client, recording how it is built and called. */
const rest = vi.hoisted(() => ({
  options: [] as unknown[],
  token: undefined as string | undefined,
  get: vi.fn<(route: string, options?: unknown) => Promise<unknown>>(),
  post: vi.fn<(route: string, options?: unknown) => Promise<unknown>>(),
}))

vi.mock('@discordjs/rest', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@discordjs/rest')>()
  class FakeREST {
    constructor(options?: unknown) {
      rest.options.push(options)
    }
    setToken(token: string) {
      rest.token = token
      return this
    }
    get = rest.get
    post = rest.post
  }
  return { ...actual, REST: FakeREST }
})

// Both are read when the client is first used, not when the module loads.
vi.stubEnv('DISCORD_BOT_TOKEN', 'token-123')
vi.stubEnv('DISCORD_GUILD_ID', 'guild-1')

const { isGuildMember, openDm, sendMessage } = discord

function apiError(code: number, status = 404): DiscordAPIError {
  return new DiscordAPIError(
    { code, message: 'error' },
    code,
    status,
    'GET',
    'https://discord.com/api/v10/x',
    {},
  )
}

beforeEach(() => {
  rest.get.mockReset().mockResolvedValue({})
  rest.post.mockReset().mockResolvedValue({ id: 'channel-9' })
})

describe('the REST client', () => {
  it('is built once, with the bot token, and rejects on rate limits', async () => {
    await isGuildMember('user-1')
    await openDm('user-1')
    expect(rest.options).toHaveLength(1)
    expect(rest.token).toBe('token-123')
    const options = rest.options[0] as Partial<RESTOptions>
    const reject = options.rejectOnRateLimit
    expect(typeof reject).toBe('function')
    expect(await (reject as () => unknown)()).toBe(true)
  })
})

describe('isGuildMember', () => {
  it('asks for the member in the configured guild', async () => {
    await isGuildMember('user-1')
    expect(rest.get).toHaveBeenCalledWith('/guilds/guild-1/members/user-1')
  })

  it('is true when Discord returns the member', async () => {
    rest.get.mockResolvedValue({ user: { id: 'user-1' } })
    expect(await isGuildMember('user-1')).toBe(true)
  })

  it('is false on Unknown Member (10007)', async () => {
    rest.get.mockRejectedValue(apiError(RESTJSONErrorCodes.UnknownMember))
    expect(await isGuildMember('user-1')).toBe(false)
  })

  it('rethrows any other Discord error', async () => {
    const err = apiError(RESTJSONErrorCodes.UnknownGuild)
    rest.get.mockRejectedValue(err)
    await expect(isGuildMember('user-1')).rejects.toBe(err)
  })

  it('rethrows an error that is not from Discord', async () => {
    const err = new TypeError('fetch failed')
    rest.get.mockRejectedValue(err)
    await expect(isGuildMember('user-1')).rejects.toBe(err)
  })
})

describe('openDm', () => {
  it('posts the recipient and returns the channel id', async () => {
    expect(await openDm('user-1')).toBe('channel-9')
    expect(rest.post).toHaveBeenCalledWith('/users/@me/channels', {
      body: { recipient_id: 'user-1' },
      signal: undefined,
    })
  })

  it('passes the signal on', async () => {
    const signal = new AbortController().signal
    await openDm('user-1', signal)
    expect(rest.post.mock.calls[0]![1]).toMatchObject({ signal })
  })
})

describe('sendMessage', () => {
  it('posts the content to the channel and allows no mentions', async () => {
    await sendMessage('channel-9', 'hello @everyone')
    expect(rest.post).toHaveBeenCalledWith('/channels/channel-9/messages', {
      body: { content: 'hello @everyone', allowed_mentions: { parse: [] } },
      signal: undefined,
    })
  })

  it('sends the nonce with enforce_nonce when given one', async () => {
    const signal = new AbortController().signal
    await sendMessage('channel-9', 'hello', { nonce: 'abc123', signal })
    expect(rest.post).toHaveBeenCalledWith('/channels/channel-9/messages', {
      body: {
        content: 'hello',
        allowed_mentions: { parse: [] },
        nonce: 'abc123',
        enforce_nonce: true,
      },
      signal,
    })
  })

  it('sends no nonce fields for an undefined nonce', async () => {
    await sendMessage('channel-9', 'hello', { nonce: undefined })
    const body = (rest.post.mock.calls[0]![1] as { body: object }).body
    expect(body).not.toHaveProperty('nonce')
    expect(body).not.toHaveProperty('enforce_nonce')
  })

  it('lets Discord errors through', async () => {
    const err = apiError(RESTJSONErrorCodes.CannotSendMessagesToThisUser, 403)
    rest.post.mockRejectedValue(err)
    await expect(sendMessage('channel-9', 'hello')).rejects.toBe(err)
  })
})

describe('re-exports', () => {
  it('are the classes from @discordjs/rest', () => {
    expect(discord.DiscordAPIError).toBe(DiscordAPIError)
    expect(discord.RateLimitError).toBe(RateLimitError)
  })
})
