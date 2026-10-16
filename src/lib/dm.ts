import 'server-only'
import { RESTJSONErrorCodes } from 'discord-api-types/v10'
import { z } from 'zod'
import { codeFromHeader } from '@/lib/codes'
import { clientKey } from '@/lib/client-ip'
import { DiscordAPIError, RateLimitError, openDm, sendMessage } from '@/lib/discord'
import { checkSource, recordFailure, type Limit } from '@/lib/rate-limits'
import { findByCode, setDmChannel, touchCode, type CodeOwner } from '@/services/codes'

/**
 * Shared by the /api/v1 routes, which tools call with a member's code:
 * `Authorization: Bearer <code>`.
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

export const messageSchema = z.object({
  content: z.string().trim().min(1).max(MAX_CONTENT),
  /** The tool's own ID for this message; a retry with the same ID is not sent twice. */
  id: z.string().min(1).max(64).optional(),
})

/**
 * The body as text, or null once it passes the size cap. Read in chunks, so a
 * body with no Content-Length (chunked) cannot be buffered whole first.
 */
async function readCapped(req: Request): Promise<string | null> {
  const length = Number(req.headers.get('content-length'))
  if (Number.isFinite(length) && length > MAX_BODY_BYTES) return null
  if (req.body === null) return ''
  const chunks: Uint8Array[] = []
  let size = 0
  for await (const chunk of req.body) {
    size += chunk.byteLength
    if (size > MAX_BODY_BYTES) return null
    chunks.push(chunk)
  }
  return Buffer.concat(chunks).toString('utf8')
}

/** The message body, or the error to answer with. */
export async function readMessage(
  req: Request,
): Promise<z.infer<typeof messageSchema> | ErrorCode> {
  const text = await readCapped(req)
  if (text === null) return 'too_large'
  let body: unknown
  try {
    body = JSON.parse(text)
  } catch {
    return 'invalid_request'
  }
  const parsed = messageSchema.safeParse(body)
  if (parsed.success) return parsed.data
  const tooLong = parsed.error.issues.some((i) => i.code === 'too_big' && i.path[0] === 'content')
  return tooLong ? 'too_large' : 'invalid_request'
}

export function withFooter(content: string, projectName: string): string {
  return `${content}\n\n-# Sent by ${projectName} through DGG Connect.`
}

export function testMessage(projectName: string): string {
  return `${projectName} is linked to this Discord account. Its messages will arrive here.\n\n-# Test message from DGG Connect.`
}

/** Only the message: a Discord error also carries the request body, which holds the DM text. */
function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/** The code's owner, or the response that refuses the request. */
export async function authenticate(req: Request): Promise<CodeOwner | Response> {
  const source = clientKey(req.headers, process.env.CLIENT_IP_HEADER?.toLowerCase() || null)
  if (source !== null) {
    const allowed = await checkSource(source)
    if (!allowed.ok) return errorResponse('rate_limited', allowed.retryAfterSeconds)
  }
  const code = codeFromHeader(req.headers.get('authorization'))
  const owner = code === null ? null : await findByCode(code)
  if (owner === null) {
    if (source !== null) await recordFailure(source)
    console.warn('request with an invalid code', { source })
    return errorResponse('invalid_code')
  }
  if (!owner.project.enabled) return errorResponse('project_disabled')
  if (!owner.project.canDm) return errorResponse('dm_not_allowed')
  return owner
}

async function openChannel(owner: CodeOwner, signal: AbortSignal): Promise<string> {
  const channel = await openDm(owner.user.discordId, signal)
  // Only a cache: a failed write costs one extra Discord call next time.
  await setDmChannel(owner.user.id, channel).catch((err: unknown) => {
    console.warn('dm channel not saved', { userId: owner.user.id, err: describe(err) })
  })
  return channel
}

/** Through the cached DM channel, reopened once if Discord has forgotten it. */
async function deliver(owner: CodeOwner, content: string, nonce: string | undefined) {
  const signal = AbortSignal.timeout(DELIVERY_DEADLINE_MS)
  const cached = owner.user.dmChannelId
  const channel = cached ?? (await openChannel(owner, signal))
  try {
    await sendMessage(channel, content, { nonce, signal })
  } catch (err) {
    const stale =
      err instanceof DiscordAPIError &&
      err.code === RESTJSONErrorCodes.UnknownChannel &&
      cached !== null
    if (!stale) throw err
    await sendMessage(await openChannel(owner, signal), content, { nonce, signal })
  }
}

/** Sends the DM if the limit allows, and answers the tool. */
export async function send(
  owner: CodeOwner,
  limit: Limit,
  content: string,
  nonce: string | undefined,
  kind: 'message' | 'test',
): Promise<Response> {
  const who = { userId: owner.user.id, project: owner.project.slug, kind }
  if (!limit.ok) {
    console.info('rate limited', who)
    return errorResponse('rate_limited', limit.retryAfterSeconds)
  }
  const started = Date.now()
  try {
    await deliver(owner, content, nonce)
  } catch (err) {
    const fields = { ...who, ms: Date.now() - started, err: describe(err) }
    if (
      err instanceof DiscordAPIError &&
      err.code === RESTJSONErrorCodes.CannotSendMessagesToThisUser
    ) {
      console.info('dm refused by discord', fields)
      return errorResponse('dm_closed')
    }
    if (err instanceof RateLimitError) {
      console.warn('rate limited by discord', fields)
      return errorResponse('rate_limited', Math.max(1, Math.ceil(err.retryAfter / 1000)))
    }
    console.error('dm failed', fields)
    return errorResponse('discord_unavailable')
  }
  // The DM is already out; a failed bookkeeping write must not report failure.
  await touchCode(owner.codeId).catch((err: unknown) => {
    console.warn('last-used not saved', { ...who, err: describe(err) })
  })
  console.info('dm sent', { ...who, ms: Date.now() - started })
  return Response.json({ ok: true, project: owner.project.slug, discordName: owner.user.name })
}

/** Answers server_error instead of a bare 500 page if anything throws. */
export async function guarded(run: () => Promise<Response>): Promise<Response> {
  try {
    return await run()
  } catch (err) {
    console.error('request failed', describe(err))
    return errorResponse('server_error')
  }
}
