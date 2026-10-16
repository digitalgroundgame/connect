import 'server-only'
import { RateLimiterMemory, RateLimiterRes, RateLimiterUnion } from 'rate-limiter-flexible'

/**
 * In-memory limits, so they reset when the server restarts. That is fine for
 * one instance; a second instance would need a shared store (Postgres or
 * Redis, which rate-limiter-flexible also supports).
 */

/** Per code: a short burst, then hourly and daily caps. */
const messages = new RateLimiterUnion(
  new RateLimiterMemory({ keyPrefix: 'burst', points: 3, duration: 10 }),
  new RateLimiterMemory({ keyPrefix: 'hour', points: 60, duration: 60 * 60 }),
  new RateLimiterMemory({ keyPrefix: 'day', points: 300, duration: 24 * 60 * 60 }),
)
/** Test messages, per code, counted apart from real ones. */
const tests = new RateLimiterMemory({ keyPrefix: 'test', points: 5, duration: 60 * 60 })
/** Every DM together, well under Discord's own limit for the bot. */
const everyone = new RateLimiterMemory({ keyPrefix: 'global', points: 20, duration: 1 })
/** Requests with a bad code, per client IP: slows down guessing. */
const failures = new RateLimiterMemory({ keyPrefix: 'fail', points: 10, duration: 10 * 60 })

export type Limit = { ok: true } | { ok: false; retryAfterSeconds: number }

function refused(results: RateLimiterRes[]): Limit {
  const ms = Math.max(...results.map((r) => r.msBeforeNext))
  return { ok: false, retryAfterSeconds: Math.max(1, Math.ceil(ms / 1000)) }
}

/** Rejections are RateLimiterRes (one limiter) or a record of them (a union). */
async function take(consume: () => Promise<unknown>): Promise<Limit> {
  try {
    await consume()
    return { ok: true }
  } catch (err) {
    if (err instanceof RateLimiterRes) return refused([err])
    if (typeof err === 'object' && err !== null && !(err instanceof Error)) {
      return refused(Object.values(err as Record<string, RateLimiterRes>))
    }
    throw err
  }
}

export async function takeMessage(codeId: string): Promise<Limit> {
  const limit = await take(() => messages.consume(codeId))
  return limit.ok ? take(() => everyone.consume('all')) : limit
}

export async function takeTest(codeId: string): Promise<Limit> {
  const limit = await take(() => tests.consume(codeId))
  return limit.ok ? take(() => everyone.consume('all')) : limit
}

/** Whether this client may try another code. */
export async function checkSource(source: string): Promise<Limit> {
  const used = await failures.get(source)
  return used !== null && used.remainingPoints <= 0 ? refused([used]) : { ok: true }
}

export async function recordFailure(source: string): Promise<void> {
  await failures.penalty(source)
}
