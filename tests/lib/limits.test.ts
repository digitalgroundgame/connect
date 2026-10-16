import { beforeEach, describe, expect, it } from 'vitest'
import { DmLimiter, LIMITS, MAX_KEYS } from '@/lib/limits'

const SECOND = 1000
const HOUR = 60 * 60 * SECOND
const DAY = 24 * HOUR
/** Midnight UTC, so every hour and day window starts here. */
const START = Date.UTC(2026, 0, 1)

let now: number
let limiter: DmLimiter

beforeEach(() => {
  now = START
  limiter = new DmLimiter(() => now)
})

describe('messages: burst', () => {
  it('allows a burst of three, then refuses', () => {
    for (let i = 0; i < LIMITS.messageBurst; i++)
      expect(limiter.takeMessage('c')).toEqual({ ok: true })
    expect(limiter.takeMessage('c')).toEqual({ ok: false, retryAfterSeconds: 10 })
  })

  it('refills one message every 10 seconds', () => {
    for (let i = 0; i < 3; i++) limiter.takeMessage('c')
    now += 9 * SECOND
    expect(limiter.takeMessage('c')).toEqual({ ok: false, retryAfterSeconds: 1 })
    now += 1 * SECOND
    expect(limiter.takeMessage('c')).toEqual({ ok: true })
    expect(limiter.takeMessage('c').ok).toBe(false)
  })

  it('does not count refused messages', () => {
    for (let i = 0; i < 3; i++) limiter.takeMessage('c')
    for (let i = 0; i < 5; i++) expect(limiter.takeMessage('c').ok).toBe(false)
    now += 10 * SECOND
    expect(limiter.takeMessage('c').ok).toBe(true)
  })

  it('keeps each code separate', () => {
    for (let i = 0; i < 3; i++) limiter.takeMessage('a')
    expect(limiter.takeMessage('a').ok).toBe(false)
    expect(limiter.takeMessage('b').ok).toBe(true)
  })

  it('never refills above the burst', () => {
    now += DAY / 2
    for (let i = 0; i < 3; i++) expect(limiter.takeMessage('c').ok).toBe(true)
    expect(limiter.takeMessage('c').ok).toBe(false)
  })
})

/** Sends one message every 10 seconds, so the burst limit never refuses. */
function sendSpaced(codeId: string, count: number): void {
  for (let i = 0; i < count; i++) {
    expect(limiter.takeMessage(codeId)).toEqual({ ok: true })
    now += 10 * SECOND
  }
}

describe('messages: hourly window', () => {
  it('allows 60 an hour, then refuses until the next hour', () => {
    sendSpaced('c', LIMITS.messagesPerHour)
    const elapsed = now - START
    expect(limiter.takeMessage('c')).toEqual({
      ok: false,
      retryAfterSeconds: (HOUR - elapsed) / SECOND,
    })
    now = START + HOUR
    expect(limiter.takeMessage('c').ok).toBe(true)
  })

  it('uses fixed windows that start on the hour', () => {
    now = START + HOUR - 300 * SECOND
    sendSpaced('c', 30)
    // A sliding window would still count those 30; the fixed one restarted on the hour.
    expect(now).toBe(START + HOUR)
    sendSpaced('c', LIMITS.messagesPerHour)
  })
})

describe('messages: daily window', () => {
  it('allows 300 a day, then refuses until midnight UTC', () => {
    for (let hour = 0; hour < LIMITS.messagesPerDay / LIMITS.messagesPerHour; hour++) {
      now = START + hour * HOUR
      sendSpaced('c', LIMITS.messagesPerHour)
    }
    now = START + 5 * HOUR
    expect(limiter.takeMessage('c')).toEqual({
      ok: false,
      retryAfterSeconds: (DAY - 5 * HOUR) / SECOND,
    })
    now = START + DAY
    expect(limiter.takeMessage('c').ok).toBe(true)
  })
})

describe('messages: global limit', () => {
  it('allows 20 a second across all codes', () => {
    for (let i = 0; i < LIMITS.globalPerSecond; i++) {
      expect(limiter.takeMessage(`code-${i}`).ok).toBe(true)
    }
    expect(limiter.takeMessage('one-more')).toEqual({ ok: false, retryAfterSeconds: 1 })
    now += SECOND / LIMITS.globalPerSecond
    expect(limiter.takeMessage('one-more').ok).toBe(true)
  })
})

describe('tests', () => {
  it('allows five an hour per code', () => {
    for (let i = 0; i < LIMITS.testsPerHour; i++)
      expect(limiter.takeTest('c')).toEqual({ ok: true })
    expect(limiter.takeTest('c')).toEqual({ ok: false, retryAfterSeconds: 3600 })
    expect(limiter.takeTest('other').ok).toBe(true)
    now += HOUR
    expect(limiter.takeTest('c').ok).toBe(true)
  })

  it('is counted apart from messages', () => {
    for (let i = 0; i < 5; i++) limiter.takeTest('c')
    expect(limiter.takeMessage('c').ok).toBe(true)
  })

  it('shares the global limit with messages', () => {
    for (let i = 0; i < LIMITS.globalPerSecond; i++) limiter.takeMessage(`code-${i}`)
    expect(limiter.takeTest('c')).toEqual({ ok: false, retryAfterSeconds: 1 })
  })
})

describe('failures per source', () => {
  it('allows ten failures, then refuses the source', () => {
    for (let i = 0; i < LIMITS.failBurst; i++) {
      expect(limiter.checkSource('1.2.3.4')).toEqual({ ok: true })
      limiter.recordFailure('1.2.3.4')
    }
    expect(limiter.checkSource('1.2.3.4')).toEqual({ ok: false, retryAfterSeconds: 60 })
  })

  it('lets one more through each minute', () => {
    for (let i = 0; i < 10; i++) limiter.recordFailure('1.2.3.4')
    now += 30 * SECOND
    expect(limiter.checkSource('1.2.3.4')).toEqual({ ok: false, retryAfterSeconds: 30 })
    now += 30 * SECOND
    expect(limiter.checkSource('1.2.3.4').ok).toBe(true)
  })

  it('keeps each source separate', () => {
    for (let i = 0; i < 10; i++) limiter.recordFailure('1.2.3.4')
    expect(limiter.checkSource('1.2.3.4').ok).toBe(false)
    expect(limiter.checkSource('5.6.7.8').ok).toBe(true)
  })

  it('does not count a check as a failure', () => {
    for (let i = 0; i < 50; i++) limiter.checkSource('1.2.3.4')
    expect(limiter.checkSource('1.2.3.4').ok).toBe(true)
  })
})

describe('MAX_KEYS', () => {
  it('tracks at most MAX_KEYS sources', () => {
    for (let i = 0; i < MAX_KEYS + 50; i++) limiter.recordFailure(`source-${i}`)
    expect(limiter.trackedSources).toBe(MAX_KEYS)
  })

  it('does not store a source that is only checked', () => {
    limiter.checkSource('1.2.3.4')
    expect(limiter.trackedSources).toBe(0)
  })

  it('evicts the least recently used source first', () => {
    for (let i = 0; i < 10; i++) limiter.recordFailure('blocked')
    for (let i = 1; i < MAX_KEYS; i++) limiter.recordFailure(`source-${i}`)
    // Using "blocked" again makes source-1 the oldest.
    limiter.recordFailure('blocked')
    limiter.recordFailure('newest')
    expect(limiter.trackedSources).toBe(MAX_KEYS)
    expect(limiter.checkSource('blocked').ok).toBe(false)

    // Once enough new sources push it out, "blocked" starts over with a full burst.
    for (let i = 0; i < MAX_KEYS; i++) limiter.recordFailure(`later-${i}`)
    expect(limiter.checkSource('blocked').ok).toBe(true)
  })
})
