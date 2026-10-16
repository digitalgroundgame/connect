import 'server-only'
import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { nextCookies } from 'better-auth/next-js'
import { getDb } from '@/db'
import * as schema from '@/db/schema'
import { createDiscordBot } from './discord'

function createAuth() {
  const bot = createDiscordBot({
    botToken: process.env.DISCORD_BOT_TOKEN,
    guildId: process.env.DISCORD_GUILD_ID,
  })
  const clientIpHeader = process.env.CLIENT_IP_HEADER?.toLowerCase()

  // BETTER_AUTH_URL and BETTER_AUTH_SECRET are read by Better Auth itself.
  return betterAuth({
    database: drizzleAdapter(getDb(), { provider: 'pg', schema }),
    socialProviders: {
      discord: {
        clientId: process.env.DISCORD_CLIENT_ID,
        clientSecret: process.env.DISCORD_CLIENT_SECRET,
        // Only the account itself: no email, no server list.
        disableDefaultScope: true,
        scope: ['identify'],
        mapProfileToUser: (profile) => ({
          // Better Auth needs a unique email; Discord's is never asked for.
          email: `${profile.id}@discord.invalid`,
          emailVerified: false,
          name: profile.global_name || profile.username,
          discordId: profile.id,
          discordUsername: profile.username,
        }),
      },
    },
    user: {
      additionalFields: {
        discordId: { type: 'string', required: true, input: false, unique: true },
        discordUsername: { type: 'string', required: true, input: false },
        dmChannelId: { type: 'string', required: false, input: false },
        // Set at /admin by another admin; the first one is set by hand (docs/DEPLOY.md).
        isAdmin: { type: 'boolean', required: false, defaultValue: false, input: false },
      },
      // Only members of the DGG Discord server get in, checked on every
      // sign-in so someone who left loses access at their next sign-in.
      async validateUserInfo({ source }) {
        const discordId = source.oauth?.profile?.id
        if (source.oauth?.providerId !== 'discord' || typeof discordId !== 'string') {
          return { error: 'discord_only' }
        }
        let member: boolean
        try {
          member = await bot.isGuildMember(discordId)
        } catch {
          return { error: 'discord_unavailable' }
        }
        if (!member) return { error: 'not_in_server' }
      },
    },
    session: {
      expiresIn: 60 * 60 * 24 * 30,
      updateAge: 60 * 60 * 24,
    },
    account: {
      // Nothing uses the member's own Discord tokens after sign-in; they are
      // kept encrypted so a database leak does not hand them out.
      encryptOAuthTokens: true,
    },
    advanced: {
      ipAddress: {
        ipAddressHeaders: clientIpHeader ? [clientIpHeader] : [],
      },
    },
    onAPIError: { errorURL: '/' },
    plugins: [nextCookies()],
  })
}

export type Auth = ReturnType<typeof createAuth>

let auth: Auth | null = null

export function getAuth(): Auth {
  auth ??= createAuth()
  return auth
}
