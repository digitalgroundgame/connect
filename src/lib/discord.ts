import 'server-only'
import { DiscordAPIError, REST, RateLimitError } from '@discordjs/rest'
import {
  RESTJSONErrorCodes,
  Routes,
  type RESTPostAPICurrentUserCreateDMChannelResult,
} from 'discord-api-types/v10'

export { DiscordAPIError, RateLimitError }

let client: REST | undefined

/** The DGG bot, created on first use so a build needs no token. */
function bot(): REST {
  client ??= new REST({
    timeout: 8_000,
    retries: 1,
    // Fail at once on a Discord rate limit, so a tool is told to retry
    // rather than left waiting on a queued request.
    rejectOnRateLimit: () => true,
  }).setToken(process.env.DISCORD_BOT_TOKEN)
  return client
}

/** Whether the user is in the DGG Discord server. */
export async function isGuildMember(userId: string): Promise<boolean> {
  try {
    await bot().get(Routes.guildMember(process.env.DISCORD_GUILD_ID, userId))
    return true
  } catch (err) {
    if (err instanceof DiscordAPIError && err.code === RESTJSONErrorCodes.UnknownMember) {
      return false
    }
    throw err
  }
}

/** The bot's DM channel with the user, opening it if needed. */
export async function openDm(userId: string, signal?: AbortSignal): Promise<string> {
  const channel = (await bot().post(Routes.userChannels(), {
    body: { recipient_id: userId },
    signal,
  })) as RESTPostAPICurrentUserCreateDMChannelResult
  return channel.id
}

export interface SendOptions {
  /** With a nonce, Discord drops a repeat of the same message. */
  nonce?: string | undefined
  signal?: AbortSignal | undefined
}

export async function sendMessage(
  channelId: string,
  content: string,
  { nonce, signal }: SendOptions = {},
): Promise<void> {
  await bot().post(Routes.channelMessages(channelId), {
    body: {
      content,
      // Nothing a tool sends may ever ping anyone.
      allowed_mentions: { parse: [] },
      ...(nonce !== undefined && { nonce, enforce_nonce: true }),
    },
    signal,
  })
}
