import { codeFromHeader, messageNonce } from '@/lib/codes'
import { clientKey } from '@/lib/client-ip'
import { CANNOT_DM_USER, DiscordError, UNKNOWN_CHANNEL, type DiscordBot } from '@/lib/discord'
import type { DmLimiter, Verdict } from '@/lib/limits'
import type { Logger } from '@/lib/log'
import type { CodeOwner } from '@/services/codes'

/**
 * The API tools call with a member's code: `Authorization: Bearer <code>`.
 * Written against the web Request and Response so it runs the same in a
 * Next.js route and in tests.
 */

/** Discord allows 2000 characters; the rest is the footer naming the tool. */
export const MAX_CONTENT = 1800
const MAX_BODY_BYTES = 16 * 1024
/** The whole delivery, so a tool's own timeout can sit comfortably above it. */
const DELIVERY_DEADLINE_MS = 12_000

export type ErrorCode =
  | 'invalid_request'
  | 'invalid_code'
  | 'project_disabled'
  | 'dm_not_allowed'
  | 'dm_closed'
  | 'too_large'
  | 'rate_limited'
  | 'discord_unavailable'
  | 'server_error'

const STATUS: Record<ErrorCode, number> = {
  invalid_request: 400,
  invalid_code: 401,
  project_disabled: 403,
  dm_not_allowed: 403,
  dm_closed: 409,
  too_large: 413,
  rate_limited: 429,
  discord_unavailable: 502,
  server_error: 500,
}

/** Written for the member: tools are expected to show `message` as it is. */
const MESSAGES: Record<ErrorCode, string> = {
  invalid_request: 'The tool sent a request DGG Connect could not read. Update the tool.',
  invalid_code: 'This code is not valid any more. Get a new one from DGG Connect.',
  project_disabled: 'This tool is turned off in DGG Connect right now.',
  dm_not_allowed: 'This tool is not allowed to send Discord messages.',
  dm_closed:
    'The DGG bot cannot DM you. In the DGG Discord server, turn on Privacy Settings > Direct Messages.',
  too_large: 'The message is too long.',
  rate_limited: 'Too many messages. Wait a moment and try again.',
  discord_unavailable: 'Discord did not take the message. Try again in a minute.',
  server_error: 'DGG Connect hit an error. Try again in a minute.',
}

export function errorResponse(error: ErrorCode, retryAfterSeconds?: number): Response {
  return Response.json(
    { ok: false, error, message: MESSAGES[error] },
    {
      status: STATUS[error],
      headers: retryAfterSeconds === undefined ? {} : { 'Retry-After': String(retryAfterSeconds) },
    },
  )
}

export interface DmApiDeps {
  findByCode(code: string): Promise<CodeOwner | null>
  touchCode(codeId: string): Promise<void>
  setDmChannel(userId: string, channelId: string): Promise<void>
  bot: DiscordBot
  limiter: DmLimiter
  log: Logger
  clientIpHeader: string | null
}

export interface MessageInput {
  content: string
  /** The tool's own ID for this message; a retry with the same ID is not sent twice. */
  id: string | null
}

export function parseMessageInput(body: unknown): MessageInput | 'too_large' | null {
  if (typeof body !== 'object' || body === null) return null
  const { content, id } = body as Record<string, unknown>
  if (typeof content !== 'string' || content.trim() === '') return null
  if (id !== undefined && (typeof id !== 'string' || id === '' || id.length > 64)) return null
  if (content.length > MAX_CONTENT) return 'too_large'
  return { content, id: id ?? null }
}

export function withFooter(content: string, projectName: string): string {
  return `${content}\n\n-# Sent by ${projectName} through DGG Connect.`
}

export function testMessage(projectName: string): string {
  return `${projectName} is linked to this Discord account. Its messages will arrive here.\n\n-# Test message from DGG Connect.`
}

export function createDmApi(deps: DmApiDeps) {
  /** The code's owner, or the response that refuses the request. */
  async function authenticate(req: Request): Promise<CodeOwner | Response> {
    const source = clientKey(req.headers, deps.clientIpHeader)
    const allowed = deps.limiter.checkSource(source)
    if (!allowed.ok) return errorResponse('rate_limited', allowed.retryAfterSeconds)
    const code = codeFromHeader(req.headers.get('authorization'))
    const owner = code === null ? null : await deps.findByCode(code)
    if (owner === null) {
      deps.limiter.recordFailure(source)
      deps.log.warn({ source }, 'request with an invalid code')
      return errorResponse('invalid_code')
    }
    if (!owner.project.enabled) return errorResponse('project_disabled')
    if (!owner.project.canDm) return errorResponse('dm_not_allowed')
    return owner
  }

  async function openChannel(owner: CodeOwner, signal: AbortSignal): Promise<string> {
    const channel = await deps.bot.openDm(owner.user.discordId, signal)
    // Only a cache: a failed write costs one extra Discord call next time.
    await deps.setDmChannel(owner.user.id, channel).catch((err: unknown) => {
      deps.log.warn({ userId: owner.user.id, err: (err as Error).message }, 'dm channel not saved')
    })
    return channel
  }

  /** Through the cached DM channel, reopened once if Discord has forgotten it. */
  async function deliver(owner: CodeOwner, content: string, nonce: string | undefined) {
    const signal = AbortSignal.timeout(DELIVERY_DEADLINE_MS)
    const cached = owner.user.dmChannelId
    const channel = cached ?? (await openChannel(owner, signal))
    try {
      await deps.bot.sendMessage(channel, content, { nonce, signal })
    } catch (err) {
      if (!(err instanceof DiscordError && err.code === UNKNOWN_CHANNEL && cached !== null)) {
        throw err
      }
      await deps.bot.sendMessage(await openChannel(owner, signal), content, { nonce, signal })
    }
  }

  async function send(
    owner: CodeOwner,
    verdict: Verdict,
    content: string,
    nonce: string | undefined,
    kind: 'message' | 'test',
  ): Promise<Response> {
    const who = { userId: owner.user.id, project: owner.project.slug, kind }
    if (!verdict.ok) {
      deps.log.info(who, 'rate limited')
      return errorResponse('rate_limited', verdict.retryAfterSeconds)
    }
    const started = Date.now()
    try {
      await deliver(owner, content, nonce)
    } catch (err) {
      const fields = { ...who, ms: Date.now() - started, err: (err as Error).message }
      if (err instanceof DiscordError && err.code === CANNOT_DM_USER) {
        deps.log.info(fields, 'dm refused by discord')
        return errorResponse('dm_closed')
      }
      if (err instanceof DiscordError && err.status === 429) {
        deps.log.warn(fields, 'rate limited by discord')
        return errorResponse('rate_limited', Math.max(1, Math.ceil(err.retryAfter ?? 1)))
      }
      deps.log.error(fields, 'dm failed')
      return errorResponse('discord_unavailable')
    }
    // The DM is already out; a failed bookkeeping write must not report failure.
    await deps.touchCode(owner.codeId).catch((err: unknown) => {
      deps.log.warn({ ...who, err: (err as Error).message }, 'last-used not saved')
    })
    deps.log.info({ ...who, ms: Date.now() - started }, 'dm sent')
    return Response.json({ ok: true, project: owner.project.slug, discordName: owner.user.name })
  }

  /** Refuses oversized bodies before reading them, then parses JSON. */
  async function readJson(req: Request): Promise<unknown | 'too_large'> {
    const length = Number(req.headers.get('content-length'))
    if (Number.isFinite(length) && length > MAX_BODY_BYTES) return 'too_large'
    const text = await req.text()
    if (Buffer.byteLength(text) > MAX_BODY_BYTES) return 'too_large'
    try {
      return JSON.parse(text) as unknown
    } catch {
      return null
    }
  }

  async function guarded(run: () => Promise<Response>): Promise<Response> {
    try {
      return await run()
    } catch (err) {
      deps.log.error({ err: (err as Error).message }, 'request failed')
      return errorResponse('server_error')
    }
  }

  return {
    /** Sends a fixed test DM, so the member can check the whole path. */
    test(req: Request): Promise<Response> {
      return guarded(async () => {
        const owner = await authenticate(req)
        if (owner instanceof Response) return owner
        // No nonce: pressing Test twice should show two DMs.
        const verdict = deps.limiter.takeTest(owner.codeId)
        return send(owner, verdict, testMessage(owner.project.name), undefined, 'test')
      })
    },

    /** Sends the tool's text to its member, with a footer naming the tool. */
    messages(req: Request): Promise<Response> {
      return guarded(async () => {
        // The code is checked before the body is read, so a caller without
        // one learns only that, and costs no parsing.
        const owner = await authenticate(req)
        if (owner instanceof Response) return owner
        const body = await readJson(req)
        const input = body === 'too_large' ? 'too_large' : parseMessageInput(body)
        if (input === 'too_large') return errorResponse('too_large')
        if (input === null) return errorResponse('invalid_request')
        const nonce =
          input.id === null ? undefined : messageNonce(owner.codeId, input.id, input.content)
        const verdict = deps.limiter.takeMessage(owner.codeId)
        return send(owner, verdict, withFooter(input.content, owner.project.name), nonce, 'message')
      })
    },
  }
}

export type DmApi = ReturnType<typeof createDmApi>
