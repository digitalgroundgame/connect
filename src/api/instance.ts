import 'server-only'
import { getDb } from '@/db'
import { createDiscordBot } from '@/lib/discord'
import { env } from '@/lib/env'
import { DmLimiter } from '@/lib/limits'
import { log } from '@/lib/log'
import { findByCode, setDmChannel, touchCode } from '@/services/codes'
import { createDmApi, type DmApi } from './dm'

// One instance per process, so the in-memory limits are shared by every request.
const globals = globalThis as unknown as { connectDmApi?: DmApi }

export function dmApi(): DmApi {
  globals.connectDmApi ??= (() => {
    const config = env()
    const db = getDb()
    return createDmApi({
      findByCode: (code) => findByCode(db, code),
      touchCode: (codeId) => touchCode(db, codeId),
      setDmChannel: (userId, channelId) => setDmChannel(db, userId, channelId),
      bot: createDiscordBot(config.discord),
      limiter: new DmLimiter(),
      log,
      clientIpHeader: config.clientIpHeader,
    })
  })()
  return globals.connectDmApi
}
