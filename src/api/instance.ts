import 'server-only'
import { getDb } from '@/db'
import { createDiscordBot } from '@/lib/discord'
import { DmLimiter } from '@/lib/limits'
import { log } from '@/lib/log'
import { findByCode, setDmChannel, touchCode } from '@/services/codes'
import { createDmApi, type DmApi } from './dm'

// One instance per process, so the in-memory limits are shared by every request.
const globals = globalThis as unknown as { connectDmApi?: DmApi }

export function dmApi(): DmApi {
  globals.connectDmApi ??= (() => {
    const db = getDb()
    return createDmApi({
      findByCode: (code) => findByCode(db, code),
      touchCode: (codeId) => touchCode(db, codeId),
      setDmChannel: (userId, channelId) => setDmChannel(db, userId, channelId),
      bot: createDiscordBot({
        botToken: process.env.DISCORD_BOT_TOKEN,
        guildId: process.env.DISCORD_GUILD_ID,
      }),
      limiter: new DmLimiter(),
      log,
      clientIpHeader: process.env.CLIENT_IP_HEADER?.toLowerCase() || null,
    })
  })()
  return globals.connectDmApi
}
