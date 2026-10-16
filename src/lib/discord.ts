/**
 * The few Discord HTTP calls the bot side needs, over plain fetch. REST only:
 * the DGG bot's own process holds the gateway connection, and this server must
 * never open a second one with the same token. Sign-in goes through Better
 * Auth, not this file.
 * https://discord.com/developers/docs/reference
 */
const API = 'https://discord.com/api/v10'
const USER_AGENT = 'DiscordBot (https://github.com/digitalgroundgame/connect, 1.0)'
const TIMEOUT_MS = 8000

/** Discord JSON error codes we act on. */
export const UNKNOWN_CHANNEL = 10003
export const UNKNOWN_MEMBER = 10007
export const CANNOT_DM_USER = 50007

export class DiscordError extends Error {
  constructor(
    public readonly status: number,
    /** Discord's JSON error code, when the body carried one. */
    public readonly code: number | null,
    /** Seconds to wait, on a 429. */
    public readonly retryAfter: number | null,
    message: string,
  ) {
    super(message)
    this.name = 'DiscordError'
  }
}

export interface SendOptions {
  /**
   * With this set, Discord returns the message already sent with the same
   * nonce in the last few minutes instead of sending it again. Up to 25
   * characters.
   */
  nonce?: string
  /** Ends the call early, on top of the per-call timeout. */
  signal?: AbortSignal
}

export interface DiscordBot {
  isGuildMember(userId: string): Promise<boolean>
  openDm(userId: string, signal?: AbortSignal): Promise<string>
  sendMessage(channelId: string, content: string, options?: SendOptions): Promise<void>
}

async function errorFrom(res: Response): Promise<DiscordError> {
  let code: number | null = null
  let retryAfter: number | null = null
  let message = `discord ${res.status}`
  try {
    const body = (await res.json()) as { code?: unknown; message?: unknown; retry_after?: unknown }
    if (typeof body.code === 'number') code = body.code
    if (typeof body.message === 'string') message = `discord ${res.status}: ${body.message}`
    if (typeof body.retry_after === 'number') retryAfter = body.retry_after
  } catch {
    /* Not JSON: the status is all there is. */
  }
  if (retryAfter === null) {
    const header = Number(res.headers.get('retry-after'))
    if (Number.isFinite(header) && header > 0) retryAfter = header
  }
  return new DiscordError(res.status, code, retryAfter, message)
}

export function createDiscordBot(
  config: { botToken: string; guildId: string },
  fetchImpl: typeof fetch = fetch,
): DiscordBot {
  async function call<T>(
    path: string,
    init: { method: string; body?: unknown; signal?: AbortSignal | undefined },
  ): Promise<T> {
    const timeout = AbortSignal.timeout(TIMEOUT_MS)
    const res = await fetchImpl(`${API}${path}`, {
      method: init.method,
      headers: {
        'User-Agent': USER_AGENT,
        Authorization: `Bot ${config.botToken}`,
        ...(init.body !== undefined && { 'Content-Type': 'application/json' }),
      },
      ...(init.body !== undefined && { body: JSON.stringify(init.body) }),
      signal: init.signal === undefined ? timeout : AbortSignal.any([timeout, init.signal]),
    })
    if (!res.ok) throw await errorFrom(res)
    return (await res.json()) as T
  }

  return {
    async isGuildMember(userId) {
      try {
        await call(`/guilds/${config.guildId}/members/${userId}`, { method: 'GET' })
        return true
      } catch (err) {
        if (err instanceof DiscordError && err.code === UNKNOWN_MEMBER) return false
        throw err
      }
    },

    async openDm(userId, signal) {
      const channel = await call<{ id: string }>('/users/@me/channels', {
        method: 'POST',
        body: { recipient_id: userId },
        signal,
      })
      return channel.id
    },

    async sendMessage(channelId, content, options = {}) {
      await call(`/channels/${channelId}/messages`, {
        method: 'POST',
        body: {
          content,
          // Nothing a tool sends may ever ping anyone.
          allowed_mentions: { parse: [] },
          ...(options.nonce !== undefined && { nonce: options.nonce, enforce_nonce: true }),
        },
        signal: options.signal,
      })
    },
  }
}
