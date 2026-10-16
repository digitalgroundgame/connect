import { randomUUID } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { checkSource, recordFailure, takeMessage, takeTest, type Limit } from '@/lib/rate-limits'

/**
 * The limiters live at module level, so each test uses its own keys. Time is
 * faked (the store reads Date.now and expires keys with setTimeout) and moved
 * a minute on before each test, so the shared limit of 20 DMs a second never
 * carries over from one test to the next.
 */
let clock = Date.UTC(2026, 0, 1)

beforeEach(() => {
  vi.useFakeTimers({ now: (clock += 60_000) })
})

afterEach(() => {
  vi.useRealTimers()
})

function key(): string {
  return randomUUID()
}

/** Expects a refusal and returns its Retry-After, which must be a whole number of seconds. */
async function refusal(limit: Promise<Limit>): Promise<number> {
  const result = await limit
  if (result.ok) throw new Error('expected the limit to refuse')
  const { retryAfterSeconds } = result
  expect(Number.isInteger(retryAfterSeconds)).toBe(true)
  expect(retryAfterSeconds).toBeGreaterThan(0)
  return retryAfterSeconds
}

describe('takeMessage', () => {
  it('allows a burst of three, then refuses with a positive Retry-After', async () => {
    const code = key()
    for (let i = 0; i < 3; i++) expect(await takeMessage(code)).toEqual({ ok: true })
    expect(await refusal(takeMessage(code))).toBeLessThanOrEqual(10)
  })

  it('allows more once the burst window has passed', async () => {
    const code = key()
    for (let i = 0; i < 3; i++) await takeMessage(code)
    await refusal(takeMessage(code))
    vi.advanceTimersByTime(10_000)
    expect(await takeMessage(code)).toEqual({ ok: true })
  })

  it('keeps each code separate', async () => {
    const a = key()
    for (let i = 0; i < 3; i++) await takeMessage(a)
    await refusal(takeMessage(a))
    expect(await takeMessage(key())).toEqual({ ok: true })
  })
})

describe('takeTest', () => {
  it('allows five an hour per code', async () => {
    const code = key()
    for (let i = 0; i < 5; i++) expect(await takeTest(code)).toEqual({ ok: true })
    const wait = await refusal(takeTest(code))
    expect(wait).toBeLessThanOrEqual(60 * 60)
  })

  it('is counted apart from messages', async () => {
    const code = key()
    for (let i = 0; i < 3; i++) await takeMessage(code)
    await refusal(takeMessage(code))
    expect(await takeTest(code)).toEqual({ ok: true })

    const other = key()
    for (let i = 0; i < 5; i++) await takeTest(other)
    await refusal(takeTest(other))
    expect(await takeMessage(other)).toEqual({ ok: true })
  })
})

describe('the limit on every DM together', () => {
  it('allows 20 a second across all codes, messages and tests alike', async () => {
    for (let i = 0; i < 10; i++) expect(await takeMessage(key())).toEqual({ ok: true })
    for (let i = 0; i < 10; i++) expect(await takeTest(key())).toEqual({ ok: true })
    expect(await refusal(takeMessage(key()))).toBe(1)
    vi.advanceTimersByTime(1_000)
    expect(await takeMessage(key())).toEqual({ ok: true })
  })
})

describe('failures per source', () => {
  it('allows ten failures, then refuses the source', async () => {
    const source = key()
    for (let i = 0; i < 10; i++) {
      expect(await checkSource(source)).toEqual({ ok: true })
      await recordFailure(source)
    }
    expect(await refusal(checkSource(source))).toBeLessThanOrEqual(10 * 60)
  })

  it('lets the source try again once the window has passed', async () => {
    const source = key()
    for (let i = 0; i < 10; i++) await recordFailure(source)
    await refusal(checkSource(source))
    vi.advanceTimersByTime(10 * 60 * 1000)
    expect(await checkSource(source)).toEqual({ ok: true })
  })

  it('keeps each source separate', async () => {
    const source = key()
    for (let i = 0; i < 10; i++) await recordFailure(source)
    await refusal(checkSource(source))
    expect(await checkSource(key())).toEqual({ ok: true })
  })

  it('does not count a check as a failure', async () => {
    const source = key()
    for (let i = 0; i < 20; i++) await checkSource(source)
    for (let i = 0; i < 9; i++) await recordFailure(source)
    expect(await checkSource(source)).toEqual({ ok: true })
  })

  it('is fine for a source that has never failed', async () => {
    expect(await checkSource(key())).toEqual({ ok: true })
  })
})
