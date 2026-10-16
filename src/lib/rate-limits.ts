import 'server-only'
import { RateLimiterMemory, RateLimiterRes } from 'rate-limiter-flexible'

/**
 * In-memory limits, so they reset when the server restarts. That is fine for
 * one instance; a second instance would need a shared store (Postgres or
 * Redis, which rate-limiter-flexible also supports).
 */

/** Per code: a short burst, then hourly and daily caps. */
const burst = new RateLimiterMemory({ keyPrefix: 'burst', points: 3, duration: 10 })
const hourly = new RateLimiterMemory({ keyPrefix: 'hour', points: 60, duration: 60 * 60 })
const daily = new RateLimiterMemory({ keyPrefix: 'day', points: 300, duration: 24 * 60 * 60 })
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

/**
 * Takes one point from every limiter, or from none: a refused request must
 * not use up the others, or retrying after a burst refusal would drain the
 * hourly and daily caps.
 */
async function takeAll(checks: [RateLimiterMemory, string][]): Promise<Limit> {
  const used = await Promise.all(checks.map(([limiter, key]) => limiter.get(key)))
  const full = used.filter(
    (res, i): res is RateLimiterRes => res !== null && res.consumedPoints >= checks[i]![0].points,
  )
  if (full.length > 0) return refused(full)
  try {
    await Promise.all(checks.map(([limiter, key]) => limiter.consume(key)))
    return { ok: true }
  } catch (err) {
    // Another request took the last point between the check and here.
    if (err instanceof RateLimiterRes) return refused([err])
    throw err
  }
}

export function takeMessage(codeId: string): Promise<Limit> {
  return takeAll([
    [burst, codeId],
    [hourly, codeId],
    [daily, codeId],
    [everyone, 'all'],
  ])
}

export function takeTest(codeId: string): Promise<Limit> {
  return takeAll([
    [tests, codeId],
    [everyone, 'all'],
  ])
}

/** Whether this client may try another code. */
export async function checkSource(source: string): Promise<Limit> {
  const used = await failures.get(source)
  return used !== null && used.remainingPoints <= 0 ? refused([used]) : { ok: true }
}

export async function recordFailure(source: string): Promise<void> {
  await failures.penalty(source)
}
