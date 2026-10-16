import { describe, expect, it } from 'vitest'
import {
  CANNOT_DM_USER,
  createDiscordBot,
  DiscordError,
  UNKNOWN_CHANNEL,
  UNKNOWN_MEMBER,
} from '@/lib/discord'

interface Call {
  url: string
  init: RequestInit
}

/** A fetch that answers every call with the given responses in order and records the calls. */
function fakeFetch(...responses: Response[]) {
  const calls: Call[] = []
  const impl = async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init: init ?? {} })
    const res = responses.shift()
    if (res === undefined) throw new Error('unexpected fetch')
    return res
  }
  return { calls, fetch: impl as typeof fetch }
}

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return Response.json(body, { status, headers })
}

function botWith(...responses: Response[]) {
  const fake = fakeFetch(...responses)
  const bot = createDiscordBot({ botToken: 'token-123', guildId: 'guild-1' }, fake.fetch)
  return { bot, calls: fake.calls }
}

function headersOf(call: Call): Record<string, string> {
  return call.init.headers as Record<string, string>
}

function bodyOf(call: Call): unknown {
  return JSON.parse(call.init.body as string)
}

async function caught(promise: Promise<unknown>): Promise<DiscordError> {
  const err = await promise.then(
    () => null,
    (e: unknown) => e,
  )
  expect(err).toBeInstanceOf(DiscordError)
  return err as DiscordError
}

describe('requests', () => {
  it('send the bot token and a DiscordBot user agent', async () => {
    const { bot, calls } = botWith(json(200, {}))
    await bot.isGuildMember('user-1')
    const headers = headersOf(calls[0]!)
    expect(headers.Authorization).toBe('Bot token-123')
    expect(headers['User-Agent']).toMatch(/^DiscordBot \(/)
  })

  it('carry a signal, so a hung call times out', async () => {
    const { bot, calls } = botWith(json(200, {}))
    await bot.isGuildMember('user-1')
    expect(calls[0]!.init.signal).toBeInstanceOf(AbortSignal)
  })

  it('send no body or content type on a GET', async () => {
    const { bot, calls } = botWith(json(200, {}))
    await bot.isGuildMember('user-1')
    expect(calls[0]!.init.body).toBeUndefined()
    expect(headersOf(calls[0]!)['Content-Type']).toBeUndefined()
  })
})

describe('isGuildMember', () => {
  it('asks for the member in the configured guild', async () => {
    const { bot, calls } = botWith(json(200, { user: { id: 'user-1' } }))
    await bot.isGuildMember('user-1')
    expect(calls[0]!.url).toBe('https://discord.com/api/v10/guilds/guild-1/members/user-1')
    expect(calls[0]!.init.method).toBe('GET')
  })

  it('is true when Discord returns the member', async () => {
    const { bot } = botWith(json(200, { user: { id: 'user-1' } }))
    expect(await bot.isGuildMember('user-1')).toBe(true)
  })

  it('is false on Unknown Member (10007)', async () => {
    const { bot } = botWith(json(404, { code: UNKNOWN_MEMBER, message: 'Unknown Member' }))
    expect(await bot.isGuildMember('user-1')).toBe(false)
  })

  it('throws on any other error', async () => {
    const { bot } = botWith(json(404, { code: 10004, message: 'Unknown Guild' }))
    const err = await caught(bot.isGuildMember('user-1'))
    expect(err.status).toBe(404)
    expect(err.code).toBe(10004)
  })

  it('throws on a server error with no JSON body', async () => {
    const { bot } = botWith(new Response('Bad Gateway', { status: 502 }))
    const err = await caught(bot.isGuildMember('user-1'))
    expect(err.status).toBe(502)
    expect(err.code).toBeNull()
  })
})

describe('openDm', () => {
  it('posts the recipient and returns the channel id', async () => {
    const { bot, calls } = botWith(json(200, { id: 'channel-9' }))
    expect(await bot.openDm('user-1')).toBe('channel-9')
    expect(calls[0]!.url).toBe('https://discord.com/api/v10/users/@me/channels')
    expect(calls[0]!.init.method).toBe('POST')
    expect(headersOf(calls[0]!)['Content-Type']).toBe('application/json')
    expect(bodyOf(calls[0]!)).toEqual({ recipient_id: 'user-1' })
  })

  it('aborts when the given signal does', async () => {
    const { bot, calls } = botWith(json(200, { id: 'channel-9' }))
    const controller = new AbortController()
    await bot.openDm('user-1', controller.signal)
    const signal = calls[0]!.init.signal as AbortSignal
    expect(signal.aborted).toBe(false)
    controller.abort()
    expect(signal.aborted).toBe(true)
  })
})

describe('sendMessage', () => {
  it('posts the content to the channel and allows no mentions', async () => {
    const { bot, calls } = botWith(json(200, { id: 'message-1' }))
    await bot.sendMessage('channel-9', 'hello @everyone')
    expect(calls[0]!.url).toBe('https://discord.com/api/v10/channels/channel-9/messages')
    expect(calls[0]!.init.method).toBe('POST')
    expect(bodyOf(calls[0]!)).toEqual({
      content: 'hello @everyone',
      allowed_mentions: { parse: [] },
    })
  })

  it('sends the nonce with enforce_nonce when given one', async () => {
    const { bot, calls } = botWith(json(200, { id: 'message-1' }))
    await bot.sendMessage('channel-9', 'hello', { nonce: 'abc123' })
    expect(bodyOf(calls[0]!)).toEqual({
      content: 'hello',
      allowed_mentions: { parse: [] },
      nonce: 'abc123',
      enforce_nonce: true,
    })
  })

  it('throws Cannot DM User (50007) as a DiscordError', async () => {
    const { bot } = botWith(
      json(403, { code: CANNOT_DM_USER, message: 'Cannot send messages to this user' }),
    )
    const err = await caught(bot.sendMessage('channel-9', 'hello'))
    expect(err.status).toBe(403)
    expect(err.code).toBe(CANNOT_DM_USER)
    expect(err.message).toBe('discord 403: Cannot send messages to this user')
    expect(err.name).toBe('DiscordError')
  })

  it('throws Unknown Channel (10003) as a DiscordError', async () => {
    const { bot } = botWith(json(404, { code: UNKNOWN_CHANNEL, message: 'Unknown Channel' }))
    const err = await caught(bot.sendMessage('channel-9', 'hello'))
    expect(err.code).toBe(UNKNOWN_CHANNEL)
  })
})

describe('DiscordError mapping', () => {
  it('reads retry_after from a 429 body', async () => {
    const { bot } = botWith(
      json(429, { message: 'You are being rate limited.', retry_after: 1.5, global: false }),
    )
    const err = await caught(bot.sendMessage('channel-9', 'hello'))
    expect(err.status).toBe(429)
    expect(err.retryAfter).toBe(1.5)
    expect(err.code).toBeNull()
  })

  it('prefers retry_after in the body over the header', async () => {
    const { bot } = botWith(json(429, { retry_after: 2.25 }, { 'Retry-After': '9' }))
    const err = await caught(bot.sendMessage('channel-9', 'hello'))
    expect(err.retryAfter).toBe(2.25)
  })

  it('falls back to the Retry-After header', async () => {
    const { bot } = botWith(
      new Response('slow down', { status: 429, headers: { 'Retry-After': '7' } }),
    )
    const err = await caught(bot.sendMessage('channel-9', 'hello'))
    expect(err.retryAfter).toBe(7)
    expect(err.message).toBe('discord 429')
  })

  it('ignores a Retry-After header that is not a positive number', async () => {
    const { bot } = botWith(
      new Response('slow down', { status: 429, headers: { 'Retry-After': 'soon' } }),
    )
    const err = await caught(bot.sendMessage('channel-9', 'hello'))
    expect(err.retryAfter).toBeNull()
  })

  it('leaves retryAfter null when nothing gives one', async () => {
    const { bot } = botWith(json(500, { message: 'oops' }))
    const err = await caught(bot.sendMessage('channel-9', 'hello'))
    expect(err.retryAfter).toBeNull()
    expect(err.message).toBe('discord 500: oops')
  })

  it('ignores fields of the wrong type', async () => {
    const { bot } = botWith(json(400, { code: '50007', message: 42, retry_after: '3' }))
    const err = await caught(bot.sendMessage('channel-9', 'hello'))
    expect(err.code).toBeNull()
    expect(err.retryAfter).toBeNull()
    expect(err.message).toBe('discord 400')
  })
})
