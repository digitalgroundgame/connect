/**
 * Limits on DMs sent for tools. Each member pays for their own tools, so these
 * protect the DGG bot and its standing with Discord rather than a bill. In
 * memory: that fits the single-replica deploy, and a redeploy resetting the
 * counts is acceptable at this size.
 */

const SECOND = 1000
const MINUTE = 60 * SECOND
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

export const LIMITS = {
  /** Per code: a burst of 3, then one message every 10 seconds. */
  messageBurst: 3,
  messageRefillMs: 10 * SECOND,
  messagesPerHour: 60,
  messagesPerDay: 300,
  testsPerHour: 5,
  /**
   * Across every code. The running DGG bot shares Discord's 50 requests a
   * second per bot, so this service takes well under half of it.
   */
  globalPerSecond: 20,
  /** Failed codes per visitor: a burst of 10, then one a minute. */
  failBurst: 10,
  failRefillMs: MINUTE,
} as const

/** Per limit. Evicting the least recently used key keeps memory bounded. */
export const MAX_KEYS = 10_000

export type Verdict = { ok: true } | { ok: false; retryAfterSeconds: number }

interface Bucket {
  tokens: number
  at: number
}

interface Window {
  start: number
  count: number
}

function seconds(ms: number): number {
  return Math.max(1, Math.ceil(ms / 1000))
}

/**
 * Keys in least-recently-used order: Map keeps insertion order, and every
 * write moves its key to the end. At the cap the oldest key goes, so memory
 * stays bounded and no write scans the whole map. A check never adds a key,
 * so refused requests cost no storage.
 */
class Recent<T> {
  private readonly entries = new Map<string, T>()

  get(key: string): T | undefined {
    return this.entries.get(key)
  }

  set(key: string, value: T): void {
    this.entries.delete(key)
    if (this.entries.size >= MAX_KEYS) {
      const oldest = this.entries.keys().next().value
      if (oldest !== undefined) this.entries.delete(oldest)
    }
    this.entries.set(key, value)
  }

  get size(): number {
    return this.entries.size
  }
}

class TokenBucket {
  private readonly buckets = new Recent<Bucket>()

  constructor(
    private readonly burst: number,
    private readonly refillMs: number,
  ) {}

  private tokens(key: string, now: number): number {
    const bucket = this.buckets.get(key)
    if (bucket === undefined) return this.burst
    return Math.min(this.burst, bucket.tokens + Math.max(0, now - bucket.at) / this.refillMs)
  }

  check(key: string, now: number): Verdict {
    const tokens = this.tokens(key, now)
    return tokens >= 1
      ? { ok: true }
      : { ok: false, retryAfterSeconds: seconds((1 - tokens) * this.refillMs) }
  }

  take(key: string, now: number): void {
    this.buckets.set(key, { tokens: this.tokens(key, now) - 1, at: now })
  }

  get size(): number {
    return this.buckets.size
  }
}

/** A fixed window: simple, and generous by at most one window at a boundary. */
class WindowCounter {
  private readonly windows = new Recent<Window>()

  constructor(
    private readonly max: number,
    private readonly lengthMs: number,
  ) {}

  private count(key: string, now: number): Window {
    const start = now - (now % this.lengthMs)
    const window = this.windows.get(key)
    return { start, count: window?.start === start ? window.count : 0 }
  }

  check(key: string, now: number): Verdict {
    const { start, count } = this.count(key, now)
    return count < this.max
      ? { ok: true }
      : { ok: false, retryAfterSeconds: seconds(start + this.lengthMs - now) }
  }

  take(key: string, now: number): void {
    const { start, count } = this.count(key, now)
    this.windows.set(key, { start, count: count + 1 })
  }
}

/** The longest wait among the limits that refuse, so a retry at that time succeeds. */
function strictest(verdicts: Verdict[]): Verdict {
  let worst: Verdict = { ok: true }
  for (const v of verdicts) {
    if (!v.ok && (worst.ok || v.retryAfterSeconds > worst.retryAfterSeconds)) worst = v
  }
  return worst
}

export class DmLimiter {
  private readonly burst = new TokenBucket(LIMITS.messageBurst, LIMITS.messageRefillMs)
  private readonly hourly = new WindowCounter(LIMITS.messagesPerHour, HOUR)
  private readonly daily = new WindowCounter(LIMITS.messagesPerDay, DAY)
  private readonly tests = new WindowCounter(LIMITS.testsPerHour, HOUR)
  private readonly global = new TokenBucket(LIMITS.globalPerSecond, SECOND / LIMITS.globalPerSecond)
  private readonly failures = new TokenBucket(LIMITS.failBurst, LIMITS.failRefillMs)

  constructor(private readonly now: () => number = Date.now) {}

  /** Checked before a code is looked up, so a guesser is slowed down first. */
  checkSource(source: string): Verdict {
    return this.failures.check(source, this.now())
  }

  recordFailure(source: string): void {
    this.failures.take(source, this.now())
  }

  /** How many sources are being tracked; for tests of the storage bound. */
  get trackedSources(): number {
    return this.failures.size
  }

  /** Counts the message only when every limit allows it. */
  takeMessage(codeId: string): Verdict {
    const now = this.now()
    const verdict = strictest([
      this.burst.check(codeId, now),
      this.hourly.check(codeId, now),
      this.daily.check(codeId, now),
      this.global.check('all', now),
    ])
    if (verdict.ok) {
      this.burst.take(codeId, now)
      this.hourly.take(codeId, now)
      this.daily.take(codeId, now)
      this.global.take('all', now)
    }
    return verdict
  }

  takeTest(codeId: string): Verdict {
    const now = this.now()
    const verdict = strictest([this.tests.check(codeId, now), this.global.check('all', now)])
    if (verdict.ok) {
      this.tests.take(codeId, now)
      this.global.take('all', now)
    }
    return verdict
  }
}
