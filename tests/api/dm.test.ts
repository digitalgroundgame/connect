import { randomUUID } from 'node:crypto'
import { format } from 'node:util'
import { RESTJSONErrorCodes } from 'discord-api-types/v10'
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type MockInstance,
} from 'vitest'
import { POST as postMessage } from '@/app/api/v1/messages/route'
import { POST as postTest } from '@/app/api/v1/test/route'
import { messageNonce, newCode } from '@/lib/codes'
import { DiscordAPIError, RateLimitError, openDm, sendMessage } from '@/lib/discord'
import { MAX_CONTENT, testMessage, withFooter } from '@/lib/dm'
import { findByCode, setDmChannel, touchCode, type CodeOwner } from '@/services/codes'
import type { Project } from '@/services/projects'

vi.mock('@/services/codes', () => ({
  findByCode: vi.fn(),
  touchCode: vi.fn(),
  setDmChannel: vi.fn(),
}))

// Only the calls to Discord are faked; the error classes stay real.
vi.mock('@/lib/discord', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/discord')>()),
  isGuildMember: vi.fn(),
  openDm: vi.fn(),
  sendMessage: vi.fn(),
}))

const mocks = {
  findByCode: vi.mocked(findByCode),
  touchCode: vi.mocked(touchCode),
  setDmChannel: vi.mocked(setDmChannel),
  openDm: vi.mocked(openDm),
  sendMessage: vi.mocked(sendMessage),
}

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

/** The rate limits are real and module-level, so every test gets its own code id. */
let codeId: string

function owner(overrides: { dmChannelId?: string | null; project?: Partial<Project> } = {}) {
  return {
    codeId,
    user: {
      id: 'user-1',
      name: 'Destiny',
      discordId: 'discord-1',
      dmChannelId: overrides.dmChannelId === undefined ? 'channel-cached' : overrides.dmChannelId,
    },
    project: project(overrides.project),
  } satisfies CodeOwner
}

/** An error as @discordjs/rest throws it for a failed send, request body included. */
function discordError(code: number, status: number, content = 'hello'): DiscordAPIError {
  return new DiscordAPIError(
    { code, message: `discord error ${code}` },
    code,
    status,
    'POST',
    'https://discord.com/api/v10/channels/channel-cached/messages',
    { body: { content, allowed_mentions: { parse: [] } } },
  )
}

function rateLimitError(retryAfterMs: number): RateLimitError {
  return new RateLimitError({
    timeToReset: retryAfterMs,
    limit: 5,
    method: 'POST',
    hash: 'hash',
    url: 'https://discord.com/api/v10/channels/channel-cached/messages',
    route: '/channels/:id/messages',
    majorParameter: 'channel-cached',
    global: false,
    retryAfter: retryAfterMs,
    sublimitTimeout: 0,
    scope: 'user',
  })
}

let code: string
let codes: Map<string, CodeOwner>

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
  const body = (await res.json()) as Record<string, unknown>
  expect(Object.keys(body).sort()).toEqual(['error', 'message', 'ok'])
  expect(body.ok).toBe(false)
  expect(body.error).toBe(error)
  expect(typeof body.message).toBe('string')
  expect(body.message).not.toBe('')
}

/** The options sendMessage was given on its nth call. */
function sendOptions(n: number) {
  return mocks.sendMessage.mock.calls[n]![2]
}

/**
 * The shared limits (20 DMs a second, failed codes per IP for 10 minutes)
 * would carry over between tests, so one fake clock runs through the file and
 * jumps on 11 minutes before each test. The limiter forgets a key on a
 * setTimeout, so that is faked along with Date. The delivery deadline
 * (AbortSignal.timeout) runs on Node's own timers and is not affected.
 */
beforeAll(() => {
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'], now: Date.UTC(2026, 0, 1) })
})

afterAll(() => {
  vi.useRealTimers()
})

let consoleSpies: MockInstance[]

beforeEach(() => {
  vi.advanceTimersByTime(11 * 60 * 1000)
  delete process.env.CLIENT_IP_HEADER
  consoleSpies = (['info', 'warn', 'error'] as const).map((level) =>
    vi.spyOn(console, level).mockImplementation(() => {}),
  )

  codeId = randomUUID()
  code = newCode()
  codes = new Map()
  withOwner(owner())
  mocks.findByCode.mockReset().mockImplementation(async (c) => codes.get(c) ?? null)
  mocks.touchCode.mockReset().mockResolvedValue()
  mocks.setDmChannel.mockReset().mockResolvedValue()
  mocks.openDm.mockReset().mockResolvedValue('channel-new')
  mocks.sendMessage.mockReset().mockResolvedValue()
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('messages: success', () => {
  it('returns ok with the project slug and Discord name', async () => {
    const res = await postMessage(message({ content: 'hello' }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, project: 'hindsight', discordName: 'Destiny' })
  })

  it('sends the content with a footer naming the project', async () => {
    await postMessage(message({ content: 'hello' }))
    expect(mocks.sendMessage).toHaveBeenCalledTimes(1)
    const [channel, content] = mocks.sendMessage.mock.calls[0]!
    expect(channel).toBe('channel-cached')
    expect(content).toBe('hello\n\n-# Sent by Hindsight through Digital Ground Game Connect.')
    expect(content).toBe(withFooter('hello', 'Hindsight'))
  })

  it('trims the content before sending it', async () => {
    await postMessage(message({ content: '  hello \n' }))
    expect(mocks.sendMessage.mock.calls[0]![1]).toBe(withFooter('hello', 'Hindsight'))
  })

  it('gives the send a deadline', async () => {
    await postMessage(message({ content: 'hello' }))
    expect(sendOptions(0)?.signal).toBeInstanceOf(AbortSignal)
  })

  it('uses the cached DM channel without opening one', async () => {
    await postMessage(message({ content: 'hello' }))
    expect(mocks.openDm).not.toHaveBeenCalled()
    expect(mocks.setDmChannel).not.toHaveBeenCalled()
  })

  it('opens and saves a DM channel when none is cached', async () => {
    withOwner(owner({ dmChannelId: null }))
    const res = await postMessage(message({ content: 'hello' }))
    expect(res.status).toBe(200)
    expect(mocks.openDm).toHaveBeenCalledTimes(1)
    expect(mocks.openDm.mock.calls[0]![0]).toBe('discord-1')
    expect(mocks.setDmChannel).toHaveBeenCalledWith('user-1', 'channel-new')
    expect(mocks.sendMessage.mock.calls[0]![0]).toBe('channel-new')
  })

  it('records the code as used', async () => {
    await postMessage(message({ content: 'hello' }))
    expect(mocks.touchCode).toHaveBeenCalledWith(codeId)
  })

  it('still succeeds when saving last-used fails', async () => {
    mocks.touchCode.mockRejectedValue(new Error('db down'))
    const res = await postMessage(message({ content: 'hello' }))
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true })
  })

  it('still succeeds when saving the DM channel fails', async () => {
    withOwner(owner({ dmChannelId: null }))
    mocks.setDmChannel.mockRejectedValue(new Error('db down'))
    const res = await postMessage(message({ content: 'hello' }))
    expect(res.status).toBe(200)
    expect(mocks.sendMessage).toHaveBeenCalledTimes(1)
  })

  it('accepts content of exactly the maximum length', async () => {
    expect(MAX_CONTENT).toBe(1800)
    const res = await postMessage(message({ content: 'x'.repeat(1800) }))
    expect(res.status).toBe(200)
  })
})

describe('messages: cached DM channel gone (10003)', () => {
  const unknownChannel = () => discordError(RESTJSONErrorCodes.UnknownChannel, 404)

  it('reopens the channel once, saves it, and sends there', async () => {
    mocks.sendMessage.mockRejectedValueOnce(unknownChannel())
    const res = await postMessage(message({ content: 'hello' }))
    expect(res.status).toBe(200)
    expect(mocks.openDm).toHaveBeenCalledTimes(1)
    expect(mocks.setDmChannel).toHaveBeenCalledWith('user-1', 'channel-new')
    expect(mocks.sendMessage.mock.calls.map((c) => c[0])).toEqual(['channel-cached', 'channel-new'])
  })

  it('sends the same content and nonce on the retry', async () => {
    mocks.sendMessage.mockRejectedValueOnce(unknownChannel())
    await postMessage(message({ content: 'hello', id: 'm1' }))
    const [first, second] = mocks.sendMessage.mock.calls
    expect(second![1]).toBe(first![1])
    expect(second![2]?.nonce).toBeDefined()
    expect(second![2]?.nonce).toBe(first![2]?.nonce)
  })

  it('does not reopen a second time', async () => {
    mocks.sendMessage.mockRejectedValue(unknownChannel())
    const res = await postMessage(message({ content: 'hello' }))
    await expectError(res, 502, 'discord_unavailable')
    expect(mocks.openDm).toHaveBeenCalledTimes(1)
    expect(mocks.sendMessage).toHaveBeenCalledTimes(2)
  })

  it('does not retry when the channel was just opened', async () => {
    withOwner(owner({ dmChannelId: null }))
    mocks.sendMessage.mockRejectedValue(unknownChannel())
    const res = await postMessage(message({ content: 'hello' }))
    await expectError(res, 502, 'discord_unavailable')
    expect(mocks.openDm).toHaveBeenCalledTimes(1)
    expect(mocks.sendMessage).toHaveBeenCalledTimes(1)
  })

  it('reopens only for a DiscordAPIError, not another error with that code', async () => {
    mocks.sendMessage.mockRejectedValueOnce(
      Object.assign(new Error('unknown channel'), { code: RESTJSONErrorCodes.UnknownChannel }),
    )
    const res = await postMessage(message({ content: 'hello' }))
    await expectError(res, 502, 'discord_unavailable')
    expect(mocks.openDm).not.toHaveBeenCalled()
  })
})

describe('messages: id and nonce', () => {
  it('sends a nonce derived from the code id, message id and content', async () => {
    await postMessage(message({ content: 'hello', id: 'm1' }))
    expect(sendOptions(0)?.nonce).toBe(messageNonce(codeId, 'm1', 'hello'))
  })

  it('sends the same nonce when the tool retries', async () => {
    await postMessage(message({ content: 'hello', id: 'm1' }))
    await postMessage(message({ content: 'hello', id: 'm1' }))
    expect(sendOptions(0)?.nonce).toBeDefined()
    expect(sendOptions(1)?.nonce).toBe(sendOptions(0)?.nonce)
  })

  it('sends a different nonce for a different id', async () => {
    await postMessage(message({ content: 'hello', id: 'm1' }))
    await postMessage(message({ content: 'hello', id: 'm2' }))
    expect(sendOptions(1)?.nonce).not.toBe(sendOptions(0)?.nonce)
  })

  it('sends no nonce without an id', async () => {
    await postMessage(message({ content: 'hello' }))
    expect(sendOptions(0)?.nonce).toBeUndefined()
  })

  it('accepts an id of 64 characters', async () => {
    const res = await postMessage(message({ content: 'hello', id: 'i'.repeat(64) }))
    expect(res.status).toBe(200)
  })
})

describe('messages: invalid_code', () => {
  it('is 401 without an Authorization header', async () => {
    const res = await postMessage(message({ content: 'hello' }, { auth: null }))
    await expectError(res, 401, 'invalid_code')
    expect(mocks.findByCode).not.toHaveBeenCalled()
  })

  it('is 401 for a header that is not a code, without a lookup', async () => {
    const res = await postMessage(message({ content: 'hello' }, { auth: 'Bearer nonsense' }))
    await expectError(res, 401, 'invalid_code')
    expect(mocks.findByCode).not.toHaveBeenCalled()
  })

  it('is 401 for a well-formed code nobody holds', async () => {
    const res = await postMessage(message({ content: 'hello' }, { auth: `Bearer ${newCode()}` }))
    await expectError(res, 401, 'invalid_code')
    expect(mocks.findByCode).toHaveBeenCalledTimes(1)
  })

  it('sends nothing', async () => {
    await postMessage(message({ content: 'hello' }, { auth: null }))
    expect(mocks.sendMessage).not.toHaveBeenCalled()
  })

  it('checks the code before reading the body', async () => {
    const req = request('messages', { auth: null, body: 'not json' })
    const res = await postMessage(req)
    await expectError(res, 401, 'invalid_code')
    expect(req.bodyUsed).toBe(false)
  })

  it('checks the code before the body size', async () => {
    const res = await postMessage(
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
  function failFrom(ip?: string) {
    return postMessage(
      message(
        { content: 'hello' },
        { auth: 'Bearer junk', headers: ip === undefined ? {} : { 'CF-Connecting-IP': ip } },
      ),
    )
  }

  it('refuses even a valid code from that IP after ten failures, with Retry-After', async () => {
    vi.stubEnv('CLIENT_IP_HEADER', 'CF-Connecting-IP')
    const ip = randomUUID()
    for (let i = 0; i < 10; i++) await expectError(await failFrom(ip), 401, 'invalid_code')
    const res = await postMessage(
      message({ content: 'hello' }, { headers: { 'CF-Connecting-IP': ip } }),
    )
    const retryAfter = Number(res.headers.get('Retry-After'))
    expect(retryAfter).toBeGreaterThan(0)
    expect(retryAfter).toBeLessThanOrEqual(10 * 60)
    await expectError(res, 429, 'rate_limited')
    expect(mocks.findByCode).not.toHaveBeenCalled()
  })

  it('limits nobody when no IP header is configured, so one client cannot lock out all', async () => {
    for (let i = 0; i < 12; i++) await expectError(await failFrom(), 401, 'invalid_code')
    expect((await postMessage(message({ content: 'hello' }))).status).toBe(200)
  })

  it('limits nobody whose request lacks the configured header', async () => {
    vi.stubEnv('CLIENT_IP_HEADER', 'CF-Connecting-IP')
    for (let i = 0; i < 12; i++) await expectError(await failFrom(), 401, 'invalid_code')
    expect((await postMessage(message({ content: 'hello' }))).status).toBe(200)
  })

  it('counts each client IP apart when a header is configured', async () => {
    vi.stubEnv('CLIENT_IP_HEADER', 'CF-Connecting-IP')
    // Fresh keys, since the limiter outlives each test.
    const [a, b] = [`a-${randomUUID()}`, `b-${randomUUID()}`]
    for (let i = 0; i < 10; i++) await expectError(await failFrom(a), 401, 'invalid_code')
    await expectError(await failFrom(a), 429, 'rate_limited')
    await expectError(await failFrom(b), 401, 'invalid_code')
  })

  it('reads the header setting on each request', async () => {
    const ip = randomUUID()
    for (let i = 0; i < 10; i++) await failFrom(ip)
    // Unset: the header is ignored, so nothing was counted.
    vi.stubEnv('CLIENT_IP_HEADER', 'cf-connecting-ip')
    for (let i = 0; i < 10; i++) await expectError(await failFrom(ip), 401, 'invalid_code')
    await expectError(await failFrom(ip), 429, 'rate_limited')
  })

  it('does not count successful requests', async () => {
    vi.stubEnv('CLIENT_IP_HEADER', 'CF-Connecting-IP')
    const ip = randomUUID()
    for (let i = 0; i < 9; i++) await failFrom(ip)
    // The valid request passes and adds no failure, so one more failure is still a 401.
    const ok = message({ content: 'hello' }, { headers: { 'CF-Connecting-IP': ip } })
    expect((await postMessage(ok)).status).toBe(200)
    await expectError(await failFrom(ip), 401, 'invalid_code')
  })
})

describe('messages: project checks', () => {
  it('is project_disabled (403) for a disabled project', async () => {
    withOwner(owner({ project: { enabled: false } }))
    const res = await postMessage(message({ content: 'hello' }))
    await expectError(res, 403, 'project_disabled')
    expect(mocks.sendMessage).not.toHaveBeenCalled()
  })

  it('is dm_not_allowed (403) for a project that may not DM', async () => {
    withOwner(owner({ project: { canDm: false } }))
    const res = await postMessage(message({ content: 'hello' }))
    await expectError(res, 403, 'dm_not_allowed')
    expect(mocks.sendMessage).not.toHaveBeenCalled()
  })

  it('does not count these as failed codes', async () => {
    withOwner(owner({ project: { enabled: false } }))
    for (let i = 0; i < 12; i++) await postMessage(message({ content: 'hello' }))
    await expectError(await postMessage(message({ content: 'hello' })), 403, 'project_disabled')
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
    const res = await postMessage(request('messages', { body }))
    await expectError(res, 400, 'invalid_request')
    expect(mocks.sendMessage).not.toHaveBeenCalled()
  })

  it('does not use up a message from the limit', async () => {
    for (let i = 0; i < 5; i++) await postMessage(request('messages', { body: '{}' }))
    expect((await postMessage(message({ content: 'hello' }))).status).toBe(200)
  })
})

describe('messages: too_large', () => {
  it('is 413 for content over the maximum', async () => {
    const res = await postMessage(message({ content: 'x'.repeat(1801) }))
    await expectError(res, 413, 'too_large')
    expect(mocks.sendMessage).not.toHaveBeenCalled()
  })

  it('is 413 when Content-Length is over 16 KiB, without reading the body', async () => {
    const req = request('messages', {
      body: JSON.stringify({ content: 'hello' }),
      headers: { 'Content-Length': String(16 * 1024 + 1) },
    })
    const res = await postMessage(req)
    await expectError(res, 413, 'too_large')
    expect(req.bodyUsed).toBe(false)
  })

  it('is 413 for a body over 16 KiB that gives no length', async () => {
    const body = JSON.stringify({ content: 'hello', padding: 'p'.repeat(16 * 1024) })
    const res = await postMessage(request('messages', { body }))
    await expectError(res, 413, 'too_large')
  })

  it('counts the body in bytes, not characters', async () => {
    // Under 16 Ki characters, but 3 bytes each: over 16 KiB once encoded.
    const body = JSON.stringify({ content: 'hi', padding: '€'.repeat(5500) })
    const res = await postMessage(request('messages', { body }))
    await expectError(res, 413, 'too_large')
  })

  it('accepts a body of exactly 16 KiB', async () => {
    const base = JSON.stringify({ content: 'hi', padding: '' })
    const body = JSON.stringify({ content: 'hi', padding: 'p'.repeat(16 * 1024 - base.length) })
    expect(Buffer.byteLength(body)).toBe(16 * 1024)
    expect((await postMessage(request('messages', { body }))).status).toBe(200)
  })
})

describe('messages: rate_limited', () => {
  it('is 429 with Retry-After once the burst is used', async () => {
    for (let i = 0; i < 3; i++) {
      expect((await postMessage(message({ content: 'hi' }))).status).toBe(200)
    }
    const res = await postMessage(message({ content: 'hi' }))
    const retryAfter = Number(res.headers.get('Retry-After'))
    expect(retryAfter).toBeGreaterThan(0)
    expect(retryAfter).toBeLessThanOrEqual(10)
    await expectError(res, 429, 'rate_limited')
    expect(mocks.sendMessage).toHaveBeenCalledTimes(3)
  })

  it('passes on a Discord rate limit, rounding its wait up to seconds', async () => {
    mocks.sendMessage.mockRejectedValue(rateLimitError(2300))
    const res = await postMessage(message({ content: 'hi' }))
    expect(res.headers.get('Retry-After')).toBe('3')
    await expectError(res, 429, 'rate_limited')
    expect(mocks.touchCode).not.toHaveBeenCalled()
  })

  it('waits at least one second after a Discord rate limit that gives no time', async () => {
    mocks.sendMessage.mockRejectedValue(rateLimitError(0))
    const res = await postMessage(message({ content: 'hi' }))
    expect(res.headers.get('Retry-After')).toBe('1')
    await expectError(res, 429, 'rate_limited')
  })

  it('sends no Retry-After on other errors', async () => {
    const res = await postMessage(message({ content: 'hi' }, { auth: null }))
    expect(res.headers.get('Retry-After')).toBeNull()
  })
})

describe('messages: Discord failures', () => {
  const cannotDm = () => discordError(RESTJSONErrorCodes.CannotSendMessagesToThisUser, 403)

  it('is dm_closed (409) when Discord refuses the DM (50007)', async () => {
    mocks.sendMessage.mockRejectedValue(cannotDm())
    const res = await postMessage(message({ content: 'hi' }))
    await expectError(res, 409, 'dm_closed')
    expect(mocks.touchCode).not.toHaveBeenCalled()
  })

  it('is dm_closed when opening the DM is refused', async () => {
    withOwner(owner({ dmChannelId: null }))
    mocks.openDm.mockRejectedValue(cannotDm())
    const res = await postMessage(message({ content: 'hi' }))
    await expectError(res, 409, 'dm_closed')
  })

  it('is discord_unavailable (502) for another Discord error', async () => {
    mocks.sendMessage.mockRejectedValue(discordError(RESTJSONErrorCodes.GeneralError, 500))
    const res = await postMessage(message({ content: 'hi' }))
    await expectError(res, 502, 'discord_unavailable')
    expect(mocks.touchCode).not.toHaveBeenCalled()
  })

  it('is discord_unavailable when the call fails outright', async () => {
    mocks.sendMessage.mockRejectedValue(new TypeError('fetch failed'))
    const res = await postMessage(message({ content: 'hi' }))
    await expectError(res, 502, 'discord_unavailable')
  })
})

describe('messages: server_error', () => {
  it('is 500 when looking up the code throws', async () => {
    mocks.findByCode.mockRejectedValue(new Error('db down'))
    const res = await postMessage(message({ content: 'hi' }))
    await expectError(res, 500, 'server_error')
  })
})

describe('logging', () => {
  /** Every line written to the console, as the console would print it. */
  function logged(): string[] {
    return consoleSpies.flatMap((spy) => spy.mock.calls.map((args) => format(...args)))
  }

  it('never logs the code or the message text', async () => {
    const secret = 'secret text'
    // A success, a send that fails, and a project with no cached channel whose save fails.
    await postMessage(message({ content: secret }))
    mocks.sendMessage.mockRejectedValueOnce(rateLimitError(1000))
    await postMessage(message({ content: secret, id: 'm1' }))
    mocks.sendMessage.mockRejectedValueOnce(
      discordError(RESTJSONErrorCodes.CannotSendMessagesToThisUser, 403, secret),
    )
    await postMessage(message({ content: secret }))
    mocks.sendMessage.mockRejectedValueOnce(
      discordError(RESTJSONErrorCodes.GeneralError, 500, secret),
    )
    vi.advanceTimersByTime(10_000)
    await postMessage(message({ content: secret }))
    mocks.touchCode.mockRejectedValueOnce(new Error('db down'))
    await postMessage(message({ content: secret }))
    // A wrong code, and a lookup that throws.
    await postMessage(message({ content: secret }, { auth: `Bearer ${newCode()}` }))
    mocks.findByCode.mockRejectedValueOnce(new Error('db down'))
    await postMessage(message({ content: secret }))

    const lines = logged()
    expect(lines.length).toBeGreaterThanOrEqual(7)
    for (const line of lines) {
      expect(line).not.toContain(secret)
      expect(line).not.toContain('dgc_')
    }
  })

  it('logs a sent DM with who and which project, through console.info', async () => {
    await postMessage(message({ content: 'hello' }))
    expect(console.info).toHaveBeenCalledWith(
      'dm sent',
      expect.objectContaining({ userId: 'user-1', project: 'hindsight', kind: 'message' }),
    )
  })
})

describe('test', () => {
  it('sends the fixed test message with no nonce', async () => {
    const res = await postTest(request('test'))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, project: 'hindsight', discordName: 'Destiny' })
    const [channel, content, options] = mocks.sendMessage.mock.calls[0]!
    expect(channel).toBe('channel-cached')
    expect(content).toBe(testMessage('Hindsight'))
    expect(content).toBe(
      'Hindsight is linked to this Discord account. Its messages will arrive here.\n\n-# Test message from Digital Ground Game Connect.',
    )
    expect(options?.nonce).toBeUndefined()
  })

  it('ignores any body', async () => {
    const res = await postTest(request('test', { body: 'not json' }))
    expect(res.status).toBe(200)
  })

  it('needs a valid code', async () => {
    await expectError(await postTest(request('test', { auth: null })), 401, 'invalid_code')
  })

  it('refuses a disabled project', async () => {
    withOwner(owner({ project: { enabled: false } }))
    await expectError(await postTest(request('test')), 403, 'project_disabled')
  })

  it('refuses a project that may not DM', async () => {
    withOwner(owner({ project: { canDm: false } }))
    await expectError(await postTest(request('test')), 403, 'dm_not_allowed')
  })

  it('allows five tests an hour', async () => {
    for (let i = 0; i < 5; i++) expect((await postTest(request('test'))).status).toBe(200)
    const res = await postTest(request('test'))
    expect(Number(res.headers.get('Retry-After'))).toBeGreaterThan(0)
    await expectError(res, 429, 'rate_limited')
    expect(mocks.sendMessage).toHaveBeenCalledTimes(5)
  })

  it('counts tests apart from messages', async () => {
    for (let i = 0; i < 3; i++) await postMessage(message({ content: 'hi' }))
    expect((await postMessage(message({ content: 'hi' }))).status).toBe(429)
    expect((await postTest(request('test'))).status).toBe(200)
  })

  it('reports dm_closed like a message does', async () => {
    mocks.sendMessage.mockRejectedValue(
      discordError(RESTJSONErrorCodes.CannotSendMessagesToThisUser, 403),
    )
    await expectError(await postTest(request('test')), 409, 'dm_closed')
  })

  it('reopens a stale cached channel like a message does', async () => {
    mocks.sendMessage.mockRejectedValueOnce(discordError(RESTJSONErrorCodes.UnknownChannel, 404))
    expect((await postTest(request('test'))).status).toBe(200)
    expect(mocks.setDmChannel).toHaveBeenCalledWith('user-1', 'channel-new')
  })
})
