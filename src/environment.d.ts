// Types for the settings in .env.example. They are read at runtime, so a
// missing value fails the request that needs it, not the build.
declare global {
  namespace NodeJS {
    interface ProcessEnv {
      DATABASE_URL: string
      // Read by Better Auth itself.
      BETTER_AUTH_URL: string
      BETTER_AUTH_SECRET: string
      DISCORD_CLIENT_ID: string
      DISCORD_CLIENT_SECRET: string
      DISCORD_BOT_TOKEN: string
      DISCORD_GUILD_ID: string
      /** The header holding the visitor's IP, e.g. cf-connecting-ip behind Cloudflare. */
      CLIENT_IP_HEADER?: string
    }
  }
}

export {}
