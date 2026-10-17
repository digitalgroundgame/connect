import 'server-only'
import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { nextCookies } from 'better-auth/next-js'
import { admin } from 'better-auth/plugins'
import { db } from '@/db'
import * as schema from '@/db/schema'
import { isGuildMember } from './discord'

function createAuth() {
  const clientIpHeader = process.env.CLIENT_IP_HEADER?.toLowerCase()

  // BETTER_AUTH_URL and BETTER_AUTH_SECRET are read by Better Auth itself.
  return betterAuth({
    database: drizzleAdapter(db, { provider: 'pg', schema }),
    socialProviders: {
      discord: {
        clientId: process.env.DISCORD_CLIENT_ID,
        clientSecret: process.env.DISCORD_CLIENT_SECRET,
        // Only the account itself: no email, no server list.
        disableDefaultScope: true,
        // Keeps names current when members rename themselves on Discord.
        overrideUserInfoOnSignIn: true,
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
      // Better Auth only copies fields from mapProfileToUser that allow input,
      // so the Discord fields do. Members can't set them: /update-user is
      // disabled below, and there is no email sign-up.
      additionalFields: {
        discordId: { type: 'string', required: true, input: true, unique: true },
        discordUsername: { type: 'string', required: true, input: true },
        dmChannelId: { type: 'string', required: false, input: false },
      },
      // Only members of the DGG Discord server get in. Sessions outlive a
      // member leaving, so getCode checks membership again before issuing.
      async validateUserInfo({ source }) {
        const discordId = source.oauth?.profile?.id
        if (source.oauth?.providerId !== 'discord' || typeof discordId !== 'string') {
          return { error: 'discord_only' }
        }
        let member: boolean
        try {
          member = await isGuildMember(discordId)
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
    // Members never edit their own profile; it comes from Discord.
    disabledPaths: ['/update-user'],
    onAPIError: { errorURL: '/' },
    // Admins have role 'admin'. Other admins grant it at /admin; the first one
    // is set by hand (docs/DEPLOY.md). nextCookies must stay last.
    plugins: [admin(), nextCookies()],
  })
}

export type Auth = ReturnType<typeof createAuth>

let auth: Auth | null = null

export function getAuth(): Auth {
  auth ??= createAuth()
  return auth
}
