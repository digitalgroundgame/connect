import 'server-only'

/**
 * Settings read from the environment. Read lazily, at first use, so that
 * `next build` works without secrets and a missing value fails the request
 * that needs it with a clear message.
 */
export interface Env {
  databaseUrl: string
  /** Public URL of this site, e.g. https://connect.digitalgroundgame.org */
  baseUrl: string
  authSecret: string
  discord: {
    clientId: string
    clientSecret: string
    botToken: string
    /** Only members of this Discord server can sign in. */
    guildId: string
  }
  /** Discord user IDs that can open the admin pages. */
  adminDiscordIds: ReadonlySet<string>
  /**
   * The header holding the visitor's IP, set by the proxy in front of us
   * (CF-Connecting-IP behind Cloudflare). Unset means rate limits share one
   * bucket for every visitor rather than trusting a header anyone can send.
   */
  clientIpHeader: string | null
}

function required(name: string): string {
  const value = process.env[name]
  if (value === undefined || value.trim() === '') {
    throw new Error(`${name} is not set; see .env.example`)
  }
  return value.trim()
}

let cached: Env | null = null

export function env(): Env {
  cached ??= {
    databaseUrl: required('DATABASE_URL'),
    baseUrl: required('BETTER_AUTH_URL'),
    authSecret: required('BETTER_AUTH_SECRET'),
    discord: {
      clientId: required('DISCORD_CLIENT_ID'),
      clientSecret: required('DISCORD_CLIENT_SECRET'),
      botToken: required('DISCORD_BOT_TOKEN'),
      guildId: required('DISCORD_GUILD_ID'),
    },
    adminDiscordIds: new Set(
      (process.env.ADMIN_DISCORD_IDS ?? '')
        .split(',')
        .map((id) => id.trim())
        .filter((id) => id !== ''),
    ),
    clientIpHeader: process.env.CLIENT_IP_HEADER?.trim().toLowerCase() || null,
  }
  return cached
}
