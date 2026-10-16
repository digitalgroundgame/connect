import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createDmApi, MAX_CONTENT, testMessage, withFooter } from '@/api/dm'
import { messageNonce, newCode } from '@/lib/codes'
import { CANNOT_DM_USER, DiscordError, UNKNOWN_CHANNEL, type DiscordBot } from '@/lib/discord'
import { DmLimiter } from '@/lib/limits'
import type { Logger } from '@/lib/log'
import type { CodeOwner } from '@/services/codes'
import type { Project } from '@/services/projects'

const URL_BASE = 'http://connect.test/api/v1'

function project(overrides: Partial<Project> = {}): Project {
  return {
    id: 'project-1',
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

function owner(overrides: { dmChannelId?: string | null; project?: Partial<Project> } = {}) {
  return {
    codeId: 'code-1',
    user: {
      id: 'user-1',
      name: 'Destiny',
      discordId: 'discord-1',
      dmChannelId: overrides.dmChannelId === undefined ? 'channel-cached' : overrides.dmChannelId,
    },
    project: project(overrides.project),
  } satisfies CodeOwner
}

function discordError(status: number, code: number | null, retryAfter: number | null = null) {
  return new DiscordError(status, code, retryAfter, `discord ${status}`)
}

const silentLog: Logger = { info: () => {}, warn: () => {}, error: () => {} }

let code: string
let codes: Map<string, CodeOwner>
let bot: {
  isGuildMember: ReturnType<typeof vi.fn<DiscordBot['isGuildMember']>>
  openDm: ReturnType<typeof vi.fn<DiscordBot['openDm']>>
  sendMessage: ReturnType<typeof vi.fn<DiscordBot['sendMessage']>>
}
let findByCode: ReturnType<typeof vi.fn<(code: string) => Promise<CodeOwner | null>>>
let touchCode: ReturnType<typeof vi.fn<(codeId: string) => Promise<void>>>
let setDmChannel: ReturnType<typeof vi.fn<(userId: string, channelId: string) => Promise<void>>>
let limiter: DmLimiter
let clientIpHeader: string | null

function api() {
  return createDmApi({
    findByCode,
    touchCode,
    setDmChannel,
    bot,
    limiter,
    log: silentLog,
    clientIpHeader,
  })
}

/** Registers the default code with this owner. */
function withOwner(o: CodeOwner): void {
  codes.set(code, o)
}

function request(
  path: 'messages' | 'test',
  options: { auth?: string | null; body?: string; headers?: Record<string, string> } = {},
): Request {
  const auth = options.auth === undefined ? `Bearer ${code}` : options.auth
  return new Request(`${URL_BASE}/${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(auth !== null && { Authorization: auth }),
      ...options.headers,
    },
    ...(options.body !== undefined && { body: options.body }),
  })
}

function message(body: unknown, options: Parameters<typeof request>[1] = {}): Request {
  return request('messages', { body: JSON.stringify(body), ...options })
}

async function expectError(res: Response, status: number, error: string) {
  expect(res.status).toBe(status)
  const body = (await res.json()) as { ok: boolean; error: string; message: string }
  expect(body.ok).toBe(false)
  expect(body.error).toBe(error)
  expect(typeof body.message).toBe('string')
  expect(body.message).not.toBe('')
}

beforeEach(() => {
  code = newCode()
  codes = new Map()
  withOwner(owner())
  findByCode = vi.fn(async (c: string) => codes.get(c) ?? null)
  touchCode = vi.fn(async () => {})
  setDmChannel = vi.fn(async () => {})
  bot = {
    isGuildMember: vi.fn(async () => true),
    openDm: vi.fn(async () => 'channel-new'),
    sendMessage: vi.fn(async () => {}),
  }
  limiter = new DmLimiter()
  clientIpHeader = null
})

describe('messages: success', () => {
  it('returns ok with the project slug and Discord name', async () => {
    const res = await api().messages(message({ content: 'hello' }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, project: 'hindsight', discordName: 'Destiny' })
  })

  it('sends the content with a footer naming the project', async () => {
    await api().messages(message({ content: 'hello' }))
    expect(bot.sendMessage).toHaveBeenCalledTimes(1)
    const [channel, content] = bot.sendMessage.mock.calls[0]!
    expect(channel).toBe('channel-cached')
    expect(content).toBe('hello\n\n-# Sent by Hindsight through DGG Connect.')
    expect(content).toBe(withFooter('hello', 'Hindsight'))
  })

  it('uses the cached DM channel without opening one', async () => {
    await api().messages(message({ content: 'hello' }))
    expect(bot.openDm).not.toHaveBeenCalled()
    expect(setDmChannel).not.toHaveBeenCalled()
  })

  it('opens and saves a DM channel when none is cached', async () => {
    withOwner(owner({ dmChannelId: null }))
    const res = await api().messages(message({ content: 'hello' }))
    expect(res.status).toBe(200)
    expect(bot.openDm).toHaveBeenCalledTimes(1)
    expect(bot.openDm.mock.calls[0]![0]).toBe('discord-1')
    expect(setDmChannel).toHaveBeenCalledWith('user-1', 'channel-new')
    expect(bot.sendMessage.mock.calls[0]![0]).toBe('channel-new')
  })

  it('records the code as used', async () => {
    await api().messages(message({ content: 'hello' }))
    expect(touchCode).toHaveBeenCalledWith('code-1')
  })

  it('still succeeds when saving last-used fails', async () => {
    touchCode.mockRejectedValue(new Error('db down'))
    const res = await api().messages(message({ content: 'hello' }))
    expect(res.status).toBe(200)
  })

  it('still succeeds when saving the DM channel fails', async () => {
    withOwner(owner({ dmChannelId: null }))
    setDmChannel.mockRejectedValue(new Error('db down'))
    const res = await api().messages(message({ content: 'hello' }))
    expect(res.status).toBe(200)
    expect(bot.sendMessage).toHaveBeenCalledTimes(1)
  })

  it('accepts content of exactly the maximum length', async () => {
    const res = await api().messages(message({ content: 'x'.repeat(MAX_CONTENT) }))
    expect(res.status).toBe(200)
  })
})

describe('messages: cached DM channel gone (10003)', () => {
  it('reopens the channel once, saves it, and sends there', async () => {
    bot.sendMessage.mockRejectedValueOnce(discordError(404, UNKNOWN_CHANNEL))
    const res = await api().messages(message({ content: 'hello' }))
    expect(res.status).toBe(200)
    expect(bot.openDm).toHaveBeenCalledTimes(1)
    expect(setDmChannel).toHaveBeenCalledWith('user-1', 'channel-new')
    expect(bot.sendMessage.mock.calls.map((c) => c[0])).toEqual(['channel-cached', 'channel-new'])
  })

  it('sends the same content and nonce on the retry', async () => {
    bot.sendMessage.mockRejectedValueOnce(discordError(404, UNKNOWN_CHANNEL))
    await api().messages(message({ content: 'hello', id: 'm1' }))
    const [first, second] = bot.sendMessage.mock.calls
    expect(second![1]).toBe(first![1])
    expect(second![2]?.nonce).toBe(first![2]?.nonce)
  })

  it('does not reopen a second time', async () => {
    bot.sendMessage.mockRejectedValue(discordError(404, UNKNOWN_CHANNEL))
    const res = await api().messages(message({ content: 'hello' }))
    await expectError(res, 502, 'discord_unavailable')
    expect(bot.openDm).toHaveBeenCalledTimes(1)
    expect(bot.sendMessage).toHaveBeenCalledTimes(2)
  })

  it('does not retry when the channel was just opened', async () => {
    withOwner(owner({ dmChannelId: null }))
    bot.sendMessage.mockRejectedValue(discordError(404, UNKNOWN_CHANNEL))
    const res = await api().messages(message({ content: 'hello' }))
    await expectError(res, 502, 'discord_unavailable')
    expect(bot.openDm).toHaveBeenCalledTimes(1)
    expect(bot.sendMessage).toHaveBeenCalledTimes(1)
  })
})

describe('messages: id and nonce', () => {
  it('sends a nonce derived from the code, id and content', async () => {
    await api().messages(message({ content: 'hello', id: 'm1' }))
    expect(bot.sendMessage.mock.calls[0]![2]?.nonce).toBe(messageNonce('code-1', 'm1', 'hello'))
  })

  it('sends the same nonce when the tool retries', async () => {
    const dm = api()
    await dm.messages(message({ content: 'hello', id: 'm1' }))
    await dm.messages(message({ content: 'hello', id: 'm1' }))
    const [first, second] = bot.sendMessage.mock.calls
    expect(first![2]?.nonce).toBeDefined()
    expect(second![2]?.nonce).toBe(first![2]?.nonce)
  })

  it('sends a different nonce for a different id', async () => {
    const dm = api()
    await dm.messages(message({ content: 'hello', id: 'm1' }))
    await dm.messages(message({ content: 'hello', id: 'm2' }))
    const [first, second] = bot.sendMessage.mock.calls
    expect(second![2]?.nonce).not.toBe(first![2]?.nonce)
  })

  it('sends no nonce without an id', async () => {
    await api().messages(message({ content: 'hello' }))
    expect(bot.sendMessage.mock.calls[0]![2]?.nonce).toBeUndefined()
  })

  it('accepts an id of 64 characters', async () => {
    const res = await api().messages(message({ content: 'hello', id: 'i'.repeat(64) }))
    expect(res.status).toBe(200)
  })
})

describe('messages: invalid_code', () => {
  it('is 401 without an Authorization header', async () => {
    const res = await api().messages(message({ content: 'hello' }, { auth: null }))
    await expectError(res, 401, 'invalid_code')
    expect(findByCode).not.toHaveBeenCalled()
  })

  it('is 401 for a header that is not a code, without a lookup', async () => {
    const res = await api().messages(message({ content: 'hello' }, { auth: 'Bearer nonsense' }))
    await expectError(res, 401, 'invalid_code')
    expect(findByCode).not.toHaveBeenCalled()
  })

  it('is 401 for a well-formed code nobody holds', async () => {
    const res = await api().messages(message({ content: 'hello' }, { auth: `Bearer ${newCode()}` }))
    await expectError(res, 401, 'invalid_code')
    expect(findByCode).toHaveBeenCalledTimes(1)
  })

  it('sends nothing', async () => {
    await api().messages(message({ content: 'hello' }, { auth: null }))
    expect(bot.sendMessage).not.toHaveBeenCalled()
  })

  it('checks the code before reading the body', async () => {
    const req = request('messages', { auth: null, body: 'not json' })
    const res = await api().messages(req)
    await expectError(res, 401, 'invalid_code')
    expect(req.bodyUsed).toBe(false)
  })

  it('checks the code before the body size', async () => {
    const res = await api().messages(
      request('messages', {
        auth: null,
        body: '{}',
        headers: { 'Content-Length': String(1024 * 1024) },
      }),
    )
    await expectError(res, 401, 'invalid_code')
  })
})

describe('messages: failed codes are rate limited per source', () => {
  async function failFrom(dm: ReturnType<typeof api>, ip?: string) {
    return dm.messages(
      message(
        { content: 'hello' },
        { auth: 'Bearer junk', headers: ip === undefined ? {} : { 'CF-Connecting-IP': ip } },
      ),
    )
  }

  it('refuses even a valid code after ten failures, with Retry-After', async () => {
    const dm = api()
    for (let i = 0; i < 10; i++) await expectError(await failFrom(dm), 401, 'invalid_code')
    const res = await dm.messages(message({ content: 'hello' }))
    expect(res.headers.get('Retry-After')).toBe('60')
    await expectError(res, 429, 'rate_limited')
    expect(findByCode).not.toHaveBeenCalled()
  })

  it('counts each client IP apart when a header is configured', async () => {
    clientIpHeader = 'CF-Connecting-IP'
    const dm = api()
    for (let i = 0; i < 10; i++) await failFrom(dm, '203.0.113.1')
    await expectError(await failFrom(dm, '203.0.113.1'), 429, 'rate_limited')
    await expectError(await failFrom(dm, '203.0.113.2'), 401, 'invalid_code')
  })

  it('does not count successful requests', async () => {
    const dm = api()
    for (let i = 0; i < 9; i++) await failFrom(dm)
    // The valid request passes and adds no failure, so one more failure is still a 401.
    expect((await dm.messages(message({ content: 'hello' }))).status).toBe(200)
    await expectError(await failFrom(dm), 401, 'invalid_code')
  })
})

describe('messages: project checks', () => {
  it('is project_disabled (403) for a disabled project', async () => {
    withOwner(owner({ project: { enabled: false } }))
    const res = await api().messages(message({ content: 'hello' }))
    await expectError(res, 403, 'project_disabled')
    expect(bot.sendMessage).not.toHaveBeenCalled()
  })

  it('is dm_not_allowed (403) for a project that may not DM', async () => {
    withOwner(owner({ project: { canDm: false } }))
    const res = await api().messages(message({ content: 'hello' }))
    await expectError(res, 403, 'dm_not_allowed')
    expect(bot.sendMessage).not.toHaveBeenCalled()
  })

  it('does not count these as failed codes', async () => {
    withOwner(owner({ project: { enabled: false } }))
    const dm = api()
    for (let i = 0; i < 12; i++) await dm.messages(message({ content: 'hello' }))
    await expectError(await dm.messages(message({ content: 'hello' })), 403, 'project_disabled')
  })
})

describe('messages: invalid_request', () => {
  const cases: [string, string][] = [
    ['a body that is not JSON', 'not json'],
    ['an empty body', ''],
    ['JSON null', 'null'],
    ['a JSON string', '"hello"'],
    ['an array', '["hello"]'],
    ['no content', '{}'],
    ['content that is not a string', '{"content":42}'],
    ['empty content', '{"content":""}'],
    ['content that is only whitespace', '{"content":"  \\n\\t "}'],
    ['an id that is not a string', '{"content":"hi","id":7}'],
    ['an empty id', '{"content":"hi","id":""}'],
    ['an id over 64 characters', JSON.stringify({ content: 'hi', id: 'i'.repeat(65) })],
    ['a null id', '{"content":"hi","id":null}'],
  ]

  it.each(cases)('is 400 for %s', async (_, body) => {
    const res = await api().messages(request('messages', { body }))
    await expectError(res, 400, 'invalid_request')
    expect(bot.sendMessage).not.toHaveBeenCalled()
  })

  it('does not use up a message from the limit', async () => {
    const dm = api()
    for (let i = 0; i < 5; i++) await dm.messages(request('messages', { body: '{}' }))
    expect((await dm.messages(message({ content: 'hello' }))).status).toBe(200)
  })
})

describe('messages: too_large', () => {
  it('is 413 for content over the maximum', async () => {
    const res = await api().messages(message({ content: 'x'.repeat(MAX_CONTENT + 1) }))
    await expectError(res, 413, 'too_large')
    expect(bot.sendMessage).not.toHaveBeenCalled()
  })

  it('is 413 when Content-Length is over 16 KiB, without reading the body', async () => {
    const req = request('messages', {
      body: JSON.stringify({ content: 'hello' }),
      headers: { 'Content-Length': String(16 * 1024 + 1) },
    })
    const res = await api().messages(req)
    await expectError(res, 413, 'too_large')
    expect(req.bodyUsed).toBe(false)
  })

  it('is 413 for a body over 16 KiB that gives no length', async () => {
    const body = JSON.stringify({ content: 'hello', padding: 'p'.repeat(16 * 1024) })
    const res = await api().messages(request('messages', { body }))
    await expectError(res, 413, 'too_large')
  })

  it('counts the body in bytes, not characters', async () => {
    // Under 16 Ki characters, but 3 bytes each: over 16 KiB once encoded.
    const body = JSON.stringify({ content: 'hi', padding: '€'.repeat(5500) })
    const res = await api().messages(request('messages', { body }))
    await expectError(res, 413, 'too_large')
  })
})

describe('messages: rate_limited', () => {
  it('is 429 with Retry-After once the burst is used', async () => {
    const dm = api()
    for (let i = 0; i < 3; i++)
      expect((await dm.messages(message({ content: 'hi' }))).status).toBe(200)
    const res = await dm.messages(message({ content: 'hi' }))
    expect(res.headers.get('Retry-After')).toBe('10')
    await expectError(res, 429, 'rate_limited')
    expect(bot.sendMessage).toHaveBeenCalledTimes(3)
  })

  it('passes on a Discord 429, rounding retry_after up', async () => {
    bot.sendMessage.mockRejectedValue(discordError(429, null, 2.3))
    const res = await api().messages(message({ content: 'hi' }))
    expect(res.headers.get('Retry-After')).toBe('3')
    await expectError(res, 429, 'rate_limited')
  })

  it('waits at least one second after a Discord 429 that gives no time', async () => {
    bot.sendMessage.mockRejectedValue(discordError(429, null, null))
    const res = await api().messages(message({ content: 'hi' }))
    expect(res.headers.get('Retry-After')).toBe('1')
    await expectError(res, 429, 'rate_limited')
  })

  it('sends no Retry-After on other errors', async () => {
    const res = await api().messages(message({ content: 'hi' }, { auth: null }))
    expect(res.headers.get('Retry-After')).toBeNull()
  })
})

describe('messages: Discord failures', () => {
  it('is dm_closed (409) when Discord refuses the DM (50007)', async () => {
    bot.sendMessage.mockRejectedValue(discordError(403, CANNOT_DM_USER))
    const res = await api().messages(message({ content: 'hi' }))
    await expectError(res, 409, 'dm_closed')
    expect(touchCode).not.toHaveBeenCalled()
  })

  it('is dm_closed when opening the DM is refused', async () => {
    withOwner(owner({ dmChannelId: null }))
    bot.openDm.mockRejectedValue(discordError(403, CANNOT_DM_USER))
    const res = await api().messages(message({ content: 'hi' }))
    await expectError(res, 409, 'dm_closed')
  })

  it('is discord_unavailable (502) for another Discord error', async () => {
    bot.sendMessage.mockRejectedValue(discordError(500, null))
    const res = await api().messages(message({ content: 'hi' }))
    await expectError(res, 502, 'discord_unavailable')
    expect(touchCode).not.toHaveBeenCalled()
  })

  it('is discord_unavailable when the call fails outright', async () => {
    bot.sendMessage.mockRejectedValue(new TypeError('fetch failed'))
    const res = await api().messages(message({ content: 'hi' }))
    await expectError(res, 502, 'discord_unavailable')
  })
})

describe('messages: server_error', () => {
  it('is 500 when looking up the code throws', async () => {
    findByCode.mockRejectedValue(new Error('db down'))
    const res = await api().messages(message({ content: 'hi' }))
    await expectError(res, 500, 'server_error')
  })
})

describe('messages: logging', () => {
  it('never logs the code or the message text', async () => {
    const lines: string[] = []
    const record = (fields: Record<string, unknown>, msg: string) => {
      lines.push(JSON.stringify({ fields, msg }))
    }
    const dm = createDmApi({
      findByCode,
      touchCode,
      setDmChannel,
      bot,
      limiter,
      log: { info: record, warn: record, error: record },
      clientIpHeader,
    })
    await dm.messages(message({ content: 'secret text' }))
    await dm.messages(message({ content: 'secret text' }, { auth: `Bearer ${newCode()}` }))
    bot.sendMessage.mockRejectedValue(discordError(500, null))
    await dm.messages(message({ content: 'secret text' }))
    expect(lines.length).toBeGreaterThan(0)
    for (const line of lines) {
      expect(line).not.toContain('secret text')
      expect(line).not.toContain('dgc_')
    }
  })
})

describe('test', () => {
  it('sends the fixed test message with no nonce', async () => {
    const res = await api().test(request('test'))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, project: 'hindsight', discordName: 'Destiny' })
    const [channel, content, options] = bot.sendMessage.mock.calls[0]!
    expect(channel).toBe('channel-cached')
    expect(content).toBe(testMessage('Hindsight'))
    expect(options?.nonce).toBeUndefined()
  })

  it('needs a valid code', async () => {
    await expectError(await api().test(request('test', { auth: null })), 401, 'invalid_code')
  })

  it('refuses a project that may not DM', async () => {
    withOwner(owner({ project: { canDm: false } }))
    await expectError(await api().test(request('test')), 403, 'dm_not_allowed')
  })

  it('allows five tests an hour', async () => {
    const dm = api()
    for (let i = 0; i < 5; i++) expect((await dm.test(request('test'))).status).toBe(200)
    const res = await dm.test(request('test'))
    expect(Number(res.headers.get('Retry-After'))).toBeGreaterThan(0)
    await expectError(res, 429, 'rate_limited')
  })

  it('reports dm_closed like a message does', async () => {
    bot.sendMessage.mockRejectedValue(discordError(403, CANNOT_DM_USER))
    await expectError(await api().test(request('test')), 409, 'dm_closed')
  })
})
